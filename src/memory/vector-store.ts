// ─── Memory: vector store over SQLite ─────────────────────────
// Brute-force cosine similarity. Plenty fast for <100k rows.

import { getDb } from "../db.js";
import { blobToVector, vectorToBlob, EMBEDDING_DIMS } from "./embeddings.js";
import { isRetrievable } from "../synthesis/tiers.js";

export type MemoryType =
  | "note"
  | "session"
  | "email"
  | "task"
  | "voice"
  | "ai_chat"
  | "calendar"
  | "github"
  | "daily_summary";

export interface MemoryRecord {
  id: number;
  type: MemoryType;
  sourceId: string | null;
  text: string;
  metadata: Record<string, unknown>;
  timestamp: number;
  importance: number;
}

export interface MemoryHit extends MemoryRecord {
  similarity: number;
  score: number;
}

export interface InsertMemoryInput {
  type: MemoryType;
  text: string;
  embedding: Float32Array;
  sourceId?: string | null;
  metadata?: Record<string, unknown>;
  timestamp?: number;
  importance?: number;
}

export interface SearchOptions {
  limit?: number;
  types?: MemoryType[];
  daysBack?: number;
  minImportance?: number;
  minSimilarity?: number;
  /** Apply memory-tier gating: long-term/archival rows surface only if important. */
  respectTiers?: boolean;
}

const DEFAULT_LIMIT = 8;
const HALF_LIFE_DAYS = 30;

const SOURCE_WEIGHTS: Partial<Record<MemoryType, number>> = {
  note: 1.25,
  ai_chat: 1.2,
  task: 1.1,
  email: 1.05,
  voice: 1.05,
  calendar: 0.95,
  github: 0.95,
  daily_summary: 0.9,
  session: 0.8,
};

interface MemoryRow {
  id: number;
  type: string;
  source_id: string | null;
  text: string;
  embedding: Buffer;
  metadata: string;
  timestamp: number;
  importance: number;
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    type: row.type as MemoryType,
    sourceId: row.source_id,
    text: row.text,
    metadata,
    timestamp: row.timestamp,
    importance: row.importance,
  };
}

export function insertMemory(input: InsertMemoryInput): number {
  if (input.embedding.length !== EMBEDDING_DIMS) {
    throw new Error(
      `Embedding has ${input.embedding.length} dims; expected ${EMBEDDING_DIMS}.`
    );
  }
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO memory (type, source_id, text, embedding, metadata, timestamp, importance)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.type,
      input.sourceId ?? null,
      input.text,
      vectorToBlob(input.embedding),
      JSON.stringify(input.metadata ?? {}),
      input.timestamp ?? Date.now(),
      input.importance ?? 0.5
    );
  return Number(result.lastInsertRowid);
}

export function deleteMemory(id: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM memory WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countMemories(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS n FROM memory").get() as { n: number };
  return row.n;
}

export function getMemoryBySource(
  type: MemoryType,
  sourceId: string
): MemoryRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM memory WHERE type = ? AND source_id = ? ORDER BY timestamp DESC LIMIT 1"
    )
    .get(type, sourceId) as MemoryRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function listMemories(limit = 20, type?: MemoryType): MemoryRecord[] {
  const db = getDb();
  const rows = type
    ? (db
        .prepare(
          "SELECT * FROM memory WHERE type = ? ORDER BY timestamp DESC LIMIT ?"
        )
        .all(type, limit) as MemoryRow[])
    : (db
        .prepare("SELECT * FROM memory ORDER BY timestamp DESC LIMIT ?")
        .all(limit) as MemoryRow[]);
  return rows.map(rowToRecord);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function recencyDecay(timestamp: number, now: number): number {
  const ageDays = Math.max(0, (now - timestamp) / (1000 * 60 * 60 * 24));
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

/** Brute-force semantic search across stored memories. */
export function searchSimilar(
  queryEmbedding: Float32Array,
  opts: SearchOptions = {}
): MemoryHit[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const minSimilarity = Math.max(0, Math.min(1, opts.minSimilarity ?? 0));
  const db = getDb();

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (opts.types && opts.types.length > 0) {
    const placeholders = opts.types.map(() => "?").join(", ");
    clauses.push(`type IN (${placeholders})`);
    params.push(...opts.types);
  }
  if (typeof opts.daysBack === "number") {
    const cutoff = Date.now() - opts.daysBack * 24 * 60 * 60 * 1000;
    clauses.push("timestamp >= ?");
    params.push(cutoff);
  }
  if (typeof opts.minImportance === "number") {
    clauses.push("importance >= ?");
    params.push(opts.minImportance);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM memory ${where}`)
    .all(...params) as MemoryRow[];

  const now = Date.now();
  const hits: MemoryHit[] = [];
  for (const row of rows) {
    const record = rowToRecord(row);
    if (opts.respectTiers && !isRetrievable(record, now)) continue;
    const vec = blobToVector(row.embedding);
    const similarity = cosineSimilarity(queryEmbedding, vec);
    if (similarity < minSimilarity) continue;
    const recency = recencyDecay(record.timestamp, now);
    const sourceWeight = SOURCE_WEIGHTS[record.type] ?? 1;
    const score = similarity * recency * (0.5 + 0.5 * record.importance) * sourceWeight;
    hits.push({ ...record, similarity, score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

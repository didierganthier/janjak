// ─── Memory: public recall API ─────────────────────────────────

import { embed } from "./embeddings.js";
import {
  insertMemory,
  searchSimilar,
  type MemoryHit,
  type MemoryType,
  type SearchOptions,
} from "./vector-store.js";

export interface CaptureInput {
  type: MemoryType;
  text: string;
  sourceId?: string | null;
  metadata?: Record<string, unknown>;
  importance?: number;
  timestamp?: number;
}

/** Embed + store a piece of text. Returns the new memory row id. */
export async function capture(input: CaptureInput): Promise<number> {
  const trimmed = input.text.trim();
  if (!trimmed) throw new Error("Cannot capture an empty memory.");
  const embedding = await embed(trimmed);
  return insertMemory({
    type: input.type,
    text: trimmed,
    embedding,
    ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(input.importance !== undefined ? { importance: input.importance } : {}),
    ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
  });
}

/** Semantic recall across stored memories, ranked by similarity × recency × importance. */
export async function recall(
  query: string,
  opts: SearchOptions = {}
): Promise<MemoryHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const queryEmbedding = await embed(trimmed);
  return searchSimilar(queryEmbedding, opts);
}

/** Format hits as a human-readable block. */
export function formatHits(hits: MemoryHit[]): string {
  if (hits.length === 0) {
    return "\n  No matching memories found.\n";
  }
  const lines: string[] = ["", `🧠 Recall — ${hits.length} hit${hits.length === 1 ? "" : "s"}`, ""];
  for (const hit of hits) {
    const date = new Date(hit.timestamp).toISOString().slice(0, 10);
    const snippet = hit.text.length > 220 ? hit.text.slice(0, 217) + "..." : hit.text;
    const score = hit.score.toFixed(3);
    const sim = hit.similarity.toFixed(3);
    lines.push(`  [#${hit.id}] ${hit.type.padEnd(14)} ${date}  sim=${sim} score=${score}`);
    lines.push(`         ${snippet.replace(/\n+/g, " ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Format hits as a compact block suitable for injection into AI system prompts. */
export function formatHitsForPrompt(hits: MemoryHit[]): string {
  if (hits.length === 0) return "";
  const lines = ["[Relevant Memory]"];
  for (const hit of hits) {
    const date = new Date(hit.timestamp).toISOString().slice(0, 10);
    const snippet = hit.text.length > 300 ? hit.text.slice(0, 297) + "..." : hit.text;
    lines.push(`- (${hit.type}, ${date}) ${snippet.replace(/\n+/g, " ")}`);
  }
  return lines.join("\n");
}

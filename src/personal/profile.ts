import { getDb } from "../db.js";

export type PreferenceCategory =
  | "communication"
  | "work_style"
  | "schedule"
  | "health"
  | "food"
  | "people";

export type PreferenceSource = "observed" | "stated" | "inferred";

export const PREFERENCE_CATEGORIES: PreferenceCategory[] = [
  "communication",
  "work_style",
  "schedule",
  "health",
  "food",
  "people",
];

export interface PreferenceRecord {
  id: number;
  category: PreferenceCategory;
  key: string;
  value: string;
  source: PreferenceSource;
  confidence: number;
  evidenceCount: number;
  lastConfirmed: number;
}

interface PreferenceRow {
  id: number;
  category: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  evidence_count: number;
  last_confirmed: number;
}

function mapRow(row: PreferenceRow): PreferenceRecord {
  return {
    id: row.id,
    category: row.category as PreferenceCategory,
    key: row.key,
    value: row.value,
    source: row.source as PreferenceSource,
    confidence: row.confidence,
    evidenceCount: row.evidence_count,
    lastConfirmed: row.last_confirmed,
  };
}

export interface UpsertPreferenceInput {
  category: PreferenceCategory;
  key: string;
  value: string;
  source?: PreferenceSource;
  confidence?: number;
  confirmedAt?: number;
}

/**
 * Insert or reinforce a preference. When the (category, key) already exists:
 * - matching value → confidence rises and evidence_count increments
 * - differing value → value is replaced; a stated source overrides observed/inferred
 */
export function upsertPreference(input: UpsertPreferenceInput): PreferenceRecord {
  const d = getDb();
  const now = input.confirmedAt ?? Date.now();
  const source = input.source ?? "inferred";
  const baseConfidence = input.confidence ?? (source === "stated" ? 0.9 : 0.5);

  const existing = d
    .prepare("SELECT * FROM preferences WHERE category = ? AND key = ?")
    .get(input.category, input.key) as PreferenceRow | undefined;

  if (!existing) {
    d.prepare(
      `INSERT INTO preferences (category, key, value, source, confidence, evidence_count, last_confirmed)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    ).run(input.category, input.key, input.value, source, clamp(baseConfidence), now);
  } else if (existing.value === input.value) {
    // Same value observed again → reinforce.
    const nextConfidence = clamp(existing.confidence + 0.1 * (1 - existing.confidence));
    const nextSource = source === "stated" ? "stated" : existing.source;
    d.prepare(
      `UPDATE preferences
         SET confidence = ?, evidence_count = evidence_count + 1, source = ?, last_confirmed = ?
       WHERE id = ?`
    ).run(nextConfidence, nextSource, now, existing.id);
  } else {
    // Value changed. A stated preference always wins; otherwise replace and reset to base.
    const overrideWithStated = source === "stated" || existing.source !== "stated";
    if (overrideWithStated) {
      d.prepare(
        `UPDATE preferences
           SET value = ?, source = ?, confidence = ?, evidence_count = 1, last_confirmed = ?
         WHERE id = ?`
      ).run(input.value, source, clamp(baseConfidence), now, existing.id);
    }
  }

  return getPreference(input.category, input.key)!;
}

export function getPreference(
  category: PreferenceCategory,
  key: string
): PreferenceRecord | null {
  const d = getDb();
  const row = d
    .prepare("SELECT * FROM preferences WHERE category = ? AND key = ?")
    .get(category, key) as PreferenceRow | undefined;
  return row ? mapRow(row) : null;
}

export function listPreferences(opts: {
  category?: PreferenceCategory;
  minConfidence?: number;
  limit?: number;
} = {}): PreferenceRecord[] {
  const d = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (opts.category) {
    clauses.push("category = ?");
    params.push(opts.category);
  }
  if (typeof opts.minConfidence === "number") {
    clauses.push("confidence >= ?");
    params.push(opts.minConfidence);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = opts.limit ?? 100;
  const rows = d
    .prepare(
      `SELECT * FROM preferences ${where}
       ORDER BY confidence DESC, evidence_count DESC, last_confirmed DESC
       LIMIT ?`
    )
    .all(...params, limit) as PreferenceRow[];

  return rows.map(mapRow);
}

export function deletePreference(id: number): boolean {
  const d = getDb();
  const result = d.prepare("DELETE FROM preferences WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Decay confidence for preferences not reinforced within `staleDays`.
 * Returns the number of preferences affected. Inferred/observed decay; stated
 * preferences decay more slowly because the user explicitly set them.
 */
export function decayStalePreferences(staleDays = 30, now = Date.now()): number {
  const d = getDb();
  const cutoff = now - staleDays * 24 * 60 * 60 * 1000;
  const stale = d
    .prepare("SELECT * FROM preferences WHERE last_confirmed < ?")
    .all(cutoff) as PreferenceRow[];

  let affected = 0;
  for (const row of stale) {
    const factor = row.source === "stated" ? 0.95 : 0.85;
    const next = clamp(row.confidence * factor);
    d.prepare("UPDATE preferences SET confidence = ? WHERE id = ?").run(next, row.id);
    affected += 1;
  }
  return affected;
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

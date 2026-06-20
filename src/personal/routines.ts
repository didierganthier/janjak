import { getDb } from "../db.js";

export interface RoutinePattern {
  dayOfWeek?: number[]; // 0=Sunday .. 6=Saturday
  timeRange?: { start: number; end: number }; // hours 0-23
  activity?: string;
  [key: string]: unknown;
}

export interface RoutineRecord {
  id: number;
  name: string;
  pattern: RoutinePattern;
  confidence: number;
  observedCount: number;
  lastObserved: number;
}

interface RoutineRow {
  id: number;
  name: string;
  pattern: string;
  confidence: number;
  observed_count: number;
  last_observed: number;
}

function parsePattern(value: string): RoutinePattern {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as RoutinePattern)
      : {};
  } catch {
    return {};
  }
}

function mapRow(row: RoutineRow): RoutineRecord {
  return {
    id: row.id,
    name: row.name,
    pattern: parsePattern(row.pattern),
    confidence: row.confidence,
    observedCount: row.observed_count,
    lastObserved: row.last_observed,
  };
}

export interface UpsertRoutineInput {
  name: string;
  pattern: RoutinePattern;
  confidence?: number;
  observedAt?: number;
}

/**
 * Insert or reinforce a routine keyed by name. Repeated observations raise
 * confidence and bump observed_count; the latest pattern overwrites the prior.
 */
export function upsertRoutine(input: UpsertRoutineInput): RoutineRecord {
  const d = getDb();
  const now = input.observedAt ?? Date.now();
  const patternJson = JSON.stringify(input.pattern ?? {});

  const existing = d
    .prepare("SELECT * FROM routines WHERE name = ?")
    .get(input.name) as RoutineRow | undefined;

  if (!existing) {
    d.prepare(
      `INSERT INTO routines (name, pattern, confidence, observed_count, last_observed)
       VALUES (?, ?, ?, 1, ?)`
    ).run(input.name, patternJson, clamp(input.confidence ?? 0.5), now);
  } else {
    const nextConfidence = clamp(
      input.confidence ?? existing.confidence + 0.1 * (1 - existing.confidence)
    );
    d.prepare(
      `UPDATE routines
         SET pattern = ?, confidence = ?, observed_count = observed_count + 1, last_observed = ?
       WHERE id = ?`
    ).run(patternJson, nextConfidence, now, existing.id);
  }

  return getRoutineByName(input.name)!;
}

export function getRoutineByName(name: string): RoutineRecord | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM routines WHERE name = ?").get(name) as
    | RoutineRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function listRoutines(opts: { minConfidence?: number; limit?: number } = {}): RoutineRecord[] {
  const d = getDb();
  const where = typeof opts.minConfidence === "number" ? "WHERE confidence >= ?" : "";
  const params: unknown[] = [];
  if (typeof opts.minConfidence === "number") params.push(opts.minConfidence);
  const limit = opts.limit ?? 100;
  const rows = d
    .prepare(
      `SELECT * FROM routines ${where}
       ORDER BY confidence DESC, observed_count DESC, last_observed DESC
       LIMIT ?`
    )
    .all(...params, limit) as RoutineRow[];
  return rows.map(mapRow);
}

export function deleteRoutine(id: number): boolean {
  const d = getDb();
  const result = d.prepare("DELETE FROM routines WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Find routines relevant to a given moment (matching day of week and hour). */
export function getRoutinesForMoment(when = new Date()): RoutineRecord[] {
  const day = when.getDay();
  const hour = when.getHours();
  return listRoutines({ minConfidence: 0.4 }).filter((routine) => {
    const { dayOfWeek, timeRange } = routine.pattern;
    if (dayOfWeek && dayOfWeek.length > 0 && !dayOfWeek.includes(day)) return false;
    if (timeRange && (hour < timeRange.start || hour > timeRange.end)) return false;
    return true;
  });
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

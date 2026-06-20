import { getDb } from "../db.js";

export type GoalCategory =
  | "career"
  | "health"
  | "relationship"
  | "project"
  | "learning"
  | "finance";

export const GOAL_CATEGORIES: GoalCategory[] = [
  "career",
  "health",
  "relationship",
  "project",
  "learning",
  "finance",
];

export interface GoalRecord {
  id: number;
  category: GoalCategory;
  description: string;
  priority: number;
  active: boolean;
  targetDate: string | null;
  createdAt: number;
  context: Record<string, unknown>;
}

interface GoalRow {
  id: number;
  category: string;
  description: string;
  priority: number;
  active: number;
  target_date: string | null;
  created_at: number;
  context: string;
}

function parseContext(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapRow(row: GoalRow): GoalRecord {
  return {
    id: row.id,
    category: row.category as GoalCategory,
    description: row.description,
    priority: row.priority,
    active: row.active === 1,
    targetDate: row.target_date,
    createdAt: row.created_at,
    context: parseContext(row.context),
  };
}

export interface AddGoalInput {
  category: GoalCategory;
  description: string;
  priority?: number;
  targetDate?: string | null;
  context?: Record<string, unknown>;
}

export function addGoal(input: AddGoalInput): GoalRecord {
  const d = getDb();
  const priority = clampPriority(input.priority ?? 5);
  const result = d
    .prepare(
      `INSERT INTO goals (category, description, priority, active, target_date, created_at, context)
       VALUES (?, ?, ?, 1, ?, ?, ?)`
    )
    .run(
      input.category,
      input.description,
      priority,
      input.targetDate ?? null,
      Date.now(),
      JSON.stringify(input.context ?? {})
    );
  return getGoal(Number(result.lastInsertRowid))!;
}

export function getGoal(id: number): GoalRecord | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM goals WHERE id = ?").get(id) as GoalRow | undefined;
  return row ? mapRow(row) : null;
}

export function listGoals(opts: { activeOnly?: boolean; limit?: number } = {}): GoalRecord[] {
  const d = getDb();
  const where = opts.activeOnly ? "WHERE active = 1" : "";
  const limit = opts.limit ?? 100;
  const rows = d
    .prepare(
      `SELECT * FROM goals ${where}
       ORDER BY active DESC, priority DESC, created_at DESC
       LIMIT ?`
    )
    .all(limit) as GoalRow[];
  return rows.map(mapRow);
}

export function completeGoal(id: number): boolean {
  const d = getDb();
  const result = d.prepare("UPDATE goals SET active = 0 WHERE id = ?").run(id);
  return result.changes > 0;
}

export function deleteGoal(id: number): boolean {
  const d = getDb();
  const result = d.prepare("DELETE FROM goals WHERE id = ?").run(id);
  return result.changes > 0;
}

function clampPriority(value: number): number {
  if (Number.isNaN(value)) return 5;
  return Math.max(1, Math.min(10, Math.round(value)));
}

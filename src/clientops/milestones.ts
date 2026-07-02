// ─── Janjak ClientOps — Milestones ──────────────────────────────────

import { getDb } from "../db.js";
import { ensureClientOpsSchema } from "./schema.js";
import type { Milestone, MilestoneInput, MilestoneStatus } from "./types.js";

interface MilestoneRow {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  amount: number | null;
  currency: string;
  due_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    dueDate: row.due_date,
    status: row.status as MilestoneStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createMilestone(input: MilestoneInput): Milestone {
  ensureClientOpsSchema();
  const result = getDb()
    .prepare(
      `INSERT INTO project_milestones (project_id, title, description, amount, currency, due_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.projectId,
      input.title,
      input.description ?? null,
      input.amount ?? null,
      input.currency ?? "USD",
      input.dueDate ?? null,
      input.status ?? "pending",
    );
  return getMilestoneById(Number(result.lastInsertRowid))!;
}

export function getMilestoneById(id: number): Milestone | null {
  ensureClientOpsSchema();
  const row = getDb()
    .prepare("SELECT * FROM project_milestones WHERE id = ?")
    .get(id) as MilestoneRow | undefined;
  return row ? mapRow(row) : null;
}

export function listMilestones(projectId: number): Milestone[] {
  ensureClientOpsSchema();
  const rows = getDb()
    .prepare(
      `SELECT * FROM project_milestones WHERE project_id = ?
       ORDER BY CASE status WHEN 'paid' THEN 1 ELSE 0 END, due_date IS NULL, due_date, id`,
    )
    .all(projectId) as MilestoneRow[];
  return rows.map(mapRow);
}

export function setMilestoneStatus(id: number, status: MilestoneStatus): Milestone | null {
  ensureClientOpsSchema();
  const result = getDb()
    .prepare("UPDATE project_milestones SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, id);
  return result.changes > 0 ? getMilestoneById(id) : null;
}

export function deleteMilestone(id: number): boolean {
  ensureClientOpsSchema();
  const result = getDb().prepare("DELETE FROM project_milestones WHERE id = ?").run(id);
  return result.changes > 0;
}

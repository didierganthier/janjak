// ─── Janjak ClientOps — Deliverables ────────────────────────────────

import { getDb } from "../db.js";
import { ensureClientOpsSchema } from "./schema.js";
import type { Deliverable, DeliverableStatus, ProjectPriority } from "./types.js";

interface DeliverableRow {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  status: string;
  due_date: string | null;
  priority: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: DeliverableRow): Deliverable {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status as DeliverableStatus,
    dueDate: row.due_date,
    priority: row.priority as ProjectPriority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface DeliverableInput {
  projectId: number;
  title: string;
  description?: string | null;
  status?: DeliverableStatus;
  dueDate?: string | null;
  priority?: ProjectPriority;
}

export function createDeliverable(input: DeliverableInput): Deliverable {
  ensureClientOpsSchema();
  const result = getDb()
    .prepare(
      `INSERT INTO project_deliverables (project_id, title, description, status, due_date, priority)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.projectId,
      input.title,
      input.description ?? null,
      input.status ?? "not_started",
      input.dueDate ?? null,
      input.priority ?? "medium",
    );
  return getDeliverableById(Number(result.lastInsertRowid))!;
}

export function getDeliverableById(id: number): Deliverable | null {
  ensureClientOpsSchema();
  const row = getDb()
    .prepare("SELECT * FROM project_deliverables WHERE id = ?")
    .get(id) as DeliverableRow | undefined;
  return row ? mapRow(row) : null;
}

export function listDeliverables(projectId: number): Deliverable[] {
  ensureClientOpsSchema();
  const rows = getDb()
    .prepare(
      `SELECT * FROM project_deliverables WHERE project_id = ?
       ORDER BY CASE status WHEN 'done' THEN 1 ELSE 0 END, due_date IS NULL, due_date, id`,
    )
    .all(projectId) as DeliverableRow[];
  return rows.map(mapRow);
}

export function setDeliverableStatus(id: number, status: DeliverableStatus): Deliverable | null {
  ensureClientOpsSchema();
  const result = getDb()
    .prepare("UPDATE project_deliverables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, id);
  return result.changes > 0 ? getDeliverableById(id) : null;
}

export function deleteDeliverable(id: number): boolean {
  ensureClientOpsSchema();
  const result = getDb().prepare("DELETE FROM project_deliverables WHERE id = ?").run(id);
  return result.changes > 0;
}

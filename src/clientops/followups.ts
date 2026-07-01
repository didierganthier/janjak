// ─── Janjak ClientOps — Follow-ups ──────────────────────────────────

import { getDb } from "../db.js";
import { ensureClientOpsSchema } from "./schema.js";
import type { Followup, FollowupStatus } from "./types.js";

interface FollowupRow {
  id: number;
  project_id: number | null;
  client_id: number | null;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
  channel: string | null;
  suggested_message: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: FollowupRow): Followup {
  return {
    id: row.id,
    projectId: row.project_id,
    clientId: row.client_id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    status: row.status as FollowupStatus,
    channel: row.channel,
    suggestedMessage: row.suggested_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface FollowupInput {
  projectId?: number | null;
  clientId?: number | null;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  status?: FollowupStatus;
  channel?: string | null;
  suggestedMessage?: string | null;
}

export function createFollowup(input: FollowupInput): Followup {
  ensureClientOpsSchema();
  const result = getDb()
    .prepare(
      `INSERT INTO client_followups
       (project_id, client_id, title, description, due_date, status, channel, suggested_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.projectId ?? null,
      input.clientId ?? null,
      input.title,
      input.description ?? null,
      input.dueDate ?? null,
      input.status ?? "pending",
      input.channel ?? null,
      input.suggestedMessage ?? null,
    );
  return getFollowupById(Number(result.lastInsertRowid))!;
}

export function getFollowupById(id: number): Followup | null {
  ensureClientOpsSchema();
  const row = getDb()
    .prepare("SELECT * FROM client_followups WHERE id = ?")
    .get(id) as FollowupRow | undefined;
  return row ? mapRow(row) : null;
}

export interface ListFollowupsOptions {
  projectId?: number;
  clientId?: number;
  includeResolved?: boolean;
}

export function listFollowups(opts: ListFollowupsOptions = {}): Followup[] {
  ensureClientOpsSchema();
  const where: string[] = [];
  const values: Array<string | number> = [];
  if (opts.projectId != null) {
    where.push("project_id = ?");
    values.push(opts.projectId);
  }
  if (opts.clientId != null) {
    where.push("client_id = ?");
    values.push(opts.clientId);
  }
  if (!opts.includeResolved) {
    where.push("status = 'pending'");
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(`SELECT * FROM client_followups ${clause} ORDER BY due_date IS NULL, due_date, id`)
    .all(...values) as FollowupRow[];
  return rows.map(mapRow);
}

export function setFollowupStatus(id: number, status: FollowupStatus): Followup | null {
  ensureClientOpsSchema();
  const result = getDb()
    .prepare("UPDATE client_followups SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, id);
  return result.changes > 0 ? getFollowupById(id) : null;
}

export function deleteFollowup(id: number): boolean {
  ensureClientOpsSchema();
  const result = getDb().prepare("DELETE FROM client_followups WHERE id = ?").run(id);
  return result.changes > 0;
}

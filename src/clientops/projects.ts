// ─── Janjak ClientOps — Projects ────────────────────────────────────

import { getDb } from "../db.js";
import { ensureClientOpsSchema } from "./schema.js";
import type {
  ClientProject,
  ProjectInput,
  ProjectPriority,
  ProjectStatus,
  RiskLevel,
} from "./types.js";

interface ProjectRow {
  id: number;
  client_id: number | null;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  budget_amount: number | null;
  budget_currency: string;
  start_date: string | null;
  expected_end_date: string | null;
  last_update_at: string | null;
  next_action: string | null;
  next_action_due_date: string | null;
  risk_level: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ProjectRow): ClientProject {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    description: row.description,
    status: row.status as ProjectStatus,
    priority: row.priority as ProjectPriority,
    budgetAmount: row.budget_amount,
    budgetCurrency: row.budget_currency,
    startDate: row.start_date,
    expectedEndDate: row.expected_end_date,
    lastUpdateAt: row.last_update_at,
    nextAction: row.next_action,
    nextActionDueDate: row.next_action_due_date,
    riskLevel: row.risk_level as RiskLevel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createProject(input: ProjectInput): ClientProject {
  ensureClientOpsSchema();
  const d = getDb();
  const result = d
    .prepare(
      `INSERT INTO client_projects
       (client_id, name, description, status, priority, budget_amount, budget_currency,
        start_date, expected_end_date, next_action, next_action_due_date, risk_level, last_update_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .run(
      input.clientId ?? null,
      input.name,
      input.description ?? null,
      input.status ?? "lead",
      input.priority ?? "medium",
      input.budgetAmount ?? null,
      input.budgetCurrency ?? "USD",
      input.startDate ?? null,
      input.expectedEndDate ?? null,
      input.nextAction ?? null,
      input.nextActionDueDate ?? null,
      input.riskLevel ?? "normal",
    );
  return getProjectById(Number(result.lastInsertRowid))!;
}

export function getProjectById(id: number): ClientProject | null {
  ensureClientOpsSchema();
  const row = getDb()
    .prepare("SELECT * FROM client_projects WHERE id = ?")
    .get(id) as ProjectRow | undefined;
  return row ? mapRow(row) : null;
}

/** Resolve a project by fuzzy name match (case-insensitive). */
export function findProject(query: string): ClientProject | null {
  ensureClientOpsSchema();
  const q = query.trim();
  if (!q) return null;
  const d = getDb();
  const exact = d
    .prepare("SELECT * FROM client_projects WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1")
    .get(q) as ProjectRow | undefined;
  if (exact) return mapRow(exact);
  const partial = d
    .prepare(
      "SELECT * FROM client_projects WHERE name LIKE ? COLLATE NOCASE ORDER BY id LIMIT 1",
    )
    .get(`%${q}%`) as ProjectRow | undefined;
  return partial ? mapRow(partial) : null;
}

export interface ListProjectsOptions {
  clientId?: number;
  includeClosed?: boolean;
}

export function listProjects(opts: ListProjectsOptions = {}): ClientProject[] {
  ensureClientOpsSchema();
  const d = getDb();
  const where: string[] = [];
  const values: Array<string | number> = [];
  if (opts.clientId != null) {
    where.push("client_id = ?");
    values.push(opts.clientId);
  }
  if (!opts.includeClosed) {
    where.push("status NOT IN ('completed', 'cancelled')");
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = d
    .prepare(`SELECT * FROM client_projects ${clause} ORDER BY updated_at DESC`)
    .all(...values) as ProjectRow[];
  return rows.map(mapRow);
}

export function updateProject(id: number, patch: Partial<ProjectInput>): ClientProject | null {
  ensureClientOpsSchema();
  const existing = getProjectById(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  const set = (col: string, val: string | number | null | undefined) => {
    if (val === undefined) return;
    fields.push(`${col} = ?`);
    values.push(val);
  };
  set("client_id", patch.clientId ?? undefined);
  set("name", patch.name);
  set("description", patch.description ?? undefined);
  set("status", patch.status);
  set("priority", patch.priority);
  set("budget_amount", patch.budgetAmount ?? undefined);
  set("budget_currency", patch.budgetCurrency);
  set("start_date", patch.startDate ?? undefined);
  set("expected_end_date", patch.expectedEndDate ?? undefined);
  set("next_action", patch.nextAction ?? undefined);
  set("next_action_due_date", patch.nextActionDueDate ?? undefined);
  set("risk_level", patch.riskLevel);

  if (fields.length === 0) return existing;
  fields.push("updated_at = CURRENT_TIMESTAMP");
  fields.push("last_update_at = CURRENT_TIMESTAMP");
  getDb()
    .prepare(`UPDATE client_projects SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values, id);
  return getProjectById(id);
}

export function setProjectStatus(id: number, status: ProjectStatus): ClientProject | null {
  return updateProject(id, { status });
}

export function setProjectNextAction(
  id: number,
  nextAction: string,
  dueDate?: string | null,
): ClientProject | null {
  return updateProject(id, { nextAction, nextActionDueDate: dueDate ?? null });
}

export function deleteProject(id: number): boolean {
  ensureClientOpsSchema();
  const result = getDb().prepare("DELETE FROM client_projects WHERE id = ?").run(id);
  return result.changes > 0;
}

// ─── Learning Loop: Feedback Capture ────────────────────────────
// Every nudge, autonomous action, suggestion, and workflow run produces
// an outcome. We log those outcomes here so the adaptation pass can make
// Janjak get smarter over time.

import { getDb } from "../db.js";

export type ActionType = "nudge" | "autonomy" | "suggestion" | "workflow" | "alert" | "preference";

export type Outcome = "accepted" | "rejected" | "ignored" | "cancelled" | "expired";

export interface FeedbackRecord {
  id: number;
  actionType: ActionType;
  actionId: string;
  outcome: Outcome;
  context: Record<string, unknown>;
  timestamp: number;
}

interface FeedbackRow {
  id: number;
  action_type: string;
  action_id: string;
  outcome: string;
  context: string;
  timestamp: number;
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

function mapRow(row: FeedbackRow): FeedbackRecord {
  return {
    id: row.id,
    actionType: row.action_type as ActionType,
    actionId: row.action_id,
    outcome: row.outcome as Outcome,
    context: parseContext(row.context),
    timestamp: row.timestamp,
  };
}

export interface RecordFeedbackInput {
  actionType: ActionType;
  actionId: string;
  outcome: Outcome;
  context?: Record<string, unknown>;
  timestamp?: number;
}

/** Log an outcome for an action. Best-effort — never throws to callers. */
export function recordFeedback(input: RecordFeedbackInput): void {
  try {
    const d = getDb();
    d.prepare(
      `INSERT INTO feedback (action_type, action_id, outcome, context, timestamp)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      input.actionType,
      input.actionId,
      input.outcome,
      JSON.stringify(input.context ?? {}),
      input.timestamp ?? Date.now()
    );
  } catch {
    /* feedback logging must never break the primary action */
  }
}

export interface OutcomeStats {
  total: number;
  accepted: number;
  rejected: number;
  ignored: number;
  cancelled: number;
  expired: number;
  acceptanceRate: number; // accepted / total
  rejectionRate: number; // (rejected + cancelled) / total
}

function emptyStats(): OutcomeStats {
  return {
    total: 0,
    accepted: 0,
    rejected: 0,
    ignored: 0,
    cancelled: 0,
    expired: 0,
    acceptanceRate: 0,
    rejectionRate: 0,
  };
}

function statsFromRows(rows: FeedbackRow[]): OutcomeStats {
  const stats = emptyStats();
  for (const row of rows) {
    stats.total += 1;
    switch (row.outcome) {
      case "accepted":
        stats.accepted += 1;
        break;
      case "rejected":
        stats.rejected += 1;
        break;
      case "ignored":
        stats.ignored += 1;
        break;
      case "cancelled":
        stats.cancelled += 1;
        break;
      case "expired":
        stats.expired += 1;
        break;
      default:
        break;
    }
  }
  if (stats.total > 0) {
    stats.acceptanceRate = stats.accepted / stats.total;
    stats.rejectionRate = (stats.rejected + stats.cancelled) / stats.total;
  }
  return stats;
}

/** Outcome stats for a specific action (e.g. a nudge type or workflow id). */
export function getActionStats(
  actionType: ActionType,
  actionId: string,
  opts: { sinceDays?: number } = {}
): OutcomeStats {
  const d = getDb();
  const params: unknown[] = [actionType, actionId];
  let sinceClause = "";
  if (typeof opts.sinceDays === "number") {
    sinceClause = " AND timestamp >= ?";
    params.push(Date.now() - opts.sinceDays * 86400000);
  }
  const rows = d
    .prepare(
      `SELECT * FROM feedback WHERE action_type = ? AND action_id = ?${sinceClause}`
    )
    .all(...params) as FeedbackRow[];
  return statsFromRows(rows);
}

/** Aggregate stats per action type, broken down by action id. */
export function getStatsByType(
  actionType: ActionType,
  opts: { sinceDays?: number } = {}
): Array<{ actionId: string; stats: OutcomeStats }> {
  const d = getDb();
  const params: unknown[] = [actionType];
  let sinceClause = "";
  if (typeof opts.sinceDays === "number") {
    sinceClause = " AND timestamp >= ?";
    params.push(Date.now() - opts.sinceDays * 86400000);
  }
  const rows = d
    .prepare(`SELECT * FROM feedback WHERE action_type = ?${sinceClause}`)
    .all(...params) as FeedbackRow[];

  const byId = new Map<string, FeedbackRow[]>();
  for (const row of rows) {
    if (!byId.has(row.action_id)) byId.set(row.action_id, []);
    byId.get(row.action_id)!.push(row);
  }

  return [...byId.entries()]
    .map(([actionId, group]) => ({ actionId, stats: statsFromRows(group) }))
    .sort((a, b) => b.stats.total - a.stats.total);
}

/** Overall stats grouped by action type, for the `janjak feedback` summary. */
export function getOverallStats(opts: { sinceDays?: number } = {}): Array<{
  actionType: ActionType;
  stats: OutcomeStats;
}> {
  const d = getDb();
  const params: unknown[] = [];
  let sinceClause = "";
  if (typeof opts.sinceDays === "number") {
    sinceClause = " WHERE timestamp >= ?";
    params.push(Date.now() - opts.sinceDays * 86400000);
  }
  const rows = d
    .prepare(`SELECT * FROM feedback${sinceClause}`)
    .all(...params) as FeedbackRow[];

  const byType = new Map<string, FeedbackRow[]>();
  for (const row of rows) {
    if (!byType.has(row.action_type)) byType.set(row.action_type, []);
    byType.get(row.action_type)!.push(row);
  }

  return [...byType.entries()]
    .map(([actionType, group]) => ({
      actionType: actionType as ActionType,
      stats: statsFromRows(group),
    }))
    .sort((a, b) => b.stats.total - a.stats.total);
}

export function getRecentFeedback(limit = 20): FeedbackRecord[] {
  const d = getDb();
  const rows = d
    .prepare("SELECT * FROM feedback ORDER BY timestamp DESC LIMIT ?")
    .all(limit) as FeedbackRow[];
  return rows.map(mapRow);
}

/** Human-readable summary for `janjak feedback`. */
export function formatFeedbackReport(opts: { sinceDays?: number } = {}): string {
  const overall = getOverallStats(opts);
  const windowLabel = opts.sinceDays ? ` (last ${opts.sinceDays}d)` : "";

  if (overall.length === 0) {
    return `\n📊 Feedback${windowLabel}\n\n  No feedback captured yet. Janjak learns as you use it.\n`;
  }

  const lines: string[] = [`\n📊 Feedback${windowLabel}`, "─".repeat(40)];
  for (const { actionType, stats } of overall) {
    lines.push(
      `\n  ${actionType}  —  ${stats.total} events`,
      `    ✅ accept ${(stats.acceptanceRate * 100).toFixed(0)}%   ` +
        `❌ reject ${(stats.rejectionRate * 100).toFixed(0)}%   ` +
        `💤 ignored ${stats.ignored}`
    );
    const byId = getStatsByType(actionType, opts).slice(0, 5);
    for (const { actionId, stats: s } of byId) {
      lines.push(
        `      • ${actionId.padEnd(28)} ${s.total}x  ` +
          `accept ${(s.acceptanceRate * 100).toFixed(0)}%  reject ${(s.rejectionRate * 100).toFixed(0)}%`
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

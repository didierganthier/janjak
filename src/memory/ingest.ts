// ─── Memory: backfill ingestion ────────────────────────────────
// Embeds existing data (tasks, sessions) into the semantic memory store.
// Idempotent: skips rows whose (type, sourceId) is already present.

import { getDb } from "../db.js";
import { embed } from "./embeddings.js";
import { insertMemory, type MemoryType } from "./vector-store.js";
import { ensureClientOpsSchema } from "../clientops/schema.js";

export interface IngestProgress {
  type: MemoryType;
  scanned: number;
  inserted: number;
  skipped: number;
}

interface TaskRow {
  id: number;
  title: string;
  description: string;
  priority: string;
  deadline: string | null;
  person: string;
  source_subject: string;
  status: string;
  created_at: number;
}

interface SessionRow {
  id: number;
  timestamp: number;
  activity: string;
  focus_mode: string;
  app_name: string;
  duration_minutes: number;
}

function existingSourceIds(type: MemoryType): Set<string> {
  const db = getDb();
  const rows = db
    .prepare("SELECT source_id FROM memory WHERE type = ? AND source_id IS NOT NULL")
    .all(type) as Array<{ source_id: string }>;
  return new Set(rows.map((r) => r.source_id));
}

async function ingestTasks(limit: number): Promise<IngestProgress> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, description, priority, deadline, person, source_subject, status, created_at
       FROM tasks ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as TaskRow[];

  const already = existingSourceIds("task");
  const progress: IngestProgress = { type: "task", scanned: rows.length, inserted: 0, skipped: 0 };

  for (const row of rows) {
    const key = String(row.id);
    if (already.has(key)) {
      progress.skipped++;
      continue;
    }
    const text = `Task: ${row.title}${row.deadline ? `\nDeadline: ${row.deadline}` : ""}\nPriority: ${row.priority}${row.person ? `\nPerson: ${row.person}` : ""}${row.source_subject ? `\nSource: ${row.source_subject}` : ""}${row.description ? `\n${row.description}` : ""}`;
    try {
      const vec = await embed(text);
      insertMemory({
        type: "task",
        text,
        embedding: vec,
        sourceId: key,
        metadata: { priority: row.priority, person: row.person, status: row.status },
        timestamp: row.created_at,
        importance: row.priority === "high" ? 0.8 : 0.6,
      });
      progress.inserted++;
    } catch {
      // skip on failure
    }
  }
  return progress;
}

async function ingestSessions(daysBack: number, minMinutes: number): Promise<IngestProgress> {
  const db = getDb();
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const rows = db
    .prepare(
      `SELECT id, timestamp, activity, focus_mode, app_name, duration_minutes
       FROM sessions
       WHERE timestamp >= ? AND duration_minutes >= ?
       ORDER BY timestamp DESC`
    )
    .all(cutoff, minMinutes) as SessionRow[];

  const already = existingSourceIds("session");
  const progress: IngestProgress = { type: "session", scanned: rows.length, inserted: 0, skipped: 0 };

  for (const row of rows) {
    const key = String(row.id);
    if (already.has(key)) {
      progress.skipped++;
      continue;
    }
    const when = new Date(row.timestamp).toISOString().slice(0, 16).replace("T", " ");
    const text = `${when}: ${row.activity} in ${row.app_name} for ${Math.round(row.duration_minutes)} min (${row.focus_mode})`;
    try {
      const vec = await embed(text);
      insertMemory({
        type: "session",
        text,
        embedding: vec,
        sourceId: key,
        metadata: { activity: row.activity, app: row.app_name, focus: row.focus_mode },
        timestamp: row.timestamp,
        importance: 0.3,
      });
      progress.inserted++;
    } catch {
      // skip
    }
  }
  return progress;
}

interface ClientOpsNoteRow {
  id: number;
  project_id: number | null;
  client_id: number | null;
  title: string | null;
  body: string;
  note_type: string;
  source: string | null;
  created_at: string;
  project_name: string | null;
  client_name: string | null;
  client_org: string | null;
}

/** Parse a ClientOps TEXT timestamp (CURRENT_TIMESTAMP form) to epoch millis. */
function parseClientOpsTimestamp(ts: string | null): number {
  if (!ts) return Date.now();
  // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC.
  const parsed = Date.parse(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

const IMPORTANT_NOTE_TYPES = new Set(["risk", "decision", "scope_change", "payment_note"]);

async function ingestClientOpsNotes(limit: number): Promise<IngestProgress> {
  ensureClientOpsSchema();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT n.id, n.project_id, n.client_id, n.title, n.body, n.note_type, n.source, n.created_at,
              p.name AS project_name, c.name AS client_name, c.organization AS client_org
       FROM project_notes n
       LEFT JOIN client_projects p ON p.id = n.project_id
       LEFT JOIN clients c ON c.id = n.client_id
       ORDER BY n.created_at DESC LIMIT ?`
    )
    .all(limit) as ClientOpsNoteRow[];

  const already = existingSourceIds("note");
  const progress: IngestProgress = { type: "note", scanned: rows.length, inserted: 0, skipped: 0 };

  for (const row of rows) {
    const key = `clientops-note:${row.id}`;
    if (already.has(key)) {
      progress.skipped++;
      continue;
    }
    const who = row.client_org
      ? `${row.client_name} (${row.client_org})`
      : row.client_name ?? "";
    const header = [
      row.project_name ? `Project: ${row.project_name}` : "",
      who ? `Client: ${who}` : "",
      `Type: ${row.note_type}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const text = `${header}\n${row.title ? row.title + "\n" : ""}${row.body}`.trim();
    try {
      const vec = await embed(text);
      insertMemory({
        type: "note",
        text,
        embedding: vec,
        sourceId: key,
        metadata: {
          noteType: row.note_type,
          projectId: row.project_id,
          clientId: row.client_id,
          source: "clientops",
        },
        timestamp: parseClientOpsTimestamp(row.created_at),
        importance: IMPORTANT_NOTE_TYPES.has(row.note_type) ? 0.75 : 0.55,
      });
      progress.inserted++;
    } catch {
      // skip on failure
    }
  }
  return progress;
}

export interface IngestOptions {
  taskLimit?: number;
  sessionDays?: number;
  sessionMinMinutes?: number;
  includeTasks?: boolean;
  includeSessions?: boolean;
  includeClientOps?: boolean;
  clientOpsLimit?: number;
}

export async function ingestAll(opts: IngestOptions = {}): Promise<IngestProgress[]> {
  const {
    taskLimit = 500,
    sessionDays = 30,
    sessionMinMinutes = 5,
    includeTasks = true,
    includeSessions = true,
    includeClientOps = true,
    clientOpsLimit = 500,
  } = opts;

  const results: IngestProgress[] = [];
  if (includeTasks) results.push(await ingestTasks(taskLimit));
  if (includeSessions) results.push(await ingestSessions(sessionDays, sessionMinMinutes));
  if (includeClientOps) results.push(await ingestClientOpsNotes(clientOpsLimit));
  return results;
}

export function formatIngestReport(results: IngestProgress[]): string {
  const lines: string[] = ["", "🧠 Ingest complete", ""];
  let totalIn = 0;
  let totalSkip = 0;
  for (const r of results) {
    lines.push(
      `  ${r.type.padEnd(10)} scanned=${r.scanned}  inserted=${r.inserted}  skipped=${r.skipped}`
    );
    totalIn += r.inserted;
    totalSkip += r.skipped;
  }
  lines.push("", `  Total inserted: ${totalIn}  ·  skipped (already present): ${totalSkip}`, "");
  return lines.join("\n");
}

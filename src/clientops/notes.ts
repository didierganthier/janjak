// ─── Janjak ClientOps — Notes ───────────────────────────────────────

import { getDb } from "../db.js";
import { ensureClientOpsSchema } from "./schema.js";
import type { NoteType, ProjectNote } from "./types.js";

interface NoteRow {
  id: number;
  project_id: number | null;
  client_id: number | null;
  title: string | null;
  body: string;
  source: string | null;
  note_type: string;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: NoteRow): ProjectNote {
  return {
    id: row.id,
    projectId: row.project_id,
    clientId: row.client_id,
    title: row.title,
    body: row.body,
    source: row.source,
    noteType: row.note_type as NoteType,
    sourceRef: row.source_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface NoteInput {
  projectId?: number | null;
  clientId?: number | null;
  title?: string | null;
  body: string;
  source?: string | null;
  noteType?: NoteType;
  sourceRef?: string | null;
}

export function createNote(input: NoteInput): ProjectNote {
  ensureClientOpsSchema();
  const result = getDb()
    .prepare(
      `INSERT INTO project_notes (project_id, client_id, title, body, source, note_type, source_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.projectId ?? null,
      input.clientId ?? null,
      input.title ?? null,
      input.body,
      input.source ?? null,
      input.noteType ?? "general",
      input.sourceRef ?? null,
    );
  return getNoteById(Number(result.lastInsertRowid))!;
}

export function getNoteById(id: number): ProjectNote | null {
  ensureClientOpsSchema();
  const row = getDb()
    .prepare("SELECT * FROM project_notes WHERE id = ?")
    .get(id) as NoteRow | undefined;
  return row ? mapRow(row) : null;
}

export interface ListNotesOptions {
  projectId?: number;
  clientId?: number;
  noteType?: NoteType;
  limit?: number;
}

export function listNotes(opts: ListNotesOptions = {}): ProjectNote[] {
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
  if (opts.noteType) {
    where.push("note_type = ?");
    values.push(opts.noteType);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = opts.limit ?? 50;
  const rows = getDb()
    .prepare(`SELECT * FROM project_notes ${clause} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...values, limit) as NoteRow[];
  return rows.map(mapRow);
}

/** Whether a note already exists for a given external source reference. */
export function noteExistsBySourceRef(sourceRef: string): boolean {
  ensureClientOpsSchema();
  const row = getDb()
    .prepare("SELECT 1 FROM project_notes WHERE source_ref = ? LIMIT 1")
    .get(sourceRef) as { 1: number } | undefined;
  return row != null;
}

export function deleteNote(id: number): boolean {
  ensureClientOpsSchema();
  const result = getDb().prepare("DELETE FROM project_notes WHERE id = ?").run(id);
  return result.changes > 0;
}

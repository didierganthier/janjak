// ─── Janjak ClientOps — Documents ───────────────────────────────────

import { getDb } from "../db.js";
import { ensureClientOpsSchema } from "./schema.js";
import type { DocumentInput, DocumentStatus, ProjectDocument } from "./types.js";

interface DocumentRow {
  id: number;
  project_id: number | null;
  client_id: number | null;
  title: string;
  document_type: string | null;
  content: string | null;
  file_path: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: DocumentRow): ProjectDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    clientId: row.client_id,
    title: row.title,
    documentType: row.document_type,
    content: row.content,
    filePath: row.file_path,
    status: row.status as DocumentStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDocument(input: DocumentInput): ProjectDocument {
  ensureClientOpsSchema();
  const result = getDb()
    .prepare(
      `INSERT INTO project_documents (project_id, client_id, title, document_type, content, file_path, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.projectId ?? null,
      input.clientId ?? null,
      input.title,
      input.documentType ?? null,
      input.content ?? null,
      input.filePath ?? null,
      input.status ?? "draft",
    );
  return getDocumentById(Number(result.lastInsertRowid))!;
}

export function getDocumentById(id: number): ProjectDocument | null {
  ensureClientOpsSchema();
  const row = getDb()
    .prepare("SELECT * FROM project_documents WHERE id = ?")
    .get(id) as DocumentRow | undefined;
  return row ? mapRow(row) : null;
}

export interface ListDocumentsOptions {
  projectId?: number;
  clientId?: number;
}

export function listDocuments(opts: ListDocumentsOptions = {}): ProjectDocument[] {
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
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(`SELECT * FROM project_documents ${clause} ORDER BY updated_at DESC, id DESC`)
    .all(...values) as DocumentRow[];
  return rows.map(mapRow);
}

export function setDocumentStatus(id: number, status: DocumentStatus): ProjectDocument | null {
  ensureClientOpsSchema();
  const result = getDb()
    .prepare("UPDATE project_documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, id);
  return result.changes > 0 ? getDocumentById(id) : null;
}

export function deleteDocument(id: number): boolean {
  ensureClientOpsSchema();
  const result = getDb().prepare("DELETE FROM project_documents WHERE id = ?").run(id);
  return result.changes > 0;
}

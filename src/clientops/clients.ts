// ─── Janjak ClientOps — Clients ─────────────────────────────────────

import { getDb } from "../db.js";
import { ensureClientOpsSchema } from "./schema.js";
import type { Client, ClientInput, ClientStatus } from "./types.js";

interface ClientRow {
  id: number;
  name: string;
  organization: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  preferred_channel: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    organization: row.organization,
    email: row.email,
    phone: row.phone,
    whatsapp: row.whatsapp,
    preferredChannel: row.preferred_channel,
    notes: row.notes,
    status: row.status as ClientStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createClient(input: ClientInput): Client {
  ensureClientOpsSchema();
  const d = getDb();
  const result = d
    .prepare(
      `INSERT INTO clients (name, organization, email, phone, whatsapp, preferred_channel, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.organization ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.whatsapp ?? null,
      input.preferredChannel ?? null,
      input.notes ?? null,
      input.status ?? "active",
    );
  return getClientById(Number(result.lastInsertRowid))!;
}

export function getClientById(id: number): Client | null {
  ensureClientOpsSchema();
  const row = getDb().prepare("SELECT * FROM clients WHERE id = ?").get(id) as ClientRow | undefined;
  return row ? mapRow(row) : null;
}

/** Resolve a client by fuzzy name/organization match (case-insensitive). */
export function findClient(query: string): Client | null {
  ensureClientOpsSchema();
  const q = query.trim();
  if (!q) return null;
  const d = getDb();
  // Exact (case-insensitive) name first, then organization, then partial.
  const exact = d
    .prepare("SELECT * FROM clients WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1")
    .get(q) as ClientRow | undefined;
  if (exact) return mapRow(exact);
  const like = `%${q}%`;
  const partial = d
    .prepare(
      `SELECT * FROM clients
       WHERE name LIKE ? COLLATE NOCASE OR organization LIKE ? COLLATE NOCASE
       ORDER BY id LIMIT 1`,
    )
    .get(like, like) as ClientRow | undefined;
  return partial ? mapRow(partial) : null;
}

/** Resolve a client by exact email address (case-insensitive). */
export function findClientByEmail(email: string): Client | null {
  ensureClientOpsSchema();
  const addr = email.trim();
  if (!addr) return null;
  const row = getDb()
    .prepare("SELECT * FROM clients WHERE email = ? COLLATE NOCASE ORDER BY id LIMIT 1")
    .get(addr) as ClientRow | undefined;
  return row ? mapRow(row) : null;
}

export function listClients(opts: { includeArchived?: boolean } = {}): Client[] {
  ensureClientOpsSchema();
  const d = getDb();
  const rows = opts.includeArchived
    ? (d.prepare("SELECT * FROM clients ORDER BY name COLLATE NOCASE").all() as ClientRow[])
    : (d
        .prepare("SELECT * FROM clients WHERE status != 'archived' ORDER BY name COLLATE NOCASE")
        .all() as ClientRow[]);
  return rows.map(mapRow);
}

export function updateClient(id: number, patch: Partial<ClientInput>): Client | null {
  ensureClientOpsSchema();
  const existing = getClientById(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: Array<string | null> = [];
  const set = (col: string, val: string | null | undefined) => {
    if (val === undefined) return;
    fields.push(`${col} = ?`);
    values.push(val);
  };
  set("name", patch.name);
  set("organization", patch.organization ?? undefined);
  set("email", patch.email ?? undefined);
  set("phone", patch.phone ?? undefined);
  set("whatsapp", patch.whatsapp ?? undefined);
  set("preferred_channel", patch.preferredChannel ?? undefined);
  set("notes", patch.notes ?? undefined);
  set("status", patch.status);

  if (fields.length === 0) return existing;
  fields.push("updated_at = CURRENT_TIMESTAMP");
  getDb()
    .prepare(`UPDATE clients SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values, id);
  return getClientById(id);
}

export function deleteClient(id: number): boolean {
  ensureClientOpsSchema();
  const result = getDb().prepare("DELETE FROM clients WHERE id = ?").run(id);
  return result.changes > 0;
}

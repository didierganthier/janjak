// ─── Janjak ClientOps — Payments ────────────────────────────────────

import { getDb } from "../db.js";
import { ensureClientOpsSchema } from "./schema.js";
import type { Payment, PaymentStatus } from "./types.js";

interface PaymentRow {
  id: number;
  project_id: number | null;
  client_id: number | null;
  amount: number;
  currency: string;
  due_date: string | null;
  paid_date: string | null;
  status: string;
  invoice_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: PaymentRow): Payment {
  return {
    id: row.id,
    projectId: row.project_id,
    clientId: row.client_id,
    amount: row.amount,
    currency: row.currency,
    dueDate: row.due_date,
    paidDate: row.paid_date,
    status: row.status as PaymentStatus,
    invoicePath: row.invoice_path,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface PaymentInput {
  projectId?: number | null;
  clientId?: number | null;
  amount: number;
  currency?: string;
  dueDate?: string | null;
  status?: PaymentStatus;
  invoicePath?: string | null;
  notes?: string | null;
}

export function createPayment(input: PaymentInput): Payment {
  ensureClientOpsSchema();
  const result = getDb()
    .prepare(
      `INSERT INTO client_payments
       (project_id, client_id, amount, currency, due_date, status, invoice_path, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.projectId ?? null,
      input.clientId ?? null,
      input.amount,
      input.currency ?? "USD",
      input.dueDate ?? null,
      input.status ?? "draft",
      input.invoicePath ?? null,
      input.notes ?? null,
    );
  return getPaymentById(Number(result.lastInsertRowid))!;
}

export function getPaymentById(id: number): Payment | null {
  ensureClientOpsSchema();
  const row = getDb()
    .prepare("SELECT * FROM client_payments WHERE id = ?")
    .get(id) as PaymentRow | undefined;
  return row ? mapRow(row) : null;
}

export interface ListPaymentsOptions {
  projectId?: number;
  clientId?: number;
  status?: PaymentStatus;
}

export function listPayments(opts: ListPaymentsOptions = {}): Payment[] {
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
  if (opts.status) {
    where.push("status = ?");
    values.push(opts.status);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(`SELECT * FROM client_payments ${clause} ORDER BY due_date IS NULL, due_date, id`)
    .all(...values) as PaymentRow[];
  return rows.map(mapRow);
}

/** Outstanding payments (not paid/cancelled), soonest due first. */
export function listOutstandingPayments(): Payment[] {
  ensureClientOpsSchema();
  const rows = getDb()
    .prepare(
      `SELECT * FROM client_payments
       WHERE status NOT IN ('paid', 'cancelled')
       ORDER BY due_date IS NULL, due_date, id`,
    )
    .all() as PaymentRow[];
  return rows.map(mapRow);
}

export function markPaymentPaid(id: number, paidDate?: string): Payment | null {
  ensureClientOpsSchema();
  const when = paidDate ?? new Date().toISOString().slice(0, 10);
  const result = getDb()
    .prepare(
      "UPDATE client_payments SET status = 'paid', paid_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .run(when, id);
  return result.changes > 0 ? getPaymentById(id) : null;
}

export function setPaymentStatus(id: number, status: PaymentStatus): Payment | null {
  ensureClientOpsSchema();
  const result = getDb()
    .prepare("UPDATE client_payments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, id);
  return result.changes > 0 ? getPaymentById(id) : null;
}

export function deletePayment(id: number): boolean {
  ensureClientOpsSchema();
  const result = getDb().prepare("DELETE FROM client_payments WHERE id = ?").run(id);
  return result.changes > 0;
}

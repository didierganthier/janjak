// ─── Janjak ClientOps — schema/migrations ───────────────────────────
// Creates the ClientOps tables inside Janjak's existing SQLite database.
// Idempotent: runs `CREATE TABLE IF NOT EXISTS` once per process.

import { getDb } from "../db.js";

let ensured = false;

/** Ensure all ClientOps tables exist. Cheap + idempotent; call before any query. */
export function ensureClientOpsSchema(): void {
  if (ensured) return;
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      organization TEXT,
      email TEXT,
      phone TEXT,
      whatsapp TEXT,
      preferred_channel TEXT,
      notes TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS client_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'lead',
      priority TEXT DEFAULT 'medium',
      budget_amount REAL,
      budget_currency TEXT DEFAULT 'USD',
      start_date TEXT,
      expected_end_date TEXT,
      last_update_at TEXT,
      next_action TEXT,
      next_action_due_date TEXT,
      risk_level TEXT DEFAULT 'normal',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS project_deliverables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'not_started',
      due_date TEXT,
      priority TEXT DEFAULT 'medium',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES client_projects(id)
    );

    CREATE TABLE IF NOT EXISTS project_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      amount REAL,
      currency TEXT DEFAULT 'USD',
      due_date TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES client_projects(id)
    );

    CREATE TABLE IF NOT EXISTS client_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      client_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      due_date TEXT,
      paid_date TEXT,
      status TEXT DEFAULT 'draft',
      invoice_path TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES client_projects(id),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS project_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      client_id INTEGER,
      title TEXT,
      body TEXT NOT NULL,
      source TEXT,
      note_type TEXT DEFAULT 'general',
      source_ref TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES client_projects(id),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS project_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      client_id INTEGER,
      title TEXT NOT NULL,
      document_type TEXT,
      content TEXT,
      file_path TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES client_projects(id),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS client_followups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      client_id INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      status TEXT DEFAULT 'pending',
      channel TEXT,
      suggested_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES client_projects(id),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
    CREATE INDEX IF NOT EXISTS idx_client_projects_client ON client_projects(client_id);
    CREATE INDEX IF NOT EXISTS idx_client_projects_status ON client_projects(status);
    CREATE INDEX IF NOT EXISTS idx_deliverables_project ON project_deliverables(project_id);
    CREATE INDEX IF NOT EXISTS idx_milestones_project ON project_milestones(project_id);
    CREATE INDEX IF NOT EXISTS idx_payments_project ON client_payments(project_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON client_payments(status);
    CREATE INDEX IF NOT EXISTS idx_notes_project ON project_notes(project_id);
    CREATE INDEX IF NOT EXISTS idx_notes_client ON project_notes(client_id);
    CREATE INDEX IF NOT EXISTS idx_documents_project ON project_documents(project_id);
    CREATE INDEX IF NOT EXISTS idx_followups_status ON client_followups(status);
    CREATE INDEX IF NOT EXISTS idx_followups_client ON client_followups(client_id);
  `);

  ensured = true;
}

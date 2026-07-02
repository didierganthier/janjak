// ─── Janjak ClientOps — domain types ────────────────────────────────
// Structured business objects layered on top of Janjak's SQLite store.
// Everything here is Phase 1 (structured data only — no AI).

// ── Clients ──────────────────────────────────────────────────────
export type ClientStatus = "active" | "inactive" | "archived";

export interface Client {
  id: number;
  name: string;
  organization: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  preferredChannel: string | null;
  notes: string | null;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ClientInput {
  name: string;
  organization?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  preferredChannel?: string | null;
  notes?: string | null;
  status?: ClientStatus;
}

// ── Projects ─────────────────────────────────────────────────────
export type ProjectStatus =
  | "lead"
  | "proposal_drafting"
  | "proposal_sent"
  | "awaiting_feedback"
  | "in_progress"
  | "waiting_on_client"
  | "payment_pending"
  | "paused"
  | "completed"
  | "cancelled";

export const PROJECT_STATUSES: ProjectStatus[] = [
  "lead",
  "proposal_drafting",
  "proposal_sent",
  "awaiting_feedback",
  "in_progress",
  "waiting_on_client",
  "payment_pending",
  "paused",
  "completed",
  "cancelled",
];

export type ProjectPriority = "low" | "medium" | "high" | "urgent";
export const PROJECT_PRIORITIES: ProjectPriority[] = ["low", "medium", "high", "urgent"];

export type RiskLevel = "low" | "normal" | "elevated" | "high";
export const RISK_LEVELS: RiskLevel[] = ["low", "normal", "elevated", "high"];

export interface ClientProject {
  id: number;
  clientId: number | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  budgetAmount: number | null;
  budgetCurrency: string;
  startDate: string | null;
  expectedEndDate: string | null;
  lastUpdateAt: string | null;
  nextAction: string | null;
  nextActionDueDate: string | null;
  riskLevel: RiskLevel;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInput {
  clientId?: number | null;
  name: string;
  description?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  budgetAmount?: number | null;
  budgetCurrency?: string;
  startDate?: string | null;
  expectedEndDate?: string | null;
  nextAction?: string | null;
  nextActionDueDate?: string | null;
  riskLevel?: RiskLevel;
}

// ── Deliverables ─────────────────────────────────────────────────
export type DeliverableStatus = "not_started" | "in_progress" | "blocked" | "done";
export const DELIVERABLE_STATUSES: DeliverableStatus[] = [
  "not_started",
  "in_progress",
  "blocked",
  "done",
];

export interface Deliverable {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  status: DeliverableStatus;
  dueDate: string | null;
  priority: ProjectPriority;
  createdAt: string;
  updatedAt: string;
}

// ── Payments ─────────────────────────────────────────────────────
export type PaymentStatus = "draft" | "sent" | "due_soon" | "overdue" | "paid" | "cancelled";
export const PAYMENT_STATUSES: PaymentStatus[] = [
  "draft",
  "sent",
  "due_soon",
  "overdue",
  "paid",
  "cancelled",
];

export interface Payment {
  id: number;
  projectId: number | null;
  clientId: number | null;
  amount: number;
  currency: string;
  dueDate: string | null;
  paidDate: string | null;
  status: PaymentStatus;
  invoicePath: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Notes ────────────────────────────────────────────────────────
export type NoteType =
  | "meeting_note"
  | "client_message"
  | "decision"
  | "scope_change"
  | "risk"
  | "payment_note"
  | "technical_note"
  | "proposal_note"
  | "general";

export const NOTE_TYPES: NoteType[] = [
  "meeting_note",
  "client_message",
  "decision",
  "scope_change",
  "risk",
  "payment_note",
  "technical_note",
  "proposal_note",
  "general",
];

export interface ProjectNote {
  id: number;
  projectId: number | null;
  clientId: number | null;
  title: string | null;
  body: string;
  source: string | null;
  noteType: NoteType;
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Follow-ups ───────────────────────────────────────────────────
export type FollowupStatus = "pending" | "done" | "dismissed";
export const FOLLOWUP_STATUSES: FollowupStatus[] = ["pending", "done", "dismissed"];

export interface Followup {
  id: number;
  projectId: number | null;
  clientId: number | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: FollowupStatus;
  channel: string | null;
  suggestedMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Milestones ───────────────────────────────────────────────────
export type MilestoneStatus = "pending" | "reached" | "invoiced" | "paid";
export const MILESTONE_STATUSES: MilestoneStatus[] = ["pending", "reached", "invoiced", "paid"];

export interface Milestone {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  amount: number | null;
  currency: string;
  dueDate: string | null;
  status: MilestoneStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneInput {
  projectId: number;
  title: string;
  description?: string | null;
  amount?: number | null;
  currency?: string;
  dueDate?: string | null;
  status?: MilestoneStatus;
}

// ── Documents ────────────────────────────────────────────────────
export type DocumentStatus = "draft" | "sent" | "signed" | "archived";
export const DOCUMENT_STATUSES: DocumentStatus[] = ["draft", "sent", "signed", "archived"];

export interface ProjectDocument {
  id: number;
  projectId: number | null;
  clientId: number | null;
  title: string;
  documentType: string | null;
  content: string | null;
  filePath: string | null;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentInput {
  projectId?: number | null;
  clientId?: number | null;
  title: string;
  documentType?: string | null;
  content?: string | null;
  filePath?: string | null;
  status?: DocumentStatus;
}


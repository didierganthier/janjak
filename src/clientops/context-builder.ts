// ─── Janjak ClientOps — context builder ─────────────────────────────
// Assembles the full structured picture of a project (client, deliverables,
// payments, notes, follow-ups) into a compact text block for AI prompts.

import type {
  Client,
  ClientProject,
  Deliverable,
  Payment,
  ProjectNote,
  Followup,
} from "./types.js";
import { getProjectById } from "./projects.js";
import { getClientById } from "./clients.js";
import { listDeliverables } from "./deliverables.js";
import { listPayments } from "./payments.js";
import { listNotes } from "./notes.js";
import { listFollowups } from "./followups.js";
import { formatMoney, isOverdue, daysUntil } from "./util.js";

export interface ProjectContext {
  project: ClientProject;
  client: Client | null;
  deliverables: Deliverable[];
  payments: Payment[];
  notes: ProjectNote[];
  followups: Followup[];
}

/** Gather everything Janjak knows about a project. */
export function buildProjectContext(projectId: number): ProjectContext | null {
  const project = getProjectById(projectId);
  if (!project) return null;

  const client = project.clientId != null ? getClientById(project.clientId) : null;
  const deliverables = listDeliverables(projectId);
  const payments = listPayments({ projectId });
  const notes = listNotes({ projectId, limit: 12 });
  const followups = listFollowups({ projectId, includeResolved: false });

  return { project, client, deliverables, payments, notes, followups };
}

function dueTag(dueDate: string | null): string {
  if (!dueDate) return "";
  const d = daysUntil(dueDate);
  if (d == null) return ` (due ${dueDate})`;
  if (d < 0) return ` (OVERDUE ${Math.abs(d)}d, due ${dueDate})`;
  if (d === 0) return ` (due today)`;
  if (d === 1) return ` (due tomorrow)`;
  return ` (due in ${d}d, ${dueDate})`;
}

/** Render a ProjectContext as a text block suitable for a prompt. */
export function formatProjectContext(ctx: ProjectContext): string {
  const { project, client, deliverables, payments, notes, followups } = ctx;
  const lines: string[] = [];

  lines.push(`PROJECT: ${project.name}`);
  lines.push(`Client: ${client ? client.name + (client.organization ? ` (${client.organization})` : "") : "unassigned"}`);
  if (client?.preferredChannel) lines.push(`Preferred channel: ${client.preferredChannel}`);
  lines.push(`Status: ${project.status} | Priority: ${project.priority} | Risk: ${project.riskLevel}`);
  if (project.budgetAmount != null) {
    lines.push(`Budget: ${formatMoney(project.budgetAmount, project.budgetCurrency)}`);
  }
  if (project.startDate || project.expectedEndDate) {
    lines.push(`Timeline: ${project.startDate ?? "?"} → ${project.expectedEndDate ?? "?"}`);
  }
  if (project.description) lines.push(`Description: ${project.description}`);
  if (project.nextAction) {
    lines.push(`Current next action: ${project.nextAction}${dueTag(project.nextActionDueDate)}`);
  }
  if (project.lastUpdateAt) lines.push(`Last update: ${project.lastUpdateAt}`);

  if (deliverables.length) {
    lines.push("");
    lines.push("DELIVERABLES:");
    for (const d of deliverables) {
      const mark = d.status === "done" ? "✓" : d.status === "blocked" ? "✗" : "○";
      lines.push(`  ${mark} ${d.title} — ${d.status}${dueTag(d.dueDate)}`);
    }
  }

  if (payments.length) {
    lines.push("");
    lines.push("PAYMENTS:");
    for (const p of payments) {
      const overdue = p.status !== "paid" && p.status !== "cancelled" && isOverdue(p.dueDate);
      lines.push(
        `  ${formatMoney(p.amount, p.currency)} — ${p.status}${overdue ? " [OVERDUE]" : ""}${dueTag(p.dueDate)}`
      );
    }
  }

  if (followups.length) {
    lines.push("");
    lines.push("OPEN FOLLOW-UPS:");
    for (const f of followups) {
      lines.push(`  ${f.title}${dueTag(f.dueDate)}${f.channel ? ` via ${f.channel}` : ""}`);
    }
  }

  if (notes.length) {
    lines.push("");
    lines.push("RECENT NOTES (newest first):");
    for (const n of notes) {
      const head = n.title ? `${n.title}: ` : "";
      lines.push(`  [${n.noteType}] ${head}${n.body}`.slice(0, 300));
    }
  }

  return lines.join("\n");
}

// ─── Janjak ClientOps — email/calendar linking (Phase 4) ────────────
// Connects incoming Gmail/Calendar signals to known clients & projects.
// Local + idempotent: matched emails are logged as client_message notes,
// deduplicated by their Gmail message id. No external writes, no auto-send.

import type { EmailMessage } from "../types.js";
import type { Client, ClientProject } from "./types.js";
import { findClientByEmail } from "./clients.js";
import { listProjects } from "./projects.js";
import { createNote, noteExistsBySourceRef } from "./notes.js";
import { listOutstandingPayments } from "./payments.js";
import { listFollowups } from "./followups.js";
import { getProjectById } from "./projects.js";
import { formatMoney, isOverdue, daysUntil } from "./util.js";
import { fetchRecentEmails } from "../gmail-client.js";

/** Extract the bare email address from a "Name <email>" header value. */
export function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match?.[1] ?? from).trim().toLowerCase();
}

/** The single open project for a client, if there's exactly one. */
export function resolveProjectForClient(clientId: number): ClientProject | null {
  const open = listProjects({ clientId });
  return open.length === 1 ? open[0]! : null;
}

export interface LinkedEmail {
  email: EmailMessage;
  client: Client;
  project: ClientProject | null;
  logged: boolean; // false when it was already logged before
}

/**
 * Scan a batch of emails, keep those from known clients, and log each new
 * one as a client_message note (idempotent by Gmail id).
 */
export function linkEmails(emails: EmailMessage[]): LinkedEmail[] {
  const linked: LinkedEmail[] = [];

  for (const email of emails) {
    const addr = extractEmailAddress(email.from);
    if (!addr) continue;
    const client = findClientByEmail(addr);
    if (!client) continue;

    const project = resolveProjectForClient(client.id);
    const sourceRef = `gmail:${email.id}`;
    let logged = false;

    if (!noteExistsBySourceRef(sourceRef)) {
      const body = (email.snippet || email.body || "").slice(0, 500).trim();
      createNote({
        projectId: project?.id ?? null,
        clientId: client.id,
        title: email.subject || "(no subject)",
        body: body || "(no preview available)",
        source: "gmail",
        noteType: "client_message",
        sourceRef,
      });
      logged = true;
    }

    linked.push({ email, client, project, logged });
  }

  return linked;
}

/** Fetch recent inbox emails and link the ones from known clients. */
export async function scanClientOpsInbox(maxResults = 15): Promise<LinkedEmail[]> {
  const emails = await fetchRecentEmails(maxResults);
  return linkEmails(emails);
}

/** Render the linked-email results grouped by client. */
export function formatClientOpsInbox(linked: LinkedEmail[]): string {
  if (linked.length === 0) {
    return "  No recent emails from known clients.";
  }
  const byClient = new Map<number, LinkedEmail[]>();
  for (const l of linked) {
    const arr = byClient.get(l.client.id) ?? [];
    arr.push(l);
    byClient.set(l.client.id, arr);
  }

  const lines: string[] = [];
  for (const items of byClient.values()) {
    const client = items[0]!.client;
    const label = client.organization ? `${client.name} (${client.organization})` : client.name;
    lines.push(`\n  👤 ${label}`);
    for (const l of items) {
      const proj = l.project ? ` → ${l.project.name}` : "";
      const tag = l.logged ? "🆕" : "·";
      lines.push(`     ${tag} ${l.email.subject || "(no subject)"}${proj}`);
    }
  }
  const newCount = linked.filter((l) => l.logged).length;
  lines.push(`\n  ${newCount} new message${newCount === 1 ? "" : "s"} logged to ClientOps notes.`);
  return lines.join("\n");
}

/** A morning-briefing section: money due, follow-ups due, projects at risk. */
export function getClientOpsMorningSection(): string {
  const outstanding = listOutstandingPayments();
  const overduePayments = outstanding.filter((p) => isOverdue(p.dueDate));
  const followups = listFollowups({ includeResolved: false });
  const dueFollowups = followups.filter((f) => {
    const d = daysUntil(f.dueDate);
    return d != null && d <= 0;
  });
  const projects = listProjects();
  const atRisk = projects.filter((p) => p.riskLevel === "elevated" || p.riskLevel === "high");

  if (
    outstanding.length === 0 &&
    followups.length === 0 &&
    atRisk.length === 0
  ) {
    return "  All clear — no outstanding payments, follow-ups, or at-risk projects.";
  }

  const lines: string[] = [];
  const projName = (id: number | null): string =>
    id != null ? getProjectById(id)?.name ?? "" : "";

  if (overduePayments.length) {
    const total = overduePayments.reduce((s, p) => s + p.amount, 0);
    const cur = overduePayments[0]!.currency;
    lines.push(`  💸 ${overduePayments.length} overdue payment${overduePayments.length === 1 ? "" : "s"} (${formatMoney(total, cur)})`);
    for (const p of overduePayments.slice(0, 4)) {
      const d = daysUntil(p.dueDate);
      lines.push(`     · ${formatMoney(p.amount, p.currency)} — ${projName(p.projectId)} (overdue ${d != null ? -d : "?"}d)`);
    }
  }

  if (dueFollowups.length) {
    lines.push(`  🔔 ${dueFollowups.length} follow-up${dueFollowups.length === 1 ? "" : "s"} due`);
    for (const f of dueFollowups.slice(0, 4)) {
      lines.push(`     · ${f.title}${f.channel ? ` (${f.channel})` : ""}`);
    }
  }

  if (atRisk.length) {
    lines.push(`  ⚠️  ${atRisk.length} project${atRisk.length === 1 ? "" : "s"} at risk`);
    for (const p of atRisk.slice(0, 4)) {
      lines.push(`     · ${p.name} — ${p.riskLevel}${p.nextAction ? ` (next: ${p.nextAction})` : ""}`);
    }
  }

  return lines.join("\n");
}

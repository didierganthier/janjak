// ─── Janjak ClientOps — email/calendar linking (Phase 4) ────────────
// Connects incoming Gmail/Calendar signals to known clients & projects.
// Local + idempotent: matched emails are logged as client_message notes,
// deduplicated by their Gmail message id. No external writes, no auto-send.

import type { EmailMessage } from "../types.js";
import type { Client, ClientProject } from "./types.js";
import { findClientByEmail } from "./clients.js";
import { listClients } from "./clients.js";
import { findProject } from "./projects.js";
import { listProjects } from "./projects.js";
import { createNote, noteExistsBySourceRef } from "./notes.js";
import { listOutstandingPayments } from "./payments.js";
import { listFollowups } from "./followups.js";
import { getProjectById } from "./projects.js";
import { formatMoney, isOverdue, daysUntil } from "./util.js";
import { fetchRecentEmails } from "../gmail-client.js";
import { getTodayEvents, type CalendarEvent } from "../calendar.js";

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

// ─── Calendar linking ──────────────────────────────────────────────

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

export interface LinkedEvent {
  event: CalendarEvent;
  client: Client;
  project: ClientProject | null;
  logged: boolean; // false when it was already logged before
}

/** Try to resolve a known client from an event's people + title. */
function resolveClientForEvent(event: CalendarEvent): Client | null {
  // 1) Prefer an explicit email match among organizer + attendees.
  const people = [event.organizer, ...event.attendees].filter(Boolean);
  for (const person of people) {
    const addr = person.match(EMAIL_RE)?.[0];
    if (addr) {
      const byEmail = findClientByEmail(addr.toLowerCase());
      if (byEmail) return byEmail;
    }
  }
  // 2) Fall back to a name/org match in the title or people list.
  const haystack = [event.title, ...people].join(" ").toLowerCase();
  for (const client of listClients()) {
    const name = client.name.trim().toLowerCase();
    if (name.length >= 3 && haystack.includes(name)) return client;
    const org = client.organization?.trim().toLowerCase();
    if (org && org.length >= 3 && haystack.includes(org)) return client;
  }
  return null;
}

/**
 * Match calendar events to known clients/projects and log each new one as a
 * meeting_note (idempotent by Google Calendar event id).
 */
export function linkCalendarEvents(events: CalendarEvent[]): LinkedEvent[] {
  const linked: LinkedEvent[] = [];

  for (const event of events) {
    if (!event.id) continue;
    const client = resolveClientForEvent(event);
    if (!client) continue;

    // Prefer a project whose name appears in the title, else the client's
    // single open project.
    const byTitle = findProject(event.title);
    const project =
      byTitle && byTitle.clientId === client.id ? byTitle : resolveProjectForClient(client.id);

    const sourceRef = `gcal:${event.id}`;
    let logged = false;

    if (!noteExistsBySourceRef(sourceRef)) {
      const when = event.start.toISOString().slice(0, 16).replace("T", " ");
      const people = [event.organizer, ...event.attendees].filter(Boolean).join(", ");
      const body = [`Meeting: ${event.title}`, `When: ${when}`, people ? `With: ${people}` : ""]
        .filter(Boolean)
        .join("\n");
      createNote({
        projectId: project?.id ?? null,
        clientId: client.id,
        title: event.title || "(calendar event)",
        body,
        source: "calendar",
        noteType: "meeting_note",
        sourceRef,
      });
      logged = true;
    }

    linked.push({ event, client, project, logged });
  }

  return linked;
}

/** Fetch today's calendar events and link the ones tied to known clients. */
export async function scanClientOpsCalendar(): Promise<LinkedEvent[]> {
  const events = await getTodayEvents();
  return linkCalendarEvents(events);
}

/** Render linked calendar events grouped by client. */
export function formatClientOpsCalendar(linked: LinkedEvent[]): string {
  if (linked.length === 0) {
    return "  No calendar events tied to known clients today.";
  }
  const lines: string[] = [];
  for (const l of linked) {
    const label = l.client.organization
      ? `${l.client.name} (${l.client.organization})`
      : l.client.name;
    const proj = l.project ? ` → ${l.project.name}` : "";
    const tag = l.logged ? "🆕" : "·";
    const time = l.event.start.toTimeString().slice(0, 5);
    lines.push(`  ${tag} ${time} ${l.event.title} — ${label}${proj}`);
  }
  const newCount = linked.filter((l) => l.logged).length;
  lines.push(`\n  ${newCount} new meeting${newCount === 1 ? "" : "s"} logged to ClientOps notes.`);
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

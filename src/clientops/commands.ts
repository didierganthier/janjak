// ─── Janjak ClientOps — CLI commands ────────────────────────────────
// Registers the top-level ClientOps verbs (client / project / deliverable /
// payment / followup(s)) onto the main Commander program. Phase 1: structured
// data only, no AI.

import type { Command } from "commander";

import {
  createClient,
  findClient,
  getClientById,
  listClients,
  updateClient,
} from "./clients.js";
import {
  createProject,
  findProject,
  getProjectById,
  listProjects,
  setProjectNextAction,
  setProjectStatus,
} from "./projects.js";
import {
  createDeliverable,
  getDeliverableById,
  listDeliverables,
  setDeliverableStatus,
} from "./deliverables.js";
import {
  createPayment,
  getPaymentById,
  listOutstandingPayments,
  listPayments,
  markPaymentPaid,
} from "./payments.js";
import { createNote, listNotes } from "./notes.js";
import {
  createFollowup,
  getFollowupById,
  listFollowups,
  setFollowupStatus,
} from "./followups.js";
import { daysUntil, formatMoney, isOverdue, parseDueDate } from "./util.js";
import { buildProjectContext } from "./context-builder.js";
import {
  draftPaymentFollowup,
  detectRisks,
  extractChatFollowups,
  prepBrief,
  summarizeProject,
  type FollowupTone,
} from "./ai.js";
import { importWhatsAppFile, saveExtractedFollowups } from "./whatsapp.js";
import { resolveProjectForClient } from "./linker.js";
import {
  DELIVERABLE_STATUSES,
  NOTE_TYPES,
  PAYMENT_STATUSES,
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  type Client,
  type ClientProject,
  type DeliverableStatus,
  type NoteType,
  type PaymentStatus,
  type ProjectPriority,
  type ProjectStatus,
} from "./types.js";

// ── small helpers ───────────────────────────────────────────────
function die(msg: string): never {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

function join(parts: string[]): string {
  return parts.join(" ").trim();
}

function indent(text: string, pad = "   "): string {
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

function clientLabel(c: Client): string {
  return c.organization ? `${c.name} (${c.organization})` : c.name;
}

function dueLabel(dueDate: string | null): string {
  if (!dueDate) return "";
  const days = daysUntil(dueDate);
  if (days == null) return ` — due ${dueDate}`;
  if (days < 0) return ` — ⚠️ overdue ${-days}d (${dueDate})`;
  if (days === 0) return ` — due today (${dueDate})`;
  if (days === 1) return ` — due tomorrow (${dueDate})`;
  return ` — due in ${days}d (${dueDate})`;
}

function requireClient(query: string): Client {
  const c = findClient(query);
  if (!c) die(`No client matches "${query}". Add one with \`janjak client add "<name>"\`.`);
  return c;
}

function requireProject(query: string): ClientProject {
  const p = findProject(query);
  if (!p) die(`No project matches "${query}". Add one with \`janjak project add "<name>"\`.`);
  return p;
}

// ── registration ────────────────────────────────────────────────
export function registerClientOpsCommands(program: Command): void {
  registerClient(program);
  registerProject(program);
  registerDeliverable(program);
  registerPayment(program);
  registerFollowup(program);
  registerAI(program);
  registerWhatsApp(program);
}

// ── clients ─────────────────────────────────────────────────────
function registerClient(program: Command): void {
  const client = program.command("client").description("Manage ClientOps clients (people & orgs).");

  client
    .command("add <name...>")
    .description("Add a client.")
    .option("--org <organization>", "Organization / company")
    .option("--email <email>", "Email address")
    .option("--phone <phone>", "Phone number")
    .option("--whatsapp <number>", "WhatsApp number")
    .option("--channel <channel>", "Preferred channel (email/whatsapp/call)")
    .option("--notes <notes>", "Freeform notes")
    .action((nameParts: string[], opts) => {
      const name = join(nameParts);
      if (!name) die("Client name is empty.");
      const c = createClient({
        name,
        organization: opts.org ?? null,
        email: opts.email ?? null,
        phone: opts.phone ?? null,
        whatsapp: opts.whatsapp ?? null,
        preferredChannel: opts.channel ?? null,
        notes: opts.notes ?? null,
      });
      console.log(`\n✅ Client #${c.id} added: ${clientLabel(c)}\n`);
    });

  client
    .command("list")
    .description("List clients.")
    .option("--all", "Include archived clients")
    .action((opts: { all?: boolean }) => {
      const clients = listClients({ includeArchived: opts.all });
      if (clients.length === 0) {
        console.log('\n  No clients yet. Add one with `janjak client add "<name>"`.\n');
        return;
      }
      console.log(`\n👥 Clients (${clients.length})\n`);
      for (const c of clients) {
        const bits = [c.email, c.preferredChannel].filter(Boolean).join(" · ");
        console.log(`  [#${c.id}] ${clientLabel(c)}${bits ? `  — ${bits}` : ""}`);
      }
      console.log();
    });

  client
    .command("show <name...>")
    .description("Show a client's details, projects & open follow-ups.")
    .action((nameParts: string[]) => {
      const c = requireClient(join(nameParts));
      console.log(`\n👤 ${clientLabel(c)}   [#${c.id}]`);
      if (c.email) console.log(`   Email:    ${c.email}`);
      if (c.phone) console.log(`   Phone:    ${c.phone}`);
      if (c.whatsapp) console.log(`   WhatsApp: ${c.whatsapp}`);
      if (c.preferredChannel) console.log(`   Channel:  ${c.preferredChannel}`);
      console.log(`   Status:   ${c.status}`);
      if (c.notes) console.log(`   Notes:    ${c.notes}`);

      const projects = listProjects({ clientId: c.id, includeClosed: true });
      if (projects.length) {
        console.log(`\n   Projects (${projects.length}):`);
        for (const p of projects) {
          console.log(`     [#${p.id}] ${p.name} — ${p.status}`);
        }
      }
      const followups = listFollowups({ clientId: c.id });
      if (followups.length) {
        console.log(`\n   Open follow-ups (${followups.length}):`);
        for (const f of followups) console.log(`     [#${f.id}] ${f.title}${dueLabel(f.dueDate)}`);
      }
      console.log();
    });

  client
    .command("update <name...>")
    .description("Update a client's fields.")
    .option("--org <organization>", "Organization / company")
    .option("--email <email>", "Email address")
    .option("--phone <phone>", "Phone number")
    .option("--whatsapp <number>", "WhatsApp number")
    .option("--channel <channel>", "Preferred channel")
    .option("--notes <notes>", "Freeform notes")
    .option("--status <status>", "active | inactive | archived")
    .action((nameParts: string[], opts) => {
      const c = requireClient(join(nameParts));
      const updated = updateClient(c.id, {
        organization: opts.org,
        email: opts.email,
        phone: opts.phone,
        whatsapp: opts.whatsapp,
        preferredChannel: opts.channel,
        notes: opts.notes,
        status: opts.status,
      });
      console.log(`\n✅ Updated ${clientLabel(updated!)}\n`);
    });

  client
    .command("note <name> <body...>")
    .description("Attach a note to a client.")
    .option("--type <type>", `Note type (${NOTE_TYPES.join(", ")})`, "general")
    .action((name: string, bodyParts: string[], opts: { type: string }) => {
      const c = requireClient(name);
      const body = join(bodyParts);
      if (!body) die("Note body is empty.");
      const noteType = validateNoteType(opts.type);
      const note = createNote({ clientId: c.id, body, noteType });
      console.log(`\n📝 Note #${note.id} saved for ${clientLabel(c)} (${note.noteType}).\n`);
    });
}

// ── projects ────────────────────────────────────────────────────
function registerProject(program: Command): void {
  // `project` (bare) already exists in index.ts (shows the window-inferred
  // project). Attach ClientOps subcommands to it — Commander runs the bare
  // action only when no subcommand is given, so both behaviors coexist.
  const project =
    program.commands.find((c) => c.name() === "project") ??
    program.command("project").description("Manage ClientOps client projects.");

  project
    .command("add <name...>")
    .description("Add a client project.")
    .option("--client <name>", "Client name (must already exist)")
    .option("--budget <amount>", "Budget amount")
    .option("--currency <code>", "Budget currency", "USD")
    .option("--priority <priority>", `Priority (${PROJECT_PRIORITIES.join(", ")})`, "medium")
    .option("--status <status>", "Project status", "lead")
    .option("--desc <description>", "Short description")
    .option("--start <date>", "Start date")
    .option("--end <date>", "Expected end date")
    .action((nameParts: string[], opts) => {
      const name = join(nameParts);
      if (!name) die("Project name is empty.");
      const client = opts.client ? requireClient(opts.client) : null;
      const p = createProject({
        clientId: client?.id ?? null,
        name,
        description: opts.desc ?? null,
        status: validateProjectStatus(opts.status),
        priority: validateProjectPriority(opts.priority),
        budgetAmount: opts.budget != null ? parseFloat(opts.budget) : null,
        budgetCurrency: opts.currency ?? "USD",
        startDate: parseDueDate(opts.start),
        expectedEndDate: parseDueDate(opts.end),
      });
      const who = client ? ` for ${clientLabel(client)}` : "";
      console.log(`\n✅ Project #${p.id} added: ${p.name}${who} (${p.status})\n`);
    });

  project
    .command("list")
    .description("List client projects.")
    .option("--all", "Include completed/cancelled projects")
    .option("--client <name>", "Filter by client")
    .action((opts: { all?: boolean; client?: string }) => {
      const clientId = opts.client ? requireClient(opts.client).id : undefined;
      const projects = listProjects({ includeClosed: opts.all, clientId });
      if (projects.length === 0) {
        console.log('\n  No projects yet. Add one with `janjak project add "<name>"`.\n');
        return;
      }
      console.log(`\n📁 Projects (${projects.length})\n`);
      for (const p of projects) {
        const client = p.clientId ? getClientById(p.clientId) : null;
        const who = client ? ` · ${client.name}` : "";
        const budget = p.budgetAmount != null ? ` · ${formatMoney(p.budgetAmount, p.budgetCurrency)}` : "";
        const risk = p.riskLevel !== "normal" ? ` · risk:${p.riskLevel}` : "";
        console.log(`  [#${p.id}] ${p.name} — ${p.status}${who}${budget}${risk}`);
        if (p.nextAction) console.log(`         → next: ${p.nextAction}${dueLabel(p.nextActionDueDate)}`);
      }
      console.log();
    });

  project
    .command("show <name...>")
    .description("Show full project detail.")
    .action((nameParts: string[]) => {
      const p = requireProject(join(nameParts));
      printProjectSummary(p);
    });

  project
    .command("summary <name...>")
    .description("Structured project summary (status, scope, payments, follow-ups).")
    .option("--ai", "Generate an AI status summary (requires OPENAI_API_KEY).")
    .action(async (nameParts: string[], opts: { ai?: boolean }) => {
      const p = requireProject(join(nameParts));
      printProjectSummary(p);
      if (opts.ai) {
        const ctx = buildProjectContext(p.id);
        if (!ctx) return;
        try {
          console.log("   🧠 thinking…\r");
          const summary = await summarizeProject(ctx);
          console.log(`\n🧠 AI summary\n\n${indent(summary)}\n`);
        } catch (err) {
          die((err as Error).message);
        }
      }
    });

  project
    .command("status <name> <status>")
    .description("Set a project's status.")
    .action((name: string, status: string) => {
      const p = requireProject(name);
      const updated = setProjectStatus(p.id, validateProjectStatus(status));
      console.log(`\n✅ ${updated!.name} → ${updated!.status}\n`);
    });

  project
    .command("next <name> <text...>")
    .description("Set the project's next action.")
    .option("--due <date>", "Due date for the next action")
    .action((name: string, textParts: string[], opts: { due?: string }) => {
      const p = requireProject(name);
      const text = join(textParts);
      if (!text) die("Next action text is empty.");
      const updated = setProjectNextAction(p.id, text, parseDueDate(opts.due));
      console.log(`\n✅ ${updated!.name} next action set: ${text}${dueLabel(updated!.nextActionDueDate)}\n`);
    });

  project
    .command("note <name> <body...>")
    .description("Attach a note to a project.")
    .option("--type <type>", `Note type (${NOTE_TYPES.join(", ")})`, "general")
    .action((name: string, bodyParts: string[], opts: { type: string }) => {
      const p = requireProject(name);
      const body = join(bodyParts);
      if (!body) die("Note body is empty.");
      const note = createNote({
        projectId: p.id,
        clientId: p.clientId,
        body,
        noteType: validateNoteType(opts.type),
      });
      console.log(`\n📝 Note #${note.id} saved for ${p.name} (${note.noteType}).\n`);
    });
}

function printProjectSummary(p: ClientProject): void {
  const client = p.clientId ? getClientById(p.clientId) : null;
  console.log(`\n📁 ${p.name}   [#${p.id}]`);
  if (client) console.log(`   Client:   ${clientLabel(client)}`);
  console.log(`   Status:   ${p.status}`);
  console.log(`   Priority: ${p.priority}`);
  if (p.riskLevel !== "normal") console.log(`   Risk:     ${p.riskLevel}`);
  if (p.budgetAmount != null) console.log(`   Budget:   ${formatMoney(p.budgetAmount, p.budgetCurrency)}`);
  if (p.description) console.log(`   About:    ${p.description}`);
  if (p.nextAction) console.log(`   Next:     ${p.nextAction}${dueLabel(p.nextActionDueDate)}`);

  const deliverables = listDeliverables(p.id);
  if (deliverables.length) {
    const done = deliverables.filter((d) => d.status === "done").length;
    console.log(`\n   Deliverables (${done}/${deliverables.length} done):`);
    for (const d of deliverables) {
      const mark = d.status === "done" ? "✓" : "○";
      console.log(`     ${mark} [#${d.id}] ${d.title} — ${d.status}${dueLabel(d.dueDate)}`);
    }
  }

  const payments = listPayments({ projectId: p.id });
  if (payments.length) {
    const outstanding = payments
      .filter((pay) => pay.status !== "paid" && pay.status !== "cancelled")
      .reduce((sum, pay) => sum + pay.amount, 0);
    console.log(`\n   Payments (${formatMoney(outstanding, p.budgetCurrency)} outstanding):`);
    for (const pay of payments) {
      console.log(`     [#${pay.id}] ${formatMoney(pay.amount, pay.currency)} — ${pay.status}${dueLabel(pay.dueDate)}`);
    }
  }

  const followups = listFollowups({ projectId: p.id });
  if (followups.length) {
    console.log(`\n   Open follow-ups (${followups.length}):`);
    for (const f of followups) console.log(`     [#${f.id}] ${f.title}${dueLabel(f.dueDate)}`);
  }

  const notes = listNotes({ projectId: p.id, limit: 5 });
  if (notes.length) {
    console.log(`\n   Recent notes:`);
    for (const n of notes) {
      const preview = n.body.length > 80 ? n.body.slice(0, 77) + "…" : n.body;
      console.log(`     · (${n.noteType}) ${preview}`);
    }
  }
  console.log();
}

// ── deliverables ────────────────────────────────────────────────
function registerDeliverable(program: Command): void {
  const deliverable = program
    .command("deliverable")
    .description("Manage project deliverables.");

  deliverable
    .command("add <project> <title...>")
    .description("Add a deliverable to a project.")
    .option("--due <date>", "Due date")
    .option("--priority <priority>", `Priority (${PROJECT_PRIORITIES.join(", ")})`, "medium")
    .action((project: string, titleParts: string[], opts: { due?: string; priority: string }) => {
      const p = requireProject(project);
      const title = join(titleParts);
      if (!title) die("Deliverable title is empty.");
      const d = createDeliverable({
        projectId: p.id,
        title,
        dueDate: parseDueDate(opts.due),
        priority: validateProjectPriority(opts.priority),
      });
      console.log(`\n✅ Deliverable #${d.id} added to ${p.name}: ${d.title}\n`);
    });

  deliverable
    .command("list <project...>")
    .description("List a project's deliverables.")
    .action((projectParts: string[]) => {
      const p = requireProject(join(projectParts));
      const items = listDeliverables(p.id);
      if (items.length === 0) {
        console.log(`\n  No deliverables for ${p.name} yet.\n`);
        return;
      }
      console.log(`\n📦 Deliverables — ${p.name}\n`);
      for (const d of items) {
        const mark = d.status === "done" ? "✓" : "○";
        console.log(`  ${mark} [#${d.id}] ${d.title} — ${d.status}${dueLabel(d.dueDate)}`);
      }
      console.log();
    });

  deliverable
    .command("done <id>")
    .description("Mark a deliverable done.")
    .action((id: string) => {
      const updated = setDeliverableStatus(parseInt(id, 10), "done");
      if (!updated) die(`Deliverable #${id} not found.`);
      console.log(`\n✅ Deliverable #${id} marked done: ${updated.title}\n`);
    });

  deliverable
    .command("status <id> <status>")
    .description(`Set a deliverable status (${DELIVERABLE_STATUSES.join(", ")}).`)
    .action((id: string, status: string) => {
      const updated = setDeliverableStatus(parseInt(id, 10), validateDeliverableStatus(status));
      if (!updated) die(`Deliverable #${id} not found.`);
      console.log(`\n✅ Deliverable #${id} → ${updated.status}\n`);
    });
}

// ── payments ────────────────────────────────────────────────────
function registerPayment(program: Command): void {
  const payment = program.command("payment").description("Track invoices & payments.");

  payment
    .command("add <project> <amount>")
    .description("Add a payment/invoice for a project.")
    .option("--due <date>", "Due date")
    .option("--currency <code>", "Currency", "USD")
    .option("--status <status>", `Status (${PAYMENT_STATUSES.join(", ")})`, "draft")
    .option("--notes <notes>", "Notes")
    .action((project: string, amount: string, opts) => {
      const p = requireProject(project);
      const value = parseFloat(amount);
      if (Number.isNaN(value)) die(`Invalid amount "${amount}".`);
      const pay = createPayment({
        projectId: p.id,
        clientId: p.clientId,
        amount: value,
        currency: opts.currency ?? "USD",
        dueDate: parseDueDate(opts.due),
        status: validatePaymentStatus(opts.status),
        notes: opts.notes ?? null,
      });
      console.log(`\n✅ Payment #${pay.id}: ${formatMoney(pay.amount, pay.currency)} for ${p.name} (${pay.status})${dueLabel(pay.dueDate)}\n`);
    });

  payment
    .command("list")
    .description("List payments.")
    .option("--status <status>", "Filter by status")
    .option("--client <name>", "Filter by client")
    .action((opts: { status?: string; client?: string }) => {
      const clientId = opts.client ? requireClient(opts.client).id : undefined;
      const status = opts.status ? validatePaymentStatus(opts.status) : undefined;
      const payments = listPayments({ status, clientId });
      if (payments.length === 0) {
        console.log("\n  No payments match.\n");
        return;
      }
      printPayments("💰 Payments", payments);
    });

  payment
    .command("overdue")
    .description("Show outstanding payments (overdue first).")
    .action(() => {
      const outstanding = listOutstandingPayments();
      const overdue = outstanding.filter((p) => isOverdue(p.dueDate));
      if (outstanding.length === 0) {
        console.log("\n  🎉 No outstanding payments.\n");
        return;
      }
      if (overdue.length) printPayments("⚠️  Overdue payments", overdue);
      const rest = outstanding.filter((p) => !isOverdue(p.dueDate));
      if (rest.length) printPayments("⏳ Outstanding (not yet overdue)", rest);
    });

  payment
    .command("paid <id>")
    .description("Mark a payment as paid.")
    .action((id: string) => {
      const updated = markPaymentPaid(parseInt(id, 10));
      if (!updated) die(`Payment #${id} not found.`);
      console.log(`\n✅ Payment #${id} marked paid (${formatMoney(updated.amount, updated.currency)}).\n`);
    });

  payment
    .command("followup <id>")
    .description("Draft a payment follow-up message (AI — never sends).")
    .option("--tone <tone>", "friendly | professional | firm", "friendly")
    .action(async (id: string, opts: { tone: string }) => {
      const pay = getPaymentById(parseInt(id, 10));
      if (!pay) die(`Payment #${id} not found.`);
      if (pay.projectId == null) die(`Payment #${id} isn't linked to a project.`);
      const ctx = buildProjectContext(pay.projectId);
      if (!ctx) die(`Project for payment #${id} not found.`);
      const tone = validateFollowupTone(opts.tone);
      try {
        const msg = await draftPaymentFollowup(pay, ctx, tone);
        console.log(
          `\n✉️  Payment follow-up draft — ${formatMoney(pay.amount, pay.currency)} · ${ctx.project.name}\n`
        );
        console.log(indent(msg));
        console.log("\n   (draft only — review and send yourself)\n");
      } catch (err) {
        die((err as Error).message);
      }
    });
}

function printPayments(heading: string, payments: ReturnType<typeof listPayments>): void {
  const total = payments.reduce((sum, p) => sum + p.amount, 0);
  const currency = payments[0]?.currency ?? "USD";
  console.log(`\n${heading} (${payments.length}, ${formatMoney(total, currency)})\n`);
  for (const p of payments) {
    const project = p.projectId ? getProjectById(p.projectId) : null;
    const who = project ? ` · ${project.name}` : "";
    console.log(`  [#${p.id}] ${formatMoney(p.amount, p.currency)} — ${p.status}${who}${dueLabel(p.dueDate)}`);
  }
  console.log();
}

// ── follow-ups ──────────────────────────────────────────────────
function registerFollowup(program: Command): void {
  program
    .command("followups")
    .description("List open follow-ups across all clients/projects.")
    .option("--all", "Include resolved follow-ups")
    .action((opts: { all?: boolean }) => {
      const followups = listFollowups({ includeResolved: opts.all });
      if (followups.length === 0) {
        console.log("\n  🎉 No open follow-ups.\n");
        return;
      }
      console.log(`\n🔔 Follow-ups (${followups.length})\n`);
      for (const f of followups) {
        const client = f.clientId ? getClientById(f.clientId) : null;
        const project = f.projectId ? getProjectById(f.projectId) : null;
        const who = client?.name ?? project?.name ?? "";
        const status = f.status !== "pending" ? ` [${f.status}]` : "";
        console.log(`  [#${f.id}] ${who ? who + " — " : ""}${f.title}${dueLabel(f.dueDate)}${status}`);
        if (f.description) console.log(`         ${f.description}`);
      }
      console.log();
    });

  const followup = program.command("followup").description("Manage a follow-up.");

  followup
    .command("add <who> <title...>")
    .description("Add a follow-up (who = client or project name).")
    .option("--due <date>", "Due date (today/tomorrow/next-week or YYYY-MM-DD)")
    .option("--channel <channel>", "Channel (email/whatsapp/call)")
    .action((who: string, titleParts: string[], opts: { due?: string; channel?: string }) => {
      const title = join(titleParts);
      if (!title) die("Follow-up title is empty.");
      const client = findClient(who);
      const project = client ? null : findProject(who);
      if (!client && !project) {
        die(`No client or project matches "${who}".`);
      }
      const f = createFollowup({
        clientId: client?.id ?? project?.clientId ?? null,
        projectId: project?.id ?? null,
        title,
        dueDate: parseDueDate(opts.due),
        channel: opts.channel ?? null,
      });
      const label = client ? clientLabel(client) : project!.name;
      console.log(`\n🔔 Follow-up #${f.id} added for ${label}: ${title}${dueLabel(f.dueDate)}\n`);
    });

  followup
    .command("done <id>")
    .description("Mark a follow-up done.")
    .action((id: string) => {
      const updated = setFollowupStatus(parseInt(id, 10), "done");
      if (!updated) die(`Follow-up #${id} not found.`);
      console.log(`\n✅ Follow-up #${id} done: ${updated.title}\n`);
    });

  followup
    .command("dismiss <id>")
    .description("Dismiss a follow-up.")
    .action((id: string) => {
      const updated = setFollowupStatus(parseInt(id, 10), "dismissed");
      if (!updated) die(`Follow-up #${id} not found.`);
      console.log(`\n🗑️  Follow-up #${id} dismissed.\n`);
    });

  // Silence unused import warnings for helpers referenced only by type.
  void getFollowupById;
}

// ── validators ──────────────────────────────────────────────────
function validateProjectStatus(value: string): ProjectStatus {
  if (!PROJECT_STATUSES.includes(value as ProjectStatus)) {
    die(`Invalid status. Use one of: ${PROJECT_STATUSES.join(", ")}`);
  }
  return value as ProjectStatus;
}

function validateProjectPriority(value: string): ProjectPriority {
  if (!PROJECT_PRIORITIES.includes(value as ProjectPriority)) {
    die(`Invalid priority. Use one of: ${PROJECT_PRIORITIES.join(", ")}`);
  }
  return value as ProjectPriority;
}

function validateDeliverableStatus(value: string): DeliverableStatus {
  if (!DELIVERABLE_STATUSES.includes(value as DeliverableStatus)) {
    die(`Invalid status. Use one of: ${DELIVERABLE_STATUSES.join(", ")}`);
  }
  return value as DeliverableStatus;
}

function validatePaymentStatus(value: string): PaymentStatus {
  if (!PAYMENT_STATUSES.includes(value as PaymentStatus)) {
    die(`Invalid status. Use one of: ${PAYMENT_STATUSES.join(", ")}`);
  }
  return value as PaymentStatus;
}

function validateNoteType(value: string): NoteType {
  if (!NOTE_TYPES.includes(value as NoteType)) {
    die(`Invalid note type. Use one of: ${NOTE_TYPES.join(", ")}`);
  }
  return value as NoteType;
}

const FOLLOWUP_TONES: FollowupTone[] = ["friendly", "professional", "firm"];
function validateFollowupTone(value: string): FollowupTone {
  if (!FOLLOWUP_TONES.includes(value as FollowupTone)) {
    die(`Invalid tone. Use one of: ${FOLLOWUP_TONES.join(", ")}`);
  }
  return value as FollowupTone;
}

// ── AI commands (Phase 2) ───────────────────────────────────────
function registerAI(program: Command): void {
  program
    .command("prep <name...>")
    .description("AI meeting-prep brief for a client project.")
    .action(async (nameParts: string[]) => {
      const p = requireProject(join(nameParts));
      const ctx = buildProjectContext(p.id);
      if (!ctx) die(`Could not build context for ${p.name}.`);
      try {
        const brief = await prepBrief(ctx);
        console.log(`\n📋 Meeting prep — ${p.name}\n`);
        console.log(indent(brief));
        console.log();
      } catch (err) {
        die((err as Error).message);
      }
    });

  program
    .command("risks")
    .description("AI risk scan across open client projects.")
    .option("--all", "Include closed projects")
    .action(async (opts: { all?: boolean }) => {
      const projects = listProjects({ includeClosed: opts.all });
      if (projects.length === 0) {
        console.log("\n  No open projects to assess.\n");
        return;
      }
      const contexts = projects
        .map((p) => buildProjectContext(p.id))
        .filter((c): c is NonNullable<typeof c> => c != null);
      try {
        const report = await detectRisks(contexts);
        console.log(`\n⚠️  Portfolio risk scan (${contexts.length} project${contexts.length === 1 ? "" : "s"})\n`);
        console.log(indent(report));
        console.log();
      } catch (err) {
        die((err as Error).message);
      }
    });
}

// ── WhatsApp import (Phase 5) ───────────────────────────────────
function registerWhatsApp(program: Command): void {
  const wa = program.command("whatsapp").description("Import WhatsApp chat exports into ClientOps.");

  wa
    .command("import <file>")
    .description("Import a WhatsApp chat export (.txt) under a client.")
    .requiredOption("--client <name>", "Client this chat belongs to")
    .option("--project <name>", "Link the chat to a specific project")
    .option("--ai", "Extract action items into follow-ups (requires OPENAI_API_KEY)")
    .action(async (file: string, opts: { client: string; project?: string; ai?: boolean }) => {
      const client = requireClient(opts.client);
      const project = opts.project ? requireProject(opts.project) : resolveProjectForClient(client.id);

      let result;
      try {
        result = importWhatsAppFile({ client, project, filePath: file });
      } catch (err) {
        die(`Could not read "${file}": ${(err as Error).message}`);
      }

      if (result.messageCount === 0) {
        die("No messages found — is this a WhatsApp .txt export?");
      }

      console.log(`\n💬 WhatsApp import — ${clientLabel(client)}${project ? ` → ${project.name}` : ""}`);
      console.log(`   ${result.messageCount} messages · ${result.range} · ${result.senders.length} participant${result.senders.length === 1 ? "" : "s"}`);
      console.log(`   ${result.noteCreated ? "🆕 Logged transcript as a note." : "· Already imported (note exists)."}`);

      if (opts.ai) {
        try {
          const items = await extractChatFollowups(result.transcript, client.name);
          const created = saveExtractedFollowups(client, project, items);
          console.log(`   🔔 ${created} new follow-up${created === 1 ? "" : "s"} from ${items.length} detected action item${items.length === 1 ? "" : "s"}.`);
        } catch (err) {
          console.log(`   ⚠️  Follow-up extraction skipped: ${(err as Error).message}`);
        }
      }
      console.log();
    });
}

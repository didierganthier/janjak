// ─── Web Dashboard: Browser-based UI for Janjak ────────────────────
// A local HTTP server that serves a beautiful dashboard + JSON API.
// No terminal needed — just open localhost:3547 in a browser.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { poll, getStatus, getNudge, enterFocusMode, enterBreakMode, exitFocusMode } from "./engine.js";
import { getProactiveAlerts } from "./proactive.js";
import { getTaskById, generateReply } from "./reply.js";
import { getTodayStats, getTasks, getTodayProjectTime, updateTaskStatus } from "./db.js";
import { getTodayScore, getWeeklyScores } from "./score.js";
import { getCurrentTrack, pauseMusic, resumeMusic } from "./music.js";
import { getCurrentStreak } from "./streak.js";
import { getPomodoroStats } from "./pomo.js";
import { getCurrentProject } from "./project.js";
import { getCalendarSummary, getMeetingAlert, getTodayEvents, getFreeSlots } from "./calendar.js";
import { getGitHubDashSummary, isGitHubConfigured } from "./github.js";
import { isAuthenticated } from "./gmail-auth.js";
import type { TaskStatus } from "./types.js";

import { listClients } from "./clientops/clients.js";
import { listProjects, getProjectById } from "./clientops/projects.js";
import { listDeliverables } from "./clientops/deliverables.js";
import { listPayments, listOutstandingPayments, markPaymentPaid } from "./clientops/payments.js";
import { listFollowups, setFollowupStatus } from "./clientops/followups.js";
import { listMilestones } from "./clientops/milestones.js";
import { listDocuments } from "./clientops/documents.js";
import { formatMoney, isOverdue, daysUntil } from "./clientops/util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3547;

// ─── API Handlers ───────────────────────────────────────────────

async function getFullState() {
  await poll();
  const status = getStatus();
  const todayStats = getTodayStats();
  const score = getTodayScore();
  const weeklyScores = getWeeklyScores(7);
  const tasks = getTasks();
  const projects = getTodayProjectTime();
  const streak = getCurrentStreak();
  const pomo = getPomodoroStats();
  const { project, branch } = getCurrentProject();
  const nudge = getNudge();
  const track = await getCurrentTrack();

  let calendar = null;
  let meetingAlert = null;
  try {
    calendar = await getCalendarSummary();
    meetingAlert = await getMeetingAlert();
    if (calendar) {
      // Serialize CalendarEvent objects to plain data
      calendar = {
        ...calendar,
        currentEvent: calendar.currentEvent ? { title: calendar.currentEvent.title, start: calendar.currentEvent.start, end: calendar.currentEvent.end, meetLink: calendar.currentEvent.meetLink } : null,
        nextEvent: calendar.nextEvent ? { title: calendar.nextEvent.title, start: calendar.nextEvent.start, end: calendar.nextEvent.end, minutesUntil: calendar.nextEvent.minutesUntil, meetLink: calendar.nextEvent.meetLink } : null,
      };
    }
  } catch { /* calendar not connected */ }

  let github = null;
  if (isGitHubConfigured()) {
    try { github = await getGitHubDashSummary(); } catch { /* */ }
  }

  const result = {
    status: {
      activity: status.activity,
      focusMode: status.focusMode,
      energy: status.energy,
      app: status.activeApp?.appName ?? null,
      appTitle: status.activeApp?.title ?? null,
      sessionMinutes: Math.round((Date.now() - status.sessionStartedAt) / 60000),
      idleMinutes: status.idleMinutes,
    },
    score: {
      value: score.score,
      label: score.label,
      codingMinutes: score.codingMinutes,
      browsingMinutes: score.browsingMinutes,
      totalMinutes: score.totalMinutes,
      focusRatio: score.focusRatio,
    },
    weeklyScores: weeklyScores.map(s => ({ date: s.date, score: s.score, label: s.label })),
    todayStats: {
      totalMinutes: todayStats.totalMinutes,
      activities: todayStats.byActivity,
    },
    tasks: tasks.slice(0, 20).map(t => ({
      id: t.id, title: t.title, priority: t.priority,
      status: t.status, deadline: t.deadline, person: t.person,
    })),
    projects: projects.map(p => ({ project: p.project, minutes: p.minutes })),
    currentProject: { project, branch },
    streak: { days: streak.days, best: streak.best, todayQualifies: streak.todayQualifies },
    pomo: { today: pomo.today, totalMinutes: pomo.totalMinutes },
    music: track,
    nudge,
    calendar,
    meetingAlert,
    github,
    integrations: {
      googleAuth: isAuthenticated(),
      github: isGitHubConfigured(),
    },
    alerts: [] as Awaited<ReturnType<typeof getProactiveAlerts>>,
    timestamp: Date.now(),
  };

  // Fetch proactive alerts
  try {
    result.alerts = await getProactiveAlerts();
  } catch { /* */ }

  return result;
}

// ─── ClientOps snapshot ─────────────────────────────────────────

function clientOpsSnapshot() {
  const clients = listClients();
  const projects = listProjects();
  const outstanding = listOutstandingPayments();
  const followups = listFollowups({ includeResolved: false });

  const projectName = (id: number | null): string | null =>
    id != null ? getProjectById(id)?.name ?? null : null;

  const projectsOut = projects.map((p) => {
    const deliverables = listDeliverables(p.id);
    const doneCount = deliverables.filter((d) => d.status === "done").length;
    const payments = listPayments({ projectId: p.id });
    const outstandingAmount = payments
      .filter((pay) => pay.status !== "paid" && pay.status !== "cancelled")
      .reduce((sum, pay) => sum + pay.amount, 0);
    const client = clients.find((c) => c.id === p.clientId) ?? null;
    return {
      id: p.id,
      name: p.name,
      client: client ? client.name : null,
      status: p.status,
      priority: p.priority,
      riskLevel: p.riskLevel,
      budget: p.budgetAmount != null ? formatMoney(p.budgetAmount, p.budgetCurrency) : null,
      nextAction: p.nextAction,
      nextActionDueDate: p.nextActionDueDate,
      nextActionDays: daysUntil(p.nextActionDueDate),
      deliverables: { done: doneCount, total: deliverables.length },
      outstanding: outstandingAmount > 0 ? formatMoney(outstandingAmount, p.budgetCurrency) : null,
    };
  });

  const clientsOut = clients.map((c) => {
    const openFollowups = followups.filter((f) => f.clientId === c.id).length;
    const projectCount = projects.filter((p) => p.clientId === c.id).length;
    return {
      id: c.id,
      name: c.name,
      organization: c.organization,
      status: c.status,
      preferredChannel: c.preferredChannel,
      projectCount,
      openFollowups,
    };
  });

  const paymentsOut = outstanding.map((p) => ({
    id: p.id,
    amount: formatMoney(p.amount, p.currency),
    status: p.status,
    dueDate: p.dueDate,
    days: daysUntil(p.dueDate),
    overdue: isOverdue(p.dueDate),
    project: projectName(p.projectId),
  }));

  const followupsOut = followups.map((f) => ({
    id: f.id,
    title: f.title,
    dueDate: f.dueDate,
    days: daysUntil(f.dueDate),
    channel: f.channel,
    project: projectName(f.projectId),
    client: f.clientId != null ? clients.find((c) => c.id === f.clientId)?.name ?? null : null,
  }));

  const outstandingTotal = outstanding.reduce((sum, p) => sum + p.amount, 0);

  // ── Revenue metrics (real payment data) ──
  const allPayments = listPayments();
  const primaryCurrency =
    allPayments[0]?.currency ?? projects[0]?.budgetCurrency ?? "USD";
  const collectedAmount = allPayments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);
  const billedAmount = allPayments
    .filter((p) => p.status !== "cancelled")
    .reduce((sum, p) => sum + p.amount, 0);
  const collectedPct = billedAmount > 0 ? Math.round((collectedAmount / billedAmount) * 100) : 0;

  // ── Deliverable completion (aggregate) ──
  const delDone = projectsOut.reduce((s, p) => s + p.deliverables.done, 0);
  const delTotal = projectsOut.reduce((s, p) => s + p.deliverables.total, 0);

  // ── Milestones across all projects ──
  let msTotal = 0;
  let msPaid = 0;
  let msSettledAmount = 0;
  let msValueAmount = 0;
  const upcomingMilestones: Array<{
    id: number;
    title: string;
    project: string | null;
    amount: string | null;
    status: string;
    dueDate: string | null;
    days: number | null;
  }> = [];
  for (const p of projects) {
    for (const m of listMilestones(p.id)) {
      msTotal++;
      if (m.amount != null) msValueAmount += m.amount;
      if (m.status === "paid") {
        msPaid++;
        if (m.amount != null) msSettledAmount += m.amount;
      } else {
        upcomingMilestones.push({
          id: m.id,
          title: m.title,
          project: p.name,
          amount: m.amount != null ? formatMoney(m.amount, m.currency) : null,
          status: m.status,
          dueDate: m.dueDate,
          days: daysUntil(m.dueDate),
        });
      }
    }
  }
  upcomingMilestones.sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));

  // ── Documents ──
  const docs = listDocuments();
  const docStatusCount = { draft: 0, sent: 0, signed: 0, archived: 0 } as Record<string, number>;
  for (const d of docs) {
    if (d.status in docStatusCount) docStatusCount[d.status]++;
  }
  const documentsOut = docs.slice(0, 8).map((d) => ({
    id: d.id,
    title: d.title,
    type: d.documentType,
    status: d.status,
    project: d.projectId != null ? getProjectById(d.projectId)?.name ?? null : null,
  }));

  return {
    clients: clientsOut,
    projects: projectsOut,
    payments: paymentsOut,
    followups: followupsOut,
    milestones: {
      total: msTotal,
      paid: msPaid,
      progressPct: msTotal > 0 ? Math.round((msPaid / msTotal) * 100) : 0,
      value: msValueAmount > 0 ? formatMoney(msValueAmount, primaryCurrency) : null,
      settled: msSettledAmount > 0 ? formatMoney(msSettledAmount, primaryCurrency) : null,
      upcoming: upcomingMilestones.slice(0, 6),
    },
    documents: {
      total: docs.length,
      byStatus: docStatusCount,
      recent: documentsOut,
    },
    metrics: {
      collected: formatMoney(collectedAmount, primaryCurrency),
      billed: formatMoney(billedAmount, primaryCurrency),
      outstanding: formatMoney(outstandingTotal, primaryCurrency),
      collectedPct,
      deliverables: { done: delDone, total: delTotal },
      deliverablePct: delTotal > 0 ? Math.round((delDone / delTotal) * 100) : 0,
    },
    totals: {
      clients: clientsOut.length,
      openProjects: projectsOut.length,
      outstanding: outstanding.length ? formatMoney(outstandingTotal, outstanding[0]!.currency) : null,
      overduePayments: outstanding.filter((p) => isOverdue(p.dueDate)).length,
      openFollowups: followupsOut.length,
    },
    timestamp: Date.now(),
  };
}

// ─── Route handler ──────────────────────────────────────────────

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // ── API routes ──
  if (path === "/api/state") {
    const state = await getFullState();
    json(res, state);
    return;
  }

  if (path === "/api/focus" && method === "POST") {
    const msg = await enterFocusMode();
    json(res, { ok: true, message: msg });
    return;
  }

  if (path === "/api/break" && method === "POST") {
    const msg = await enterBreakMode();
    json(res, { ok: true, message: msg });
    return;
  }

  if (path === "/api/stop" && method === "POST") {
    const msg = await exitFocusMode();
    json(res, { ok: true, message: msg });
    return;
  }

  if (path === "/api/music/pause" && method === "POST") {
    await pauseMusic();
    json(res, { ok: true });
    return;
  }

  if (path === "/api/music/resume" && method === "POST") {
    await resumeMusic();
    json(res, { ok: true });
    return;
  }

  if (path.startsWith("/api/task/") && method === "PUT") {
    const parts = path.split("/");
    const id = parseInt(parts[3] ?? "", 10);
    const status = url.searchParams.get("status") as TaskStatus | null;
    if (isNaN(id) || !status || !["pending", "in-progress", "done", "dismissed"].includes(status)) {
      json(res, { error: "Invalid task id or status" }, 400);
      return;
    }
    updateTaskStatus(id, status);
    json(res, { ok: true });
    return;
  }

  if (path === "/api/alerts") {
    try {
      const alerts = await getProactiveAlerts();
      json(res, { alerts });
    } catch {
      json(res, { alerts: [] });
    }
    return;
  }

  if (path === "/api/clientops") {
    try {
      json(res, clientOpsSnapshot());
    } catch (err) {
      json(res, { error: (err as Error).message }, 500);
    }
    return;
  }

  // Mark a ClientOps payment as paid.
  if (path.startsWith("/api/clientops/payment/") && path.endsWith("/paid") && method === "POST") {
    const id = parseInt(path.split("/")[4] ?? "", 10);
    if (isNaN(id)) {
      json(res, { error: "Invalid payment id" }, 400);
      return;
    }
    const updated = markPaymentPaid(id);
    if (!updated) {
      json(res, { error: "Payment not found" }, 404);
      return;
    }
    json(res, { ok: true });
    return;
  }

  // Resolve (mark done) a ClientOps follow-up.
  if (path.startsWith("/api/clientops/followup/") && path.endsWith("/done") && method === "POST") {
    const id = parseInt(path.split("/")[4] ?? "", 10);
    if (isNaN(id)) {
      json(res, { error: "Invalid follow-up id" }, 400);
      return;
    }
    const updated = setFollowupStatus(id, "done");
    if (!updated) {
      json(res, { error: "Follow-up not found" }, 404);
      return;
    }
    json(res, { ok: true });
    return;
  }

  // Draft a reply for a task
  if (path.startsWith("/api/task/") && path.endsWith("/reply") && method === "POST") {
    const parts = path.split("/");
    const id = parseInt(parts[3] ?? "", 10);
    if (isNaN(id)) {
      json(res, { error: "Invalid task id" }, 400);
      return;
    }
    const task = getTaskById(id);
    if (!task) {
      json(res, { error: "Task not found" }, 404);
      return;
    }
    try {
      // Read tone from request body
      const body = await readBody(req);
      const tone = (body.tone as "professional" | "friendly" | "brief") ?? "professional";
      const reply = await generateReply(task, tone);
      const to = task.person.replace(/<.*>/, "").includes("@")
        ? task.person.trim()
        : (task.person.match(/<([^>]+)>/)?.[1] ?? task.person.trim());
      json(res, { ok: true, reply, to, subject: `Re: ${task.sourceSubject}` });
    } catch {
      json(res, { error: "Failed to generate reply" }, 500);
    }
    return;
  }

  if (path === "/api/calendar/events") {
    try {
      const events = await getTodayEvents();
      const slots = await getFreeSlots();
      json(res, { events, freeSlots: slots });
    } catch {
      json(res, { events: [], freeSlots: [] });
    }
    return;
  }

  // ── Static files: serve the SPA ──
  if (path === "/" || path === "/index.html") {
    try {
      const html = readFileSync(join(__dirname, "..", "web", "index.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Dashboard HTML not found");
    }
    return;
  }

  if (path === "/clientops" || path === "/clientops.html") {
    try {
      const html = readFileSync(join(__dirname, "..", "web", "clientops.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("ClientOps HTML not found");
    }
    return;
  }

  // 404
  json(res, { error: "Not found" }, 404);
}

// ─── Server start ───────────────────────────────────────────────

export function startWebDashboard(): Promise<void> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        console.error("Web error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      });
    });

    server.listen(PORT, "127.0.0.1", () => {
      console.log(`\n🌐 Janjak Web Dashboard`);
      console.log(`   http://localhost:${PORT}`);
      console.log(`\n   Open this in your browser. Press Ctrl+C to stop.\n`);

      // Auto-open browser on macOS
      import("node:child_process").then(({ exec }) => {
        exec(`open http://localhost:${PORT}`);
      });

      resolve();
    });

    // Keep process alive
    process.on("SIGINT", () => {
      server.close();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      server.close();
      process.exit(0);
    });
  });
}

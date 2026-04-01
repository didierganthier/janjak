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

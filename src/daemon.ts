// ─── Janjak Daemon: Always-on background API server ─────────────────
// Extends the web dashboard with voice/AI/task endpoints.
// The overlay, menu bar, CLI, and future apps all hit this API.
//
// Start:  janjak daemon start
// Stop:   janjak daemon stop
// Status: janjak daemon status

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync, unlinkSync, createReadStream, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import OpenAI from "openai";

// ── Internal modules ──
import { poll, getStatus, getNudge, enterFocusMode, enterBreakMode, exitFocusMode } from "./engine.js";
import { getProactiveAlerts } from "./proactive.js";
import { getTaskById, generateReply } from "./reply.js";
import { getTodayStats, getTasks, getTodayProjectTime, updateTaskStatus, getState, setState } from "./db.js";
import { getTodayScore, getWeeklyScores } from "./score.js";
import { getCurrentTrack, pauseMusic, resumeMusic } from "./music.js";
import { getCurrentStreak } from "./streak.js";
import { getPomodoroStats, startPomodoro } from "./pomo.js";
import { getCurrentProject } from "./project.js";
import { getCalendarSummary, getMeetingAlert, getTodayEvents, getFreeSlots } from "./calendar.js";
import { getGitHubDashSummary, isGitHubConfigured } from "./github.js";
import { isAuthenticated } from "./gmail-auth.js";
import { type ChatMessage } from "./chat.js";
import { runAgent } from "./agent/agent.js";
import { looksLikeTaskCreation, createTaskFromText, formatSpokenConfirmation } from "./nl-tasks.js";
import { processInbox } from "./tasks.js";
import { getSpokenBriefing, generateMorningBriefing } from "./morning.js";
import { startMonitor, stopMonitor, getStatusReport } from "./monitor.js";
import { startProactiveEngine, stopProactiveEngine } from "./proactive.js";
import { executeAutonomously, isAutonomyEnabled, setAutonomyEnabled, isTierEnabled, getActionLog, cancelPending, getPendingActions } from "./autonomy.js";
import { getAllWorkflows, setWorkflowEnabled, getWorkflowLog, runWorkflowById, isWorkflowsEnabled, setWorkflowsEnabled } from "./workflows.js";
import type { TaskStatus } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JANJAK_DIR = join(homedir(), ".janjak");
const PID_FILE = join(JANJAK_DIR, "daemon.pid");
const PORT = 7777;

// ─── Character System ───────────────────────────────────────────

const CHARACTERS: Record<string, { name: string; voice: string }> = {
  janjak: { name: "Janjak", voice: "onyx" },
  janèt:  { name: "Janèt",  voice: "nova" },
};

function getCharacter() {
  const key = getState("character") ?? "janjak";
  return CHARACTERS[key] ?? CHARACTERS["janjak"]!;
}

// ─── OpenAI helpers ─────────────────────────────────────────────

function getOpenAI(): OpenAI | null {
  const apiKey = process.env["OPENAI_API_KEY"];
  return apiKey ? new OpenAI({ apiKey }) : null;
}

// Transcribe a WAV file using Whisper
async function transcribeFile(filePath: string): Promise<string> {
  const client = getOpenAI();
  if (!client) throw new Error("OPENAI_API_KEY not set");
  
  if (!existsSync(filePath) || statSync(filePath).size < 5000) {
    return "";
  }
  
  const result = await client.audio.transcriptions.create({
    file: createReadStream(filePath),
    model: "whisper-1",
  });
  return result.text.trim();
}

// Generate TTS audio, return the MP3 file path
async function generateTTS(text: string, voice?: string): Promise<string | null> {
  const client = getOpenAI();
  if (!client) return null;

  const cleaned = text
    .replace(/[\u{1F600}-\u{1F9FF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
    .replace(/["\u201C\u201D]/g, '"')
    .replace(/['\u2018\u2019]/g, "'")
    .replace(/\*\*/g, "")
    .trim();

  if (!cleaned) return null;

  const ttsVoice = (voice ?? getCharacter().voice) as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  const mp3 = await client.audio.speech.create({
    model: "tts-1",
    voice: ttsVoice,
    input: cleaned,
  });

  const outPath = join(JANJAK_DIR, ".daemon-tts.mp3");
  const buffer = Buffer.from(await mp3.arrayBuffer());
  writeFileSync(outPath, buffer);
  return outPath;
}

// ─── Full State (reuse from web.ts logic) ───────────────────────

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
  const char = getCharacter();

  let calendar = null;
  let meetingAlert = null;
  try {
    calendar = await getCalendarSummary();
    meetingAlert = await getMeetingAlert();
    if (calendar) {
      calendar = {
        ...calendar,
        currentEvent: calendar.currentEvent ? { title: calendar.currentEvent.title, start: calendar.currentEvent.start, end: calendar.currentEvent.end, meetLink: calendar.currentEvent.meetLink } : null,
        nextEvent: calendar.nextEvent ? { title: calendar.nextEvent.title, start: calendar.nextEvent.start, end: calendar.nextEvent.end, minutesUntil: calendar.nextEvent.minutesUntil, meetLink: calendar.nextEvent.meetLink } : null,
      };
    }
  } catch {}

  let github = null;
  if (isGitHubConfigured()) {
    try { github = await getGitHubDashSummary(); } catch {}
  }

  return {
    character: { name: char.name, voice: char.voice },
    status: {
      activity: status.activity,
      focusMode: status.focusMode,
      energy: status.energy,
      app: status.activeApp?.appName ?? null,
      appTitle: status.activeApp?.title ?? null,
      sessionMinutes: Math.round((Date.now() - status.sessionStartedAt) / 60000),
      idleMinutes: status.idleMinutes,
    },
    score: { value: score.score, label: score.label, codingMinutes: score.codingMinutes, browsingMinutes: score.browsingMinutes, totalMinutes: score.totalMinutes, focusRatio: score.focusRatio },
    weeklyScores: weeklyScores.map(s => ({ date: s.date, score: s.score, label: s.label })),
    todayStats: { totalMinutes: todayStats.totalMinutes, activities: todayStats.byActivity },
    tasks: tasks.slice(0, 20).map(t => ({ id: t.id, title: t.title, priority: t.priority, status: t.status, deadline: t.deadline, person: t.person })),
    projects: projects.map(p => ({ project: p.project, minutes: p.minutes })),
    currentProject: { project, branch },
    streak: { days: streak.days, best: streak.best, todayQualifies: streak.todayQualifies },
    pomo: { today: pomo.today, totalMinutes: pomo.totalMinutes },
    music: track,
    nudge,
    calendar,
    meetingAlert,
    github,
    integrations: { googleAuth: isAuthenticated(), github: isGitHubConfigured() },
    timestamp: Date.now(),
  };
}

// ─── HTTP Helpers ───────────────────────────────────────────────

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

// ─── Conversation History (per-session, in memory) ──────────────
const conversationHistory: ChatMessage[] = [];

// ─── Route Handler ──────────────────────────────────────────────

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

  // ── Core State ──
  if (path === "/api/state") {
    const state = await getFullState();
    json(res, state);
    return;
  }

  if (path === "/api/status") {
    const report = await getStatusReport();
    json(res, { report });
    return;
  }

  // ── Mode Controls ──
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

  // ── Music ──
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

  // ── AI Chat ──
  if (path === "/api/ask" && method === "POST") {
    const body = await readBody(req);
    const question = String(body.question ?? "").trim();
    if (!question) {
      json(res, { error: "Missing 'question' in request body" }, 400);
      return;
    }
    try {
      const char = getCharacter();
      const response = await runAgent(question, { history: conversationHistory });
      conversationHistory.push({ role: "user", content: question });
      conversationHistory.push({ role: "assistant", content: response });
      // Keep history manageable
      if (conversationHistory.length > 20) conversationHistory.splice(0, 2);

      // Generate TTS audio
      const ttsPath = await generateTTS(response);
      // Play it in the background (non-blocking)
      if (ttsPath) {
        spawn("afplay", [ttsPath], { stdio: "ignore", detached: true }).unref();
      }

      json(res, { ok: true, character: char.name, response, spoken: !!ttsPath });
    } catch (err) {
      json(res, { error: err instanceof Error ? err.message : "AI error" }, 500);
    }
    return;
  }

  // ── Voice (transcribe audio file + AI respond + TTS) ──
  if (path === "/api/voice" && method === "POST") {
    try {
      const wavPath = join(JANJAK_DIR, ".overlay-recording.wav");
      
      // Read the raw body as audio data
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const audioData = Buffer.concat(chunks);
      
      if (audioData.length < 5000) {
        json(res, { error: "Audio too short" }, 400);
        return;
      }
      
      writeFileSync(wavPath, audioData);

      // Transcribe
      const transcript = await transcribeFile(wavPath);
      if (!transcript) {
        json(res, { error: "Could not transcribe audio", transcript: "" }, 400);
        return;
      }

      const char = getCharacter();

      // Check for task creation
      if (looksLikeTaskCreation(transcript)) {
        const task = await createTaskFromText(transcript);
        if (task) {
          const confirmation = formatSpokenConfirmation(task);
          const ttsPath = await generateTTS(confirmation);
          if (ttsPath) spawn("afplay", [ttsPath], { stdio: "ignore", detached: true }).unref();
          json(res, { ok: true, character: char.name, transcript, response: confirmation, action: "task_created", task, spoken: !!ttsPath });
          return;
        }
      }

      // Check for morning briefing
      if (/\b(good morning|bonjour|bon matin|brief me|start my day)\b/i.test(transcript)) {
        const briefing = await getSpokenBriefing();
        const ttsPath = await generateTTS(briefing);
        if (ttsPath) spawn("afplay", [ttsPath], { stdio: "ignore", detached: true }).unref();
        json(res, { ok: true, character: char.name, transcript, response: briefing, action: "morning_briefing", spoken: !!ttsPath });
        return;
      }

      // Normal AI response
      const response = await runAgent(transcript, { history: conversationHistory });
      conversationHistory.push({ role: "user", content: transcript });
      conversationHistory.push({ role: "assistant", content: response });
      if (conversationHistory.length > 20) conversationHistory.splice(0, 2);

      const ttsPath = await generateTTS(response);
      if (ttsPath) spawn("afplay", [ttsPath], { stdio: "ignore", detached: true }).unref();

      json(res, { ok: true, character: char.name, transcript, response, spoken: !!ttsPath });
    } catch (err) {
      json(res, { error: err instanceof Error ? err.message : "Voice error" }, 500);
    }
    return;
  }

  // ── Text-to-Speech only ──
  if (path === "/api/speak" && method === "POST") {
    const body = await readBody(req);
    const text = String(body.text ?? "").trim();
    if (!text) {
      json(res, { error: "Missing 'text'" }, 400);
      return;
    }
    const ttsPath = await generateTTS(text, body.voice as string | undefined);
    if (ttsPath) spawn("afplay", [ttsPath], { stdio: "ignore", detached: true }).unref();
    json(res, { ok: true, spoken: !!ttsPath });
    return;
  }

  // ── Remind (natural language task creation) ──
  if (path === "/api/remind" && method === "POST") {
    const body = await readBody(req);
    const text = String(body.text ?? "").trim();
    if (!text) {
      json(res, { error: "Missing 'text'" }, 400);
      return;
    }
    try {
      const task = await createTaskFromText(text);
      if (task) {
        const confirmation = formatSpokenConfirmation(task);
        const ttsPath = await generateTTS(confirmation);
        if (ttsPath) spawn("afplay", [ttsPath], { stdio: "ignore", detached: true }).unref();
        json(res, { ok: true, task, confirmation, spoken: !!ttsPath });
      } else {
        json(res, { ok: false, error: "Could not parse task from text" });
      }
    } catch (err) {
      json(res, { error: err instanceof Error ? err.message : "Task creation error" }, 500);
    }
    return;
  }

  // ── Tasks ──
  if (path === "/api/tasks") {
    const tasks = getTasks();
    json(res, { tasks: tasks.map(t => ({ id: t.id, title: t.title, priority: t.priority, status: t.status, deadline: t.deadline, person: t.person })) });
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

  // ── Calendar ──
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

  // ── Morning Briefing ──
  if (path === "/api/morning" && method === "POST") {
    try {
      const briefing = await getSpokenBriefing();
      const ttsPath = await generateTTS(briefing);
      if (ttsPath) spawn("afplay", [ttsPath], { stdio: "ignore", detached: true }).unref();
      json(res, { ok: true, briefing, spoken: !!ttsPath });
    } catch (err) {
      json(res, { error: err instanceof Error ? err.message : "Briefing error" }, 500);
    }
    return;
  }

  // ── Character ──
  if (path === "/api/character") {
    if (method === "GET") {
      json(res, { character: getState("character") ?? "janjak", characters: Object.keys(CHARACTERS) });
      return;
    }
    if (method === "POST") {
      const body = await readBody(req);
      const name = String(body.name ?? "").toLowerCase();
      if (!CHARACTERS[name]) {
        json(res, { error: `Unknown character. Choose: ${Object.keys(CHARACTERS).join(", ")}` }, 400);
        return;
      }
      setState("character", name);
      json(res, { ok: true, character: name, voice: CHARACTERS[name]!.voice });
      return;
    }
  }

  // ── Alerts ──
  if (path === "/api/alerts") {
    try {
      const alerts = await getProactiveAlerts();
      json(res, { alerts });
    } catch { json(res, { alerts: [] }); }
    return;
  }

  // ── Autonomy ──
  if (path === "/api/autonomy") {
    if (method === "GET") {
      json(res, {
        enabled: isAutonomyEnabled(),
        tiers: { auto: isTierEnabled("auto"), confirm: isTierEnabled("confirm") },
        pending: getPendingActions(),
        log: getActionLog().slice(-20),
      });
      return;
    }
    if (method === "POST") {
      const body = await readBody(req);
      const action = String(body.action ?? "").trim();
      if (action === "enable") {
        setAutonomyEnabled(true);
        json(res, { ok: true, enabled: true });
      } else if (action === "disable") {
        setAutonomyEnabled(false);
        for (const id of getPendingActions()) cancelPending(id);
        json(res, { ok: true, enabled: false });
      } else if (action === "cancel") {
        const pending = getPendingActions();
        for (const id of pending) cancelPending(id);
        json(res, { ok: true, cancelled: pending.length });
      } else {
        json(res, { error: "Invalid action. Use: enable, disable, cancel" }, 400);
      }
      return;
    }
  }

  // ── Workflows ──
  if (path === "/api/workflows") {
    if (method === "GET") {
      json(res, {
        enabled: isWorkflowsEnabled(),
        workflows: getAllWorkflows().map(w => ({
          id: w.id, name: w.name, description: w.description,
          trigger: w.trigger, enabled: w.enabled, builtin: w.builtin,
        })),
        log: getWorkflowLog().slice(-20),
      });
      return;
    }
    if (method === "POST") {
      const body = await readBody(req);
      const action = String(body.action ?? "").trim();
      if (action === "enable" || action === "disable") {
        const wfId = String(body.id ?? "").trim();
        if (!wfId) { json(res, { error: "Missing 'id'" }, 400); return; }
        setWorkflowEnabled(wfId, action === "enable");
        json(res, { ok: true, id: wfId, enabled: action === "enable" });
      } else if (action === "run") {
        const wfId = String(body.id ?? "").trim();
        if (!wfId) { json(res, { error: "Missing 'id'" }, 400); return; }
        const result = await runWorkflowById(wfId);
        if (result) {
          json(res, { ok: true, result });
        } else {
          json(res, { error: "Workflow not found" }, 404);
        }
      } else if (action === "on") {
        setWorkflowsEnabled(true);
        json(res, { ok: true, enabled: true });
      } else if (action === "off") {
        setWorkflowsEnabled(false);
        json(res, { ok: true, enabled: false });
      } else {
        json(res, { error: "Invalid action. Use: enable, disable, run, on, off" }, 400);
      }
      return;
    }
  }

  // ── Health ──
  if (path === "/api/health") {
    json(res, { ok: true, daemon: true, port: PORT, character: getCharacter().name, uptime: process.uptime() });
    return;
  }

  // ── Serve web dashboard ──
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

  json(res, { error: "Not found" }, 404);
}

// ─── Server Lifecycle ───────────────────────────────────────────

export function startDaemon(): Promise<void> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        console.error("Daemon error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      });
    });

    server.listen(PORT, "127.0.0.1", () => {
      // Write PID file
      writeFileSync(PID_FILE, String(process.pid));

      const char = getCharacter();
      console.log(`\n🧠 ${char.name} Daemon — running on port ${PORT}`);
      console.log(`   API:   http://localhost:${PORT}/api/health`);
      console.log(`   Web:   http://localhost:${PORT}`);
      console.log(`   PID:   ${process.pid}`);
      console.log(`\n   Press ⌘⇧J from anywhere to activate the overlay.\n`);

      // Start background monitoring
      startMonitor(10000);

      // Start proactive engine with autonomous execution
      startProactiveEngine(async (alert) => {
        await executeAutonomously(alert);
      });

      if (isAutonomyEnabled()) {
        console.log(`   🤖 Autonomy: ON`);
      }

      resolve();
    });

    const shutdown = () => {
      console.log("\n\n👋 Daemon shutting down...");
      stopProactiveEngine();
      stopMonitor();
      try { unlinkSync(PID_FILE); } catch {}
      server.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

/** Check if daemon is running */
export function isDaemonRunning(): boolean {
  if (!existsSync(PID_FILE)) return false;
  const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
  try {
    process.kill(pid, 0); // Test if process exists
    return true;
  } catch {
    // Stale PID file
    try { unlinkSync(PID_FILE); } catch {}
    return false;
  }
}

/** Stop the running daemon */
export function stopDaemon(): boolean {
  if (!existsSync(PID_FILE)) return false;
  const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
  try {
    process.kill(pid, "SIGTERM");
    try { unlinkSync(PID_FILE); } catch {}
    return true;
  } catch {
    try { unlinkSync(PID_FILE); } catch {}
    return false;
  }
}

/** Get daemon PID */
export function getDaemonPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  return parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
}

export const DAEMON_PORT = PORT;

#!/usr/bin/env node
// ─── Janjak: Ambient Intelligence Assistant ────────────────────────
// "An AI that understands what you're doing, predicts what you need,
//  and subtly acts." — Jarvis for builders.

import { config } from "dotenv";
import { join, dirname, resolve, isAbsolute, extname, basename } from "node:path";
import { homedir } from "node:os";
import { existsSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import open from "open";

// Load env vars from ~/.janjak/.env
config({ path: join(homedir(), ".janjak", ".env"), quiet: true });

import { Command } from "commander";
import { enterFocusMode, enterBreakMode, exitFocusMode, flushSession } from "./engine.js";
import { getStatusReport, startMonitor, stopMonitor } from "./monitor.js";
import { getDayOverview, getAIDailyPlan } from "./planner.js";
import { getCurrentTrack, pauseMusic, resumeMusic } from "./music.js";
import { closeDb, setState, getState, resetTrackedData } from "./db.js";
import { runOAuthFlow, isAuthenticated } from "./gmail-auth.js";
import { searchEmails, getEmailById } from "./gmail-client.js";
import { processInbox, formatInboxReport, formatAllTasks, updateTaskStatus } from "./tasks.js";
import { formatInsights } from "./memory.js";
import { getTodayScore, getWeeklyScores, formatWeeklyReport, getAIWeeklySummary } from "./score.js";
import { runAgent } from "./agent/agent.js";
import { sendNotification, notificationsAvailable } from "./notify.js";
import { startPomodoro, getPomodoroStats } from "./pomo.js";
import { formatStreakBadge, formatStreakReport } from "./streak.js";
import { formatProjectsReport, detectCurrentProjectNow } from "./project.js";
import { startDashboard } from "./dashboard.js";
import { installAutoStart, uninstallAutoStart, autoStartStatus } from "./autostart.js";
import { formatCalendarReport } from "./calendar.js";
import { formatGitHubReport, isGitHubConfigured } from "./github.js";
import { startWebDashboard } from "./web.js";
import { launchMenuBar, buildMenuBar } from "./menubar.js";
import { startSetupWizard } from "./setup.js";
import { startProactiveEngine, stopProactiveEngine, formatAlert, type ProactiveAlert } from "./proactive.js";
import { executeAutonomously, isAutonomyEnabled, setAutonomyEnabled, setTierEnabled, formatAutonomyStatus, formatActionLog, cancelPending, getPendingActions, getActionBaseTier, type SafetyTier } from "./autonomy.js";
import { draftAndOpen, generateReply, getTaskById, formatReplyPreview } from "./reply.js";
import { voiceCommand, getVoiceLanguageMode, setVoiceLanguageMode, formatVoiceLanguageMode, type VoiceLanguageMode } from "./voice.js";
import { generateMorningBriefing } from "./morning.js";
import { createTaskFromText, formatCreatedTask } from "./nl-tasks.js";
import { startDaemon, stopDaemon, isDaemonRunning, getDaemonPid, DAEMON_PORT } from "./daemon.js";
import { buildOverlay, launchOverlay } from "./overlay.js";
import { getOpenWindows, formatOpenWindows } from "./windows.js";
import { capture, recall, formatHits } from "./memory/recall.js";
import { generateDocument, inferFormat, slugify, SUPPORTED_FORMATS, readDocument } from "./doc.js";
import { countMemories, deleteMemory, listMemories, type MemoryType } from "./memory/vector-store.js";
import { ingestAll, formatIngestReport } from "./memory/ingest.js";
import {
  formatEntityList,
  formatEntityNetwork,
  formatEntityProfile,
  formatGraphSync,
  getEntityNetwork,
  getEntityProfile,
  getTopEntities,
  rebuildGraphStats,
  syncMemoryToGraph,
} from "./graph/query.js";
import type { EntityType } from "./graph/entities.js";
import { deleteEntityByName } from "./graph/entities.js";
import { writeExport, formatExportSummary } from "./privacy.js";
import {
  formatPersonalModel,
  synthesizePersonalModel,
} from "./personal/synthesis.js";
import {
  upsertPreference,
  deletePreference,
  PREFERENCE_CATEGORIES,
  type PreferenceCategory,
} from "./personal/profile.js";
import {
  addGoal,
  listGoals,
  completeGoal,
  deleteGoal,
  GOAL_CATEGORIES,
  type GoalCategory,
} from "./personal/goals.js";
import { formatFeedbackReport } from "./learning/feedback.js";
import {
  formatExplanation,
  getDecisionById,
  getLastDecision,
} from "./learning/explain.js";
import { adaptFromFeedback, formatAdaptations } from "./learning/adapt.js";
import {
  runDailyConsolidation,
  formatDailyConsolidation,
  formatTodaySummary,
} from "./synthesis/daily.js";
import { gatherWeeklyReview, formatWeeklyReview } from "./synthesis/weekly.js";

function confirmPrompt(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^(y|yes)$/i.test(answer.trim()));
    });
  });
}

function textPrompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const program = new Command();

program
  .name("janjak")
  .description(
    "🧠 Janjak — Your ambient intelligence assistant.\n" +
    "   Observes → Infers → Assists → Stays out of the way."
  )
  .version("1.0.0");

// ── focus ──────────────────────────────────────────────────────────
program
  .command("focus")
  .description("Enter deep work mode. Plays focus music, suggests a task to tackle.")
  .action(async () => {
    const msg = await enterFocusMode();
    console.log(msg);
    console.log("\n  Use `janjak status` to check in.");
    console.log("  Use `janjak break` when you need rest.");
  });

// ── break ──────────────────────────────────────────────────────────
program
  .command("break")
  .description("Take a break. Switches to chill music.")
  .action(async () => {
    const msg = await enterBreakMode();
    console.log(msg);
    console.log("\n  Use `janjak focus` to get back at it.");
  });

// ── stop ───────────────────────────────────────────────────────────
program
  .command("stop")
  .description("End current session. Pauses music.")
  .action(async () => {
    const msg = await exitFocusMode();
    console.log(msg);
  });

// ── status ─────────────────────────────────────────────────────────
program
  .command("status")
  .description("Show current state: what you're doing, energy, session time.")
  .action(async () => {
    const report = await getStatusReport();
    console.log(report);
    const streak = formatStreakBadge();
    if (streak) console.log(`  ${streak}`);
    const pomo = getPomodoroStats();
    if (pomo.today > 0) console.log(`  🍅 ${pomo.today} pomodoro${pomo.today > 1 ? "s" : ""} today (${pomo.totalMinutes}m)`);
  });

// ── day ────────────────────────────────────────────────────────────
program
  .command("day")
  .description("Today's overview: activity breakdown + smart suggestions. Use --ai for AI plan.")
  .option("--ai", "Generate an AI-powered daily plan (requires OPENAI_API_KEY)")
  .action(async (opts) => {
    if (opts.ai) {
      console.log("🤖 Generating AI daily plan...\n");
      const plan = await getAIDailyPlan();
      console.log(plan);
    } else {
      const overview = getDayOverview();
      console.log(overview);
    }
  });

// ── watch ──────────────────────────────────────────────────────────
program
  .command("watch")
  .description("Start ambient monitoring. Polls every 10s. Nudges when needed.")
  .option("-i, --interval <seconds>", "Poll interval in seconds", "10")
  .option("--notify", "Send macOS desktop notifications for nudges")
  .action(async (opts) => {
    const interval = parseInt(opts.interval, 10) * 1000;
    const useNotify = opts.notify && notificationsAvailable();

    console.log("👁️  Janjak is watching. Ambient mode active.");
    if (useNotify) console.log("   🔔 Desktop notifications ON");
    if (isAutonomyEnabled()) console.log("   🤖 Autonomy ON — Janjak will act on its own");
    console.log("   Press Ctrl+C to stop.\n");

    // Show initial status
    const report = await getStatusReport();
    console.log(report);

    let lastNudgeMsg = "";
    const recentAlerts: string[] = [];

    startMonitor(interval, {
      onRender: (status) => {
        // Clear screen and re-render dashboard
        process.stdout.write("\x1B[2J\x1B[H");
        console.log("👁️  Janjak is watching. Ambient mode active.");
        if (useNotify) console.log("   🔔 Desktop notifications ON");
        console.log("   🧠 Proactive alerts ON");
        console.log("   Press Ctrl+C to stop.\n");
        console.log(status);
        if (recentAlerts.length > 0) {
          console.log("\n  ── Alerts ──");
          for (const a of recentAlerts.slice(-3)) console.log(`  ${a}`);
        } else if (lastNudgeMsg) {
          console.log(`\n  ${lastNudgeMsg}`);
        }
      },
      onNudge: (nudge) => {
        lastNudgeMsg = nudge;
        if (useNotify) {
          sendNotification(nudge, "Janjak", "Nudge");
        }
      },
    });

    // Start proactive alert engine (checks every 30s)
    startProactiveEngine(async (alert: ProactiveAlert) => {
      // Try autonomous execution first
      const handled = await executeAutonomously(alert);

      const formatted = formatAlert(alert);
      if (handled) {
        recentAlerts.push(`🤖 ${formatted}`);
      } else {
        recentAlerts.push(formatted);
      }
      if (recentAlerts.length > 10) recentAlerts.shift();
      if (useNotify && !handled) {
        sendNotification(alert.message, "Janjak", alert.title);
      }
    });

    // Keep process alive + handle graceful shutdown
    const shutdown = () => {
      console.log("\n\n👋 Janjak signing off. See you.");
      stopProactiveEngine();
      stopMonitor();
      flushSession();
      closeDb();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

// ── music ──────────────────────────────────────────────────────────
program
  .command("music")
  .description("Music controls: now playing, pause, resume.")
  .argument("[action]", "pause | resume | now", "now")
  .action(async (action: string) => {
    switch (action) {
      case "pause":
        await pauseMusic();
        console.log("⏸️  Music paused.");
        break;
      case "resume":
        await resumeMusic();
        console.log("▶️  Music resumed.");
        break;
      case "now":
      default: {
        const track = await getCurrentTrack();
        if (track) {
          console.log(`🎵 Now playing: ${track}`);
        } else {
          console.log("🔇 Nothing playing right now.");
        }
        break;
      }
    }
  });

// ── notify ─────────────────────────────────────────────────────────
program
  .command("notify")
  .description("Send a test macOS desktop notification.")
  .argument("[message]", "Custom message", "🧠 Janjak is watching. Stay focused!")
  .action((message: string) => {
    if (!notificationsAvailable()) {
      console.log("⚠️  Desktop notifications not available (macOS only).");
      return;
    }
    sendNotification(message, "Janjak", "Test Notification");
    console.log("🔔 Notification sent! Check your desktop.");
  });

// ── pomo ───────────────────────────────────────────────────────────
program
  .command("pomo")
  .description("Start a Pomodoro timer (25/5 cycles). Auto-cycles focus/break.")
  .option("-w, --work <minutes>", "Work duration in minutes", "25")
  .option("-s, --short <minutes>", "Short break duration", "5")
  .option("-l, --long <minutes>", "Long break duration", "15")
  .option("--no-notify", "Disable desktop notifications")
  .action(async (opts) => {
    await startPomodoro({
      work: parseInt(opts.work, 10),
      short: parseInt(opts.short, 10),
      long: parseInt(opts.long, 10),
      notify: opts.notify !== false,
    });
  });

// ── streak ─────────────────────────────────────────────────────────
program
  .command("streak")
  .description("Show your focus streak and milestones.")
  .action(() => {
    const report = formatStreakReport();
    console.log(report);
  });

// ── projects ───────────────────────────────────────────────────────
program
  .command("projects")
  .description("Show time spent per project (detected from window titles).")
  .option("-d, --days <n>", "Number of days to look back", "7")
  .action((opts) => {
    const days = parseInt(opts.days, 10);
    const report = formatProjectsReport(days);
    console.log(report);
  });

// ── project ────────────────────────────────────────────────────────
program
  .command("project")
  .description("Show the project inferred from your currently active window.")
  .action(async () => {
    const current = await detectCurrentProjectNow();

    console.log("\n📍 Current Work Context\n");
    console.log(`  App: ${current.appName}`);
    if (current.title) {
      const title = current.title.length > 120 ? `${current.title.slice(0, 117)}...` : current.title;
      console.log(`  Window: ${title}`);
    }

    if (current.project) {
      const branch = current.branch ? ` [${current.branch}]` : "";
      console.log(`\n  📂 Project: ${current.project}${branch}\n`);
    } else {
      console.log("\n  📂 Project: not detected from current window title\n");
    }
  });

// ── windows ────────────────────────────────────────────────────────
program
  .command("windows")
  .description("List currently open app windows across the machine (macOS snapshot).")
  .option("-n, --limit <n>", "Maximum windows to show", "40")
  .action(async (opts) => {
    const limit = Math.max(1, parseInt(opts.limit, 10) || 40);
    const windows = await getOpenWindows();
    console.log(formatOpenWindows(windows, limit));
  });

// ── memory: note / recall / list / forget ──────────────────────────
const VALID_MEMORY_TYPES: MemoryType[] = [
  "note",
  "session",
  "email",
  "task",
  "voice",
  "ai_chat",
  "calendar",
  "github",
  "daily_summary",
];

const VALID_ENTITY_TYPES: EntityType[] = [
  "person",
  "project",
  "topic",
  "organization",
  "place",
];

program
  .command("note <text...>")
  .description("Capture a manual note into Janjak's semantic memory.")
  .option("--importance <n>", "Importance score 0-1 (default 0.7)", "0.7")
  .option("--no-embed", "Store locally without sending the text to the embedding API")
  .action(async (textParts: string[], opts: { importance: string; embed?: boolean }) => {
    const text = textParts.join(" ").trim();
    if (!text) {
      console.error("Note text is empty.");
      process.exit(1);
    }
    const importance = Math.max(0, Math.min(1, parseFloat(opts.importance) || 0.7));
    const noEmbed = opts.embed === false;
    try {
      const id = await capture({
        type: "note",
        text,
        importance,
        metadata: { source: "cli" },
        noEmbed,
      });
      const tag = noEmbed ? " · 🔒 private (not embedded)" : "";
      console.log(`\n  📝 Saved note #${id} (importance ${importance.toFixed(2)})${tag}\n`);
    } catch (err) {
      console.error(`\n  Failed to save note: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

program
  .command("doc <prompt...>")
  .description("Generate a document (md, txt, html, pdf, docx, doc, rtf, odt) from a prompt.")
  .option("-o, --out <path>", "Output file path (its extension selects the format)")
  .option("-f, --format <fmt>", `Output format: ${SUPPORTED_FORMATS.join(", ")}`)
  .option("--from-email <query>", "Base the document on a received email (Gmail search, e.g. \"from:sarah launch\")")
  .option("--from-task <id>", "Base the document on a task Janjak extracted from your inbox")
  .option("--context", "Ground the document in what Janjak knows about you")
  .option("--model <model>", "OpenAI model to use (default gpt-4o-mini)")
  .option("--open", "Open the document after it is created")
  .action(async (
    promptParts: string[],
    opts: { out?: string; format?: string; fromEmail?: string; fromTask?: string; context?: boolean; model?: string; open?: boolean }
  ) => {
    const prompt = promptParts.join(" ").trim();
    if (!prompt) {
      console.error("Document prompt is empty.");
      process.exit(1);
    }

    let format;
    try {
      format = inferFormat(opts.format, opts.out);
    } catch (err) {
      console.error(`\n  ${(err as Error).message}\n`);
      process.exit(1);
    }

    // Optionally ground the document in specific source material.
    const sourceParts: string[] = [];

    if (opts.fromEmail) {
      if (!isAuthenticated()) {
        console.error("\n  Not connected to Gmail. Run: janjak login\n");
        process.exit(1);
      }
      try {
        const matches = await searchEmails(opts.fromEmail, 5);
        if (matches.length === 0) {
          console.error(`\n  No email matched "${opts.fromEmail}".\n`);
          process.exit(1);
        }
        const email = matches[0];
        const when = new Date(email.date).toISOString().slice(0, 10);
        sourceParts.push(
          `From: ${email.from}\nSubject: ${email.subject}\nDate: ${when}\n\n${email.body}`
        );
        console.log(`\n  📧 Using email: "${email.subject}" from ${email.from} (${when})`);
      } catch (err) {
        console.error(`\n  Could not read email: ${(err as Error).message}\n`);
        process.exit(1);
      }
    }

    if (opts.fromTask) {
      const taskId = parseInt(opts.fromTask, 10);
      if (Number.isNaN(taskId)) {
        console.error(`\n  Invalid task id "${opts.fromTask}".\n`);
        process.exit(1);
      }
      const task = getTaskById(taskId);
      if (!task) {
        console.error(`\n  No task found with id ${taskId}. See: janjak tasks\n`);
        process.exit(1);
      }

      // Prefer the full original email when it is still reachable; otherwise
      // fall back to the details Janjak stored about the task.
      let added = false;
      if (task.sourceEmailId && isAuthenticated()) {
        try {
          const email = await getEmailById(task.sourceEmailId);
          if (email) {
            const when = new Date(email.date).toISOString().slice(0, 10);
            sourceParts.push(
              `From: ${email.from}\nSubject: ${email.subject}\nDate: ${when}\n\n${email.body}`
            );
            added = true;
          }
        } catch {
          // fall back to stored task fields below
        }
      }
      if (!added) {
        const lines = [
          `Task: ${task.title}`,
          task.person ? `From: ${task.person}` : "",
          task.sourceSubject ? `Subject: ${task.sourceSubject}` : "",
          task.deadline ? `Deadline: ${task.deadline}` : "",
          task.description ? `\n${task.description}` : "",
        ].filter(Boolean);
        sourceParts.push(lines.join("\n"));
      }
      console.log(`\n  📋 Using task #${taskId}: ${task.title}`);
    }

    const source = sourceParts.length ? sourceParts.join("\n\n---\n\n") : undefined;

    const ext = format === "markdown" ? "md" : format;
    let outPath: string;
    if (opts.out) {
      outPath = isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out);
      if (!extname(outPath)) outPath += `.${ext}`;
    } else {
      outPath = resolve(process.cwd(), `${slugify(prompt)}.${ext}`);
    }

    console.log(`\n  ✍️  Generating ${ext.toUpperCase()} document…`);
    try {
      const doc = await generateDocument({
        prompt,
        outPath,
        format,
        model: opts.model,
        useContext: !!opts.context,
        source,
      });
      console.log(`  ✓ ${doc.title}`);
      console.log(`  📄 ${doc.path}\n`);
      if (opts.open) {
        try { await open(doc.path); } catch {}
      }
    } catch (err) {
      console.error(`\n  Failed to generate document: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

program
  .command("recall <query...>")
  .description("Semantic search across everything Janjak remembers.")
  .option("-n, --limit <n>", "Max hits to return", "8")
  .option("-t, --type <type>", "Filter by memory type (note, email, voice, ...)")
  .option("-d, --days <n>", "Only consider memories from the last N days")
  .option("--min-importance <n>", "Filter by minimum importance (0-1)")
  .option("--min-similarity <n>", "Filter out weak semantic matches (0-1)", "0.18")
  .action(async (queryParts: string[], opts: { limit: string; type?: string; days?: string; minImportance?: string; minSimilarity?: string }) => {
    const query = queryParts.join(" ").trim();
    if (!query) {
      console.error("Query is empty.");
      process.exit(1);
    }
    const limit = Math.max(1, parseInt(opts.limit, 10) || 8);
    const searchOpts: Parameters<typeof recall>[1] = { limit };
    if (opts.type) {
      if (!VALID_MEMORY_TYPES.includes(opts.type as MemoryType)) {
        console.error(`Invalid --type. Use one of: ${VALID_MEMORY_TYPES.join(", ")}`);
        process.exit(1);
      }
      searchOpts.types = [opts.type as MemoryType];
    }
    if (opts.days) {
      const d = parseInt(opts.days, 10);
      if (!Number.isNaN(d) && d > 0) searchOpts.daysBack = d;
    }
    if (opts.minImportance) {
      const m = parseFloat(opts.minImportance);
      if (!Number.isNaN(m)) searchOpts.minImportance = m;
    }
    if (opts.minSimilarity) {
      const s = parseFloat(opts.minSimilarity);
      if (!Number.isNaN(s)) searchOpts.minSimilarity = Math.max(0, Math.min(1, s));
    }
    try {
      const hits = await recall(query, searchOpts);
      console.log(formatHits(hits));
    } catch (err) {
      console.error(`\n  Recall failed: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

program
  .command("memory")
  .description("Inspect Janjak's semantic memory store.")
  .option("-n, --limit <n>", "Number of recent memories to show", "20")
  .option("-t, --type <type>", "Filter by memory type")
  .action((opts: { limit: string; type?: string }) => {
    const limit = Math.max(1, parseInt(opts.limit, 10) || 20);
    const type = opts.type as MemoryType | undefined;
    if (type && !VALID_MEMORY_TYPES.includes(type)) {
      console.error(`Invalid --type. Use one of: ${VALID_MEMORY_TYPES.join(", ")}`);
      process.exit(1);
    }
    const total = countMemories();
    const rows = listMemories(limit, type);
    console.log(`\n🧠 Memory — ${total} total row${total === 1 ? "" : "s"}, showing ${rows.length}\n`);
    if (rows.length === 0) {
      console.log("  (empty)\n");
      return;
    }
    for (const row of rows) {
      const date = new Date(row.timestamp).toISOString().slice(0, 16).replace("T", " ");
      const snippet = row.text.length > 100 ? row.text.slice(0, 97) + "..." : row.text;
      console.log(`  [#${row.id}] ${row.type.padEnd(14)} ${date}  imp=${row.importance.toFixed(2)}`);
      console.log(`         ${snippet.replace(/\n+/g, " ")}`);
    }
    console.log();
  });

program
  .command("forget [id]")
  .description("Delete a memory by id, or an entire entity with --entity \"<name>\".")
  .option("--entity <name>", "Delete an entity and all of its related memories")
  .action((id: string | undefined, opts: { entity?: string }) => {
    if (opts.entity) {
      const result = deleteEntityByName(opts.entity);
      if (!result) {
        console.log(`\n  No entity found matching "${opts.entity}"\n`);
        return;
      }
      console.log(
        `\n  🗑️  Removed entity "${result.entityName}" — ` +
          `${result.memoriesDeleted} memories, ${result.mentionsDeleted} mentions, ` +
          `${result.relationshipsDeleted} relationships deleted.\n`
      );
      return;
    }
    if (!id) {
      console.error("Provide a memory id, or use --entity \"<name>\".");
      process.exit(1);
    }
    const n = parseInt(id, 10);
    if (Number.isNaN(n)) {
      console.error("Invalid id.");
      process.exit(1);
    }
    const ok = deleteMemory(n);
    console.log(ok ? `\n  Deleted memory #${n}\n` : `\n  No memory found with id #${n}\n`);
  });

program
  .command("export")
  .description("Export all local memory, entities, preferences, goals & routines as JSON.")
  .option("--out <file>", "Write to a specific path (default ~/.janjak/janjak-export-<date>.json)")
  .action((opts: { out?: string }) => {
    try {
      const { path, data } = writeExport(opts.out);
      console.log(formatExportSummary(path, data));
    } catch (err) {
      console.error(`\n  Export failed: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

program
  .command("ingest")
  .description("Backfill semantic memory from existing tasks and sessions.")
  .option("--tasks-only", "Only ingest tasks")
  .option("--sessions-only", "Only ingest sessions")
  .option("--task-limit <n>", "Max tasks to embed", "500")
  .option("--session-days <n>", "Session lookback in days", "30")
  .option("--session-min-minutes <n>", "Skip sessions shorter than this", "5")
  .action(async (opts: { tasksOnly?: boolean; sessionsOnly?: boolean; taskLimit: string; sessionDays: string; sessionMinMinutes: string }) => {
    const taskLimit = Math.max(1, parseInt(opts.taskLimit, 10) || 500);
    const sessionDays = Math.max(1, parseInt(opts.sessionDays, 10) || 30);
    const sessionMinMinutes = Math.max(0, parseInt(opts.sessionMinMinutes, 10) || 5);
    const includeTasks = !opts.sessionsOnly;
    const includeSessions = !opts.tasksOnly;
    console.log("\n  Embedding existing data (this may take a minute)...\n");
    try {
      const results = await ingestAll({ taskLimit, sessionDays, sessionMinMinutes, includeTasks, includeSessions });
      console.log(formatIngestReport(results));
    } catch (err) {
      console.error(`\n  Ingest failed: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

program
  .command("entities")
  .description("List the strongest entities in Janjak's knowledge graph.")
  .option("-n, --limit <n>", "Number of entities to show", "20")
  .option("-t, --type <type>", "Filter by entity type")
  .option("--sync", "Extract entities from memory before listing")
  .option("--rebuild-stats", "Recompute entity mention stats from stored mentions")
  .option("--days <n>", "Only sync memories from the last N days")
  .option("--force", "Reprocess memories even if already extracted")
  .action(async (opts: { limit: string; type?: string; sync?: boolean; rebuildStats?: boolean; days?: string; force?: boolean }) => {
    const limit = Math.max(1, parseInt(opts.limit, 10) || 20);
    const type = opts.type as EntityType | undefined;
    if (type && !VALID_ENTITY_TYPES.includes(type)) {
      console.error(`Invalid --type. Use one of: ${VALID_ENTITY_TYPES.join(", ")}`);
      process.exit(1);
    }

    if (opts.sync) {
      try {
        const days = opts.days ? parseInt(opts.days, 10) : undefined;
        const progress = await syncMemoryToGraph({ limit: Math.max(limit * 3, 50), daysBack: days, force: opts.force });
        console.log(formatGraphSync(progress));
      } catch (err) {
        console.error(`\n  Entity sync failed: ${(err as Error).message}\n`);
        process.exit(1);
      }
    }

    if (opts.rebuildStats) {
      try {
        rebuildGraphStats();
        console.log("\n🛠️ Rebuilt entity stats from stored mentions.\n");
      } catch (err) {
        console.error(`\n  Stats rebuild failed: ${(err as Error).message}\n`);
        process.exit(1);
      }
    }

    console.log(formatEntityList(getTopEntities(limit, type)));
  });

program
  .command("who <name...>")
  .description("Show Janjak's profile for a person, project, topic, org, or place.")
  .option("--sync", "Extract entities from recent memory before querying")
  .action(async (nameParts: string[], opts: { sync?: boolean }) => {
    const name = nameParts.join(" ").trim();
    if (!name) {
      console.error("Name is empty.");
      process.exit(1);
    }
    if (opts.sync) {
      try {
        const progress = await syncMemoryToGraph({ limit: 50 });
        console.log(formatGraphSync(progress));
      } catch (err) {
        console.error(`\n  Entity sync failed: ${(err as Error).message}\n`);
        process.exit(1);
      }
    }
    console.log(formatEntityProfile(getEntityProfile(name)));
  });

program
  .command("network <name...>")
  .description("Show the local graph around an entity.")
  .option("--sync", "Extract entities from recent memory before querying")
  .action(async (nameParts: string[], opts: { sync?: boolean }) => {
    const name = nameParts.join(" ").trim();
    if (!name) {
      console.error("Name is empty.");
      process.exit(1);
    }
    if (opts.sync) {
      try {
        const progress = await syncMemoryToGraph({ limit: 50 });
        console.log(formatGraphSync(progress));
      } catch (err) {
        console.error(`\n  Entity sync failed: ${(err as Error).message}\n`);
        process.exit(1);
      }
    }
    console.log(formatEntityNetwork(getEntityNetwork(name)));
  });

// ── personal model (Layer 3) ───────────────────────────────────────
program
  .command("knows")
  .description("Show what Janjak has learned about you — goals, preferences, routines.")
  .option("-c, --category <category>", "Filter preferences by category")
  .option("--refresh", "Re-synthesize the personal model from recent behavior first")
  .action((opts: { category?: string; refresh?: boolean }) => {
    const category = opts.category as PreferenceCategory | undefined;
    if (category && !PREFERENCE_CATEGORIES.includes(category)) {
      console.error(`Invalid --category. Use one of: ${PREFERENCE_CATEGORIES.join(", ")}`);
      process.exit(1);
    }
    if (opts.refresh) {
      const result = synthesizePersonalModel();
      console.log(
        `\n🛠️ Synthesized model — ${result.preferencesUpdated} prefs, ${result.routinesUpdated} routines updated, ${result.preferencesDecayed} decayed.`
      );
    }
    console.log(formatPersonalModel({ category }));
  });

const goal = program.command("goal").description("Manage your goals.");

goal
  .command("add <description...>")
  .description("Add a goal that Janjak aligns its help with.")
  .option("-c, --category <category>", "Goal category", "project")
  .option("-p, --priority <n>", "Priority 1-10", "5")
  .option("-d, --due <date>", "Target date (YYYY-MM-DD)")
  .action((descParts: string[], opts: { category: string; priority: string; due?: string }) => {
    const description = descParts.join(" ").trim();
    if (!description) {
      console.error("Goal description is empty.");
      process.exit(1);
    }
    const category = opts.category as GoalCategory;
    if (!GOAL_CATEGORIES.includes(category)) {
      console.error(`Invalid --category. Use one of: ${GOAL_CATEGORIES.join(", ")}`);
      process.exit(1);
    }
    const priority = parseInt(opts.priority, 10) || 5;
    const created = addGoal({ category, description, priority, targetDate: opts.due ?? null });
    console.log(`\n✅ Goal #${created.id} added: ${created.description} (${created.category}, p${created.priority})\n`);
  });

goal
  .command("list")
  .description("List your goals.")
  .option("--all", "Include completed goals")
  .action((opts: { all?: boolean }) => {
    const goals = listGoals({ activeOnly: !opts.all });
    if (goals.length === 0) {
      console.log("\n  No goals yet. Add one with `janjak goal add \"...\"`.\n");
      return;
    }
    console.log(`\n🎯 Goals (${goals.length})\n`);
    for (const g of goals) {
      const due = g.targetDate ? ` — target ${g.targetDate}` : "";
      const state = g.active ? "" : " ✓ done";
      console.log(`  [#${g.id}] (${g.category}) ${g.description}  p${g.priority}${due}${state}`);
    }
    console.log();
  });

goal
  .command("done <id>")
  .description("Mark a goal complete.")
  .action((id: string) => {
    const ok = completeGoal(parseInt(id, 10));
    console.log(ok ? `\n✅ Goal #${id} marked complete.\n` : `\n  Goal #${id} not found.\n`);
  });

goal
  .command("remove <id>")
  .description("Delete a goal.")
  .action((id: string) => {
    const ok = deleteGoal(parseInt(id, 10));
    console.log(ok ? `\n🗑️ Goal #${id} deleted.\n` : `\n  Goal #${id} not found.\n`);
  });

program
  .command("prefer <category> <key> <value...>")
  .description("Manually state a preference (e.g. `janjak prefer communication email_tone warm`).")
  .action((category: string, key: string, valueParts: string[]) => {
    if (!PREFERENCE_CATEGORIES.includes(category as PreferenceCategory)) {
      console.error(`Invalid category. Use one of: ${PREFERENCE_CATEGORIES.join(", ")}`);
      process.exit(1);
    }
    const value = valueParts.join(" ").trim();
    if (!value) {
      console.error("Preference value is empty.");
      process.exit(1);
    }
    const pref = upsertPreference({
      category: category as PreferenceCategory,
      key,
      value,
      source: "stated",
    });
    console.log(`\n✅ Preference set: ${pref.category}.${pref.key} = ${pref.value} (conf ${pref.confidence.toFixed(2)})\n`);
  });

program
  .command("forget-pref <id>")
  .description("Delete a learned preference by id (see `janjak knows`).")
  .action((id: string) => {
    const ok = deletePreference(parseInt(id, 10));
    console.log(ok ? `\n🗑️ Preference #${id} deleted.\n` : `\n  Preference #${id} not found.\n`);
  });

// ── learning loop (Layer 4) ─────────────────────────────────────────
program
  .command("why [id]")
  .description("Explain a decision Janjak made. Use `why last` for the most recent.")
  .action((id?: string) => {
    if (!id || id === "last") {
      console.log(formatExplanation(getLastDecision()));
      return;
    }
    console.log(formatExplanation(getDecisionById(id)));
  });

program
  .command("feedback")
  .description("Show acceptance/rejection rates for Janjak's actions.")
  .option("--days <n>", "Only count feedback from the last N days")
  .action((opts: { days?: string }) => {
    const sinceDays = opts.days ? parseInt(opts.days, 10) : undefined;
    console.log(formatFeedbackReport(sinceDays ? { sinceDays } : {}));
  });

program
  .command("adapt")
  .description("Run an adaptation pass — adjust behavior based on captured feedback.")
  .action(() => {
    const applied = adaptFromFeedback({
      onDisableWorkflow: (workflowId) => {
        setWorkflowEnabled(workflowId, false);
      },
      currentActionTier: (actionId) => getActionBaseTier(actionId),
    });
    console.log(formatAdaptations(applied));
  });

// ── synthesis (Layer 5) ─────────────────────────────────────────────
program
  .command("consolidate")
  .description("Force a consolidation pass — summarize today, refresh the model, run the forgetting curve.")
  .option("--no-summary", "Skip the AI day-summary step")
  .action(async (opts: { summary?: boolean }) => {
    const result = await runDailyConsolidation({
      skipSummary: opts.summary === false,
      onDisableWorkflow: (workflowId) => setWorkflowEnabled(workflowId, false),
      currentActionTier: (actionId) => getActionBaseTier(actionId),
    });
    console.log(formatDailyConsolidation(result));
  });

program
  .command("summary [period]")
  .description("Show a synthesized summary. Period: today (default) or week.")
  .action(async (period?: string) => {
    if (period === "week") {
      console.log(formatWeeklyReview(gatherWeeklyReview()));
      return;
    }
    console.log(await formatTodaySummary());
  });

program
  .command("review")
  .description("Interactive weekly review — confirm goals and preferences to lock them in.")
  .action(async () => {
    const review = gatherWeeklyReview();
    console.log(formatWeeklyReview(review));

    if (
      review.goals.length === 0 &&
      review.reviewablePreferences.length === 0
    ) {
      console.log("  Nothing to confirm yet — keep using Janjak and check back next week.\n");
      return;
    }

    console.log("  Let's confirm a few things (press Enter to skip).\n");

    // Confirm goals — answering "no" archives the goal.
    for (const goal of review.goals) {
      const keep = await confirmPrompt(
        `  🎯 Still a goal? "${goal.description}" (y/n) `
      );
      if (!keep) {
        completeGoal(goal.id);
        console.log("     → archived.\n");
      }
    }

    // Confirm inferred/observed preferences — "yes" promotes to a stated fact.
    for (const pref of review.reviewablePreferences) {
      const right = await confirmPrompt(
        `  🧩 Still accurate? [${pref.category}] ${pref.key} = ${pref.value} (y/n) `
      );
      if (right) {
        upsertPreference({
          category: pref.category,
          key: pref.key,
          value: pref.value,
          source: "stated",
        });
        console.log("     → confirmed (stated).\n");
      } else {
        deletePreference(pref.id);
        console.log("     → removed.\n");
      }
    }

    // Open-ended capture.
    const missed = await textPrompt("  💬 Anything important I missed this week? ");
    if (missed) {
      try {
        await capture({
          type: "note",
          text: `Weekly review note: ${missed}`,
          metadata: { source: "weekly_review" },
          importance: 0.7,
        });
        console.log("     → saved to memory.\n");
      } catch {
        console.log("     (couldn't save — embeddings unavailable)\n");
      }
    }

    console.log("  ✅ Review complete. Your model is up to date.\n");
  });

// ── browser ────────────────────────────────────────────────────────
import { formatBrowserReport, getOpenTabs } from "./browser.js";

program
  .command("browser")
  .description("Show browser usage breakdown — time spent on each site/category today.")
  .option("--tabs", "Show currently open tabs")
  .action((opts) => {
    if (opts.tabs) {
      const tabs = getOpenTabs();
      if (tabs.length === 0) {
        console.log("\n  No open browser tabs detected.\n");
        return;
      }
      console.log(`\n🌐 Open Browser Tabs (${tabs.length})\n`);
      for (const tab of tabs) {
        const title = tab.title.length > 50 ? tab.title.slice(0, 47) + "..." : tab.title;
        console.log(`  ${tab.browser.padEnd(8)} ${tab.domain.padEnd(28)} ${title}`);
      }
      console.log();
      return;
    }
    console.log(formatBrowserReport());
  });

// ── dash ───────────────────────────────────────────────────────────
program
  .command("dash")
  .description("Launch the interactive real-time dashboard.")
  .option("--notify", "Enable desktop notifications for nudges")
  .action(async (opts) => {
    await startDashboard({ notify: opts.notify });
  });

// ── web ────────────────────────────────────────────────────────────
program
  .command("web")
  .description("Open the web dashboard in your browser. No terminal needed.")
  .action(async () => {
    await startWebDashboard();
  });

// ── menubar ────────────────────────────────────────────────────────
program
  .command("menubar")
  .description("Launch Janjak in the macOS menu bar. Shows status at a glance.")
  .option("--build", "Rebuild the menu bar app")
  .action((opts) => {
    if (opts.build) {
      buildMenuBar();
    } else {
      launchMenuBar();
    }
  });

// ── setup ──────────────────────────────────────────────────────────
program
  .command("setup")
  .description("Open the setup wizard to configure API keys and integrations.")
  .action(async () => {
    await startSetupWizard();
  });

// ── reset ───────────────────────────────────────────────────────────
program
  .command("reset")
  .description("Reset Janjak data and start fresh. Use --all for a full local wipe.")
  .option("--all", "Also remove local DB files, Gmail tokens, workflows, and daemon logs")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (opts) => {
    const full = Boolean(opts.all);

    const warning = full
      ? "\n⚠️  Full reset will wipe local Janjak data (DB, tokens, workflows, logs). Continue? (y/N) "
      : "\n⚠️  Reset will clear tracked data (sessions, tasks, state, stats). Continue? (y/N) ";

    const confirmed = opts.yes ? true : await confirmPrompt(warning);
    if (!confirmed) {
      console.log("\nCancelled.\n");
      return;
    }

    if (isDaemonRunning()) {
      stopDaemon();
      console.log("\n🛑 Stopped daemon.");
    }

    if (!full) {
      resetTrackedData();
      console.log("\n✅ Janjak data reset complete.");
      console.log("   Kept: ~/.janjak/.env, Google credentials, app binaries.\n");
      return;
    }

    closeDb();

    const home = homedir();
    const base = join(home, ".janjak");
    const targets = [
      join(base, "janjak.db"),
      join(base, "janjak.db-wal"),
      join(base, "janjak.db-shm"),
      join(base, "gmail-tokens.json"),
      join(base, "daemon.log"),
      join(base, "daemon-error.log"),
      join(base, "workflows"),
    ];

    for (const target of targets) {
      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
      }
    }

    console.log("\n✅ Full local reset complete.");
    console.log("   Kept: ~/.janjak/.env and ~/.janjak/gmail-credentials.json");
    console.log("   Next: run `janjak setup` or `janjak login` if needed.\n");
  });

// ── autostart ──────────────────────────────────────────────────────
program
  .command("autostart")
  .description("Manage auto-start at login. Usage: janjak autostart [on|off|status]")
  .argument("[action]", "on | off | status", "status")
  .action((action: string) => {
    switch (action) {
      case "on":
      case "install":
        console.log(installAutoStart());
        break;
      case "off":
      case "uninstall":
        console.log(uninstallAutoStart());
        break;
      case "status":
      default:
        console.log(autoStartStatus());
        break;
    }
  });

// ── cal ────────────────────────────────────────────────────────────
program
  .command("cal")
  .description("Show today's calendar: meetings, free slots, alerts.")
  .action(async () => {
    if (!isAuthenticated()) {
      console.log("🔐 Not logged in. Run: janjak login");
      console.log("   (Calendar uses the same Google auth as email.)");
      return;
    }
    const report = await formatCalendarReport();
    console.log(report);
  });

// ── github ─────────────────────────────────────────────────────────
program
  .command("github")
  .description("GitHub overview: open PRs, review requests, assigned issues.")
  .action(async () => {
    const report = await formatGitHubReport();
    console.log(report);
  });

// ── Default (no command) → show status ─────────────────────────────
program.action(async () => {
  const report = await getStatusReport();
  console.log(report);
  const streak = formatStreakBadge();
  if (streak) console.log(`  ${streak}`);
});

// ═══════════════════════════════════════════════════════════════════
// ── V2: AI Chat + Behavioral Memory ──────────────────────────────
// ═══════════════════════════════════════════════════════════════════

// ── ask ────────────────────────────────────────────────────────────
program
  .command("ask")
  .description("Ask Janjak anything about your work patterns. Natural language.")
  .argument("<question...>", "Your question (e.g. 'what did I do yesterday?')")
  .option("--file <path...>", "Attach document(s) to analyze (pdf, docx, doc, rtf, odt, txt, md, html)")
  .option("--from-email <query>", "Attach an email to analyze (Gmail search, e.g. 'from:michaella')")
  .action(async (words: string[], opts: { file?: string[]; fromEmail?: string }) => {
    const question = words.join(" ");

    // Gather any attached material (documents and/or an email) to reason about.
    const attachmentParts: string[] = [];

    if (opts.file?.length) {
      for (const f of opts.file) {
        const abs = isAbsolute(f) ? f : resolve(process.cwd(), f);
        try {
          const text = await readDocument(abs);
          attachmentParts.push(`[Document: ${basename(abs)}]\n${text}`);
          console.log(`📎 Read ${basename(abs)}`);
        } catch (err) {
          console.error(`⚠️  ${err instanceof Error ? err.message : err}`);
          return;
        }
      }
    }

    if (opts.fromEmail) {
      if (!isAuthenticated()) {
        console.log("🔐 To analyze an email, connect Gmail first. Run: janjak login");
        return;
      }
      try {
        const matches = await searchEmails(opts.fromEmail, 1);
        if (matches.length === 0) {
          console.log(`📧 No email found matching "${opts.fromEmail}". Try a different sender or subject.`);
          return;
        }
        const email = matches[0]!;
        attachmentParts.push(`[Email from ${email.from} — "${email.subject}"]\n${email.body}`);
        console.log(`📧 Read email from ${email.from}`);
      } catch (err) {
        console.error(`⚠️  Could not read that email: ${err instanceof Error ? err.message : err}`);
        return;
      }
    }

    const attachments = attachmentParts.join("\n\n---\n\n");
    console.log("\n🤔 Thinking...\n");
    try {
      const answer = await runAgent(question, attachments ? { attachments } : {});
      console.log(`  ${answer}\n`);
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
    }
  });

// ── do (agentic) ────────────────────────────────────────────────────
program
  .command("do")
  .description("Tell Janjak to DO something. It plans, calls its tools (tasks, calendar, email, weather, documents…), and chains steps to complete the request.")
  .argument("<request...>", "What you want done (e.g. 'check the weather in Port-au-Prince and draft a PDF trip plan')")
  .action(async (words: string[]) => {
    const request = words.join(" ");
    const labels: Record<string, string> = {
      get_focus_today: "checking today's focus",
      list_tasks: "reading your tasks",
      create_task: "creating a task",
      get_calendar: "checking your calendar",
      create_calendar_event: "adding a calendar event",
      get_weather: "checking the weather",
      search_email: "searching your email",
      recall_memory: "recalling what I know",
      who_is: "looking that up",
      generate_document: "writing the document",
      read_document: "reading the document",
      web_search: "searching the web",
      list_workflows: "checking your workflows",
      run_workflow: "running the workflow",
      draft_email: "drafting an email",
      create_gmail_draft: "saving a Gmail draft",
      save_note: "saving a note",
      write_file: "writing a file",
      list_directory: "listing files",
      open_app: "opening the app",
      open_url: "opening the link",
      music_control: "controlling music",
      send_notification: "sending a notification",
    };
    console.log("\n🧠 Working on it...\n");
    try {
      const answer = await runAgent(request, {
        onStep: (step) => {
          console.log(`   • ${labels[step.tool] ?? step.tool}…`);
        },
      });
      console.log(`\n  ${answer}\n`);
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
    }
  });

// ── insights ───────────────────────────────────────────────────────
program
  .command("insights")
  .description("Show what Janjak has learned about your work patterns.")
  .action(() => {
    const output = formatInsights();
    console.log(output);
  });

// ── score ──────────────────────────────────────────────────────────
program
  .command("score")
  .description("Show today's focus score (0-100) with streak info.")
  .action(() => {
    const today = getTodayScore();
    console.log(`\n🎯 Today's Focus Score: ${today.score}/100  ${today.label}`);
    console.log(`   💻 ${today.codingMinutes}m coding  🌐 ${today.browsingMinutes}m browsing  ⏱️ ${today.totalMinutes}m total`);
    console.log(`   Focus ratio: ${Math.round(today.focusRatio * 100)}%`);
    const streak = formatStreakBadge();
    if (streak) console.log(`   ${streak}`);
    const pomo = getPomodoroStats();
    if (pomo.today > 0) console.log(`   🍅 ${pomo.today} pomodoro${pomo.today > 1 ? "s" : ""} today`);
    console.log();
  });

// ── week ───────────────────────────────────────────────────────────
program
  .command("week")
  .description("Weekly focus report with scores, trends, and AI summary.")
  .option("--ai", "Include AI-powered weekly summary")
  .action(async (opts) => {
    const scores = getWeeklyScores(7);
    const report = formatWeeklyReport(scores);
    console.log(report);

    if (opts.ai) {
      console.log("─".repeat(52));
      console.log("🤖 AI Weekly Summary\n");
      const summary = await getAIWeeklySummary(scores);
      console.log(`  ${summary}\n`);
    }
  });

// ═══════════════════════════════════════════════════════════════════
// ── V2: Email → Tasks ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

// ── login ──────────────────────────────────────────────────────────
program
  .command("login")
  .description("Authenticate with Gmail. Required before using inbox/tasks.")
  .action(async () => {
    await runOAuthFlow();
  });

// ── inbox ──────────────────────────────────────────────────────────
program
  .command("inbox")
  .description("Scan emails → extract tasks → AI briefing.")
  .action(async () => {
    if (!isAuthenticated()) {
      console.log("🔐 Not logged in. Run: janjak login");
      return;
    }

    console.log("📬 Scanning inbox...\n");

    try {
      const { summary, newTasks, totalEmails } = await processInbox();
      const report = formatInboxReport(summary, newTasks, totalEmails);
      console.log(report);
    } catch (err) {
      console.error("Error scanning inbox:", err instanceof Error ? err.message : err);
    }
  });

// ── tasks ──────────────────────────────────────────────────────────
program
  .command("tasks")
  .description("Show all pending tasks.")
  .action(() => {
    const output = formatAllTasks();
    console.log(output);
  });

// ── done <id> ──────────────────────────────────────────────────────
program
  .command("done")
  .description("Mark a task as done.")
  .argument("<id>", "Task ID")
  .action((id: string) => {
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) {
      console.log("Invalid task ID.");
      return;
    }
    updateTaskStatus(taskId, "done");
    console.log(`✅ Task #${taskId} marked as done.`);
  });

// ── start <id> ─────────────────────────────────────────────────────
program
  .command("start")
  .description("Mark a task as in-progress.")
  .argument("<id>", "Task ID")
  .action((id: string) => {
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) {
      console.log("Invalid task ID.");
      return;
    }
    updateTaskStatus(taskId, "in-progress");
    console.log(`🔷 Task #${taskId} started.`);
  });

// ── dismiss <id> ───────────────────────────────────────────────────
program
  .command("dismiss")
  .description("Dismiss a task (won't show up anymore).")
  .argument("<id>", "Task ID")
  .action((id: string) => {
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) {
      console.log("Invalid task ID.");
      return;
    }
    updateTaskStatus(taskId, "dismissed");
    console.log(`⬛ Task #${taskId} dismissed.`);
  });

// ── reply <id> ─────────────────────────────────────────────────────
program
  .command("reply")
  .description("Draft an AI email reply for a task and open it in your email app.")
  .argument("<id>", "Task ID")
  .option("-t, --tone <tone>", "Tone: professional, friendly, or brief", "professional")
  .option("--no-open", "Just show the draft, don't open email app")
  .action(async (id: string, opts: { tone: string; open: boolean }) => {
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) {
      console.log("Invalid task ID.");
      return;
    }
    try {
      const tone = opts.tone as "professional" | "friendly" | "brief";
      await draftAndOpen(taskId, { tone, noOpen: !opts.open });
    } catch (err) {
      console.error(err instanceof Error ? err.message : "Failed to draft reply.");
    }
  });

// ── draft <id> ─────────────────────────────────────────────────────
program
  .command("draft")
  .description("Preview an AI-drafted email reply in the terminal (no email app).")
  .argument("<id>", "Task ID")
  .option("-t, --tone <tone>", "Tone: professional, friendly, or brief", "professional")
  .action(async (id: string, opts: { tone: string }) => {
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) {
      console.log("Invalid task ID.");
      return;
    }
    const task = getTaskById(taskId);
    if (!task) {
      console.log(`Task #${taskId} not found.`);
      return;
    }
    try {
      console.log(`\n✉️  Generating draft for task #${taskId}...`);
      const tone = opts.tone as "professional" | "friendly" | "brief";
      const reply = await generateReply(task, tone);
      console.log(formatReplyPreview(task, reply));
    } catch (err) {
      console.error(err instanceof Error ? err.message : "Failed to generate draft.");
    }
  });

// ── remind ───────────────────────────────────────────────────────────
program
  .command("remind")
  .description("Create a task from natural language. E.g.: janjak remind \"Call mom tomorrow\"")
  .argument("<text>", "What do you need to do?")
  .action(async (text: string) => {
    console.log("\n🧠 Parsing...\n");
    const task = await createTaskFromText(text);
    if (task) {
      console.log("  ✅ Task created!");
      console.log(formatCreatedTask(task));
      console.log();
    } else {
      console.log("  ❌ Couldn't parse a task from that. Try being more specific.");
      console.log('  Example: janjak remind "Review PR #42 by Friday"\n');
    }
  });

// ── morning ─────────────────────────────────────────────────────────
program
  .command("morning")
  .description("Your personalized morning briefing: calendar, emails, tasks, scores, and AI plan.")
  .option("--no-ai", "Skip the AI-generated plan")
  .action(async (opts) => {
    console.log("\n☕ Brewing your morning briefing...\n");
    const briefing = await generateMorningBriefing({ ai: opts.ai });
    console.log(briefing);
  });

// ── character ────────────────────────────────────────────────────────
program
  .command("character")
  .description("Choose your AI assistant: Janjak (male) or Janèt (female)")
  .argument("[name]", "Character name: janjak or janèt")
  .action(async (name?: string) => {
    const current = getState("character") ?? "janjak";
    const chars: Record<string, { name: string; voice: string; emoji: string; desc: string }> = {
      janjak: { name: "Janjak", voice: "onyx", emoji: "🧔🏾", desc: "A calm, deep-voiced male assistant" },
      "janèt":  { name: "Janèt",  voice: "nova", emoji: "👩🏾", desc: "A warm, natural-voiced female assistant" },
    };

    if (!name) {
      console.log("\n🎭 Choose your AI assistant:\n");
      for (const [key, c] of Object.entries(chars)) {
        const active = key === current ? "  ← active" : "";
        console.log(`  ${c.emoji}  ${c.name} — ${c.desc} (voice: ${c.voice})${active}`);
      }
      console.log(`\n  Usage: janjak character janjak`);
      console.log(`         janjak character janèt\n`);
      return;
    }

    const key = name.toLowerCase();
    if (!chars[key]) {
      console.log(`\n  ❌ Unknown character "${name}". Choose: janjak or janèt\n`);
      return;
    }

    setState("character", key);
    const c = chars[key]!;
    console.log(`\n  ${c.emoji}  Switched to ${c.name}!`);
    console.log(`  ${c.desc} (voice: ${c.voice})`);
    console.log(`\n  Try: janjak voice\n`);
  });

// ── voice ───────────────────────────────────────────────────────────
program
  .command("voice")
  .description("Talk to Janjak with your voice. It listens, thinks, and speaks back.")
  .option("--loop", "Continuous conversation mode")
  .option("-v, --voice <voice>", "TTS voice: alloy, echo, fable, onyx, nova, shimmer (default: nova)")
  .option("-s, --seconds <seconds>", "Max recording time in seconds", "30")
  .action(async (opts) => {
    await voiceCommand({
      loop: opts.loop,
      voice: opts.voice,
      maxSeconds: parseInt(opts.seconds, 10),
    });
  });

// ── voice-lang ─────────────────────────────────────────────────────
program
  .command("voice-lang")
  .description("Configure voice recognition language mode for reliability.")
  .argument("[mode]", "en-only | en-fr")
  .action((mode?: string) => {
    const current = getVoiceLanguageMode();

    if (!mode) {
      console.log(`\n🌐 Current voice language mode: ${formatVoiceLanguageMode(current)}`);
      console.log("\n   Use: janjak voice-lang en-only");
      console.log("        janjak voice-lang en-fr\n");
      return;
    }

    if (mode !== "en-only" && mode !== "en-fr") {
      console.log('\n❌ Invalid mode. Choose: "en-only" or "en-fr"\n');
      return;
    }

    setVoiceLanguageMode(mode as VoiceLanguageMode);
    console.log(`\n✅ Voice language mode set to: ${formatVoiceLanguageMode(mode as VoiceLanguageMode)}\n`);
  });

// ── autonomy ────────────────────────────────────────────────────────
const autonomyCmd = program
  .command("autonomy")
  .description("Control Janjak's autonomous actions. Let it act without being told.");

autonomyCmd
  .command("on")
  .description("Enable autonomous mode — Janjak will execute safe actions on its own")
  .action(() => {
    setAutonomyEnabled(true);
    console.log("\n🤖 Autonomy ENABLED. Janjak will now act on its own.");
    console.log("   ⚡ Auto actions (focus, break, music) execute immediately.");
    console.log("   ⏳ Confirm actions (meetings) execute after 10s delay.");
    console.log("\n   Use `janjak autonomy status` to see what's active.");
    console.log("   Use `janjak autonomy off` to disable.\n");
  });

autonomyCmd
  .command("off")
  .description("Disable autonomous mode — Janjak will only suggest actions")
  .action(() => {
    setAutonomyEnabled(false);
    // Cancel any pending confirms
    for (const id of getPendingActions()) cancelPending(id);
    console.log("\n🤖 Autonomy DISABLED. Janjak will only suggest actions.\n");
  });

autonomyCmd
  .command("status")
  .description("Show autonomy configuration, registered actions, and pending actions")
  .action(() => {
    console.log(formatAutonomyStatus());
  });

autonomyCmd
  .command("log")
  .description("Show recent autonomous actions taken by Janjak")
  .action(() => {
    console.log(formatActionLog());
  });

autonomyCmd
  .command("tier")
  .description("Enable or disable a specific safety tier: auto | confirm")
  .argument("<tier>", "Safety tier: auto or confirm")
  .argument("<state>", "on or off")
  .action((tier: string, state: string) => {
    if (tier !== "auto" && tier !== "confirm") {
      console.log("Invalid tier. Choose: auto or confirm");
      return;
    }
    const enabled = state === "on";
    setTierEnabled(tier as SafetyTier, enabled);
    console.log(`\n${enabled ? "✅" : "❌"} ${tier} tier ${enabled ? "enabled" : "disabled"}.\n`);
  });

autonomyCmd
  .command("cancel")
  .description("Cancel all pending confirm-tier actions")
  .action(() => {
    const pending = getPendingActions();
    if (pending.length === 0) {
      console.log("\n  No pending actions to cancel.\n");
      return;
    }
    for (const id of pending) cancelPending(id);
    console.log(`\n  ❌ Cancelled ${pending.length} pending action(s).\n`);
  });

// ── workflow ────────────────────────────────────────────────────────
import { getAllWorkflows, setWorkflowEnabled, formatWorkflowList, formatWorkflowLog, runWorkflowById, saveUserWorkflow, removeUserWorkflow, isWorkflowsEnabled, setWorkflowsEnabled, type TriggerType } from "./workflows.js";

const workflowCmd = program
  .command("workflow")
  .description("Manage automated workflows. Janjak runs shell commands when context changes.");

workflowCmd
  .command("list")
  .description("Show all workflows (built-in + custom)")
  .action(() => {
    console.log(formatWorkflowList());
  });

workflowCmd
  .command("log")
  .description("Show recent workflow executions")
  .action(() => {
    console.log(formatWorkflowLog());
  });

workflowCmd
  .command("enable")
  .description("Enable a workflow by ID")
  .argument("<id>", "Workflow ID")
  .action((id: string) => {
    if (setWorkflowEnabled(id, true)) {
      console.log(`\n  ✅ Workflow "${id}" enabled.\n`);
    } else {
      console.log(`\n  ❌ Workflow "${id}" not found.\n`);
    }
  });

workflowCmd
  .command("disable")
  .description("Disable a workflow by ID")
  .argument("<id>", "Workflow ID")
  .action((id: string) => {
    if (setWorkflowEnabled(id, false)) {
      console.log(`\n  ❌ Workflow "${id}" disabled.\n`);
    } else {
      console.log(`\n  ❌ Workflow "${id}" not found.\n`);
    }
  });

workflowCmd
  .command("run")
  .description("Manually trigger a workflow by ID")
  .argument("<id>", "Workflow ID")
  .action(async (id: string) => {
    console.log(`\n  ⚙️  Running "${id}"...\n`);
    const result = await runWorkflowById(id);
    if (!result) {
      console.log(`  ❌ Workflow "${id}" not found.`);
      return;
    }
    const icon = result.success ? "✅" : "❌";
    console.log(`  ${icon} Exit code: ${result.exitCode} (${result.durationMs}ms)`);
    if (result.stdout.trim()) {
      console.log(`\n  Output:`);
      for (const line of result.stdout.trim().split("\n").slice(-10)) {
        console.log(`    ${line}`);
      }
    }
    if (result.stderr.trim() && !result.success) {
      console.log(`\n  ⚠️  Error: ${result.stderr.trim().split("\n")[0]}`);
    }
    console.log();
  });

workflowCmd
  .command("add")
  .description("Create a custom workflow. E.g.: janjak workflow add my-wf focus_start \"echo hello\"")
  .argument("<id>", "Unique workflow ID (e.g. slack-status)")
  .argument("<trigger>", "Trigger type: focus_start, break_start, idle_detected, return_from_idle, project_switch, activity_change, long_session, energy_low")
  .argument("<command>", "Shell command to run")
  .option("-n, --name <name>", "Display name")
  .option("-d, --desc <desc>", "Description")
  .option("-c, --cooldown <minutes>", "Cooldown in minutes", "5")
  .action((id: string, trigger: string, command: string, opts: { name?: string; desc?: string; cooldown: string }) => {
    const validTriggers = ["activity_change", "focus_start", "focus_end", "break_start", "break_end", "long_session", "idle_detected", "return_from_idle", "project_switch", "energy_low", "meeting_soon"];
    if (!validTriggers.includes(trigger)) {
      console.log(`\n  ❌ Invalid trigger "${trigger}".`);
      console.log(`  Valid triggers: ${validTriggers.join(", ")}\n`);
      return;
    }
    saveUserWorkflow({
      id,
      name: opts.name ?? id,
      description: opts.desc ?? `Custom workflow: ${id}`,
      trigger: { type: trigger as TriggerType },
      command,
      enabled: true,
      cooldownMs: parseInt(opts.cooldown, 10) * 60_000,
      notify: true,
    });
    console.log(`\n  ✅ Workflow "${id}" created!`);
    console.log(`     Trigger: ${trigger}`);
    console.log(`     Command: ${command}`);
    console.log(`     Saved to: ~/.janjak/workflows/${id}.json\n`);
  });

workflowCmd
  .command("remove")
  .description("Remove a custom workflow")
  .argument("<id>", "Workflow ID to remove")
  .action((id: string) => {
    if (removeUserWorkflow(id)) {
      console.log(`\n  ✅ Workflow "${id}" removed.\n`);
    } else {
      console.log(`\n  ❌ Workflow "${id}" not found (only custom workflows can be removed).\n`);
    }
  });

workflowCmd
  .command("on")
  .description("Enable the workflow system globally")
  .action(() => {
    setWorkflowsEnabled(true);
    console.log("\n  ✅ Workflow system enabled.\n");
  });

workflowCmd
  .command("off")
  .description("Disable the workflow system globally")
  .action(() => {
    setWorkflowsEnabled(false);
    console.log("\n  ❌ Workflow system disabled.\n");
  });

// ── daemon ──────────────────────────────────────────────────────────
/**
 * Launch the background daemon detached from the current process. Resolves the
 * entry point relative to this module so it works both from a compiled install
 * (`dist/daemon-entry.js`, run with node) and from source during development
 * (`src/daemon-entry.ts`, run with tsx) — no hardcoded paths.
 */
async function spawnDaemonDetached(): Promise<void> {
  const { spawn: spawnProcess } = await import("node:child_process");
  const moduleUrl = import.meta.url;
  const isSource = moduleUrl.endsWith(".ts");
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  const entry = join(moduleDir, isSource ? "daemon-entry.ts" : "daemon-entry.js");
  const args = isSource ? ["--import", "tsx", entry] : [entry];
  const child = spawnProcess(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    cwd: dirname(moduleDir),
    env: { ...process.env },
  });
  child.unref();
}

const daemonCmd = program
  .command("daemon")
  .description("Run Janjak as an always-on background daemon with HTTP API.");

daemonCmd
  .command("start")
  .description("Start the Janjak daemon in the background")
  .option("--foreground", "Run in foreground (don't detach)")
  .action(async (opts) => {
    if (isDaemonRunning()) {
      console.log(`\n🧠 Daemon is already running (PID: ${getDaemonPid()}, port ${DAEMON_PORT})\n`);
      return;
    }

    if (opts.foreground) {
      await startDaemon();
    } else {
      // Spawn detached daemon process
      await spawnDaemonDetached();
      // Give it a moment to start
      await new Promise(r => setTimeout(r, 1500));
      if (isDaemonRunning()) {
        console.log(`\n🧠 Janjak daemon started (PID: ${getDaemonPid()}, port ${DAEMON_PORT})`);
        console.log(`   API:  http://localhost:${DAEMON_PORT}/api/health`);
        console.log(`   Web:  http://localhost:${DAEMON_PORT}\n`);
      } else {
        console.log("⚠️  Daemon may have failed to start. Try: janjak daemon start --foreground");
      }
    }
  });

daemonCmd
  .command("stop")
  .description("Stop the running Janjak daemon")
  .action(() => {
    if (stopDaemon()) {
      console.log("\n✅ Daemon stopped.\n");
    } else {
      console.log("\n⚠️  No daemon running.\n");
    }
  });

daemonCmd
  .command("status")
  .description("Check if the Janjak daemon is running")
  .action(async () => {
    if (isDaemonRunning()) {
      const pid = getDaemonPid();
      console.log(`\n🧠 Daemon is running (PID: ${pid}, port ${DAEMON_PORT})`);
      try {
        const resp = await fetch(`http://localhost:${DAEMON_PORT}/api/health`);
        const data = await resp.json() as Record<string, unknown>;
        console.log(`   Character: ${data.character}`);
        console.log(`   Uptime: ${Math.round(Number(data.uptime) / 60)} minutes\n`);
      } catch {
        console.log("   (API not responding)\n");
      }
    } else {
      console.log("\n💤 Daemon is not running. Start with: janjak daemon start\n");
    }
  });

// ── overlay ─────────────────────────────────────────────────────────
program
  .command("overlay")
  .description("Launch the Janjak overlay (⌘⇧J from anywhere to activate)")
  .action(async () => {
    if (!isDaemonRunning()) {
      console.log("⚠️  Starting daemon first...");
      await spawnDaemonDetached();
      await new Promise(r => setTimeout(r, 1500));
    }
    await buildOverlay();
    launchOverlay();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

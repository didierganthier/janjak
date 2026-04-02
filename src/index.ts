#!/usr/bin/env node
// ─── Janjak: Ambient Intelligence Assistant ────────────────────────
// "An AI that understands what you're doing, predicts what you need,
//  and subtly acts." — Jarvis for builders.

import { config } from "dotenv";
import { join } from "node:path";
import { homedir } from "node:os";

// Load env vars from ~/.janjak/.env
config({ path: join(homedir(), ".janjak", ".env") });

import { Command } from "commander";
import { enterFocusMode, enterBreakMode, exitFocusMode, flushSession } from "./engine.js";
import { getStatusReport, startMonitor, stopMonitor } from "./monitor.js";
import { getDayOverview, getAIDailyPlan } from "./planner.js";
import { getCurrentTrack, pauseMusic, resumeMusic } from "./music.js";
import { closeDb, setState, getState } from "./db.js";
import { runOAuthFlow, isAuthenticated } from "./gmail-auth.js";
import { processInbox, formatInboxReport, formatAllTasks, updateTaskStatus } from "./tasks.js";
import { formatInsights } from "./memory.js";
import { getTodayScore, getWeeklyScores, formatWeeklyReport, getAIWeeklySummary } from "./score.js";
import { askJanjak } from "./chat.js";
import { sendNotification, notificationsAvailable } from "./notify.js";
import { startPomodoro, getPomodoroStats } from "./pomo.js";
import { formatStreakBadge, formatStreakReport } from "./streak.js";
import { formatProjectsReport } from "./project.js";
import { startDashboard } from "./dashboard.js";
import { installAutoStart, uninstallAutoStart, autoStartStatus } from "./autostart.js";
import { formatCalendarReport } from "./calendar.js";
import { formatGitHubReport, isGitHubConfigured } from "./github.js";
import { startWebDashboard } from "./web.js";
import { launchMenuBar, buildMenuBar } from "./menubar.js";
import { startSetupWizard } from "./setup.js";
import { startProactiveEngine, stopProactiveEngine, formatAlert, type ProactiveAlert } from "./proactive.js";
import { draftAndOpen, generateReply, getTaskById, formatReplyPreview } from "./reply.js";
import { voiceCommand } from "./voice.js";
import { generateMorningBriefing } from "./morning.js";
import { createTaskFromText, formatCreatedTask } from "./nl-tasks.js";

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
    startProactiveEngine((alert: ProactiveAlert) => {
      const formatted = formatAlert(alert);
      recentAlerts.push(formatted);
      if (recentAlerts.length > 10) recentAlerts.shift();
      if (useNotify) {
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
  .action(async (words: string[]) => {
    const question = words.join(" ");
    console.log("\n🤔 Thinking...\n");
    try {
      const answer = await askJanjak(question);
      console.log(`  ${answer}\n`);
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

program.parseAsync(process.argv).catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

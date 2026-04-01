// ─── Pomodoro Timer: 25/5 focus/break cycles ───────────────────────
// Integrates with the focus engine, music, and notification system.

import { enterFocusMode, enterBreakMode, exitFocusMode, flushSession } from "./engine.js";
import { playPlaylist, pauseMusic } from "./music.js";
import { sendNotification } from "./notify.js";
import { logPomodoro, getTodayPomodoros } from "./db.js";

interface PomoConfig {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  longBreakAfter: number; // long break after N pomodoros
  notify: boolean;
}

const DEFAULT_CONFIG: PomoConfig = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakAfter: 4,
  notify: true,
};

let pomoTimer: ReturnType<typeof setTimeout> | null = null;
let pomoRunning = false;
let currentCycle = 0;
let cycleType: "work" | "break" = "work";
let cycleStartedAt = 0;
let pomoConfig = { ...DEFAULT_CONFIG };
let completedThisSession = 0;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Start the pomodoro timer. Renders a live countdown to stdout. */
export async function startPomodoro(opts?: {
  work?: number;
  short?: number;
  long?: number;
  notify?: boolean;
}): Promise<void> {
  if (pomoRunning) {
    console.log("⚠️  Pomodoro already running.");
    return;
  }

  if (opts?.work) pomoConfig.workMinutes = opts.work;
  if (opts?.short) pomoConfig.breakMinutes = opts.short;
  if (opts?.long) pomoConfig.longBreakMinutes = opts.long;
  if (opts?.notify !== undefined) pomoConfig.notify = opts.notify;

  pomoRunning = true;
  completedThisSession = 0;
  currentCycle = 0;

  // Show today's completed pomodoros
  const todayPomos = getTodayPomodoros();
  if (todayPomos.length > 0) {
    console.log(`\n🍅 Today: ${todayPomos.length} pomodoro${todayPomos.length > 1 ? "s" : ""} completed`);
  }

  console.log(`\n🍅 Pomodoro started — ${pomoConfig.workMinutes}/${pomoConfig.breakMinutes} cycle`);
  console.log(`   Long break (${pomoConfig.longBreakMinutes}m) after every ${pomoConfig.longBreakAfter} pomodoros`);
  console.log("   Press Ctrl+C to stop.\n");

  // Handle graceful shutdown
  const shutdown = () => {
    stopPomodoro(true);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start first work cycle
  await runCycle("work");
}

async function runCycle(type: "work" | "break"): Promise<void> {
  if (!pomoRunning) return;

  cycleType = type;
  cycleStartedAt = Date.now();

  const isLongBreak = type === "break" && currentCycle > 0 && currentCycle % pomoConfig.longBreakAfter === 0;
  const duration = type === "work"
    ? pomoConfig.workMinutes
    : isLongBreak ? pomoConfig.longBreakMinutes : pomoConfig.breakMinutes;

  if (type === "work") {
    currentCycle++;
    const msg = await enterFocusMode();
    // Don't print engine msg, we show our own
    console.log(`\n🎯 Pomodoro #${currentCycle} — ${duration} minute work session`);
    if (pomoConfig.notify) {
      sendNotification(`Pomodoro #${currentCycle} started — ${duration}m of focus`, "Janjak 🍅");
    }
  } else {
    const breakMsg = await enterBreakMode();
    const label = isLongBreak ? "Long break" : "Short break";
    console.log(`\n☕ ${label} — ${duration} minutes. Relax!`);
    if (pomoConfig.notify) {
      sendNotification(`${label} time — ${duration}m. Stand up & stretch!`, "Janjak 🍅");
    }
  }

  // Countdown
  let remaining = duration * 60;
  await new Promise<void>((resolve) => {
    const tick = () => {
      if (!pomoRunning || remaining <= 0) {
        resolve();
        return;
      }
      process.stdout.write(`\r  ⏱️  ${formatTime(remaining)} remaining  `);
      remaining--;
      pomoTimer = setTimeout(tick, 1000);
    };
    tick();
  });

  if (!pomoRunning) return;

  // Cycle complete
  process.stdout.write("\r" + " ".repeat(40) + "\r");
  const endedAt = Date.now();

  if (type === "work") {
    logPomodoro(cycleStartedAt, endedAt, pomoConfig.workMinutes, "work", true);
    completedThisSession++;
    const todayTotal = getTodayPomodoros().length;
    console.log(`  ✅ Pomodoro #${currentCycle} complete! (${todayTotal} today)`);

    if (pomoConfig.notify) {
      sendNotification(
        `Pomodoro #${currentCycle} done! ${todayTotal} today. Time for a break.`,
        "Janjak 🍅",
      );
    }

    // Play break transition
    await runCycle("break");
  } else {
    logPomodoro(cycleStartedAt, endedAt, duration, "break", true);
    console.log("  ✅ Break over!");

    if (pomoConfig.notify) {
      sendNotification("Break over — time to focus!", "Janjak 🍅");
    }

    // Start next work cycle
    await runCycle("work");
  }
}

export function stopPomodoro(silent = false): void {
  if (!pomoRunning) return;

  pomoRunning = false;
  if (pomoTimer) {
    clearTimeout(pomoTimer);
    pomoTimer = null;
  }

  // Log incomplete cycle if work was in progress
  if (cycleType === "work" && cycleStartedAt > 0) {
    const elapsed = Math.round((Date.now() - cycleStartedAt) / 60000);
    if (elapsed >= 1) {
      logPomodoro(cycleStartedAt, Date.now(), elapsed, "work", false);
    }
  }

  flushSession();

  if (!silent) {
    const todayTotal = getTodayPomodoros().length;
    console.log(`\n\n🛑 Pomodoro stopped. ${completedThisSession} completed this session, ${todayTotal} today total.`);
  }
}

/** Get today's pomodoro stats for display */
export function getPomodoroStats(): { today: number; totalMinutes: number } {
  const pomos = getTodayPomodoros();
  const totalMinutes = pomos.reduce((sum, p) => sum + p.duration_minutes, 0);
  return { today: pomos.length, totalMinutes };
}

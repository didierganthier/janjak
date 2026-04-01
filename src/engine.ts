// ─── Focus Engine: Manages focus mode + state transitions ──────────
import { getActiveWindow } from "./context.js";
import { classifyActivity, getActivityEmoji, getActivityLabel } from "./classifier.js";
import { playPlaylist, pauseMusic, getCurrentTrack } from "./music.js";
import { logSession, setState, getState, getTasks } from "./db.js";
import { getMemoryNudge, getBehavioralProfile } from "./memory.js";
import { trackProject, flushProjectSession, getCurrentProject, formatCurrentProjectBadge } from "./project.js";
import type { UserState, FocusMode, ActivityState, ExtractedTask } from "./types.js";

// Restore persisted state or use defaults
function loadPersistedState(): UserState {
  const now = Date.now();
  const focusMode = (getState("focusMode") as FocusMode) ?? "off";
  const sessionStartedAt = Number(getState("sessionStartedAt")) || now;
  const lastActivityAt = Number(getState("lastActivityAt")) || now;

  return {
    activity: "unknown",
    focusMode,
    energy: "medium",
    activeApp: null,
    lastActivityAt,
    sessionStartedAt: focusMode !== "off" ? sessionStartedAt : now,
    idleMinutes: 0,
  };
}

let currentState: UserState = loadPersistedState();

let lastActivity: ActivityState = "unknown";
let lastActivityStarted: number = Date.now();

export function getStatus(): UserState {
  return { ...currentState };
}

export async function poll(): Promise<UserState> {
  const context = await getActiveWindow();
  const activity = classifyActivity(context);
  const now = Date.now();

  // Update idle tracking
  if (activity === "idle") {
    currentState.idleMinutes = Math.round((now - currentState.lastActivityAt) / 60000);
  } else {
    currentState.lastActivityAt = now;
    currentState.idleMinutes = 0;
    setState("lastActivityAt", String(now));
  }

  // Log session — on activity transition OR periodically (every 5 min of same activity)
  const elapsed = (now - lastActivityStarted) / 60000;
  const activityChanged = activity !== lastActivity && lastActivity !== "unknown";
  const periodicCheckpoint = elapsed >= 5 && lastActivity !== "unknown";

  if (activityChanged || periodicCheckpoint) {
    if (elapsed > 0.1) {
      logSession({
        timestamp: lastActivityStarted,
        activity: lastActivity,
        focusMode: currentState.focusMode,
        appName: currentState.activeApp?.appName ?? "unknown",
        durationMinutes: elapsed,
      });
    }
    lastActivityStarted = now;
  }

  lastActivity = activity;

  currentState = {
    ...currentState,
    activity,
    activeApp: context,
  };

  // Estimate energy based on time of day + idle patterns
  currentState.energy = estimateEnergy(currentState);

  // Track project from window title
  trackProject(context, activity);

  return currentState;
}

export async function enterFocusMode(): Promise<string> {
  const now = Date.now();
  currentState.focusMode = "deep-work";
  currentState.sessionStartedAt = now;
  setState("focusMode", "deep-work");
  setState("sessionStartedAt", String(now));

  let msg = "🎯 Focus mode activated. Deep work time.";

  // Detect what you're doing and play matching music
  const context = await getActiveWindow();
  const activity = classifyActivity(context);
  const playlistName = await playPlaylist(activity === "idle" ? "coding" : activity);

  if (playlistName) {
    msg += `\n🎵 Playing: ${playlistName}`;
  }

  // Smart task suggestion
  const suggestion = suggestNextTask();
  if (suggestion) {
    msg += `\n\n📋 Suggested task: ${suggestion}`;
  }

  return msg;
}

/** Suggest the best task to work on right now based on priority,
 *  deadlines, and your current peak hours. */
export function suggestNextTask(): string | null {
  const tasks = getTasks(); // pending + in-progress, sorted by priority
  if (tasks.length === 0) return null;

  // If something is already in-progress, that's the obvious pick
  const inProgress = tasks.find(t => t.status === "in-progress");
  if (inProgress) {
    return `#${inProgress.id} ${inProgress.title} (in progress)`;
  }

  const hour = new Date().getHours();
  const profile = getBehavioralProfile();
  const isPeakHour = profile.peakCodingHours.includes(hour);

  // Overdue / due today tasks first
  const today = new Date().toISOString().slice(0, 10);
  const urgent = tasks.find(t =>
    t.deadline && t.deadline <= today && t.priority === "high"
  );
  if (urgent) {
    return `#${urgent.id} ${urgent.title} ⚠️ due ${urgent.deadline}`;
  }

  // During peak hours → tackle highest priority
  if (isPeakHour) {
    const top = tasks[0]!; // already sorted by priority
    const pri = top.priority === "high" ? "🔴" : top.priority === "medium" ? "🟡" : "🟢";
    return `#${top.id} ${top.title} ${pri} (peak hour — do your hardest work now)`;
  }

  // Default: highest priority task
  const top = tasks[0]!;
  const deadline = top.deadline ? ` (due ${top.deadline})` : "";
  return `#${top.id} ${top.title}${deadline}`;
}

export async function enterBreakMode(): Promise<string> {
  flushSession();
  const now = Date.now();
  const sessionMinutes = Math.round(
    (now - currentState.sessionStartedAt) / 60000
  );
  currentState.focusMode = "break";
  currentState.sessionStartedAt = now;
  setState("focusMode", "break");
  setState("sessionStartedAt", String(now));

  let msg = `☕ Break mode. You worked for ${sessionMinutes} minutes.`;

  const playlistName = await playPlaylist("break");
  if (playlistName) {
    msg += `\n🎵 Playing: ${playlistName}`;
  }

  msg += "\n💡 Stand up. Stretch. Hydrate.";
  return msg;
}

export async function exitFocusMode(): Promise<string> {
  flushSession();
  const prevMode = currentState.focusMode;
  const now = Date.now();
  currentState.focusMode = "off";
  currentState.sessionStartedAt = now;
  setState("focusMode", "off");
  setState("sessionStartedAt", String(now));
  setState("sessionStartedAt", String(currentState.sessionStartedAt));
  await pauseMusic();

  return prevMode === "off"
    ? "Already off."
    : "✋ Session ended. Music paused.";
}

/** Flush the current in-progress session to DB (call on shutdown). */
export function flushSession(): void {
  const now = Date.now();
  const elapsed = (now - lastActivityStarted) / 60000;
  if (elapsed > 0.1 && lastActivity !== "unknown") {
    logSession({
      timestamp: lastActivityStarted,
      activity: lastActivity,
      focusMode: currentState.focusMode,
      appName: currentState.activeApp?.appName ?? "unknown",
      durationMinutes: elapsed,
    });
    lastActivityStarted = now;
  }
  flushProjectSession();
}

export function getNudge(): string | null {
  const { idleMinutes, focusMode, energy } = currentState;

  if (focusMode === "deep-work" && idleMinutes >= 5) {
    return "🧠 You've been idle for 5 minutes during focus mode. Still there?";
  }

  if (focusMode === "deep-work") {
    const sessionMinutes = Math.round(
      (Date.now() - currentState.sessionStartedAt) / 60000
    );
    if (sessionMinutes >= 90) {
      return "⏰ 90 minutes of deep work! Consider taking a break. Use `janjak break`.";
    }
    if (sessionMinutes >= 50) {
      return "🔔 50 minutes in. A short break soon might help.";
    }
  }

  if (energy === "drained") {
    return "⚡ Energy seems low. Maybe step away for a few minutes?";
  }

  // Behavioral memory nudge (only when no urgent nudges)
  try {
    const memoryNudge = getMemoryNudge();
    if (memoryNudge) return memoryNudge;
  } catch { /* memory analysis failed, skip */ }

  return null;
}

function estimateEnergy(state: UserState): UserState["energy"] {
  const hour = new Date().getHours();

  // Post-lunch dip
  if (hour >= 13 && hour <= 15) return "low";

  // Late night
  if (hour >= 23 || hour <= 5) return "low";

  // Idle for a while
  if (state.idleMinutes >= 10) return "drained";

  // Morning energy
  if (hour >= 8 && hour <= 12) return "high";

  return "medium";
}

export function formatStatus(state: UserState): string {
  const emoji = getActivityEmoji(state.activity);
  const label = getActivityLabel(state.activity);
  const mode = state.focusMode === "off" ? "Off" : state.focusMode;
  const app = state.activeApp?.appName ?? "None";
  const sessionMin = Math.round(
    (Date.now() - state.sessionStartedAt) / 60000
  );
  const projectBadge = formatCurrentProjectBadge();

  const energyBar: Record<string, string> = {
    high: "🟢🟢🟢🟢",
    medium: "🟡🟡🟡",
    low: "🟠🟠",
    drained: "🔴",
  };

  let output = `
╭──────────────────────────────────────╮
│  ${emoji}  ${label.padEnd(33)}│
├──────────────────────────────────────┤
│  App:     ${app.padEnd(27)}│
│  Mode:    ${mode.padEnd(27)}│
│  Session: ${(sessionMin + " min").padEnd(27)}│
│  Energy:  ${(energyBar[state.energy] ?? "?").padEnd(27)}│
│  Idle:    ${(state.idleMinutes + " min").padEnd(27)}│`;

  if (projectBadge) {
    output += `\n│  Project: ${projectBadge.padEnd(27)}│`;
  }

  output += `\n╰──────────────────────────────────────╯`;

  return output;
}

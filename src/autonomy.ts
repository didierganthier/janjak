// ─── Autonomous Action Executor ─────────────────────────────────────
// Janjak doesn't just suggest — it acts. This module bridges the gap
// between proactive alerts and actual execution.
//
// Safety tiers:
//   auto     — Safe, reversible actions. Execute immediately.
//   confirm  — Notify user first, execute after 10s unless cancelled.
//   suggest  — Advisory only. Just show the alert (existing behavior).
//
// All autonomous actions are logged for full transparency.

import { enterFocusMode, enterBreakMode, getStatus } from "./engine.js";
import { pauseMusic, resumeMusic } from "./music.js";
import { getState, setState } from "./db.js";
import { sendNotification, notificationsAvailable } from "./notify.js";
import type { ProactiveAlert } from "./proactive.js";
import { exec } from "node:child_process";
import { isUrlOpen } from "./browser.js";

// ─── Types ──────────────────────────────────────────────────────

export type SafetyTier = "auto" | "confirm" | "suggest";

export interface AutonomousAction {
  /** Pattern to match against ProactiveAlert.action */
  pattern: string | RegExp;
  /** Safety tier for this action */
  tier: SafetyTier;
  /** Human-readable label */
  label: string;
  /** The function to execute */
  execute: () => Promise<string>;
}

export interface ActionLogEntry {
  timestamp: number;
  alertId: string;
  alertTitle: string;
  actionLabel: string;
  tier: SafetyTier;
  result: string;
  success: boolean;
}

// ─── Action Log (in-memory, last 50 actions) ───────────────────

const actionLog: ActionLogEntry[] = [];
const MAX_LOG = 50;

function logAction(entry: ActionLogEntry): void {
  actionLog.push(entry);
  if (actionLog.length > MAX_LOG) actionLog.shift();
}

export function getActionLog(): ActionLogEntry[] {
  return [...actionLog];
}

// ─── Pending Confirm Actions ────────────────────────────────────

const pendingConfirms = new Map<string, ReturnType<typeof setTimeout>>();

export function cancelPending(alertId: string): boolean {
  const timer = pendingConfirms.get(alertId);
  if (timer) {
    clearTimeout(timer);
    pendingConfirms.delete(alertId);
    return true;
  }
  return false;
}

export function getPendingActions(): string[] {
  return [...pendingConfirms.keys()];
}

// ─── Action Registry ────────────────────────────────────────────

const ACTIONS: AutonomousAction[] = [
  // ── Auto tier: safe, reversible ──
  {
    pattern: "janjak focus",
    tier: "auto",
    label: "Enter Focus Mode",
    execute: async () => {
      const status = getStatus();
      if (status.focusMode === "deep-work") return "Already in focus mode";
      return enterFocusMode();
    },
  },
  {
    pattern: "janjak break",
    tier: "auto",
    label: "Take a Break",
    execute: async () => {
      const status = getStatus();
      if (status.focusMode === "break") return "Already on break";
      return enterBreakMode();
    },
  },
  {
    pattern: "janjak music pause",
    tier: "auto",
    label: "Pause Music",
    execute: async () => {
      await pauseMusic();
      return "Music paused";
    },
  },
  {
    pattern: "janjak music resume",
    tier: "auto",
    label: "Resume Music",
    execute: async () => {
      await resumeMusic();
      return "Music resumed";
    },
  },

  // ── Confirm tier: notify first, 10s delay ──
  {
    pattern: /^https:\/\/meet\.google\.com\//,
    tier: "confirm",
    label: "Join Google Meet",
    execute: async () => {
      // Handled specially — the URL is the action itself
      return "Opening meeting link...";
    },
  },
];

// ─── Core: Match & Execute ──────────────────────────────────────

function findAction(actionStr: string): AutonomousAction | null {
  for (const action of ACTIONS) {
    if (typeof action.pattern === "string") {
      if (actionStr === action.pattern) return action;
    } else {
      if (action.pattern.test(actionStr)) return action;
    }
  }
  return null;
}

/** Check if a URL (or a URL containing the same meeting ID) is already open in any browser */
function isUrlOpenInBrowser(url: string): boolean {
  try {
    const parsed = new URL(url);
    const matchStr = parsed.hostname + parsed.pathname;
    return isUrlOpen(matchStr);
  } catch {
    return false;
  }
}

/** Open a URL safely (only https URLs to known meeting domains) */
function openMeetingLink(url: string): string {
  try {
    const parsed = new URL(url);
    const allowedHosts = ["meet.google.com", "zoom.us", "teams.microsoft.com"];
    if (parsed.protocol === "https:" && allowedHosts.some(h => parsed.hostname.endsWith(h))) {
      if (isUrlOpenInBrowser(url)) {
        return "already-open";
      }
      exec(`open ${JSON.stringify(url)}`);
      return "opened";
    }
    return "blocked";
  } catch { return "error"; }
}

/**
 * Process a proactive alert and potentially execute its action autonomously.
 * Returns true if the action was handled (auto-executed or scheduled for confirm).
 */
export async function executeAutonomously(alert: ProactiveAlert): Promise<boolean> {
  if (!isAutonomyEnabled()) return false;
  if (!alert.action) return false;

  const action = findAction(alert.action);
  if (!action) return false;

  // Check tier-specific enabling
  const tierEnabled = isTierEnabled(action.tier);
  if (!tierEnabled) return false;

  if (action.tier === "auto") {
    return executeNow(alert, action);
  }

  if (action.tier === "confirm") {
    return scheduleWithConfirm(alert, action);
  }

  // "suggest" tier — don't execute, just let the normal alert flow handle it
  return false;
}

async function executeNow(alert: ProactiveAlert, action: AutonomousAction): Promise<boolean> {
  try {
    let result: string;

    // Special case: meeting links
    if (action.pattern instanceof RegExp && alert.action) {
      const status = openMeetingLink(alert.action);
      if (status === "already-open") {
        result = `Already open in browser — skipped: ${alert.action}`;
        logAction({
          timestamp: Date.now(),
          alertId: alert.id,
          alertTitle: alert.title,
          actionLabel: action.label,
          tier: action.tier,
          result,
          success: true,
        });
        if (notificationsAvailable()) {
          sendNotification(
            `🤖 ${action.label} — already open, skipping`,
            "Janjak Autonomy",
            alert.title,
          );
        }
        return true;
      }
      result = `Opened: ${alert.action}`;
    } else {
      result = await action.execute();
    }

    logAction({
      timestamp: Date.now(),
      alertId: alert.id,
      alertTitle: alert.title,
      actionLabel: action.label,
      tier: action.tier,
      result,
      success: true,
    });

    // Notify the user about what was done
    if (notificationsAvailable()) {
      sendNotification(
        `🤖 Auto: ${action.label}\n${result}`,
        "Janjak Autonomy",
        alert.title,
      );
    }

    return true;
  } catch (err) {
    logAction({
      timestamp: Date.now(),
      alertId: alert.id,
      alertTitle: alert.title,
      actionLabel: action.label,
      tier: action.tier,
      result: err instanceof Error ? err.message : "Unknown error",
      success: false,
    });
    return false;
  }
}

function scheduleWithConfirm(alert: ProactiveAlert, action: AutonomousAction): boolean {
  const CONFIRM_DELAY = 10_000; // 10 seconds

  // Don't stack duplicate confirms
  if (pendingConfirms.has(alert.id)) return true;

  // Notify user — they have 10s to cancel
  if (notificationsAvailable()) {
    sendNotification(
      `⏳ Will ${action.label.toLowerCase()} in 10s...\nRun "janjak autonomy cancel" to stop.`,
      "Janjak Autonomy",
      alert.title,
    );
  }

  const timer = setTimeout(async () => {
    pendingConfirms.delete(alert.id);
    await executeNow(alert, action);
  }, CONFIRM_DELAY);

  pendingConfirms.set(alert.id, timer);
  return true;
}

// ─── Configuration ──────────────────────────────────────────────

export function isAutonomyEnabled(): boolean {
  return getState("autonomy_enabled") === "true";
}

export function setAutonomyEnabled(enabled: boolean): void {
  setState("autonomy_enabled", enabled ? "true" : "false");
}

export function isTierEnabled(tier: SafetyTier): boolean {
  if (tier === "suggest") return true; // suggestions are always shown
  const val = getState(`autonomy_tier_${tier}`);
  // Auto tier defaults to enabled when autonomy is on; confirm defaults to enabled
  return val !== "false";
}

export function setTierEnabled(tier: SafetyTier, enabled: boolean): void {
  setState(`autonomy_tier_${tier}`, enabled ? "true" : "false");
}

// ─── Formatting ─────────────────────────────────────────────────

export function formatAutonomyStatus(): string {
  const enabled = isAutonomyEnabled();
  const autoOn = isTierEnabled("auto");
  const confirmOn = isTierEnabled("confirm");
  const pending = getPendingActions();

  let out = `\n🤖 Janjak Autonomy: ${enabled ? "✅ ON" : "❌ OFF"}\n`;
  out += `\n  Safety Tiers:\n`;
  out += `    ⚡ Auto (safe, immediate):   ${autoOn ? "✅" : "❌"}\n`;
  out += `    ⏳ Confirm (10s delay):       ${confirmOn ? "✅" : "❌"}\n`;
  out += `    💬 Suggest (notify only):     ✅ (always on)\n`;

  out += `\n  Registered Actions:\n`;
  for (const a of ACTIONS) {
    const tierEmoji = a.tier === "auto" ? "⚡" : a.tier === "confirm" ? "⏳" : "💬";
    out += `    ${tierEmoji} ${a.label}\n`;
  }

  if (pending.length > 0) {
    out += `\n  ⏳ Pending (${pending.length}):\n`;
    for (const id of pending) out += `    • ${id}\n`;
  }

  return out;
}

export function formatActionLog(): string {
  if (actionLog.length === 0) return "\n  No autonomous actions taken yet.\n";

  let out = `\n📋 Autonomous Action Log (last ${actionLog.length}):\n\n`;
  for (const entry of [...actionLog].reverse().slice(0, 20)) {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const icon = entry.success ? "✅" : "❌";
    const tierEmoji = entry.tier === "auto" ? "⚡" : "⏳";
    out += `  ${icon} ${time} ${tierEmoji} ${entry.actionLabel}\n`;
    out += `     Alert: ${entry.alertTitle}\n`;
    out += `     Result: ${entry.result}\n\n`;
  }
  return out;
}

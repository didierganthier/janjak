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
import { recordFeedback } from "./learning/feedback.js";
import { logDecision } from "./learning/explain.js";
import { getActionTierOverride } from "./learning/adapt.js";
import { runAgent } from "./agent/agent.js";

// Actions whose `action` string starts with this prefix are executed by the
// agentic brain (runAgent) rather than the simple ACTIONS registry. Only the
// "auto" tier runs them autonomously, and always without a confirm callback —
// so any risky (confirm-tier) tool the agent reaches for is auto-blocked.
const AGENT_PREFIX = "agent:";

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

const pendingConfirms = new Map<string, { timer: ReturnType<typeof setTimeout>; actionLabel: string }>();

export function cancelPending(alertId: string): boolean {
  const pending = pendingConfirms.get(alertId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingConfirms.delete(alertId);
    recordFeedback({
      actionType: "autonomy",
      actionId: pending.actionLabel,
      outcome: "cancelled",
      context: { alertId },
    });
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

/** Look up the registry (base) safety tier for an action by its label. */
export function getActionBaseTier(label: string): SafetyTier | null {
  const action = ACTIONS.find((a) => a.label === label);
  return action ? action.tier : null;
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
 * Run an agent-backed proactive action (e.g. meeting prep, end-of-day plan).
 * These use the full agentic brain but only at the "auto" tier and without a
 * confirm callback, so any risky (confirm-tier) tool is blocked by default —
 * the agent can read, summarize and save notes, but never draft/send/write.
 * A persistent per-alert marker guarantees each one runs at most once.
 */
async function executeAgentAction(alert: ProactiveAlert): Promise<boolean> {
  const tier = alert.tier ?? "confirm";
  // Only safe, read-only auto-tier agent actions run autonomously in v1.
  if (tier !== "auto") return false;
  if (!isTierEnabled("auto")) return false;

  const request = alert.action!.slice(AGENT_PREFIX.length).trim();
  if (!request) return false;

  const doneKey = `agent_action_done:${alert.id}`;
  if (getState(doneKey)) return true; // already handled
  setState(doneKey, String(Date.now())); // optimistic dedupe (prevents overlap)

  const label = alert.actionLabel ?? "Proactive briefing";
  try {
    // No confirm callback → confirm-tier tools (write/draft/send) auto-block.
    const answer = await runAgent(request);
    logAction({
      timestamp: Date.now(),
      alertId: alert.id,
      alertTitle: alert.title,
      actionLabel: label,
      tier: "auto",
      result: answer.slice(0, 200),
      success: true,
    });
    recordFeedback({
      actionType: "autonomy",
      actionId: label,
      outcome: "accepted",
      context: { alertId: alert.id, category: alert.category, agent: true },
    });
    logDecision({
      decisionId: `autonomy-agent-${alert.id}`,
      type: "autonomy",
      description: `Proactive: ${alert.title}`,
      evidence: { signals: [`category:${alert.category}`, "agent"], result: answer.slice(0, 160) },
      confidence: 0.7,
    });
    if (notificationsAvailable()) {
      sendNotification(answer.slice(0, 180), "Janjak", label);
    }
    return true;
  } catch {
    setState(doneKey, ""); // clear marker so it can retry on a later tick
    logAction({
      timestamp: Date.now(),
      alertId: alert.id,
      alertTitle: alert.title,
      actionLabel: label,
      tier: "auto",
      result: "agent action failed",
      success: false,
    });
    return false;
  }
}

/**
 * Process a proactive alert and potentially execute its action autonomously.
 * Returns true if the action was handled (auto-executed or scheduled for confirm).
 */
export async function executeAutonomously(alert: ProactiveAlert): Promise<boolean> {
  if (!isAutonomyEnabled()) return false;
  if (!alert.action) return false;

  // Agent-backed proactive actions (meeting prep, EOD planning, …).
  if (alert.action.startsWith(AGENT_PREFIX)) {
    return executeAgentAction(alert);
  }

  const action = findAction(alert.action);
  if (!action) return false;

  // The learning loop may have demoted this action's tier based on past
  // rejections. Honor the override if present.
  const effectiveTier = getActionTierOverride(action.label) ?? action.tier;

  // Check tier-specific enabling
  const tierEnabled = isTierEnabled(effectiveTier);
  if (!tierEnabled) return false;

  if (effectiveTier === "auto") {
    return executeNow(alert, action);
  }

  if (effectiveTier === "confirm") {
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

    recordFeedback({
      actionType: "autonomy",
      actionId: action.label,
      outcome: "accepted",
      context: { alertId: alert.id, category: alert.category, tier: action.tier },
    });
    logDecision({
      decisionId: `autonomy-${alert.id}-${Date.now()}`,
      type: "autonomy",
      description: `Auto-executed: ${action.label}`,
      evidence: { signals: [alert.category, alert.title], result },
      confidence: 0.8,
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
    recordFeedback({
      actionType: "autonomy",
      actionId: action.label,
      outcome: "rejected",
      context: { alertId: alert.id, error: err instanceof Error ? err.message : "unknown" },
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

  pendingConfirms.set(alert.id, { timer, actionLabel: action.label });

  logDecision({
    decisionId: `autonomy-confirm-${alert.id}`,
    type: "autonomy",
    description: `Scheduled (confirm tier): ${action.label}`,
    evidence: { signals: [alert.category, alert.title] },
    confidence: 0.6,
  });

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

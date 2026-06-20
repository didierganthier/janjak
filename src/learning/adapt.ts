// ─── Learning Loop: Adaptation ──────────────────────────────────
// Turns captured feedback into behavior changes. Thresholds adapt based on
// outcomes — never hardcoded forever. Each pass returns a list of the
// adaptations it applied so they can be surfaced to the user.

import { getState, setState } from "../db.js";
import { getStatsByType, type ActionType } from "./feedback.js";

export interface Adaptation {
  rule: string;
  target: string;
  detail: string;
}

// ─── Tunable thresholds ─────────────────────────────────────────
const NUDGE_MIN_SAMPLES = 20;
const NUDGE_ACCEPT_FLOOR = 0.3;
const NUDGE_MUTE_DAYS = 7;

const AUTONOMY_MIN_SAMPLES = 5;
const AUTONOMY_REJECT_CEILING = 0.4;

const WORKFLOW_MIN_SAMPLES = 4;
const WORKFLOW_FAILURE_CEILING = 0.5;

const MUTE_PREFIX = "mute_alert_";

// ─── Nudge / alert muting ───────────────────────────────────────

export function muteAlertCategory(category: string, days: number, now = Date.now()): void {
  const until = now + days * 86400000;
  setState(`${MUTE_PREFIX}${category}`, String(until));
}

export function isAlertMuted(category: string, now = Date.now()): boolean {
  const raw = getState(`${MUTE_PREFIX}${category}`);
  if (!raw) return false;
  const until = parseInt(raw, 10);
  if (Number.isNaN(until)) return false;
  return now < until;
}

// ─── Autonomy per-action tier demotion ──────────────────────────

const TIER_ORDER = ["auto", "confirm", "suggest"] as const;
export type ActionTier = (typeof TIER_ORDER)[number];

const ACTION_TIER_PREFIX = "autonomy_action_tier_";

export function getActionTierOverride(actionId: string): ActionTier | null {
  const raw = getState(`${ACTION_TIER_PREFIX}${actionId}`);
  if (raw === "auto" || raw === "confirm" || raw === "suggest") return raw;
  return null;
}

export function setActionTierOverride(actionId: string, tier: ActionTier): void {
  setState(`${ACTION_TIER_PREFIX}${actionId}`, tier);
}

function demoteTier(tier: ActionTier): ActionTier {
  const idx = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(idx + 1, TIER_ORDER.length - 1)]!;
}

/**
 * Run the full adaptation pass over captured feedback. Pure decisions are
 * applied immediately; workflow disabling is delegated to a callback so this
 * module stays free of workflow imports (avoids cycles).
 */
export function adaptFromFeedback(opts: {
  onDisableWorkflow?: (workflowId: string) => void;
  currentActionTier?: (actionId: string) => ActionTier | null;
} = {}): Adaptation[] {
  const applied: Adaptation[] = [];

  // Rule 1: chronically rejected nudges get muted for a week.
  for (const { actionId, stats } of getStatsByType("nudge")) {
    if (stats.total >= NUDGE_MIN_SAMPLES && stats.acceptanceRate < NUDGE_ACCEPT_FLOOR) {
      if (!isAlertMuted(actionId)) {
        muteAlertCategory(actionId, NUDGE_MUTE_DAYS);
        applied.push({
          rule: "mute_nudge",
          target: actionId,
          detail: `acceptance ${(stats.acceptanceRate * 100).toFixed(0)}% over ${stats.total} → muted ${NUDGE_MUTE_DAYS}d`,
        });
      }
    }
  }

  // Rule 2: autonomous actions cancelled/rejected too often get demoted a tier.
  for (const { actionId, stats } of getStatsByType("autonomy")) {
    if (stats.total >= AUTONOMY_MIN_SAMPLES && stats.rejectionRate > AUTONOMY_REJECT_CEILING) {
      const current =
        getActionTierOverride(actionId) ?? opts.currentActionTier?.(actionId) ?? "auto";
      const next = demoteTier(current);
      if (next !== current) {
        setActionTierOverride(actionId, next);
        applied.push({
          rule: "demote_autonomy",
          target: actionId,
          detail: `reject ${(stats.rejectionRate * 100).toFixed(0)}% over ${stats.total} → ${current}→${next}`,
        });
      }
    }
  }

  // Rule 3: failing workflows get disabled.
  for (const { actionId, stats } of getStatsByType("workflow")) {
    if (stats.total >= WORKFLOW_MIN_SAMPLES && stats.rejectionRate > WORKFLOW_FAILURE_CEILING) {
      opts.onDisableWorkflow?.(actionId);
      applied.push({
        rule: "disable_workflow",
        target: actionId,
        detail: `failure ${(stats.rejectionRate * 100).toFixed(0)}% over ${stats.total} → disabled`,
      });
    }
  }

  return applied;
}

export function formatAdaptations(applied: Adaptation[]): string {
  if (applied.length === 0) {
    return "\n🧬 Adaptation pass — no changes. Behavior is well-calibrated.\n";
  }
  const lines: string[] = ["\n🧬 Adaptation pass — applied changes", "─".repeat(40)];
  for (const a of applied) {
    lines.push(`  [${a.rule}] ${a.target}`, `      ${a.detail}`);
  }
  lines.push("");
  return lines.join("\n");
}

export type { ActionType };

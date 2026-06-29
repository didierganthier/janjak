// ─── Pending confirmation store ──────────────────────────────────
// Non-interactive surfaces (daemon/HTTP UI) can't pop a y/N prompt mid
// agent run, so a confirm-tier tool is parked here as a "pending action"
// and the user confirms on the next turn (an affirmative reply, or a
// dedicated /api/confirm call). Process-local and session-scoped.

import { findTool, describeAction } from "./tools.js";
import { logDecision } from "../learning/explain.js";
import type { ConfirmRequest } from "./agent.js";

export interface PendingAction {
  tool: string;
  args: Record<string, unknown>;
  description: string;
  createdAt: number;
}

const store = new Map<string, PendingAction>();

export function getPending(key: string): PendingAction | null {
  return store.get(key) ?? null;
}

export function clearPending(key: string): void {
  store.delete(key);
}

const AFFIRMATIVE = /^(?:y|yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|confirm|please do|wi|oui)\b/i;
const NEGATIVE = /^(?:n|no|nope|cancel|stop|don'?t|nah|never)\b/i;

export function isAffirmative(text: string): boolean {
  return AFFIRMATIVE.test(text.trim());
}

export function isNegative(text: string): boolean {
  return NEGATIVE.test(text.trim());
}

/** A confirm callback that parks the action for later approval and denies it now. */
export function makePendingConfirm(key: string): (req: ConfirmRequest) => Promise<boolean> {
  return async (req) => {
    store.set(key, { tool: req.tool, args: req.args, description: req.description, createdAt: Date.now() });
    return false;
  };
}

/** Execute a parked action (already confirmed by the user). Returns null if none pending. */
export async function executePending(key: string): Promise<string | null> {
  const pending = store.get(key);
  if (!pending) return null;
  store.delete(key);

  const tool = findTool(pending.tool);
  let result: string;
  if (!tool) {
    result = `That action ("${pending.description}") is no longer available.`;
  } else {
    try {
      result = await tool.handler(pending.args);
    } catch (err) {
      result = `Error running ${pending.tool}: ${(err as Error).message}`;
    }
  }

  try {
    logDecision({
      decisionId: `agent-confirm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: "agent_action",
      description: `${describeAction(pending.tool, pending.args)} → ${result.replace(/\s+/g, " ").slice(0, 160)}`,
      confidence: 1,
    });
  } catch {
    /* audit logging is best-effort */
  }

  return result;
}

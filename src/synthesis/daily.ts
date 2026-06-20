// ─── Synthesis: Daily Consolidation ─────────────────────────────
// Janjak's nightly "sleep cycle": summarize the day, refresh the personal
// model, and run the forgetting curve so memory stays meaningful over years.

import OpenAI from "openai";
import { getSessionsByRange, getPomodorosByRange } from "../db.js";
import { capture } from "../memory/recall.js";
import { getMemoryBySource, type MemoryRecord } from "../memory/vector-store.js";
import { synthesizePersonalModel } from "../personal/synthesis.js";
import {
  consolidateMemoryStore,
  consolidateEntities,
  pruneArchivedMemories,
  formatMemoryConsolidation,
  type MemoryConsolidationResult,
  type EntityConsolidationResult,
  type ArchivePruneResult,
} from "./consolidate.js";
import type { ActionTier } from "../learning/adapt.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SUMMARY_IMPORTANCE = 0.8;

export interface DayContext {
  dateStr: string; // YYYY-MM-DD (local)
  dayStart: number;
  dayEnd: number;
  totalMinutes: number;
  byActivity: Record<string, number>;
  topApps: Array<{ app: string; minutes: number }>;
  pomodoroCount: number;
  pomodoroMinutes: number;
  hasActivity: boolean;
}

function localDateStr(now: number): string {
  // en-CA renders as YYYY-MM-DD.
  return new Date(now).toLocaleDateString("en-CA");
}

function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Gather the day's activity into a structured context. */
export function buildDayContext(reference = Date.now()): DayContext {
  const dayStart = startOfLocalDay(reference);
  const dayEnd = dayStart + DAY_MS;
  const sessions = getSessionsByRange(dayStart, dayEnd);
  const pomodoros = getPomodorosByRange(dayStart, dayEnd);

  const byActivity: Record<string, number> = {};
  const byApp: Record<string, number> = {};
  let totalMinutes = 0;
  for (const s of sessions) {
    byActivity[s.activity] = (byActivity[s.activity] ?? 0) + s.durationMinutes;
    byApp[s.appName] = (byApp[s.appName] ?? 0) + s.durationMinutes;
    totalMinutes += s.durationMinutes;
  }

  const topApps = Object.entries(byApp)
    .map(([app, minutes]) => ({ app, minutes: Math.round(minutes) }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  const pomodoroMinutes = pomodoros.reduce((sum, p) => sum + p.duration_minutes, 0);

  return {
    dateStr: localDateStr(dayStart),
    dayStart,
    dayEnd,
    totalMinutes: Math.round(totalMinutes),
    byActivity: Object.fromEntries(
      Object.entries(byActivity).map(([k, v]) => [k, Math.round(v)])
    ),
    topApps,
    pomodoroCount: pomodoros.length,
    pomodoroMinutes: Math.round(pomodoroMinutes),
    hasActivity: totalMinutes > 0 || pomodoros.length > 0,
  };
}

/** Render the day context into plain text for AI input or fallback display. */
export function formatDayContext(ctx: DayContext): string {
  const lines: string[] = [`Date: ${ctx.dateStr}`];
  lines.push(`Total tracked: ${ctx.totalMinutes} min`);
  const activities = Object.entries(ctx.byActivity)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}min`)
    .join(", ");
  if (activities) lines.push(`Activity: ${activities}`);
  if (ctx.topApps.length > 0) {
    lines.push(`Top apps: ${ctx.topApps.map((a) => `${a.app} (${a.minutes}min)`).join(", ")}`);
  }
  if (ctx.pomodoroCount > 0) {
    lines.push(`Focus sessions: ${ctx.pomodoroCount} (${ctx.pomodoroMinutes}min)`);
  }
  return lines.join("\n");
}

/** Deterministic one-line summary used when AI is unavailable. */
function templateSummary(ctx: DayContext): string {
  const top = ctx.topApps[0];
  const coding = ctx.byActivity["coding"] ?? 0;
  const parts: string[] = [];
  parts.push(`On ${ctx.dateStr} you tracked ${ctx.totalMinutes} minutes`);
  if (coding > 0) parts.push(`including ${coding} minutes of coding`);
  if (ctx.pomodoroCount > 0) parts.push(`across ${ctx.pomodoroCount} focus session${ctx.pomodoroCount === 1 ? "" : "s"}`);
  if (top) parts.push(`mostly in ${top.app}`);
  return parts.join(", ") + ".";
}

/** Generate a one-paragraph reflective summary of the day. */
export async function generateDaySummary(ctx: DayContext): Promise<string> {
  if (!ctx.hasActivity) return "";
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return templateSummary(ctx);

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are Janjak, a personal AI assistant. Summarize the user's day in ONE concise, reflective paragraph (2-4 sentences). Note what they focused on, any notable pattern, and a light observation. No bullet points. Respond in the user's typical language.",
        },
        { role: "user", content: formatDayContext(ctx) },
      ],
      max_tokens: 160,
      temperature: 0.6,
    });
    const text = response.choices[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : templateSummary(ctx);
  } catch {
    return templateSummary(ctx);
  }
}

export interface DailyConsolidationOptions {
  /** When the consolidation is running (defaults to now). */
  now?: number;
  /** Skip the AI day-summary step (useful for tests / no-network runs). */
  skipSummary?: boolean;
  /** Adaptation callbacks; when provided, a learning adaptation pass runs. */
  onDisableWorkflow?: (workflowId: string) => void;
  currentActionTier?: (actionId: string) => ActionTier | null;
}

export interface DailyConsolidationResult {
  date: string;
  summary: string;
  summaryStored: boolean;
  preferencesUpdated: number;
  routinesUpdated: number;
  preferencesDecayed: number;
  memory: MemoryConsolidationResult;
  entities: EntityConsolidationResult;
  prune: ArchivePruneResult;
}

/** Look up an already-stored daily summary memory for a given date. */
export function getDailySummaryMemory(dateStr: string): MemoryRecord | null {
  return getMemoryBySource("daily_summary", dateStr);
}

/**
 * Run the full nightly consolidation. Idempotent on the day summary
 * (keyed by date) — safe to invoke more than once per day.
 */
export async function runDailyConsolidation(
  opts: DailyConsolidationOptions = {}
): Promise<DailyConsolidationResult> {
  const now = opts.now ?? Date.now();
  const ctx = buildDayContext(now);

  // 1. Day summary → high-importance memory (idempotent by date).
  let summary = "";
  let summaryStored = false;
  const existing = getDailySummaryMemory(ctx.dateStr);
  if (existing) {
    summary = existing.text;
  } else if (!opts.skipSummary && ctx.hasActivity) {
    summary = await generateDaySummary(ctx);
    if (summary) {
      try {
        await capture({
          type: "daily_summary",
          text: summary,
          sourceId: ctx.dateStr,
          metadata: {
            date: ctx.dateStr,
            totalMinutes: ctx.totalMinutes,
            pomodoros: ctx.pomodoroCount,
          },
          importance: SUMMARY_IMPORTANCE,
          timestamp: ctx.dayStart,
        });
        summaryStored = true;
      } catch {
        /* embedding may be unavailable; summary still returned */
      }
    }
  }

  // 2. Refresh the personal model from the day's behavior.
  let preferencesUpdated = 0;
  let routinesUpdated = 0;
  let preferencesDecayed = 0;
  try {
    const synth = synthesizePersonalModel(now);
    preferencesUpdated = synth.preferencesUpdated;
    routinesUpdated = synth.routinesUpdated;
    preferencesDecayed = synth.preferencesDecayed;
  } catch {
    /* best-effort */
  }

  // 3. Entity recency upkeep + 4/5. memory forgetting curve.
  const entities = consolidateEntities(now);
  const memory = consolidateMemoryStore(now);

  // 5b. Compress the archival tail: prune year-old, low-importance memory.
  let prune: ArchivePruneResult = { candidates: 0, pruned: 0 };
  try {
    prune = pruneArchivedMemories(now);
  } catch {
    /* best-effort */
  }

  // 6. Learning adaptation pass (only when callbacks are supplied).
  if (opts.onDisableWorkflow || opts.currentActionTier) {
    try {
      const { adaptFromFeedback } = await import("../learning/adapt.js");
      adaptFromFeedback({
        ...(opts.onDisableWorkflow ? { onDisableWorkflow: opts.onDisableWorkflow } : {}),
        ...(opts.currentActionTier ? { currentActionTier: opts.currentActionTier } : {}),
      });
    } catch {
      /* best-effort */
    }
  }

  return {
    date: ctx.dateStr,
    summary,
    summaryStored,
    preferencesUpdated,
    routinesUpdated,
    preferencesDecayed,
    memory,
    entities,
    prune,
  };
}

export function formatDailyConsolidation(result: DailyConsolidationResult): string {
  const lines: string[] = ["", `🌙 Daily consolidation — ${result.date}`, ""];
  if (result.summary) {
    lines.push("  Summary:");
    lines.push(`    ${result.summary}`);
    if (result.summaryStored) lines.push("    (saved to memory)");
    lines.push("");
  } else {
    lines.push("  No activity to summarize today.", "");
  }
  lines.push(
    `  Personal model: ${result.preferencesUpdated} prefs updated · ${result.routinesUpdated} routines · ${result.preferencesDecayed} decayed`
  );
  lines.push(formatMemoryConsolidation(result.memory, result.entities, result.prune).trimEnd());
  lines.push("");
  return lines.join("\n");
}

/** Render today's summary on demand for `janjak summary today`. */
export async function formatTodaySummary(): Promise<string> {
  const ctx = buildDayContext();
  const existing = getDailySummaryMemory(ctx.dateStr);
  const summary = existing ? existing.text : await generateDaySummary(ctx);

  const lines: string[] = ["", `📋 Summary — ${ctx.dateStr}`, ""];
  if (!ctx.hasActivity && !summary) {
    lines.push("  No tracked activity yet today.", "");
    return lines.join("\n");
  }
  if (summary) {
    lines.push(`  ${summary}`, "");
  }
  lines.push(formatDayContext(ctx).split("\n").map((l) => `  ${l}`).join("\n"));
  lines.push("");
  return lines.join("\n");
}

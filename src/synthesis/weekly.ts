// ─── Synthesis: Weekly Review ───────────────────────────────────
// A weekly check-in where Janjak reflects back what it learned and asks the
// user to confirm. Confirmed answers become `stated` model facts (highest
// confidence). The interactive Q&A lives in the CLI; this module gathers and
// formats the material.

import { getDb, getSessionsByRange } from "../db.js";
import { getBehavioralProfile } from "../memory.js";
import { listGoals, type GoalRecord } from "../personal/goals.js";
import { listPreferences, type PreferenceRecord } from "../personal/profile.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WorkedOnItem {
  label: string;
  minutes: number;
}

export interface NewEntity {
  name: string;
  type: string;
  mentionCount: number;
  importance: number;
}

export interface WeeklyReview {
  weekStart: number;
  weekEnd: number;
  workedOn: WorkedOnItem[];
  dailySummaries: Array<{ date: string; text: string }>;
  patternChanges: string[];
  newEntities: NewEntity[];
  goals: GoalRecord[];
  reviewablePreferences: PreferenceRecord[];
  stats: {
    totalMinutes: number;
    codingMinutes: number;
    activeDays: number;
  };
}

function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function weekRangeMinutes(fromTs: number, toTs: number): {
  total: number;
  coding: number;
  byApp: Record<string, number>;
  activeDays: number;
} {
  const sessions = getSessionsByRange(fromTs, toTs);
  const byApp: Record<string, number> = {};
  const days = new Set<string>();
  let total = 0;
  let coding = 0;
  for (const s of sessions) {
    total += s.durationMinutes;
    if (s.activity === "coding") coding += s.durationMinutes;
    byApp[s.appName] = (byApp[s.appName] ?? 0) + s.durationMinutes;
    days.add(new Date(s.timestamp).toLocaleDateString("en-CA"));
  }
  return { total, coding, byApp, activeDays: days.size };
}

function getWeeklySummaries(fromTs: number, toTs: number): Array<{ date: string; text: string }> {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT text, source_id, timestamp FROM memory
       WHERE type = 'daily_summary' AND timestamp >= ? AND timestamp < ?
       ORDER BY timestamp DESC`
    )
    .all(fromTs, toTs) as Array<{ text: string; source_id: string | null; timestamp: number }>;
  return rows.map((r) => ({
    date: r.source_id ?? new Date(r.timestamp).toLocaleDateString("en-CA"),
    text: r.text,
  }));
}

function getNewEntities(fromTs: number, limit = 8): NewEntity[] {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT name, type, mention_count, importance FROM entities
       WHERE first_seen >= ?
       ORDER BY importance DESC, mention_count DESC
       LIMIT ?`
    )
    .all(fromTs, limit) as Array<{
    name: string;
    type: string;
    mention_count: number;
    importance: number;
  }>;
  return rows.map((r) => ({
    name: r.name,
    type: r.type,
    mentionCount: r.mention_count,
    importance: r.importance,
  }));
}

/** Assemble the weekly review material. */
export function gatherWeeklyReview(now = Date.now()): WeeklyReview {
  const weekEnd = startOfLocalDay(now) + DAY_MS; // end of today
  const weekStart = weekEnd - 7 * DAY_MS;
  const prevStart = weekStart - 7 * DAY_MS;

  const thisWeek = weekRangeMinutes(weekStart, weekEnd);
  const lastWeek = weekRangeMinutes(prevStart, weekStart);

  const workedOn: WorkedOnItem[] = Object.entries(thisWeek.byApp)
    .map(([label, minutes]) => ({ label, minutes: Math.round(minutes) }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 6);

  // Pattern changes: compare coding volume + surface profile insights.
  const patternChanges: string[] = [];
  if (lastWeek.coding > 0) {
    const delta = thisWeek.coding - lastWeek.coding;
    const pct = Math.round((delta / lastWeek.coding) * 100);
    if (Math.abs(pct) >= 15) {
      patternChanges.push(
        `Coding ${pct >= 0 ? "up" : "down"} ${Math.abs(pct)}% vs last week ` +
          `(${Math.round(thisWeek.coding)}min vs ${Math.round(lastWeek.coding)}min).`
      );
    }
  } else if (thisWeek.coding > 0) {
    patternChanges.push(`Coding resumed this week (${Math.round(thisWeek.coding)}min).`);
  }
  const profile = getBehavioralProfile();
  for (const insight of profile.insights) {
    if (insight.type === "peak-hours" || insight.type === "trend") {
      patternChanges.push(insight.message);
    }
  }

  return {
    weekStart,
    weekEnd,
    workedOn,
    dailySummaries: getWeeklySummaries(weekStart, weekEnd),
    patternChanges,
    newEntities: getNewEntities(weekStart),
    goals: listGoals({ activeOnly: true, limit: 10 }),
    reviewablePreferences: listPreferences({ minConfidence: 0.3, limit: 8 }).filter(
      (p) => p.source !== "stated"
    ),
    stats: {
      totalMinutes: Math.round(thisWeek.total),
      codingMinutes: Math.round(thisWeek.coding),
      activeDays: thisWeek.activeDays,
    },
  };
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-CA");
}

export function formatWeeklyReview(review: WeeklyReview): string {
  const lines: string[] = [
    "",
    `📆 Weekly Review — ${fmtDate(review.weekStart)} → ${fmtDate(review.weekEnd - DAY_MS)}`,
    "═".repeat(48),
    "",
    `  ${review.stats.activeDays} active days · ${review.stats.totalMinutes} min tracked · ${review.stats.codingMinutes} min coding`,
    "",
  ];

  if (review.workedOn.length > 0) {
    lines.push("  🛠️  What you worked on:");
    for (const item of review.workedOn) {
      lines.push(`     ${item.label.padEnd(24)} ${item.minutes} min`);
    }
    lines.push("");
  }

  if (review.patternChanges.length > 0) {
    lines.push("  📈 What changed about your patterns:");
    for (const change of review.patternChanges) lines.push(`     ${change}`);
    lines.push("");
  }

  if (review.newEntities.length > 0) {
    lines.push("  🆕 New people / projects / topics:");
    for (const e of review.newEntities) {
      lines.push(`     ${e.name} (${e.type}, ${e.mentionCount} mention${e.mentionCount === 1 ? "" : "s"})`);
    }
    lines.push("");
  }

  if (review.dailySummaries.length > 0) {
    lines.push("  📝 Daily summaries:");
    for (const s of review.dailySummaries) {
      const snippet = s.text.length > 120 ? s.text.slice(0, 117) + "..." : s.text;
      lines.push(`     ${s.date}: ${snippet}`);
    }
    lines.push("");
  }

  if (review.goals.length > 0) {
    lines.push("  🎯 Active goals:");
    for (const g of review.goals) {
      lines.push(`     [#${g.id}] [${g.category}] ${g.description} (priority ${g.priority}/10)`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

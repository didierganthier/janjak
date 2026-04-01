// ─── Focus Score + Weekly Report ───────────────────────────────────
// Calculates a daily productivity score (0-100) and generates
// a weekly trend chart with AI-powered summary.

import OpenAI from "openai";
import { getDailySummaries, getTasks, getTodayStats } from "./db.js";
import { getBehavioralProfile } from "./memory.js";
import { getActivityEmoji } from "./classifier.js";
import type { ActivityState } from "./types.js";

// ─── Focus Score Algorithm ──────────────────────────────────────

interface DayScore {
  date: string;
  score: number;
  totalMinutes: number;
  codingMinutes: number;
  browsingMinutes: number;
  focusRatio: number;    // coding / (coding + browsing)
  label: string;         // "🔥 On Fire" | "✅ Solid" | etc.
}

// Activity weights for scoring
const ACTIVITY_WEIGHTS: Record<string, number> = {
  coding: 1.0,
  writing: 0.85,
  designing: 0.8,
  creative: 0.85,
  learning: 0.9,
  reading: 0.7,
  meeting: 0.5,
  email: 0.4,
  communication: 0.3,
  browsing: 0.2,
  "social-media": 0.1,
  entertainment: 0.05,
  idle: 0,
  unknown: 0,
};

function scoreLabel(score: number): string {
  if (score >= 85) return "🔥 On Fire";
  if (score >= 70) return "✅ Solid";
  if (score >= 50) return "👍 Decent";
  if (score >= 30) return "😐 Light";
  return "💤 Rest Day";
}

function scoreBar(score: number): string {
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

/** Calculate focus score for a day: 0-100 based on productive time,
 *  focus ratio, and total engagement. */
function calculateDayScore(
  activities: Record<string, number>,
  avgDailyMinutes: number,
): DayScore & { date: string } {
  const coding = activities["coding"] ?? 0;
  const writing = activities["writing"] ?? 0;
  const designing = activities["designing"] ?? 0;
  const browsing = activities["browsing"] ?? 0;
  const meeting = activities["meeting"] ?? 0;
  const totalMinutes = Object.values(activities).reduce((a, b) => a + b, 0);

  // Weighted productive minutes
  let weightedMinutes = 0;
  for (const [act, mins] of Object.entries(activities)) {
    weightedMinutes += mins * (ACTIVITY_WEIGHTS[act] ?? 0);
  }

  // Focus ratio: how much of active time is deep work vs browsing
  const productiveTime = coding + writing + designing;
  const focusRatio = totalMinutes > 0
    ? productiveTime / totalMinutes
    : 0;

  // Score components (each 0-100):
  // 1. Productivity (40%): weighted minutes compared to your average
  const targetMinutes = Math.max(avgDailyMinutes * 0.7, 120); // at least 2h target
  const productivityScore = Math.min(100, (weightedMinutes / targetMinutes) * 100);

  // 2. Focus ratio (35%): % of time spent on deep work
  const focusScore = focusRatio * 100;

  // 3. Engagement (25%): did you show up? (diminishing returns after target)
  const engagementScore = Math.min(100, (totalMinutes / targetMinutes) * 100);

  const score = Math.round(
    productivityScore * 0.4 +
    focusScore * 0.35 +
    engagementScore * 0.25
  );

  const clampedScore = Math.max(0, Math.min(100, score));

  return {
    date: "",
    score: clampedScore,
    totalMinutes: Math.round(totalMinutes),
    codingMinutes: Math.round(coding),
    browsingMinutes: Math.round(browsing),
    focusRatio: Math.round(focusRatio * 100) / 100,
    label: scoreLabel(clampedScore),
  };
}

// ─── Public API ─────────────────────────────────────────────────

/** Get today's focus score */
export function getTodayScore(): DayScore {
  const stats = getTodayStats();
  const profile = getBehavioralProfile();
  const result = calculateDayScore(stats.byActivity, profile.avgDailyMinutes);
  const today = new Date().toISOString().slice(0, 10);
  return { ...result, date: today };
}

/** Get daily scores for the last N days */
export function getWeeklyScores(days = 7): DayScore[] {
  const dailies = getDailySummaries(days);
  const profile = getBehavioralProfile();

  // Group by date
  const byDate = new Map<string, Record<string, number>>();
  for (const d of dailies) {
    if (!byDate.has(d.date)) byDate.set(d.date, {});
    byDate.get(d.date)![d.activity] = d.totalMinutes;
  }

  const scores: DayScore[] = [];
  for (const [date, activities] of byDate) {
    const result = calculateDayScore(activities, profile.avgDailyMinutes);
    scores.push({ ...result, date });
  }

  return scores.sort((a, b) => a.date.localeCompare(b.date));
}

/** Format the weekly report for CLI */
export function formatWeeklyReport(scores: DayScore[]): string {
  let output = "\n📊 Weekly Focus Report\n";
  output += "═".repeat(52) + "\n\n";

  if (scores.length === 0) {
    output += "No data yet. Use `janjak focus` to start tracking.\n";
    return output;
  }

  // Average score
  const avgScore = Math.round(scores.reduce((s, d) => s + d.score, 0) / scores.length);
  output += `  Weekly Average: ${avgScore}/100  ${scoreLabel(avgScore)}\n\n`;

  // Daily chart
  output += "─".repeat(52) + "\n";
  output += "  Day          Score   Chart\n";
  output += "─".repeat(52) + "\n";

  for (const day of scores) {
    const dateStr = formatDateShort(day.date);
    const scoreStr = String(day.score).padStart(3);
    const bar = scoreBar(day.score);
    output += `  ${dateStr}    ${scoreStr}   ${bar} ${day.label}\n`;
  }

  output += "─".repeat(52) + "\n\n";

  // Breakdowns
  output += "  Day          💻 Code   🌐 Browse  ⏱️ Total   Focus%\n";
  output += "  " + "─".repeat(50) + "\n";

  for (const day of scores) {
    const dateStr = formatDateShort(day.date);
    const code = String(day.codingMinutes + "m").padStart(5);
    const browse = String(day.browsingMinutes + "m").padStart(5);
    const total = String(day.totalMinutes + "m").padStart(5);
    const ratio = String(Math.round(day.focusRatio * 100) + "%").padStart(4);
    output += `  ${dateStr}    ${code}     ${browse}    ${total}     ${ratio}\n`;
  }

  output += "\n";

  // Trend arrow
  if (scores.length >= 2) {
    const recent = scores[scores.length - 1]!.score;
    const prev = scores[scores.length - 2]!.score;
    const diff = recent - prev;
    if (diff > 5) {
      output += `  📈 Trending up (+${diff} from yesterday)\n`;
    } else if (diff < -5) {
      output += `  📉 Trending down (${diff} from yesterday)\n`;
    } else {
      output += `  ➡️  Steady pace\n`;
    }
  }

  return output;
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = days[d.getDay()]!;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${dayName} ${month}/${day}`.padEnd(10);
}

// ─── AI Weekly Summary ──────────────────────────────────────────

export async function getAIWeeklySummary(scores: DayScore[]): Promise<string> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    return "💡 Set OPENAI_API_KEY in ~/.janjak/.env for AI weekly summaries.";
  }

  const client = new OpenAI({ apiKey });
  const profile = getBehavioralProfile();
  const pendingTasks = getTasks();

  const scoreData = scores.map(s =>
    `${s.date}: score=${s.score}, coding=${s.codingMinutes}m, browsing=${s.browsingMinutes}m, total=${s.totalMinutes}m, focus=${Math.round(s.focusRatio * 100)}%`
  ).join("\n");

  const taskSummary = pendingTasks.length > 0
    ? `${pendingTasks.length} pending tasks (${pendingTasks.filter(t => t.priority === "high").length} high priority)`
    : "No pending tasks";

  const prompt = `You are Janjak, a personal productivity AI. Write a brief weekly summary.

WEEKLY SCORES:
${scoreData}

PATTERNS:
- Peak coding hours: ${profile.peakCodingHours.map(h => h + ":00").join(", ") || "unknown"}
- Avg daily coding: ${profile.avgCodingMinutes} min
- Tasks: ${taskSummary}

Write a 3-4 sentence summary that:
1. Highlights the best day and any notable pattern
2. Gives one specific, actionable suggestion for next week
3. Ends with brief encouragement

Be concise, warm, and data-driven. No bullet points. Use 1-2 emoji max.`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    return "⚠️  AI summary unavailable.";
  }
}

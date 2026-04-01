// ─── Behavioral Memory: Learns your patterns from session history ──
import {
  getHourlyDistribution,
  getDailySummaries,
  getTopApps,
  getTodayStats,
  getTotalTrackedDays,
} from "./db.js";
import type { ActivityState } from "./types.js";
import { getActivityEmoji } from "./classifier.js";

// ─── Types ──────────────────────────────────────────────────────

export interface PeakHour {
  hour: number;
  activity: ActivityState;
  avgMinutes: number;
}

export interface BehavioralInsight {
  type: "peak-hours" | "trend" | "habit" | "warning";
  message: string;
  data?: Record<string, unknown>;
}

export interface BehavioralProfile {
  peakCodingHours: number[];       // e.g. [9, 10, 20, 21]
  peakBrowsingHours: number[];
  avgDailyMinutes: number;
  avgCodingMinutes: number;
  topApps: Array<{ appName: string; totalMinutes: number }>;
  trackedDays: number;
  insights: BehavioralInsight[];
}

// ─── Analysis functions ─────────────────────────────────────────

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

function formatHourRange(hours: number[]): string {
  if (hours.length === 0) return "no data yet";
  if (hours.length === 1) return formatHour(hours[0]!);

  // Group consecutive hours into ranges
  const sorted = [...hours].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i]!;
    } else {
      ranges.push(start === prev ? formatHour(start) : `${formatHour(start)}–${formatHour(prev + 1)}`);
      start = sorted[i]!;
      prev = sorted[i]!;
    }
  }
  ranges.push(start === prev ? formatHour(start) : `${formatHour(start)}–${formatHour(prev + 1)}`);
  return ranges.join(", ");
}

/** Find peak hours for a given activity (top hours by total minutes) */
function findPeakHours(
  hourly: Array<{ hour: number; activity: string; totalMinutes: number }>,
  activity: string,
  topN = 4,
): number[] {
  return hourly
    .filter(h => h.activity === activity)
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
    .slice(0, topN)
    .map(h => h.hour)
    .sort((a, b) => a - b);
}

/** Analyze daily summaries for trends */
function analyzeTrends(
  dailies: Array<{ date: string; activity: string; totalMinutes: number }>,
): BehavioralInsight[] {
  const insights: BehavioralInsight[] = [];

  // Group by date
  const byDate = new Map<string, Record<string, number>>();
  for (const d of dailies) {
    if (!byDate.has(d.date)) byDate.set(d.date, {});
    byDate.get(d.date)![d.activity] = d.totalMinutes;
  }

  const dates = [...byDate.keys()].sort();
  if (dates.length < 2) return insights;

  // Calculate coding trend (last 3 days vs previous 3 days)
  if (dates.length >= 6) {
    const recent3 = dates.slice(-3);
    const prev3 = dates.slice(-6, -3);

    const recentCoding = recent3.reduce((sum, d) => sum + (byDate.get(d)?.["coding"] ?? 0), 0) / 3;
    const prevCoding = prev3.reduce((sum, d) => sum + (byDate.get(d)?.["coding"] ?? 0), 0) / 3;

    if (recentCoding > prevCoding * 1.3) {
      insights.push({
        type: "trend",
        message: `📈 Coding is up ${Math.round(((recentCoding - prevCoding) / (prevCoding || 1)) * 100)}% vs last 3 days. Momentum!`,
      });
    } else if (recentCoding < prevCoding * 0.7 && prevCoding > 10) {
      insights.push({
        type: "trend",
        message: `📉 Coding dropped ${Math.round(((prevCoding - recentCoding) / (prevCoding || 1)) * 100)}% vs last 3 days.`,
      });
    }
  }

  // Check browsing-heavy days
  const recentDate = dates[dates.length - 1]!;
  const recent = byDate.get(recentDate) ?? {};
  const browsingMin = recent["browsing"] ?? 0;
  const codingMin = recent["coding"] ?? 0;

  if (browsingMin > codingMin * 3 && browsingMin > 60) {
    insights.push({
      type: "warning",
      message: "🧭 Heavy browsing pattern detected recently. Context-switching may be hurting deep work.",
    });
  }

  return insights;
}

// ─── Main API ───────────────────────────────────────────────────

/** Build a complete behavioral profile from historical data */
export function getBehavioralProfile(): BehavioralProfile {
  const hourly = getHourlyDistribution();
  const dailies = getDailySummaries(14); // last 2 weeks
  const topApps = getTopApps(8);
  const trackedDays = getTotalTrackedDays();

  const peakCodingHours = findPeakHours(hourly, "coding");
  const peakBrowsingHours = findPeakHours(hourly, "browsing");

  // Compute averages
  const byDate = new Map<string, number>();
  let totalCoding = 0;
  for (const d of dailies) {
    byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.totalMinutes);
    if (d.activity === "coding") totalCoding += d.totalMinutes;
  }
  const uniqueDays = byDate.size || 1;
  const avgDailyMinutes = Math.round([...byDate.values()].reduce((a, b) => a + b, 0) / uniqueDays);
  const avgCodingMinutes = Math.round(totalCoding / uniqueDays);

  // Gather insights
  const insights: BehavioralInsight[] = [];

  // Peak hours insight
  if (peakCodingHours.length > 0) {
    insights.push({
      type: "peak-hours",
      message: `🧠 Your peak coding hours: ${formatHourRange(peakCodingHours)}`,
      data: { hours: peakCodingHours },
    });
  }

  // Add trend insights
  insights.push(...analyzeTrends(dailies));

  // Habit detection: consistent daily patterns
  if (trackedDays >= 3) {
    const codingByHour = hourly
      .filter(h => h.activity === "coding")
      .sort((a, b) => b.totalMinutes - a.totalMinutes);

    if (codingByHour.length > 0) {
      const bestHour = codingByHour[0]!;
      insights.push({
        type: "habit",
        message: `⏰ You code most at ${formatHour(bestHour.hour)} (${Math.round(bestHour.totalMinutes)} min total).`,
      });
    }
  }

  return {
    peakCodingHours,
    peakBrowsingHours,
    avgDailyMinutes,
    avgCodingMinutes,
    topApps: topApps.map(a => ({ appName: a.appName, totalMinutes: Math.round(a.totalMinutes) })),
    trackedDays,
    insights,
  };
}

/** Get contextual nudges based on behavioral patterns */
export function getMemoryNudge(): string | null {
  const hour = new Date().getHours();
  const profile = getBehavioralProfile();
  const todayStats = getTodayStats();

  // "It's your peak coding hour and you're not coding"
  if (
    profile.peakCodingHours.includes(hour) &&
    !todayStats.byActivity["coding"]
  ) {
    return `🧠 ${formatHour(hour)} is usually your best coding time. Try: janjak focus`;
  }

  // "You usually code more than this by now"
  if (profile.avgCodingMinutes > 30 && hour >= 14) {
    const todayCoding = todayStats.byActivity["coding"] ?? 0;
    if (todayCoding < profile.avgCodingMinutes * 0.3) {
      return `📊 You usually have ~${profile.avgCodingMinutes}min of coding by end of day. Only ${todayCoding}min so far.`;
    }
  }

  return null;
}

/** Format the behavioral profile for CLI display */
export function formatInsights(): string {
  const profile = getBehavioralProfile();

  let output = "\n🧠 Behavioral Memory — What Janjak Has Learned\n";
  output += "═".repeat(48) + "\n\n";

  // Stats summary
  output += `📅 ${profile.trackedDays} days tracked\n`;
  output += `⏱️  Average daily screen time: ${profile.avgDailyMinutes} min\n`;
  output += `💻 Average daily coding: ${profile.avgCodingMinutes} min\n\n`;

  // Peak hours
  output += "─".repeat(48) + "\n";
  output += "⏰ Peak Hours\n\n";
  output += `  💻 Coding:   ${formatHourRange(profile.peakCodingHours)}\n`;
  output += `  🌐 Browsing: ${formatHourRange(profile.peakBrowsingHours)}\n\n`;

  // Top apps
  if (profile.topApps.length > 0) {
    output += "─".repeat(48) + "\n";
    output += "📱 Most Used Apps\n\n";
    for (const app of profile.topApps.slice(0, 6)) {
      const bar = "█".repeat(Math.max(1, Math.round(app.totalMinutes / 20)));
      output += `  ${app.appName.padEnd(20)} ${bar} ${app.totalMinutes} min\n`;
    }
    output += "\n";
  }

  // Insights
  if (profile.insights.length > 0) {
    output += "─".repeat(48) + "\n";
    output += "💡 Insights\n\n";
    for (const insight of profile.insights) {
      output += `  ${insight.message}\n`;
    }
    output += "\n";
  }

  return output;
}

// ─── Daily Streak + Gamification ────────────────────────────────────
// Tracks consecutive days with focus score >= 50.
// Shows 🔥 streak in status and score displays.

import { getWeeklyScores } from "./score.js";
import { getDailySummaries } from "./db.js";

const STREAK_THRESHOLD = 50; // minimum score to count as a streak day

/** Calculate the current streak (consecutive days with score >= 50).
 *  Looks back up to 365 days. Today counts if score >= 50. */
export function getCurrentStreak(): { days: number; best: number; todayQualifies: boolean } {
  // Get up to 90 days of scores (enough for any reasonable streak)
  const scores = getWeeklyScores(90);

  if (scores.length === 0) {
    return { days: 0, best: 0, todayQualifies: false };
  }

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // Build a set of qualifying dates
  const qualifyingDates = new Set<string>();
  for (const s of scores) {
    if (s.score >= STREAK_THRESHOLD) {
      qualifyingDates.add(s.date);
    }
  }

  const todayQualifies = qualifyingDates.has(today);

  // Count current streak: walk backwards from today (or yesterday if today doesn't qualify yet)
  let streakDays = 0;
  let checkDate = todayQualifies ? today : yesterday;

  // If neither today nor yesterday qualifies, streak is 0
  if (!qualifyingDates.has(checkDate)) {
    // Best streak calculation
    const best = calcBestStreak(scores);
    return { days: 0, best, todayQualifies };
  }

  // Walk backwards counting consecutive qualifying days
  const d = new Date(checkDate + "T12:00:00");
  while (true) {
    const dateStr = d.toISOString().slice(0, 10);
    if (qualifyingDates.has(dateStr)) {
      streakDays++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  const best = Math.max(streakDays, calcBestStreak(scores));
  return { days: streakDays, best, todayQualifies };
}

/** Calculate the best ever streak from scored days */
function calcBestStreak(scores: Array<{ date: string; score: number }>): number {
  if (scores.length === 0) return 0;

  // Sort by date ascending
  const sorted = [...scores].sort((a, b) => a.date.localeCompare(b.date));

  let best = 0;
  let current = 0;

  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.score >= STREAK_THRESHOLD) {
      if (i === 0) {
        current = 1;
      } else {
        // Check if consecutive day
        const prevDate = new Date(sorted[i - 1]!.date + "T12:00:00");
        const currDate = new Date(sorted[i]!.date + "T12:00:00");
        const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / 86400000);

        current = diffDays === 1 && sorted[i - 1]!.score >= STREAK_THRESHOLD
          ? current + 1
          : 1;
      }
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }

  return best;
}

/** Format streak for inline display (e.g. in status or score) */
export function formatStreakBadge(): string {
  const { days, todayQualifies } = getCurrentStreak();
  if (days === 0) {
    return todayQualifies ? "" : "💤 No streak — score 50+ to start one!";
  }
  const fire = days >= 7 ? "🔥🔥🔥" : days >= 3 ? "🔥🔥" : "🔥";
  const suffix = todayQualifies ? "" : " (keep it going today!)";
  return `${fire} ${days}-day streak${suffix}`;
}

/** Format full streak display for CLI */
export function formatStreakReport(): string {
  const { days, best, todayQualifies } = getCurrentStreak();

  let output = "\n🔥 Streak Report\n";
  output += "═".repeat(40) + "\n\n";

  if (days === 0 && !todayQualifies) {
    output += "  No active streak.\n";
    output += "  Score 50+ today to start a new one!\n";
  } else {
    const fire = days >= 7 ? "🔥🔥🔥" : days >= 3 ? "🔥🔥" : "🔥";
    output += `  Current: ${fire} ${days} day${days !== 1 ? "s" : ""}\n`;
    if (!todayQualifies) {
      output += "  ⚠️  Today doesn't qualify yet — keep going!\n";
    }
  }

  output += `  Best:    ⭐ ${best} day${best !== 1 ? "s" : ""}\n\n`;

  // Milestones
  const milestones = [
    { days: 3, label: "Getting Started", emoji: "🌱" },
    { days: 7, label: "One Week", emoji: "⚡" },
    { days: 14, label: "Two Weeks", emoji: "💪" },
    { days: 30, label: "Monthly Master", emoji: "🏆" },
    { days: 60, label: "Unstoppable", emoji: "👑" },
    { days: 100, label: "Century Club", emoji: "💎" },
  ];

  output += "  Milestones:\n";
  for (const m of milestones) {
    const achieved = best >= m.days;
    const current = days >= m.days;
    const icon = current ? "✅" : achieved ? "☑️ " : "⬜";
    output += `    ${icon} ${m.emoji} ${m.days} days — ${m.label}\n`;
  }

  output += "\n";
  return output;
}

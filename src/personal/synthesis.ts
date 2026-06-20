import { getBehavioralProfile } from "../memory.js";
import {
  listPreferences,
  upsertPreference,
  decayStalePreferences,
  type PreferenceRecord,
  type PreferenceCategory,
} from "./profile.js";
import { listGoals, type GoalRecord } from "./goals.js";
import {
  listRoutines,
  upsertRoutine,
  getRoutinesForMoment,
  type RoutineRecord,
} from "./routines.js";

export interface SynthesisResult {
  preferencesUpdated: number;
  routinesUpdated: number;
  preferencesDecayed: number;
}

function formatHourRange(hours: number[]): string {
  if (hours.length === 0) return "";
  const sorted = [...hours].sort((a, b) => a - b);
  const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `${pad(sorted[0]!)}-${pad(sorted[sorted.length - 1]! + 1)}`;
}

/**
 * Derive durable preferences and routines from observed behavior.
 * Runs nightly or via `janjak knows --refresh`. Idempotent — repeated runs
 * reinforce confidence rather than duplicating rows.
 */
export function synthesizePersonalModel(now = Date.now()): SynthesisResult {
  const profile = getBehavioralProfile();
  let preferencesUpdated = 0;
  let routinesUpdated = 0;

  // Derive schedule preferences from observed peak hours.
  if (profile.peakCodingHours.length > 0) {
    const range = formatHourRange(profile.peakCodingHours);
    if (range) {
      upsertPreference({
        category: "schedule",
        key: "peak_coding_hours",
        value: range,
        source: "observed",
        confirmedAt: now,
      });
      preferencesUpdated += 1;

      upsertRoutine({
        name: "deep_work_window",
        pattern: {
          activity: "coding",
          timeRange: {
            start: Math.min(...profile.peakCodingHours),
            end: Math.max(...profile.peakCodingHours),
          },
        },
        observedAt: now,
      });
      routinesUpdated += 1;
    }
  }

  // Derive a typical daily coding-volume preference.
  if (profile.trackedDays >= 2 && profile.avgCodingMinutes > 0) {
    upsertPreference({
      category: "work_style",
      key: "avg_daily_coding_minutes",
      value: String(profile.avgCodingMinutes),
      source: "observed",
      confirmedAt: now,
    });
    preferencesUpdated += 1;
  }

  // Derive a primary-tool preference from the most-used app.
  const topApp = profile.topApps[0];
  if (topApp && topApp.totalMinutes > 0) {
    upsertPreference({
      category: "work_style",
      key: "primary_app",
      value: topApp.appName,
      source: "observed",
      confirmedAt: now,
    });
    preferencesUpdated += 1;
  }

  const preferencesDecayed = decayStalePreferences(30, now);

  return { preferencesUpdated, routinesUpdated, preferencesDecayed };
}

/**
 * Format the personal model into a prompt block injected into AI calls so
 * generation is aligned with the user's goals, preferences, and routines.
 */
export function formatPersonalContextForPrompt(when = new Date()): string {
  const goals = listGoals({ activeOnly: true, limit: 5 });
  const prefs = listPreferences({ minConfidence: 0.5, limit: 10 });
  const routines = getRoutinesForMoment(when).slice(0, 3);

  if (goals.length === 0 && prefs.length === 0 && routines.length === 0) {
    return "";
  }

  const lines: string[] = ["[Personal Model]"];

  if (goals.length > 0) {
    lines.push("Active goals:");
    for (const goal of goals) {
      const due = goal.targetDate ? ` (target ${goal.targetDate})` : "";
      lines.push(`  - [${goal.category}] ${goal.description} (priority ${goal.priority}/10)${due}`);
    }
  }

  if (prefs.length > 0) {
    lines.push("Preferences:");
    for (const pref of prefs) {
      lines.push(
        `  - ${pref.category}.${pref.key} = ${pref.value} (${pref.source}, conf ${pref.confidence.toFixed(2)})`
      );
    }
  }

  if (routines.length > 0) {
    lines.push("Relevant routines now:");
    for (const routine of routines) {
      lines.push(`  - ${routine.name} (conf ${routine.confidence.toFixed(2)})`);
    }
  }

  return lines.join("\n");
}

/** Human-readable summary for the `janjak knows` command. */
export function formatPersonalModel(opts: { category?: PreferenceCategory } = {}): string {
  const goals = listGoals({ activeOnly: true });
  const prefs = listPreferences({ category: opts.category });
  const routines = listRoutines({ limit: 20 });

  const lines: string[] = ["", "🧠 What Janjak knows about you", "─".repeat(40)];

  lines.push("", "🎯 Goals");
  if (goals.length === 0) {
    lines.push("  (none yet — add with `janjak goal add \"...\"`)");
  } else {
    for (const goal of goals) {
      const due = goal.targetDate ? ` — target ${goal.targetDate}` : "";
      lines.push(`  [#${goal.id}] (${goal.category}) ${goal.description}  p${goal.priority}${due}`);
    }
  }

  lines.push("", opts.category ? `⚙️  Preferences — ${opts.category}` : "⚙️  Preferences");
  if (prefs.length === 0) {
    lines.push("  (none learned yet)");
  } else {
    for (const pref of prefs) {
      lines.push(
        `  [#${pref.id}] ${pref.category}.${pref.key} = ${pref.value}  ` +
          `(${pref.source}, conf ${pref.confidence.toFixed(2)}, x${pref.evidenceCount})`
      );
    }
  }

  if (!opts.category) {
    lines.push("", "🔁 Routines");
    if (routines.length === 0) {
      lines.push("  (none detected yet)");
    } else {
      for (const routine of routines) {
        lines.push(
          `  [#${routine.id}] ${routine.name}  (conf ${routine.confidence.toFixed(2)}, x${routine.observedCount})`
        );
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

export type { PreferenceRecord, GoalRecord, RoutineRecord };

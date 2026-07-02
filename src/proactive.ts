// ─── Proactive Notification Engine ──────────────────────────────────
// Janjak doesn't just react — it initiates. This engine monitors all
// signal sources and fires timely, contextual alerts.
//
// Signal sources:
//   1. Calendar — meeting reminders at 15m, 5m, and 1m
//   2. Distraction — prolonged social media / entertainment alerts
//   3. Focus score — score dropping, milestone reached
//   4. Behavioral — peak hour nudges, habit reminders
//   5. Tasks — deadline approaching, overdue tasks
//   6. Energy — break reminders, hydration, posture
//   7. Streaks — streak at risk, streak milestone
//   8. Goals — deadline pressure, daily focus on the #1 goal (Super Brain L3)
//   9. Relationships — reconnect nudges for key people gone quiet (Super Brain L2)

import { getStatus, getNudge, suggestNextTask } from "./engine.js";
import { getUpcomingEvents, getMeetingAlert, type CalendarEvent } from "./calendar.js";
import { getTodayScore } from "./score.js";
import { getMemoryNudge, getBehavioralProfile } from "./memory.js";
import { getCurrentStreak } from "./streak.js";
import { getTasks, getTodayStats } from "./db.js";
import { isAuthenticated } from "./gmail-auth.js";
import { triggerMeetingWorkflows } from "./workflows.js";
import { getState, setState } from "./db.js";
import { logDecision } from "./learning/explain.js";
import { isAlertMuted } from "./learning/adapt.js";
import { setWorkflowEnabled } from "./workflows.js";
import { getActionBaseTier } from "./autonomy.js";
import { runDailyConsolidation } from "./synthesis/daily.js";
import { listGoals } from "./personal/goals.js";
import { listEntities } from "./graph/entities.js";
import { listOutstandingPayments } from "./clientops/payments.js";
import { listFollowups } from "./clientops/followups.js";
import { listProjects } from "./clientops/projects.js";
import { isOverdue, daysUntil, formatMoney } from "./clientops/util.js";

// ─── Types ──────────────────────────────────────────────────────

export type AlertPriority = "critical" | "high" | "medium" | "low";
export type AlertCategory =
  | "meeting"
  | "distraction"
  | "score"
  | "behavior"
  | "task"
  | "energy"
  | "streak"
  | "milestone"
  | "goal"
  | "relationship"
  | "clientops";

export interface ProactiveAlert {
  id: string;
  category: AlertCategory;
  priority: AlertPriority;
  title: string;
  message: string;
  action?: string;       // Suggested action (e.g., "janjak focus")
  actionLabel?: string;  // Human label (e.g., "Start Focus Mode")
  timestamp: number;
  expiresAt?: number;    // Auto-dismiss after this time
  tier?: "auto" | "confirm" | "suggest"; // Autonomy tier for agent-backed actions
}

// ─── Alert State (deduplication + cooldowns) ────────────────────

const firedAlerts = new Map<string, number>(); // id → timestamp
const COOLDOWNS: Record<AlertCategory, number> = {
  meeting: 60_000,        // 1 minute between same meeting alerts
  distraction: 5 * 60_000, // 5 min between distraction warnings
  score: 30 * 60_000,     // 30 min between score alerts
  behavior: 60 * 60_000,  // 1 hour between behavioral nudges
  task: 30 * 60_000,      // 30 min between task reminders
  energy: 20 * 60_000,    // 20 min between energy alerts
  streak: 4 * 60 * 60_000, // 4 hours between streak alerts
  milestone: 60 * 60_000, // 1 hour between milestone celebrations
  goal: 4 * 60 * 60_000,  // 4 hours between goal nudges
  relationship: 6 * 60 * 60_000, // 6 hours between relationship nudges
  clientops: 4 * 60 * 60_000, // 4 hours between client-ops alerts
};

function canFire(id: string, category: AlertCategory): boolean {
  const lastFired = firedAlerts.get(id);
  if (!lastFired) return true;
  return Date.now() - lastFired >= COOLDOWNS[category];
}

function markFired(id: string): void {
  firedAlerts.set(id, Date.now());
  // Clean up old entries (> 24h)
  const cutoff = Date.now() - 24 * 60 * 60_000;
  for (const [key, ts] of firedAlerts) {
    if (ts < cutoff) firedAlerts.delete(key);
  }
}

// ─── Alert Generators ───────────────────────────────────────────

/** Calendar: 15m, 5m, and 1m meeting reminders */
async function checkCalendar(): Promise<ProactiveAlert[]> {
  if (!isAuthenticated()) return [];
  const alerts: ProactiveAlert[] = [];

  try {
    const upcoming = await getUpcomingEvents(20);

    for (const event of upcoming) {
      if (event.status !== "upcoming" || event.minutesUntil <= 0) continue;

      // Meeting prep (agent-backed, runs once per event ~10-14m before start).
      // Gated by autonomy: if autonomy is OFF it simply shows as a suggestion.
      if (event.minutesUntil <= 14 && event.minutesUntil > 9) {
        const prepKey = `mtgprep_emitted_${event.id}`;
        if (!getState(prepKey)) {
          setState(prepKey, "1");
          alerts.push({
            id: `mtgprep-${event.id}`,
            category: "meeting",
            priority: "low",
            title: `🧠 Prepping you for "${event.title}"`,
            message: `Gathering context for your meeting in ${event.minutesUntil}m…`,
            action:
              `agent:Help me prepare for my upcoming meeting "${event.title}" ` +
              `starting in about ${event.minutesUntil} minutes. ` +
              `Search my email (search_email) for the most recent relevant thread, ` +
              `and check related notes (recall_memory). Then write a concise 4-bullet ` +
              `prep brief: key context, what to know, open questions, and suggested ` +
              `talking points. Save the brief as a note (save_note). ` +
              `Do not draft or send any email.`,
            actionLabel: "Meeting prep",
            tier: "auto",
            timestamp: Date.now(),
            expiresAt: event.start.getTime(),
          });
        }
      }

      // 15-minute warning
      if (event.minutesUntil <= 15 && event.minutesUntil > 10) {
        const id = `meeting-15m-${event.id}`;
        if (canFire(id, "meeting")) {
          alerts.push({
            id,
            category: "meeting",
            priority: "medium",
            title: `📅 Meeting in ${event.minutesUntil}m`,
            message: event.title + (event.location ? ` — ${event.location}` : ""),
            action: event.meetLink ?? undefined,
            actionLabel: event.meetLink ? "Join Meeting" : undefined,
            timestamp: Date.now(),
            expiresAt: event.start.getTime(),
          });
        }
      }

      // 5-minute warning
      if (event.minutesUntil <= 5 && event.minutesUntil > 2) {
        const id = `meeting-5m-${event.id}`;
        if (canFire(id, "meeting")) {
          const meetText = event.meetLink ? `\n📹 ${event.meetLink}` : "";
          alerts.push({
            id,
            category: "meeting",
            priority: "high",
            title: `⚠️ Meeting in ${event.minutesUntil}m!`,
            message: event.title + meetText,
            action: event.meetLink ?? undefined,
            actionLabel: event.meetLink ? "Join Now" : undefined,
            timestamp: Date.now(),
            expiresAt: event.start.getTime(),
          });
        }
      }

      // 1-minute warning
      if (event.minutesUntil <= 1) {
        const id = `meeting-1m-${event.id}`;
        if (canFire(id, "meeting")) {
          alerts.push({
            id,
            category: "meeting",
            priority: "critical",
            title: "🚨 Meeting starting NOW!",
            message: event.title + (event.meetLink ? ` — JOIN: ${event.meetLink}` : ""),
            action: event.meetLink ?? undefined,
            actionLabel: event.meetLink ? "Join Now" : undefined,
            timestamp: Date.now(),
            expiresAt: event.start.getTime() + 5 * 60_000,
          });
        }
      }
    }
  } catch { /* calendar not available */ }

  // Trigger meeting-related workflows
  try {
    const meetEvents = await getUpcomingEvents(20);
    for (const ev of meetEvents) {
      if (ev.status === "upcoming" && ev.minutesUntil > 0 && ev.minutesUntil <= 15) {
        triggerMeetingWorkflows(ev.minutesUntil).catch(() => {});
        break; // only trigger once per check cycle
      }
    }
  } catch {}

  return alerts;
}

/** Distraction detection: social media, entertainment, excessive browsing */
function checkDistractions(): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];
  const status = getStatus();
  const stats = getTodayStats();

  // Social media alert: more than 15 min today
  const socialMinutes = stats.byActivity["social-media"] ?? 0;
  if (socialMinutes >= 15) {
    const id = `distraction-social-${Math.floor(socialMinutes / 15)}`;
    if (canFire(id, "distraction")) {
      alerts.push({
        id,
        category: "distraction",
        priority: socialMinutes >= 45 ? "high" : "medium",
        title: `📱 ${Math.round(socialMinutes)}m on social media today`,
        message: socialMinutes >= 45
          ? "Almost an hour on social media. Consider a focussed work block."
          : "Getting distracted? A quick focus session could help.",
        action: "janjak focus",
        actionLabel: "Start Focus Mode",
        timestamp: Date.now(),
      });
    }
  }

  // Entertainment binge: more than 30 min
  const entertainMinutes = stats.byActivity["entertainment"] ?? 0;
  if (entertainMinutes >= 30) {
    const id = `distraction-entertain-${Math.floor(entertainMinutes / 30)}`;
    if (canFire(id, "distraction")) {
      alerts.push({
        id,
        category: "distraction",
        priority: "medium",
        title: `🎮 ${Math.round(entertainMinutes)}m of entertainment today`,
        message: "Nothing wrong with a break, but your tasks might need attention.",
        timestamp: Date.now(),
      });
    }
  }

  // Currently on distraction during focus mode
  if (
    status.focusMode === "deep-work" &&
    (status.activity === "social-media" || status.activity === "entertainment")
  ) {
    const id = "distraction-focus-mode";
    if (canFire(id, "distraction")) {
      alerts.push({
        id,
        category: "distraction",
        priority: "high",
        title: "🎯 You're in Focus Mode!",
        message: `Looks like you drifted to ${status.activeApp?.appName ?? status.activity}. Want to get back on track?`,
        action: "janjak focus",
        actionLabel: "Refocus",
        timestamp: Date.now(),
      });
    }
  }

  return alerts;
}

/** Focus score alerts: drops, milestones */
function checkScore(): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];
  const score = getTodayScore();
  const hour = new Date().getHours();

  // Only alert after some work has happened (after 10am, >30min tracked)
  if (hour < 10 || score.totalMinutes < 30) return alerts;

  // Score dropping below 30 (light day warning)
  if (score.score < 30 && hour >= 14) {
    const id = `score-low-${new Date().toISOString().slice(0, 10)}`;
    if (canFire(id, "score")) {
      const suggestion = suggestNextTask();
      alerts.push({
        id,
        category: "score",
        priority: "medium",
        title: `📉 Focus score: ${score.score}/100`,
        message: `Light day so far. ${suggestion ? `Try: ${suggestion}` : "A focus session could help boost it."}`,
        action: "janjak focus",
        actionLabel: "Start Focus Mode",
        timestamp: Date.now(),
      });
    }
  }

  // Score milestone: crossed 80
  if (score.score >= 80) {
    const id = `score-high-${new Date().toISOString().slice(0, 10)}`;
    if (canFire(id, "milestone")) {
      alerts.push({
        id,
        category: "milestone",
        priority: "low",
        title: "🔥 Focus score hit " + score.score + "!",
        message: "You're on fire today! Keep the momentum going.",
        timestamp: Date.now(),
      });
    }
  }

  return alerts;
}

/** Behavioral nudges: peak hours, patterns */
function checkBehavior(): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];

  try {
    const profile = getBehavioralProfile();
    const hour = new Date().getHours();
    const status = getStatus();

    // Peak coding hour but not coding
    if (
      profile.peakCodingHours.includes(hour) &&
      status.activity !== "coding" &&
      status.activity !== "idle" &&
      status.focusMode !== "break"
    ) {
      const id = `behavior-peak-${hour}`;
      if (canFire(id, "behavior")) {
        alerts.push({
          id,
          category: "behavior",
          priority: "low",
          title: `🧠 Peak hour: ${hour}:00`,
          message: `This is usually your best coding time. Your brain is primed for deep work.`,
          action: "janjak focus",
          actionLabel: "Start Focus Mode",
          timestamp: Date.now(),
        });
      }
    }

    // End of day, coding below average
    if (hour >= 17) {
      const stats = getTodayStats();
      const codingToday = stats.byActivity["coding"] ?? 0;
      if (codingToday < profile.avgCodingMinutes * 0.5 && profile.avgCodingMinutes > 30) {
        const id = `behavior-below-avg-${new Date().toISOString().slice(0, 10)}`;
        if (canFire(id, "behavior")) {
          alerts.push({
            id,
            category: "behavior",
            priority: "low",
            title: "📊 Below your usual pace",
            message: `${Math.round(codingToday)}m of coding vs your avg of ${Math.round(profile.avgCodingMinutes)}m. Still time to squeeze in a session.`,
            action: "janjak focus",
            actionLabel: "Quick Focus Session",
            timestamp: Date.now(),
          });
        }
      }
    }
  } catch { /* memory analysis failed */ }

  return alerts;
}

/** Task alerts: deadlines, overdue */
function checkTasks(): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];
  const tasks = getTasks();
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getHours();

  // Morning task briefing (between 8-10am)
  if (hour >= 8 && hour <= 10) {
    const pending = tasks.filter(t => t.status === "pending" || t.status === "in-progress");
    const urgent = pending.filter(t => t.deadline && t.deadline <= today);

    if (urgent.length > 0) {
      const id = `tasks-overdue-${today}`;
      if (canFire(id, "task")) {
        alerts.push({
          id,
          category: "task",
          priority: "high",
          title: `⚠️ ${urgent.length} overdue task${urgent.length > 1 ? "s" : ""}`,
          message: urgent.slice(0, 3).map(t => `• ${t.title}`).join("\n"),
          action: "janjak tasks",
          actionLabel: "View Tasks",
          timestamp: Date.now(),
        });
      }
    }
  }

  // Due today tasks
  const dueToday = tasks.filter(
    t => t.deadline === today && (t.status === "pending" || t.status === "in-progress")
  );
  if (dueToday.length > 0 && hour >= 12) {
    const id = `tasks-due-today-${today}-afternoon`;
    if (canFire(id, "task")) {
      alerts.push({
        id,
        category: "task",
        priority: "medium",
        title: `📋 ${dueToday.length} task${dueToday.length > 1 ? "s" : ""} due today`,
        message: dueToday.slice(0, 3).map(t => `• ${t.title}`).join("\n"),
        timestamp: Date.now(),
      });
    }
  }

  return alerts;
}

/** Energy-based reminders: breaks, hydration */
function checkEnergy(): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];
  const status = getStatus();
  const sessionMinutes = Math.round((Date.now() - status.sessionStartedAt) / 60000);

  // Long unbroken session (not in break mode)
  if (status.focusMode !== "break" && status.focusMode !== "off") {
    if (sessionMinutes >= 90) {
      const id = "energy-long-session-90";
      if (canFire(id, "energy")) {
        alerts.push({
          id,
          category: "energy",
          priority: "high",
          title: "⏰ 90+ minutes without a break",
          message: "Your brain needs rest to consolidate learning. Step away for 10 minutes.",
          action: "janjak break",
          actionLabel: "Take a Break",
          timestamp: Date.now(),
        });
      }
    } else if (sessionMinutes >= 50) {
      const id = "energy-long-session-50";
      if (canFire(id, "energy")) {
        alerts.push({
          id,
          category: "energy",
          priority: "low",
          title: "🔔 50 minutes of focused work",
          message: "Great session! Consider a short break in the next 10 minutes.",
          action: "janjak break",
          actionLabel: "Take a Break",
          timestamp: Date.now(),
        });
      }
    }
  }

  // Hydration reminder (every 2 hours during active work)
  const hour = new Date().getHours();
  if (hour >= 9 && hour <= 20 && status.activity !== "idle") {
    const id = `energy-hydrate-${Math.floor(hour / 2)}`;
    if (canFire(id, "energy")) {
      alerts.push({
        id,
        category: "energy",
        priority: "low",
        title: "💧 Hydration Check",
        message: "Have you had water recently? Staying hydrated helps focus.",
        timestamp: Date.now(),
      });
    }
  }

  return alerts;
}

/** Streak alerts: at risk, milestones */
function checkStreak(): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];

  try {
    const streak = getCurrentStreak();
    const hour = new Date().getHours();
    const score = getTodayScore();

    // Streak at risk (have a streak, late in day, haven't qualified yet)
    if (streak.days >= 3 && !streak.todayQualifies && hour >= 16) {
      const id = `streak-risk-${new Date().toISOString().slice(0, 10)}`;
      if (canFire(id, "streak")) {
        const needed = 50 - score.score;
        alerts.push({
          id,
          category: "streak",
          priority: "high",
          title: `🔥 ${streak.days}-day streak at risk!`,
          message: `You need ${needed > 0 ? needed : "a bit"} more points to keep your streak alive. Don't break the chain!`,
          action: "janjak focus",
          actionLabel: "Save Your Streak",
          timestamp: Date.now(),
        });
      }
    }

    // Streak milestones
    const milestones = [7, 14, 21, 30, 50, 100];
    if (streak.todayQualifies && milestones.includes(streak.days)) {
      const id = `streak-milestone-${streak.days}`;
      if (canFire(id, "milestone")) {
        alerts.push({
          id,
          category: "milestone",
          priority: "low",
          title: `🏆 ${streak.days}-day streak!`,
          message: `Incredible consistency! You've shown up for ${streak.days} days in a row.`,
          timestamp: Date.now(),
        });
      }
    }
  } catch { /* streak not available */ }

  return alerts;
}

/** Goal-pressure nudges: deadlines approaching, daily focus on the top goal. */
function checkGoals(): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];

  try {
    const goals = listGoals({ activeOnly: true });
    if (goals.length === 0) return alerts;

    const hour = new Date().getHours();
    const today = new Date().toISOString().slice(0, 10);
    const todayMs = Date.parse(`${today}T00:00:00`);

    // Deadline pressure: active goals with a target date in the next 7 days.
    const upcoming = goals
      .filter((g) => g.targetDate)
      .map((g) => ({ goal: g, daysLeft: Math.round((Date.parse(`${g.targetDate}T00:00:00`) - todayMs) / 86_400_000) }))
      .filter((x) => Number.isFinite(x.daysLeft) && x.daysLeft >= 0 && x.daysLeft <= 7)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    const mostUrgent = upcoming[0];
    if (mostUrgent) {
      const { goal, daysLeft } = mostUrgent;
      const id = `goal-deadline-${goal.id}-${today}`;
      if (canFire(id, "goal")) {
        const when = daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
        alerts.push({
          id,
          category: "goal",
          priority: daysLeft <= 2 ? "high" : "medium",
          title: `🎯 Goal due ${when}`,
          message: `"${goal.description}" — what's the next concrete step you can take right now?`,
          timestamp: Date.now(),
        });
      }
    }

    // Morning focus on the single most important goal (priority-weighted).
    if (hour >= 8 && hour <= 10) {
      const top = [...goals].sort((a, b) => b.priority - a.priority)[0];
      if (top && top.priority >= 7) {
        const id = `goal-focus-${today}`;
        if (canFire(id, "goal")) {
          alerts.push({
            id,
            category: "goal",
            priority: "low",
            title: "🎯 Your #1 goal today",
            message: `"${top.description}" — how will today move this forward?`,
            timestamp: Date.now(),
          });
        }
      }
    }
  } catch { /* goals not available */ }

  return alerts;
}

/** Relationship upkeep: nudge when a key person hasn't come up in a while. */
function checkRelationships(): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];

  try {
    const hour = new Date().getHours();
    if (hour < 9 || hour > 19) return alerts; // only nudge during waking hours

    const today = new Date().toISOString().slice(0, 10);
    const STALE_DAYS = 14;
    const now = Date.now();

    const stale = listEntities(50, "person")
      .filter((e) => e.importance >= 0.5 && e.mentionCount >= 3)
      .map((e) => ({ entity: e, daysSince: Math.floor((now - e.lastSeen) / 86_400_000) }))
      .filter((x) => x.daysSince >= STALE_DAYS)
      .sort((a, b) => b.entity.importance - a.entity.importance);

    const top = stale[0];
    if (top) {
      const id = `relationship-stale-${top.entity.id}-${today}`;
      if (canFire(id, "relationship")) {
        alerts.push({
          id,
          category: "relationship",
          priority: "low",
          title: `🤝 Reconnect with ${top.entity.name}`,
          message: `You haven't mentioned ${top.entity.name} in ${top.daysSince} days. Worth a quick check-in?`,
          timestamp: Date.now(),
        });
      }
    }
  } catch { /* entity graph not available */ }

  return alerts;
}

/** ClientOps: overdue payments, due follow-ups, and stalled/at-risk projects. */
function checkClientOps(): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];

  try {
    const hour = new Date().getHours();
    if (hour < 8 || hour > 20) return alerts; // stay quiet outside working hours

    const today = new Date().toISOString().slice(0, 10);

    // 1) Overdue invoices — money already past its due date.
    const overdue = listOutstandingPayments().filter((p) => isOverdue(p.dueDate));
    if (overdue.length > 0) {
      const id = `clientops-payments-${today}`;
      if (canFire(id, "clientops")) {
        const cur = overdue[0]!.currency;
        const sameCurrency = overdue.every((p) => p.currency === cur);
        const total = sameCurrency
          ? formatMoney(overdue.reduce((s, p) => s + p.amount, 0), cur)
          : `${overdue.length} invoices`;
        const worstDays = Math.min(...overdue.map((p) => daysUntil(p.dueDate) ?? 0));
        alerts.push({
          id,
          category: "clientops",
          priority: overdue.length >= 3 || worstDays <= -14 ? "high" : "medium",
          title: `💸 ${overdue.length} overdue payment${overdue.length === 1 ? "" : "s"} (${total})`,
          message: overdue
            .slice(0, 3)
            .map((p) => {
              const d = daysUntil(p.dueDate);
              return `• ${formatMoney(p.amount, p.currency)} — overdue ${d != null ? -d : "?"}d`;
            })
            .join("\n"),
          action: "janjak payment overdue",
          actionLabel: "Review payments",
          timestamp: Date.now(),
        });
      }
    }

    // 2) Follow-ups that are due or past due.
    const dueFollowups = listFollowups({ includeResolved: false }).filter((f) => {
      const d = daysUntil(f.dueDate);
      return d != null && d <= 0;
    });
    if (dueFollowups.length > 0) {
      const id = `clientops-followups-${today}`;
      if (canFire(id, "clientops")) {
        alerts.push({
          id,
          category: "clientops",
          priority: "medium",
          title: `🔔 ${dueFollowups.length} client follow-up${dueFollowups.length === 1 ? "" : "s"} due`,
          message: dueFollowups
            .slice(0, 3)
            .map((f) => `• ${f.title}${f.channel ? ` (${f.channel})` : ""}`)
            .join("\n"),
          action: "janjak followups",
          actionLabel: "View follow-ups",
          timestamp: Date.now(),
        });
      }
    }

    // 3) Projects flagged at-risk or with no update in a while.
    const STALE_DAYS = 10;
    const now = Date.now();
    const flagged = listProjects()
      .map((p) => {
        const stamp = p.lastUpdateAt ?? p.updatedAt;
        const parsed = stamp ? Date.parse(stamp) : NaN;
        const daysSince = Number.isFinite(parsed)
          ? Math.floor((now - parsed) / 86_400_000)
          : null;
        const atRisk = p.riskLevel === "elevated" || p.riskLevel === "high";
        const stale = daysSince != null && daysSince >= STALE_DAYS;
        return { project: p, daysSince, atRisk, stale };
      })
      .filter((x) => x.atRisk || x.stale);

    if (flagged.length > 0) {
      const id = `clientops-projects-${today}`;
      if (canFire(id, "clientops")) {
        const anyHigh = flagged.some((x) => x.project.riskLevel === "high");
        alerts.push({
          id,
          category: "clientops",
          priority: anyHigh ? "high" : "medium",
          title: `⚠️ ${flagged.length} project${flagged.length === 1 ? "" : "s"} need attention`,
          message: flagged
            .slice(0, 3)
            .map((x) => {
              const reason = x.atRisk
                ? `risk: ${x.project.riskLevel}`
                : `no update in ${x.daysSince}d`;
              return `• ${x.project.name} — ${reason}`;
            })
            .join("\n"),
          action: "janjak risks",
          actionLabel: "Scan project risks",
          timestamp: Date.now(),
        });
      }
    }
  } catch { /* clientops not available */ }

  return alerts;
}

// ─── Main Engine ────────────────────────────────────────────────

/** Run all checks and return prioritized alerts (highest first). */
/** End-of-day planner: after 17:00 local, once per day, draft tomorrow's plan. */
function checkEndOfDay(): ProactiveAlert[] {
  const now = new Date();
  if (now.getHours() < 17) return [];
  const today = now.toLocaleDateString("en-CA"); // YYYY-MM-DD
  if (getState("eodplan_emitted") === today) return [];
  setState("eodplan_emitted", today);
  return [{
    id: `eodplan-${today}`,
    category: "task",
    priority: "low",
    title: "🌙 Planning your tomorrow",
    message: "Drafting a plan from your open tasks and calendar…",
    action:
      "agent:Plan my day for tomorrow. Review my open tasks (list_tasks) and " +
      "calendar (get_calendar), then produce a short, prioritized plan with at " +
      "most 6 items. Save it as a note (save_note) titled \"Tomorrow's plan\". " +
      "Do not draft or send any email.",
    actionLabel: "Plan tomorrow",
    tier: "auto",
    timestamp: Date.now(),
  }];
}

export async function getProactiveAlerts(): Promise<ProactiveAlert[]> {
  const allAlerts: ProactiveAlert[] = [];

  // Run sync checks
  allAlerts.push(...checkDistractions());
  allAlerts.push(...checkScore());
  allAlerts.push(...checkBehavior());
  allAlerts.push(...checkTasks());
  allAlerts.push(...checkEnergy());
  allAlerts.push(...checkStreak());
  allAlerts.push(...checkGoals());
  allAlerts.push(...checkRelationships());
  allAlerts.push(...checkClientOps());
  allAlerts.push(...checkEndOfDay());

  // Run async checks
  const calendarAlerts = await checkCalendar();
  allAlerts.push(...calendarAlerts);

  // Sort by priority
  const priorityOrder: Record<AlertPriority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  allAlerts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Drop alerts whose category has been muted by the learning loop.
  const visible = allAlerts.filter((alert) => !isAlertMuted(alert.category));

  // Mark all as fired + log a traceable decision for each (powers `janjak why`).
  for (const alert of visible) {
    markFired(alert.id);
    logDecision({
      decisionId: `alert-${alert.id}-${alert.timestamp}`,
      type: "alert",
      description: `${alert.title} — ${alert.message}`.slice(0, 160),
      evidence: {
        signals: [`category:${alert.category}`, `priority:${alert.priority}`],
        ...(alert.actionLabel ? { suggestedAction: alert.actionLabel } : {}),
      },
      confidence: alert.priority === "critical" ? 0.95 : alert.priority === "high" ? 0.8 : 0.6,
      timestamp: alert.timestamp,
    });
  }

  return visible;
}

/** Get just the top alert (for nudge integration). */
export async function getTopAlert(): Promise<ProactiveAlert | null> {
  const alerts = await getProactiveAlerts();
  return alerts[0] ?? null;
}

/** Format an alert for terminal display. */
export function formatAlert(alert: ProactiveAlert): string {
  const priorityIcon: Record<AlertPriority, string> = {
    critical: "🚨",
    high: "⚠️ ",
    medium: "💡",
    low: "ℹ️ ",
  };
  const icon = priorityIcon[alert.priority];
  let text = `${icon} ${alert.title}`;
  if (alert.message) text += `\n   ${alert.message.replace(/\n/g, "\n   ")}`;
  if (alert.actionLabel) text += `\n   → ${alert.actionLabel}`;
  return text;
}

/** Format all active alerts for terminal display. */
export function formatAlerts(alerts: ProactiveAlert[]): string {
  if (alerts.length === 0) return "";
  const now = Date.now();
  const active = alerts.filter(a => !a.expiresAt || a.expiresAt > now);
  if (active.length === 0) return "";
  return active.map(formatAlert).join("\n\n");
}

// ─── Proactive Monitor Loop ─────────────────────────────────────
// Runs alongside the main monitor, checking for alerts every 30s.

type AlertCallback = (alert: ProactiveAlert) => void;

let proactiveInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Run the nightly consolidation at most once per local day, after the
 * consolidation hour (≈3am) so it captures the full previous day before
 * summarizing. Tick-driven, so the first tick past 3am each day fires it.
 */
const CONSOLIDATION_HOUR = 3;

async function maybeRunDailyConsolidation(): Promise<void> {
  try {
    const now = new Date();
    if (now.getHours() < CONSOLIDATION_HOUR) return; // wait until past ~3am
    const today = now.toLocaleDateString("en-CA"); // YYYY-MM-DD
    if (getState("daily_consolidation_date") === today) return;
    // Consolidate the day that just ended: a moment just before midnight today.
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const yesterdayRef = startOfToday.getTime() - 1;
    await runDailyConsolidation({
      now: yesterdayRef,
      onDisableWorkflow: (workflowId) => setWorkflowEnabled(workflowId, false),
      currentActionTier: (actionId) => getActionBaseTier(actionId),
    });
    setState("daily_consolidation_date", today);
  } catch {
    /* consolidation is best-effort; never block the engine */
  }
}

export function startProactiveEngine(
  callback: AlertCallback,
  intervalMs = 30_000,
): void {
  if (proactiveInterval) return;

  // Initial check after 5 seconds (let the system warm up)
  setTimeout(async () => {
    try {
      await maybeRunDailyConsolidation();
      const alerts = await getProactiveAlerts();
      for (const alert of alerts) callback(alert);
    } catch { /* */ }
  }, 5000);

  proactiveInterval = setInterval(async () => {
    try {
      await maybeRunDailyConsolidation();
      const alerts = await getProactiveAlerts();
      for (const alert of alerts) {
        callback(alert);
      }
    } catch { /* silently continue */ }
  }, intervalMs);
}

export function stopProactiveEngine(): void {
  if (proactiveInterval) {
    clearInterval(proactiveInterval);
    proactiveInterval = null;
  }
}

// ─── Morning Briefing: Your personalized daily intelligence report ──
// Gathers calendar, email, tasks, scores, streaks, and AI plan
// into one concise briefing to start your day.

import OpenAI from "openai";
import { getTodayStats, getTasks, getState } from "./db.js";
import { getTodayScore, getWeeklyScores } from "./score.js";
import { getCurrentStreak } from "./streak.js";
import { getBehavioralProfile } from "./memory.js";
import { recall, formatHitsForPrompt } from "./memory/recall.js";
import { formatEntityContextForPrompt } from "./graph/query.js";
import { formatPersonalContextForPrompt } from "./personal/synthesis.js";
import { getTodayEvents, getFreeSlots, getMeetingPrepContext, type CalendarEvent } from "./calendar.js";
import { isAuthenticated } from "./gmail-auth.js";
import { fetchRecentEmails } from "./gmail-client.js";
import type { ExtractedTask } from "./types.js";

// ─── Helpers ────────────────────────────────────────────────────

function getUserName(): string {
  return getState("user_name") ?? "there";
}

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % h;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── Data Collectors ────────────────────────────────────────────

async function getCalendarSection(): Promise<string> {
  try {
    const events = await getTodayEvents();
    if (events.length === 0) return "  No meetings today — wide open for deep work! 🎯";

    const lines = events.map((e: CalendarEvent) => {
      const time = e.isAllDay ? "All day" : `${fmtTime(e.start)} – ${fmtTime(e.end)}`;
      const loc = e.location ? ` (${e.location})` : "";
      const meet = e.meetLink ? " 🔗" : "";
      const status = e.status === "now" ? " ← NOW" : "";
      return `  ${time} — ${e.title}${loc}${meet}${status}`;
    });

    return lines.join("\n");
  } catch {
    return "  Calendar not connected. Run `janjak login` to set up.";
  }
}

async function getEmailSection(): Promise<string> {
  if (!isAuthenticated()) return "  Gmail not connected. Run `janjak login` to set up.";

  try {
    const emails = await fetchRecentEmails(10);
    if (emails.length === 0) return "  Inbox zero! 🎉 No unread emails.";

    const lines = emails.slice(0, 5).map((e, i) => {
      const from = e.from.replace(/<[^>]+>/, "").trim();
      const shortFrom = from.length > 25 ? from.slice(0, 25) + "…" : from;
      return `  ${i + 1}. ${shortFrom} — ${e.subject}`;
    });

    const extra = emails.length > 5 ? `\n  ... and ${emails.length - 5} more` : "";
    return `  ${emails.length} unread email${emails.length !== 1 ? "s" : ""}:\n${lines.join("\n")}${extra}`;
  } catch {
    return "  Could not fetch emails.";
  }
}

function getTaskSection(): string {
  const tasks = getTasks();
  if (tasks.length === 0) return "  No pending tasks. Enjoy the freedom!";

  const inProgress = tasks.filter((t: ExtractedTask) => t.status === "in-progress");
  const pending = tasks.filter((t: ExtractedTask) => t.status === "pending");
  const high = pending.filter((t: ExtractedTask) => t.priority === "high");
  const medium = pending.filter((t: ExtractedTask) => t.priority === "medium");

  const lines: string[] = [];

  if (inProgress.length > 0) {
    lines.push(`  🔄 In Progress (${inProgress.length}):`);
    for (const t of inProgress.slice(0, 3)) {
      const dl = t.deadline ? ` (due: ${t.deadline})` : "";
      lines.push(`     • ${t.title}${dl}`);
    }
  }

  if (high.length > 0) {
    lines.push(`  🔴 High Priority (${high.length}):`);
    for (const t of high.slice(0, 3)) {
      const dl = t.deadline ? ` (due: ${t.deadline})` : "";
      lines.push(`     • ${t.title}${dl}`);
    }
  }

  if (medium.length > 0) {
    lines.push(`  🟡 Medium Priority (${medium.length}):`);
    for (const t of medium.slice(0, 2)) {
      const dl = t.deadline ? ` (due: ${t.deadline})` : "";
      lines.push(`     • ${t.title}${dl}`);
    }
  }

  const lowCount = pending.filter((t: ExtractedTask) => t.priority === "low").length;
  if (lowCount > 0) {
    lines.push(`  🟢 ${lowCount} low-priority task${lowCount !== 1 ? "s" : ""}`);
  }

  return lines.join("\n");
}

function getScoreSection(): string {
  const today = getTodayScore();
  const weekly = getWeeklyScores(7);
  const streak = getCurrentStreak();

  const lines: string[] = [];

  // Yesterday's score
  if (weekly.length >= 2) {
    const yesterday = weekly[weekly.length - 2];
    if (yesterday) {
      lines.push(`  Yesterday: ${yesterday.score}/100 ${yesterday.label} (${yesterday.codingMinutes}m coding, ${Math.round(yesterday.focusRatio * 100)}% focus)`);
    }
  }

  // Today so far
  if (today.totalMinutes > 0) {
    lines.push(`  Today so far: ${today.score}/100 ${today.label}`);
  }

  // Weekly trend
  if (weekly.length >= 3) {
    const avg = Math.round(weekly.reduce((s, d) => s + d.score, 0) / weekly.length);
    const scores = weekly.map(d => d.score);
    const trend = scores[scores.length - 1]! > scores[0]! ? "📈 trending up" : scores[scores.length - 1]! < scores[0]! ? "📉 trending down" : "➡️ steady";
    lines.push(`  7-day average: ${avg}/100 ${trend}`);
  }

  // Streak
  if (streak.days > 0) {
    lines.push(`  🔥 ${streak.days}-day streak${streak.days === streak.best ? " (personal best!)" : ""}`);
  }

  return lines.length > 0 ? lines.join("\n") : "  No score data yet. Start working and check back later!";
}

async function getFreeTimeSection(): Promise<string> {
  try {
    const slots = await getFreeSlots(30); // min 30-min blocks
    if (slots.length === 0) return "  No free blocks today (30min+). Tight schedule!";

    const lines = slots.slice(0, 4).map(s => {
      return `  ${fmtTime(s.start)} – ${fmtTime(s.end)} (${fmtDuration(s.durationMinutes)})`;
    });

    const total = slots.reduce((s, f) => s + f.durationMinutes, 0);
    return `  ${fmtDuration(total)} of free time in ${slots.length} block${slots.length !== 1 ? "s" : ""}:\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

// ─── AI Briefing ────────────────────────────────────────────────

async function getAISuggestion(sections: Record<string, string>, upcomingMeeting?: CalendarEvent): Promise<string> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return "";

  try {
    const client = new OpenAI({ apiKey });
    const profile = getBehavioralProfile();

    let memoryBlock = "";
    try {
      const { recall, formatHitsForPrompt } = await import("./memory/recall.js");
      const hits = await recall(
        `morning briefing context: ${sections.calendar} ${sections.tasks}`,
        { limit: 5, minSimilarity: 0.2, respectTiers: true }
      );
      memoryBlock = formatHitsForPrompt(hits);
    } catch {
      memoryBlock = "";
    }

    let entityBlock = "";
    try {
      entityBlock = formatEntityContextForPrompt(
        `${sections.calendar}\n${sections.tasks}\n${sections.emails}`,
        5
      );
    } catch {
      entityBlock = "";
    }

    let meetingPrepBlock = "";
    if (upcomingMeeting) {
      try {
        meetingPrepBlock = await getMeetingPrepContext(upcomingMeeting, 4);
      } catch {
        meetingPrepBlock = "";
      }
    }

    let personalBlock = "";
    try {
      personalBlock = formatPersonalContextForPrompt();
    } catch {
      personalBlock = "";
    }

    const context = `
USER: ${getUserName()}
TIME: ${new Date().toLocaleString()}

CALENDAR:\n${sections.calendar}

EMAILS:\n${sections.emails}

TASKS:\n${sections.tasks}

FOCUS SCORES:\n${sections.scores}

FREE TIME:\n${sections.freeTime}

BEHAVIORAL PATTERNS:
- Peak coding hours: ${profile.peakCodingHours.map(h => h + ":00").join(", ") || "unknown"}
- Avg daily coding: ${profile.avgCodingMinutes}min
- Tracked days: ${profile.trackedDays}
${memoryBlock ? "\n" + memoryBlock : ""}
${entityBlock ? "\n" + entityBlock : ""}
${meetingPrepBlock ? "\n" + meetingPrepBlock : ""}
${personalBlock ? "\n" + personalBlock : ""}
`.trim();

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are Janjak, a personal AI assistant. Generate a brief, actionable morning plan (3-5 bullet points) based on the user's data. Be specific — reference actual tasks, meetings, and free time blocks. Suggest when to do deep work based on their peak hours. Be concise and motivating. Use 1-2 emoji per point. Respond in the same language the user typically uses.`,
        },
        { role: "user", content: context },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    return "";
  }
}

// ─── Main Briefing ──────────────────────────────────────────────

export async function generateMorningBriefing(options: { ai?: boolean; clientops?: boolean } = {}): Promise<string> {
  const name = getUserName();
  const greeting = timeGreeting();
  const { ai = true, clientops = false } = options;

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Gather all sections in parallel
  const [calendar, emails, freeTime] = await Promise.all([
    getCalendarSection(),
    getEmailSection(),
    getFreeTimeSection(),
  ]);

  const tasks = getTaskSection();
  const scores = getScoreSection();
  const calendarEvents = await getTodayEvents();

  const sections: string[] = [];

  // Header
  sections.push(`\n☀️  ${greeting}, ${name}!`);
  sections.push(`   ${dateStr}\n`);
  sections.push("═".repeat(50));

  // Calendar
  sections.push("\n📅 Calendar");
  sections.push("─".repeat(30));
  sections.push(calendar);

  // Free time (only if we have calendar data)
  if (freeTime && !freeTime.includes("not connected")) {
    sections.push(`\n⏰ Deep Work Windows`);
    sections.push("─".repeat(30));
    sections.push(freeTime);
  }

  // Emails
  sections.push("\n📧 Inbox");
  sections.push("─".repeat(30));
  sections.push(emails);

  // Tasks
  sections.push("\n✅ Tasks");
  sections.push("─".repeat(30));
  sections.push(tasks);

  // Focus Score
  sections.push("\n📊 Focus");
  sections.push("─".repeat(30));
  sections.push(scores);

  // ClientOps (opt-in)
  if (clientops) {
    const { getClientOpsMorningSection } = await import("./clientops/linker.js");
    sections.push("\n🗂️  ClientOps");
    sections.push("─".repeat(30));
    sections.push(getClientOpsMorningSection());
  }

  // AI Plan
  if (ai) {
    const sectionData = { calendar, emails, tasks, scores, freeTime };
    const upcomingMeeting = calendarEvents.find(e => e.status === "upcoming" || e.status === "now");
    const aiPlan = await getAISuggestion(sectionData, upcomingMeeting);
    if (aiPlan) {
      sections.push("\n🧠 Janjak's Plan For You");
      sections.push("─".repeat(30));
      sections.push(`  ${aiPlan.split("\n").join("\n  ")}`);
    }
  }

  sections.push("\n" + "═".repeat(50));
  sections.push("  Have a great day! 🚀\n");

  return sections.join("\n");
}

/** Get a short spoken summary for voice mode */
export async function getSpokenBriefing(): Promise<string> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return "I need an OpenAI API key to generate your briefing.";

  const name = getUserName();
  const greeting = timeGreeting();

  // Gather data
  const [calendarData, emailData] = await Promise.all([
    getTodayEvents().catch(() => []),
    isAuthenticated() ? fetchRecentEmails(5).catch(() => []) : Promise.resolve([]),
  ]);

  const tasks = getTasks();
  const score = getTodayScore();
  const streak = getCurrentStreak();
  const weekly = getWeeklyScores(7);
  const yesterday = weekly.length >= 2 ? weekly[weekly.length - 2] : null;

  let memoryBlock = "";
  try {
    const topTaskTitles = tasks.slice(0, 3).map((t) => t.title).join(" | ");
    const nextMeeting = calendarData[0]?.title ?? "";
    const recallQuery = `voice morning briefing ${nextMeeting} ${topTaskTitles}`.trim();
    const hits = await recall(recallQuery, {
      limit: 4,
      minSimilarity: 0.2,
      daysBack: 30,
      respectTiers: true,
    });
    memoryBlock = formatHitsForPrompt(hits);
  } catch {
    memoryBlock = "";
  }

  let entityBlock = "";
  try {
    entityBlock = formatEntityContextForPrompt(
      `${calendarData.map((e) => e.title).join(" ")} ${tasks.map((t) => t.title).join(" ")}`,
      4
    );
  } catch {
    entityBlock = "";
  }

  let meetingPrepBlock = "";
  if (calendarData.length > 0) {
    try {
      meetingPrepBlock = await getMeetingPrepContext(calendarData[0], 3);
    } catch {
      meetingPrepBlock = "";
    }
  }

  let personalBlock = "";
  try {
    personalBlock = formatPersonalContextForPrompt();
  } catch {
    personalBlock = "";
  }

  const context = `
${greeting} ${name}.
Date: ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
Meetings today: ${calendarData.length} ${calendarData.length > 0 ? `(next: ${calendarData[0]?.title})` : ""}
Unread emails: ${emailData.length}
Pending tasks: ${tasks.filter(t => t.status === "pending").length} (${tasks.filter(t => t.priority === "high").length} high priority)
In-progress tasks: ${tasks.filter(t => t.status === "in-progress").length}
Yesterday's score: ${yesterday ? `${yesterday.score}/100` : "no data"}
Streak: ${streak.days} days
${memoryBlock ? `\n${memoryBlock}\n` : ""}
${entityBlock ? `\n${entityBlock}\n` : ""}
${meetingPrepBlock ? `\n${meetingPrepBlock}\n` : ""}
${personalBlock ? `\n${personalBlock}\n` : ""}
`.trim();

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are Janjak, a personal voice assistant. Give a concise spoken morning briefing (4-6 sentences). Mention meetings, key tasks, and a motivational note. Keep it natural and conversational — this will be spoken aloud. No markdown, no bullet points, no emojis.`,
        },
        { role: "user", content: context },
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content?.trim() ?? "I couldn't generate your briefing. Try again?";
  } catch {
    return "I couldn't generate your briefing right now.";
  }
}

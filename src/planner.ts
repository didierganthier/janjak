// ─── Day Planner: AI-powered daily overview + plan ─────────────────
import { userInfo } from "node:os";
import { execSync } from "node:child_process";
import OpenAI from "openai";
import { getTodayStats } from "./db.js";
import { getTasks } from "./db.js";
import { getActivityEmoji } from "./classifier.js";
import { getBehavioralProfile } from "./memory.js";
import { getTodayEvents, getFreeSlots } from "./calendar.js";
import type { ActivityState } from "./types.js";

function getDisplayName(): string {
  // macOS: get the user's real name from the system
  try {
    const fullName = execSync("id -F", { encoding: "utf-8" }).trim();
    if (fullName) return fullName.split(" ")[0]!;
  } catch { /* not macOS or failed */ }

  const raw = process.env["USER"] ?? userInfo().username;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

const userName = getDisplayName();

/** Quick local overview (no API call) — always available */
export function getDayOverview(): string {
  const stats = getTodayStats();
  const hour = new Date().getHours();

  let greeting: string;
  if (hour < 12) greeting = `🌅 Good morning, ${userName}.`;
  else if (hour < 17) greeting = `☀️ Good afternoon, ${userName}.`;
  else if (hour < 21) greeting = `🌆 Good evening, ${userName}.`;
  else greeting = `🌙 Late night hustle, ${userName}.`;

  let output = `\n${greeting}\n`;
  output += `${"─".repeat(40)}\n`;

  if (stats.totalMinutes === 0) {
    output += "No activity tracked yet today.\n";
    output += 'Start with: janjak focus\n';
    return output;
  }

  output += `📊 Today's Activity (${stats.totalMinutes} min total):\n\n`;

  const sorted = Object.entries(stats.byActivity).sort((a, b) => b[1] - a[1]);
  for (const [activity, minutes] of sorted) {
    const emoji = getActivityEmoji(activity as ActivityState);
    const bar = "█".repeat(Math.max(1, Math.round(minutes / 5)));
    output += `  ${emoji} ${activity.padEnd(12)} ${bar} ${minutes} min\n`;
  }

  output += `\n${"─".repeat(40)}`;

  // Smart suggestions from behavioral memory
  const profile = getBehavioralProfile();
  const suggestions: string[] = [];

  // Memory-based suggestions
  for (const insight of profile.insights.filter(i => i.type === "peak-hours" || i.type === "warning")) {
    suggestions.push(insight.message);
  }

  // Fallback basic suggestions
  if (suggestions.length === 0) {
    if (hour >= 9 && hour <= 11 && !stats.byActivity["coding"]) {
      suggestions.push("💡 Morning is prime coding time. Try: janjak focus");
    }
    if (stats.byActivity["browsing"] && stats.byActivity["browsing"] > 60) {
      suggestions.push("🧭 Over an hour of browsing today. Time to lock in?");
    }
    if (stats.totalMinutes > 240 && !stats.byActivity["idle"]) {
      suggestions.push("⚡ 4+ hours of work with no break. Take care of yourself.");
    }
  }

  if (suggestions.length > 0) {
    output += "\n\n" + suggestions.join("\n");
  }

  return output;
}

/** AI-powered daily plan — uses OpenAI to create a personalized plan */
export async function getAIDailyPlan(): Promise<string> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    return getDayOverview() + "\n\n💡 Set OPENAI_API_KEY in ~/.janjak/.env for AI-powered daily plans.";
  }

  const client = new OpenAI({ apiKey });
  const stats = getTodayStats();
  const profile = getBehavioralProfile();
  const pendingTasks = getTasks(); // gets non-done, non-dismissed tasks
  const hour = new Date().getHours();
  const dayName = new Date().toLocaleDateString("en-US", { weekday: "long" });

  // Build context for the AI
  const taskList = pendingTasks.slice(0, 10).map(t => {
    const deadline = t.deadline ? ` (due: ${t.deadline})` : "";
    return `- [${t.priority}] ${t.title}${deadline}${t.status === "in-progress" ? " (in progress)" : ""}`;
  }).join("\n");

  const activitySummary = Object.entries(stats.byActivity)
    .sort((a, b) => b[1] - a[1])
    .map(([a, m]) => `${a}: ${m}min`)
    .join(", ");

  // Calendar context
  let calendarContext = "";
  try {
    const events = await getTodayEvents();
    const freeSlots = await getFreeSlots();
    if (events.length > 0) {
      const upcoming = events.filter(e => !e.isAllDay).map(e => {
        const time = new Date(e.start).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        return `- ${time}: ${e.title}`;
      }).join("\n");
      calendarContext += `\nCALENDAR TODAY:\n${upcoming}`;
    }
    if (freeSlots.length > 0) {
      const slots = freeSlots.slice(0, 3).map(s => {
        const from = new Date(s.start).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        const to = new Date(s.end).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        return `- ${from}-${to} (${s.durationMinutes}m)`;
      }).join("\n");
      calendarContext += `\nFREE SLOTS:\n${slots}`;
    }
  } catch { /* calendar not connected — skip */ }

  const prompt = `You are Janjak, a personal AI assistant for a developer named ${userName}.
It's ${dayName}, currently ${hour}:00.

BEHAVIORAL PROFILE:
- Peak coding hours: ${profile.peakCodingHours.map(h => h + ":00").join(", ") || "not enough data"}
- Average daily coding: ${profile.avgCodingMinutes} min
- Average daily screen time: ${profile.avgDailyMinutes} min
- Days tracked: ${profile.trackedDays}

TODAY SO FAR:
- Total time: ${stats.totalMinutes} min
- Activities: ${activitySummary || "nothing yet"}

PENDING TASKS:
${taskList || "No pending tasks."}
${calendarContext}
Generate a SHORT, actionable daily plan for the rest of the day. Be specific and personal.

Format:
1. One greeting line (reference the time of day and what they've done)
2. 3-5 prioritized action items for the rest of the day
3. One motivational closing line

Rules:
- Keep it under 150 words total
- Reference their actual patterns and tasks
- Be warm but concise — like a smart friend, not a corporate coach
- Use 1-2 relevant emoji per line max
- If it's late (after 9pm), suggest winding down
- Don't be generic — use the data
- If calendar events are provided, work around the meetings and suggest using free slots for deep work`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0.7,
    });

    const plan = response.choices[0]?.message?.content?.trim();
    if (!plan) return getDayOverview();

    // Combine stats + AI plan
    let output = getDayOverview();
    output += "\n\n" + "═".repeat(40);
    output += "\n🤖 AI Daily Plan\n";
    output += "─".repeat(40) + "\n\n";
    output += plan;
    output += "\n";

    return output;
  } catch {
    // Fallback to local overview if API fails
    return getDayOverview() + "\n\n⚠️  AI planner unavailable. Showing local overview.";
  }
}

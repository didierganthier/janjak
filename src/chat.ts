// ─── Natural Language Chat: Ask Janjak anything about your data ────
// "What did I do yesterday?" "How productive was I this week?"
// Feeds your full behavioral profile + session data to GPT and
// lets you have a conversation with your own work history.

import OpenAI from "openai";
import { getTodayStats, getDailySummaries, getTasks, getRecentSessions, getTopApps, getState, setState } from "./db.js";
import { getBehavioralProfile } from "./memory.js";
import { getTodayScore, getWeeklyScores } from "./score.js";
import { isAuthenticated } from "./gmail-auth.js";
import { fetchRecentEmails } from "./gmail-client.js";
import { looksLikeTaskCreation, createTaskFromText, formatCreatedTask } from "./nl-tasks.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };

function getOpenAIClient(): OpenAI {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "OpenAI API key not set.\n\n" +
      "  Add it to ~/.janjak/.env:\n" +
      "    OPENAI_API_KEY=sk-..."
    );
  }
  return new OpenAI({ apiKey });
}

/** Build a context snapshot of everything Janjak knows */
function buildContext(): string {
  const userName = getState("user_name") ?? "there";
  const now = new Date();
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const hour = now.getHours();

  // Today's stats
  const todayStats = getTodayStats();
  const todayActivities = Object.entries(todayStats.byActivity)
    .map(([a, m]) => `${a}: ${m}min`)
    .join(", ") || "nothing tracked yet";

  // Today's score
  const todayScore = getTodayScore();

  // Weekly scores
  const weeklyScores = getWeeklyScores(7);
  const weekData = weeklyScores.map(s =>
    `${s.date}: score=${s.score}/100 (coding=${s.codingMinutes}m, browsing=${s.browsingMinutes}m, total=${s.totalMinutes}m, focus=${Math.round(s.focusRatio * 100)}%)`
  ).join("\n") || "no weekly data yet";

  // Behavioral profile
  const profile = getBehavioralProfile();

  // Recent sessions (last 10)
  const recent = getRecentSessions(10);
  const recentData = recent.map(s => {
    const time = new Date(s.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const date = new Date(s.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${date} ${time}: ${s.activity} in ${s.appName} for ${Math.round(s.durationMinutes)}min (${s.focusMode})`;
  }).join("\n");

  // Pending tasks
  const tasks = getTasks();
  const taskData = tasks.slice(0, 10).map(t => {
    const deadline = t.deadline ? ` (due: ${t.deadline})` : "";
    return `#${t.id} [${t.priority}] ${t.title}${deadline} — ${t.status}`;
  }).join("\n") || "no pending tasks";

  // Daily summaries (last 7 days)
  const dailies = getDailySummaries(7);
  const byDate = new Map<string, Record<string, number>>();
  for (const d of dailies) {
    if (!byDate.has(d.date)) byDate.set(d.date, {});
    byDate.get(d.date)![d.activity] = Math.round(d.totalMinutes);
  }
  const dailyData = [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, acts]) => {
      const parts = Object.entries(acts).map(([a, m]) => `${a}:${m}m`).join(", ");
      return `${date}: ${parts}`;
    })
    .join("\n");

  // Top apps
  const topApps = profile.topApps.slice(0, 6)
    .map(a => `${a.appName}: ${a.totalMinutes}min`)
    .join(", ");

  return `USER NAME: ${userName}
CURRENT TIME: ${dayName}, ${dateStr}, ${hour}:00
TRACKED DAYS: ${profile.trackedDays}

TODAY:
- Activities: ${todayActivities}
- Total: ${todayStats.totalMinutes}min
- Focus Score: ${todayScore.score}/100 (${todayScore.label})
- Focus ratio: ${Math.round(todayScore.focusRatio * 100)}%

DAILY BREAKDOWN (last 7 days):
${dailyData || "no data"}

WEEKLY SCORES:
${weekData}

BEHAVIORAL PATTERNS:
- Peak coding hours: ${profile.peakCodingHours.map(h => h + ":00").join(", ") || "unknown"}
- Peak browsing hours: ${profile.peakBrowsingHours.map(h => h + ":00").join(", ") || "unknown"}
- Avg daily screen time: ${profile.avgDailyMinutes}min
- Avg daily coding: ${profile.avgCodingMinutes}min
- Top apps: ${topApps || "unknown"}

RECENT SESSIONS:
${recentData || "no recent sessions"}

PENDING TASKS:
${taskData}

INSIGHTS:
${profile.insights.map(i => `- ${i.message}`).join("\n") || "none yet"}`;
}

const EMAIL_KEYWORDS = /\b(email|emails|mail|inbox|unread|message|messages|reply|respond|sender|sent|receive|gmail)\b/i;

function isEmailRelated(question: string): boolean {
  return EMAIL_KEYWORDS.test(question);
}

async function fetchEmailContext(): Promise<string> {
  if (!isAuthenticated()) return "";
  try {
    const emails = await fetchRecentEmails(10);
    if (emails.length === 0) return "\nUNREAD EMAILS:\nNo unread emails in inbox.";
    const list = emails.map((e, i) => {
      const date = new Date(e.date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      return `${i + 1}. From: ${e.from} | Subject: ${e.subject} | ${date}\n   Preview: ${e.snippet?.slice(0, 150) ?? ""}`;
    }).join("\n");
    return `\nUNREAD EMAILS (${emails.length}):\n${list}`;
  } catch {
    return "";
  }
}

/** Detect and persist user's name from conversation */
function detectAndSaveName(question: string, response: string): void {
  const patterns = [
    /my name is ([A-Z][a-z]+)/i,
    /I'm ([A-Z][a-z]+)/i,
    /call me ([A-Z][a-z]+)/i,
    /I am ([A-Z][a-z]+)/i,
  ];
  for (const pat of patterns) {
    const match = question.match(pat);
    if (match?.[1]) {
      const name = match[1];
      // Avoid false positives like "I'm fine", "I'm good"
      const skipWords = new Set(["fine", "good", "great", "ok", "okay", "well", "busy", "tired", "here", "back", "done", "ready", "sorry", "not", "sure", "just", "also", "trying", "looking", "working", "wondering", "thinking"]);
      if (!skipWords.has(name.toLowerCase())) {
        setState("user_name", name);
      }
    }
  }
}

/** Ask Janjak a natural language question about your work data */
export async function askJanjak(question: string, history: ChatMessage[] = []): Promise<string> {
  const client = getOpenAIClient();
  let context = buildContext();

  // Enrich with email data when the question is email-related
  if (isEmailRelated(question)) {
    const emailCtx = await fetchEmailContext();
    if (emailCtx) context += emailCtx;
  }

  const systemPrompt = `You are Janjak, a personal AI assistant that knows everything about the user's digital work habits. You have access to their complete activity history, focus scores, behavioral patterns, and tasks.

Answer questions naturally, conversationally, and with specific data. Be concise (2-5 sentences usually). Use numbers and specifics from the data — don't be vague.

When the user asks about time periods:
- "yesterday" = the most recent day before today in the data
- "this week" = the last 7 days of data
- "today" = today's data

When giving advice, ground it in their actual patterns (peak hours, scores, trends).
When the user asks about emails, summarize their unread emails clearly — mention sender, subject, and urgency. Suggest which to respond to first.
When the user tells you their name, remember it and use it naturally.
Use 1-2 emoji naturally. Don't be overly enthusiastic — be like a smart, calm friend.
Maintain conversation context — if the user refers to something from a previous message ("this", "that", "it"), use the conversation history to understand what they mean.
Respond in the same language the user speaks to you.

USER DATA:
${context}`;

  // Build messages with conversation history for context
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10), // Keep last 10 turns for context
    { role: "user", content: question },
  ];

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    max_tokens: 400,
    temperature: 0.7,
  });

  const answer = response.choices[0]?.message?.content?.trim() ?? "I couldn't process that. Try rephrasing?";

  // Try to detect & persist user name
  detectAndSaveName(question, answer);

  return answer;
}

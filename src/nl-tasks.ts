// ─── Natural Language Task Creation ─────────────────────────────────
// "Remind me to call mom tomorrow at 3pm"
// "I need to finish the proposal by Friday"
// "Add a task: review PR #42, high priority"
//
// Parses natural language into structured tasks and saves to DB.

import OpenAI from "openai";
import { insertTask } from "./db.js";
import { getState } from "./db.js";
import type { ExtractedTask } from "./types.js";
import { createCalendarEvent } from "./calendar.js";

function getOpenAIClient(): OpenAI {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("OpenAI API key required. Add OPENAI_API_KEY to ~/.janjak/.env");
  return new OpenAI({ apiKey });
}

// ─── Intent Detection ───────────────────────────────────────────

const TASK_PATTERNS = /\b(remind me|add a task|create a task|new task|i need to|i have to|i should|i must|don't forget|note to self|add to my list|schedule|deadline|put on my list|rappelle[- ]?moi|ajoute|n'oublie pas|faudrait que|je dois)\b/i;

/** Quick check if a message looks like it wants to create a task */
export function looksLikeTaskCreation(text: string): boolean {
  return TASK_PATTERNS.test(text);
}

// ─── AI Parsing ─────────────────────────────────────────────────

interface ParsedTask {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  deadline: string | null; // YYYY-MM-DD
  time: string | null;     // HH:MM (24h) or null
  durationMinutes: number | null;
  person: string;
}

async function parseTaskFromText(text: string): Promise<ParsedTask | null> {
  const client = getOpenAIClient();
  const today = new Date().toISOString().split("T")[0];
  const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a task parser. Extract a task from the user's natural language input. Respond with valid JSON only, no markdown.

Today is ${dayOfWeek}, ${today}.

JSON format:
{
  "isTask": true/false,
  "title": "short imperative action (e.g. 'Call mom', 'Review PR #42')",
  "description": "brief context if any, or empty string",
  "priority": "high" | "medium" | "low",
  "deadline": "YYYY-MM-DD or null",
  "time": "HH:MM in 24h format or null",
  "durationMinutes": number or null (estimate: calls=15, meetings=60, tasks=30),
  "person": "related person name or empty string"
}

Rules:
- "tomorrow" = the day after today
- "next Monday/Tuesday/etc" = the next occurrence of that weekday
- "this week" = end of current week (Friday)
- "end of month" = last day of current month
- "at 3pm" → deadline = today's date, time = "15:00"
- "tomorrow at 10am" → deadline = tomorrow, time = "10:00"
- "morning" = "09:00", "afternoon" = "14:00", "evening" = "18:00", "noon" = "12:00"
- If no deadline mentioned, use null for both deadline and time
- If a date but no time, set time to null
- Priority: "high" if urgent/today/tomorrow, "medium" if this week, "low" if no urgency
- Title should be concise and start with a verb
- If the input doesn't describe a task, set isTask to false`,
      },
      { role: "user", content: text },
    ],
    max_tokens: 200,
    temperature: 0.2,
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? "";

  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.isTask || !parsed.title) return null;

    return {
      title: parsed.title,
      description: parsed.description || "",
      priority: ["high", "medium", "low"].includes(parsed.priority) ? parsed.priority : "medium",
      deadline: parsed.deadline || null,
      time: parsed.time || null,
      durationMinutes: parsed.durationMinutes || null,
      person: parsed.person || "",
    };
  } catch {
    return null;
  }
}

// ─── Task Creation ──────────────────────────────────────────────

export interface CreatedTask {
  id: number;
  title: string;
  priority: string;
  deadline: string | null;
  calendarEventCreated: boolean;
  calendarLink: string | null;
}

/** Parse natural language and create a task. Returns null if not a valid task. */
export async function createTaskFromText(text: string): Promise<CreatedTask | null> {
  const parsed = await parseTaskFromText(text);
  if (!parsed) return null;

  const userName = getState("user_name") ?? "";

  const task: ExtractedTask = {
    title: parsed.title,
    description: parsed.description,
    priority: parsed.priority,
    deadline: parsed.deadline,
    person: parsed.person || userName,
    sourceEmailId: "",
    sourceSubject: "voice/chat",
    status: "pending",
    createdAt: Date.now(),
    suggestedReply: null,
  };

  const id = insertTask(task);

  // Create Google Calendar event if we have a deadline
  let calendarEventCreated = false;
  let calendarLink: string | null = null;

  if (parsed.deadline) {
    const calResult = await createCalendarEvent({
      title: parsed.title,
      date: parsed.deadline,
      startTime: parsed.time ?? undefined,
      durationMinutes: parsed.durationMinutes ?? undefined,
      description: parsed.description || `Task from Janjak — priority: ${parsed.priority}`,
    });
    if (calResult) {
      calendarEventCreated = true;
      calendarLink = calResult.htmlLink;
    }
  }

  return {
    id,
    title: parsed.title,
    priority: parsed.priority,
    deadline: parsed.deadline,
    calendarEventCreated,
    calendarLink,
  };
}

/** Format a created task for display */
export function formatCreatedTask(task: CreatedTask): string {
  const priorityIcon = task.priority === "high" ? "🔴" : task.priority === "medium" ? "🟡" : "🟢";
  const deadline = task.deadline ? ` (due: ${task.deadline})` : "";
  const cal = task.calendarEventCreated ? "  📅 Added to Google Calendar" : "";
  const link = task.calendarLink ? `\n  🔗 ${task.calendarLink}` : "";
  return `  ${priorityIcon} #${task.id} — ${task.title}${deadline}\n${cal}${link}`;
}

/** Format a spoken confirmation */
export function formatSpokenConfirmation(task: CreatedTask): string {
  const deadline = task.deadline ? `, due ${task.deadline}` : "";
  const cal = task.calendarEventCreated ? " I've also added it to your Google Calendar." : "";
  return `Got it! I've added "${task.title}" as a ${task.priority} priority task${deadline}.${cal}`;
}

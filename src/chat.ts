// ─── Natural Language Chat: Ask Janjak anything about your data ────
// "What did I do yesterday?" "How productive was I this week?"
// Feeds your full behavioral profile + session data to GPT and
// lets you have a conversation with your own work history.

import OpenAI from "openai";
import { getTodayStats, getDailySummaries, getTasks, getRecentSessions, getTopApps, getState, setState } from "./db.js";
import { getBehavioralProfile } from "./memory.js";
import { getTodayScore, getWeeklyScores } from "./score.js";
import { isAuthenticated } from "./gmail-auth.js";
import { fetchRecentEmails, searchEmails } from "./gmail-client.js";
import { looksLikeTaskCreation, createTaskFromText, formatCreatedTask } from "./nl-tasks.js";
import { recall, capture, formatHitsForPrompt } from "./memory/recall.js";
import { formatEntityContextForPrompt } from "./graph/query.js";
import { formatPersonalContextForPrompt } from "./personal/synthesis.js";
import { generateDocument, slugify, resolveFormat, type DocFormat } from "./doc.js";
import { fetchLiveInfo } from "./live.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type ChatMessage = { role: "user" | "assistant"; content: string };

const CHARACTER_NAMES: Record<string, string> = {
  janjak: "Janjak",
  "janèt": "Janèt",
};

function getCharacterName(): string {
  const key = getState("character") ?? "janjak";
  return CHARACTER_NAMES[key] ?? "Janjak";
}

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
export function buildContext(): string {
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

// ─── Conversational document generation ─────────────────────────
// Lets the user say "write me a PDF summarizing my week" inside `janjak ask`
// (and voice/daemon chat) and get a real file back.

const DOC_REQUEST_VERB = /\b(create|make|generate|write|draft|produce|prepare|put together|g[ée]n[èe]re|cr[ée]e|r[ée]dige|[ée]cris|pr[ée]pare)\b/i;
const DOC_REQUEST_NOUN = /\b(document|doc|pdf|word\s?doc|docx|report|memo|letter|brief|summary|essay|proposal|agenda|minutes|write[- ]?up|rapport|lettre|r[ée]sum[ée]|compte[- ]?rendu)\b/i;
const DOC_REQUEST_NEGATIVE = /\b(task|to-?do|remind me|reminder|calendar event)\b/i;

/** Quick check if a message is asking to generate a document/file. */
export function looksLikeDocRequest(text: string): boolean {
  if (DOC_REQUEST_NEGATIVE.test(text)) return false;
  return DOC_REQUEST_VERB.test(text) && DOC_REQUEST_NOUN.test(text);
}

interface ParsedDocRequest {
  isDoc: boolean;
  prompt: string;
  format: DocFormat;
  filename: string | null;
  emailQuery: string | null;
}

async function parseDocRequest(text: string): Promise<ParsedDocRequest | null> {
  const client = getOpenAIClient();
  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `Extract a document-generation request. Respond with JSON only.
{
  "isDoc": true or false,        // true only if the user wants a document/file created
  "prompt": "a clear instruction describing the document to write",
  "format": "pdf|docx|doc|md|txt|html|rtf|odt",  // pick from the user's words; default "pdf"
  "filename": "a short 2-5 word file name (no extension) summarizing the document",
  "emailQuery": "a Gmail search query if the document should be based on an email, else null"
}
Rules:
- If no explicit format is mentioned, use "pdf". Always provide a concise "filename".
- Set "emailQuery" only when the user references an email as the source. Translate it to Gmail search syntax:
  - "my unread email" / "the latest unread email" -> "is:unread"
  - "the email from sarah about the launch" -> "from:sarah launch"
  - "the invoice email" -> "subject:invoice"
  Otherwise set "emailQuery" to null.`,
      },
      { role: "user", content: text },
    ],
  });
  try {
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
    if (!parsed.isDoc) return null;
    const format = resolveFormat(String(parsed.format ?? "pdf")) ?? "pdf";
    return {
      isDoc: true,
      prompt: typeof parsed.prompt === "string" && parsed.prompt.trim() ? parsed.prompt : text,
      format,
      filename: typeof parsed.filename === "string" && parsed.filename.trim() ? parsed.filename : null,
      emailQuery: typeof parsed.emailQuery === "string" && parsed.emailQuery.trim() ? parsed.emailQuery : null,
    };
  } catch {
    return null;
  }
}

async function handleDocRequest(text: string): Promise<string> {
  const parsed = await parseDocRequest(text);
  if (!parsed) return ""; // not actually a document request on closer inspection

  // Optionally ground the document in a real email.
  let source: string | undefined;
  if (parsed.emailQuery) {
    if (!isAuthenticated()) {
      return "To base a document on your email, connect Gmail first: janjak login";
    }
    try {
      const matches = await searchEmails(parsed.emailQuery, 1);
      if (matches.length === 0) {
        return `I couldn't find an email matching "${parsed.emailQuery}". Try being more specific about the sender or subject.`;
      }
      const email = matches[0]!;
      source = `From: ${email.from}\nSubject: ${email.subject}\nDate: ${new Date(email.date).toLocaleString()}\n\n${email.body}`;
    } catch (err) {
      return `I couldn't read that email: ${(err as Error).message}`;
    }
  }

  const dir = existsSync(join(homedir(), "Desktop")) ? join(homedir(), "Desktop") : homedir();
  const base = slugify(parsed.filename ?? parsed.prompt);
  const ext = parsed.format === "markdown" ? "md" : parsed.format;
  const outPath = join(dir, `${base}.${ext}`);

  try {
    const doc = await generateDocument({
      prompt: parsed.prompt,
      outPath,
      format: parsed.format,
      useContext: true,
      source,
    });
    return `📄 Done — I created "${doc.title}" and saved it to ${doc.path}`;
  } catch (err) {
    const message = (err as Error).message;
    // PDF needs Xcode tools; quietly fall back to a Word document instead.
    if (parsed.format === "pdf" && /swiftc|Xcode/i.test(message)) {
      try {
        const fallback = await generateDocument({
          prompt: parsed.prompt,
          outPath: join(dir, `${base}.docx`),
          format: "docx",
          useContext: true,
          source,
        });
        return `📄 Done — I created "${fallback.title}" as a Word document (PDF needs Xcode tools) and saved it to ${fallback.path}`;
      } catch (err2) {
        return `I couldn't create that document: ${(err2 as Error).message}`;
      }
    }
    return `I couldn't create that document: ${message}`;
  }
}

/**
 * Build a Gmail search query from a natural question when it references a
 * specific sender, subject, or topic — so Janjak can find read emails too,
 * not just unread ones. Returns null for generic "what are my emails" asks.
 */
function buildEmailSearchQuery(question: string): string | null {
  const q = question.trim();
  // "email from Sarah", "emails from Michaela", "from John"
  let m = q.match(/\bemails?\s+(?:from|by)\s+([A-Za-z][\w.''-]+)/i)
       ?? q.match(/\bfrom\s+([A-Z][\w.''-]+)/);
  if (m) return `from:${m[1]}`;
  // "Sarah's email", "Michaela's message"
  m = q.match(/\b([A-Z][a-z]+)['']s?\s+(?:email|emails|message|messages|mail)\b/);
  if (m) return `from:${m[1]}`;
  // "about the invoice", "regarding the launch", "email about X"
  m = q.match(/\b(?:about|regarding|re:?|on)\s+(?:the\s+|my\s+)?([a-z0-9][\w ]{2,30})/i);
  if (m) return m[1].trim().split(/\s+/).slice(0, 4).join(" ");
  return null;
}

async function fetchEmailContext(question: string): Promise<string> {
  if (!isAuthenticated()) {
    return "\nEMAIL ACCESS: Gmail is NOT connected, so you cannot see the user's inbox. Since they asked something email-related, tell them to connect Gmail first by running: janjak login";
  }
  try {
    // Targeted search (read + unread, all folders) when a sender/subject is named.
    const query = buildEmailSearchQuery(question);
    if (query) {
      const found = await searchEmails(query, 5);
      if (found.length === 0) {
        return `\nEMAIL ACCESS: Gmail IS connected. A search for "${query}" (read and unread, across all folders) returned no matching emails.`;
      }
      const list = found.map((e, i) => {
        const date = new Date(e.date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        const preview = (e.body || e.snippet || "").replace(/\s+/g, " ").slice(0, 300);
        return `${i + 1}. From: ${e.from} | Subject: ${e.subject} | ${date}\n   ${preview}`;
      }).join("\n");
      return `\nEMAIL ACCESS: Gmail IS connected.\nSEARCH RESULTS for "${query}" (read + unread, ${found.length} found):\n${list}`;
    }

    // Otherwise, summarize recent unread inbox.
    const emails = await fetchRecentEmails(10);
    if (emails.length === 0) return "\nEMAIL ACCESS: Gmail IS connected.\nUNREAD EMAILS:\nNo unread emails in inbox.";
    const list = emails.map((e, i) => {
      const date = new Date(e.date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      return `${i + 1}. From: ${e.from} | Subject: ${e.subject} | ${date}\n   Preview: ${e.snippet?.slice(0, 150) ?? ""}`;
    }).join("\n");
    return `\nEMAIL ACCESS: Gmail IS connected.\nUNREAD EMAILS (${emails.length}):\n${list}`;
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
export interface AskOptions {
  /** Raw text of documents/emails the user attached and wants analyzed. */
  attachments?: string;
}

export async function askJanjak(question: string, history: ChatMessage[] = [], opts: AskOptions = {}): Promise<string> {
  const client = getOpenAIClient();

  // Conversational document generation: "write me a PDF summarizing my week".
  if (looksLikeDocRequest(question)) {
    const docResult = await handleDocRequest(question);
    if (docResult) return docResult;
  }

  let context = buildContext();
  const characterName = getCharacterName();

  // Attached material (uploaded documents / a specific email) to reason about.
  const hasAttachments = !!opts.attachments && opts.attachments.trim().length > 0;
  if (hasAttachments) {
    context += `\n\nATTACHED MATERIAL (the user shared this and wants your thoughts/analysis on it — base your answer primarily on this content):\n${opts.attachments}`;
  }

  // Enrich with email data when the question is email-related
  if (isEmailRelated(question)) {
    const emailCtx = await fetchEmailContext(question);
    if (emailCtx) context += emailCtx;
  }

  // Enrich with real-time info (e.g. weather) that isn't in local history.
  try {
    const liveCtx = await fetchLiveInfo(question);
    if (liveCtx) context += liveCtx;
  } catch {
    // best-effort — never blocks the answer
  }

  // Semantic recall: pull relevant past memories before generating.
  let memoryBlock = "";
  try {
    const hits = await recall(question, { limit: 6, minSimilarity: 0.2, respectTiers: true });
    memoryBlock = formatHitsForPrompt(hits);
  } catch {
    memoryBlock = "";
  }

  let entityBlock = "";
  try {
    entityBlock = formatEntityContextForPrompt(question, 5);
  } catch {
    entityBlock = "";
  }

  let personalBlock = "";
  try {
    personalBlock = formatPersonalContextForPrompt();
  } catch {
    personalBlock = "";
  }

  const systemPrompt = `You are ${characterName}, a personal AI assistant that knows everything about the user's digital work habits. You have access to their complete activity history, focus scores, behavioral patterns, and tasks.

Your name is ${characterName}. Always refer to yourself as ${characterName}, never as "Janjak" unless that is your name.

Answer questions naturally, conversationally, and with specific data. Be concise (2-5 sentences usually). Use numbers and specifics from the data — don't be vague.

When the user asks about time periods:
- "yesterday" = the most recent day before today in the data
- "this week" = the last 7 days of data
- "today" = today's data

When giving advice, ground it in their actual patterns (peak hours, scores, trends).
When the user asks about emails, summarize the relevant emails clearly — mention sender, subject, and urgency. Suggest which to respond to first. You can see BOTH read and unread emails: when the user names a sender, subject, or topic, the USER DATA includes search results across their whole mailbox (read + unread). Never claim you can only see unread emails.
The USER DATA section reflects the user's CURRENT, live state and always takes priority over older memories or past conversation. If it shows "Gmail IS connected" or lists emails, Gmail is connected — answer using that data and never tell the user to run "janjak login". Only mention connecting Gmail if the live data explicitly says Gmail is NOT connected.
If the USER DATA contains a "LIVE WEATHER" line, use it to answer weather questions directly with those real numbers — don't say you can't access live weather.
About yourself: you DO learn and improve over time. You remember past conversations (semantic memory), learn the user's preferences and routines, build a graph of the people and projects they mention, and track their behavioral patterns. When asked if you learn or self-improve, answer honestly and concretely based on this — don't say you can't learn.
When the user tells you their name, remember it and use it naturally.
Use 1-2 emoji naturally. Don't be overly enthusiastic — be like a smart, calm friend.
Maintain conversation context — if the user refers to something from a previous message ("this", "that", "it"), use the conversation history to understand what they mean.
Respond in the same language the user speaks to you.
${hasAttachments ? "\nThe user attached material (a document and/or an email) under ATTACHED MATERIAL. Give a thoughtful, well-structured analysis of it: summarize the key points, flag anything important, risky, or that needs clarification, and end with a clear recommendation. You may use short sections or bullet points and write as much as the content warrants — depth matters more than brevity here.\n" : ""}

${memoryBlock ? memoryBlock + "\n\n" : ""}${entityBlock ? entityBlock + "\n\n" : ""}${personalBlock ? personalBlock + "\n\n" : ""}USER DATA:
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
    max_tokens: hasAttachments ? 800 : 400,
    temperature: 0.7,
  });

  const answer = response.choices[0]?.message?.content?.trim() ?? "I couldn't process that. Try rephrasing?";

  // Try to detect & persist user name
  detectAndSaveName(question, answer);

  // Capture the Q+A pair as a semantic memory (best-effort, never blocks).
  // Skip transient system-status answers (e.g. "Gmail not connected, run janjak
  // login") so they don't later get recalled and override the live state.
  const isTransientStatus = /janjak login|not connected|couldn't process|i couldn't/i.test(answer);
  if (!isTransientStatus) {
    try {
      await capture({
        type: "ai_chat",
        text: `Q: ${question}\nA: ${answer}`,
        metadata: { character: characterName },
        importance: 0.5,
      });
    } catch {
      // ignore — embeddings are best-effort
    }
  }

  return answer;
}

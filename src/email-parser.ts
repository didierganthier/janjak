// ─── AI Email Parser: Extracts tasks from emails using OpenAI ──────
import OpenAI from "openai";
import type { EmailMessage, ExtractedTask } from "./types.js";

function getOpenAIClient(): OpenAI {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "OpenAI API key not set.\n\n" +
      "  Set it in your environment:\n" +
      "    export OPENAI_API_KEY=sk-...\n\n" +
      "  Or add it to ~/.janjak/.env"
    );
  }
  return new OpenAI({ apiKey });
}

interface ParsedEmail {
  hasTasks: boolean;
  tasks: Array<{
    title: string;
    description: string;
    priority: "high" | "medium" | "low";
    deadline: string | null;
  }>;
  suggestedReply: string | null;
  summary: string;
}

export async function parseEmail(email: EmailMessage): Promise<ParsedEmail> {
  const client = getOpenAIClient();

  const prompt = `Analyze this email and extract actionable tasks. Be concise and practical.

FROM: ${email.from}
SUBJECT: ${email.subject}
DATE: ${new Date(email.date).toLocaleDateString()}
BODY:
${email.body}

Respond in JSON format:
{
  "hasTasks": boolean,
  "tasks": [
    {
      "title": "short action item (imperative verb)",
      "description": "1-2 sentence context",
      "priority": "high" | "medium" | "low",
      "deadline": "YYYY-MM-DD" or null
    }
  ],
  "suggestedReply": "brief 1-3 sentence reply draft" or null (only if a reply seems needed),
  "summary": "1 sentence summary of the email"
}

Rules:
- Only extract REAL tasks (things that need action from the recipient)
- Ignore newsletters, marketing, notifications with no action needed
- Priority: high = urgent/deadline soon, medium = needs action, low = nice-to-have
- If no tasks exist, return hasTasks: false with empty tasks array
- suggestedReply should be professional and concise, or null if no reply needed`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a precise email analyzer. Always respond with valid JSON only, no markdown." },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 800,
  });

  const content = response.choices[0]?.message?.content?.trim() ?? "{}";

  try {
    // Strip markdown code fences if present
    const cleaned = content.replace(/^```(?:json)?\n?/g, "").replace(/\n?```$/g, "");
    return JSON.parse(cleaned) as ParsedEmail;
  } catch {
    return { hasTasks: false, tasks: [], suggestedReply: null, summary: "Could not parse email." };
  }
}

export async function parseEmailBatch(emails: EmailMessage[]): Promise<Map<string, ParsedEmail>> {
  const results = new Map<string, ParsedEmail>();

  // Process in parallel (max 5 concurrent)
  const batchSize = 5;
  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize);
    const promises = batch.map(async (email) => {
      const parsed = await parseEmail(email);
      results.set(email.id, parsed);
    });
    await Promise.all(promises);
  }

  return results;
}

export async function generateInboxSummary(emails: EmailMessage[]): Promise<string> {
  if (emails.length === 0) return "Inbox is clean. No unread emails.";

  const client = getOpenAIClient();

  const emailList = emails
    .slice(0, 10)
    .map((e, i) => `${i + 1}. FROM: ${e.from} | SUBJECT: ${e.subject} | SNIPPET: ${e.snippet}`)
    .join("\n");

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a sharp executive assistant. Be direct and practical. No fluff.",
      },
      {
        role: "user",
        content: `Here are my recent unread emails. Give me a brief briefing — what needs my attention, what can wait, and what I can ignore. Be concise.\n\n${emailList}`,
      },
    ],
    temperature: 0.4,
    max_tokens: 500,
  });

  return response.choices[0]?.message?.content?.trim() ?? "Could not generate summary.";
}

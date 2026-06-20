// ─── Email Reply Drafter: AI-generates replies and opens email app ──
// Reads task context (who sent it, what they need, original subject),
// drafts a professional reply via GPT, and opens the compose window
// in your default email client via mailto: URL.

import OpenAI from "openai";
import { execSync } from "node:child_process";
import { getTasks } from "./db.js";
import { formatEntityContextForPrompt } from "./graph/query.js";
import { formatPersonalContextForPrompt } from "./personal/synthesis.js";
import type { ExtractedTask } from "./types.js";

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

/** Find a task by ID */
export function getTaskById(id: number): ExtractedTask | null {
  const all = getTasks();
  const done = getTasks("done");
  const dismissed = getTasks("dismissed");
  const allTasks = [...all, ...done, ...dismissed];
  return allTasks.find(t => t.id === id) ?? null;
}

/** Extract email address from "Name <email>" format */
function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match?.[1] ?? from.trim();
}

/** Extract display name from "Name <email>" format */
function extractName(from: string): string {
  const name = from.replace(/<.*>/, "").replace(/"/g, "").trim();
  return name || from;
}

/** Generate a polished email reply using AI */
export async function generateReply(task: ExtractedTask, tone: "professional" | "friendly" | "brief" = "professional"): Promise<string> {
  const client = getOpenAIClient();

  const toneGuide: Record<string, string> = {
    professional: "Write in a professional, polished tone. Be courteous and clear.",
    friendly: "Write in a warm, friendly tone. Be approachable but still competent.",
    brief: "Be extremely concise — 2-3 sentences max. Get straight to the point.",
  };

  let entityBlock = "";
  try {
    entityBlock = formatEntityContextForPrompt(
      `${task.person}\n${task.sourceSubject}\n${task.title}\n${task.description}`,
      4
    );
  } catch {
    entityBlock = "";
  }

  let personalBlock = "";
  try {
    personalBlock = formatPersonalContextForPrompt();
  } catch {
    personalBlock = "";
  }

  const prompt = `Draft an email reply for the following task/request.

CONTEXT:
- From: ${task.person}
- Original subject: ${task.sourceSubject}
- Task: ${task.title}
- Description: ${task.description}
- Deadline: ${task.deadline ?? "none specified"}
- Priority: ${task.priority}
- Current status: ${task.status}

${task.suggestedReply ? `INITIAL DRAFT (improve this):\n${task.suggestedReply}\n` : ""}

INSTRUCTIONS:
- ${toneGuide[tone]}
- Address the sender by their first name
- Acknowledge their request specifically
- Confirm what action you're taking or have taken
- If there's a deadline, reference it
- Keep it natural — not robotic or templated
- Do NOT include subject line, greetings like "Dear" or sign-offs like "Best regards" with a name — just the body
- The user will add their own greeting and signature
${entityBlock ? `\n\n${entityBlock}` : ""}
${personalBlock ? `\n\n${personalBlock}` : ""}

Reply body:`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a sharp professional email writer. Write natural, human emails — not corporate boilerplate. Match the context and urgency of the request.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.6,
    max_tokens: 500,
  });

  return response.choices[0]?.message?.content?.trim() ?? task.suggestedReply ?? "Could not generate reply.";
}

/** Build a mailto: URL that opens the email client with the draft */
function buildMailtoUrl(to: string, subject: string, body: string): string {
  const params = new URLSearchParams();
  params.set("subject", subject);
  params.set("body", body);
  // mailto: spec uses & not the encoded version for params
  return `mailto:${encodeURIComponent(to)}?${params.toString()}`;
}

/** Open the default email app with a pre-filled reply */
export function openInEmailApp(to: string, subject: string, body: string): void {
  const url = buildMailtoUrl(to, subject, body);
  // macOS: `open` command handles mailto: URLs
  execSync(`open "${url.replace(/"/g, '\\"')}"`);
}

/** Full flow: generate reply + open in email app */
export async function draftAndOpen(
  taskId: number,
  options: { tone?: "professional" | "friendly" | "brief"; noOpen?: boolean } = {}
): Promise<{ task: ExtractedTask; reply: string; to: string; subject: string }> {
  const task = getTaskById(taskId);
  if (!task) {
    throw new Error(`Task #${taskId} not found.`);
  }

  const tone = options.tone ?? "professional";

  console.log(`\n✉️  Drafting reply for task #${taskId}...`);
  console.log(`   To: ${task.person}`);
  console.log(`   Subject: Re: ${task.sourceSubject}`);
  console.log(`   Tone: ${tone}\n`);

  const reply = await generateReply(task, tone);
  const to = extractEmail(task.person);
  const subject = `Re: ${task.sourceSubject}`;

  // Display the draft
  console.log("─".repeat(50));
  console.log(`To: ${to}`);
  console.log(`Subject: ${subject}`);
  console.log("─".repeat(50));
  console.log(reply);
  console.log("─".repeat(50));

  if (!options.noOpen) {
    console.log("\n📨 Opening email app...");
    openInEmailApp(to, subject, reply);
    console.log("   ✓ Draft opened! Review, edit if needed, and hit Send.");
  }

  return { task, reply, to, subject };
}

/** Format a reply preview for terminal display */
export function formatReplyPreview(task: ExtractedTask, reply: string): string {
  const to = extractEmail(task.person);
  const name = extractName(task.person);

  let output = "\n✉️  Email Draft\n";
  output += "═".repeat(50) + "\n";
  output += `  To: ${name} <${to}>\n`;
  output += `  Subject: Re: ${task.sourceSubject}\n`;
  output += `  Task: #${task.id} ${task.title}\n`;
  output += "─".repeat(50) + "\n\n";
  output += reply + "\n\n";
  output += "─".repeat(50) + "\n";
  output += "  💡 Use `janjak reply " + task.id + "` to open in your email app\n";

  return output;
}

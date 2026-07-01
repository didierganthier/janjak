// ─── Janjak ClientOps — AI layer ────────────────────────────────────
// Phase 2: turns structured project context into useful output —
// status summaries, meeting-prep briefs, payment follow-up drafts,
// and cross-portfolio risk detection. All calls use gpt-4o-mini.

import OpenAI from "openai";
import type { Payment } from "./types.js";
import type { ProjectContext } from "./context-builder.js";
import { formatProjectContext } from "./context-builder.js";
import { formatMoney } from "./util.js";

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

/** A concise, skimmable status summary of a single project. */
export async function summarizeProject(ctx: ProjectContext): Promise<string> {
  const client = getOpenAIClient();
  const prompt = `Summarize the current state of this client project for the freelancer running it.

${formatProjectContext(ctx)}

Write a tight status summary:
- One-line headline (where things stand right now).
- 2-4 bullets on progress, blockers, and money.
- A "Next" line with the single most important next action.
Keep it under 120 words. Be concrete. Do not invent facts not present above.`;

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a sharp operations partner for a solo freelancer. You summarize project status crisply and flag what matters. Never fabricate details.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
    max_tokens: 350,
  });

  return res.choices[0]?.message?.content?.trim() ?? "Could not generate summary.";
}

/** A pre-meeting brief: what to know, what to raise, what to decide. */
export async function prepBrief(ctx: ProjectContext): Promise<string> {
  const client = getOpenAIClient();
  const prompt = `Prepare me for a meeting/check-in about this client project.

${formatProjectContext(ctx)}

Produce a meeting brief:
- **Where we are** — 1-2 sentences.
- **Talking points** — 3-5 bullets I should raise.
- **Open questions / decisions needed** — bullets.
- **Watch-outs** — anything at risk (deadlines, payments, scope, silence).
Be specific to the data above. Do not invent facts. Keep it under 180 words.`;

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You brief a solo freelancer before client meetings. You are practical and concise, and you never fabricate details.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
    max_tokens: 400,
  });

  return res.choices[0]?.message?.content?.trim() ?? "Could not generate brief.";
}

export type FollowupTone = "friendly" | "professional" | "firm";

/** Draft a payment follow-up message (never sent automatically). */
export async function draftPaymentFollowup(
  payment: Payment,
  ctx: ProjectContext,
  tone: FollowupTone = "friendly"
): Promise<string> {
  const client = getOpenAIClient();
  const toneGuide: Record<FollowupTone, string> = {
    friendly: "Warm and easygoing. Assume good intent; gently nudge.",
    professional: "Polished and neutral. Courteous but clear about the ask.",
    firm: "Direct and businesslike. Polite, but unambiguous that payment is due.",
  };
  const clientName = ctx.client?.name?.split(" ")[0] ?? "there";
  const channel = ctx.client?.preferredChannel ?? "email";

  const prompt = `Draft a payment follow-up message to a client about an outstanding invoice.

${formatProjectContext(ctx)}

INVOICE IN QUESTION: ${formatMoney(payment.amount, payment.currency)} — status ${payment.status}${
    payment.dueDate ? `, due ${payment.dueDate}` : ""
  }.

INSTRUCTIONS:
- ${toneGuide[tone]}
- Address the client as "${clientName}".
- Reference the project and the specific amount.
- Make the ask clear (confirm payment / share timeline).
- Written for ${channel}. Keep it short — 3-5 sentences.
- Just the message body — no subject line, no signature.
- Do not invent facts (dates, amounts) beyond what's above.

Message:`;

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You write payment follow-up messages for a solo freelancer. Natural, human, never pushy or robotic. Never fabricate amounts or dates.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.6,
    max_tokens: 300,
  });

  return res.choices[0]?.message?.content?.trim() ?? "Could not generate message.";
}

/** Scan several projects and flag which need attention and why. */
export async function detectRisks(contexts: ProjectContext[]): Promise<string> {
  const client = getOpenAIClient();
  if (contexts.length === 0) return "No open projects to assess.";

  const blocks = contexts
    .map((ctx, i) => `### Project ${i + 1}\n${formatProjectContext(ctx)}`)
    .join("\n\n");

  const prompt = `You are triaging a freelancer's project portfolio for risk.

${blocks}

For each project that needs attention, output one entry:
- **<Project name>** — <risk level: elevated/high> — <one-line reason> → <recommended action>.
Prioritize: overdue payments, missed/looming deadlines, blocked deliverables, client silence, and scope/priority mismatches.
Sort highest risk first. Skip projects that are genuinely fine (mention them in a final one-line "Steady:" list). Do not invent facts.`;

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a risk-radar for a solo freelancer's project portfolio. You are decisive and specific, and you never fabricate details.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 600,
  });

  return res.choices[0]?.message?.content?.trim() ?? "Could not assess risks.";
}

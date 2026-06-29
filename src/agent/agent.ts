// ─── Agentic Brain: plan → act → observe loop ─────────────────────
// The "do anything" core. Given a natural-language request, the model
// decides which Janjak tools to call, calls them (possibly several in
// sequence), reads the results, and continues until the task is done —
// then returns a final answer. This is what makes Janjak able to chain
// capabilities ("check the weather, then draft an email and save a PDF").

import OpenAI from "openai";
import { getState } from "../db.js";
import { capture } from "../memory/recall.js";
import { logDecision } from "../learning/explain.js";
import { formatPersonalContextForPrompt } from "../personal/synthesis.js";
import { buildContext } from "../chat.js";
import { getAgentTools, getToolSchemas, findTool, describeAction } from "./tools.js";

const MODEL = "gpt-4o-mini";
const MAX_STEPS = 8;

export interface AgentStep {
  /** Tool name being invoked. */
  tool: string;
  /** Arguments passed to the tool. */
  args: Record<string, unknown>;
}

export interface ConfirmRequest {
  /** Tool name about to run. */
  tool: string;
  /** Human-friendly description of the action. */
  description: string;
  /** Arguments the tool will receive. */
  args: Record<string, unknown>;
}

export interface RunAgentOptions {
  /** Prior conversation turns for follow-up requests. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Called right before each tool runs — lets the CLI show progress. */
  onStep?: (step: AgentStep) => void;
  /** Extra material (documents, an email body) for the agent to reason about. */
  attachments?: string;
  /**
   * Approval gate for risky (confirm-tier) tools. Return true to allow the
   * action, false to decline. When omitted, confirm-tier tools are blocked
   * (safe by default) — used for non-interactive surfaces like voice/daemon.
   */
  confirm?: (req: ConfirmRequest) => Promise<boolean>;
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

function buildSystemPrompt(attachments?: string): string {
  const name = getState("user_name") ?? "the user";
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const isoDate = now.toISOString().slice(0, 10);

  let personal = "";
  try {
    personal = formatPersonalContextForPrompt(now);
  } catch {
    personal = "";
  }

  let behavioral = "";
  try {
    behavioral = buildContext();
  } catch {
    behavioral = "";
  }

  return [
    `You are Janjak, ${name}'s personal AI assistant and "super brain".`,
    `Today is ${dateStr}, current time ${timeStr} (ISO date ${isoDate}).`,
    "",
    "You can both ANSWER questions about the user's work/life and TAKE real actions",
    "using the provided tools: managing tasks and calendar, reading and searching Gmail,",
    "searching the web, fetching weather, recalling memories, looking up people/projects,",
    "running workflows, drafting emails, and generating or reading documents.",
    "",
    "Operating rules:",
    "- The USER DATA block below is live and authoritative — use it to answer questions about",
    "  the user's activity, focus, tasks and patterns directly, without a tool call.",
    "- To DO something (create a task, draft a document, look up an email, search the web,",
    "  check weather, add a calendar event), CALL the appropriate tool. Do not pretend or",
    "  describe results you didn't actually get from a tool.",
    "- Chain tools when a request needs several steps. Gather information first, then act.",
    "- When a tool reports that Gmail/Calendar isn't connected, tell the user to run 'janjak login'",
    "  instead of guessing.",
    "- Use real data from tool results; never invent file paths, email contents, or events.",
    "- When you've completed the request, give a short, friendly confirmation of what you did,",
    "  including any file paths or links the tools returned.",
    "- Be concise. Don't over-explain.",
    personal ? `\n${personal}` : "",
    behavioral ? `\n[USER DATA]\n${behavioral}` : "",
    attachments ? `\n[ATTACHED MATERIAL — the user attached this to reason about]\n${attachments}` : "",
  ].join("\n");
}

/**
 * Run the agentic loop for a single request. Returns the final natural-language
 * answer after any tools have been executed.
 */
export async function runAgent(request: string, opts: RunAgentOptions = {}): Promise<string> {
  const client = getOpenAIClient();
  const toolSchemas = getToolSchemas();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(opts.attachments) },
  ];

  for (const turn of opts.history ?? []) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: "user", content: request });

  let finalAnswer = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: toolSchemas,
      tool_choice: "auto",
      temperature: 0.4,
      max_tokens: 900,
    });

    const choice = completion.choices[0]?.message;
    if (!choice) break;

    const toolCalls = choice.tool_calls ?? [];

    if (toolCalls.length === 0) {
      finalAnswer = choice.content?.trim() ?? "";
      break;
    }

    // Record the assistant turn that requested the tool calls.
    messages.push(choice);

    // Execute each requested tool and feed results back.
    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      const toolName = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }

      opts.onStep?.({ tool: toolName, args });

      const tool = findTool(toolName);
      let result = "";
      if (!tool) {
        result = `ERROR: unknown tool "${toolName}".`;
      } else {
        let proceed = true;
        if (tool.risk === "confirm") {
          const description = describeAction(toolName, args);
          if (opts.confirm) {
            try {
              proceed = await opts.confirm({ tool: toolName, description, args });
            } catch {
              proceed = false;
            }
            if (!proceed) result = `The user declined to ${description}.`;
          } else {
            proceed = false;
            result =
              `BLOCKED: "${description}" needs the user's confirmation, which isn't ` +
              `available here. Tell the user to run this from 'janjak do' in the terminal to approve it.`;
          }
        }
        if (proceed) {
          try {
            result = await tool.handler(args);
          } catch (err) {
            result = `ERROR running ${toolName}: ${(err as Error).message}`;
          }
        }
      }

      // Audit trail: record every tool invocation so 'janjak why' can explain it.
      try {
        logDecision({
          decisionId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: "agent_action",
          description: `${describeAction(toolName, args)} → ${result.replace(/\s+/g, " ").slice(0, 160)}`,
          confidence: 1,
        });
      } catch {
        /* audit logging is best-effort */
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  if (!finalAnswer) {
    finalAnswer = "I ran out of steps before fully finishing. Could you narrow the request a bit?";
  }

  // Best-effort: remember what was asked and done.
  try {
    await capture({
      type: "session",
      text: `Agent request: ${request}\nResult: ${finalAnswer}`,
      metadata: { source: "agent" },
      importance: 0.5,
    });
  } catch {
    // ignore
  }

  return finalAnswer;
}

// Re-export so callers can introspect available capabilities.
export { getAgentTools };

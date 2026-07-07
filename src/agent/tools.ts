// ─── Agent Tool Registry ──────────────────────────────────────────
// Every Janjak capability the agentic brain can invoke is registered
// here as a tool: an OpenAI function schema + an async handler that
// wraps an existing Janjak function. Adding a new capability is as
// simple as appending another entry — the model decides when to call
// it and can chain several together in one request.

import type OpenAI from "openai";
import { homedir } from "node:os";
import { join, isAbsolute, resolve, sep } from "node:path";
import { writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { getTasks, updateTaskStatus } from "../db.js";
import { getTodayScore } from "../score.js";
import { getCalendarSummary, createCalendarEvent } from "../calendar.js";
import { createTaskFromText, formatCreatedTask } from "../nl-tasks.js";
import { recall, formatHitsForPrompt } from "../memory/recall.js";
import { getEntityProfile, formatEntityProfile } from "../graph/query.js";
import { generateDocument, readDocument, resolveFormat, slugify, type DocFormat } from "../doc.js";
import { getWeather } from "../live.js";
import { isAuthenticated } from "../gmail-auth.js";
import { searchEmails, createDraft, sendEmail } from "../gmail-client.js";
import { getAllWorkflows, runWorkflowById, isWorkflowsEnabled } from "../workflows.js";
import { openInEmailApp } from "../reply.js";
import { resolveContact, listContacts } from "../contacts.js";
import { capture } from "../memory/recall.js";
import { webSearch } from "./websearch.js";
import { pauseMusic, resumeMusic, getCurrentTrack, playPlaylist } from "../music.js";
import { sendNotification, notificationsAvailable } from "../notify.js";
import type { ActivityState } from "../types.js";

export interface AgentTool {
  schema: OpenAI.Chat.Completions.ChatCompletionTool;
  /** Execute the tool. Returns a string observation fed back to the model. */
  handler: (args: Record<string, unknown>) => Promise<string>;
  /**
   * Risk level. "confirm" tools take an external or hard-to-reverse action and
   * require user approval before they run. Defaults to "safe".
   */
  risk?: "safe" | "confirm";
}

// ─── Helpers ──────────────────────────────────────────────────────

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

// ─── Write sandbox ────────────────────────────────────────────────
// write_file may only write inside these roots, even with an absolute path.
const ALLOWED_WRITE_ROOTS = [
  join(homedir(), "Desktop"),
  join(homedir(), "Documents"),
  join(homedir(), "Downloads"),
  join(homedir(), ".janjak"),
];
const ALLOWED_WRITE_LABEL = "Desktop, Documents, Downloads, or the Janjak folder";

function isWithinAllowedRoots(abs: string): boolean {
  const target = resolve(abs);
  return ALLOWED_WRITE_ROOTS.some((root) => {
    const r = resolve(root);
    return target === r || target.startsWith(r + sep);
  });
}

/**
 * Resolve a user-supplied write path. Absolute paths and ~ are honored; a bare
 * relative path defaults to the Desktop, but a path that already begins with an
 * allowlisted folder (Desktop/Documents/Downloads) is joined to home directly
 * so we don't end up with e.g. ~/Desktop/Desktop/file.txt.
 */
function resolveWritePath(p: string): string {
  let raw = p.trim();
  if (raw.startsWith("~/")) raw = raw.slice(2);
  if (isAbsolute(raw)) return raw;
  const first = raw.split(/[\\/]/)[0]?.toLowerCase();
  if (first === "desktop" || first === "documents" || first === "downloads" || first === ".janjak") {
    return join(homedir(), raw);
  }
  return join(homedir(), "Desktop", raw);
}

/** Human-friendly description of a (usually risky) action, for confirm prompts and audit logs. */
export function describeAction(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "write_file":
      return `write a file to ${str(args, "path") ?? "Desktop"}`;
    case "create_calendar_event":
      return `create a calendar event "${str(args, "title") ?? ""}" on ${str(args, "date") ?? "?"}${
        str(args, "startTime") ? " at " + str(args, "startTime") : ""
      }`;
    case "run_workflow":
      return `run the workflow "${str(args, "id") ?? ""}"`;
    case "create_gmail_draft":
      return `save a Gmail draft to ${str(args, "to") ?? ""} ("${str(args, "subject") ?? ""}")`;
    case "send_email":
      return `send an email to ${str(args, "to") ?? ""} ("${str(args, "subject") ?? ""}")`;
    case "draft_email":
      return `open an email draft to ${str(args, "to") ?? ""} ("${str(args, "subject") ?? ""}")`;
    default:
      return tool.replace(/_/g, " ");
  }
}

// ─── Tool definitions ─────────────────────────────────────────────

const tools: AgentTool[] = [
  {
    schema: {
      type: "function",
      function: {
        name: "get_focus_today",
        description:
          "Get the user's focus score and time breakdown for today (productivity, coding/browsing minutes, focus ratio).",
        parameters: { type: "object", properties: {} },
      },
    },
    handler: async () => {
      const s = getTodayScore();
      return [
        `Focus score today: ${s.score}/100 (${s.label}).`,
        `Tracked: ${s.totalMinutes} min total, ${s.codingMinutes} min coding, ${s.browsingMinutes} min browsing.`,
        `Focus ratio: ${Math.round(s.focusRatio * 100)}%.`,
      ].join(" ");
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "list_tasks",
        description:
          "List the user's current open tasks (pending / in-progress), ordered by priority. Use before creating a task to avoid duplicates, or when the user asks what's on their plate.",
        parameters: { type: "object", properties: {} },
      },
    },
    handler: async () => {
      const tasks = getTasks();
      if (tasks.length === 0) return "No open tasks.";
      return tasks
        .slice(0, 50)
        .map((t) => `#${t.id} [${t.priority}] ${t.title}${t.deadline ? ` (due ${t.deadline})` : ""} — ${t.status}`)
        .join("\n");
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "create_task",
        description:
          "Create a BRAND-NEW task or reminder from natural language. Parses title, priority, deadline and (if a deadline is present) adds it to Google Calendar. Use ONLY for 'remind me to…', 'I need to…', 'add a task…'. Do NOT use this to mark, complete, finish, remove, or delete an EXISTING task — use update_task_status for that. Never create a task like 'Complete X' to represent finishing task X.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The full natural-language task, e.g. 'finish the proposal by Friday, high priority'.",
            },
          },
          required: ["text"],
        },
      },
    },
    handler: async (args) => {
      const text = str(args, "text");
      if (!text) return "ERROR: missing 'text'.";
      const task = await createTaskFromText(text);
      if (!task) return "Could not parse a task from that text.";
      return `Created task:\n${formatCreatedTask(task)}`;
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "update_task_status",
        description:
          "Change the status of one or all EXISTING tasks. This is the ONLY correct way to mark a task done/completed/finished, or to dismiss/remove/delete a task. Call list_tasks first to get task IDs. Pass id='all' to apply the status to every open task at once. Do NOT create a new task to represent completing an existing one.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The task number to update (e.g. '52'), or 'all' to update every open task.",
            },
            status: {
              type: "string",
              enum: ["done", "dismissed", "in-progress", "pending"],
              description: "New status. Use 'done' to complete/finish, 'dismissed' to remove/delete.",
            },
          },
          required: ["id", "status"],
        },
      },
    },
    handler: async (args) => {
      const idArg = (str(args, "id") ?? "").trim().toLowerCase();
      const status = (str(args, "status") ?? "").trim() as "done" | "dismissed" | "in-progress" | "pending";
      if (!["done", "dismissed", "in-progress", "pending"].includes(status)) {
        return "ERROR: status must be one of done, dismissed, in-progress, pending.";
      }
      if (idArg === "all") {
        const open = getTasks().filter((t) => typeof t.id === "number");
        if (open.length === 0) return "No open tasks to update.";
        for (const t of open) updateTaskStatus(t.id!, status);
        const verb = status === "done" ? "completed" : status === "dismissed" ? "removed" : `set to ${status}`;
        return `Marked all ${open.length} open task(s) as ${verb}: ${open.map((t) => `#${t.id}`).join(", ")}.`;
      }
      const id = parseInt(idArg, 10);
      if (isNaN(id)) return "ERROR: id must be a task number or 'all'.";
      const task = getTasks().find((t) => t.id === id);
      if (!task) return `No open task with id #${id}. Call list_tasks to see current tasks.`;
      updateTaskStatus(id, status);
      const verb = status === "done" ? "completed" : status === "dismissed" ? "removed" : `set to ${status}`;
      return `Task #${id} "${task.title}" ${verb}.`;
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "get_calendar",
        description:
          "Get a summary of the user's Google Calendar for today: current meeting, next meeting, total meetings, and free time.",
        parameters: { type: "object", properties: {} },
      },
    },
    handler: async () => {
      if (!isAuthenticated()) return "Google Calendar/Gmail is not connected. The user should run 'janjak login'.";
      const s = await getCalendarSummary();
      const fmtTime = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const parts: string[] = [];
      parts.push(s.currentEvent ? `In a meeting now: "${s.currentEvent.title}".` : "No meeting right now.");
      parts.push(
        s.nextEvent ? `Next: "${s.nextEvent.title}" at ${fmtTime(s.nextEvent.start)}.` : "Nothing else scheduled."
      );
      parts.push(`${s.totalMeetings} meeting(s) today, ~${s.freeMinutes} min free.`);
      return parts.join(" ");
    },
  },

  {
    risk: "confirm",
    schema: {
      type: "function",
      function: {
        name: "create_calendar_event",
        description:
          "Create a Google Calendar event. Provide a date (YYYY-MM-DD). Include startTime (HH:MM 24h) for a timed event, omit it for an all-day reminder.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Event title." },
            date: { type: "string", description: "Date in YYYY-MM-DD format." },
            startTime: { type: "string", description: "Optional start time in 24h HH:MM. Omit for all-day." },
            durationMinutes: { type: "number", description: "Optional duration in minutes (default 60)." },
            description: { type: "string", description: "Optional event description." },
          },
          required: ["title", "date"],
        },
      },
    },
    handler: async (args) => {
      if (!isAuthenticated()) return "Google Calendar is not connected. The user should run 'janjak login'.";
      const title = str(args, "title");
      const date = str(args, "date");
      if (!title || !date) return "ERROR: 'title' and 'date' are required.";
      const res = await createCalendarEvent({
        title,
        date,
        startTime: str(args, "startTime"),
        durationMinutes: num(args, "durationMinutes"),
        description: str(args, "description"),
      });
      if (!res) return "Failed to create the calendar event.";
      return `Created calendar event "${title}" on ${date}. Link: ${res.htmlLink}`;
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the current weather and today's forecast for a city or place.",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string", description: "City or place, e.g. 'Port-au-Prince'." },
          },
          required: ["location"],
        },
      },
    },
    handler: async (args) => {
      const location = str(args, "location");
      if (!location) return "ERROR: missing 'location'.";
      const w = await getWeather(location);
      return w ?? `Could not fetch weather for ${location}.`;
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "search_email",
        description:
          "Search the user's Gmail (read + unread) and return matching messages with sender, subject and a body snippet. Use Gmail query syntax (e.g. 'from:alice is:unread', 'subject:invoice').",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Gmail search query, e.g. 'from:boss is:unread'." },
            max: { type: "number", description: "Max messages to return (default 5)." },
          },
          required: ["query"],
        },
      },
    },
    handler: async (args) => {
      if (!isAuthenticated()) return "Gmail is not connected. The user should run 'janjak login'.";
      const query = str(args, "query");
      if (!query) return "ERROR: missing 'query'.";
      const emails = await searchEmails(query, num(args, "max") ?? 5);
      if (emails.length === 0) return `No emails found for "${query}".`;
      return emails
        .map(
          (e, i) =>
            `[${i + 1}] From: ${e.from}\nSubject: ${e.subject}\nDate: ${new Date(e.date).toLocaleString()}\n${(e.body || e.snippet || "").slice(0, 1200)}`
        )
        .join("\n\n");
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "recall_memory",
        description:
          "Semantically search everything Janjak has learned about the user (notes, past tasks, captured facts) and return the most relevant memories.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to recall, e.g. 'my preferred meeting times'." },
          },
          required: ["query"],
        },
      },
    },
    handler: async (args) => {
      const query = str(args, "query");
      if (!query) return "ERROR: missing 'query'.";
      const hits = await recall(query, { limit: 6 });
      const block = formatHitsForPrompt(hits);
      return block || "No relevant memories found.";
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "who_is",
        description:
          "Look up a person, project, company or place in the user's entity graph: who they are, how they're connected, and recent mentions.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "The entity name, e.g. 'Michaella'." },
          },
          required: ["name"],
        },
      },
    },
    handler: async (args) => {
      const name = str(args, "name");
      if (!name) return "ERROR: missing 'name'.";
      const profile = getEntityProfile(name);
      if (!profile) return `No entity named "${name}" is known yet.`;
      return formatEntityProfile(profile);
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "generate_document",
        description:
          "Generate a document from a prompt and save it to the user's Desktop. Supports md, txt, html, pdf, docx, doc, rtf, odt. Use for 'write/draft/create a … document/letter/report/proposal'. Returns the saved file path.",
        parameters: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "What the document should contain." },
            format: { type: "string", description: "One of: md, txt, html, pdf, docx, doc, rtf, odt. Default 'pdf'." },
            filename: { type: "string", description: "Optional base filename (no extension)." },
            context: {
              type: "string",
              description:
                "Optional source material to ground the document in (e.g. an email body or notes). Paste the raw text here.",
            },
          },
          required: ["prompt"],
        },
      },
    },
    handler: async (args) => {
      const prompt = str(args, "prompt");
      if (!prompt) return "ERROR: missing 'prompt'.";
      const fmt = (resolveFormat(str(args, "format") ?? "pdf") ?? "pdf") as DocFormat;
      const base = slugify(str(args, "filename") ?? prompt).slice(0, 60) || "janjak-document";
      const outPath = join(homedir(), "Desktop", `${base}.${fmt}`);
      const source = str(args, "context");
      try {
        const doc = await generateDocument({
          prompt,
          outPath,
          format: fmt,
          useContext: !source,
          source,
        });
        return `Saved document "${doc.title}" to ${doc.path}.`;
      } catch (err) {
        return `Failed to generate document: ${(err as Error).message}`;
      }
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the public web for up-to-date facts, news, prices, definitions or anything beyond the user's local data. Returns top results with titles, snippets and links. Use this when you need current or external information.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query." },
            max: { type: "number", description: "Max results to return (default 5)." },
          },
          required: ["query"],
        },
      },
    },
    handler: async (args) => {
      const query = str(args, "query");
      if (!query) return "ERROR: missing 'query'.";
      const results = await webSearch(query, num(args, "max") ?? 5);
      if (results.length === 0) return `No web results found for "${query}".`;
      return results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n${r.url}`)
        .join("\n\n");
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "list_workflows",
        description:
          "List the user's configured automation workflows (id, name, whether enabled) so one can be run by id.",
        parameters: { type: "object", properties: {} },
      },
    },
    handler: async () => {
      const wfs = getAllWorkflows();
      if (wfs.length === 0) return "No workflows configured.";
      const state = isWorkflowsEnabled() ? "enabled" : "DISABLED globally";
      const list = wfs
        .map((w) => `${w.id} — ${w.name} (${w.enabled ? "on" : "off"})${w.description ? `: ${w.description}` : ""}`)
        .join("\n");
      return `Workflows are ${state}.\n${list}`;
    },
  },

  {
    risk: "confirm",
    schema: {
      type: "function",
      function: {
        name: "run_workflow",
        description:
          "Run one of the user's configured automation workflows by its id (get ids from list_workflows). Returns the exit status and output.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "The workflow id to run." },
          },
          required: ["id"],
        },
      },
    },
    handler: async (args) => {
      const id = str(args, "id");
      if (!id) return "ERROR: missing 'id'.";
      const entry = await runWorkflowById(id);
      if (!entry) return `No workflow with id "${id}". Use list_workflows to see available ids.`;
      const out = (entry.stdout || entry.stderr || "").slice(0, 800);
      return `Workflow "${entry.workflowName}" ${entry.success ? "succeeded" : "failed"} (exit ${entry.exitCode}).${out ? `\n${out}` : ""}`;
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "resolve_contact",
        description:
          "Look up a person's email address by name, using the user's Gmail history and known contacts. Call this BEFORE draft_email/create_gmail_draft/send_email whenever you only have a name (not an email). Returns the best-matching addresses.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "The person's name to resolve (e.g. 'Marc', 'Marie Pierre')." },
          },
          required: ["name"],
        },
      },
    },
    handler: async (args) => {
      const name = str(args, "name");
      if (!name) return "ERROR: missing 'name'.";
      const matches = await resolveContact(name);
      if (matches.length === 0) {
        return `No email address found for "${name}". Ask the user for the address.`;
      }
      const top = matches
        .slice(0, 5)
        .map((m) => (m.name && m.name !== m.email ? `${m.name} <${m.email}>` : m.email))
        .join("; ");
      return matches.length === 1
        ? `Resolved "${name}" to ${top}.`
        : `Possible matches for "${name}" (most likely first): ${top}. Use the first unless the user meant another.`;
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "list_contacts",
        description:
          "List the user's contacts (people they email with), most frequent first, derived from recent Gmail. Use when the user asks 'who are my contacts', 'list my contacts', or wants to pick a recipient.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "How many contacts to return (default 15)." },
          },
        },
      },
    },
    handler: async (args) => {
      const limit = num(args, "limit") ?? 15;
      const contacts = await listContacts(limit);
      if (contacts.length === 0) {
        return "No contacts found. The user may need to connect Gmail with 'janjak login'.";
      }
      return contacts
        .map((c) => (c.name && c.name !== c.email ? `${c.name} <${c.email}>` : c.email))
        .join("; ");
    },
  },

  {
    risk: "confirm",
    schema: {
      type: "function",
      function: {
        name: "draft_email",
        description:
          "Compose an email and open it (pre-filled) in the user's mail app for review. This does NOT auto-send — the user reviews and hits send. Use to draft replies or new messages. If you only have a name, call resolve_contact first.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address." },
            subject: { type: "string", description: "Email subject line." },
            body: { type: "string", description: "The full email body you composed." },
          },
          required: ["to", "subject", "body"],
        },
      },
    },
    handler: async (args) => {
      const to = str(args, "to");
      const subject = str(args, "subject");
      const body = str(args, "body");
      if (!to || !subject || !body) return "ERROR: 'to', 'subject' and 'body' are all required.";
      try {
        openInEmailApp(to, subject, body);
        return `Opened a draft to ${to} ("${subject}") in the mail app. The user can review and send it.`;
      } catch (err) {
        return `Failed to open the mail app: ${(err as Error).message}`;
      }
    },
  },

  {
    risk: "confirm",
    schema: {
      type: "function",
      function: {
        name: "create_gmail_draft",
        description:
          "Save an email as a Gmail draft (server-side, appears in the user's Gmail Drafts on every device). Does NOT send — the user reviews and sends from Gmail. Prefer this over draft_email when the user wants the draft saved in Gmail. If you only have a name, call resolve_contact first.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address." },
            subject: { type: "string", description: "Email subject line." },
            body: { type: "string", description: "The full email body you composed." },
          },
          required: ["to", "subject", "body"],
        },
      },
    },
    handler: async (args) => {
      if (!isAuthenticated()) return "Gmail is not connected. The user should run 'janjak login'.";
      const to = str(args, "to");
      const subject = str(args, "subject");
      const body = str(args, "body");
      if (!to || !subject || !body) return "ERROR: 'to', 'subject' and 'body' are all required.";
      try {
        await createDraft(to, subject, body);
        return `Saved a Gmail draft to ${to} ("${subject}"). The user can review and send it from Gmail.`;
      } catch (err) {
        return (err as Error).message;
      }
    },
  },

  {
    risk: "confirm",
    schema: {
      type: "function",
      function: {
        name: "send_email",
        description:
          "Send an email immediately from the user's Gmail. This delivers the message right away — only use when the user clearly wants to SEND (not just draft). The recipient must be a real email address; resolve names with resolve_contact first if needed.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address." },
            subject: { type: "string", description: "Email subject line." },
            body: { type: "string", description: "The full email body you composed." },
          },
          required: ["to", "subject", "body"],
        },
      },
    },
    handler: async (args) => {
      if (!isAuthenticated()) return "Gmail is not connected. The user should run 'janjak login'.";
      const to = str(args, "to");
      const subject = str(args, "subject");
      const body = str(args, "body");
      if (!to || !subject || !body) return "ERROR: 'to', 'subject' and 'body' are all required.";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
        return `"${to}" is not a valid email address. Resolve the recipient first.`;
      }
      try {
        await sendEmail(to, subject, body);
        return `Sent an email to ${to} ("${subject}").`;
      } catch (err) {
        return (err as Error).message;
      }
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "save_note",
        description:
          "Remember something for the user — store a fact, preference, idea or reminder in Janjak's long-term memory so it can be recalled later. Use when the user says 'remember that…', 'note that…', or shares a durable fact.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "The note/fact to remember." },
          },
          required: ["text"],
        },
      },
    },
    handler: async (args) => {
      const text = str(args, "text");
      if (!text) return "ERROR: missing 'text'.";
      try {
        await capture({ type: "note", text, metadata: { source: "agent" }, importance: 0.7 });
        return `Noted. I'll remember: "${text}".`;
      } catch (err) {
        return `Failed to save the note: ${(err as Error).message}`;
      }
    },
  },

  {
    risk: "confirm",
    schema: {
      type: "function",
      function: {
        name: "write_file",
        description:
          "Write text content to a file. Relative paths are saved to the user's Desktop. Will NOT overwrite an existing file unless 'overwrite' is true. Use for saving notes, code, or generated text the user asked to keep.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path. Relative paths go to the Desktop." },
            content: { type: "string", description: "The text content to write." },
            overwrite: { type: "boolean", description: "Allow overwriting an existing file (default false)." },
          },
          required: ["path", "content"],
        },
      },
    },
    handler: async (args) => {
      const p = str(args, "path");
      const content = typeof args["content"] === "string" ? (args["content"] as string) : undefined;
      if (!p || content === undefined) return "ERROR: 'path' and 'content' are required.";
      const abs = resolveWritePath(p);
      if (!isWithinAllowedRoots(abs)) {
        return `For safety I can only write inside ${ALLOWED_WRITE_LABEL}. "${abs}" is outside those.`;
      }
      const overwrite = args["overwrite"] === true;
      if (existsSync(abs) && !overwrite) {
        return `A file already exists at ${abs}. Set overwrite=true to replace it.`;
      }
      try {
        const dir = resolve(abs, "..");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(abs, content);
        return `Wrote ${content.length} characters to ${abs}.`;
      } catch (err) {
        return `Failed to write file: ${(err as Error).message}`;
      }
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "list_directory",
        description:
          "List the files and folders in a directory. Relative paths are resolved from the user's home folder. Use to find files before reading or writing them.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Directory path. Relative paths resolve from the home folder. Defaults to the Desktop." },
          },
        },
      },
    },
    handler: async (args) => {
      const p = str(args, "path") ?? "Desktop";
      const abs = isAbsolute(p) ? p : join(homedir(), p);
      try {
        if (!existsSync(abs)) return `No such directory: ${abs}`;
        const entries = readdirSync(abs)
          .filter((n) => !n.startsWith("."))
          .slice(0, 100)
          .map((n) => {
            try {
              return statSync(join(abs, n)).isDirectory() ? `${n}/` : n;
            } catch {
              return n;
            }
          });
        if (entries.length === 0) return `${abs} is empty.`;
        return `${abs}:\n${entries.join("\n")}`;
      } catch (err) {
        return `Failed to list directory: ${(err as Error).message}`;
      }
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "open_app",
        description:
          "Open (launch or focus) a macOS application by name, e.g. 'Spotify', 'Calendar', 'Visual Studio Code', 'Notes'.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "The application name." },
          },
          required: ["name"],
        },
      },
    },
    handler: async (args) => {
      const name = str(args, "name");
      if (!name) return "ERROR: missing 'name'.";
      const r = spawnSync("open", ["-a", name], { timeout: 8000 });
      if (r.status === 0) return `Opened ${name}.`;
      return `Could not open "${name}". Is it installed? (${(r.stderr?.toString() || "").trim()})`;
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "open_url",
        description: "Open a web URL in the user's default browser. Only http(s) URLs are allowed.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The full http(s) URL to open." },
          },
          required: ["url"],
        },
      },
    },
    handler: async (args) => {
      const url = str(args, "url");
      if (!url) return "ERROR: missing 'url'.";
      if (!/^https?:\/\//i.test(url)) return "ERROR: only http(s) URLs are allowed.";
      const r = spawnSync("open", [url], { timeout: 8000 });
      return r.status === 0 ? `Opened ${url} in the browser.` : `Could not open the URL.`;
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "music_control",
        description:
          "Control Spotify playback: pause, resume, see the current track, or start a playlist tuned to an activity.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["pause", "resume", "current", "playlist"],
              description: "What to do.",
            },
            activity: {
              type: "string",
              description:
                "For action 'playlist': the mood/activity, e.g. 'coding', 'break', 'writing', 'designing'.",
            },
          },
          required: ["action"],
        },
      },
    },
    handler: async (args) => {
      const action = str(args, "action");
      switch (action) {
        case "pause":
          await pauseMusic();
          return "Paused music.";
        case "resume":
          await resumeMusic();
          return "Resumed music.";
        case "current": {
          const track = await getCurrentTrack();
          return track ? `Now playing: ${track}` : "Nothing is playing right now.";
        }
        case "playlist": {
          const activity = str(args, "activity") ?? "coding";
          const name = await playPlaylist(activity as ActivityState | "break");
          return name ? `Started the "${name}" playlist.` : `No playlist configured for "${activity}".`;
        }
        default:
          return "ERROR: action must be pause, resume, current, or playlist.";
      }
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "send_notification",
        description:
          "Show a macOS desktop notification to the user. Use for alerts, reminders firing now, or confirmations the user should see on screen.",
        parameters: {
          type: "object",
          properties: {
            message: { type: "string", description: "The notification body." },
            title: { type: "string", description: "Optional title (default 'Janjak')." },
          },
          required: ["message"],
        },
      },
    },
    handler: async (args) => {
      const message = str(args, "message");
      if (!message) return "ERROR: missing 'message'.";
      if (!notificationsAvailable()) return "Desktop notifications aren't available on this system.";
      sendNotification(message, str(args, "title") ?? "Janjak");
      return "Notification sent.";
    },
  },

  {
    schema: {
      type: "function",
      function: {
        name: "read_document",
        description:
          "Read and extract the text of a local file so it can be analyzed or summarized. Supports txt, md, csv, json, html, pdf, docx, doc, rtf, odt.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute path to the file." },
          },
          required: ["path"],
        },
      },
    },
    handler: async (args) => {
      const path = str(args, "path");
      if (!path) return "ERROR: missing 'path'.";
      try {
        const text = await readDocument(path);
        return text || "(The document appears to be empty.)";
      } catch (err) {
        return `Failed to read document: ${(err as Error).message}`;
      }
    },
  },
];

/** All registered agent tools. */
export function getAgentTools(): AgentTool[] {
  return tools;
}

/** OpenAI function schemas for every tool. */
export function getToolSchemas(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => t.schema);
}

/** Look up a tool by its function name. */
export function findTool(name: string): AgentTool | undefined {
  return tools.find((t) => t.schema.type === "function" && t.schema.function.name === name);
}

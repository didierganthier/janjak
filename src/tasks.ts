// ─── Task Manager: Orchestrates email → task pipeline ──────────────
import { fetchRecentEmails } from "./gmail-client.js";
import { parseEmailBatch, generateInboxSummary } from "./email-parser.js";
import { insertTask, getTasks, updateTaskStatus, isEmailProcessed, markEmailProcessed } from "./db.js";
import type { ExtractedTask, TaskStatus } from "./types.js";import { capture } from "./memory/recall.js";
export async function processInbox(): Promise<{
  summary: string;
  newTasks: ExtractedTask[];
  totalEmails: number;
}> {
  // Fetch recent unread emails
  const emails = await fetchRecentEmails(10);

  if (emails.length === 0) {
    return {
      summary: "📭 Inbox is clean. No unread emails to process.",
      newTasks: [],
      totalEmails: 0,
    };
  }

  // Filter out already-processed emails
  const unprocessed = emails.filter((e) => !isEmailProcessed(e.id));

  // Generate high-level summary of all recent emails
  const summary = await generateInboxSummary(emails);

  if (unprocessed.length === 0) {
    return {
      summary,
      newTasks: [],
      totalEmails: emails.length,
    };
  }

  // Parse unprocessed emails for tasks
  const parsed = await parseEmailBatch(unprocessed);

  const newTasks: ExtractedTask[] = [];

  for (const email of unprocessed) {
    const result = parsed.get(email.id);
    if (!result) continue;

    markEmailProcessed(email.id);

    if (!result.hasTasks || result.tasks.length === 0) continue;

    for (const task of result.tasks) {
      const extracted: ExtractedTask = {
        title: task.title,
        description: task.description,
        priority: task.priority,
        deadline: task.deadline,
        person: email.from.replace(/<.*>/, "").trim(),
        sourceEmailId: email.id,
        sourceSubject: email.subject,
        status: "pending",
        createdAt: Date.now(),
        suggestedReply: result.suggestedReply,
      };

      const id = insertTask(extracted);
      extracted.id = id;
      newTasks.push(extracted);

      // Best-effort: capture this task + its source email as a semantic memory.
      try {
        const memText = `Task from email: ${extracted.title}\nFrom: ${extracted.person}\nSubject: ${email.subject}\nPriority: ${extracted.priority}${extracted.deadline ? `\nDeadline: ${extracted.deadline}` : ""}${extracted.description ? `\n${extracted.description}` : ""}`;
        await capture({
          type: "task",
          text: memText,
          sourceId: String(id),
          metadata: { person: extracted.person, priority: extracted.priority, email_id: email.id },
          importance: extracted.priority === "high" ? 0.8 : 0.6,
        });
        await capture({
          type: "email",
          text: `From: ${email.from}\nSubject: ${email.subject}\n${(email.snippet ?? "").slice(0, 500)}`,
          sourceId: email.id,
          metadata: { from: email.from, subject: email.subject },
          importance: 0.5,
        });
      } catch {
        // ignore embedding failures
      }
    }
  }

  return { summary, newTasks, totalEmails: emails.length };
}

// ─── Display helpers ──────────────────────────────────────────────

const PRIORITY_ICON: Record<string, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};

const STATUS_ICON: Record<string, string> = {
  pending: "⬜",
  "in-progress": "🔷",
  done: "✅",
  dismissed: "⬛",
};

export function formatTaskList(tasks: ExtractedTask[]): string {
  if (tasks.length === 0) {
    return "  No tasks. Inbox zero achieved. 🏆";
  }

  let output = "";
  for (const task of tasks) {
    const pri = PRIORITY_ICON[task.priority] ?? "⚪";
    const status = STATUS_ICON[task.status] ?? "⬜";
    const deadline = task.deadline ? ` (due ${task.deadline})` : "";
    const person = task.person ? ` — from ${task.person}` : "";

    output += `  ${status} ${pri} #${task.id} ${task.title}${deadline}${person}\n`;
    if (task.description) {
      output += `       ${task.description}\n`;
    }
  }

  return output;
}

export function formatInboxReport(
  summary: string,
  newTasks: ExtractedTask[],
  totalEmails: number
): string {
  let output = "\n📬 Inbox Briefing\n";
  output += "─".repeat(40) + "\n\n";
  output += summary + "\n\n";

  if (newTasks.length > 0) {
    output += `⚡ ${newTasks.length} new task${newTasks.length > 1 ? "s" : ""} extracted:\n\n`;
    output += formatTaskList(newTasks);
  } else {
    output += "  No new actionable tasks found.\n";
  }

  output += "\n" + "─".repeat(40);
  output += `\n  ${totalEmails} emails scanned | Use: janjak tasks`;

  return output;
}

export function formatAllTasks(): string {
  const pending = getTasks("pending");
  const inProgress = getTasks("in-progress");

  let output = "\n📋 Tasks\n";
  output += "─".repeat(40) + "\n";

  if (inProgress.length > 0) {
    output += "\n  🔷 In Progress:\n";
    output += formatTaskList(inProgress);
  }

  if (pending.length > 0) {
    output += "\n  ⬜ Pending:\n";
    output += formatTaskList(pending);
  }

  if (pending.length === 0 && inProgress.length === 0) {
    output += "\n  No active tasks. Run `janjak inbox` to scan emails.\n";
  }

  output += "\n" + "─".repeat(40);
  output += "\n  janjak done <id> | janjak dismiss <id> | janjak start <id>";

  return output;
}

export { getTasks, updateTaskStatus };

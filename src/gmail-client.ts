// ─── Gmail Client: Fetches and parses recent emails ────────────────
import { gmail as gmailApi } from "@googleapis/gmail";
import { getAuthenticatedClient } from "./gmail-auth.js";
import type { EmailMessage } from "./types.js";

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function extractBody(payload: any): string {
  // Simple text body
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart — look for text/plain first, then text/html
  if (payload.parts) {
    // Try text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // Fallback to text/html (strip tags)
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = decodeBase64Url(part.body.data);
        return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
    // Recursive for nested multipart
    for (const part of payload.parts) {
      if (part.parts) {
        const result = extractBody(part);
        if (result) return result;
      }
    }
  }

  return "";
}

function getHeader(headers: Array<{ name?: string | null; value?: string | null }>, name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function fetchRecentEmails(maxResults = 15): Promise<EmailMessage[]> {
  const auth = await getAuthenticatedClient();
  const gmail = gmailApi({ version: "v1", auth });

  // Fetch recent messages from inbox
  const listRes = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: "in:inbox is:unread category:primary",
  });

  const messageIds = listRes.data.messages ?? [];
  if (messageIds.length === 0) return [];

  // Fetch full message details in parallel (batched)
  const emails: EmailMessage[] = [];

  for (const msg of messageIds) {
    if (!msg.id) continue;

    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "full",
    });

    const headers = detail.data.payload?.headers ?? [];
    const body = extractBody(detail.data.payload ?? {});

    // Truncate body to avoid sending huge emails to OpenAI
    const truncatedBody = body.length > 2000 ? body.slice(0, 2000) + "..." : body;

    emails.push({
      id: msg.id,
      threadId: detail.data.threadId ?? "",
      from: getHeader(headers, "From"),
      subject: getHeader(headers, "Subject"),
      snippet: detail.data.snippet ?? "",
      body: truncatedBody,
      date: Number(detail.data.internalDate ?? 0),
      labels: detail.data.labelIds ?? [],
    });
  }

  // Sort by date, newest first
  emails.sort((a, b) => b.date - a.date);
  return emails;
}

export async function getEmailSummary(): Promise<{
  unreadCount: number;
  emails: EmailMessage[];
}> {
  const auth = await getAuthenticatedClient();
  const gmail = gmailApi({ version: "v1", auth });

  // Get unread count
  const profileRes = await gmail.users.getProfile({ userId: "me" });
  const unreadCount = profileRes.data.messagesTotal ?? 0;

  // Fetch recent emails
  const emails = await fetchRecentEmails(10);

  return { unreadCount, emails };
}

/**
 * Search the mailbox using Gmail's query syntax (e.g. `from:sarah launch`,
 * `subject:invoice`, `newer_than:7d`). Returns full email bodies (kept long
 * enough to use as source material), newest first. Unlike fetchRecentEmails,
 * this searches read mail and all categories.
 */
export async function searchEmails(query: string, maxResults = 5): Promise<EmailMessage[]> {
  const auth = await getAuthenticatedClient();
  const gmail = gmailApi({ version: "v1", auth });

  const listRes = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: query,
  });

  const messageIds = listRes.data.messages ?? [];
  if (messageIds.length === 0) return [];

  const emails: EmailMessage[] = [];
  for (const msg of messageIds) {
    if (!msg.id) continue;

    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "full",
    });

    const headers = detail.data.payload?.headers ?? [];
    const body = extractBody(detail.data.payload ?? {});
    // Keep more of the body than the inbox scan — this is source material.
    const truncatedBody = body.length > 8000 ? body.slice(0, 8000) + "..." : body;

    emails.push({
      id: msg.id,
      threadId: detail.data.threadId ?? "",
      from: getHeader(headers, "From"),
      subject: getHeader(headers, "Subject"),
      snippet: detail.data.snippet ?? "",
      body: truncatedBody,
      date: Number(detail.data.internalDate ?? 0),
      labels: detail.data.labelIds ?? [],
    });
  }

  emails.sort((a, b) => b.date - a.date);
  return emails;
}

/** Fetch a single email by its Gmail message id (any folder/read state). */
export async function getEmailById(id: string): Promise<EmailMessage | null> {
  const auth = await getAuthenticatedClient();
  const gmail = gmailApi({ version: "v1", auth });
  try {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });
    const headers = detail.data.payload?.headers ?? [];
    const body = extractBody(detail.data.payload ?? {});
    const truncatedBody = body.length > 8000 ? body.slice(0, 8000) + "..." : body;
    return {
      id,
      threadId: detail.data.threadId ?? "",
      from: getHeader(headers, "From"),
      subject: getHeader(headers, "Subject"),
      snippet: detail.data.snippet ?? "",
      body: truncatedBody,
      date: Number(detail.data.internalDate ?? 0),
      labels: detail.data.labelIds ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Create a Gmail draft (saved server-side in the user's Drafts). Does NOT send.
 * Requires the gmail.compose scope — throws a helpful error if not granted yet.
 */
export async function createDraft(
  to: string,
  subject: string,
  body: string
): Promise<{ id: string }> {
  const auth = await getAuthenticatedClient();
  const gmail = gmailApi({ version: "v1", auth });

  const headerSubject = /[^\x00-\x7F]/.test(subject)
    ? `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`
    : subject;

  const raw = [
    `To: ${to}`,
    `Subject: ${headerSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");
  const encoded = Buffer.from(raw, "utf-8").toString("base64url");

  try {
    const res = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw: encoded } },
    });
    return { id: res.data.id ?? "" };
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (/insufficient|scope|permission|forbidden|403/i.test(msg)) {
      throw new Error(
        "Gmail draft permission not granted yet. Re-run 'janjak login' to allow Janjak to compose drafts."
      );
    }
    throw err;
  }
}

// ─── Gmail Client: Fetches and parses recent emails ────────────────
import { google } from "googleapis";
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
  const gmail = google.gmail({ version: "v1", auth });

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
  const gmail = google.gmail({ version: "v1", auth });

  // Get unread count
  const profileRes = await gmail.users.getProfile({ userId: "me" });
  const unreadCount = profileRes.data.messagesTotal ?? 0;

  // Fetch recent emails
  const emails = await fetchRecentEmails(10);

  return { unreadCount, emails };
}

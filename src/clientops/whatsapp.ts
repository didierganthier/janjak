// ─── Janjak ClientOps — WhatsApp import (Phase 5) ───────────────────
// Parses a WhatsApp chat export (.txt) and files it under a client:
// logs the transcript as a note and (optionally, with --ai) extracts
// action items into pending follow-ups. Local + idempotent.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import type { Client, ClientProject } from "./types.js";
import { createNote, noteExistsBySourceRef } from "./notes.js";
import { createFollowup, listFollowups } from "./followups.js";

export interface WhatsAppMessage {
  rawTimestamp: string;
  timestamp: Date | null;
  sender: string;
  text: string;
}

// iOS:     [2/14/25, 3:45:12 PM] Keron: message
// Android: 2/14/25, 3:45 PM - Keron: message
const IOS_HEADER = /^\u200e?\[(.+?)\]\s([^:]+?):\s([\s\S]*)$/;
const ANDROID_HEADER = /^(\d{1,2}[/.]\d{1,2}[/.]\d{2,4},\s\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\s-\s([^:]+?):\s([\s\S]*)$/;

function toDate(raw: string): Date | null {
  const cleaned = raw.replace(/[\u200e\u202f]/g, " ").trim();
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse a WhatsApp export into structured messages (iOS + Android formats). */
export function parseWhatsAppExport(content: string): WhatsAppMessage[] {
  const lines = content.split(/\r?\n/);
  const messages: WhatsAppMessage[] = [];
  let current: WhatsAppMessage | null = null;

  const push = () => {
    if (current) {
      current.text = current.text.trim();
      messages.push(current);
    }
  };

  for (const line of lines) {
    const ios = line.match(IOS_HEADER);
    const android = ios ? null : line.match(ANDROID_HEADER);
    const m = ios ?? android;
    if (m) {
      push();
      const rawTimestamp = (m[1] ?? "").trim();
      current = {
        rawTimestamp,
        timestamp: toDate(rawTimestamp),
        sender: (m[2] ?? "").replace(/[\u200e\u202f]/g, "").trim(),
        text: m[3] ?? "",
      };
    } else if (current) {
      // continuation of the previous message
      current.text += "\n" + line;
    }
    // lines before the first header (e.g. system banners) are ignored
  }
  push();

  // Drop obvious system messages (no real sender text).
  return messages.filter((msg) => msg.sender && msg.text);
}

function dateRange(messages: WhatsAppMessage[]): string {
  const dated = messages.map((m) => m.timestamp).filter((d): d is Date => d != null);
  if (dated.length === 0) return "unknown dates";
  const min = new Date(Math.min(...dated.map((d) => d.getTime())));
  const max = new Date(Math.max(...dated.map((d) => d.getTime())));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return min.getTime() === max.getTime() ? fmt(min) : `${fmt(min)} → ${fmt(max)}`;
}

/** Build a plain transcript (sender: text), newest last. */
export function buildTranscript(messages: WhatsAppMessage[], max = 60): string {
  return messages
    .slice(-max)
    .map((m) => `${m.sender}: ${m.text.replace(/\n/g, " ")}`)
    .join("\n");
}

export interface WhatsAppImportResult {
  messageCount: number;
  range: string;
  senders: string[];
  noteCreated: boolean;
  followupsCreated: number;
  transcript: string;
}

export interface WhatsAppImportOptions {
  client: Client;
  project?: ClientProject | null;
  filePath: string;
}

/** Read + parse a WhatsApp export file and log it under the client. */
export function importWhatsAppFile(opts: WhatsAppImportOptions): WhatsAppImportResult {
  const content = readFileSync(opts.filePath, "utf-8");
  const messages = parseWhatsAppExport(content);
  const range = dateRange(messages);
  const senders = [...new Set(messages.map((m) => m.sender))];
  const transcript = buildTranscript(messages);

  const hash = createHash("sha1")
    .update(`${opts.client.id}:${content}`)
    .digest("hex")
    .slice(0, 12);
  const sourceRef = `whatsapp:${hash}`;

  let noteCreated = false;
  if (messages.length > 0 && !noteExistsBySourceRef(sourceRef)) {
    createNote({
      projectId: opts.project?.id ?? null,
      clientId: opts.client.id,
      title: `WhatsApp chat (${range})`,
      body: transcript.slice(0, 4000),
      source: "whatsapp",
      noteType: "client_message",
      sourceRef,
    });
    noteCreated = true;
  }

  return {
    messageCount: messages.length,
    range,
    senders,
    noteCreated,
    followupsCreated: 0,
    transcript,
  };
}

/** Create pending follow-ups from AI-extracted action items (deduped by title). */
export function saveExtractedFollowups(
  client: Client,
  project: ClientProject | null,
  items: Array<{ title: string; dueDate: string | null }>,
): number {
  const existing = new Set(
    listFollowups({ clientId: client.id, includeResolved: true }).map((f) =>
      f.title.trim().toLowerCase(),
    ),
  );
  let created = 0;
  for (const item of items) {
    const title = item.title.trim();
    if (!title || existing.has(title.toLowerCase())) continue;
    createFollowup({
      clientId: client.id,
      projectId: project?.id ?? null,
      title,
      dueDate: item.dueDate,
      channel: "whatsapp",
    });
    existing.add(title.toLowerCase());
    created++;
  }
  return created;
}

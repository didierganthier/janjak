// ─── Contacts: resolve a person's name to an email address ────────
// Names are resolved primarily from the user's own Gmail history (the
// From headers of mail they've received) and secondarily from any email
// stored on a knowledge-graph entity. This unblocks "email Marc …" style
// requests so the agent can fill send_email / draft tools with a real
// address instead of a bare name.

import { searchEmails, fetchHeaderValues, getOwnEmail } from "./gmail-client.js";
import { isAuthenticated } from "./gmail-auth.js";
import { getEntityProfile } from "./graph/query.js";

export interface ContactMatch {
  /** Display name as seen in mail / graph (best effort). */
  name: string;
  email: string;
  /** Higher = more confident. */
  score: number;
  source: "graph" | "email";
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

/** Parse a From/To header value like `Marc Doe <marc@x.com>` → { name, email }. */
export function parseAddress(header: string): { name: string; email: string } | null {
  const angle = header.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angle) {
    const email = angle[2]!.trim();
    if (looksLikeEmail(email)) return { name: angle[1]!.trim(), email: email.toLowerCase() };
  }
  const bare = header.match(EMAIL_RE);
  if (bare) return { name: "", email: bare[0].toLowerCase() };
  return null;
}

/** Parse a header that may contain several comma-separated addresses. */
export function parseAddressList(header: string): Array<{ name: string; email: string }> {
  // Split on commas that aren't inside a quoted display name.
  const parts = header.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const out: Array<{ name: string; email: string }> = [];
  for (const part of parts) {
    const parsed = parseAddress(part.trim());
    if (parsed) out.push(parsed);
  }
  return out;
}

function nameMatches(query: string, displayName: string): boolean {
  const q = query.trim().toLowerCase();
  const d = displayName.trim().toLowerCase();
  if (!q || !d) return false;
  if (d.includes(q)) return true;
  // every token of the query appears in the display name
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => d.includes(t));
}

/**
 * Resolve a contact name to candidate email addresses, best match first.
 * If `query` already is an email, it is returned verbatim.
 */
export async function resolveContact(query: string): Promise<ContactMatch[]> {
  const trimmed = query.trim();
  if (looksLikeEmail(trimmed)) {
    return [{ name: trimmed, email: trimmed.toLowerCase(), score: Infinity, source: "email" }];
  }

  const byEmail = new Map<string, ContactMatch>();

  // 1) Knowledge-graph entity attribute (e.g. attributes.email).
  try {
    const profile = getEntityProfile(trimmed);
    const attrEmail = profile?.entity.attributes?.["email"];
    if (typeof attrEmail === "string" && looksLikeEmail(attrEmail)) {
      byEmail.set(attrEmail.toLowerCase(), {
        name: profile!.entity.name,
        email: attrEmail.toLowerCase(),
        score: 1000,
        source: "graph",
      });
    }
  } catch {
    /* graph lookup is best-effort */
  }

  // 2) Gmail From headers — rank by how often this person mailed the user.
  if (isAuthenticated()) {
    try {
      const messages = await searchEmails(`from:${trimmed}`, 15);
      for (const msg of messages) {
        const parsed = parseAddress(msg.from);
        if (!parsed) continue;
        const display = parsed.name || parsed.email;
        if (!nameMatches(trimmed, display)) continue;
        const existing = byEmail.get(parsed.email);
        if (existing) {
          existing.score += 1;
          if (!existing.name && parsed.name) existing.name = parsed.name;
        } else {
          byEmail.set(parsed.email, {
            name: parsed.name || trimmed,
            email: parsed.email,
            score: 1,
            source: "email",
          });
        }
      }
    } catch {
      /* gmail search is best-effort */
    }

    // 3) People the user has SENT mail to (strong real-correspondent signal).
    try {
      const toHeaders = await fetchHeaderValues(`in:sent to:${trimmed}`, "To", 20);
      for (const header of toHeaders) {
        for (const parsed of parseAddressList(header)) {
          const display = parsed.name || parsed.email;
          if (!nameMatches(trimmed, display)) continue;
          const existing = byEmail.get(parsed.email);
          if (existing) {
            existing.score += 5;
            if ((!existing.name || existing.name === trimmed) && parsed.name) existing.name = parsed.name;
          } else {
            byEmail.set(parsed.email, {
              name: parsed.name || trimmed,
              email: parsed.email,
              score: 5,
              source: "email",
            });
          }
        }
      }
    } catch {
      /* sent lookup is best-effort */
    }
  }

  return [...byEmail.values()].sort((a, b) => b.score - a.score);
}

/** A person in the derived address book. */
export interface Contact {
  name: string;
  email: string;
  /** Times you received from this address. */
  received: number;
  /** Times you sent to this address (strong "real person" signal). */
  sent: number;
  /** Total interactions (received + sent). */
  count: number;
}

// Addresses that are almost never real people worth listing.
const NOISE_RE = /(no-?reply|do-?not-?reply|notifications?|mailer|postmaster|bounce|newsletter|invitations?@|jobs?@|store-news|marketing@|updates?@|alerts?@|news@|email@|team@|hello@|contact@|support@|info@|account|billing@)/i;

interface ContactAgg extends Contact {
  score: number;
}

/**
 * Build an address book that prioritises real people. People you've *sent* mail
 * to count far more than inbound senders (which are dominated by newsletters),
 * obvious automated addresses are filtered, and your own address is excluded.
 * `scan` controls how many recent messages to inspect per mailbox.
 */
export async function listContacts(limit = 25, scan = 250): Promise<Contact[]> {
  if (!isAuthenticated()) return [];

  let sentTo: string[] = [];
  let receivedFrom: string[] = [];
  let own = "";
  try {
    [sentTo, receivedFrom, own] = await Promise.all([
      fetchHeaderValues("in:sent", "To", scan),
      fetchHeaderValues("-in:chats -in:sent", "From", scan),
      getOwnEmail(),
    ]);
  } catch {
    return [];
  }

  const byEmail = new Map<string, ContactAgg>();
  const bump = (
    header: string,
    kind: "sent" | "received",
    weight: number,
    multi: boolean
  ): void => {
    const entries = multi ? parseAddressList(header) : (parseAddress(header) ? [parseAddress(header)!] : []);
    for (const parsed of entries) {
      if (parsed.email === own) continue;
      if (NOISE_RE.test(parsed.email)) continue;
      const existing = byEmail.get(parsed.email);
      if (existing) {
        existing.score += weight;
        existing[kind] += 1;
        existing.count += 1;
        if ((!existing.name || existing.name === existing.email) && parsed.name) existing.name = parsed.name;
      } else {
        byEmail.set(parsed.email, {
          name: parsed.name || parsed.email,
          email: parsed.email,
          received: kind === "received" ? 1 : 0,
          sent: kind === "sent" ? 1 : 0,
          count: 1,
          score: weight,
        });
      }
    }
  };

  // Sent recipients are the strongest signal of a real correspondent.
  for (const h of sentTo) bump(h, "sent", 6, true);
  for (const h of receivedFrom) bump(h, "received", 1, false);

  return [...byEmail.values()]
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, limit)
    .map(({ score: _score, ...c }) => c);
}

/** Render a contact list for display. */
export function formatContacts(contacts: Contact[]): string {
  if (contacts.length === 0) {
    return "No contacts found. Connect Gmail with 'janjak login' first.";
  }
  const lines = contacts.map((c, i) => {
    const label = c.name && c.name !== c.email ? `${c.name} <${c.email}>` : c.email;
    const parts: string[] = [];
    if (c.sent > 0) parts.push(`${c.sent} sent`);
    if (c.received > 0) parts.push(`${c.received} received`);
    const tag = parts.length ? `  (${parts.join(", ")})` : "";
    return `  ${String(i + 1).padStart(2, " ")}. ${label}${tag}`;
  });
  return `📇 Contacts (people you correspond with first)\n${lines.join("\n")}`;
}

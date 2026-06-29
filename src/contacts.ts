// ─── Contacts: resolve a person's name to an email address ────────
// Names are resolved primarily from the user's own Gmail history (the
// From headers of mail they've received) and secondarily from any email
// stored on a knowledge-graph entity. This unblocks "email Marc …" style
// requests so the agent can fill send_email / draft tools with a real
// address instead of a bare name.

import { searchEmails } from "./gmail-client.js";
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
  }

  return [...byEmail.values()].sort((a, b) => b.score - a.score);
}

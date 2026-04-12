// ─── Browser Tracker: Detect open tabs & track site usage ──────────
// Reads open browser tabs via macOS AppleScript and categorises them.
// The monitor polls this every tick to build a per-domain usage profile.

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "./db.js";

// ─── Site Categories ────────────────────────────────────────────

interface SiteCategory {
  label: string;
  emoji: string;
  domains: string[];
}

const SITE_CATEGORIES: SiteCategory[] = [
  { label: "Social Media", emoji: "📱", domains: ["instagram.com", "twitter.com", "x.com", "facebook.com", "tiktok.com", "reddit.com", "threads.net", "linkedin.com", "snapchat.com"] },
  { label: "Entertainment", emoji: "🎬", domains: ["youtube.com", "netflix.com", "twitch.tv", "hulu.com", "disneyplus.com", "hbomax.com", "primevideo.com", "crunchyroll.com", "spotify.com"] },
  { label: "Dev / Code", emoji: "💻", domains: ["github.com", "gitlab.com", "stackoverflow.com", "npmjs.com", "docs.rs", "developer.mozilla.org", "dev.to", "hackernews.ycombinator.com", "news.ycombinator.com", "crates.io", "pypi.org", "bitbucket.org", "console.cloud.google.com", "vercel.com", "netlify.com", "heroku.com", "render.com", "railway.app", "supabase.com", "firebase.google.com"] },
  { label: "Learning", emoji: "📚", domains: ["coursera.org", "udemy.com", "leetcode.com", "codecademy.com", "khanacademy.org", "edx.org", "freecodecamp.org", "pluralsight.com", "skillshare.com", "scrimba.com", "frontendmasters.com", "egghead.io", "exercism.org"] },
  { label: "Communication", emoji: "💬", domains: ["slack.com", "discord.com", "teams.microsoft.com", "web.whatsapp.com", "telegram.org", "messenger.com"] },
  { label: "Email", emoji: "📧", domains: ["mail.google.com", "outlook.live.com", "outlook.office.com", "mail.yahoo.com", "protonmail.com"] },
  { label: "Reading", emoji: "📖", domains: ["medium.com", "substack.com", "notion.so", "wikipedia.org"] },
  { label: "Meetings", emoji: "📹", domains: ["meet.google.com", "zoom.us", "teams.microsoft.com"] },
  { label: "Shopping", emoji: "🛒", domains: ["amazon.com", "ebay.com", "etsy.com", "walmart.com", "shopify.com"] },
  { label: "AI Tools", emoji: "🤖", domains: ["chat.openai.com", "chatgpt.com", "claude.ai", "bard.google.com", "perplexity.ai", "copilot.microsoft.com"] },
];

export interface BrowserTab {
  browser: string;
  url: string;
  title: string;
  domain: string;
}

export interface SiteUsage {
  domain: string;
  category: string;
  emoji: string;
  totalMinutes: number;
  visits: number;
}

// ─── Tab Detection ──────────────────────────────────────────────

function getTabsFromBrowser(browser: string, processName: string): BrowserTab[] {
  try {
    // First check if browser is running
    const checkScript = `tell application "System Events" to return exists process "${processName}"`;
    const running = execSync(`osascript -e '${checkScript}'`, {
      timeout: 2000,
      encoding: "utf-8",
    }).trim();
    if (running !== "true") return [];

    // Write AppleScript to a temp file to avoid shell escaping issues
    const script = browser === "Arc"
      ? `tell application "Arc"
set allInfo to ""
repeat with w in windows
repeat with t in tabs of w
try
set tabUrl to URL of t
set tabTitle to title of t
set allInfo to allInfo & tabUrl & "|||" & tabTitle & linefeed
end try
end repeat
end repeat
return allInfo
end tell`
      : `tell application "${browser}"
set allInfo to ""
repeat with w in windows
repeat with t in tabs of w
try
set tabUrl to URL of t
set tabTitle to title of t
set allInfo to allInfo & tabUrl & "|||" & tabTitle & linefeed
end try
end repeat
end repeat
return allInfo
end tell`;

    const tmpFile = join(tmpdir(), `janjak-tabs-${browser.replace(/\s/g, "")}.scpt`);
    writeFileSync(tmpFile, script, "utf-8");

    let output: string;
    try {
      output = execSync(`osascript ${JSON.stringify(tmpFile)}`, {
        timeout: 5000,
        encoding: "utf-8",
      });
    } finally {
      try { unlinkSync(tmpFile); } catch { /* best effort cleanup */ }
    }

    const tabs: BrowserTab[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line.includes("|||")) continue;
      const [url, title] = line.split("|||");
      if (!url) continue;
      try {
        const parsed = new URL(url);
        tabs.push({
          browser,
          url: url.trim(),
          title: (title ?? "").trim(),
          domain: parsed.hostname.replace(/^www\./, ""),
        });
      } catch { /* skip non-URLs (about:blank, chrome://, etc.) */ }
    }
    return tabs;
  } catch {
    return [];
  }
}

/** Get all currently open browser tabs across Chrome, Safari, and Arc */
export function getOpenTabs(): BrowserTab[] {
  const browsers: Array<[string, string]> = [
    ["Google Chrome", "Google Chrome"],
    ["Safari", "Safari"],
    ["Arc", "Arc"],
  ];

  const allTabs: BrowserTab[] = [];
  for (const [browser, processName] of browsers) {
    allTabs.push(...getTabsFromBrowser(browser, processName));
  }
  return allTabs;
}

/** Check if a specific URL/domain is currently open */
export function isUrlOpen(urlOrDomain: string): boolean {
  const tabs = getOpenTabs();
  return tabs.some(t => t.url.includes(urlOrDomain) || t.domain.includes(urlOrDomain));
}

/** Categorise a domain */
export function categoriseDomain(domain: string): { label: string; emoji: string } {
  for (const cat of SITE_CATEGORIES) {
    if (cat.domains.some(d => domain === d || domain.endsWith("." + d))) {
      return { label: cat.label, emoji: cat.emoji };
    }
  }
  return { label: "Other", emoji: "🌐" };
}

// ─── DB: Browser Usage Table ────────────────────────────────────

export function initBrowserTable(): void {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS browser_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      domain TEXT NOT NULL,
      category TEXT NOT NULL,
      duration_seconds REAL NOT NULL,
      tab_count INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_browser_usage_ts ON browser_usage(timestamp);
    CREATE INDEX IF NOT EXISTS idx_browser_usage_domain ON browser_usage(domain);
  `);
}

/** Record a browser usage snapshot (called every poll tick) */
export function recordBrowserSnapshot(tabs: BrowserTab[], intervalSeconds: number): void {
  initBrowserTable();
  if (tabs.length === 0) return;

  const d = getDb();
  const now = Date.now();

  // Count tabs per domain
  const domainCounts = new Map<string, number>();
  for (const tab of tabs) {
    domainCounts.set(tab.domain, (domainCounts.get(tab.domain) ?? 0) + 1);
  }

  const stmt = d.prepare(
    "INSERT INTO browser_usage (timestamp, domain, category, duration_seconds, tab_count) VALUES (?, ?, ?, ?, ?)"
  );

  const insertMany = d.transaction(() => {
    for (const [domain, count] of domainCounts) {
      const { label } = categoriseDomain(domain);
      // Each open tab = duration_seconds of time attributed
      stmt.run(now, domain, label, intervalSeconds, count);
    }
  });
  insertMany();
}

// ─── Queries ────────────────────────────────────────────────────

export function getTodayBrowserStats(): {
  totalMinutes: number;
  byCategory: Record<string, number>;
  topSites: SiteUsage[];
} {
  initBrowserTable();
  const d = getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // By category
  const catRows = d.prepare(`
    SELECT category, SUM(duration_seconds) / 60.0 as minutes
    FROM browser_usage
    WHERE timestamp >= ?
    GROUP BY category
    ORDER BY minutes DESC
  `).all(startOfDay.getTime()) as Array<{ category: string; minutes: number }>;

  const byCategory: Record<string, number> = {};
  let totalMinutes = 0;
  for (const row of catRows) {
    const rounded = Math.round(row.minutes);
    if (rounded > 0) {
      byCategory[row.category] = rounded;
      totalMinutes += rounded;
    }
  }

  // Top sites
  const siteRows = d.prepare(`
    SELECT domain, category, SUM(duration_seconds) / 60.0 as minutes, COUNT(*) as visits
    FROM browser_usage
    WHERE timestamp >= ?
    GROUP BY domain
    ORDER BY minutes DESC
    LIMIT 15
  `).all(startOfDay.getTime()) as Array<{ domain: string; category: string; minutes: number; visits: number }>;

  const topSites: SiteUsage[] = siteRows
    .filter(r => Math.round(r.minutes) > 0)
    .map(r => {
      const { emoji } = categoriseDomain(r.domain);
      return {
        domain: r.domain,
        category: r.category,
        emoji,
        totalMinutes: Math.round(r.minutes),
        visits: r.visits,
      };
    });

  return { totalMinutes, byCategory, topSites };
}

export function getBrowserStatsByRange(fromTs: number, toTs: number): {
  totalMinutes: number;
  byCategory: Record<string, number>;
  topSites: SiteUsage[];
} {
  initBrowserTable();
  const d = getDb();

  const catRows = d.prepare(`
    SELECT category, SUM(duration_seconds) / 60.0 as minutes
    FROM browser_usage
    WHERE timestamp >= ? AND timestamp < ?
    GROUP BY category
    ORDER BY minutes DESC
  `).all(fromTs, toTs) as Array<{ category: string; minutes: number }>;

  const byCategory: Record<string, number> = {};
  let totalMinutes = 0;
  for (const row of catRows) {
    const rounded = Math.round(row.minutes);
    if (rounded > 0) {
      byCategory[row.category] = rounded;
      totalMinutes += rounded;
    }
  }

  const siteRows = d.prepare(`
    SELECT domain, category, SUM(duration_seconds) / 60.0 as minutes, COUNT(*) as visits
    FROM browser_usage
    WHERE timestamp >= ? AND timestamp < ?
    GROUP BY domain
    ORDER BY minutes DESC
    LIMIT 15
  `).all(fromTs, toTs) as Array<{ domain: string; category: string; minutes: number; visits: number }>;

  const topSites: SiteUsage[] = siteRows
    .filter(r => Math.round(r.minutes) > 0)
    .map(r => {
      const { emoji } = categoriseDomain(r.domain);
      return { domain: r.domain, category: r.category, emoji, totalMinutes: Math.round(r.minutes), visits: r.visits };
    });

  return { totalMinutes, byCategory, topSites };
}

// ─── Formatted Reports ─────────────────────────────────────────

export function formatBrowserReport(): string {
  const stats = getTodayBrowserStats();

  if (stats.totalMinutes === 0) {
    return "\n🌐 Browser Tracking\n\n  No browser activity recorded yet.\n  Run `janjak watch` to start tracking.\n";
  }

  let output = "\n🌐 Browser Usage Today\n";
  output += `${"─".repeat(45)}\n`;

  // Category breakdown
  output += "\n  By Category:\n";
  const catEntries = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);
  for (const [category, minutes] of catEntries) {
    const cat = SITE_CATEGORIES.find(c => c.label === category);
    const emoji = cat?.emoji ?? "🌐";
    const bar = "█".repeat(Math.max(1, Math.round(minutes / 3)));
    const pct = Math.round((minutes / stats.totalMinutes) * 100);
    output += `    ${emoji} ${category.padEnd(16)} ${bar} ${minutes}m (${pct}%)\n`;
  }

  // Top sites
  output += "\n  Top Sites:\n";
  for (const site of stats.topSites.slice(0, 10)) {
    const pct = Math.round((site.totalMinutes / stats.totalMinutes) * 100);
    output += `    ${site.emoji} ${site.domain.padEnd(28)} ${site.totalMinutes}m (${pct}%)\n`;
  }

  output += `\n  Total browser time: ${stats.totalMinutes} min\n`;

  // Quick insight
  const socialTime = stats.byCategory["Social Media"] ?? 0;
  const entertainmentTime = stats.byCategory["Entertainment"] ?? 0;
  const distractionTime = socialTime + entertainmentTime;
  if (distractionTime > 30) {
    output += `\n  ⚠️  ${distractionTime}m on social media + entertainment today.\n`;
  }

  const devTime = stats.byCategory["Dev / Code"] ?? 0;
  if (devTime > 0) {
    output += `  💡 ${devTime}m on dev/code sites.\n`;
  }

  return output;
}

/** Short summary for inclusion in `janjak day` and `janjak status` */
export function formatBrowserSummary(): string {
  const stats = getTodayBrowserStats();
  if (stats.totalMinutes === 0) return "";

  const parts: string[] = [];
  const catEntries = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);

  for (const [category, minutes] of catEntries.slice(0, 4)) {
    const cat = SITE_CATEGORIES.find(c => c.label === category);
    const emoji = cat?.emoji ?? "🌐";
    parts.push(`${emoji} ${category}: ${minutes}m`);
  }

  if (parts.length === 0) return "";

  let summary = `\n  🌐 Browser: ${parts.join("  |  ")}`;

  const socialTime = stats.byCategory["Social Media"] ?? 0;
  const entertainmentTime = stats.byCategory["Entertainment"] ?? 0;
  if (socialTime + entertainmentTime > 30) {
    summary += `  ⚠️`;
  }

  return summary;
}

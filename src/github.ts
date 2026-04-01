// ─── GitHub Integration ─────────────────────────────────────────────
// Fetches PRs, issues, and review requests from GitHub using a
// personal access token. Token stored in ~/.janjak/.env as GITHUB_TOKEN.
// Also detects the current repo from VS Code project detection.

import { getCurrentProject } from "./project.js";

const API_BASE = "https://api.github.com";

function getToken(): string | null {
  return process.env["GITHUB_TOKEN"] ?? null;
}

function headers(): Record<string, string> {
  const token = getToken();
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "janjak-cli",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function ghFetch<T>(path: string): Promise<T | null> {
  if (!getToken()) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── Types ──────────────────────────────────────────────────────

export interface GitHubPR {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  url: string;
  repo: string;
  author: string;
  updatedAt: string;
  reviewRequested: boolean;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  repo: string;
  labels: string[];
  assignee: string | null;
  updatedAt: string;
}

export interface GitHubNotification {
  id: string;
  reason: string;
  title: string;
  repo: string;
  type: string;
  updatedAt: string;
  url: string;
}

export interface GitHubSummary {
  user: string;
  prs: GitHubPR[];
  reviewRequests: GitHubPR[];
  issues: GitHubIssue[];
  notifications: GitHubNotification[];
}

// ─── API Calls ──────────────────────────────────────────────────

async function getUser(): Promise<string | null> {
  const data = await ghFetch<{ login: string }>("/user");
  return data?.login ?? null;
}

/** Get PRs created by the user (open). */
async function getMyPRs(user: string): Promise<GitHubPR[]> {
  const data = await ghFetch<{ items: any[] }>(`/search/issues?q=is:pr+is:open+author:${user}&sort=updated&per_page=10`);
  if (!data?.items) return [];
  return data.items.map((item) => ({
    number: item.number,
    title: item.title,
    state: item.state,
    draft: item.draft ?? false,
    url: item.html_url,
    repo: item.repository_url?.split("/").slice(-2).join("/") ?? "",
    author: item.user?.login ?? "",
    updatedAt: item.updated_at,
    reviewRequested: false,
  }));
}

/** Get PRs where user's review is requested. */
async function getReviewRequests(user: string): Promise<GitHubPR[]> {
  const data = await ghFetch<{ items: any[] }>(`/search/issues?q=is:pr+is:open+review-requested:${user}&sort=updated&per_page=10`);
  if (!data?.items) return [];
  return data.items.map((item) => ({
    number: item.number,
    title: item.title,
    state: item.state,
    draft: item.draft ?? false,
    url: item.html_url,
    repo: item.repository_url?.split("/").slice(-2).join("/") ?? "",
    author: item.user?.login ?? "",
    updatedAt: item.updated_at,
    reviewRequested: true,
  }));
}

/** Get issues assigned to the user. */
async function getMyIssues(user: string): Promise<GitHubIssue[]> {
  const data = await ghFetch<{ items: any[] }>(`/search/issues?q=is:issue+is:open+assignee:${user}&sort=updated&per_page=10`);
  if (!data?.items) return [];
  return data.items.map((item) => ({
    number: item.number,
    title: item.title,
    state: item.state,
    url: item.html_url,
    repo: item.repository_url?.split("/").slice(-2).join("/") ?? "",
    labels: (item.labels ?? []).map((l: any) => l.name),
    assignee: item.assignee?.login ?? null,
    updatedAt: item.updated_at,
  }));
}

/** Get unread notifications. */
async function getNotifications(): Promise<GitHubNotification[]> {
  const data = await ghFetch<any[]>("/notifications?per_page=10");
  if (!data) return [];
  return data.map((n) => ({
    id: n.id,
    reason: n.reason,
    title: n.subject?.title ?? "",
    repo: n.repository?.full_name ?? "",
    type: n.subject?.type ?? "",
    updatedAt: n.updated_at,
    url: n.subject?.url ?? "",
  }));
}

// ─── Main fetch ─────────────────────────────────────────────────

export async function getGitHubSummary(): Promise<GitHubSummary | null> {
  const user = await getUser();
  if (!user) return null;

  const [prs, reviewRequests, issues, notifications] = await Promise.all([
    getMyPRs(user),
    getReviewRequests(user),
    getMyIssues(user),
    getNotifications(),
  ]);

  return { user, prs, reviewRequests, issues, notifications };
}

export function isGitHubConfigured(): boolean {
  return !!getToken();
}

// ─── Formatting ─────────────────────────────────────────────────

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export async function formatGitHubReport(): Promise<string> {
  const summary = await getGitHubSummary();

  if (!summary) {
    return "\n🐙 GitHub Integration\n" +
      "═".repeat(48) + "\n\n" +
      "  Not configured. Add to ~/.janjak/.env:\n\n" +
      "    GITHUB_TOKEN=ghp_...\n\n" +
      "  Create a token at: https://github.com/settings/tokens\n" +
      "  Scopes needed: repo, notifications\n";
  }

  let output = `\n🐙 GitHub — @${summary.user}\n`;
  output += "═".repeat(48) + "\n";

  // Review Requests (highest priority)
  if (summary.reviewRequests.length > 0) {
    output += "\n  🔍 Review Requested:\n";
    for (const pr of summary.reviewRequests) {
      output += `    #${pr.number} ${truncate(pr.title, 36)} ${timeAgo(pr.updatedAt)}\n`;
      output += `         ${pr.repo} by @${pr.author}\n`;
    }
  }

  // My PRs
  if (summary.prs.length > 0) {
    output += "\n  📤 My Open PRs:\n";
    for (const pr of summary.prs) {
      const draft = pr.draft ? " [draft]" : "";
      output += `    #${pr.number} ${truncate(pr.title, 36)}${draft} ${timeAgo(pr.updatedAt)}\n`;
      output += `         ${pr.repo}\n`;
    }
  }

  // Assigned Issues
  if (summary.issues.length > 0) {
    output += "\n  📋 Assigned Issues:\n";
    for (const issue of summary.issues) {
      const labels = issue.labels.length > 0 ? ` [${issue.labels.slice(0, 2).join(", ")}]` : "";
      output += `    #${issue.number} ${truncate(issue.title, 36)}${labels}\n`;
      output += `         ${issue.repo} ${timeAgo(issue.updatedAt)}\n`;
    }
  }

  // Notifications
  if (summary.notifications.length > 0) {
    output += "\n  🔔 Notifications (${summary.notifications.length}):\n";
    for (const n of summary.notifications.slice(0, 5)) {
      const icon = n.type === "PullRequest" ? "📤" : n.type === "Issue" ? "📋" : "💬";
      output += `    ${icon} ${truncate(n.title, 36)} — ${n.reason}\n`;
      output += `         ${n.repo} ${timeAgo(n.updatedAt)}\n`;
    }
  }

  // Current project context
  const { project } = getCurrentProject();
  if (project) {
    output += `\n  📂 Current project: ${project}\n`;
  }

  if (summary.prs.length === 0 && summary.reviewRequests.length === 0 &&
      summary.issues.length === 0 && summary.notifications.length === 0) {
    output += "\n  ✨ All clear! No open items.\n";
  }

  return output;
}

/** Short summary for dashboard. */
export async function getGitHubDashSummary(): Promise<{
  reviewCount: number;
  prCount: number;
  issueCount: number;
  notifCount: number;
} | null> {
  const summary = await getGitHubSummary();
  if (!summary) return null;
  return {
    reviewCount: summary.reviewRequests.length,
    prCount: summary.prs.length,
    issueCount: summary.issues.length,
    notifCount: summary.notifications.length,
  };
}

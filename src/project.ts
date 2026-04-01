// ─── Project Detection: Infer project from window titles ────────────
// Parses VS Code, terminal, and browser window titles to detect
// which project you're working on. Tags sessions for per-project tracking.

import { logProjectSession, getProjectSummaries, getTodayProjectTime, type ProjectSummary } from "./db.js";
import type { AppContext, ActivityState } from "./types.js";

let lastProject: string | null = null;
let lastBranch = "";
let lastProjectStarted = Date.now();
let lastProjectActivity: ActivityState = "unknown";

/** Extract project name and branch from window title.
 *  Supports VS Code, terminals, Xcode, IntelliJ, etc. */
export function detectProject(context: AppContext | null): { project: string | null; branch: string } {
  if (!context) return { project: null, branch: "" };

  const { appName, title } = context;

  // VS Code: "filename — projectName [branch]" or "filename - projectName — Edited"
  if (/code/i.test(appName)) {
    // Pattern: "... — ProjectName" or "... — ProjectName [Git Branch]"
    const dashMatch = title.match(/\s[—–-]\s+([^—–\[\]]+?)(?:\s*\[([^\]]+)\])?\s*(?:—.*)?$/);
    if (dashMatch) {
      const project = dashMatch[1]!.replace(/\s*[-—–]\s*Edited\s*$/i, "").trim();
      const branch = dashMatch[2]?.trim() ?? "";
      if (project && project !== "Visual Studio Code" && project.length < 60) {
        return { project, branch };
      }
    }
    // Fallback: "ProjectName - Visual Studio Code"
    const fallback = title.match(/^(.+?)\s*[-—–]\s*Visual Studio Code/i);
    if (fallback) {
      return { project: fallback[1]!.trim(), branch: "" };
    }
  }

  // Terminal: look for path patterns like ~/projects/name or ~/Desktop/name
  if (/terminal|iterm|warp|hyper|alacritty|kitty/i.test(appName)) {
    // Common patterns: "user@host: ~/path/to/project" or just "~/path/project — zsh"
    const pathMatch = title.match(/[~\/](?:[\w.-]+\/)*?([\w.-]+)\s*(?:[-—–]|$)/);
    if (pathMatch && pathMatch[1] && pathMatch[1].length > 1) {
      return { project: pathMatch[1], branch: "" };
    }
  }

  // Xcode: "ProjectName — ..."
  if (/xcode/i.test(appName)) {
    const xcMatch = title.match(/^([^—–-]+)/);
    if (xcMatch) {
      return { project: xcMatch[1]!.trim(), branch: "" };
    }
  }

  // IntelliJ / WebStorm: "ProjectName – filename"
  if (/intellij|webstorm|phpstorm|pycharm|rider/i.test(appName)) {
    const jetMatch = title.match(/^([^–—-]+)/);
    if (jetMatch) {
      return { project: jetMatch[1]!.trim(), branch: "" };
    }
  }

  // GitHub in browser: "user/repo ..."
  if (/safari|chrome|firefox|brave|arc/i.test(appName)) {
    const ghMatch = title.match(/^[\w-]+\/([\w.-]+)/);
    if (ghMatch) {
      return { project: ghMatch[1]!, branch: "" };
    }
  }

  return { project: null, branch: "" };
}

/** Called from the engine's poll() to track project time.
 *  Logs a project session on project change. */
export function trackProject(context: AppContext | null, activity: ActivityState): void {
  const { project, branch } = detectProject(context);
  const now = Date.now();

  if (project !== lastProject) {
    // Flush previous project session
    if (lastProject) {
      const elapsed = (now - lastProjectStarted) / 60000;
      if (elapsed > 0.1) {
        logProjectSession(lastProjectStarted, lastProject, lastBranch, lastProjectActivity, elapsed);
      }
    }
    lastProject = project;
    lastBranch = branch;
    lastProjectActivity = activity;
    lastProjectStarted = now;
  } else {
    // Same project — update branch / activity if changed
    if (branch) lastBranch = branch;
    lastProjectActivity = activity;

    // Periodic checkpoint every 5 min
    const elapsed = (now - lastProjectStarted) / 60000;
    if (elapsed >= 5 && lastProject) {
      logProjectSession(lastProjectStarted, lastProject, lastBranch, lastProjectActivity, elapsed);
      lastProjectStarted = now;
    }
  }
}

/** Flush project tracking on shutdown */
export function flushProjectSession(): void {
  if (lastProject) {
    const elapsed = (Date.now() - lastProjectStarted) / 60000;
    if (elapsed > 0.1) {
      logProjectSession(lastProjectStarted, lastProject, lastBranch, lastProjectActivity, elapsed);
    }
    lastProjectStarted = Date.now();
  }
}

/** Get current detected project */
export function getCurrentProject(): { project: string | null; branch: string } {
  return { project: lastProject, branch: lastBranch };
}

// ─── Display Formatters ─────────────────────────────────────────

function formatDuration(mins: number): string {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

/** Format per-project time breakdown */
export function formatProjectsReport(days = 30): string {
  const summaries = getProjectSummaries(days);

  let output = `\n📁 Project Breakdown (last ${days} days)\n`;
  output += "═".repeat(56) + "\n\n";

  if (summaries.length === 0) {
    output += "  No project data yet. Use VS Code or a coding app — Janjak\n";
    output += "  auto-detects projects from window titles.\n";
    return output;
  }

  // Total time
  const totalMins = summaries.reduce((s, p) => s + p.totalMinutes, 0);
  output += `  Total tracked: ${formatDuration(totalMins)} across ${summaries.length} project${summaries.length > 1 ? "s" : ""}\n\n`;

  output += "─".repeat(56) + "\n";

  for (const s of summaries) {
    const pct = totalMins > 0 ? Math.round((s.totalMinutes / totalMins) * 100) : 0;
    const barLen = Math.max(1, Math.round(pct / 5));
    const bar = "█".repeat(barLen) + "░".repeat(20 - barLen);

    output += `  📂 ${s.project}\n`;
    output += `     ${bar} ${formatDuration(s.totalMinutes)} (${pct}%)\n`;

    // Activity breakdown
    const acts = Object.entries(s.activities)
      .sort((a, b) => b[1] - a[1])
      .map(([act, mins]) => `${act}: ${mins}m`)
      .join(", ");
    output += `     ${acts}\n`;

    if (s.branches.length > 0) {
      output += `     🌿 ${s.branches.join(", ")}\n`;
    }

    const ago = Math.round((Date.now() - s.lastSeen) / 3600000);
    const lastStr = ago < 1 ? "just now" : ago < 24 ? `${ago}h ago` : `${Math.round(ago / 24)}d ago`;
    output += `     Last active: ${lastStr}\n`;
    output += "\n";
  }

  return output;
}

/** Short project summary for dashboard / status */
export function formatCurrentProjectBadge(): string {
  if (!lastProject) return "";
  const branchStr = lastBranch ? ` [${lastBranch}]` : "";
  return `📂 ${lastProject}${branchStr}`;
}

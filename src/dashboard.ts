// ─── Interactive Dashboard: Real-time TUI ───────────────────────────
// A full-screen terminal UI with live-updating panels: status, score,
// tasks, music, project, pomodoros — all in one view.

import { poll, getStatus, getNudge, formatStatus } from "./engine.js";
import { getCurrentTrack } from "./music.js";
import { getTodayScore } from "./score.js";
import { getTasks } from "./db.js";
import { getPomodoroStats } from "./pomo.js";
import { formatStreakBadge } from "./streak.js";
import { getCurrentProject } from "./project.js";
import { getTodayProjectTime } from "./db.js";
import { sendNotification, notificationsAvailable } from "./notify.js";
import { flushSession } from "./engine.js";
import { closeDb } from "./db.js";
import { getCalendarSummary, getMeetingAlert } from "./calendar.js";
import { getGitHubDashSummary, isGitHubConfigured } from "./github.js";

// ─── ANSI Helpers ───────────────────────────────────────────────

const ESC = "\x1B[";
const CLEAR = `${ESC}2J${ESC}H`;
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const RESET = `${ESC}0m`;
const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const MAGENTA = `${ESC}35m`;
const WHITE = `${ESC}37m`;
const BG_BLACK = `${ESC}40m`;

function box(title: string, lines: string[], width: number): string[] {
  const out: string[] = [];
  const inner = width - 4;
  out.push(`${CYAN}╭─ ${BOLD}${title}${RESET}${CYAN} ${"─".repeat(Math.max(0, inner - title.length - 1))}╮${RESET}`);
  for (const line of lines) {
    // Strip ANSI for length calculation
    const visible = line.replace(/\x1B\[[0-9;]*m/g, "");
    const pad = Math.max(0, inner - visible.length);
    out.push(`${CYAN}│${RESET} ${line}${" ".repeat(pad)} ${CYAN}│${RESET}`);
  }
  out.push(`${CYAN}╰${"─".repeat(width - 2)}╯${RESET}`);
  return out;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

// ─── Panel Builders ─────────────────────────────────────────────

function statusPanel(width: number): string[] {
  const state = getStatus();
  const sessionMin = Math.round((Date.now() - state.sessionStartedAt) / 60000);
  const mode = state.focusMode === "off" ? "Off" : state.focusMode;
  const app = state.activeApp?.appName ?? "None";
  const { project, branch } = getCurrentProject();

  const activityMap: Record<string, string> = {
    coding: "💻 Coding", browsing: "🌐 Browsing", designing: "🎨 Designing",
    writing: "✍️  Writing", meeting: "📞 Meeting", idle: "😴 Idle", unknown: "❓ Unknown",
    "social-media": "📱 Social Media", entertainment: "🎬 Entertainment",
    learning: "📚 Learning", email: "📧 Email", communication: "💬 Messaging",
    creative: "🎹 Creative", reading: "📖 Reading",
  };
  const energyMap: Record<string, string> = {
    high: "🟢🟢🟢🟢", medium: "🟡🟡🟡", low: "🟠🟠", drained: "🔴",
  };

  const lines: string[] = [
    `${BOLD}${activityMap[state.activity] ?? "❓"}${RESET}`,
    `App:     ${WHITE}${truncate(app, width - 16)}${RESET}`,
    `Mode:    ${mode === "deep-work" ? `${GREEN}${mode}${RESET}` : mode === "break" ? `${YELLOW}${mode}${RESET}` : `${DIM}${mode}${RESET}`}`,
    `Session: ${BOLD}${sessionMin} min${RESET}`,
    `Energy:  ${energyMap[state.energy] ?? "?"}`,
  ];

  if (project) {
    const br = branch ? ` ${DIM}[${branch}]${RESET}` : "";
    lines.push(`Project: ${MAGENTA}${truncate(project, width - 20)}${RESET}${br}`);
  }

  return box("Status", lines, width);
}

function scorePanel(width: number): string[] {
  const today = getTodayScore();
  const streak = formatStreakBadge();
  const pomo = getPomodoroStats();

  const scoreColor = today.score >= 70 ? GREEN : today.score >= 50 ? YELLOW : RED;
  const barLen = Math.round(today.score / 5);
  const bar = `${scoreColor}${"█".repeat(barLen)}${DIM}${"░".repeat(20 - barLen)}${RESET}`;

  const lines: string[] = [
    `${BOLD}${scoreColor}${today.score}/100${RESET}  ${today.label}`,
    bar,
    `💻 ${today.codingMinutes}m code  🌐 ${today.browsingMinutes}m browse  ⏱️ ${today.totalMinutes}m total`,
    `Focus: ${Math.round(today.focusRatio * 100)}%`,
  ];

  if (streak) lines.push(streak);
  if (pomo.today > 0) lines.push(`🍅 ${pomo.today} pomodoro${pomo.today > 1 ? "s" : ""} (${pomo.totalMinutes}m)`);

  return box("Score", lines, width);
}

function tasksPanel(width: number): string[] {
  const tasks = getTasks();
  const lines: string[] = [];

  if (tasks.length === 0) {
    lines.push(`${DIM}No pending tasks${RESET}`);
  } else {
    const show = tasks.slice(0, 5);
    for (const t of show) {
      const pri = t.priority === "high" ? `${RED}●${RESET}` : t.priority === "medium" ? `${YELLOW}●${RESET}` : `${GREEN}●${RESET}`;
      const status = t.status === "in-progress" ? `${CYAN}▶${RESET} ` : "  ";
      const title = truncate(t.title, width - 14);
      lines.push(`${pri}${status}#${t.id} ${title}`);
    }
    if (tasks.length > 5) {
      lines.push(`${DIM}  +${tasks.length - 5} more${RESET}`);
    }
  }

  return box("Tasks", lines, width);
}

async function musicPanel(width: number): Promise<string[]> {
  const track = await getCurrentTrack();
  const lines: string[] = [];

  if (track) {
    lines.push(`${GREEN}▶${RESET} ${truncate(track, width - 8)}`);
  } else {
    lines.push(`${DIM}🔇 Nothing playing${RESET}`);
  }

  return box("Music", lines, width);
}

function projectsPanel(width: number): string[] {
  const projects = getTodayProjectTime();
  const lines: string[] = [];

  if (projects.length === 0) {
    lines.push(`${DIM}No project data today${RESET}`);
  } else {
    const totalMins = projects.reduce((s, p) => s + p.minutes, 0);
    for (const p of projects.slice(0, 4)) {
      const pct = totalMins > 0 ? Math.round((p.minutes / totalMins) * 100) : 0;
      const barLen = Math.max(1, Math.round(pct / 10));
      lines.push(`📂 ${truncate(p.project, width - 22)} ${String(p.minutes).padStart(3)}m ${"█".repeat(barLen)}`);
    }
  }

  return box("Projects", lines, width);
}

function nudgePanel(nudge: string | null, width: number): string[] {
  if (!nudge) return [];
  return box("Nudge", [truncate(nudge, width - 6)], width);
}

async function calendarPanel(width: number): Promise<string[]> {
  try {
    const cal = await getCalendarSummary();
    if (!cal) return box("Calendar", [`${DIM}Not connected${RESET}`], width);
    const lines: string[] = [];

    if (cal.currentEvent) {
      lines.push(`${RED}● NOW${RESET} ${truncate(cal.currentEvent.title, width - 14)}`);
    }
    if (cal.nextEvent) {
      lines.push(`${YELLOW}▶ NEXT${RESET} ${truncate(cal.nextEvent.title, width - 14)}`);
    }
    lines.push(`📅 ${cal.totalMeetings} meeting${cal.totalMeetings !== 1 ? "s" : ""} today`);
    lines.push(`🟢 ${cal.freeMinutes}m free`);

    const alert = await getMeetingAlert();
    if (alert) lines.push(`${RED}${BOLD}${truncate(alert, width - 6)}${RESET}`);

    return box("Calendar", lines, width);
  } catch {
    return box("Calendar", [`${DIM}Unavailable${RESET}`], width);
  }
}

async function githubPanel(width: number): Promise<string[]> {
  if (!isGitHubConfigured()) return box("GitHub", [`${DIM}Add GITHUB_TOKEN${RESET}`], width);
  try {
    const gh = await getGitHubDashSummary();
    if (!gh) return box("GitHub", [`${DIM}Unavailable${RESET}`], width);
    const lines: string[] = [];

    if (gh.reviewCount > 0) lines.push(`${RED}🔍 ${gh.reviewCount} review${gh.reviewCount > 1 ? "s" : ""} requested${RESET}`);
    if (gh.prCount > 0) lines.push(`📤 ${gh.prCount} open PR${gh.prCount > 1 ? "s" : ""}`);
    if (gh.issueCount > 0) lines.push(`📋 ${gh.issueCount} assigned issue${gh.issueCount > 1 ? "s" : ""}`);
    if (gh.notifCount > 0) lines.push(`🔔 ${gh.notifCount} notification${gh.notifCount > 1 ? "s" : ""}`);

    if (lines.length === 0) lines.push(`${GREEN}✨ All clear${RESET}`);

    return box("GitHub", lines, width);
  } catch {
    return box("GitHub", [`${DIM}Unavailable${RESET}`], width);
  }
}

function headerLine(width: number): string {
  const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const title = "🧠 Janjak Dashboard";
  const pad = Math.max(0, width - title.length - time.length - 4);
  return `${BOLD}${title}${RESET}${" ".repeat(pad)}${DIM}${time}${RESET}`;
}

function footerLine(width: number): string {
  const help = "q: quit  f: focus  b: break  s: stop  r: refresh";
  return `${DIM}${help.padEnd(width)}${RESET}`;
}

// ─── Layout Engine ──────────────────────────────────────────────

function sideBySide(leftLines: string[], rightLines: string[], gap = 2): string[] {
  const maxLen = Math.max(leftLines.length, rightLines.length);
  const result: string[] = [];
  // Calculate visible width of left column for alignment
  const leftWidth = leftLines.length > 0
    ? leftLines[0]!.replace(/\x1B\[[0-9;]*m/g, "").length
    : 0;

  for (let i = 0; i < maxLen; i++) {
    const left = leftLines[i] ?? "";
    const right = rightLines[i] ?? "";
    const leftVisible = left.replace(/\x1B\[[0-9;]*m/g, "").length;
    const pad = Math.max(0, leftWidth - leftVisible);
    result.push(left + " ".repeat(pad + gap) + right);
  }
  return result;
}

// ─── Main Render Loop ───────────────────────────────────────────

export async function startDashboard(opts: { notify: boolean }): Promise<void> {
  const cols = process.stdout.columns || 80;
  const panelWidth = Math.min(Math.floor((cols - 4) / 2), 44);
  let lastNudge: string | null = null;

  process.stdout.write(HIDE_CURSOR);

  async function render(): Promise<void> {
    await poll();
    const nudge = getNudge();
    if (nudge && nudge !== lastNudge) {
      lastNudge = nudge;
      if (opts.notify && notificationsAvailable()) {
        sendNotification(nudge, "Janjak", "Nudge");
      }
    }

    const lines: string[] = [];
    lines.push(headerLine(cols));
    lines.push("");

    // Row 1: Status + Score
    const left1 = statusPanel(panelWidth);
    const right1 = scorePanel(panelWidth);
    lines.push(...sideBySide(left1, right1));
    lines.push("");

    // Row 2: Tasks + Projects
    const left2 = tasksPanel(panelWidth);
    const right2 = projectsPanel(panelWidth);
    lines.push(...sideBySide(left2, right2));
    lines.push("");

    // Row 3: Calendar + GitHub
    const left3 = await calendarPanel(panelWidth);
    const right3 = await githubPanel(panelWidth);
    lines.push(...sideBySide(left3, right3));
    lines.push("");

    // Row 4: Music + Nudge
    const left4 = await musicPanel(panelWidth);
    const right4 = nudgePanel(lastNudge, panelWidth);
    if (right4.length > 0) {
      lines.push(...sideBySide(left4, right4));
    } else {
      lines.push(...left4);
    }

    lines.push("");
    lines.push(footerLine(cols));

    process.stdout.write(CLEAR + lines.join("\n") + "\n");
  }

  // Initial render
  await render();

  // Update every 5 seconds
  const interval = setInterval(render, 5000);

  // Keyboard input
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
  }

  const cleanup = () => {
    clearInterval(interval);
    process.stdout.write(SHOW_CURSOR + "\n");
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    flushSession();
    closeDb();
  };

  process.stdin.on("data", async (key: string) => {
    // ctrl+c or q
    if (key === "\x03" || key === "q" || key === "Q") {
      cleanup();
      console.log("\n👋 Dashboard closed.");
      process.exit(0);
    }
    if (key === "r" || key === "R") {
      await render();
    }
  });

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}

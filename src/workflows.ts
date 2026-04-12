// ─── Workflow Automation Engine ──────────────────────────────────────
// Janjak executes real actions based on context signals.
//
// Triggers fire when your state changes — activity shifts, meetings
// start, long sessions end, projects switch. Each workflow runs a
// shell command, a Janjak action, or a script from ~/.janjak/workflows/.
//
// Safety:
//   - Commands run with a timeout (default 15s)
//   - Blocked commands: rm -rf, sudo, shutdown, etc.
//   - All executions are logged with stdout/stderr capture
//   - Each workflow has an independent cooldown

import { exec } from "node:child_process";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getStatus } from "./engine.js";
import { getCurrentProject } from "./project.js";
import { sendNotification, notificationsAvailable } from "./notify.js";
import { getState, setState } from "./db.js";
import type { ActivityState, FocusMode, UserState } from "./types.js";

// ─── Paths ──────────────────────────────────────────────────────

const JANJAK_DIR = join(homedir(), ".janjak");
const WORKFLOWS_DIR = join(JANJAK_DIR, "workflows");

// ─── Types ──────────────────────────────────────────────────────

export type TriggerType =
  | "activity_change"     // Switched from one activity to another
  | "focus_start"         // Entered focus mode
  | "focus_end"           // Exited focus mode (stop or break)
  | "break_start"         // Entered break mode
  | "break_end"           // Left break mode
  | "long_session"        // Coding session exceeded N minutes
  | "idle_detected"       // User went idle
  | "return_from_idle"    // User came back from idle
  | "project_switch"      // Switched to a different project
  | "meeting_soon"        // Meeting starting within N minutes
  | "energy_low"          // Energy level dropped to low/drained
  | "schedule";           // Runs on a cron-like interval

export interface TriggerCondition {
  type: TriggerType;
  /** Extra filter — e.g., which activity, which project, how many minutes */
  from?: ActivityState;
  to?: ActivityState;
  project?: string;
  minutes?: number;
  focusMode?: FocusMode;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger: TriggerCondition;
  /** Shell command to execute */
  command: string;
  /** Working directory (defaults to home) */
  cwd?: string;
  /** Timeout in ms (default 15000) */
  timeoutMs?: number;
  /** Cooldown between executions in ms (default 5 min) */
  cooldownMs?: number;
  /** Whether this workflow is enabled */
  enabled: boolean;
  /** Is this a built-in workflow? */
  builtin?: boolean;
  /** Notify user when this workflow runs? */
  notify?: boolean;
}

export interface WorkflowLogEntry {
  timestamp: number;
  workflowId: string;
  workflowName: string;
  trigger: TriggerType;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  success: boolean;
  durationMs: number;
}

// ─── State Tracking ─────────────────────────────────────────────

interface ContextSnapshot {
  activity: ActivityState;
  focusMode: FocusMode;
  project: string | null;
  idleMinutes: number;
  sessionMinutes: number;
  energy: string;
}

let prevSnapshot: ContextSnapshot | null = null;
const lastFired = new Map<string, number>();
const workflowLog: WorkflowLogEntry[] = [];
const MAX_LOG = 100;

// ─── Blocked Commands (safety) ──────────────────────────────────

const BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+[\/~]/i,        // rm -rf / or ~
  /\bsudo\b/i,                   // No sudo
  /\bshutdown\b/i,               // No shutdown
  /\breboot\b/i,                 // No reboot
  /\bmkfs\b/i,                   // No formatting
  /\bdd\s+if=/i,                 // No raw disk writes
  />\s*\/dev\/(?!null)/i,                // No writing to devices (except /dev/null)
  /\bcurl\b.*\|\s*\b(bash|sh)\b/i, // No curl | bash
  /\bchmod\s+777\b/i,            // No world-writable
  /\bgit\s+push\s+.*--force\b/i, // No force push
  /\bgit\s+reset\s+--hard\b/i,   // No hard reset
];

function isCommandSafe(cmd: string): boolean {
  return !BLOCKED_PATTERNS.some(p => p.test(cmd));
}

// ─── Built-in Workflows ────────────────────────────────────────

const BUILTIN_WORKFLOWS: Workflow[] = [
  {
    id: "auto-git-stash-before-meeting",
    name: "Git Stash Before Meeting",
    description: "Auto-stashes uncommitted changes when a meeting is about to start",
    trigger: { type: "meeting_soon", minutes: 5 },
    command: 'cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" && git diff --quiet || git stash push -m "janjak-auto-stash-$(date +%s)"',
    cooldownMs: 30 * 60_000,
    enabled: true,
    builtin: true,
    notify: true,
  },
  {
    id: "run-tests-after-long-session",
    name: "Run Tests After Long Session",
    description: "Runs project tests after 45+ minutes of coding (looks for package.json)",
    trigger: { type: "long_session", minutes: 45 },
    command: 'cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" && [ -f package.json ] && npm test --if-present 2>&1 | tail -20 || echo "No package.json found"',
    timeoutMs: 60_000,
    cooldownMs: 60 * 60_000,
    enabled: false, // Opt-in
    builtin: true,
    notify: true,
  },
  {
    id: "open-project-on-switch",
    name: "Log Project Switch",
    description: "Logs when you switch between projects so you can review context switches",
    trigger: { type: "project_switch" },
    command: 'echo "Switched to project: $JANJAK_PROJECT at $(date +%H:%M)"',
    cooldownMs: 60_000,
    enabled: true,
    builtin: true,
    notify: false,
  },
  {
    id: "git-status-on-return",
    name: "Git Status on Return",
    description: "Shows git status when you return from being idle (5+ min)",
    trigger: { type: "return_from_idle" },
    command: 'cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" && echo "$(basename $(pwd)): $(git status --short | wc -l | tr -d " ") changed files, branch $(git branch --show-current)"',
    cooldownMs: 10 * 60_000,
    enabled: true,
    builtin: true,
    notify: true,
  },
  {
    id: "focus-dnd-on",
    name: "macOS DND in Focus Mode",
    description: "Enables Do Not Disturb when you enter focus mode",
    trigger: { type: "focus_start" },
    command: 'shortcuts run "Turn On Focus" 2>/dev/null || echo "Set up a Shortcuts automation for DND"',
    cooldownMs: 5 * 60_000,
    enabled: false, // Opt-in
    builtin: true,
    notify: true,
  },
  {
    id: "focus-dnd-off",
    name: "macOS DND Off on Break",
    description: "Disables Do Not Disturb when you take a break",
    trigger: { type: "break_start" },
    command: 'shortcuts run "Turn Off Focus" 2>/dev/null || echo "Set up a Shortcuts automation for DND"',
    cooldownMs: 5 * 60_000,
    enabled: false, // Opt-in
    builtin: true,
    notify: false,
  },
];

// ─── Workflow Storage ───────────────────────────────────────────

function ensureWorkflowsDir(): void {
  mkdirSync(WORKFLOWS_DIR, { recursive: true });
}

/** Load user-defined workflows from ~/.janjak/workflows/*.json */
function loadUserWorkflows(): Workflow[] {
  ensureWorkflowsDir();
  const workflows: Workflow[] = [];

  try {
    const files = readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(WORKFLOWS_DIR, file), "utf-8"));
        if (raw.id && raw.trigger && raw.command) {
          workflows.push({
            enabled: true,
            notify: true,
            cooldownMs: 5 * 60_000,
            timeoutMs: 15_000,
            ...raw,
            builtin: false,
          });
        }
      } catch { /* skip invalid files */ }
    }
  } catch { /* dir doesn't exist yet */ }

  return workflows;
}

/** Get all workflows (builtins + user-defined), respecting enable/disable overrides */
export function getAllWorkflows(): Workflow[] {
  const builtins = BUILTIN_WORKFLOWS.map(w => {
    const override = getState(`workflow_enabled_${w.id}`);
    return { ...w, enabled: override !== null ? override === "true" : w.enabled };
  });
  const user = loadUserWorkflows().map(w => {
    const override = getState(`workflow_enabled_${w.id}`);
    return { ...w, enabled: override !== null ? override === "true" : w.enabled };
  });
  return [...builtins, ...user];
}

export function setWorkflowEnabled(id: string, enabled: boolean): boolean {
  const all = getAllWorkflows();
  const wf = all.find(w => w.id === id);
  if (!wf) return false;
  setState(`workflow_enabled_${id}`, enabled ? "true" : "false");
  return true;
}

/** Save a new user workflow to ~/.janjak/workflows/ */
export function saveUserWorkflow(workflow: Workflow): void {
  ensureWorkflowsDir();
  const sanitized = { ...workflow, builtin: false };
  const filename = workflow.id.replace(/[^a-z0-9_-]/gi, "_") + ".json";
  writeFileSync(join(WORKFLOWS_DIR, filename), JSON.stringify(sanitized, null, 2));
}

/** Remove a user workflow file */
export function removeUserWorkflow(id: string): boolean {
  ensureWorkflowsDir();
  const filename = id.replace(/[^a-z0-9_-]/gi, "_") + ".json";
  const filepath = join(WORKFLOWS_DIR, filename);
  if (existsSync(filepath)) {
    unlinkSync(filepath);
    return true;
  }
  return false;
}

// ─── Command Execution ─────────────────────────────────────────

function execCommand(
  cmd: string,
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; exitCode: number | null; durationMs: number }> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const child = exec(cmd, {
      cwd: opts.cwd ?? homedir(),
      timeout: opts.timeoutMs ?? 15_000,
      env: { ...process.env, ...opts.env },
      maxBuffer: 1024 * 1024, // 1MB
      shell: "/bin/zsh",
    }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout).slice(0, 2000),
        stderr: String(stderr).slice(0, 500),
        exitCode: error ? (error as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0,
        durationMs: Date.now() - startTime,
      });
    });
    // Safety: kill if it somehow exceeds timeout
    const hardTimeout = (opts.timeoutMs ?? 15_000) + 5000;
    setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, hardTimeout);
  });
}

// ─── Trigger Evaluation ─────────────────────────────────────────

function takeSnapshot(): ContextSnapshot {
  const status = getStatus();
  const { project } = getCurrentProject();
  return {
    activity: status.activity,
    focusMode: status.focusMode,
    project,
    idleMinutes: status.idleMinutes,
    sessionMinutes: Math.round((Date.now() - status.sessionStartedAt) / 60000),
    energy: status.energy,
  };
}

function shouldTrigger(workflow: Workflow, prev: ContextSnapshot, curr: ContextSnapshot): boolean {
  const t = workflow.trigger;

  switch (t.type) {
    case "activity_change":
      if (prev.activity === curr.activity) return false;
      if (t.from && prev.activity !== t.from) return false;
      if (t.to && curr.activity !== t.to) return false;
      return true;

    case "focus_start":
      return prev.focusMode !== "deep-work" && curr.focusMode === "deep-work";

    case "focus_end":
      return prev.focusMode === "deep-work" && curr.focusMode !== "deep-work";

    case "break_start":
      return prev.focusMode !== "break" && curr.focusMode === "break";

    case "break_end":
      return prev.focusMode === "break" && curr.focusMode !== "break";

    case "long_session": {
      const threshold = t.minutes ?? 45;
      return curr.activity === "coding" && curr.sessionMinutes >= threshold && prev.sessionMinutes < threshold;
    }

    case "idle_detected":
      return prev.activity !== "idle" && curr.activity === "idle";

    case "return_from_idle": {
      const minIdle = t.minutes ?? 5;
      return prev.activity === "idle" && curr.activity !== "idle" && prev.idleMinutes >= minIdle;
    }

    case "project_switch":
      if (!prev.project || !curr.project) return false;
      if (prev.project === curr.project) return false;
      if (t.project && curr.project !== t.project) return false;
      return true;

    case "energy_low":
      return prev.energy !== "low" && prev.energy !== "drained" &&
             (curr.energy === "low" || curr.energy === "drained");

    case "meeting_soon":
      // This is handled separately via the proactive alert system
      return false;

    case "schedule":
      // Handled separately with setInterval
      return false;

    default:
      return false;
  }
}

// ─── Core: Evaluate & Run ───────────────────────────────────────

function canFireWorkflow(id: string, cooldownMs: number): boolean {
  const last = lastFired.get(id);
  if (!last) return true;
  return Date.now() - last >= cooldownMs;
}

async function runWorkflow(workflow: Workflow, snapshot: ContextSnapshot): Promise<void> {
  if (!isCommandSafe(workflow.command)) {
    logWorkflowRun({
      timestamp: Date.now(),
      workflowId: workflow.id,
      workflowName: workflow.name,
      trigger: workflow.trigger.type,
      command: workflow.command,
      stdout: "",
      stderr: "BLOCKED: Command matched a blocked pattern (safety check)",
      exitCode: null,
      success: false,
      durationMs: 0,
    });
    return;
  }

  // Inject context as env vars
  const env: Record<string, string> = {
    JANJAK_ACTIVITY: snapshot.activity,
    JANJAK_FOCUS_MODE: snapshot.focusMode,
    JANJAK_PROJECT: snapshot.project ?? "",
    JANJAK_ENERGY: snapshot.energy,
    JANJAK_SESSION_MINUTES: String(snapshot.sessionMinutes),
    JANJAK_IDLE_MINUTES: String(snapshot.idleMinutes),
  };

  const result = await execCommand(workflow.command, {
    cwd: workflow.cwd,
    timeoutMs: workflow.timeoutMs ?? 15_000,
    env,
  });

  const entry: WorkflowLogEntry = {
    timestamp: Date.now(),
    workflowId: workflow.id,
    workflowName: workflow.name,
    trigger: workflow.trigger.type,
    command: workflow.command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    success: result.exitCode === 0,
    durationMs: result.durationMs,
  };

  logWorkflowRun(entry);
  lastFired.set(workflow.id, Date.now());

  // Notify user
  if (workflow.notify && notificationsAvailable()) {
    const icon = result.exitCode === 0 ? "⚙️" : "⚠️";
    const output = result.stdout.trim().split("\n").slice(-2).join("\n") || "(no output)";
    sendNotification(
      `${icon} ${workflow.name}\n${output}`,
      "Janjak Workflow",
      workflow.trigger.type,
    );
  }
}

function logWorkflowRun(entry: WorkflowLogEntry): void {
  workflowLog.push(entry);
  if (workflowLog.length > MAX_LOG) workflowLog.shift();
}

/** Called every poll cycle (10s). Evaluates all triggers against state changes. */
export async function evaluateWorkflows(): Promise<void> {
  if (!isWorkflowsEnabled()) return;

  const curr = takeSnapshot();

  if (!prevSnapshot) {
    prevSnapshot = curr;
    return;
  }

  const workflows = getAllWorkflows().filter(w => w.enabled);

  for (const workflow of workflows) {
    if (workflow.trigger.type === "schedule" || workflow.trigger.type === "meeting_soon") continue;

    if (shouldTrigger(workflow, prevSnapshot, curr)) {
      if (canFireWorkflow(workflow.id, workflow.cooldownMs ?? 5 * 60_000)) {
        // Run async, don't block the poll loop
        runWorkflow(workflow, curr).catch(() => {});
      }
    }
  }

  prevSnapshot = curr;
}

/** Trigger meeting_soon workflows (called from proactive engine). */
export async function triggerMeetingWorkflows(minutesUntil: number): Promise<void> {
  if (!isWorkflowsEnabled()) return;

  const workflows = getAllWorkflows().filter(
    w => w.enabled && w.trigger.type === "meeting_soon"
  );

  const snapshot = takeSnapshot();

  for (const workflow of workflows) {
    const threshold = workflow.trigger.minutes ?? 5;
    if (minutesUntil <= threshold) {
      if (canFireWorkflow(workflow.id, workflow.cooldownMs ?? 30 * 60_000)) {
        await runWorkflow(workflow, snapshot);
      }
    }
  }
}

/** Run a specific workflow by ID (manual trigger). */
export async function runWorkflowById(id: string): Promise<WorkflowLogEntry | null> {
  const workflow = getAllWorkflows().find(w => w.id === id);
  if (!workflow) return null;

  const snapshot = takeSnapshot();

  if (!isCommandSafe(workflow.command)) {
    return {
      timestamp: Date.now(),
      workflowId: workflow.id,
      workflowName: workflow.name,
      trigger: "activity_change",
      command: workflow.command,
      stdout: "",
      stderr: "BLOCKED: Command matched a blocked pattern",
      exitCode: null,
      success: false,
      durationMs: 0,
    };
  }

  const env: Record<string, string> = {
    JANJAK_ACTIVITY: snapshot.activity,
    JANJAK_FOCUS_MODE: snapshot.focusMode,
    JANJAK_PROJECT: snapshot.project ?? "",
    JANJAK_ENERGY: snapshot.energy,
    JANJAK_SESSION_MINUTES: String(snapshot.sessionMinutes),
    JANJAK_IDLE_MINUTES: String(snapshot.idleMinutes),
  };

  const result = await execCommand(workflow.command, {
    cwd: workflow.cwd,
    timeoutMs: workflow.timeoutMs ?? 15_000,
    env,
  });

  const entry: WorkflowLogEntry = {
    timestamp: Date.now(),
    workflowId: workflow.id,
    workflowName: workflow.name,
    trigger: workflow.trigger.type,
    command: workflow.command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    success: result.exitCode === 0,
    durationMs: result.durationMs,
  };

  logWorkflowRun(entry);
  return entry;
}

// ─── Configuration ──────────────────────────────────────────────

export function isWorkflowsEnabled(): boolean {
  return getState("workflows_enabled") !== "false"; // On by default
}

export function setWorkflowsEnabled(enabled: boolean): void {
  setState("workflows_enabled", enabled ? "true" : "false");
}

// ─── Getters ────────────────────────────────────────────────────

export function getWorkflowLog(): WorkflowLogEntry[] {
  return [...workflowLog];
}

// ─── Formatting ─────────────────────────────────────────────────

const TRIGGER_LABELS: Record<TriggerType, string> = {
  activity_change: "Activity Change",
  focus_start: "Focus Start",
  focus_end: "Focus End",
  break_start: "Break Start",
  break_end: "Break End",
  long_session: "Long Session",
  idle_detected: "Idle Detected",
  return_from_idle: "Return from Idle",
  project_switch: "Project Switch",
  meeting_soon: "Meeting Soon",
  energy_low: "Energy Low",
  schedule: "Scheduled",
};

export function formatWorkflowList(): string {
  const workflows = getAllWorkflows();
  if (workflows.length === 0) return "\n  No workflows configured.\n";

  let out = "\n⚙️  Janjak Workflows\n\n";

  const builtins = workflows.filter(w => w.builtin);
  const user = workflows.filter(w => !w.builtin);

  if (builtins.length > 0) {
    out += "  Built-in:\n";
    for (const w of builtins) {
      const status = w.enabled ? "✅" : "❌";
      const trigger = TRIGGER_LABELS[w.trigger.type] ?? w.trigger.type;
      out += `    ${status} ${w.name}\n`;
      out += `       Trigger: ${trigger}`;
      if (w.trigger.minutes) out += ` (${w.trigger.minutes}m)`;
      out += `\n`;
      out += `       ${w.description}\n`;
      out += `       ID: ${w.id}\n\n`;
    }
  }

  if (user.length > 0) {
    out += "  Custom:\n";
    for (const w of user) {
      const status = w.enabled ? "✅" : "❌";
      const trigger = TRIGGER_LABELS[w.trigger.type] ?? w.trigger.type;
      out += `    ${status} ${w.name}\n`;
      out += `       Trigger: ${trigger}`;
      if (w.trigger.minutes) out += ` (${w.trigger.minutes}m)`;
      out += `\n`;
      out += `       Command: ${w.command}\n`;
      out += `       ID: ${w.id}\n\n`;
    }
  }

  out += `  Workflows: ${isWorkflowsEnabled() ? "✅ ON" : "❌ OFF"}\n`;
  out += `  Total: ${workflows.length} (${workflows.filter(w => w.enabled).length} enabled)\n`;
  out += `  Custom dir: ${WORKFLOWS_DIR}\n`;

  return out;
}

export function formatWorkflowLog(): string {
  if (workflowLog.length === 0) return "\n  No workflow executions yet.\n";

  let out = `\n📋 Workflow Log (last ${Math.min(workflowLog.length, 20)}):\n\n`;

  for (const entry of [...workflowLog].reverse().slice(0, 20)) {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const icon = entry.success ? "✅" : "❌";
    const trigger = TRIGGER_LABELS[entry.trigger] ?? entry.trigger;
    out += `  ${icon} ${time} — ${entry.workflowName}\n`;
    out += `     Trigger: ${trigger}  Duration: ${entry.durationMs}ms\n`;
    if (entry.stdout.trim()) {
      const lines = entry.stdout.trim().split("\n").slice(-3);
      for (const line of lines) out += `     > ${line}\n`;
    }
    if (entry.stderr.trim() && !entry.success) {
      out += `     ⚠️ ${entry.stderr.trim().split("\n")[0]}\n`;
    }
    out += "\n";
  }

  return out;
}

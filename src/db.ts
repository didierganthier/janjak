// ─── Database: SQLite-backed session logging + behavioral memory ───
import Database from "better-sqlite3";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import type { ActivityState, FocusMode, SessionLog, ExtractedTask, TaskStatus, TaskPriority } from "./types.js";

const DATA_DIR = join(homedir(), ".janjak");
const DB_PATH = join(DATA_DIR, "janjak.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);

  // Enable WAL mode for better performance
  db.pragma("journal_mode = WAL");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      activity TEXT NOT NULL,
      focus_mode TEXT NOT NULL,
      app_name TEXT NOT NULL,
      duration_minutes REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON sessions(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(activity);

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium',
      deadline TEXT,
      person TEXT NOT NULL DEFAULT '',
      source_email_id TEXT NOT NULL DEFAULT '',
      source_subject TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      suggested_reply TEXT
    );

    CREATE TABLE IF NOT EXISTS processed_emails (
      email_id TEXT PRIMARY KEY,
      processed_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);

    CREATE TABLE IF NOT EXISTS pomodoros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'work',
      completed INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_pomodoros_started ON pomodoros(started_at);

    CREATE TABLE IF NOT EXISTS project_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      project TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT '',
      activity TEXT NOT NULL,
      duration_minutes REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_project_sessions_ts ON project_sessions(timestamp);
    CREATE INDEX IF NOT EXISTS idx_project_sessions_project ON project_sessions(project);
  `);

  return db;
}

export function logSession(log: SessionLog): void {
  const d = getDb();
  const stmt = d.prepare(
    "INSERT INTO sessions (timestamp, activity, focus_mode, app_name, duration_minutes) VALUES (?, ?, ?, ?, ?)"
  );
  stmt.run(log.timestamp, log.activity, log.focusMode, log.appName, log.durationMinutes);
}

export function getRecentSessions(limit = 20): SessionLog[] {
  const d = getDb();
  const rows = d
    .prepare("SELECT * FROM sessions ORDER BY timestamp DESC LIMIT ?")
    .all(limit) as Array<{
    id: number;
    timestamp: number;
    activity: string;
    focus_mode: string;
    app_name: string;
    duration_minutes: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    activity: r.activity as ActivityState,
    focusMode: r.focus_mode as FocusMode,
    appName: r.app_name,
    durationMinutes: r.duration_minutes,
  }));
}

export function getTodayStats(): { totalMinutes: number; byActivity: Record<string, number> } {
  const d = getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const rows = d
    .prepare(
      "SELECT activity, SUM(duration_minutes) as total FROM sessions WHERE timestamp >= ? GROUP BY activity"
    )
    .all(startOfDay.getTime()) as Array<{ activity: string; total: number }>;

  const byActivity: Record<string, number> = {};
  let totalMinutes = 0;

  for (const row of rows) {
    byActivity[row.activity] = Math.round(row.total);
    totalMinutes += row.total;
  }

  return { totalMinutes: Math.round(totalMinutes), byActivity };
}

export function setState(key: string, value: string): void {
  const d = getDb();
  d.prepare(
    "INSERT OR REPLACE INTO state (key, value, updated_at) VALUES (?, ?, ?)"
  ).run(key, value, Date.now());
}

export function getState(key: string): string | null {
  const d = getDb();
  const row = d.prepare("SELECT value FROM state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ─── V2: Task Operations ────────────────────────────────────────

export function insertTask(task: ExtractedTask): number {
  const d = getDb();
  const result = d.prepare(`
    INSERT INTO tasks (title, description, priority, deadline, person, source_email_id, source_subject, status, created_at, suggested_reply)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.title,
    task.description,
    task.priority,
    task.deadline,
    task.person,
    task.sourceEmailId,
    task.sourceSubject,
    task.status,
    task.createdAt,
    task.suggestedReply,
  );
  return Number(result.lastInsertRowid);
}

interface TaskRow {
  id: number;
  title: string;
  description: string;
  priority: string;
  deadline: string | null;
  person: string;
  source_email_id: string;
  source_subject: string;
  status: string;
  created_at: number;
  suggested_reply: string | null;
}

function rowToTask(r: TaskRow): ExtractedTask {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    priority: r.priority as TaskPriority,
    deadline: r.deadline,
    person: r.person,
    sourceEmailId: r.source_email_id,
    sourceSubject: r.source_subject,
    status: r.status as TaskStatus,
    createdAt: r.created_at,
    suggestedReply: r.suggested_reply,
  };
}

export function getTasks(status?: TaskStatus): ExtractedTask[] {
  const d = getDb();
  if (status) {
    const rows = d.prepare(
      "SELECT * FROM tasks WHERE status = ? ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at DESC"
    ).all(status) as TaskRow[];
    return rows.map(rowToTask);
  }
  const rows = d.prepare(
    "SELECT * FROM tasks WHERE status != 'done' AND status != 'dismissed' ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at DESC"
  ).all() as TaskRow[];
  return rows.map(rowToTask);
}

export function updateTaskStatus(id: number, status: TaskStatus): void {
  const d = getDb();
  d.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
}

export function isEmailProcessed(emailId: string): boolean {
  const d = getDb();
  const row = d.prepare("SELECT email_id FROM processed_emails WHERE email_id = ?").get(emailId);
  return !!row;
}

export function markEmailProcessed(emailId: string): void {
  const d = getDb();
  d.prepare("INSERT OR IGNORE INTO processed_emails (email_id, processed_at) VALUES (?, ?)").run(emailId, Date.now());
}

// ─── V2: Behavioral Memory Queries ─────────────────────────────

/** Get sessions within a date range */
export function getSessionsByRange(fromTs: number, toTs: number): SessionLog[] {
  const d = getDb();
  const rows = d.prepare(
    "SELECT * FROM sessions WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp"
  ).all(fromTs, toTs) as Array<{
    id: number; timestamp: number; activity: string;
    focus_mode: string; app_name: string; duration_minutes: number;
  }>;
  return rows.map(r => ({
    id: r.id, timestamp: r.timestamp,
    activity: r.activity as ActivityState,
    focusMode: r.focus_mode as FocusMode,
    appName: r.app_name, durationMinutes: r.duration_minutes,
  }));
}

/** Get hourly activity distribution (across all history) */
export function getHourlyDistribution(): Array<{ hour: number; activity: string; totalMinutes: number }> {
  const d = getDb();
  const rows = d.prepare(`
    SELECT
      CAST(((timestamp / 1000) % 86400) / 3600 AS INTEGER) as hour,
      activity,
      SUM(duration_minutes) as total
    FROM sessions
    GROUP BY hour, activity
    ORDER BY hour
  `).all() as Array<{ hour: number; activity: string; total: number }>;
  return rows.map(r => ({ hour: r.hour, activity: r.activity, totalMinutes: r.total }));
}

/** Get daily summaries for the last N days */
export function getDailySummaries(days: number): Array<{ date: string; activity: string; totalMinutes: number }> {
  const d = getDb();
  const cutoff = Date.now() - days * 86400000;
  const rows = d.prepare(`
    SELECT
      DATE(timestamp / 1000, 'unixepoch', 'localtime') as date,
      activity,
      SUM(duration_minutes) as total
    FROM sessions
    WHERE timestamp >= ?
    GROUP BY date, activity
    ORDER BY date DESC
  `).all(cutoff) as Array<{ date: string; activity: string; total: number }>;
  return rows.map(r => ({ date: r.date, activity: r.activity, totalMinutes: r.total }));
}

/** Get the most-used apps and their total time */
export function getTopApps(limit = 10): Array<{ appName: string; totalMinutes: number; activity: string }> {
  const d = getDb();
  const rows = d.prepare(`
    SELECT app_name, activity, SUM(duration_minutes) as total
    FROM sessions
    GROUP BY app_name, activity
    ORDER BY total DESC
    LIMIT ?
  `).all(limit) as Array<{ app_name: string; activity: string; total: number }>;
  return rows.map(r => ({ appName: r.app_name, totalMinutes: r.total, activity: r.activity }));
}

/** Get total tracked days */
export function getTotalTrackedDays(): number {
  const d = getDb();
  const row = d.prepare(`
    SELECT COUNT(DISTINCT DATE(timestamp / 1000, 'unixepoch', 'localtime')) as days
    FROM sessions
  `).get() as { days: number };
  return row.days;
}

// ─── V2: Pomodoro Queries ───────────────────────────────────────

export interface PomoRow {
  id: number;
  started_at: number;
  ended_at: number;
  duration_minutes: number;
  type: string;
  completed: number;
}

export function logPomodoro(startedAt: number, endedAt: number, durationMinutes: number, type: "work" | "break", completed: boolean): void {
  const d = getDb();
  d.prepare(
    "INSERT INTO pomodoros (started_at, ended_at, duration_minutes, type, completed) VALUES (?, ?, ?, ?, ?)"
  ).run(startedAt, endedAt, durationMinutes, type, completed ? 1 : 0);
}

export function getTodayPomodoros(): PomoRow[] {
  const d = getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return d.prepare(
    "SELECT * FROM pomodoros WHERE started_at >= ? AND type = 'work' AND completed = 1 ORDER BY started_at"
  ).all(startOfDay.getTime()) as PomoRow[];
}

export function getPomodorosByRange(fromTs: number, toTs: number): PomoRow[] {
  const d = getDb();
  return d.prepare(
    "SELECT * FROM pomodoros WHERE started_at >= ? AND started_at < ? AND type = 'work' AND completed = 1 ORDER BY started_at"
  ).all(fromTs, toTs) as PomoRow[];
}

// ─── V2: Streak Queries ────────────────────────────────────────

/** Get dates that have a focus score >= threshold (from sessions data) */
export function getDaysWithMinScore(minScore: number, lookbackDays: number): string[] {
  // We use daily summaries to calculate; caller provides scored days.
  // This just returns distinct tracked dates in the lookback window.
  const d = getDb();
  const cutoff = Date.now() - lookbackDays * 86400000;
  const rows = d.prepare(`
    SELECT DISTINCT DATE(timestamp / 1000, 'unixepoch', 'localtime') as date
    FROM sessions
    WHERE timestamp >= ?
    ORDER BY date DESC
  `).all(cutoff) as Array<{ date: string }>;
  return rows.map(r => r.date);
}

// ─── V2: Project Session Queries ────────────────────────────────

export function logProjectSession(timestamp: number, project: string, branch: string, activity: string, durationMinutes: number): void {
  const d = getDb();
  d.prepare(
    "INSERT INTO project_sessions (timestamp, project, branch, activity, duration_minutes) VALUES (?, ?, ?, ?, ?)"
  ).run(timestamp, project, branch, activity, durationMinutes);
}

export interface ProjectSummary {
  project: string;
  totalMinutes: number;
  activities: Record<string, number>;
  branches: string[];
  lastSeen: number;
}

export function getProjectSummaries(days = 30): ProjectSummary[] {
  const d = getDb();
  const cutoff = Date.now() - days * 86400000;

  const rows = d.prepare(`
    SELECT project, activity, SUM(duration_minutes) as total, MAX(timestamp) as last_seen
    FROM project_sessions
    WHERE timestamp >= ?
    GROUP BY project, activity
    ORDER BY total DESC
  `).all(cutoff) as Array<{ project: string; activity: string; total: number; last_seen: number }>;

  const branchRows = d.prepare(`
    SELECT DISTINCT project, branch
    FROM project_sessions
    WHERE timestamp >= ? AND branch != ''
  `).all(cutoff) as Array<{ project: string; branch: string }>;

  const branchMap = new Map<string, Set<string>>();
  for (const r of branchRows) {
    if (!branchMap.has(r.project)) branchMap.set(r.project, new Set());
    branchMap.get(r.project)!.add(r.branch);
  }

  const map = new Map<string, ProjectSummary>();
  for (const r of rows) {
    if (!map.has(r.project)) {
      map.set(r.project, {
        project: r.project,
        totalMinutes: 0,
        activities: {},
        branches: [],
        lastSeen: r.last_seen,
      });
    }
    const s = map.get(r.project)!;
    s.totalMinutes += r.total;
    s.activities[r.activity] = (s.activities[r.activity] ?? 0) + r.total;
    if (r.last_seen > s.lastSeen) s.lastSeen = r.last_seen;
  }

  for (const [project, summary] of map) {
    summary.totalMinutes = Math.round(summary.totalMinutes);
    summary.branches = [...(branchMap.get(project) ?? [])];
    for (const act of Object.keys(summary.activities)) {
      summary.activities[act] = Math.round(summary.activities[act]!);
    }
  }

  return [...map.values()].sort((a, b) => b.totalMinutes - a.totalMinutes);
}

export function getTodayProjectTime(): Array<{ project: string; minutes: number }> {
  const d = getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const rows = d.prepare(`
    SELECT project, SUM(duration_minutes) as total
    FROM project_sessions
    WHERE timestamp >= ?
    GROUP BY project
    ORDER BY total DESC
  `).all(startOfDay.getTime()) as Array<{ project: string; total: number }>;
  return rows.map(r => ({ project: r.project, minutes: Math.round(r.total) }));
}

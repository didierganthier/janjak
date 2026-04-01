// ─── Core Types ─────────────────────────────────────────────

export type ActivityState = "coding" | "browsing" | "designing" | "writing" | "meeting" | "idle" | "unknown" | "social-media" | "entertainment" | "learning" | "email" | "communication" | "creative" | "reading";

export type FocusMode = "deep-work" | "casual" | "break" | "off";

export type EnergyLevel = "high" | "medium" | "low" | "drained";

export interface AppContext {
  appName: string;
  title: string;
  timestamp: number;
}

export interface UserState {
  activity: ActivityState;
  focusMode: FocusMode;
  energy: EnergyLevel;
  activeApp: AppContext | null;
  lastActivityAt: number;
  sessionStartedAt: number;
  idleMinutes: number;
}

export interface MusicPreference {
  activity: ActivityState;
  genre: string;
  spotifyPlaylistUri?: string;
  spotifyPlaylistName?: string;
}

export interface SessionLog {
  id?: number;
  timestamp: number;
  activity: ActivityState;
  focusMode: FocusMode;
  appName: string;
  durationMinutes: number;
}

export interface JanjakConfig {
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  spotifyRedirectUri?: string;
  spotifyRefreshToken?: string;
  idleThresholdMinutes: number;
  pollIntervalSeconds: number;
  musicEnabled: boolean;
  nudgesEnabled: boolean;
}

export const DEFAULT_CONFIG: JanjakConfig = {
  idleThresholdMinutes: 5,
  pollIntervalSeconds: 10,
  musicEnabled: true,
  nudgesEnabled: true,
};

// ─── V2: Email → Tasks Types ────────────────────────────────────

export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus = "pending" | "in-progress" | "done" | "dismissed";

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  body: string;
  date: number;
  labels: string[];
}

export interface ExtractedTask {
  id?: number;
  title: string;
  description: string;
  priority: TaskPriority;
  deadline: string | null;        // ISO date string or null
  person: string;                 // who assigned / related to
  sourceEmailId: string;
  sourceSubject: string;
  status: TaskStatus;
  createdAt: number;
  suggestedReply: string | null;  // AI-drafted reply
}

// ─── Music Controller: Controls Spotify via AppleScript (macOS) ────
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ActivityState } from "./types.js";

const execAsync = promisify(exec);

// Activity → Spotify playlist mapping (user can override via config later)
const PLAYLIST_MAP: Record<string, { uri: string; name: string }> = {
  coding: { uri: "spotify:playlist:0vvXsWCC9xrXsKd4FyS8kM", name: "Deep Focus" },
  writing: { uri: "spotify:playlist:0vvXsWCC9xrXsKd4FyS8kM", name: "Deep Focus" },
  designing: { uri: "spotify:playlist:37i9dQZF1DX6VdMW310YC7", name: "Chill Vibes" },
  browsing: { uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", name: "Today's Top Hits" },
  break: { uri: "spotify:playlist:37i9dQZF1DWZeKCadgRdKQ", name: "Lo-Fi Beats" },
};

async function runAppleScript(script: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function isSpotifyRunning(): Promise<boolean> {
  const result = await runAppleScript(
    'tell application "System Events" to (name of processes) contains "Spotify"'
  );
  return result === "true";
}

export async function playPlaylist(activity: ActivityState | "break"): Promise<string | null> {
  const playlist = PLAYLIST_MAP[activity];
  if (!playlist) return null;

  const running = await isSpotifyRunning();
  if (!running) {
    // Launch Spotify and wait a bit
    await runAppleScript('tell application "Spotify" to activate');
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  await runAppleScript(
    `tell application "Spotify"
play track "${playlist.uri}" in context "${playlist.uri}"
end tell`
  );

  return playlist.name;
}

export async function pauseMusic(): Promise<void> {
  const running = await isSpotifyRunning();
  if (running) {
    await runAppleScript('tell application "Spotify" to pause');
  }
}

export async function resumeMusic(): Promise<void> {
  const running = await isSpotifyRunning();
  if (running) {
    await runAppleScript('tell application "Spotify" to play');
  }
}

export async function getCurrentTrack(): Promise<string | null> {
  const running = await isSpotifyRunning();
  if (!running) return null;

  const state = await runAppleScript(
    'tell application "Spotify" to player state as string'
  );
  if (state !== "playing") return null;

  const track = await runAppleScript(
    'tell application "Spotify" to name of current track & " — " & artist of current track'
  );
  return track || null;
}

export function getPlaylistForActivity(activity: ActivityState | "break"): string {
  return PLAYLIST_MAP[activity]?.name ?? "None";
}

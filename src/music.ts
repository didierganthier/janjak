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

export interface CurrentTrackDetails {
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
  isPlaying: boolean;
  durationMs: number;
  positionSec: number;
  url: string | null;
}

/** Rich now-playing details from Spotify (title, artist, album, artwork, progress). */
export async function getCurrentTrackDetails(): Promise<CurrentTrackDetails | null> {
  const running = await isSpotifyRunning();
  if (!running) return null;

  const state = await runAppleScript(
    'tell application "Spotify" to player state as string'
  );
  if (state !== "playing" && state !== "paused") return null;

  const SEP = " ||JJ|| ";
  const raw = await runAppleScript(
    `tell application "Spotify"
      set t to name of current track
      set a to artist of current track
      set al to album of current track
      set art to artwork url of current track
      set dur to duration of current track
      set pos to player position
      set tid to id of current track
      return t & "${SEP}" & a & "${SEP}" & al & "${SEP}" & art & "${SEP}" & dur & "${SEP}" & pos & "${SEP}" & tid
    end tell`
  );
  if (!raw) return null;

  const parts = raw.split(SEP);
  const [title, artist, album, art, durStr, posStr, tid] = parts;
  const trackId = (tid ?? "").split(":").pop() ?? "";

  return {
    title: title ?? "",
    artist: artist ?? "",
    album: album ?? "",
    artworkUrl: art && art.startsWith("http") ? art : null,
    isPlaying: state === "playing",
    durationMs: Number(durStr) || 0,
    positionSec: Number(posStr) || 0,
    url: trackId ? `https://open.spotify.com/track/${trackId}` : null,
  };
}

export function getPlaylistForActivity(activity: ActivityState | "break"): string {
  return PLAYLIST_MAP[activity]?.name ?? "None";
}

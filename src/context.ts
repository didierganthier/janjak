// ─── Context Engine: Detects active app via macOS AppleScript ──────
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { AppContext } from "./types.js";

const execAsync = promisify(exec);

const APPLESCRIPT_GET_ACTIVE_APP = `
tell application "System Events"
  set frontApp to name of first application process whose frontmost is true
  set frontTitle to ""
  try
    tell process frontApp
      set frontTitle to name of front window
    end tell
  end try
  return frontApp & "|||" & frontTitle
end tell
`;

export async function getActiveWindow(): Promise<AppContext | null> {
  try {
    const { stdout } = await execAsync(`osascript -e '${APPLESCRIPT_GET_ACTIVE_APP.replace(/'/g, "'\\''")}'`);
    const parts = stdout.trim().split("|||");
    const appName = parts[0]?.trim() ?? "Unknown";
    const title = parts[1]?.trim() ?? "";

    return {
      appName,
      title,
      timestamp: Date.now(),
    };
  } catch {
    // Fallback: try the active-win package
    try {
      const activeWin = await import("active-win");
      const win = await activeWin.default();
      if (!win) return null;
      return {
        appName: win.owner.name,
        title: win.title,
        timestamp: Date.now(),
      };
    } catch {
      return null;
    }
  }
}

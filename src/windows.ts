// ─── Window Snapshot: enumerate open macOS app windows ─────────────
// Used for diagnostics and broader machine context beyond frontmost app.

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface OpenWindow {
  appName: string;
  title: string;
}

const APPLESCRIPT_GET_OPEN_WINDOWS = `
tell application "System Events"
  set output to ""
  repeat with proc in (application processes where background only is false)
    set procName to name of proc
    try
      repeat with w in windows of proc
        try
          set winTitle to name of w
          if winTitle is not "" then
            set output to output & procName & "|||" & winTitle & linefeed
          end if
        end try
      end repeat
    end try
  end repeat
  return output
end tell
`;

export async function getOpenWindows(): Promise<OpenWindow[]> {
  try {
    const { stdout } = await execAsync(`osascript -e '${APPLESCRIPT_GET_OPEN_WINDOWS.replace(/'/g, "'\\''")}'`, {
      maxBuffer: 1024 * 1024,
    });

    const rows = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const windows: OpenWindow[] = [];
    for (const row of rows) {
      const [appNameRaw, titleRaw] = row.split("|||");
      const appName = appNameRaw?.trim() ?? "";
      const title = titleRaw?.trim() ?? "";
      if (!appName || !title) continue;
      windows.push({ appName, title });
    }

    return windows;
  } catch {
    return [];
  }
}

export function formatOpenWindows(windows: OpenWindow[], limit = 40): string {
  if (windows.length === 0) {
    return "\n🪟 No open windows found (or permission denied).\n";
  }

  const shown = windows.slice(0, limit);
  let output = `\n🪟 Open Windows (${windows.length})\n`;
  output += "═".repeat(64) + "\n";

  for (const w of shown) {
    const title = w.title.length > 70 ? `${w.title.slice(0, 67)}...` : w.title;
    output += `\n  ${w.appName}`;
    output += `\n    ${title}`;
  }

  if (windows.length > shown.length) {
    output += `\n\n  ...and ${windows.length - shown.length} more.`;
  }

  output += "\n";
  return output;
}

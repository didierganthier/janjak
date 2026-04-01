// ─── Auto-Start: macOS LaunchAgent for login startup ────────────────
// Installs/uninstalls a LaunchAgent so Janjak runs `janjak watch`
// automatically at login. Logs to ~/.janjak/daemon.log.

import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const LABEL = "com.janjak.daemon";
const PLIST_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST_PATH = join(PLIST_DIR, `${LABEL}.plist`);
const LOG_PATH = join(homedir(), ".janjak", "daemon.log");
const ERR_LOG_PATH = join(homedir(), ".janjak", "daemon-error.log");

function getNodePath(): string {
  try {
    return execSync("which node", { encoding: "utf8", timeout: 3000 }).trim();
  } catch {
    return "/usr/local/bin/node";
  }
}

function getJanjakPath(): string {
  try {
    return execSync("which janjak", { encoding: "utf8", timeout: 3000 }).trim();
  } catch {
    // Fallback to global npm bin
    return join(homedir(), ".npm-global", "bin", "janjak");
  }
}

function buildPlist(): string {
  const nodePath = getNodePath();
  const janjakPath = getJanjakPath();

  // Resolve the actual script path (janjak is a symlink)
  let scriptPath: string;
  try {
    const target = execSync(`readlink -f "${janjakPath}"`, { encoding: "utf8", timeout: 3000 }).trim();
    scriptPath = target || janjakPath;
  } catch {
    scriptPath = janjakPath;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>watch</string>
    <string>--interval</string>
    <string>30</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${ERR_LOG_PATH}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
  <key>ThrottleInterval</key>
  <integer>60</integer>
</dict>
</plist>`;
}

export function installAutoStart(): string {
  try {
    const plist = buildPlist();
    writeFileSync(PLIST_PATH, plist);

    // Load the agent
    try {
      execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { stdio: "ignore" });
    } catch { /* may not be loaded */ }
    execSync(`launchctl load "${PLIST_PATH}"`, { timeout: 5000 });

    return `✅ Janjak will now start automatically at login.
   Config: ${PLIST_PATH}
   Logs:   ${LOG_PATH}

   Janjak runs \`janjak watch --interval 30\` in the background,
   tracking your activity and sending nudges.

   To stop: janjak autostart off
   To check: launchctl list | grep janjak`;
  } catch (err) {
    return `❌ Failed to install LaunchAgent: ${err instanceof Error ? err.message : err}`;
  }
}

export function uninstallAutoStart(): string {
  try {
    if (existsSync(PLIST_PATH)) {
      try {
        execSync(`launchctl unload "${PLIST_PATH}"`, { timeout: 5000, stdio: "ignore" });
      } catch { /* may not be loaded */ }
      unlinkSync(PLIST_PATH);
      return "✅ Auto-start disabled. Janjak will no longer run at login.";
    }
    return "ℹ️  Auto-start was not enabled.";
  } catch (err) {
    return `❌ Failed to uninstall: ${err instanceof Error ? err.message : err}`;
  }
}

export function autoStartStatus(): string {
  if (!existsSync(PLIST_PATH)) {
    return "⬜ Auto-start: OFF\n   Enable with: janjak autostart on";
  }

  // Check if actually running
  try {
    const out = execSync(`launchctl list 2>/dev/null | grep ${LABEL}`, {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    if (out) {
      return `✅ Auto-start: ON (running)\n   Config: ${PLIST_PATH}`;
    }
  } catch { /* not running */ }

  return `⚠️  Auto-start: ON (not running)\n   Try: launchctl load "${PLIST_PATH}"`;
}

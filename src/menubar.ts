// ─── Menu Bar: Build + launch macOS status bar app ──────────────────
// Compiles the Swift menu bar app on first run, then launches it.
// Requires janjak web to be running (polls localhost:3547).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_PATH = join(homedir(), ".janjak", "JanjakMenuBar.app");
const BUILD_SCRIPT = join(__dirname, "..", "scripts", "build-menubar-app.sh");

export function isMenuBarBuilt(): boolean {
  return existsSync(join(APP_PATH, "Contents", "MacOS", "JanjakMenuBar"));
}

export function buildMenuBar(): boolean {
  try {
    console.log("🔧 Building menu bar app...\n");
    execSync(`bash "${BUILD_SCRIPT}"`, { stdio: "inherit", timeout: 60000 });
    return true;
  } catch (err) {
    console.error("❌ Build failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export function launchMenuBar(): void {
  if (!isMenuBarBuilt()) {
    if (!buildMenuBar()) return;
  }

  console.log("🧠 Launching Janjak menu bar...");
  spawn("open", [APP_PATH], { detached: true, stdio: "ignore" }).unref();
  console.log("   ✅ Menu bar app running. Look for 🧠 in your status bar.");
  console.log("   ℹ️  Requires `janjak web` to be running for live data.");
}

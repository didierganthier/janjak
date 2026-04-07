// ─── Overlay: Build + launch the global hotkey overlay app ──────────
// Compiles the Swift overlay app on first run, then launches it.
// Requires janjak daemon to be running (connects to localhost:7777).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_PATH = join(homedir(), ".janjak", "JanjakOverlay.app");
const BUILD_SCRIPT = join(__dirname, "..", "scripts", "build-overlay-app.sh");

export function isOverlayBuilt(): boolean {
  return existsSync(join(APP_PATH, "Contents", "MacOS", "JanjakOverlay"));
}

export async function buildOverlay(): Promise<boolean> {
  try {
    console.log("🔧 Building overlay app...\n");
    execSync(`bash "${BUILD_SCRIPT}"`, { stdio: "inherit", timeout: 60000 });
    return true;
  } catch (err) {
    console.error("❌ Build failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export function launchOverlay(): void {
  if (!isOverlayBuilt()) {
    console.error("❌ Overlay not built. Run: janjak overlay");
    return;
  }

  console.log("🧠 Launching Janjak overlay...");
  spawn("open", [APP_PATH], { detached: true, stdio: "ignore" }).unref();
  console.log("   ✅ Overlay running. Press ⌘⇧J from anywhere to activate.");
  console.log("   ℹ️  Hold Space to talk, release to send.");
}

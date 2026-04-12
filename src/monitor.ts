// ─── Ambient Monitor: Background polling loop ─────────────────────
import { poll, getNudge, getStatus, formatStatus } from "./engine.js";
import { getCurrentTrack } from "./music.js";
import { evaluateWorkflows } from "./workflows.js";
import { getOpenTabs, recordBrowserSnapshot, formatBrowserSummary } from "./browser.js";

type MonitorCallback = (message: string) => void;
type RenderCallback = (status: string) => void;

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastNudge: string | null = null;
let onNudge: MonitorCallback | null = null;
let onRender: RenderCallback | null = null;

export function startMonitor(
  pollIntervalMs: number = 10000,
  callbacks?: { onNudge?: MonitorCallback; onRender?: RenderCallback }
): void {
  if (intervalId) {
    return; // Already running
  }

  onNudge = callbacks?.onNudge ?? null;
  onRender = callbacks?.onRender ?? null;

  intervalId = setInterval(async () => {
    try {
      const state = await poll();

      // Re-render status on every tick
      if (onRender) {
        let display = formatStatus(state);
        const track = await getCurrentTrack();
        if (track) {
          display += `\n  🎵 Now playing: ${track}`;
        }
        onRender(display);
      }

      // Evaluate workflow triggers on every tick
      await evaluateWorkflows();

      // Track browser tabs
      try {
        const tabs = getOpenTabs();
        recordBrowserSnapshot(tabs, Math.round(pollIntervalMs / 1000));
      } catch { /* browser tracking is non-critical */ }

      const nudge = getNudge();

      // Only emit a nudge if it's different from the last one
      if (nudge && nudge !== lastNudge) {
        lastNudge = nudge;
        if (onNudge) {
          onNudge(nudge);
        }
      }
    } catch {
      // Silently continue — ambient system should never crash
    }
  }, pollIntervalMs);
}

export function stopMonitor(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function isMonitorRunning(): boolean {
  return intervalId !== null;
}

export async function getStatusReport(): Promise<string> {
  const state = await poll();
  let report = formatStatus(state);

  const track = await getCurrentTrack();
  if (track) {
    report += `\n  🎵 Now playing: ${track}`;
  }

  const browserLine = formatBrowserSummary();
  if (browserLine) {
    report += browserLine;
  }

  const nudge = getNudge();
  if (nudge) {
    report += `\n\n  ${nudge}`;
  }

  return report;
}

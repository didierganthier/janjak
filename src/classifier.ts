// ─── State Classifier: Infers what you're doing from active app ────
import type { ActivityState, AppContext } from "./types.js";

// App → Activity mapping (easily extensible)
const APP_RULES: Array<{ pattern: RegExp; activity: ActivityState }> = [
  // Coding
  { pattern: /code|intellij|webstorm|vim|neovim|terminal|iterm|warp|hyper|alacritty|kitty|xcode|android studio/i, activity: "coding" },
  // Designing
  { pattern: /figma|sketch|photoshop|illustrator|canva|affinity/i, activity: "designing" },
  // Creative (music/video production)
  { pattern: /logic pro|garageband|ableton|fl studio|final cut|davinci|imovie|premiere|after effects|blender/i, activity: "creative" },
  // Writing
  { pattern: /notion|obsidian|bear|pages|word|google docs|typora|ia writer|ulysses|scrivener/i, activity: "writing" },
  // Email
  { pattern: /mail|outlook|spark|airmail|mimestream|superhuman/i, activity: "email" },
  // Communication / Messaging
  { pattern: /whatsapp|telegram|signal|messages|messenger|slack|discord/i, activity: "communication" },
  // Meetings
  { pattern: /zoom|teams|meet|slack.*huddle|facetime|discord.*voice/i, activity: "meeting" },
  // Reading
  { pattern: /kindle|books|pdf|preview.*\.pdf|reeder|readwise/i, activity: "reading" },
  // Learning
  { pattern: /anki|quizlet|duolingo/i, activity: "learning" },
  // Browsing (catch-all for browsers)
  { pattern: /safari|chrome|firefox|brave|edge|arc|opera/i, activity: "browsing" },
];

// Title-based refinement (browser tabs can reveal intent)
const TITLE_RULES: Array<{ pattern: RegExp; activity: ActivityState }> = [
  // Coding
  { pattern: /github\.com|gitlab|stackoverflow|docs\.|mdn|api\s*reference|codepen|replit/i, activity: "coding" },
  // Writing
  { pattern: /google docs|notion\.so|medium\.com.*write|substack.*write/i, activity: "writing" },
  // Designing
  { pattern: /figma\.com|dribbble/i, activity: "designing" },
  // Meetings
  { pattern: /meet\.google|zoom\.us/i, activity: "meeting" },
  // Learning
  { pattern: /coursera|udemy|edx|khan\s*academy|skillshare|brilliant|leetcode|hackerrank|duolingo/i, activity: "learning" },
  // Reading
  { pattern: /medium\.com|substack\.com|arxiv|wikipedia|pocket|instapaper/i, activity: "reading" },
  // Social Media (distinct from browsing)
  { pattern: /twitter\.com|x\.com|instagram|tiktok|facebook|linkedin|threads|mastodon|bluesky/i, activity: "social-media" },
  // Entertainment
  { pattern: /youtube|netflix|hulu|disney|twitch|spotify|apple.*music|hbo|prime.*video/i, activity: "entertainment" },
  // Email in browser
  { pattern: /mail\.google|outlook\.live|proton\.me.*mail/i, activity: "email" },
  // Reddit (browsing)
  { pattern: /reddit\.com/i, activity: "browsing" },
];

export function classifyActivity(context: AppContext | null): ActivityState {
  if (!context) return "idle";

  // First try title-based (more specific)
  for (const rule of TITLE_RULES) {
    if (rule.pattern.test(context.title)) {
      return rule.activity;
    }
  }

  // Then app-based
  for (const rule of APP_RULES) {
    if (rule.pattern.test(context.appName)) {
      return rule.activity;
    }
  }

  return "unknown";
}

export function getActivityEmoji(activity: ActivityState): string {
  const map: Record<ActivityState, string> = {
    coding: "💻",
    browsing: "🌐",
    designing: "🎨",
    writing: "✍️",
    meeting: "📞",
    idle: "😴",
    unknown: "❓",
    "social-media": "📱",
    entertainment: "🎬",
    learning: "📚",
    email: "📧",
    communication: "💬",
    creative: "🎹",
    reading: "📖",
  };
  return map[activity] ?? "❓";
}

export function getActivityLabel(activity: ActivityState): string {
  const map: Record<ActivityState, string> = {
    coding: "Deep coding session",
    browsing: "Browsing the web",
    designing: "Design work",
    writing: "Writing",
    meeting: "In a meeting",
    idle: "Idle / AFK",
    unknown: "Doing something",
    "social-media": "Social media",
    entertainment: "Entertainment",
    learning: "Learning / Studying",
    email: "Checking email",
    communication: "Messaging",
    creative: "Creative work",
    reading: "Reading",
  };
  return map[activity] ?? "Doing something";
}

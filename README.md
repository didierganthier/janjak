# 🧠 Janjak

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)]()

**Your ambient intelligence assistant.**

> Observes → Infers → Assists → Stays out of the way.

Janjak is a CLI-first personal AI that understands what you're doing, predicts what you need, and subtly acts. Think Jarvis for builders — context-aware, autonomous, and minimal.

Built with TypeScript, SQLite, macOS AppleScript, OpenAI, and Gmail API.

---

## ⚡ Quick Start

```bash
# Easiest — one-line installer (clones, builds, links, builds the menu bar app)
curl -fsSL https://raw.githubusercontent.com/didierganthier/janjak/main/install.sh | bash

# Or install from npm
npm install -g janjak

# Check your current state
janjak status

# Enter deep work mode (detects activity + plays music + suggests a task)
janjak focus

# Take a break
janjak break

# End session
janjak stop
```

> Prefer not to touch the terminal? After installing, run `janjak menubar` for the
> macOS menu bar app or `janjak web` for the dashboard — the CLI is just the engine.

---

## 📖 All Commands

### Core — Focus & Monitoring

| Command | Description |
|---------|-------------|
| `janjak focus` | Enter deep work mode. Plays focus music, suggests a task to tackle. |
| `janjak break` | Take a break. Logs session, plays chill music. |
| `janjak stop` | End current session. Pauses music. |
| `janjak status` | Show current state: activity, energy, session time. |
| `janjak watch` | Start ambient monitoring. Polls every 10s, nudges when needed. |
| `janjak watch --notify` | Same, but also sends macOS desktop notifications for nudges. |
| `janjak music` | Now playing. Also: `pause`, `resume`. |

### Intelligence — AI & Memory

| Command | Description |
|---------|-------------|
| `janjak ask "<question>"` | Ask anything about your work patterns in natural language. |
| `janjak day` | Today's activity breakdown + smart suggestions from memory. |
| `janjak day --ai` | AI-powered daily plan with personalized action items. |
| `janjak insights` | What Janjak has learned: peak hours, top apps, trends. |
| `janjak score` | Today's focus score (0-100). |
| `janjak week` | Weekly focus report with daily scores and trend chart. |
| `janjak week --ai` | Adds AI-generated weekly summary. |
| `janjak notify` | Send a test desktop notification. |

### Super Brain — Memory, Knowledge & Learning

Janjak's 5-layer "super brain": it remembers, builds a model of you, learns from feedback, and consolidates over time.

| Command | Description |
|---------|-------------|
| `janjak note "<text>"` | Capture a note into semantic memory. |
| `janjak recall "<query>"` | Semantic search across everything Janjak remembers. |
| `janjak recall -t <type>` | Filter recall by source (note, email, voice, calendar, …). |
| `janjak memory` | List recent stored memories. |
| `janjak ingest` | Backfill semantic memory from existing tasks and sessions. |
| `janjak who "<name>"` | Profile of a person/project/topic from the knowledge graph. |
| `janjak network "<name>"` | Show an entity's relationships and connections. |
| `janjak entities` | List the strongest entities Janjak knows. |
| `janjak knows` | What Janjak has learned about you — goals, preferences, routines. |
| `janjak knows --refresh` | Re-synthesize the personal model from recent behavior first. |
| `janjak goal add "<text>"` | Add a goal Janjak aligns its help with (`-c` category, `-p` priority, `-d` due). |
| `janjak goal list` | List your goals (`--all` to include completed). |
| `janjak prefer <category> <key> <value>` | State a preference explicitly (highest confidence). |
| `janjak why [id\|last]` | Explain a decision Janjak made — full evidence trail. |
| `janjak feedback` | Acceptance/rejection rates for Janjak's actions (`--days N`). |
| `janjak adapt` | Run an adaptation pass — adjust behavior from captured feedback. |
| `janjak consolidate` | Force a consolidation pass (day summary, model refresh, forgetting curve). |
| `janjak summary today` | Synthesized summary of today. |
| `janjak summary week` | Weekly review: what you worked on, pattern changes, new entities, goals. |
| `janjak review` | Interactive weekly review — confirm goals & preferences to lock them in. |

### Privacy & Data Control

You own every byte. Everything is stored locally in SQLite at `~/.janjak/`; only embedding requests (text in, vector out) ever leave your machine.

| Command | Description |
|---------|-------------|
| `janjak memory -t <type>` | See everything stored from a given source. |
| `janjak note --no-embed "<text>"` | Store a sensitive note locally without sending it to the embedding API. |
| `janjak forget <id>` | Hard-delete a single memory (and its embedding). |
| `janjak forget --entity "<name>"` | Delete an entity and all of its related memories, mentions & relationships. |
| `janjak forget-pref <id>` | Delete a learned preference. |
| `janjak export` | Export all memory, entities, preferences, goals & routines as JSON. |
| `janjak export --out <file>` | Export to a specific path. |

### Productivity — Pomodoro, Streaks & Projects

| Command | Description |
|---------|-------------|
| `janjak pomo` | Start a Pomodoro timer (25/5 cycles). Auto-cycles focus/break. |
| `janjak pomo -w 30 -s 10` | Custom work/break durations. |
| `janjak streak` | Show your focus streak, milestones, and badges. |
| `janjak projects` | Time spent per project (auto-detected from window titles). |
| `janjak project` | Show the project inferred from your currently active window. |
| `janjak projects -d 30` | Look back 30 days instead of 7. |
| `janjak windows` | List currently open app windows across the machine (macOS snapshot). |
| `janjak dash` | Launch the interactive real-time dashboard (TUI). |
| `janjak dash --notify` | Dashboard with desktop notifications enabled. |
| `janjak autostart on` | Auto-start Janjak at login (macOS LaunchAgent). |
| `janjak autostart off` | Disable auto-start. |
| `janjak autostart` | Check auto-start status. |

### Email & Tasks

| Command | Description |
|---------|-------------|
| `janjak login` | Authenticate with Gmail + Google Calendar (one-time). |
| `janjak inbox` | Scan emails → AI extracts tasks → briefing. |
| `janjak tasks` | Show all pending tasks. |
| `janjak start <id>` | Mark a task as in-progress. |
| `janjak done <id>` | Mark a task as done. |
| `janjak dismiss <id>` | Dismiss a task. |
| `janjak reply <id>` | AI-draft a reply to an email. |
| `janjak draft <id>` | Draft + open reply in Gmail. |
| `janjak remind "<text>"` | Create a task + calendar event from natural language. |

### Autonomy & Workflows

| Command | Description |
|---------|-------------|
| `janjak autonomy on` | Enable autonomous mode — Janjak acts on its own. |
| `janjak autonomy off` | Disable autonomous mode. |
| `janjak autonomy status` | Show autonomy config, registered actions, pending. |
| `janjak autonomy log` | Show recent autonomous actions taken. |
| `janjak autonomy tier auto off` | Disable a specific safety tier. |
| `janjak autonomy cancel` | Cancel pending confirm-tier actions. |
| `janjak workflow list` | Show all workflows (built-in + custom). |
| `janjak workflow enable <id>` | Enable a workflow. |
| `janjak workflow disable <id>` | Disable a workflow. |
| `janjak workflow run <id>` | Manually trigger a workflow. |
| `janjak workflow log` | Show recent workflow executions. |
| `janjak workflow add <id> <trigger> "<cmd>"` | Create a custom workflow. |
| `janjak workflow remove <id>` | Remove a custom workflow. |

### Voice, Briefing & Web

| Command | Description |
|---------|-------------|
| `janjak voice` | Talk to Janjak (Whisper STT → AI → OpenAI TTS). |
| `janjak voice --loop` | Continuous voice conversation mode. |
| `janjak voice --voice shimmer` | Choose TTS voice (alloy/echo/fable/onyx/nova/shimmer). |
| `janjak morning` | AI morning briefing (calendar, inbox, tasks, plan). |
| `janjak morning --ai` | Briefing with AI-generated daily plan. |
| `janjak web` | Launch the web dashboard. |
| `janjak menubar` | Launch macOS menu bar app. |
| `janjak setup` | Interactive setup wizard (guided configuration). |
| `janjak reset` | Clear tracked data and start a fresh session (keeps credentials/config). |
| `janjak reset --all` | Full local wipe: DB, tokens, workflows, and logs (keeps `.env` + Google credentials). |

---

## 🧩 Architecture

```
src/
├── index.ts        # CLI entry point (Commander.js)
├── types.ts        # Core type definitions
├── context.ts      # Active window detection (AppleScript + fallback)
├── classifier.ts   # Activity classifier (app → coding/browsing/designing/etc.)
├── engine.ts       # Focus engine (state machine + smart task suggestions)
├── music.ts        # Spotify controller (AppleScript on macOS)
├── monitor.ts      # Ambient polling loop + nudge system
├── planner.ts      # Day overview + AI daily planner (OpenAI)
├── memory.ts       # Behavioral memory engine (pattern analysis)
├── score.ts        # Focus score calculator + weekly reports
├── chat.ts         # Natural language chat (ask Janjak anything)
├── voice.ts        # Voice commands (Whisper STT → AI → OpenAI TTS)
├── morning.ts      # AI morning briefing (calendar/inbox/tasks/plan)
├── nl-tasks.ts     # Natural language → task + calendar event creation
├── notify.ts       # macOS desktop notifications (Swift UserNotifications)
├── proactive.ts    # Proactive notification engine (7 signal sources)
├── pomo.ts         # Pomodoro timer (25/5 auto-cycling with notifications)
├── streak.ts       # Daily streak tracker + gamification badges
├── project.ts      # Project detection from window titles + per-project tracking
├── dashboard.ts    # Interactive real-time TUI dashboard (ANSI)
├── web.ts          # Web dashboard server (Express-like HTTP)
├── menubar.ts      # macOS menu bar app (Swift NSStatusBar)
├── autonomy.ts     # Autonomous action executor (safety-tiered)
├── workflows.ts    # Workflow automation engine (trigger → shell command)
├── reply.ts        # AI email reply drafter
├── autostart.ts    # macOS LaunchAgent for auto-start at login
├── setup.ts        # Interactive setup wizard
├── db.ts           # SQLite: sessions, tasks, memory, entities, preferences, goals, feedback, state
├── gmail-auth.ts   # Google OAuth2 authentication flow (Gmail + Calendar)
├── gmail-client.ts # Gmail API client (fetch + parse emails)
├── email-parser.ts # AI email analyzer (OpenAI → extract tasks)
├── calendar.ts     # Google Calendar (read events + create events)
├── github.ts       # GitHub integration (PRs, issues, notifications)
├── tasks.ts        # Task manager (email→task pipeline + CRUD)
├── privacy.ts      # Local data export (memory/entities/preferences as JSON)
├── memory/         # Layer 1 — Semantic memory (embeddings + vector store)
│   ├── embeddings.ts   # OpenAI text-embedding-3-small wrapper
│   ├── vector-store.ts # SQLite BLOB vectors + cosine search + tier gating
│   ├── recall.ts       # capture() + recall() public API
│   └── ingest.ts       # Backfill embeddings from tasks/sessions
├── graph/          # Layer 2 — Entity knowledge graph
│   ├── entities.ts     # Entity CRUD, mentions, cascade delete
│   ├── relationships.ts# Entity relationships
│   ├── extractor.ts    # AI entity/relationship extraction
│   └── query.ts        # Profiles, networks, prompt context
├── personal/       # Layer 3 — Personal model
│   ├── profile.ts      # Preferences (observed/stated/inferred + decay)
│   ├── goals.ts        # Goals
│   ├── routines.ts     # Routines
│   └── synthesis.ts    # Derive model from behavior + prompt injection
├── learning/       # Layer 4 — Learning loop
│   ├── feedback.ts     # Capture action outcomes + acceptance rates
│   ├── explain.ts      # Decision log powering `janjak why`
│   └── adapt.ts        # Turn feedback into behavior changes
└── synthesis/      # Layer 5 — Synthesis
    ├── tiers.ts        # Memory tiers + forgetting curve
    ├── consolidate.ts  # Promote/decay memory + entity upkeep
    ├── daily.ts        # Nightly day summary + consolidation pass
    └── weekly.ts       # Weekly review gathering + formatting
web/
├── index.html      # Web dashboard (live charts + panels)
└── setup.html      # Interactive setup wizard UI
```

### How It Works

1. **Context Engine** — Detects your active app via macOS AppleScript
2. **Classifier** — Maps apps/titles to activities: `coding`, `browsing`, `designing`, `writing`, `meeting`, `idle`
3. **Focus Engine** — Manages state transitions, tracks sessions, estimates energy, suggests tasks
4. **Behavioral Memory** — Analyzes all historical sessions to learn your patterns (peak hours, trends, habits)
5. **Focus Score** — Calculates daily productivity score (0-100) from weighted activity, focus ratio, and engagement
6. **AI Chat** — Feeds your full profile to GPT-4o-mini for natural language Q&A about your work
7. **Music Controller** — Auto-plays Spotify playlists matched to your current activity
8. **Monitor** — Background polling with nudges (90min deep work? idle 5min? peak hour reminder)
9. **Desktop Notifications** — Native macOS notifications via custom Swift app (UserNotifications framework)
10. **Email → Tasks** — Gmail + OpenAI pipeline: fetches emails, extracts tasks, stores locally
11. **Pomodoro Timer** — 25/5 auto-cycling with long breaks every 4 cycles, notifications, DB logging
12. **Daily Streaks** — Consecutive days with focus score ≥50, milestones (🔥 7-day, ⚡ 30-day, etc.)
13. **Project Detection** — Infers project from VS Code/Xcode/IntelliJ/Terminal window titles, tracks time per project
14. **Interactive Dashboard** — Full-screen TUI with live panels (status, score, tasks, music, projects, nudges)
15. **Auto-Start** — macOS LaunchAgent starts Janjak at login, runs `watch` in background
16. **Database** — SQLite stores sessions, tasks, pomodoros, project sessions, state. Builds your behavioral memory over time.
17. **Autonomy** — Safety-tiered action executor: auto (immediate), confirm (10s delay), suggest (notify only)
18. **Workflows** — Context-triggered shell command runner with blocked command safety checks, env var injection, and cooldowns

---

## 🔧 Setup

### Prerequisites

- **macOS** (for AppleScript window detection, Spotify control, notifications)
- **Node.js** 18+
- **Spotify** installed (for music features)

### Installation

**Option 1 — One-line installer (recommended):**
```bash
curl -fsSL https://raw.githubusercontent.com/didierganthier/janjak/main/install.sh | bash
```

**Option 2 — npm:**
```bash
npm install -g janjak
```

**Option 3 — From source (for development):**
```bash
git clone https://github.com/didierganthier/janjak.git
cd janjak
npm install
npm run build
npm link
```

### Configuration

All config lives in `~/.janjak/`:

```bash
~/.janjak/
├── .env                    # OPENAI_API_KEY=sk-...
├── janjak.db              # SQLite database (auto-created)
├── gmail-credentials.json # Google OAuth credentials
├── gmail-tokens.json      # Gmail auth tokens (auto-created)
├── JanjakNotify.app/      # Swift notification app (auto-built)
├── daemon.log             # Auto-start stdout log
└── daemon-error.log       # Auto-start error log
```

**OpenAI (required for AI features):**
```bash
mkdir -p ~/.janjak
echo "OPENAI_API_KEY=sk-..." > ~/.janjak/.env
```

**Gmail + Calendar (required for email→tasks, reminders, calendar events):**
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a project → Enable **Gmail API** + **Google Calendar API**
3. Create OAuth2 credentials (Desktop app)
4. Download JSON → save as `~/.janjak/gmail-credentials.json`
5. Run `janjak login` to authenticate

> **Tip:** Run `janjak setup` for an interactive guided setup that walks you through everything.

---

## 🎧 Music

Janjak controls Spotify via AppleScript (macOS). Playlists auto-match your activity:

| Activity   | Playlist         |
|-----------|------------------|
| Coding     | Deep Focus       |
| Writing    | Deep Focus       |
| Designing  | Chill Vibes      |
| Browsing   | Today's Top Hits |
| Break      | Lo-Fi Beats      |

---

## 🧠 AI Features

All AI features use **gpt-4o-mini** for fast, cheap inference. Requires `OPENAI_API_KEY`.

- **`janjak ask`** — conversational access to all your data. Ask "what did I do yesterday?", "when am I most productive?", "what tasks should I focus on?"
- **`janjak day --ai`** — personalized daily plan based on your stats + tasks + behavioral patterns
- **`janjak week --ai`** — AI weekly summary with actionable suggestions
- **`janjak inbox`** — AI email analysis: extracts tasks, priorities, deadlines, suggested replies
- **`janjak reply <id>`** — AI-drafted contextual email replies
- **`janjak remind "..."`** — Natural language task + Google Calendar event creation
- **`janjak voice`** — Talk to Janjak like Siri. Supports 50+ languages, runs actions (break, focus, inbox scan)
- **`janjak morning`** — AI morning briefing: calendar, inbox, tasks, focus trends, daily plan

---

## 🤖 Autonomy & Workflows

Janjak can act on its own — no command needed. The autonomy system executes safe actions based on proactive alerts, and the workflow engine runs shell commands when your context changes.

### Try It Now — Quick Test

```bash
# 1. See what autonomous actions are available
janjak autonomy status

# 2. See all workflows (built-in + custom)
janjak workflow list

# 3. Manually run a workflow to see it work
janjak workflow run git-status-on-return

# 4. Create a custom workflow (runs when you enter focus mode)
janjak workflow add hello-focus focus_start "echo '🎯 Focus mode! Let\'s go!' && date"

# 5. Test your custom workflow
janjak workflow run hello-focus

# 6. Enable autonomy — Janjak will now act on proactive alerts
janjak autonomy on

# 7. Start watching — autonomy + workflows fire automatically
janjak watch --notify

# 8. In another terminal, trigger focus mode and see your workflow fire:
janjak focus

# 9. Check what happened
janjak autonomy log
janjak workflow log

# 10. Clean up when done
janjak workflow remove hello-focus
janjak autonomy off
```

### Autonomy Safety Tiers

| Tier | Behavior | Actions |
|------|----------|--------|
| ⚡ **Auto** | Executes immediately | Enter focus, take break, pause/resume music |
| ⏳ **Confirm** | Notifies first, 10s delay (cancellable) | Join Google Meet / Zoom / Teams |
| 💬 **Suggest** | Advisory only (notification) | Everything else |

All autonomous actions are logged and you get a macOS notification showing what was done.

### Built-in Workflows

| Workflow | Trigger | Default | Description |
|----------|---------|---------|-------------|
| Git Stash Before Meeting | Meeting in 5m | ✅ On | Auto-stashes uncommitted changes |
| Git Status on Return | Return from idle | ✅ On | Shows changed files + branch |
| Log Project Switch | Project switch | ✅ On | Logs context switches |
| Run Tests After Long Session | 45m coding | ❌ Off | Runs `npm test` |
| macOS DND in Focus Mode | Focus start | ❌ Off | Toggles Do Not Disturb |
| macOS DND Off on Break | Break start | ❌ Off | Turns off DND |

### Custom Workflows

Create your own workflows that run shell commands when your context changes:

```bash
# Quit Slack when entering focus mode
janjak workflow add quit-slack focus_start 'osascript -e "tell application \"Slack\" to quit"'

# Update Slack status when you start focusing
janjak workflow add slack-status focus_start 'curl -s -X POST https://slack.com/api/users.profile.set -H "Authorization: Bearer $SLACK_TOKEN" -d "profile={\"status_text\":\"Deep work\",\"status_emoji\":\":dart:\"}"'

# Git commit WIP before meetings
janjak workflow add auto-wip meeting_soon 'cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -m "WIP: auto-save before meeting" --allow-empty' --cooldown 30

# Log energy level drops
janjak workflow add energy-log energy_low 'echo "$(date): energy dropped to $JANJAK_ENERGY during $JANJAK_ACTIVITY" >> ~/.janjak/energy.log'
```

**Available triggers:** `focus_start`, `focus_end`, `break_start`, `break_end`, `activity_change`, `long_session`, `idle_detected`, `return_from_idle`, `project_switch`, `meeting_soon`, `energy_low`

**Context env vars** injected into every workflow: `$JANJAK_ACTIVITY`, `$JANJAK_FOCUS_MODE`, `$JANJAK_PROJECT`, `$JANJAK_ENERGY`, `$JANJAK_SESSION_MINUTES`, `$JANJAK_IDLE_MINUTES`

Custom workflows are saved as JSON in `~/.janjak/workflows/`.

---

## 🔔 Desktop Notifications

Nudges can be sent as native macOS notifications (with sound):

```bash
# Test it
janjak notify
janjak notify "Time to ship!"

# Enable during monitoring
janjak watch --notify
```

---

## 🍅 Pomodoro & Streaks

```bash
# Start a pomodoro (25min work / 5min break, auto-cycles)
janjak pomo

# Custom durations
janjak pomo -w 30 -s 10 -l 20

# Check your streak
janjak streak
```

Pomodoro stats appear in `janjak status` and `janjak score`. Streaks track consecutive days with focus score ≥ 50 — with milestone badges at 3, 7, 14, 30, 60, 100 days.

---

## 📊 Dashboard

```bash
# Launch interactive TUI
janjak dash

# With desktop notifications
janjak dash --notify
```

Full-screen terminal dashboard with live panels: status, focus score, tasks, music, projects, and nudges. Refreshes every 5 seconds. Press `q` to quit, `r` to refresh.

---

## 📁 Project Detection

Janjak automatically detects which project you're working on from window titles:

- **VS Code**: reads `filename — ProjectName [branch]`
- **Xcode / IntelliJ**: reads `ProjectName —` pattern
- **Terminal**: extracts from path
- **Browser**: detects GitHub repo URLs
- **Other apps**: falls back to active window title

```bash
# See per-project time breakdown
janjak projects
janjak projects -d 30

# Projects also appear in status and dashboard
```

---

## 🚀 Auto-Start

Janjak can run automatically when you log in:

```bash
# Enable auto-start (installs macOS LaunchAgent)
janjak autostart on

# Disable
janjak autostart off

# Check status
janjak autostart
```

This installs a LaunchAgent at `~/Library/LaunchAgents/com.janjak.daemon.plist` that runs `janjak watch --interval 30` in the background, tracking your activity and sending nudges throughout the day.

---

## 🔮 Roadmap

- [x] Focus engine + app detection + activity classification
- [x] Spotify music control (activity-matched playlists)
- [x] Ambient monitoring + smart nudges
- [x] Day overview + smart suggestions
- [x] Email → Tasks (Gmail + OpenAI pipeline)
- [x] Behavioral Memory (pattern analysis from session history)
- [x] AI Daily Planner (`janjak day --ai`)
- [x] Focus Score (0-100) + Weekly Report
- [x] Natural Language Chat (`janjak ask`)
- [x] macOS Desktop Notifications
- [x] Smart Focus → Task suggestion (focus mode suggests best task)
- [x] Pomodoro Mode (25/5 timer with auto focus/break cycling)
- [x] Daily Streak + Gamification (consecutive days above score threshold)
- [x] Project Detection (infer project from window titles, per-project tracking)
- [x] Interactive Dashboard TUI (`janjak dash`)
- [x] Auto-Start at Login (macOS LaunchAgent)
- [x] Calendar Integration (Google Calendar → read events + create events from reminders)
- [x] Voice Commands (Whisper STT → AI → OpenAI TTS, 50+ languages)
- [x] Morning Briefing (calendar + inbox + tasks + AI plan)
- [x] Natural Language Task Creation ("Remind me to..." → task + calendar event)
- [x] AI Email Reply Drafting (`janjak reply`)
- [x] Web Dashboard (browser-based live dashboard)
- [x] Menu Bar App (macOS native NSStatusBar)
- [x] Proactive Notification Engine (7 signal sources)
- [x] One-Click Installer (`install.sh` + `janjak setup`)
- [x] Autonomous Actions (safety-tiered auto/confirm/suggest)
- [x] Workflow Automations (trigger → shell command, built-in + custom)
- [x] **Super Brain L1 — Semantic Memory** (embeddings + `recall` + AI context injection)
- [x] **Super Brain L2 — Entity Graph** (people/projects/topics, `who`, `network`)
- [x] **Super Brain L3 — Personal Model** (goals, preferences, routines, `knows`)
- [x] **Super Brain L4 — Learning Loop** (feedback capture, adaptation, `why`)
- [x] **Super Brain L5 — Synthesis** (daily/weekly consolidation, memory tiers, `review`)
- [x] **Privacy Controls** (`forget --entity`, `export`, `--no-embed`)
- [ ] Multi-device Context (iPhone/Watch location + motion signals)
- [ ] Plugin System (`~/.janjak/plugins/` for community extensions)
- [ ] Agent Mode (chain API calls + code analysis autonomously)
- [ ] WhatsApp Intelligence (analyze chats, detect urgency)
- [ ] Cross-platform: Linux support via D-Bus

---

## 🌍 About

**Janjak** (Haitian Creole: *Jean-Jacques*) — named in the spirit of Haitian resilience and resourcefulness. Built for builders who want an AI that works *with* them, not *at* them.

Made with ❤️ by [Didier Ganthier](https://github.com/didierganthier).

---

## 🛠 Tech Stack

- **TypeScript** + **Node.js**
- **Commander** — CLI framework
- **better-sqlite3** — Local database
- **AppleScript** — macOS window detection + Spotify control
- **active-win** — Fallback window detection
- **googleapis** — Gmail API client
- **OpenAI** — AI chat, email analysis, voice (Whisper + TTS), task parsing (gpt-4o-mini)

---

## 📝 License

ISC — Built by Didier Ganthier

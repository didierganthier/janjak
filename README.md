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
# Install globally
npm link

# Check your current state
janjak status

# Enter deep work mode (detects activity + plays music + suggests a task)
janjak focus

# Take a break
janjak break

# End session
janjak stop
```

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

### Productivity — Pomodoro, Streaks & Projects

| Command | Description |
|---------|-------------|
| `janjak pomo` | Start a Pomodoro timer (25/5 cycles). Auto-cycles focus/break. |
| `janjak pomo -w 30 -s 10` | Custom work/break durations. |
| `janjak streak` | Show your focus streak, milestones, and badges. |
| `janjak projects` | Time spent per project (auto-detected from window titles). |
| `janjak projects -d 30` | Look back 30 days instead of 7. |
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
├── reply.ts        # AI email reply drafter
├── autostart.ts    # macOS LaunchAgent for auto-start at login
├── setup.ts        # Interactive setup wizard
├── db.ts           # SQLite: sessions, tasks, pomodoros, projects, state
├── gmail-auth.ts   # Google OAuth2 authentication flow (Gmail + Calendar)
├── gmail-client.ts # Gmail API client (fetch + parse emails)
├── email-parser.ts # AI email analyzer (OpenAI → extract tasks)
├── calendar.ts     # Google Calendar (read events + create events)
├── github.ts       # GitHub integration (PRs, issues, notifications)
└── tasks.ts        # Task manager (email→task pipeline + CRUD)
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

---

## 🔧 Setup

### Prerequisites

- **macOS** (for AppleScript window detection, Spotify control, notifications)
- **Node.js** 18+
- **Spotify** installed (for music features)

### Installation

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
- [ ] WhatsApp Intelligence (analyze chats, detect urgency)
- [ ] Cross-platform: Linux support via D-Bus

---

## 🌍 About

**Janjak** (Haitian Creole: *Jean-Jacques*) — named in the spirit of Haitian resilience and resourcefulness. Built for builders who want an AI that works *with* them, not *at* them.

Made with ❤️ by [Didier Ganthier](https://github.com/didierganthier).
- [x] **AI Reasoning**: OpenAI integration for smart classification + daily planning
- [ ] **Cross-platform**: Linux support via D-Bus

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

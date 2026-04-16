# 🤖 Janjak Robot — Circuit Integration Requirements

> A guide for building a physical robot powered by Janjak's ambient intelligence brain.

---

## What Is Janjak?

**Janjak** is an ambient intelligence assistant — a personal AI that runs on macOS today, built with TypeScript and Node.js. It already:

- **Sees your digital world**: monitors active apps, window titles, browser tabs, classifies activity (coding, browsing, designing, writing, meeting, idle, etc.)
- **Knows your schedule**: reads Google Calendar events, free slots, sends meeting reminders
- **Manages your email**: scans Gmail inbox, uses AI to extract tasks, drafts replies
- **Tracks GitHub**: PRs, issues, notifications
- **Controls music**: Spotify playlists matched to activity (focus music for coding, chill for breaks)
- **Learns your patterns**: behavioral memory engine analyzes 14 days of historical data — peak hours, trends, habits
- **Scores your day**: focus score (0–100), streaks, gamification badges
- **Thinks and plans**: OpenAI-powered daily/weekly plans, morning briefings, natural language Q&A
- **Talks**: voice interface via Whisper STT → AI → OpenAI TTS, supports 50+ languages
- **Acts autonomously**: safety-tiered action system (auto/confirm/suggest) with full logging
- **Runs workflows**: context-triggered shell commands (e.g., git stash before meeting, DND in focus mode)

The goal is to put this brain into a **physical robot on a circuit** that can also **see the real world through a camera** and make decisions based on both digital and physical context.

---

## Current Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ESM modules) |
| Runtime | Node.js ≥ 18 |
| Build | `tsc` (TypeScript compiler) |
| CLI | Commander.js |
| Database | SQLite via `better-sqlite3` |
| AI | OpenAI SDK — gpt-4o-mini (chat, planning), Whisper (STT), TTS (voice) |
| Email/Calendar | Google APIs (googleapis) — OAuth2 |
| macOS Integration | AppleScript via `osascript` (window detection, Spotify) |
| Notifications | Custom Swift app (UserNotifications framework) |
| Menu Bar | Custom Swift app (NSStatusBar) |
| Daemon | HTTP API server on port 7777 |

---

## Hardware Requirements

### Minimum (Embedded Robot — No Local Vision)

| Component | Recommendation | Purpose |
|-----------|---------------|---------|
| **Single-board computer** | Raspberry Pi 4 (4GB RAM) or Raspberry Pi 5 | Runs Node.js, SQLite, the Janjak daemon |
| **Camera** | Raspberry Pi Camera Module v3 or USB webcam (720p+) | Visual input for scene understanding |
| **Microphone** | USB mic or I2S MEMS mic (e.g., INMP441) | Voice input (Whisper STT) |
| **Speaker** | 3W speaker + I2S DAC (e.g., MAX98357A) or USB speaker | Voice output (OpenAI TTS), alerts |
| **Storage** | 32GB+ microSD (A2 class recommended) | OS + SQLite DB + logs |
| **Power** | 5V / 3A USB-C supply (or LiPo battery + UPS HAT for portability) | Stable power for Pi + peripherals |
| **Network** | Wi-Fi (built into Pi 4/5) | API calls to OpenAI, Gmail, Google Calendar, GitHub |
| **Enclosure** | 3D-printed or off-the-shelf robot chassis | Physical housing |

### Recommended (With Local Vision / Faster AI)

| Component | Recommendation | Purpose |
|-----------|---------------|---------|
| **Single-board computer** | NVIDIA Jetson Nano / Jetson Orin Nano | GPU-accelerated vision inference (YOLO, MobileNet) without cloud latency |
| **Camera** | IMX219 CSI camera or stereo camera for depth | Better image quality, depth perception |
| **Servo motors** | SG90 or MG996R (pan/tilt for camera), DC motors for mobility | Physical movement / camera tracking |
| **Motor driver** | L298N or PCA9685 servo driver board | Motor control via GPIO/I2C |
| **Sensors (optional)** | Ultrasonic (HC-SR04), PIR motion, temperature/humidity | Environmental awareness |
| **Battery** | 11.1V LiPo + voltage regulator | Portable operation |
| **LED indicators** | NeoPixel ring or individual LEDs | Visual status feedback (focus mode, alerts) |

---

## Software Requirements

### On the Board

| Software | Version | Purpose |
|----------|---------|---------|
| **OS** | Raspberry Pi OS (64-bit) or Ubuntu for Jetson | Base operating system |
| **Node.js** | ≥ 18 | Janjak runtime (works on ARM64) |
| **npm** | Comes with Node.js | Package management |
| **Python** | 3.9+ | Only if using local vision models (YOLO, OpenCV) |
| **SQLite** | Bundled via `better-sqlite3` | Already used by Janjak, runs fine on ARM |
| **Git** | Any recent version | For cloning and updates |
| **ffmpeg** | Latest | Audio capture/conversion for voice features |

### API Keys & Credentials (Same as Desktop Janjak)

| Service | What's Needed | Used For |
|---------|--------------|----------|
| **OpenAI** | API key (`OPENAI_API_KEY`) | Chat, planning, email analysis, voice (STT/TTS), **vision** |
| **Google Cloud** | OAuth2 credentials (Desktop app) | Gmail inbox, Google Calendar |
| **GitHub** | Personal access token (optional) | PR/issue tracking |
| **Spotify** | N/A on robot (no AppleScript) | Music control would need Spotify Web API instead |

---

## New Modules to Build

### 1. `vision.ts` — Camera Context Feed

The core new module. Captures frames from the camera and feeds scene descriptions into the existing context engine.

**Approach A — Cloud Vision (Easiest, recommended to start)**
- Capture a frame every N seconds (configurable, e.g., 10–30s)
- Send to OpenAI Vision API (gpt-4o with vision) with a prompt like: *"Describe what you see. Who is present? What are they doing? What objects are notable?"*
- Inject the scene description into the context engine alongside the existing digital context
- Cost: ~$0.01–0.03 per frame depending on resolution

**Approach B — Local Vision (Lower latency, no cloud cost)**
- Run YOLO v8 or MobileNet on-device (Jetson required for real-time)
- Detect: people, objects, gestures, facial expressions
- Python service exposing results via local HTTP or Unix socket
- Node.js module polls the Python service

**What it produces:**
```typescript
interface VisionContext {
  timestamp: number;
  peopleDetected: number;
  sceneDescription: string;   // "Person sitting at desk, laptop open, coffee mug"
  objects: string[];           // ["laptop", "coffee mug", "notebook"]
  activity: string;            // "working", "away", "talking", "eating"
  confidence: number;          // 0-1
}
```

### 2. `hardware.ts` — GPIO / Actuator Control

Controls physical outputs based on decisions from the autonomy engine.

- LED status indicators (green = focus, yellow = break, red = meeting)
- Servo control for camera pan/tilt (track person, look toward sound)
- Motor control if the robot is mobile
- GPIO library: `onoff` (npm) or `pigpio` for Node.js

### 3. `sensors.ts` — Physical Sensor Input (Optional)

Reads environmental sensors to enrich the context:

- Ambient light level (is it dark? suggest break)
- Temperature/humidity (comfort monitoring)
- PIR motion (presence detection, supplement camera)
- Ultrasonic distance (proximity awareness)

### 4. Platform Abstraction for macOS → Linux

Some current modules use macOS-specific features that need Linux alternatives:

| Feature | macOS (Current) | Linux (Robot) |
|---------|----------------|---------------|
| Window detection | AppleScript `osascript` | Not applicable on headless robot — replaced by camera |
| Spotify control | AppleScript | Spotify Web API (REST) or skip |
| Notifications | Swift `UserNotifications` | `notify-send` or speaker TTS announcements |
| Menu bar | Swift `NSStatusBar` | Not applicable — use LED indicators or web dashboard |

---

## Architecture on the Robot

```
┌──────────────────────────────────────────────────┐
│                  JANJAK DAEMON                    │
│              (Node.js, port 7777)                 │
│                                                   │
│  ┌───────────┐  ┌───────────┐  ┌──────────────┐ │
│  │ vision.ts │  │ sensors.ts│  │ hardware.ts  │ │
│  │ (camera)  │  │ (GPIO in) │  │ (GPIO out)   │ │
│  └─────┬─────┘  └─────┬─────┘  └──────▲───────┘ │
│        │              │               │          │
│        ▼              ▼               │          │
│  ┌─────────────────────────────────────┐         │
│  │         CONTEXT ENGINE              │         │
│  │  (digital + physical context)       │         │
│  └──────────────┬──────────────────────┘         │
│                 │                                 │
│                 ▼                                 │
│  ┌──────────────────────────────────────┐        │
│  │     CLASSIFIER + AUTONOMY ENGINE     │        │
│  │  (decide actions from all signals)   │────────┘
│  └──────────────┬───────────────────────┘        │
│                 │                                 │
│    ┌────────────┼────────────┐                   │
│    ▼            ▼            ▼                   │
│ ┌──────┐  ┌─────────┐  ┌─────────┐             │
│ │Voice │  │ OpenAI  │  │ Google  │             │
│ │(Mic/ │  │ (Chat/  │  │(Gmail/  │             │
│ │Spkr) │  │ Vision) │  │Calendar)│             │
│ └──────┘  └─────────┘  └─────────┘             │
└──────────────────────────────────────────────────┘

        ┌──────────────┐
        │  Web Dashboard│  (accessible from any device
        │  :7777/web    │   on the local network)
        └──────────────┘
```

---

## Integration Points (Already Exist)

The robot doesn't need to reinvent the brain. These are already built:

| System | What It Does | How the Robot Uses It |
|--------|-------------|----------------------|
| **Daemon HTTP API** (port 7777) | Serves full state, accepts commands | Central bridge — sensors feed in, actuators consume |
| **Autonomy engine** | Auto/confirm/suggest tiered actions with logging | Extend with physical actions (move, light up, speak) |
| **Proactive alert engine** | 7 signal sources with dedup + cooldowns | Add vision-based signals (person arrived, empty room) |
| **Context engine** | Gathers app/activity/energy/calendar/tasks | Extend with `VisionContext` + sensor data |
| **Classifier** | Maps inputs to activity types | Add vision-based classification rules |
| **Voice interface** | Whisper STT → AI → TTS | Wire mic + speaker directly |
| **Workflow engine** | Trigger → shell command | Add hardware triggers (motion detected, person left) |
| **SQLite database** | Sessions, tasks, state | Store vision logs, sensor history |

---

## Example Robot Behaviors

Once integrated, the robot could:

| Trigger | Action |
|---------|--------|
| Camera sees you sit down at desk | Announce morning briefing, enter focus mode |
| Camera sees empty room for 5 min | Pause music, set mode to idle, log break |
| Camera sees someone approach | Pause music, announce "Someone's here" |
| Camera sees you eating | Suggest break mode, play chill playlist |
| Calendar says meeting in 5 min | LED turns red, voice: "Meeting with X in 5 minutes" |
| Focus score drops below 30 | LED blinks yellow, voice: "You seem distracted, want a break?" |
| Motion sensor + camera: you return | Voice: "Welcome back. You have 2 tasks pending and a meeting at 3pm." |
| Voice: "What's my schedule?" | Reads today's calendar events aloud |
| Voice: "Start focus mode" | LED green, plays focus music, suggests top task |

---

## Estimated Bill of Materials (Minimum Viable Robot)

| Item | Approx. Cost |
|------|-------------|
| Raspberry Pi 5 (4GB) | $60 |
| Pi Camera Module v3 | $25 |
| USB microphone | $10 |
| 3W speaker + MAX98357A DAC | $8 |
| 32GB microSD (A2) | $10 |
| 5V/3A USB-C power supply | $10 |
| NeoPixel LED ring (optional) | $8 |
| Pan/tilt servo bracket + 2x SG90 (optional) | $12 |
| Enclosure / chassis | $15–30 |
| **Total** | **~$140–170** |

Add ~$200 for a Jetson Orin Nano if you want local vision inference.

---

## Getting Started — Build Order

1. **Get the Pi running** — Install Raspberry Pi OS 64-bit, Node.js 18+, clone the Janjak repo
2. **Port the daemon** — Get `janjak daemon start` running on the Pi (skip macOS-specific features initially)
3. **Wire up mic + speaker** — Test voice interface (`janjak voice`)
4. **Add the camera** — Build `vision.ts`, capture frames, send to OpenAI Vision API
5. **Feed vision into context** — Extend the context engine to include scene descriptions
6. **Add physical outputs** — LEDs, speaker announcements based on autonomy decisions
7. **Add sensors** — Motion, light, temperature for richer context
8. **Iterate** — Tune the decision-making, add new autonomous behaviors

---

## Summary

**What already exists:** The full AI brain — activity classification, behavioral memory, focus scoring, task management, email/calendar/GitHub integration, voice interface, autonomous decision-making, workflow automation, and an HTTP API.

**What needs to be built:** Camera vision pipeline (`vision.ts`), hardware control (`hardware.ts`), optional sensor input (`sensors.ts`), and platform abstraction from macOS → Linux (mostly replacing AppleScript calls).

**Key principle:** The daemon's HTTP API on port 7777 is the bridge. Everything feeds context in, decisions come out. The robot is a new set of eyes, ears, and hands for an intelligence that already exists.

---

*Janjak (Haitian Creole: Jean-Jacques) — Built by [Didier Ganthier](https://github.com/didierganthier).*

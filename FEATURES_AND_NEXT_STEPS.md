# Janjak Features and Next Steps

This document summarizes what Janjak can already do today and what we can add next.

## 1) What Janjak already does

### A. Context and activity intelligence
- Tracks active app and window title continuously.
- Classifies user activity (coding, browsing, designing, writing, meeting, idle, communication, entertainment, and more).
- Monitors idle time, session duration, and context changes.
- Detects project context from editor/terminal/browser signals.
- Tracks browser usage and can list open tabs.

### B. Focus and productivity engine
- Focus mode and break mode state machine.
- Session tracking with smart transitions.
- Energy estimation based on behavior and timing.
- Smart nudges during monitoring (example: long session reminder, idle return nudge).
- Pomodoro support with configurable work/break timings.
- Daily streaks and milestone/badge style progression.
- Focus scoring (daily score and weekly trend reporting).

### C. AI assistance and planning
- Natural language Q and A about work patterns.
- AI daily plan generation.
- AI weekly summary generation.
- Morning briefing that combines schedule, tasks, and insights.
- Natural language reminder parsing into actionable tasks.
- Character/assistant persona switching.

### D. Communications and knowledge sources
- Gmail authentication and inbox scanning.
- AI extraction of tasks from email content.
- Task lifecycle management (pending, in-progress, done, dismissed).
- AI-generated reply drafts.
- Draft preview and option to open draft in email flow.
- Google Calendar integration for daily schedule and event awareness.
- GitHub overview integration for pull requests, review requests, and issues.

### E. Autonomy and automation
- Safety-tiered autonomy model:
  - Auto tier for safe immediate actions.
  - Confirm tier for delayed/cancelable actions.
  - Suggest-only behavior for advisory flows.
- Autonomous action logs and pending action controls.
- Workflow engine triggered by context changes.
- Built-in and custom workflows.
- Workflow execution logs and global enable/disable controls.

### F. Interfaces and runtime modes
- CLI-first command interface.
- Watch mode for ambient monitoring.
- Interactive terminal dashboard.
- Web dashboard.
- macOS menu bar app.
- Overlay launcher.
- Daemon mode with HTTP API for always-on operation.
- Setup wizard for guided configuration.
- Login-time autostart support.

### G. Voice and notifications
- Voice command flow (speech to text, AI response, text to speech).
- Loop mode for continuous conversation.
- Voice selection support.
- Language safety mode for voice recognition:
  - Default: EN only (most reliable).
  - Optional: EN + FR only.
- macOS desktop notifications with test and monitor integration.

### H. Data and persistence
- Local SQLite database for sessions, tasks, state, and trend history.
- Persistent behavior memory and insight formatting.
- Local settings and credential handling through the user home config directory.

## 2) What we could add next

### Short-term additions (high impact, lower complexity)
- Slack integration:
  - Read mentions, prioritize action items, auto-create tasks.
  - Optional status sync during focus mode.
- Notion and Linear integration:
  - Pull assigned tasks/issues and merge into unified priorities.
- Better task planning:
  - Time-block suggestions from task deadlines + calendar free slots.
- Focus interruption analytics:
  - Detect and report the main interruption sources per day/week.
- Follow-up assistant:
  - Detect unanswered important emails and propose follow-up drafts.

### Medium-term additions (higher impact, moderate complexity)
- Multi-device context:
  - Mobile signals (location/motion/time-away) to improve presence and context quality.
- Local retrieval memory:
  - Semantic memory over prior sessions, notes, and tasks for deeper question answering.
- Team mode:
  - Shared dashboard for small teams with privacy controls.
- Smart meeting prep:
  - Before each meeting, generate brief with agenda, relevant emails, open tasks, and GitHub context.
- Adaptive autonomy learning:
  - Learn from user cancellations and confirmations to tune confidence thresholds.

### Long-term additions (strategic)
- Physical robot/camera context layer:
  - Add visual and sensor context as inputs to the same autonomy engine.
- Plugin SDK:
  - Public extension system for custom integrations and trigger packs.
- Cross-platform parity:
  - Linux and Windows support with native capability adapters.
- On-device AI option:
  - Optional local model runtime for privacy-sensitive workflows.
- Agentic execution mode:
  - Multi-step action planning with explicit guardrails and rollback policies.

## 3) Prioritized roadmap proposal

### Phase 1 (next 4 to 6 weeks)
- Slack integration.
- Notion/Linear integration.
- Time-block suggestions.
- Follow-up assistant.

### Phase 2 (6 to 12 weeks)
- Smart meeting prep.
- Adaptive autonomy learning.
- Retrieval memory improvements.

### Phase 3 (quarter-scale)
- Plugin SDK.
- Cross-platform parity work.
- Robot/camera context prototype.

## 4) Guiding principle for future features

Every new feature should strengthen one of these loops:
- Observe better.
- Infer better.
- Assist better.
- Stay out of the way.

If a feature does not improve at least one of these loops, it should be deprioritized.

# Janjak — Platform Testing Guide

A hands-on checklist for exercising everything Janjak can do, with a focus on the
new **agentic brain** (the `do` command and its 23 tools) plus the core platform.

> **How to run commands**
> If you've linked the CLI globally (`npm link`), use `janjak <cmd>`.
> Otherwise, from the project root run the built binary directly:
> `node dist/index.js <cmd>`.
> This guide writes `janjak <cmd>` — substitute `node dist/index.js <cmd>` if needed.

---

## 0. One-time setup

```bash
# 1. Build the latest code
npm run build

# 2. Confirm your OpenAI key is set (required for ask / do / voice)
cat ~/.janjak/.env | grep OPENAI_API_KEY

# 3. (Re)connect Google so Gmail + Calendar + Gmail drafts work.
#    NOTE: a new gmail.compose scope was added, so you MUST log in again
#    to enable the "create_gmail_draft" tool.
janjak login

# 4. Sanity check the CLI loads
janjak --help
```

**Expected:** `--help` lists commands including `do`, `ask`, `login`, `score`, `week`, `voice`, `daemon`-related, etc.

---

## 1. Smoke test (2 minutes)

| Step | Command | Expected |
|------|---------|----------|
| Data Q&A | `janjak ask "how was my focus today?"` | A score + time breakdown, no errors |
| Agentic action | `janjak do "send me a desktop notification that says hello"` | macOS notification appears |
| Web search | `janjak do "search the web for who won the 2022 World Cup"` | Answers "Argentina/Qatar host" with a source |
| Memory | `janjak recall "focus"` | Lists matching memories |

If all four work, the core stack (OpenAI, agent loop, tools, DB, memory) is healthy.

---

## 2. The agentic brain — `janjak do`

This is the headline feature: Janjak plans, calls tools, **chains** them, and reports back.
You'll see progress lines like `• searching the web…` as each tool runs.

### 2a. Single-tool actions

```bash
# Weather (live, no key needed)
janjak do "what's the weather in Port-au-Prince?"

# Web search (key-free: DuckDuckGo Instant Answer + Wikipedia fallback)
janjak do "search the web for the current UN Secretary-General"

# Focus / productivity data
janjak do "how productive was I today?"

# Tasks
janjak do "what's on my plate right now?"

# Remember a fact
janjak do "remember that I prefer morning meetings before 11am"

# Filesystem
janjak do "list my Desktop"
janjak do "write a file called hello.txt that says hi from janjak"
```

**Expected:** each runs exactly one tool and gives a short, friendly confirmation.
For `write a file`, check `~/Desktop/hello.txt`. (It refuses to overwrite an
existing file unless you say "overwrite it".)

### 2b. Multi-step chains (the real test)

```bash
# Two tools in one request
janjak do "check the weather in Paris and tell me my focus score today"

# Information → action
janjak do "search the web for 3 productivity tips and save them to a file called tips.txt"

# Note + file + listing
janjak do "remember my favorite editor is VS Code, write notes.txt with that fact, then list my Desktop"
```

**Expected:** multiple `•` progress lines, then a single combined answer.
Verify any files it claims to have written actually exist.

### 2c. System control (macOS)

```bash
janjak do "open the Notes app"
janjak do "open https://github.com in my browser"
janjak do "what song is playing right now?"        # needs Spotify
janjak do "pause the music"                          # needs Spotify
janjak do "play some coding music"                   # starts a Spotify playlist
janjak do "send a notification reminding me to drink water"
```

**Expected:** the app/URL opens; music tools require Spotify to be installed/running;
the notification appears on screen.

### 2d. Google-connected actions (requires `janjak login`)

```bash
# Read/search your real inbox (read + unread)
janjak do "find the latest email from <someone> and summarize it"

# Calendar awareness
janjak do "what meetings do I have today and how much free time?"

# Create a calendar event
janjak do "add a calendar event called Dentist tomorrow at 3pm"

# Save a Gmail draft (server-side; does NOT send)
janjak do "draft a polite email to alex@example.com asking to reschedule our call"
```

**Expected:**
- If you haven't re-logged-in since the scope change, `create_gmail_draft` returns
  *"Re-run janjak login to allow Janjak to compose drafts."* → run `janjak login` and retry.
- Calendar event creation returns a Google event link.
- The Gmail draft appears in your Gmail **Drafts** folder (review/send manually).

### 2e. Document generation & analysis

```bash
# Generate a real document on your Desktop (pdf/docx/md/txt/html…)
janjak do "write a one-page project proposal for a habit-tracking app and save it as a PDF"

# Read & analyze an existing file
janjak do "read ~/Desktop/proposal.pdf and list any risks or one-sided terms"
```

**Expected:** a file lands on the Desktop; analysis reflects the actual file contents.

### 2f. Edge cases to confirm graceful behavior

```bash
# Not connected to Google (run before login, or after `janjak reset`)
janjak do "check my calendar"        # → tells you to run "janjak login"

# Overwrite guard
janjak do "write hello.txt saying changed"   # → refuses if hello.txt exists, asks to overwrite

# Unknown place
janjak do "what's the weather?"      # → asks which city
```

---

## 3. Conversational `ask` (now agent-backed)

`ask` uses the same brain, so it can answer **and** act.

```bash
# Pure data question (answered from context, no tool call)
janjak ask "what were my top apps this week?"

# Question that triggers a tool
janjak ask "what's the weather in Tokyo and who is the CEO of OpenAI?"

# Attach a document to analyze
janjak ask "summarize this and flag action items" --file ~/Desktop/somefile.pdf

# Attach an email to analyze
janjak ask "what is this asking me to do?" --from-email "from:boss"
```

**Expected:** data questions answer instantly; tool questions show a brief think then a grounded answer.

---

## 4. Voice & always-on daemon

```bash
# Voice (needs a mic; speaks responses)
janjak voice
# Say: "what's the weather in Miami?"  → it should speak the live weather
# Say: "remind me to call mom at 6pm"  → creates a task
# Say: "connect my gmail" (if not logged in) → launches the login flow

# Daemon (HTTP API used by menu bar / overlay)
janjak daemon      # starts the always-on server on http://127.0.0.1:7777
# In another terminal, hit the ask endpoint:
curl -s -X POST http://127.0.0.1:7777/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"what is my focus score today?"}'
```

**Expected:** voice and daemon both go through the agent, so they share all 23 tools.

---

## 5. Core productivity & knowledge commands

```bash
# Focus engine
janjak status            # current activity/session
janjak score             # today's focus score
janjak week --ai         # weekly report + AI summary
janjak focus             # enter focus mode
janjak break             # take a break
janjak pomo              # pomodoro

# Tasks & email
janjak inbox             # scan Gmail, extract tasks
janjak tasks             # list tasks
janjak remind "finish the report by Friday"

# Calendar & GitHub
janjak cal               # today's schedule
janjak github            # PRs / reviews / issues

# Knowledge layers
janjak note "Janjak demo went well"     # add a memory
janjak recall "demo"                      # semantic search
janjak who "Michaella"                    # entity profile
janjak network "Michaella"                # relationship graph
janjak knows                              # learned preferences
janjak goal list                          # goals
janjak why last                           # explain last decision
janjak summary day                        # daily synthesis
```

---

## 6. What to watch for / report

For each test, note:
- ✅ **Worked** — correct result, no stack trace.
- ⚠️ **Wrong content** — ran but the answer/result was off (note the prompt + output).
- ❌ **Error** — crashed or threw (copy the error line).

Common things to verify specifically:
1. **Chaining** — does `do` actually call multiple tools when asked, or stop early?
2. **Grounding** — does it use real tool data, or make things up (e.g. fake file paths, invented emails)?
3. **Auth gating** — when Google isn't connected, does it say "run janjak login" instead of guessing?
4. **File safety** — does `write_file` refuse to overwrite without permission?
5. **Memory** — after `do "remember X"`, does `recall "X"` find it?

---

## 7. Quick troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "OpenAI API key not set" | Missing env | Add `OPENAI_API_KEY` to `~/.janjak/.env` |
| Gmail/Calendar says "not connected" | No OAuth token | `janjak login` |
| "Re-run janjak login to compose drafts" | New `gmail.compose` scope not granted | `janjak login` again |
| Music tools do nothing | Spotify not installed/running | Install/open Spotify |
| Web search returns nothing | Network/endpoint hiccup | Retry; it falls back to Wikipedia |
| Stale "I don't know" answers | Old build | `npm run build` and retry |

---

*Tip:* run `janjak do "..."` with deliberately multi-step requests — that's the
fastest way to confirm the agentic brain is genuinely planning and chaining,
not just answering.

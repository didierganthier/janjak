# Janjak Super Brain — Technical Plan

> Goal: turn Janjak from an ambient assistant into a personal intelligence that **knows you**, **learns from every interaction**, and **uses that understanding to make your life better**.

This document is an implementation plan, not a roadmap of ideas. Every section maps to specific files, schemas, and commands.

> **✅ Implementation status (June 2026): COMPLETE.** All five layers plus the §10 privacy + safety controls are built, validated, and shipped. Per-layer status is marked below.

---

## 1. Guiding principles

These rules constrain every design decision below.

1. **Local-first.** Everything sensitive lives in `~/.janjak/`. No remote storage of personal data.
2. **Compounding context.** Every interaction must produce a durable artifact (embedding, entity, feedback row).
3. **Recall before generation.** AI calls must pull relevant memory *first*, then reason — never reason from a blank slate.
4. **Explainable.** Every autonomous action must be traceable to evidence (`janjak why`).
5. **Adaptive, not static.** Confidence and thresholds adjust based on outcomes, never hardcoded forever.
6. **Forgettable.** The user can always inspect and delete what's stored.

---

## 2. Architecture overview

Five new layers, each building on the previous:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 5: SYNTHESIS    (daily/weekly consolidation)     │
├─────────────────────────────────────────────────────────┤
│  Layer 4: LEARNING     (feedback loops + adaptation)    │
├─────────────────────────────────────────────────────────┤
│  Layer 3: PERSONAL MODEL (preferences, goals, routines) │
├─────────────────────────────────────────────────────────┤
│  Layer 2: ENTITY GRAPH (people, projects, topics)       │
├─────────────────────────────────────────────────────────┤
│  Layer 1: SEMANTIC MEMORY (embeddings + recall)         │
├─────────────────────────────────────────────────────────┤
│  Existing: context engine, integrations, autonomy       │
└─────────────────────────────────────────────────────────┘
```

Each layer reads from layers below. Layer 1 is the foundation — without it, none of the others matter.

---

## 3. Layer 1 — Semantic Memory (the foundation) ✅

**Purpose:** every piece of text Janjak sees becomes searchable by meaning, not just keyword.

### New files
- `src/memory/embeddings.ts` — OpenAI `text-embedding-3-small` wrapper + batching
- `src/memory/vector-store.ts` — cosine similarity over SQLite-stored embeddings
- `src/memory/ingest.ts` — pipeline that embeds new data from every source
- `src/memory/recall.ts` — public API: `recall(query, opts) → MemoryHit[]`

### Schema additions to `~/.janjak/janjak.db`
```sql
CREATE TABLE memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,           -- 'session' | 'email' | 'task' | 'voice' | 'ai_chat' | 'calendar' | 'github' | 'note'
  source_id TEXT,               -- original row ID in its source table
  text TEXT NOT NULL,           -- the canonical text that was embedded
  embedding BLOB NOT NULL,      -- Float32Array stored as binary (1536 dims for text-embedding-3-small)
  metadata TEXT NOT NULL,       -- JSON: { project, people, app, etc. }
  timestamp INTEGER NOT NULL,
  importance REAL DEFAULT 0.5   -- 0-1, raised when referenced or confirmed important
);

CREATE INDEX idx_memory_timestamp ON memory(timestamp);
CREATE INDEX idx_memory_type ON memory(type);
```

### Ingest pipeline (what gets embedded)
Run automatically as each source produces data:

| Source | What gets embedded | When |
|--------|--------------------|------|
| Sessions | 5-min activity checkpoints summarized to a sentence | Every checkpoint |
| Emails | subject + sender + first 500 chars | On `processInbox` |
| Tasks | title + description | On insert |
| Voice transcripts | user utterance + AI response pair | After each voice turn |
| AI chat | question + answer pair | After each `askJanjak` |
| Calendar events | title + attendees + description | On daily sync |
| GitHub items | PR/issue title + body | On daily sync |
| Manual notes | full text | New `janjak note "..."` command |

### Recall API
```typescript
recall(query: string, opts?: {
  limit?: number;          // default 8
  types?: MemoryType[];    // filter by source
  daysBack?: number;       // recency window
  minImportance?: number;  // 0-1 filter
}): Promise<MemoryHit[]>
```

Returns ranked by `cosine_similarity * recency_decay * importance`.

### Integration with existing AI
Every call to `askJanjak`, `getAIDailyPlan`, `generateMorningBriefing`, `voice` now:
1. Calls `recall(query)` first
2. Injects top hits into the system prompt under a `[Relevant Memory]` section
3. Generation happens *with* context, not from scratch

### New CLI commands
- `janjak recall "<query>"` — semantic search across everything
- `janjak note "<text>"` — capture a manual memory
- `janjak ingest` — backfill embeddings for existing data
- `janjak forget <id>` — privacy delete

**Effort estimate:** ~1-2 weeks. **Impact: highest single unlock.**

---

## 4. Layer 2 — Entity Graph ✅

**Purpose:** Janjak stops treating each email/task/PR as isolated and starts understanding *who* and *what* connects them.

### New files
- `src/graph/entities.ts` — extraction + upsert logic
- `src/graph/relationships.ts` — edge management
- `src/graph/query.ts` — `who(name)`, `related(entity)`, `network(entity)`
- `src/graph/extractor.ts` — GPT-based entity extraction from text

### Schema
```sql
CREATE TABLE entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,           -- 'person' | 'project' | 'topic' | 'organization' | 'place'
  name TEXT NOT NULL,
  canonical_key TEXT UNIQUE,    -- normalized for dedup (e.g., email for people, slug for projects)
  aliases TEXT NOT NULL DEFAULT '[]',   -- JSON array
  attributes TEXT NOT NULL DEFAULT '{}', -- JSON: role, email, repo URL, importance, etc.
  importance REAL DEFAULT 0.5,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  mention_count INTEGER DEFAULT 1
);

CREATE TABLE relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_entity INTEGER NOT NULL,
  to_entity INTEGER NOT NULL,
  type TEXT NOT NULL,           -- 'works_with' | 'works_on' | 'mentioned_with' | 'reports_to' | 'discussed_in'
  strength REAL DEFAULT 0.5,    -- compounds with each new evidence
  evidence_count INTEGER DEFAULT 1,
  last_evidence INTEGER NOT NULL,
  FOREIGN KEY (from_entity) REFERENCES entities(id),
  FOREIGN KEY (to_entity) REFERENCES entities(id),
  UNIQUE(from_entity, to_entity, type)
);

CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_canonical ON entities(canonical_key);
CREATE INDEX idx_rel_from ON relationships(from_entity);
CREATE INDEX idx_rel_to ON relationships(to_entity);
```

### Extraction pipeline
Background job runs every N minutes over unprocessed memory rows:
1. Pull a batch of recent `memory` rows where `metadata.entities_extracted != true`
2. Send batched text to GPT with structured-output JSON schema
3. Upsert entities, link relationships, mark memory row done
4. Embedding stays — entities are *additional* indexing

### Example extraction prompt output
For an email "John from Acme asked about the Janjak voice feature":
```json
{
  "entities": [
    { "type": "person", "name": "John", "attributes": { "organization": "Acme" }},
    { "type": "organization", "name": "Acme" },
    { "type": "project", "name": "Janjak", "attributes": { "feature": "voice" }}
  ],
  "relationships": [
    { "from": "John", "to": "Acme", "type": "works_at" },
    { "from": "John", "to": "Janjak", "type": "mentioned_with" }
  ]
}
```

### New CLI commands
- `janjak who "<name>"` — full entity profile: history, related people, last contact, importance
- `janjak network "<entity>"` — graph of connected entities
- `janjak entities` — top entities by importance + recency

### Integration with existing features
- **Email reply drafter** — pulls recipient entity profile + past correspondence into the prompt
- **Meeting prep** — for each attendee, recall past interactions
- **Morning briefing** — "you haven't talked to X in 14 days, and they emailed you last week"

**Effort estimate:** ~2 weeks. **Impact: turns siloed integrations into a connected knowledge graph.**

---

## 5. Layer 3 — Personal Model ✅

**Purpose:** Janjak stops being generic and becomes specifically *yours*. Knows your preferences, your goals, your patterns, your style.

### New files
- `src/personal/profile.ts` — preferences CRUD + synthesis
- `src/personal/goals.ts` — goal management
- `src/personal/routines.ts` — extracted patterns
- `src/personal/synthesis.ts` — periodic background job that updates the model from observed behavior

### Schema
```sql
CREATE TABLE preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,       -- 'communication' | 'work_style' | 'schedule' | 'health' | 'food' | 'people'
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL,         -- 'observed' | 'stated' | 'inferred'
  confidence REAL DEFAULT 0.5,
  evidence_count INTEGER DEFAULT 1,
  last_confirmed INTEGER NOT NULL,
  UNIQUE(category, key)
);

CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,       -- 'career' | 'health' | 'relationship' | 'project' | 'learning' | 'finance'
  description TEXT NOT NULL,
  priority INTEGER DEFAULT 5,   -- 1-10
  active INTEGER DEFAULT 1,
  target_date TEXT,
  created_at INTEGER NOT NULL,
  context TEXT NOT NULL DEFAULT '{}'  -- JSON
);

CREATE TABLE routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,        -- JSON: { dayOfWeek, timeRange, activity, etc. }
  confidence REAL DEFAULT 0.5,
  observed_count INTEGER DEFAULT 1,
  last_observed INTEGER NOT NULL
);
```

### Example preferences (what gets learned)
| Category | Key | Value | Source |
|----------|-----|-------|--------|
| communication | voice_language | en-only | stated |
| communication | email_tone_default | professional-warm | observed |
| schedule | peak_coding_hours | 09:00-11:30 | observed |
| schedule | low_energy_hours | 14:00-15:00 | observed |
| work_style | meetings_per_day_max | 3 | inferred |
| work_style | break_after_min | 90 | observed |
| people | important_contacts | [list of entity ids] | inferred |
| health | hydration_reminders | dismissed_often | observed |

### Synthesis job
Runs nightly (and on `janjak knows --refresh`):
1. Analyze last 7 days of sessions, scores, feedback
2. For each candidate preference, check evidence count + consistency
3. Upsert with adjusted confidence
4. Decay confidence of preferences not reinforced in 30 days

### Goals (the "make your life better" anchor)
Without explicit goals, Janjak can't *direct* its help — it just reacts. Goals turn it from reactive to proactive.

Capture via:
- `janjak goal add "Ship Janjak v2 by July" --category project --priority 9`
- `janjak goal add "Run 3x per week" --category health`
- Onboarding wizard asks for 3-5 goals
- Inferred from repeated activity ("you keep working on X — is that a goal?")

### Integration
Every AI call now also injects:
- Top 5 active goals
- Top 10 high-confidence preferences
- Today's relevant routines

Result: morning briefings, daily plans, and replies are *aligned with what you care about*.

### New CLI commands
- `janjak knows` — show what Janjak has learned about you
- `janjak knows --category schedule`
- `janjak goal add "..."` / `janjak goal list` / `janjak goal done <id>`
- `janjak prefer "<key>" "<value>"` — manually state a preference
- `janjak forget-pref <id>`

**Effort estimate:** ~2 weeks. **Impact: transforms generic assistant into *your* assistant.**

---

## 6. Layer 4 — Learning Loop ✅

**Purpose:** every nudge, autonomous action, suggestion, and workflow execution produces feedback that adjusts future behavior.

### New files
- `src/learning/feedback.ts` — log + query outcomes
- `src/learning/adapt.ts` — adjust thresholds based on outcome history
- `src/learning/explain.ts` — `why()` traces evidence for any decision

### Schema
```sql
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,    -- 'nudge' | 'autonomy' | 'suggestion' | 'workflow' | 'alert'
  action_id TEXT NOT NULL,      -- which specific nudge/action
  outcome TEXT NOT NULL,        -- 'accepted' | 'rejected' | 'ignored' | 'cancelled' | 'expired'
  context TEXT NOT NULL,        -- JSON snapshot of state at decision time
  timestamp INTEGER NOT NULL
);

CREATE TABLE decision_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence TEXT NOT NULL,       -- JSON: memory_ids, entity_ids, signals that triggered it
  confidence REAL NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE INDEX idx_feedback_action ON feedback(action_type, action_id);
```

### How feedback gets captured
| Action | Acceptance signal | Rejection signal |
|--------|-------------------|------------------|
| Nudge | user took the suggested action within N min | dismissed or ignored for >15min |
| Autonomy auto-tier | no undo within 30s | manually reversed |
| Autonomy confirm-tier | not cancelled | cancelled |
| Workflow | exit code 0 + no immediate undo | failed or stopped manually |
| AI suggestion in chat | follow-up references it positively | user contradicts or ignores |
| Email reply draft | sent (with or without edits) | discarded |

### Adaptation rules
- Per-nudge-type acceptance rate < 30% over 20 samples → mute that nudge for 7 days
- Per-autonomous-action rejection rate > 40% → demote tier (auto → confirm, confirm → suggest)
- Per-workflow failure rate > 50% → disable + notify user
- Per-preference disconfirmation 3x → lower confidence sharply

### Explainability
Every decision writes a `decision_log` row. New command:
- `janjak why <decision_id>` — show: "I suggested X because of memory rows [a, b], entity [Y], routine [Z]"
- `janjak why last` — most recent decision

This is *non-negotiable* for trust. A super brain you can't audit is a black box you can't trust.

### New CLI commands
- `janjak why last` / `janjak why <id>`
- `janjak feedback` — show acceptance rates by action type
- `janjak adapt` — manually trigger adaptation pass

**Effort estimate:** ~1-2 weeks. **Impact: turns a smart system into one that gets smarter.**

---

## 7. Layer 5 — Synthesis ✅

**Purpose:** memory without consolidation is hoarding. Janjak needs a daily/weekly "sleep cycle" where it reflects, extracts patterns, and updates the personal model.

### New files
- `src/synthesis/daily.ts` — nightly summary + pattern extraction
- `src/synthesis/weekly.ts` — weekly review with explicit user check-in
- `src/synthesis/consolidate.ts` — promote important memory, decay trivial

### Daily consolidation (runs at 3am local)
1. Summarize the day into one paragraph (saved as a `memory` row, type `daily_summary`, high importance)
2. Update preferences confidence based on day's evidence
3. Update entity `last_seen` and `importance` (decay unused, boost mentioned)
4. Decay `memory.importance` for rows not referenced (forgetting curve)
5. Promote memory referenced today (importance += 0.1, capped at 1.0)
6. Run adaptation pass on feedback

### Weekly review (Sunday 8pm + interactive)
- `janjak review` — interactive weekly review
- Shows: what you worked on, what changed about your patterns, new entities added, goal progress
- Asks: "Is this still a goal?" / "Was this preference right?" / "Anything important I missed?"
- User answers update the personal model with `source = 'stated'` (highest confidence)

### Memory tiers (forgetting + remembering)
- **Working memory** (last 7 days): always loaded
- **Recent memory** (last 90 days): semantic recall pulls freely
- **Long-term memory** (>90 days): only retrieved if importance > 0.6
- **Archive** (>1 year + importance < 0.3): compressed to summary, originals optionally pruned

### New CLI commands
- `janjak review` — weekly interactive review
- `janjak consolidate` — force a consolidation pass
- `janjak summary today` / `janjak summary week`

**Effort estimate:** ~1 week. **Impact: makes the system sustainable over years, not months.**

---

## 8. Total scope + phased rollout

| Phase | Duration | Output |
|-------|----------|--------|
| 1. Semantic Memory | 1-2 weeks | `recall`, embeddings, AI context injection |
| 2. Entity Graph | 2 weeks | `who`, `network`, entity-aware AI |
| 3. Personal Model | 2 weeks | `knows`, goals, preferences |
| 4. Learning Loop | 1-2 weeks | feedback capture, adaptation, `why` |
| 5. Synthesis | 1 week | daily/weekly consolidation, `review` |
| **Total** | **~7-9 weeks** | **Full super brain** |

Each phase is independently shippable — you get value at the end of every one.

---

## 9. Tech choices

| Concern | Choice | Why |
|---------|--------|-----|
| Embeddings model | `text-embedding-3-small` (1536 dims, $0.02/1M tokens) | Cheap, good enough, OpenAI key already in place |
| Vector storage | Float32Array as BLOB in existing SQLite | No new dependency; <100k rows is trivially fast with brute-force cosine |
| Vector search scaling | If memory > 100k rows, add `sqlite-vec` extension | Only when needed; defer |
| Entity extraction | gpt-4o-mini with structured outputs (JSON schema) | Already using this model |
| Synthesis jobs | `node-cron` (already a dep) | No new infra |
| Embeddings cost | ~$0.50/month for active use | Negligible |

---

## 10. Privacy + safety controls ✅

Non-negotiable from day one:

- `janjak memory list --type email` — see everything stored from a source
- `janjak forget <memory_id>` — hard delete a memory + its embedding
- `janjak forget --entity "<name>"` — delete an entity and all related memories
- `janjak export` — full local export of memory + entities + preferences as JSON
- All embeddings local; only the embedding *request* hits OpenAI (text in, vector out)
- Optional `--no-embed` flag on commands to skip embedding for sensitive items

---

## 11. What "knows you" looks like after this is done

Concrete examples of what becomes possible:

- **Morning:** *"Good morning. You have a meeting with Sarah at 10. Last time you met, you discussed the Janjak vision module — she asked you to share progress. You haven't yet. Want me to draft a quick update from your commits this week?"*
- **During work:** *"You've been on this PR for 90 minutes. Last 3 times you hit this point on similar PRs, you took a 15-min walk and came back faster. Want me to suggest a break?"*
- **Email arrives:** *"Email from John (Acme). You owe him a reply on the contract from 5 days ago — that's still in your tasks. Want me to draft a combined response?"*
- **Voice question:** *"What was that idea I had about the autonomy tiers?"* → recall hits the voice transcript from 2 weeks ago + the relevant code session + the journal note.
- **Goal pressure:** *"You said 'Ship Janjak v2 by July' was a priority-9 goal. You've spent 4 hours on it this week vs. 12 hours on side reading. Want me to block 2 hours tomorrow morning?"*

That's the difference between an assistant and a brain.

---

## 12. Where to start tomorrow

Concrete first PR (one day of work):

1. Add `memory` table migration to `src/db.ts`
2. Create `src/memory/embeddings.ts` with `embed(text): Promise<Float32Array>`
3. Create `src/memory/vector-store.ts` with `insert()`, `searchSimilar(query, limit)`
4. Add `janjak note "<text>"` command to test end-to-end ingestion
5. Add `janjak recall "<query>"` command to test retrieval

Once that works, everything else is just wiring more sources into the ingest pipeline.

---

*The brain doesn't get smarter by knowing more things. It gets smarter by connecting what it already knows.*

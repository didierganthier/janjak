# Janjak Super Brain — LinkedIn Post Series

A 7-post series documenting the build of Janjak's super brain, layer by layer.

**Recommended cadence:** 1 post per week, Tuesday or Wednesday morning. Start with Post 0 (teaser), then one post per layer as you ship it.

**Style notes:**
- First person, builder voice. No buzzword soup.
- Lead with a concrete problem, not a feature.
- End each post with one open question to drive comments.
- Hashtags kept minimal (3-5 max) — LinkedIn's algorithm prefers signal over spam.

---

## Post 0 — The Teaser (kickoff)

**Hook:** Why I'm rebuilding my personal assistant from scratch.

---

Most "AI assistants" forget you the moment the conversation ends.

You ask the same question twice, you get two different answers. You tell it your preferences on Monday, it's a stranger again on Tuesday. It's clever in the moment and amnesiac forever after.

I've been building Janjak — a local-first ambient assistant that lives on my Mac, reads my emails, tracks my focus sessions, talks to me by voice. It already does a lot. But it has the same problem: every interaction starts from zero.

So I'm rebuilding it into something different. Not a chatbot. A **super brain** — a personal intelligence that:

→ Remembers everything I've ever told it, by meaning, not keywords
→ Knows the people, projects, and topics in my life and how they connect
→ Learns my preferences, goals, and routines from observation
→ Adapts every suggestion based on what worked and what didn't
→ Consolidates and reflects, like a sleep cycle

Five layers. ~8 weeks of work. Everything local. Everything mine.

I'm going to ship it in public — one layer at a time, one post per layer. The plan is written, the schemas are designed, the first PR is one day of work.

Layer 1 drops next week.

What's the one thing you wish your AI assistant actually remembered about you?

#BuildInPublic #AI #PersonalKnowledgeManagement #LocalFirst

---

## Post 1 — Layer 1: Semantic Memory

**Hook:** I gave my assistant a memory. Everything changed.

---

Week 1 of building Janjak's super brain: **semantic memory** is live.

Here's the problem it solves:

Two weeks ago, I had a great idea about autonomy tiers while driving. I told Janjak by voice. Today I needed it back. Old Janjak? Gone. Buried in a transcript I'd never find.

New Janjak:

```
$ janjak recall "autonomy tiers idea"
```

It returns the voice transcript, the code session where I started prototyping it, and the email where I'd referenced the same concept to a friend. Three sources, one query, ranked by meaning — not keywords.

**How it works (the short version):**

→ Every email, task, voice transcript, AI chat, calendar event, GitHub item gets embedded with `text-embedding-3-small`
→ Vectors stored as Float32 BLOBs in the same local SQLite database (no new infra, no cloud)
→ Cosine similarity ranked by `relevance × recency × importance`
→ Every AI call now does `recall()` first, then reasons — generation never starts from a blank slate

**The result:** when I ask Janjak a question, it answers with full context of everything I've ever told it. The assistant stops being clever-in-the-moment and starts being *consistent over time*.

Cost: about $0.50/month in embeddings.

This is the foundation. Layers 2-5 all build on this — without recall, none of them matter.

Next week: turning isolated memories into a graph of people, projects, and topics.

How do you currently search across everything you've written, said, and read? Notion? Obsidian? Brain?

#BuildInPublic #AI #Embeddings #LocalFirst #PKM

---

## Post 2 — Layer 2: Entity Graph

**Hook:** My assistant just stopped treating every email as a stranger.

---

Layer 2 of Janjak's super brain shipped: **the entity graph.**

Last week I gave it semantic memory — every text it sees is searchable by meaning. But there was still a problem: it didn't know that the "John" in Monday's email was the same "John" from last month's meeting and the "J. Smith" on a GitHub PR.

Now it does.

**What's new:**

Every memory gets passed through an extraction pass that pulls out:
- **Entities** — people, projects, topics, organizations, places
- **Relationships** — works_with, works_on, mentioned_with, reports_to

Stored as a graph in local SQLite. Each entity tracks first-seen, last-seen, mention count, importance — all updated automatically as new evidence arrives.

```
$ janjak who "Sarah"
Sarah Chen — Engineering Lead at Acme
First seen: 4 months ago · Last contact: 6 days ago
Related projects: Janjak Vision, Voice v2
Related people: John (manager), Maya (works_with)
Recent context: discussed Vision module roadmap on May 14
```

**Why this matters:**

When I draft an email reply now, Janjak pulls the full history with that recipient. When I have a meeting, it surfaces what we last talked about. When I haven't heard from someone important in a while, it tells me.

It stops being a tool that processes inputs. It starts being something that understands *my world*.

**The interesting bit:** the graph is bootstrapped from data Janjak already had — emails, calendar, sessions. The first time I ran extraction over 3 months of history, it surfaced 140 people and 280 relationships I'd never explicitly told it about. Most were correct on the first pass.

Next week: making it *mine*. Preferences, goals, routines — the personal model.

What's the most surprising thing you've found out about yourself from your own data?

#BuildInPublic #KnowledgeGraph #AI #PersonalIntelligence

---

## Post 3 — Layer 3: Personal Model

**Hook:** A generic assistant gives you generic advice. Today I made mine specifically mine.

---

Layer 3 shipped: Janjak now has a **personal model** of me.

Memory tells it *what happened*. The graph tells it *who's involved*. The personal model tells it *what I care about and how I work*.

Three things got added:

**1. Preferences** — learned from observation, not configuration

| Category | Key | Value | How it knows |
|---|---|---|---|
| Schedule | Peak coding hours | 09:00–11:30 | Session quality scores |
| Schedule | Low-energy window | 14:00–15:00 | Recurring distraction patterns |
| Communication | Email tone | Professional-warm | Style across 300+ sent replies |
| Work style | Break interval | Every 90 min | Voluntary break timing |

Each preference has a confidence score that goes up with reinforcement and decays without it. I can override any of them with `janjak prefer`.

**2. Goals** — the anchor that turns reactive into proactive

```
$ janjak goal add "Ship Janjak v2 by July" --priority 9
$ janjak goal add "Run 3x per week" --category health
```

Without goals, an assistant just reacts to noise. With goals, every nudge can be checked against: *does this move me toward what I said I want?*

**3. Routines** — patterns extracted automatically

It noticed I write best between 9 and 11, that I always check email twice on Tuesday mornings, that I context-switch hardest after lunch. None of that was programmed. It just watched.

**The shift:**

Morning briefings now read like: *"You said shipping v2 was priority-9. You've put 4 hours into it this week vs. 12 hours on side reading. Want me to block tomorrow 9-11 for it?"*

That's not a generic productivity nudge. That's an assistant pushing back on me because it knows what I told it I wanted.

Next week: closing the loop. Every nudge, every action, every suggestion produces feedback that adjusts future behavior.

What's one habit your data would reveal that you'd rather it didn't?

#BuildInPublic #AI #PersonalKnowledge #ProductOfOne

---

## Post 4 — Layer 4: Learning Loop

**Hook:** I made my assistant capable of being wrong — and getting better because of it.

---

Layer 4 of Janjak's super brain is in: the **learning loop**.

Here's the uncomfortable truth about most "smart" assistants: they don't get smarter. They produce a suggestion, you accept or ignore it, and nothing changes. The same nudge fires tomorrow even if you dismissed it 20 times.

That ends today.

**What got built:**

Every action Janjak takes — every nudge, every autonomous email triage, every workflow run, every AI suggestion — now writes two rows:

- A `decision_log` row: *what I did, why, and what evidence I used*
- A `feedback` row: *did the user accept, reject, or ignore it*

**Adaptation rules running in the background:**

→ Nudges with <30% acceptance over 20 samples get muted for 7 days
→ Autonomous actions with >40% rejection get demoted (auto → confirm → suggest)
→ Workflows failing >50% get disabled with a notification
→ Preferences disconfirmed 3x lose confidence sharply

And the part I'm most proud of:

```
$ janjak why last
Suggested: block 9-11am tomorrow for Janjak v2
Evidence:
  · Goal #3 "Ship Janjak v2 by July" (priority 9)
  · 4h this week vs target 10h (memory #2841)
  · Preference: peak coding window 09:00-11:30 (conf 0.82)
  · Calendar: no conflicts tomorrow morning
Confidence: 0.86
```

Every decision is auditable. Every recommendation has a paper trail.

**Why this matters:** trust comes from explainability, not magic. A super brain you can't audit is a black box you can't trust. If Janjak nudges me and I disagree, I want to know what it was thinking — and I want it to learn from the disagreement.

This is the layer that converts a smart system into one that gets smarter, week after week, specifically about *me*.

Next week, the final layer: synthesis. The "sleep cycle" that keeps memory healthy over years.

How much would you trust an AI suggestion if you couldn't see *why* it was made?

#BuildInPublic #AI #ExplainableAI #Feedback

---

## Post 5 — Layer 5: Synthesis

**Hook:** Memory without consolidation is just hoarding. So I gave my assistant a sleep cycle.

---

The final layer of Janjak's super brain shipped: **synthesis.**

Over the past 8 weeks I built memory, a graph, a personal model, and a learning loop. Each layer added intelligence. But left alone, they'd all eventually drown in noise — every trivial Slack mention treated with the same weight as a critical decision, every passing preference equal to a deeply held one.

Brains solve this with sleep. Janjak now does too.

**Three jobs running on a schedule:**

**1. Daily consolidation (3am every night)**
- Summarizes the day into a single paragraph, stored as high-importance memory
- Updates entity importance (decay unused, boost mentioned)
- Decays memory importance for rows not referenced today (the forgetting curve)
- Promotes memory that *was* referenced (importance += 0.1)
- Runs the adaptation pass from Layer 4

**2. Weekly review (Sunday evening, interactive)**
```
$ janjak review
This week you worked 38h, slept on 6/7 nights well, shipped 12 commits.
Your top-mentioned person was Sarah (4 interactions).
You made progress on 2/3 active goals.

Quick check-ins:
  · Is "Run 3x per week" still a goal? You ran once this week. (y/n/edit)
  · Was I right that you prefer voice notifications? You dismissed 4 of 5. (y/n)
```

User answers update the personal model with the highest possible confidence — *stated*, not inferred.

**3. Memory tiering** — the part I'm geekiest about

- **Working memory** (last 7 days): always loaded
- **Recent memory** (last 90 days): freely retrieved
- **Long-term memory** (>90 days): only if importance > 0.6
- **Archive** (>1 year, low importance): compressed to summary

This is what makes the system sustainable. Not for months — for *years*.

---

**Where this leaves me:**

8 weeks ago I had a clever assistant that forgot me between conversations. Today I have something that:

→ Recalls anything I've ever told it, by meaning
→ Knows the people, projects, and themes in my life
→ Has a model of my preferences, goals, and patterns
→ Adapts based on what worked and what didn't
→ Consolidates nightly and reflects weekly

All local. All mine. ~$0.50/month in API costs. Open to me, opaque to anyone else.

The lesson I'll carry into everything I build from here:

**A brain doesn't get smarter by knowing more things. It gets smarter by connecting what it already knows.**

I'll be open-sourcing the schema designs and key modules over the next few weeks for anyone who wants to build their own.

What would *you* build with a personal AI that actually knew you?

#BuildInPublic #AI #PersonalIntelligence #LocalFirst #Janjak

---

## Post 6 — Wrap-up / Retrospective (optional)

**Hook:** 8 weeks, 5 layers, one super brain. Here's what I got wrong.

---

Janjak's super brain is done. Here's the honest retrospective — what worked, what surprised me, what I'd do differently.

**What worked better than expected:**

→ **Embeddings in SQLite as BLOBs.** I almost reached for a vector database on day one. Glad I didn't. With <100k rows, brute-force cosine in SQLite returns in under 20ms. No new infrastructure, no migration headaches.

→ **Entity extraction with gpt-4o-mini.** Cheap, fast, and surprisingly accurate with structured-output JSON schemas. First pass over 3 months of data caught ~90% of people and projects correctly.

→ **The learning loop changed everything.** Once nudges started getting muted automatically for low acceptance, Janjak stopped feeling annoying. That single feature shifted my daily relationship with it more than any other.

**What I got wrong:**

→ I built recall *after* entity extraction at first. Wrong order. Recall is the foundation — entities are an additional index *on top of it*. Rewrote that early.

→ Underestimated how important explainability is. `janjak why` started as a debug tool. It turned out to be the feature that made me actually trust autonomous actions.

→ I designed for "more features" first, then had to refactor toward "more connection between existing features". The second framing is the right one for personal intelligence.

**What I'd tell anyone building something similar:**

1. Start with semantic recall. Everything else is downstream.
2. Make every action produce a feedback row. You can't adapt what you don't measure.
3. Build the audit trail from day one. Trust is non-negotiable.
4. Local-first is not just an ideology — it's the only way you'll ever store data you actually care about.

The repo, schemas, and post series are all linked in the comments.

What's next? Probably a robot. But that's a different series.

#BuildInPublic #AI #LessonsLearned #PersonalIntelligence

---

## Posting tips

- **Best time:** Tuesday/Wednesday 8-10am local. Avoid Friday afternoons.
- **First comment:** drop a link to the previous post in the series so people can binge backwards.
- **Engagement:** reply to every comment within the first 2 hours — it boosts reach dramatically.
- **Visuals (optional but high-impact):**
  - Post 1: a screenshot of `janjak recall` output
  - Post 2: a small graph diagram (5-10 nodes) of your real entity graph
  - Post 3: the preferences table from above as a clean image
  - Post 4: the `janjak why last` output as a code-block screenshot
  - Post 5: a Mermaid diagram of the 5 layers
- **Avoid:** screenshots with personal data, real email content, or anyone's name without permission.

---

# Twitter / X versions

Same series, compressed. Each thread is 5-7 tweets. Use the LinkedIn version as the longform link in the last tweet of each thread.

## Thread 0 — Teaser

**1/** Most "AI assistants" forget you the moment the conversation ends.

You ask the same question twice → two different answers. You tell it your preferences → stranger again tomorrow.

I'm rebuilding mine to fix that. 🧵

**2/** Janjak already runs locally on my Mac. Reads my email. Tracks my focus. Talks by voice.

But it has the same flaw: every interaction starts from zero.

So I'm turning it into something different — a personal super brain.

**3/** Five layers:
→ Semantic memory (everything searchable by meaning)
→ Entity graph (people + projects + topics, connected)
→ Personal model (preferences, goals, routines)
→ Learning loop (feedback that actually adapts)
→ Synthesis (a sleep cycle for memory)

**4/** ~8 weeks of work. All local. ~$0.50/month in API costs.

I'm shipping it in public. One layer per week, one post per layer.

Layer 1 drops next week.

**5/** What's the one thing you wish your AI assistant actually remembered about you?

---

## Thread 1 — Semantic Memory

**1/** Two weeks ago I had a great idea while driving. Told my assistant by voice. Today I needed it back.

Old assistant: gone. Buried in a transcript I'd never find.

That ended this week. 🧵

**2/** Janjak now has semantic memory.

`janjak recall "autonomy tiers idea"` returns:
→ the voice transcript
→ the code session where I prototyped it
→ the email where I referenced it to a friend

One query. Ranked by meaning, not keywords.

**3/** How it works:
→ Every email/task/voice/chat/calendar/PR gets embedded with text-embedding-3-small
→ Vectors stored as Float32 BLOBs in the same SQLite DB (no new infra)
→ Cosine similarity × recency × importance

**4/** The real shift: every AI call now does recall() *first*, then reasons.

Generation never starts from a blank slate again.

Cost: ~$0.50/month in embeddings. Foundation for everything else.

**5/** Next week: turning isolated memories into a graph of people, projects, and topics.

Full writeup → [LinkedIn link]

---

## Thread 2 — Entity Graph

**1/** My assistant just stopped treating every email as a stranger.

For weeks it knew there was a "John from Acme" in Monday's email and a "J. Smith" on a PR. It didn't know they were the same person.

Now it does. 🧵

**2/** Every memory now passes through an extraction pass that pulls:
→ Entities (people, projects, topics, orgs)
→ Relationships (works_with, works_on, mentioned_with)

Stored as a graph in local SQLite.

**3/** ```
$ janjak who "Sarah"
Sarah Chen — Engineering Lead at Acme
Last contact: 6 days ago
Related projects: Vision, Voice v2
Recent context: discussed roadmap May 14
```

**4/** First pass over 3 months of history caught 140 people + 280 relationships I never explicitly told it about.

Most correct on the first try with gpt-4o-mini + structured outputs.

**5/** Email drafts now pull full recipient history. Meeting prep surfaces past interactions automatically.

It stops processing inputs and starts understanding my world.

**6/** Next week: making it *mine*. Preferences, goals, routines.

Full writeup → [LinkedIn link]

---

## Thread 3 — Personal Model

**1/** A generic assistant gives generic advice.

Today my assistant stopped being generic. 🧵

**2/** Three things got added:

→ Preferences (learned from observation)
→ Goals (the anchor that turns reactive into proactive)
→ Routines (patterns extracted automatically)

**3/** Sample preferences it learned on its own:
→ Peak coding: 09:00-11:30 (from session quality scores)
→ Low energy: 14:00-15:00 (from distraction patterns)
→ Email tone: professional-warm (from 300+ sent replies)
→ Break interval: 90 min

Confidence decays without reinforcement.

**4/** Goals are the unlock. Without them, an assistant just reacts to noise.

```
$ janjak goal add "Ship v2 by July" --priority 9
```

Now every nudge checks: does this move me toward what I said I want?

**5/** Morning briefings shifted from generic to specific:

*"You said shipping v2 was priority-9. You've put 4h into it this week vs. 12h on side reading. Want me to block tomorrow 9-11 for it?"*

That's an assistant pushing back. Different category.

**6/** Next week: closing the loop. Feedback + adaptation + explainability.

Full writeup → [LinkedIn link]

---

## Thread 4 — Learning Loop

**1/** I made my assistant capable of being wrong — and getting better because of it. 🧵

**2/** Uncomfortable truth about most "smart" assistants: they don't get smarter.

Same nudge fires tomorrow even if you dismissed it 20 times. No learning. No adaptation.

**3/** Now every Janjak action writes two rows:
→ decision_log: what I did, why, what evidence I used
→ feedback: did the user accept / reject / ignore

Background adaptation runs on the data.

**4/** Adaptation rules:
→ Nudges <30% acceptance → muted 7 days
→ Autonomous actions >40% rejection → demoted (auto→confirm→suggest)
→ Workflows >50% failure → disabled
→ Preferences disconfirmed 3x → confidence drops sharply

**5/** The part I'm proudest of:

```
$ janjak why last
Suggested: block 9-11am for v2
Evidence:
 · Goal #3 (priority 9)
 · 4h this week vs target 10h
 · Peak coding window 09:00-11:30
 · No calendar conflicts
```

Every decision auditable.

**6/** Trust comes from explainability, not magic. A super brain you can't audit is a black box you can't trust.

Next week: the final layer. Synthesis.

Full writeup → [LinkedIn link]

---

## Thread 5 — Synthesis

**1/** Memory without consolidation is hoarding.

So I gave my assistant a sleep cycle. 🧵

**2/** Three new jobs running on a schedule:

→ Daily consolidation (3am)
→ Weekly review (Sunday evening, interactive)
→ Memory tiering (working / recent / long-term / archive)

**3/** Daily job:
→ Summarizes the day into one paragraph (high importance)
→ Decays memory importance for unreferenced rows
→ Promotes memory referenced today
→ Runs adaptation pass

The forgetting curve, on purpose.

**4/** Weekly review is interactive:

*"Is 'Run 3x per week' still a goal? You ran once this week. (y/n/edit)"*

User answers update the model with the highest confidence source: *stated*, not inferred.

**5/** Memory tiers make it sustainable over *years*, not months:
→ Last 7 days: always loaded
→ Last 90 days: freely retrieved
→ >90 days: only if importance > 0.6
→ >1 year + low importance: compressed to summary

**6/** 8 weeks ago: a clever assistant that forgot me.

Today: a system that recalls anything by meaning, knows my people and projects, has a model of my preferences and goals, adapts from feedback, and reflects nightly.

All local. All mine.

**7/** The lesson I'll carry into everything I build from here:

A brain doesn't get smarter by knowing more things. It gets smarter by connecting what it already knows.

Full writeup → [LinkedIn link]

---

# Blog post — the recap (long-form)

A single ~1500-word essay you can publish on a personal blog, Substack, or dev.to and link from every post in the series.

---

## Title: How I Turned My Personal Assistant Into a Super Brain (In Public, In 8 Weeks)

### TL;DR

I spent 8 weeks rebuilding Janjak — my local-first ambient assistant — from a clever-in-the-moment tool into a personal intelligence that remembers, connects, learns, and adapts. Five layers, all local, ~$0.50/month in API costs. This is the story, the architecture, and the lessons.

### The problem

Every "AI assistant" I'd ever used had the same flaw: it didn't remember me.

You'd tell it your preferences on Monday. By Tuesday, it was a stranger. You'd ask the same question twice and get two different answers. You'd correct it, and it would make the same mistake the next day.

Clever in the moment. Amnesiac forever after.

Janjak had this problem too. I'd built it as a local-first ambient assistant — runs on my Mac, reads my email through Gmail OAuth, tracks my focus sessions, drafts replies, talks by voice. It already did a lot. But every interaction started from zero context.

So I rewrote the brain.

### The frame: it's not about more features

The instinct, when an assistant feels limited, is to add features. More integrations, more commands, more "skills." That's the wrong axis.

A brain doesn't get smarter by knowing more things. It gets smarter by *connecting what it already knows*.

So I designed for connection, not coverage. Five layers, each building on the previous.

### Layer 1: Semantic memory

The foundation. Every piece of text Janjak sees — emails, tasks, voice transcripts, AI chats, calendar events, GitHub items — gets embedded with `text-embedding-3-small` and stored as a Float32 BLOB in the existing SQLite database.

No new infrastructure. No vector database. Brute-force cosine similarity over <100k rows returns in under 20ms.

The interface is one command:

```
janjak recall "autonomy tiers idea"
```

And it returns hits ranked by `cosine_similarity × recency_decay × importance` — across every source, by meaning, not keywords.

The non-obvious unlock: every AI call now does `recall()` *first*, then reasons. Generation never starts from a blank slate again. This single change made Janjak feel like a different product.

### Layer 2: Entity graph

Memory alone is a lake of disconnected texts. The graph is what turns those texts into understanding.

A background extraction job runs over recent memory rows and pulls out:
- **Entities** (people, projects, topics, organizations, places)
- **Relationships** (works_with, works_on, mentioned_with, reports_to)

Stored as two tables in SQLite. Each entity tracks first-seen, last-seen, mention count, and importance — all updated automatically as new evidence arrives.

Extraction uses `gpt-4o-mini` with structured outputs (JSON schema). The first pass over 3 months of historical data identified ~140 people and ~280 relationships, with about 90% accuracy on the first try.

Now `janjak who "Sarah"` returns a full profile: last contact, related projects, recent context. Email reply drafts pull the entire history with a recipient. Meeting prep surfaces past interactions automatically. The siloed integrations become a connected knowledge graph.

### Layer 3: Personal model

This is the layer that makes it *mine*. Three new tables:

**Preferences** — learned from observation, not configuration. Categories like communication, schedule, work_style. Each preference has a confidence score that strengthens with reinforcement and decays without it. Examples it learned on its own:
- Peak coding hours: 09:00–11:30
- Low-energy window: 14:00–15:00
- Default email tone: professional-warm

**Goals** — the anchor that turns reactive into proactive. Without explicit goals, an assistant just reacts to noise. With goals, every nudge can be checked against: *does this move me toward what I said I want?*

**Routines** — patterns extracted from session data. Nothing programmed. Just observation.

Every AI call now also injects the top 5 active goals, top 10 high-confidence preferences, and today's relevant routines. Morning briefings stop being generic productivity nudges and start being specific pushback aligned with what I said I cared about.

### Layer 4: Learning loop

Every action Janjak takes — every nudge, every autonomous email triage, every workflow run, every AI suggestion — now writes two rows: a `decision_log` (what, why, evidence) and a `feedback` row (accepted, rejected, ignored).

Background adaptation rules run on the data:
- Nudges with <30% acceptance over 20 samples get muted for 7 days
- Autonomous actions with >40% rejection get demoted (auto → confirm → suggest)
- Workflows failing >50% get disabled with a user notification
- Preferences disconfirmed 3x lose confidence sharply

And the feature I'm most proud of: `janjak why last` returns the full evidence trail for the most recent decision — which memory rows, entities, preferences, and signals fed into it, plus the final confidence.

Trust comes from explainability, not magic. A super brain you can't audit is a black box you can't trust.

### Layer 5: Synthesis

Memory without consolidation is hoarding. Three jobs keep the system healthy:

- **Daily consolidation** (3am nightly): summarizes the day into one paragraph, decays memory importance for unreferenced rows, promotes memory that *was* referenced, runs the adaptation pass.
- **Weekly review** (Sunday evening, interactive): walks through the week, asks check-in questions, updates the personal model with the highest-confidence source — *stated* facts.
- **Memory tiering** with a forgetting curve: working (7 days, always loaded) → recent (90 days, freely retrieved) → long-term (>90 days, only if importance > 0.6) → archive (>1 year + low importance, compressed to summary).

This is what makes the system sustainable for years, not months.

### The numbers

- Total scope: ~8 weeks
- Lines of code added: ~3,500
- Storage: ~50MB after 4 months of data
- Embedding cost: ~$0.50/month
- New runtime dependencies: zero
- Cloud services storing personal data: zero

### What I got wrong

I built recall *after* entity extraction at first. Wrong order. Recall is the foundation. Entities are an additional index on top of it. Rewrote that early.

I underestimated how important explainability is. `janjak why` started as a debug tool. It turned out to be the feature that made me actually trust autonomous actions.

I designed for "more features" first, then had to refactor toward "more connection between existing features." The second framing is the right one for personal intelligence.

### What I'd tell anyone building something similar

1. Start with semantic recall. Everything else is downstream.
2. Make every action produce a feedback row. You can't adapt what you don't measure.
3. Build the audit trail from day one. Trust is non-negotiable.
4. Local-first is not just an ideology — it's the only way you'll ever store data you actually care about.

### What's next

I'm not done. The graph wants better disambiguation. The personal model wants more sources. The synthesis layer wants vision (literally — a small robot is next).

But the *brain* is built. Everything from here is wiring more of my life into it.

If you've been thinking about building a personal AI that actually knows you — not a chatbot wearing a hat — this is the architecture I'd start with.

A brain doesn't get smarter by knowing more things. It gets smarter by connecting what it already knows.

---

*Janjak is open source. Schema designs and core modules are being released alongside this series.*


// ─── Synthesis: Consolidation ───────────────────────────────────
// The "sleep cycle": promote memory that proved useful, let the rest fade,
// and keep the entity graph honest about who/what still matters.

import { getDb } from "../db.js";
import {
  ARCHIVE_AGE_DAYS,
  RECENT_MEMORY_DAYS,
  WORKING_MEMORY_DAYS,
  classifyMemoryTier,
  isArchivable,
  type MemoryTier,
} from "./tiers.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Per-consolidation decay factors by tier (working memory never decays). */
const DECAY_FACTOR: Record<MemoryTier, number> = {
  working: 1,
  recent: 0.98,
  long_term: 0.95,
  archive: 0.9,
};

/** How much importance a referenced memory gains per consolidation. */
const PROMOTE_STEP = 0.1;
/** Entities unseen this many days lose importance. */
const ENTITY_STALE_DAYS = 30;
const ENTITY_DECAY_FACTOR = 0.9;
const ENTITY_BOOST_STEP = 0.05;
/** Safety cap on how many archival rows a single prune pass removes. */
const ARCHIVE_PRUNE_MAX = 200;


function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function startOfLocalDay(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

interface MemoryIdRow {
  id: number;
  timestamp: number;
  importance: number;
}

/**
 * Collect ids of memories that were "referenced" since `sinceTs` — either
 * cited as evidence in a logged decision or mentioned via the entity graph.
 */
export function getReferencedMemoryIds(sinceTs: number): Set<number> {
  const d = getDb();
  const ids = new Set<number>();

  // Memories cited as decision evidence.
  const decisions = d
    .prepare("SELECT evidence FROM decision_log WHERE timestamp >= ?")
    .all(sinceTs) as Array<{ evidence: string }>;
  for (const row of decisions) {
    try {
      const parsed = JSON.parse(row.evidence) as { memoryIds?: unknown };
      if (Array.isArray(parsed.memoryIds)) {
        for (const id of parsed.memoryIds) {
          if (typeof id === "number") ids.add(id);
        }
      }
    } catch {
      /* ignore malformed evidence */
    }
  }

  // Memories surfaced through entity mentions.
  const mentions = d
    .prepare("SELECT DISTINCT memory_id FROM entity_mentions WHERE first_seen >= ?")
    .all(sinceTs) as Array<{ memory_id: number }>;
  for (const row of mentions) ids.add(row.memory_id);

  return ids;
}

export interface MemoryConsolidationResult {
  scanned: number;
  promoted: number;
  decayed: number;
  tierCounts: Record<MemoryTier, number>;
}

/**
 * Apply the forgetting curve. Memories referenced since `sinceTs` are promoted;
 * everything older than working memory and not referenced gently decays by tier.
 */
export function consolidateMemoryStore(
  now = Date.now(),
  sinceTs = startOfLocalDay(now)
): MemoryConsolidationResult {
  const d = getDb();
  const referenced = getReferencedMemoryIds(sinceTs);
  const rows = d
    .prepare("SELECT id, timestamp, importance FROM memory")
    .all() as MemoryIdRow[];

  const tierCounts: Record<MemoryTier, number> = {
    working: 0,
    recent: 0,
    long_term: 0,
    archive: 0,
  };

  let promoted = 0;
  let decayed = 0;
  const workingCutoff = now - WORKING_MEMORY_DAYS * DAY_MS;

  const promoteStmt = d.prepare("UPDATE memory SET importance = ? WHERE id = ?");

  for (const row of rows) {
    const tier = classifyMemoryTier(row, now);
    tierCounts[tier] += 1;

    if (referenced.has(row.id)) {
      const next = clamp(row.importance + PROMOTE_STEP);
      if (next !== row.importance) {
        promoteStmt.run(next, row.id);
        promoted += 1;
      }
      continue;
    }

    // Decay only memories past the working window.
    if (row.timestamp < workingCutoff) {
      const next = clamp(row.importance * DECAY_FACTOR[tier]);
      if (next !== row.importance) {
        promoteStmt.run(next, row.id);
        decayed += 1;
      }
    }
  }

  return { scanned: rows.length, promoted, decayed, tierCounts };
}

export interface ArchivePruneResult {
  candidates: number;
  pruned: number;
}

/**
 * Compress the tail of memory: permanently remove archival rows (older than a
 * year) whose importance has decayed below the keep threshold. Dependent graph
 * rows are cleaned up in the same transaction so nothing is left dangling.
 * Capped per run so a backlog drains gradually rather than in one big delete.
 */
export function pruneArchivedMemories(
  now = Date.now(),
  maxPrune = ARCHIVE_PRUNE_MAX
): ArchivePruneResult {
  const d = getDb();
  const rows = d
    .prepare("SELECT id, timestamp, importance FROM memory")
    .all() as MemoryIdRow[];

  const victims = rows
    .filter((row) => isArchivable(row, now))
    .map((row) => row.id);

  if (victims.length === 0) return { candidates: 0, pruned: 0 };

  const batch = victims.slice(0, maxPrune);
  const delMentions = d.prepare("DELETE FROM entity_mentions WHERE memory_id = ?");
  const delGraphState = d.prepare("DELETE FROM graph_memory_state WHERE memory_id = ?");
  const delMemory = d.prepare("DELETE FROM memory WHERE id = ?");

  const prune = d.transaction((ids: number[]) => {
    let removed = 0;
    for (const id of ids) {
      delMentions.run(id);
      delGraphState.run(id);
      if (delMemory.run(id).changes > 0) removed += 1;
    }
    return removed;
  });

  const pruned = prune(batch);
  return { candidates: victims.length, pruned };
}

export interface EntityConsolidationResult {
  boosted: number;
  decayed: number;
}

/**
 * Keep entity importance aligned with recency: entities seen today get a small
 * boost, entities unseen for a month gently decay.
 */
export function consolidateEntities(now = Date.now()): EntityConsolidationResult {
  const d = getDb();
  const todayStart = startOfLocalDay(now);
  const staleCutoff = now - ENTITY_STALE_DAYS * DAY_MS;

  const rows = d
    .prepare("SELECT id, importance, last_seen FROM entities")
    .all() as Array<{ id: number; importance: number; last_seen: number }>;

  const update = d.prepare("UPDATE entities SET importance = ? WHERE id = ?");
  let boosted = 0;
  let decayed = 0;

  for (const row of rows) {
    if (row.last_seen >= todayStart) {
      const next = clamp(row.importance + ENTITY_BOOST_STEP);
      if (next !== row.importance) {
        update.run(next, row.id);
        boosted += 1;
      }
    } else if (row.last_seen < staleCutoff) {
      const next = clamp(row.importance * ENTITY_DECAY_FACTOR);
      if (next !== row.importance) {
        update.run(next, row.id);
        decayed += 1;
      }
    }
  }

  return { boosted, decayed };
}

/** Snapshot how memory is currently distributed across tiers. */
export function getMemoryTierCounts(now = Date.now()): Record<MemoryTier, number> {
  const d = getDb();
  const rows = d
    .prepare("SELECT timestamp, importance FROM memory")
    .all() as Array<{ timestamp: number; importance: number }>;
  const counts: Record<MemoryTier, number> = {
    working: 0,
    recent: 0,
    long_term: 0,
    archive: 0,
  };
  for (const row of rows) counts[classifyMemoryTier(row, now)] += 1;
  return counts;
}

export function formatMemoryConsolidation(
  memory: MemoryConsolidationResult,
  entities: EntityConsolidationResult,
  prune?: ArchivePruneResult
): string {
  const lines: string[] = ["", "🧹 Memory consolidation", ""];
  lines.push(
    `  Memories: ${memory.scanned} scanned · ${memory.promoted} promoted · ${memory.decayed} decayed`
  );
  lines.push(
    `  Tiers: working ${memory.tierCounts.working} · recent ${memory.tierCounts.recent} · long-term ${memory.tierCounts.long_term} · archive ${memory.tierCounts.archive}`
  );
  if (prune && prune.pruned > 0) {
    lines.push(`  Pruned: ${prune.pruned} archival memories removed`);
  }
  lines.push(
    `  Entities: ${entities.boosted} boosted · ${entities.decayed} decayed`
  );
  lines.push("");
  return lines.join("\n");
}

/** Tier-window boundaries, exported for display / debugging. */
export function tierWindows(now = Date.now()): {
  workingSince: number;
  recentSince: number;
  archiveBefore: number;
} {
  return {
    workingSince: now - WORKING_MEMORY_DAYS * DAY_MS,
    recentSince: now - RECENT_MEMORY_DAYS * DAY_MS,
    archiveBefore: now - ARCHIVE_AGE_DAYS * DAY_MS,
  };
}

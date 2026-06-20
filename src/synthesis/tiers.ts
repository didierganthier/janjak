// ─── Synthesis: Memory Tiers ────────────────────────────────────
// Memory without forgetting is hoarding. Tiers decide what stays loaded,
// what is recalled freely, and what fades unless it proved important.
//
// Pure module — no DB or service imports — so it can be shared by both the
// low-level vector store and the higher-level consolidation pass without
// creating an import cycle.

/** Days of "always loaded" working memory. */
export const WORKING_MEMORY_DAYS = 7;
/** Days within which semantic recall pulls freely regardless of importance. */
export const RECENT_MEMORY_DAYS = 90;
/** Age beyond which memory is considered archival. */
export const ARCHIVE_AGE_DAYS = 365;
/** Long-term memory (>90d) is only retrieved when importance clears this bar. */
export const LONG_TERM_MIN_IMPORTANCE = 0.6;
/** Archive rows below this importance are candidates for compression/pruning. */
export const ARCHIVE_MAX_IMPORTANCE = 0.3;

export type MemoryTier = "working" | "recent" | "long_term" | "archive";

/** Minimal shape needed to place a memory in a tier. */
export interface TierableMemory {
  timestamp: number;
  importance: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function ageInDays(timestamp: number, now = Date.now()): number {
  return Math.max(0, (now - timestamp) / DAY_MS);
}

/** Classify a memory into its tier based on age alone. */
export function classifyMemoryTier(
  record: TierableMemory,
  now = Date.now()
): MemoryTier {
  const age = ageInDays(record.timestamp, now);
  if (age <= WORKING_MEMORY_DAYS) return "working";
  if (age <= RECENT_MEMORY_DAYS) return "recent";
  if (age <= ARCHIVE_AGE_DAYS) return "long_term";
  return "archive";
}

/**
 * Whether a memory should surface in semantic recall. Working and recent
 * memory always qualify; older tiers must have proven their importance.
 */
export function isRetrievable(record: TierableMemory, now = Date.now()): boolean {
  const tier = classifyMemoryTier(record, now);
  if (tier === "working" || tier === "recent") return true;
  return record.importance > LONG_TERM_MIN_IMPORTANCE;
}

/** Whether an archival memory is a candidate for compression/pruning. */
export function isArchivable(record: TierableMemory, now = Date.now()): boolean {
  return (
    classifyMemoryTier(record, now) === "archive" &&
    record.importance < ARCHIVE_MAX_IMPORTANCE
  );
}

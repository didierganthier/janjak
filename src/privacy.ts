// ─── Privacy: Local Data Export ─────────────────────────────────
// Full, transparent export of everything Janjak has learned about you.
// Embeddings are intentionally omitted (large binary vectors); the source
// text and all structured knowledge are included so nothing is hidden.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getDb } from "./db.js";

export interface JanjakExport {
  exportedAt: string;
  counts: Record<string, number>;
  memory: unknown[];
  entities: unknown[];
  relationships: unknown[];
  preferences: unknown[];
  goals: unknown[];
  routines: unknown[];
}

function safeAll(sql: string): unknown[] {
  try {
    return getDb().prepare(sql).all();
  } catch {
    return [];
  }
}

/** Build a complete export of the local knowledge base (no embedding blobs). */
export function exportData(): JanjakExport {
  const memory = safeAll(
    `SELECT id, type, source_id, text, metadata, timestamp, importance
     FROM memory ORDER BY timestamp DESC`
  );
  const entities = safeAll(
    `SELECT id, type, name, canonical_key, aliases, attributes, importance,
            first_seen, last_seen, mention_count
     FROM entities ORDER BY importance DESC`
  );
  const relationships = safeAll(
    `SELECT id, from_entity, to_entity, type, strength, evidence_count, last_evidence
     FROM relationships`
  );
  const preferences = safeAll(`SELECT * FROM preferences ORDER BY confidence DESC`);
  const goals = safeAll(`SELECT * FROM goals ORDER BY active DESC, priority DESC`);
  const routines = safeAll(`SELECT * FROM routines ORDER BY confidence DESC`);

  return {
    exportedAt: new Date().toISOString(),
    counts: {
      memory: memory.length,
      entities: entities.length,
      relationships: relationships.length,
      preferences: preferences.length,
      goals: goals.length,
      routines: routines.length,
    },
    memory,
    entities,
    relationships,
    preferences,
    goals,
    routines,
  };
}

/** Default export path: ~/.janjak/janjak-export-YYYY-MM-DD.json */
export function defaultExportPath(now = Date.now()): string {
  const date = new Date(now).toLocaleDateString("en-CA");
  return join(homedir(), ".janjak", `janjak-export-${date}.json`);
}

/** Write the export to disk and return the path + counts. */
export function writeExport(outPath?: string): { path: string; data: JanjakExport } {
  const data = exportData();
  const path = outPath || defaultExportPath();
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  return { path, data };
}

export function formatExportSummary(path: string, data: JanjakExport): string {
  const lines = ["", "📦 Export complete", "", `  Written to: ${path}`, ""];
  for (const [key, count] of Object.entries(data.counts)) {
    lines.push(`  ${key.padEnd(14)} ${count}`);
  }
  lines.push("");
  return lines.join("\n");
}

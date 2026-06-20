import { getDb } from "../db.js";

export type EntityType = "person" | "project" | "topic" | "organization" | "place";

export interface EntityRecord {
  id: number;
  type: EntityType;
  name: string;
  canonicalKey: string;
  aliases: string[];
  attributes: Record<string, unknown>;
  importance: number;
  firstSeen: number;
  lastSeen: number;
  mentionCount: number;
}

export interface UpsertEntityInput {
  type: EntityType;
  name: string;
  canonicalKey?: string;
  aliases?: string[];
  attributes?: Record<string, unknown>;
  importance?: number;
  seenAt?: number;
}

interface EntityRow {
  id: number;
  type: string;
  name: string;
  canonical_key: string;
  aliases: string;
  attributes: string;
  importance: number;
  first_seen: number;
  last_seen: number;
  mention_count: number;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rowToEntity(row: EntityRow): EntityRecord {
  return {
    id: row.id,
    type: row.type as EntityType,
    name: row.name,
    canonicalKey: row.canonical_key,
    aliases: parseJsonArray(row.aliases),
    attributes: parseJsonObject(row.attributes),
    importance: row.importance,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    mentionCount: row.mention_count,
  };
}

export function normalizeEntityKey(type: EntityType, name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[^\w\s.-]+/g, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
  return `${type}:${base}`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

export function upsertEntity(input: UpsertEntityInput): number {
  const db = getDb();
  const now = input.seenAt ?? Date.now();
  const canonicalKey = input.canonicalKey?.trim() || normalizeEntityKey(input.type, input.name);
  const existing = db
    .prepare("SELECT * FROM entities WHERE canonical_key = ?")
    .get(canonicalKey) as EntityRow | undefined;

  if (existing) {
    const mergedAliases = uniqueStrings([
      ...parseJsonArray(existing.aliases),
      ...(input.aliases ?? []),
      existing.name,
      input.name,
    ]);
    const mergedAttributes = {
      ...parseJsonObject(existing.attributes),
      ...(input.attributes ?? {}),
    };
    const importance = Math.max(existing.importance, input.importance ?? 0.5);
    db.prepare(
      `UPDATE entities
       SET name = ?, aliases = ?, attributes = ?, importance = ?
       WHERE id = ?`
    ).run(
      input.name,
      JSON.stringify(mergedAliases),
      JSON.stringify(mergedAttributes),
      importance,
      existing.id
    );
    return existing.id;
  }

  const result = db.prepare(
    `INSERT INTO entities
     (type, name, canonical_key, aliases, attributes, importance, first_seen, last_seen, mention_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.type,
    input.name,
    canonicalKey,
    JSON.stringify(uniqueStrings([...(input.aliases ?? []), input.name])),
    JSON.stringify(input.attributes ?? {}),
    input.importance ?? 0.5,
    now,
    now,
    0
  );

  return Number(result.lastInsertRowid);
}

export function listEntities(limit = 20, type?: EntityType): EntityRecord[] {
  const db = getDb();
  const rows = type
    ? (db
        .prepare(
          `SELECT * FROM entities
           WHERE type = ?
           ORDER BY importance DESC, mention_count DESC, last_seen DESC
           LIMIT ?`
        )
        .all(type, limit) as EntityRow[])
    : (db
        .prepare(
          `SELECT * FROM entities
           ORDER BY importance DESC, mention_count DESC, last_seen DESC
           LIMIT ?`
        )
        .all(limit) as EntityRow[]);
  return rows.map(rowToEntity);
}

export function findEntityByName(name: string): EntityRecord | null {
  const db = getDb();
  const trimmed = name.trim();
  if (!trimmed) return null;

  const exactRows = db
    .prepare(
      `SELECT * FROM entities
       WHERE lower(name) = lower(?) OR canonical_key = ?
       ORDER BY importance DESC, mention_count DESC
       LIMIT 1`
    )
    .get(trimmed, trimmed) as EntityRow | undefined;
  if (exactRows) return rowToEntity(exactRows);

  const fuzzy = db
    .prepare(
      `SELECT * FROM entities
       WHERE lower(name) LIKE lower(?) OR lower(aliases) LIKE lower(?)
       ORDER BY importance DESC, mention_count DESC
       LIMIT 1`
    )
    .get(`%${trimmed}%`, `%${trimmed}%`) as EntityRow | undefined;
  return fuzzy ? rowToEntity(fuzzy) : null;
}

export function getEntityById(id: number): EntityRecord | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM entities WHERE id = ?").get(id) as EntityRow | undefined;
  return row ? rowToEntity(row) : null;
}

export function recordEntityMention(entityId: number, memoryId: number, mentionText: string, seenAt: number): boolean {
  const db = getDb();
  const result = db.prepare(
    `INSERT OR IGNORE INTO entity_mentions (entity_id, memory_id, mention_text, first_seen)
     VALUES (?, ?, ?, ?)`
  ).run(entityId, memoryId, mentionText, seenAt);
  return result.changes > 0;
}

export interface EntityMention {
  memoryId: number;
  type: string;
  timestamp: number;
  importance: number;
  mentionText: string;
  text: string;
}

export function getEntityMentions(entityId: number, limit = 8): EntityMention[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT m.id AS memoryId, m.type, m.timestamp, m.importance, em.mention_text AS mentionText, m.text
       FROM entity_mentions em
       JOIN memory m ON m.id = em.memory_id
       WHERE em.entity_id = ?
       ORDER BY m.timestamp DESC
       LIMIT ?`
    )
    .all(entityId, limit) as EntityMention[];
}

export function rebuildEntityStats(entityIds?: number[]): void {
  const db = getDb();
  const ids = entityIds?.filter((id, index, arr) => arr.indexOf(id) === index) ?? [];
  const rows = ids.length > 0
    ? (db.prepare(
        `SELECT em.entity_id AS entityId,
                COUNT(*) AS mentionCount,
                MIN(m.timestamp) AS firstSeen,
                MAX(m.timestamp) AS lastSeen
         FROM entity_mentions em
         JOIN memory m ON m.id = em.memory_id
         WHERE em.entity_id IN (${ids.map(() => "?").join(", ")})
         GROUP BY em.entity_id`
      ).all(...ids) as Array<{ entityId: number; mentionCount: number; firstSeen: number; lastSeen: number }>)
    : (db.prepare(
        `SELECT em.entity_id AS entityId,
                COUNT(*) AS mentionCount,
                MIN(m.timestamp) AS firstSeen,
                MAX(m.timestamp) AS lastSeen
         FROM entity_mentions em
         JOIN memory m ON m.id = em.memory_id
         GROUP BY em.entity_id`
      ).all() as Array<{ entityId: number; mentionCount: number; firstSeen: number; lastSeen: number }>);

  const update = db.prepare(
    `UPDATE entities
     SET mention_count = ?, first_seen = ?, last_seen = ?
     WHERE id = ?`
  );

  for (const row of rows) {
    update.run(row.mentionCount, row.firstSeen, row.lastSeen, row.entityId);
  }
}

export interface EntityDeletionResult {
  entityName: string;
  memoriesDeleted: number;
  mentionsDeleted: number;
  relationshipsDeleted: number;
}

/**
 * Hard-delete an entity and everything tied to it: its mentions, relationships,
 * and the memories that referenced it (including their embeddings). Privacy
 * control — use to scrub a person/project/topic from Janjak entirely.
 */
export function deleteEntityByName(name: string): EntityDeletionResult | null {
  const db = getDb();
  const entity = findEntityByName(name);
  if (!entity) return null;

  const memoryRows = db
    .prepare("SELECT DISTINCT memory_id FROM entity_mentions WHERE entity_id = ?")
    .all(entity.id) as Array<{ memory_id: number }>;
  const memoryIds = memoryRows.map((r) => r.memory_id);

  const tx = db.transaction(() => {
    const relResult = db
      .prepare("DELETE FROM relationships WHERE from_entity = ? OR to_entity = ?")
      .run(entity.id, entity.id);

    const mentionResult = db
      .prepare("DELETE FROM entity_mentions WHERE entity_id = ?")
      .run(entity.id);

    let memoriesDeleted = 0;
    if (memoryIds.length > 0) {
      const placeholders = memoryIds.map(() => "?").join(", ");
      // Remove any remaining mentions from other entities pointing at these memories.
      db.prepare(
        `DELETE FROM entity_mentions WHERE memory_id IN (${placeholders})`
      ).run(...memoryIds);
      db.prepare(
        `DELETE FROM graph_memory_state WHERE memory_id IN (${placeholders})`
      ).run(...memoryIds);
      const memResult = db
        .prepare(`DELETE FROM memory WHERE id IN (${placeholders})`)
        .run(...memoryIds);
      memoriesDeleted = memResult.changes;
    }

    db.prepare("DELETE FROM entities WHERE id = ?").run(entity.id);

    return {
      entityName: entity.name,
      memoriesDeleted,
      mentionsDeleted: mentionResult.changes,
      relationshipsDeleted: relResult.changes,
    };
  });

  return tx();
}
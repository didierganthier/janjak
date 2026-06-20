import { getDb } from "../db.js";
import {
  findEntityByName,
  getEntityMentions,
  listEntities,
  recordEntityMention,
  rebuildEntityStats,
  upsertEntity,
  type EntityMention,
  type EntityRecord,
  type EntityType,
} from "./entities.js";
import { extractGraphFromText } from "./extractor.js";
import { getRelatedEntities, upsertRelationship, type RelatedEntity } from "./relationships.js";

interface MemoryRow {
  id: number;
  type: string;
  text: string;
  timestamp: number;
}

interface GraphMemoryStateRow {
  memory_id: number;
}

export interface GraphSyncProgress {
  scanned: number;
  processed: number;
  entities: number;
  relationships: number;
  skipped: number;
}

export interface EntityProfile {
  entity: EntityRecord;
  mentions: EntityMention[];
  related: RelatedEntity[];
}

function rememberGraphState(memoryId: number, entityCount: number, relationshipCount: number): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO graph_memory_state (memory_id, extracted_at, entity_count, relationship_count)
     VALUES (?, ?, ?, ?)`
  ).run(memoryId, Date.now(), entityCount, relationshipCount);
}

function getGraphCandidateRows(limit: number, daysBack?: number, force = false): MemoryRow[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!force) {
    clauses.push("gms.memory_id IS NULL");
  }
  if (typeof daysBack === "number" && daysBack > 0) {
    clauses.push("m.timestamp >= ?");
    params.push(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  return db
    .prepare(
      `SELECT m.id, m.type, m.text, m.timestamp
       FROM memory m
       LEFT JOIN graph_memory_state gms ON gms.memory_id = m.id
       ${where}
       ORDER BY m.timestamp DESC
       LIMIT ?`
    )
    .all(...params, limit) as MemoryRow[];
}

export async function syncMemoryToGraph(opts: {
  limit?: number;
  daysBack?: number;
  force?: boolean;
} = {}): Promise<GraphSyncProgress> {
  const limit = Math.max(1, opts.limit ?? 50);
  const rows = getGraphCandidateRows(limit, opts.daysBack, opts.force ?? false);
  const progress: GraphSyncProgress = {
    scanned: rows.length,
    processed: 0,
    entities: 0,
    relationships: 0,
    skipped: 0,
  };
  const touchedEntityIds = new Set<number>();

  for (const row of rows) {
    const extracted = await extractGraphFromText(row.text, row.type as never);
    const localIds = new Map<string, number>();

    for (const entity of extracted.entities) {
      const entityId = upsertEntity({
        type: entity.type,
        name: entity.name,
        canonicalKey: entity.canonicalKey,
        aliases: entity.aliases,
        attributes: entity.attributes,
        importance: entity.importance ?? 0.5,
        seenAt: row.timestamp,
      });
      touchedEntityIds.add(entityId);
      localIds.set(entity.name.toLowerCase(), entityId);
      recordEntityMention(entityId, row.id, entity.name, row.timestamp);
      progress.entities++;
    }

    for (const relationship of extracted.relationships) {
      const fromId = localIds.get(relationship.from.toLowerCase());
      const toId = localIds.get(relationship.to.toLowerCase());
      if (!fromId || !toId) continue;
      const relId = upsertRelationship(fromId, toId, relationship.type, row.timestamp);
      if (relId) progress.relationships++;
    }

    rememberGraphState(row.id, extracted.entities.length, extracted.relationships.length);
    if (extracted.entities.length === 0 && extracted.relationships.length === 0) {
      progress.skipped++;
    } else {
      progress.processed++;
    }
  }

  if (touchedEntityIds.size > 0) {
    rebuildEntityStats([...touchedEntityIds]);
  }

  return progress;
}

export function getEntityProfile(name: string): EntityProfile | null {
  const entity = findEntityByName(name);
  if (!entity) return null;
  return {
    entity,
    mentions: getEntityMentions(entity.id, 8),
    related: getRelatedEntities(entity.id, 12),
  };
}

export function getEntityNetwork(name: string): EntityProfile | null {
  return getEntityProfile(name);
}

export function getTopEntities(limit = 20, type?: EntityType): EntityRecord[] {
  return listEntities(limit, type);
}

export function formatGraphSync(progress: GraphSyncProgress): string {
  return [
    "",
    "🕸️ Entity graph sync complete",
    "",
    `  Scanned: ${progress.scanned}`,
    `  Memories with graph signal: ${progress.processed}`,
    `  Memories with no durable entities: ${progress.skipped}`,
    `  Entity upserts: ${progress.entities}`,
    `  Relationship upserts: ${progress.relationships}`,
    "",
  ].join("\n");
}

export function formatEntityList(entities: EntityRecord[]): string {
  if (entities.length === 0) return "\n  No entities yet. Run `janjak entities --sync` first.\n";
  const lines = ["", `🕸️ Entities — ${entities.length} shown`, ""];
  for (const entity of entities) {
    const date = new Date(entity.lastSeen).toISOString().slice(0, 10);
    lines.push(
      `  [#${entity.id}] ${entity.type.padEnd(13)} ${entity.name.padEnd(24)} imp=${entity.importance.toFixed(2)} mentions=${entity.mentionCount} last=${date}`
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function formatEntityProfile(profile: EntityProfile | null): string {
  if (!profile) return "\n  No entity found.\n";

  const { entity, mentions, related } = profile;
  const lines = [
    "",
    `🕸️ ${entity.name}`,
    `  Type: ${entity.type}`,
    `  Importance: ${entity.importance.toFixed(2)}`,
    `  Mentions: ${entity.mentionCount}`,
    `  First seen: ${new Date(entity.firstSeen).toISOString().slice(0, 10)}`,
    `  Last seen: ${new Date(entity.lastSeen).toISOString().slice(0, 10)}`,
  ];

  const attrEntries = Object.entries(entity.attributes);
  if (attrEntries.length > 0) {
    lines.push(`  Attributes: ${attrEntries.map(([key, value]) => `${key}=${String(value)}`).join(", ")}`);
  }
  if (entity.aliases.length > 1) {
    lines.push(`  Aliases: ${entity.aliases.join(", ")}`);
  }

  lines.push("", "  Recent mentions:");
  if (mentions.length === 0) {
    lines.push("    none");
  } else {
    for (const mention of mentions) {
      const date = new Date(mention.timestamp).toISOString().slice(0, 10);
      const snippet = mention.text.length > 110 ? mention.text.slice(0, 107) + "..." : mention.text;
      lines.push(`    - ${date} [${mention.type}] ${snippet.replace(/\n+/g, " ")}`);
    }
  }

  lines.push("", "  Related entities:");
  if (related.length === 0) {
    lines.push("    none");
  } else {
    for (const item of related.slice(0, 8)) {
      lines.push(
        `    - ${item.entity.name} (${item.entity.type}) via ${item.relationship.type} strength=${item.relationship.strength.toFixed(2)}`
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function formatEntityNetwork(profile: EntityProfile | null): string {
  if (!profile) return "\n  No entity found.\n";
  const lines = ["", `🕸️ Network — ${profile.entity.name}`, ""];
  if (profile.related.length === 0) {
    lines.push("  No connected entities yet.", "");
    return lines.join("\n");
  }

  for (const item of profile.related) {
    const arrow = item.direction === "outgoing" ? "->" : "<-";
    lines.push(
      `  ${profile.entity.name} ${arrow} ${item.entity.name}  [${item.relationship.type}] strength=${item.relationship.strength.toFixed(2)} evidence=${item.relationship.evidenceCount}`
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function rebuildGraphStats(): void {
  rebuildEntityStats();
}

export function formatEntityContextForPrompt(query: string, limit = 5): string {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return "";

  const pool = listEntities(100);
  const matched = pool.filter((entity) => {
    if (trimmed.includes(entity.name.toLowerCase())) return true;
    return entity.aliases.some((alias) => trimmed.includes(alias.toLowerCase()));
  });

  const selected = (matched.length > 0 ? matched : pool.slice(0, Math.min(limit, 3))).slice(0, limit);
  if (selected.length === 0) return "";

  const lines: string[] = ["[Relevant Entities]"];
  for (const entity of selected) {
    const related = getRelatedEntities(entity.id, 3)
      .map((item) => `${item.entity.name}(${item.relationship.type})`)
      .join(", ");
    const attrs = Object.entries(entity.attributes)
      .slice(0, 3)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(", ");
    const bits = [
      `${entity.name} [${entity.type}]`,
      `importance=${entity.importance.toFixed(2)}`,
      `mentions=${entity.mentionCount}`,
    ];
    if (attrs) bits.push(attrs);
    if (related) bits.push(`related: ${related}`);
    lines.push(`- ${bits.join("; ")}`);
  }
  return lines.join("\n");
}
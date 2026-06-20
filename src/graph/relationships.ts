import { getDb } from "../db.js";
import { getEntityById, type EntityRecord } from "./entities.js";

export interface RelationshipRecord {
  id: number;
  fromEntity: number;
  toEntity: number;
  type: string;
  strength: number;
  evidenceCount: number;
  lastEvidence: number;
}

export interface RelatedEntity {
  relationship: RelationshipRecord;
  entity: EntityRecord;
  direction: "outgoing" | "incoming";
}

interface RelationshipRow {
  id: number;
  from_entity: number;
  to_entity: number;
  type: string;
  strength: number;
  evidence_count: number;
  last_evidence: number;
}

function rowToRelationship(row: RelationshipRow): RelationshipRecord {
  return {
    id: row.id,
    fromEntity: row.from_entity,
    toEntity: row.to_entity,
    type: row.type,
    strength: row.strength,
    evidenceCount: row.evidence_count,
    lastEvidence: row.last_evidence,
  };
}

export function upsertRelationship(
  fromEntity: number,
  toEntity: number,
  type: string,
  seenAt = Date.now(),
  strengthDelta = 0.08
): number | null {
  if (fromEntity === toEntity) return null;

  const db = getDb();
  const existing = db
    .prepare(
      `SELECT * FROM relationships
       WHERE from_entity = ? AND to_entity = ? AND type = ?`
    )
    .get(fromEntity, toEntity, type) as RelationshipRow | undefined;

  if (existing) {
    db.prepare(
      `UPDATE relationships
       SET strength = ?, evidence_count = evidence_count + 1, last_evidence = ?
       WHERE id = ?`
    ).run(Math.min(1, existing.strength + strengthDelta), seenAt, existing.id);
    return existing.id;
  }

  const result = db.prepare(
    `INSERT INTO relationships
     (from_entity, to_entity, type, strength, evidence_count, last_evidence)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(fromEntity, toEntity, type, 0.5, 1, seenAt);
  return Number(result.lastInsertRowid);
}

export function getRelatedEntities(entityId: number, limit = 12): RelatedEntity[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM relationships
       WHERE from_entity = ? OR to_entity = ?
       ORDER BY strength DESC, evidence_count DESC, last_evidence DESC
       LIMIT ?`
    )
    .all(entityId, entityId, limit) as RelationshipRow[];

  const related: RelatedEntity[] = [];
  for (const row of rows) {
    const relationship = rowToRelationship(row);
    const direction = row.from_entity === entityId ? "outgoing" : "incoming";
    const otherId = row.from_entity === entityId ? row.to_entity : row.from_entity;
    const entity = getEntityById(otherId);
    if (!entity) continue;
    related.push({ relationship, entity, direction });
  }
  return related;
}
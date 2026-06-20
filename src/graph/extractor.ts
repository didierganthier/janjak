import OpenAI from "openai";
import type { MemoryType } from "../memory/vector-store.js";
import type { EntityType } from "./entities.js";

export interface ExtractedEntity {
  type: EntityType;
  name: string;
  aliases?: string[];
  canonicalKey?: string;
  attributes?: Record<string, unknown>;
  importance?: number;
}

export interface ExtractedRelationship {
  from: string;
  to: string;
  type: string;
}

export interface ExtractedGraph {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

function getOpenAIClient(): OpenAI {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to ~/.janjak/.env to enable entity extraction."
    );
  }
  return new OpenAI({ apiKey });
}

function stripCodeFences(content: string): string {
  return content.replace(/^```(?:json)?\n?/g, "").replace(/\n?```$/g, "").trim();
}

function normalizeEntity(entity: ExtractedEntity): ExtractedEntity | null {
  const name = entity.name?.trim();
  if (!name) return null;
  const validTypes = new Set<EntityType>(["person", "project", "topic", "organization", "place"]);
  if (!validTypes.has(entity.type)) return null;
  const aliases = Array.isArray(entity.aliases)
    ? entity.aliases.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  return {
    type: entity.type,
    name,
    aliases,
    canonicalKey: typeof entity.canonicalKey === "string" ? entity.canonicalKey.trim() || undefined : undefined,
    attributes:
      entity.attributes && typeof entity.attributes === "object" && !Array.isArray(entity.attributes)
        ? (entity.attributes as Record<string, unknown>)
        : {},
    importance:
      typeof entity.importance === "number"
        ? Math.max(0, Math.min(1, entity.importance))
        : undefined,
  };
}

function normalizeGraph(graph: ExtractedGraph): ExtractedGraph {
  const entities: ExtractedEntity[] = [];
  const byName = new Set<string>();
  for (const entity of graph.entities ?? []) {
    const normalized = normalizeEntity(entity);
    if (!normalized) continue;
    const key = `${normalized.type}:${normalized.name.toLowerCase()}`;
    if (byName.has(key)) continue;
    byName.add(key);
    entities.push(normalized);
  }

  const names = new Set(entities.map((entity) => entity.name.toLowerCase()));
  const relationships = (graph.relationships ?? []).filter((rel) => {
    return (
      typeof rel.from === "string" &&
      typeof rel.to === "string" &&
      typeof rel.type === "string" &&
      rel.from.trim().length > 0 &&
      rel.to.trim().length > 0 &&
      rel.type.trim().length > 0 &&
      names.has(rel.from.trim().toLowerCase()) &&
      names.has(rel.to.trim().toLowerCase())
    );
  }).map((rel) => ({
    from: rel.from.trim(),
    to: rel.to.trim(),
    type: rel.type.trim().toLowerCase().replace(/\s+/g, "_"),
  }));

  return { entities, relationships };
}

export async function extractGraphFromText(text: string, memoryType?: MemoryType): Promise<ExtractedGraph> {
  const trimmed = text.trim();
  if (!trimmed) return { entities: [], relationships: [] };

  const prompt = `Extract durable entities and explicit relationships from this Janjak memory.

Allowed entity types: person, project, topic, organization, place.
Only extract entities that are likely to matter later. Ignore vague pronouns, generic nouns, and one-off filler.
Prefer concrete names from the text. If a relationship is uncertain, omit it.
Return valid JSON only with this exact shape:
{
  "entities": [
    {
      "type": "person" | "project" | "topic" | "organization" | "place",
      "name": "...",
      "aliases": ["..."],
      "attributes": { "key": "value" },
      "importance": 0.0
    }
  ],
  "relationships": [
    {
      "from": "Entity Name",
      "to": "Entity Name",
      "type": "works_on | works_with | mentioned_with | discussed_in | reports_to | part_of"
    }
  ]
}

Memory type: ${memoryType ?? "unknown"}
Memory text:
${trimmed.slice(0, 4000)}`;

  const response = await getOpenAIClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You extract entities for a personal knowledge graph. Respond with valid JSON only. No markdown.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 900,
  });

  const content = stripCodeFences(response.choices[0]?.message?.content?.trim() ?? "{}");
  try {
    return normalizeGraph(JSON.parse(content) as ExtractedGraph);
  } catch {
    return { entities: [], relationships: [] };
  }
}
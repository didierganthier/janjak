// ─── Learning Loop: Explainability ──────────────────────────────
// Every meaningful decision Janjak makes writes a traceable record so the
// user can always ask "why did you do that?" — non-negotiable for trust.

import { getDb } from "../db.js";

export interface DecisionEvidence {
  memoryIds?: number[];
  entityIds?: number[];
  signals?: string[];
  [key: string]: unknown;
}

export interface DecisionRecord {
  id: number;
  decisionId: string;
  type: string;
  description: string;
  evidence: DecisionEvidence;
  confidence: number;
  timestamp: number;
}

interface DecisionRow {
  id: number;
  decision_id: string;
  type: string;
  description: string;
  evidence: string;
  confidence: number;
  timestamp: number;
}

function parseEvidence(value: string): DecisionEvidence {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as DecisionEvidence)
      : {};
  } catch {
    return {};
  }
}

function mapRow(row: DecisionRow): DecisionRecord {
  return {
    id: row.id,
    decisionId: row.decision_id,
    type: row.type,
    description: row.description,
    evidence: parseEvidence(row.evidence),
    confidence: row.confidence,
    timestamp: row.timestamp,
  };
}

export interface LogDecisionInput {
  decisionId: string;
  type: string;
  description: string;
  evidence?: DecisionEvidence;
  confidence?: number;
  timestamp?: number;
}

/**
 * Record a decision. Best-effort and idempotent on decision_id — repeated
 * logging of the same id refreshes the row rather than failing.
 */
export function logDecision(input: LogDecisionInput): void {
  try {
    const d = getDb();
    d.prepare(
      `INSERT INTO decision_log (decision_id, type, description, evidence, confidence, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(decision_id) DO UPDATE SET
         type = excluded.type,
         description = excluded.description,
         evidence = excluded.evidence,
         confidence = excluded.confidence,
         timestamp = excluded.timestamp`
    ).run(
      input.decisionId,
      input.type,
      input.description,
      JSON.stringify(input.evidence ?? {}),
      input.confidence ?? 0.5,
      input.timestamp ?? Date.now()
    );
  } catch {
    /* decision logging is best-effort */
  }
}

export function getDecisionById(decisionId: string): DecisionRecord | null {
  const d = getDb();
  const row = d
    .prepare("SELECT * FROM decision_log WHERE decision_id = ?")
    .get(decisionId) as DecisionRow | undefined;
  return row ? mapRow(row) : null;
}

export function getLastDecision(): DecisionRecord | null {
  const d = getDb();
  const row = d
    .prepare("SELECT * FROM decision_log ORDER BY timestamp DESC LIMIT 1")
    .get() as DecisionRow | undefined;
  return row ? mapRow(row) : null;
}

export function getRecentDecisions(limit = 10): DecisionRecord[] {
  const d = getDb();
  const rows = d
    .prepare("SELECT * FROM decision_log ORDER BY timestamp DESC LIMIT ?")
    .all(limit) as DecisionRow[];
  return rows.map(mapRow);
}

function resolveEvidenceText(evidence: DecisionEvidence): string[] {
  const lines: string[] = [];

  if (evidence.signals && evidence.signals.length > 0) {
    lines.push(`  Signals: ${evidence.signals.join(", ")}`);
  }

  if (evidence.memoryIds && evidence.memoryIds.length > 0) {
    lines.push(`  Memory rows: ${evidence.memoryIds.join(", ")}`);
  }

  if (evidence.entityIds && evidence.entityIds.length > 0) {
    lines.push(`  Entities: ${evidence.entityIds.join(", ")}`);
  }

  const known = new Set(["signals", "memoryIds", "entityIds"]);
  for (const [key, value] of Object.entries(evidence)) {
    if (known.has(key)) continue;
    lines.push(`  ${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }

  return lines;
}

/** Render an explanation for `janjak why`. */
export function formatExplanation(decision: DecisionRecord | null): string {
  if (!decision) {
    return "\n  No matching decision found. Try `janjak why last`.\n";
  }

  const when = new Date(decision.timestamp).toLocaleString();
  const lines: string[] = [
    `\n🔎 Why: ${decision.description}`,
    "─".repeat(40),
    `  Decision: ${decision.decisionId}`,
    `  Type: ${decision.type}`,
    `  Confidence: ${decision.confidence.toFixed(2)}`,
    `  When: ${when}`,
  ];

  const evidenceLines = resolveEvidenceText(decision.evidence);
  if (evidenceLines.length > 0) {
    lines.push("", "  Evidence:");
    lines.push(...evidenceLines.map((l) => "  " + l.trimStart().replace(/^/, "  ")));
  } else {
    lines.push("", "  (no structured evidence recorded)");
  }

  lines.push("");
  return lines.join("\n");
}

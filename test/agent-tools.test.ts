// ─── Agent tool registry & safety unit tests ─────────────────────
// Zero-API tests that lock down the security-critical surface:
//   • every tool schema is well-formed and uniquely named
//   • risk classification (which tools require confirmation) is correct
//   • describeAction produces sensible human-readable text
//   • write_file's sandbox refuses paths outside the allowlist
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

import {
  getAgentTools,
  getToolSchemas,
  findTool,
  describeAction,
} from "../src/agent/tools.js";

// The tools we expect to require explicit user confirmation before running.
const CONFIRM_TIER = [
  "create_calendar_event",
  "run_workflow",
  "write_file",
  "create_gmail_draft",
  "send_email",
  "draft_email",
].sort();

function schemaName(schema: ReturnType<typeof getToolSchemas>[number]): string {
  assert.equal(schema.type, "function", "every tool schema must be a function");
  return schema.type === "function" ? schema.function.name : "";
}

test("every tool schema is a well-formed, uniquely-named function", () => {
  const schemas = getToolSchemas();
  assert.ok(schemas.length >= 20, "expected the full tool set to be registered");

  const names = new Set<string>();
  for (const schema of schemas) {
    const name = schemaName(schema);
    assert.match(name, /^[a-z][a-z0-9_]*$/, `tool name "${name}" should be snake_case`);
    assert.ok(!names.has(name), `duplicate tool name: ${name}`);
    names.add(name);

    assert.equal(schema.type, "function");
    if (schema.type === "function") {
      const fn = schema.function;
      assert.ok(fn.description && fn.description.length > 0, `${name} needs a description`);
      assert.ok(fn.parameters && typeof fn.parameters === "object", `${name} needs parameters`);
    }
  }
});

test("findTool resolves every registered schema and rejects unknowns", () => {
  for (const schema of getToolSchemas()) {
    const name = schemaName(schema);
    assert.ok(findTool(name), `findTool should resolve ${name}`);
  }
  assert.equal(findTool("definitely_not_a_tool"), undefined);
});

test("exactly the expected tools are confirm-tier; the rest are safe", () => {
  const confirmTools = getAgentTools()
    .filter((t) => t.risk === "confirm")
    .map((t) => schemaName(t.schema))
    .sort();

  assert.deepEqual(confirmTools, CONFIRM_TIER);

  // Spot-check that benign tools are NOT confirm-tier.
  for (const safe of ["list_tasks", "get_weather", "web_search", "recall_memory"]) {
    assert.notEqual(findTool(safe)?.risk, "confirm", `${safe} should be safe`);
  }
});

test("describeAction renders human-readable text for risky tools", () => {
  assert.match(
    describeAction("write_file", { path: "Desktop/notes.txt" }),
    /write a file to Desktop\/notes\.txt/
  );
  assert.match(
    describeAction("create_calendar_event", { title: "Standup", date: "2026-07-01", startTime: "09:00" }),
    /Standup.*2026-07-01.*09:00/
  );
  assert.match(describeAction("run_workflow", { id: "deploy" }), /run the workflow "deploy"/);
  assert.match(describeAction("create_gmail_draft", { to: "a@b.com", subject: "Hi" }), /a@b\.com.*Hi/);
  // Unknown tool falls back to a spaced-out name.
  assert.equal(describeAction("some_new_tool", {}), "some new tool");
});

test("write_file refuses absolute paths outside the allowlist", async () => {
  const wf = findTool("write_file");
  assert.ok(wf);

  for (const badPath of ["/etc/janjak-pwn.txt", "/tmp/janjak-pwn.txt", "/usr/local/janjak-pwn.txt"]) {
    const res = await wf!.handler({ path: badPath, content: "x", overwrite: true });
    assert.match(res, /for safety/i, `should refuse ${badPath}`);
    assert.ok(!existsSync(badPath), `must not create ${badPath}`);
  }
});

test("write_file refuses path-traversal escapes from the Desktop root", async () => {
  const wf = findTool("write_file");
  const res = await wf!.handler({ path: "../../etc/janjak-pwn.txt", content: "x", overwrite: true });
  assert.match(res, /for safety/i);
  assert.ok(!existsSync(join(homedir(), "..", "..", "etc", "janjak-pwn.txt")));
});

test("write_file allows writes inside an allowlisted root", async () => {
  const wf = findTool("write_file");
  const target = join(homedir(), ".janjak", "janjak-test-harness.txt");
  try {
    const res = await wf!.handler({ path: target, content: "ok", overwrite: true });
    assert.match(res, /wrote/i);
    assert.ok(existsSync(target));
  } finally {
    if (existsSync(target)) unlinkSync(target);
  }
});

test("write_file does not double-prepend an allowlisted folder name", async () => {
  const wf = findTool("write_file");
  const nested = join(homedir(), "Desktop", "Desktop", "dupe.txt");
  try {
    const res = await wf!.handler({ path: "Desktop/dupe-write-test.txt", content: "x", overwrite: true });
    assert.match(res, /Desktop\/dupe-write-test\.txt/);
    assert.ok(!res.includes("Desktop/Desktop"));
    assert.ok(!existsSync(nested));
  } finally {
    const ok = join(homedir(), "Desktop", "dupe-write-test.txt");
    if (existsSync(ok)) unlinkSync(ok);
  }
});

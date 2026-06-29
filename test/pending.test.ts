// ─── Pending-confirmation store tests (daemon/non-interactive path) ──
import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

import {
  makePendingConfirm,
  executePending,
  getPending,
  clearPending,
  isAffirmative,
  isNegative,
} from "../src/agent/pending.js";

test("affirmative/negative detection", () => {
  for (const yes of ["yes", "yeah", "sure", "go ahead", "do it", "confirm", "oui", "wi"]) {
    assert.ok(isAffirmative(yes), `${yes} should be affirmative`);
  }
  for (const no of ["no", "nope", "cancel", "stop", "don't", "nah"]) {
    assert.ok(isNegative(no), `${no} should be negative`);
  }
  assert.ok(!isAffirmative("tell me the weather"));
  assert.ok(!isNegative("yes please"));
});

test("makePendingConfirm parks the action and denies it now", async () => {
  const confirm = makePendingConfirm("t1");
  const allowed = await confirm({ tool: "write_file", description: "write a file", args: { path: "x" } });
  assert.equal(allowed, false);
  assert.equal(getPending("t1")?.tool, "write_file");
  clearPending("t1");
  assert.equal(getPending("t1"), null);
});

test("executePending runs the parked tool then clears it", async () => {
  const target = join(homedir(), ".janjak", "janjak-pending-test.txt");
  const confirm = makePendingConfirm("t2");
  await confirm({ tool: "write_file", description: "write test", args: { path: target, content: "ok", overwrite: true } });
  try {
    const res = await executePending("t2");
    assert.match(res ?? "", /wrote/i);
    assert.ok(existsSync(target));
    assert.equal(getPending("t2"), null);
    assert.equal(await executePending("t2"), null);
  } finally {
    if (existsSync(target)) unlinkSync(target);
  }
});

test("executePending still respects the write sandbox", async () => {
  const confirm = makePendingConfirm("t3");
  await confirm({ tool: "write_file", description: "evil", args: { path: "/etc/janjak-pwn.txt", content: "x", overwrite: true } });
  const res = await executePending("t3");
  assert.match(res ?? "", /for safety/i);
  assert.ok(!existsSync("/etc/janjak-pwn.txt"));
});

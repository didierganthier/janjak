// ─── ClientOps util unit tests (pure logic, no network / no DB) ─────
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDueDate, formatMoney, isOverdue, daysUntil } from "../src/clientops/util.js";

function isoDaysFromNow(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${da}`;
}

test("parseDueDate keywords resolve relative to today", () => {
  assert.equal(parseDueDate("today"), isoDaysFromNow(0));
  assert.equal(parseDueDate("tomorrow"), isoDaysFromNow(1));
  assert.equal(parseDueDate("next-week"), isoDaysFromNow(7));
  assert.equal(parseDueDate("NextWeek"), isoDaysFromNow(7));
});

test("parseDueDate keeps ISO dates and rejects junk", () => {
  assert.equal(parseDueDate("2026-06-15"), "2026-06-15");
  assert.equal(parseDueDate("2026-06-15T10:00:00"), "2026-06-15");
  assert.equal(parseDueDate(""), null);
  assert.equal(parseDueDate(null), null);
  assert.equal(parseDueDate("not a date"), null);
});

test("formatMoney groups thousands and switches on currency", () => {
  assert.equal(formatMoney(1500), "$1,500");
  assert.equal(formatMoney(750, "USD"), "$750");
  assert.equal(formatMoney(1500, "HTG"), "1,500 HTG");
  assert.equal(formatMoney(null), "—");
});

test("isOverdue is true only for past dates", () => {
  assert.ok(isOverdue(isoDaysFromNow(-1)));
  assert.ok(!isOverdue(isoDaysFromNow(1)));
  assert.ok(!isOverdue(null));
});

test("daysUntil returns signed day distance", () => {
  assert.equal(daysUntil(isoDaysFromNow(0)), 0);
  assert.equal(daysUntil(isoDaysFromNow(3)), 3);
  assert.equal(daysUntil(isoDaysFromNow(-2)), -2);
  assert.equal(daysUntil(null), null);
});

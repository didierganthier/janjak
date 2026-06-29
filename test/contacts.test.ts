// ─── Contact resolution unit tests (pure parsing, no network) ──────
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseAddress, looksLikeEmail, resolveContact } from "../src/contacts.js";

test("looksLikeEmail", () => {
  assert.ok(looksLikeEmail("marc@example.com"));
  assert.ok(looksLikeEmail("a.b+c@sub.domain.io"));
  assert.ok(!looksLikeEmail("Marc"));
  assert.ok(!looksLikeEmail("marc @ example.com"));
});

test("parseAddress handles display-name and bare forms", () => {
  assert.deepEqual(parseAddress("Marc Doe <marc@x.com>"), { name: "Marc Doe", email: "marc@x.com" });
  assert.deepEqual(parseAddress('"Doe, Marc" <Marc@X.com>'), { name: "Doe, Marc", email: "marc@x.com" });
  assert.deepEqual(parseAddress("marc@x.com"), { name: "", email: "marc@x.com" });
  assert.equal(parseAddress("no address here"), null);
});

test("resolveContact returns the email verbatim when given one", async () => {
  const matches = await resolveContact("Marc@Example.com");
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.email, "marc@example.com");
  assert.equal(matches[0]!.source, "email");
});

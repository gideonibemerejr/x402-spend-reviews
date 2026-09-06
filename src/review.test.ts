import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSubmission, ReviewValidationError } from "./review.js";
import { submission } from "./fixtures.js";

const rejects = (body: unknown, reason: RegExp) =>
  assert.throws(() => parseSubmission(body), (error: unknown) => {
    assert.ok(error instanceof ReviewValidationError);
    assert.match(error.message, reason);
    return true;
  });

test("a well-formed submission round trips", () => {
  const parsed = parseSubmission({ ...submission(), taskClass: "search", note: "clean answer", paidMs: 42 });
  assert.equal(parsed.taskClass, "search");
  assert.equal(parsed.note, "clean answer");
  assert.equal(parsed.paidMs, 42);
});

test("unlabeled is not a publishable verdict", () => {
  rejects({ ...submission(), outcome: "unlabeled" }, /outcome must be one of/);
});

test("a settlement is required to have something to verify", () => {
  rejects({ ...submission(), transaction: "" }, /transaction is required/);
  rejects({ ...submission(), payer: "" }, /payer is required/);
  rejects({ ...submission(), transaction: "0xabc" }, /32-byte hex hash/);
  rejects({ ...submission(), payer: "not-an-address" }, /20-byte hex address/);
});

test("a resource URL still carrying a query string or fragment is rejected", () => {
  rejects({ ...submission(), resourceUrl: "https://api.test/paid?key=secret" }, /query string and fragment/);
  rejects({ ...submission(), resourceUrl: "https://api.test/paid#top" }, /query string and fragment/);
  rejects({ ...submission(), resourceUrl: "/paid" }, /absolute URL/);
});

test("amounts stay atomic decimal strings", () => {
  rejects({ ...submission(), amount: "0.01" }, /atomic units/);
  rejects({ ...submission(), amount: "1e4" }, /atomic units/);
  assert.equal(parseSubmission({ ...submission(), amount: "0" }).amount, "0");
});

test("the envelope is checked before anything else", () => {
  rejects(null, /must be a JSON object/);
  rejects([submission()], /must be a JSON object/);
  rejects({ ...submission(), schema: 2 }, /schema must be 1/);
  rejects({ ...submission(), ts: "whenever" }, /parseable timestamp/);
});

test("fields the client keeps to itself are dropped rather than stored", () => {
  const parsed = parseSubmission({ ...submission(), id: "local-only", legs: [{ kind: "paid" }], status: 200 });
  assert.equal(Object.hasOwn(parsed, "id"), false);
  assert.equal(Object.hasOwn(parsed, "legs"), false);
  assert.equal(Object.hasOwn(parsed, "status"), false);
});

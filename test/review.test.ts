import { expect, test } from "vitest";
import { ReviewSubmission } from "../src/review";
import { submission } from "../src/fixtures";

/** Asserts the schema refuses a body, naming the check that failed. */
const rejects = (body: unknown, reason: RegExp) => {
  const result = ReviewSubmission.safeParse(body);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")).toMatch(reason);
  }
};

test("a well-formed submission round trips", () => {
  const parsed = ReviewSubmission.parse({ ...submission(), taskClass: "search", note: "clean answer", paidMs: 42 });
  expect(parsed.taskClass).toBe("search");
  expect(parsed.note).toBe("clean answer");
  expect(parsed.paidMs).toBe(42);
});

test("unlabeled is not a publishable verdict", () => {
  rejects({ ...submission(), outcome: "unlabeled" }, /outcome/);
});

test("a settlement is required to have something to verify", () => {
  rejects({ ...submission(), transaction: undefined }, /transaction/);
  rejects({ ...submission(), payer: undefined }, /payer/);
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
  expect(ReviewSubmission.parse({ ...submission(), amount: "0" }).amount).toBe("0");
});

test("the envelope is checked before anything else", () => {
  rejects(null, /./);
  rejects([submission()], /./);
  rejects({ ...submission(), schema: 2 }, /schema/);
  rejects({ ...submission(), ts: "whenever" }, /ISO 8601/);
});

test("fields the client keeps to itself are rejected rather than silently dropped", () => {
  rejects({ ...submission(), id: "local-only" }, /id/);
  rejects({ ...submission(), legs: [{ kind: "paid" }] }, /legs/);
  rejects({ ...submission(), status: 200 }, /status/);
});

test("a symbolic asset name is no longer accepted", () => {
  rejects({ ...submission(), asset: "usdc" }, /asset: must be a 20-byte hex address/);
});

test("free text is bounded", () => {
  rejects({ ...submission(), note: "x".repeat(501) }, /note/);
  rejects({ ...submission(), taskClass: "x".repeat(65) }, /taskClass/);
});

test("a payer cannot review a payment to itself", () => {
  const payer = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
  rejects({ ...submission(), payer, payTo: payer }, /payer and payTo are the same address/);
  // Casing is not a way around it.
  rejects({ ...submission(), payer, payTo: payer.toLowerCase() }, /payer and payTo are the same address/);
  rejects({ ...submission(), payer: payer.toLowerCase(), payTo: payer.toUpperCase().replace("0X", "0x") },
    /payer and payTo are the same address/);
  // Distinct addresses still pass.
  expect(ReviewSubmission.safeParse(submission()).success).toBe(true);
});

test("a non-EVM network is refused by the schema", () => {
  rejects({ ...submission(), network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }, /eip155/);
});

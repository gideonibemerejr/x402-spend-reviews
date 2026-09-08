import { describe, expect, test } from "vitest";
import {
  applyVerification, decideSubmission, MAX_VERIFY_ATTEMPTS, type SettlementFacts,
} from "../src/state";
import { submission, svmSubmission } from "../src/fixtures";
import { PROOF } from "../src/vocab";

const facts = (overrides: Partial<SettlementFacts> = {}): SettlementFacts => {
  const base = submission();
  return { network: base.network, asset: base.asset, amount: base.amount, payTo: base.payTo,
    outcome: base.outcome, ...overrides };
};

describe("decideSubmission", () => {
  test("an unknown settlement goes to the chain", () => {
    expect(decideSubmission(submission(), undefined)).toEqual({ kind: "verify" });
  });

  test("a known settlement with matching facts replays without touching the chain", () => {
    expect(decideSubmission(submission(), facts())).toEqual({ kind: "replay", changed: false });
  });

  test("a changed verdict is a replay that needs writing", () => {
    expect(decideSubmission(submission({ outcome: "discarded" }), facts())).toEqual({ kind: "replay", changed: true });
    expect(decideSubmission(submission({ note: "new" }), facts())).toEqual({ kind: "replay", changed: true });
  });

  test("settlement facts compare case-insensitively except the amount", () => {
    const upper = facts({ payTo: facts().payTo.toUpperCase().replace("0X", "0x") });
    expect(decideSubmission(submission(), upper)).toEqual({ kind: "replay", changed: false });
  });

  test("on Solana two accounts differing only in case are two different accounts", () => {
    // The EVM fold above is a fold; base58 case is a digit, so folding it would
    // let one settlement's facts be matched by a different account's.
    const base = svmSubmission();
    const cased: SettlementFacts = {
      network: base.network, asset: base.asset, amount: base.amount,
      payTo: base.payTo.toUpperCase(), outcome: base.outcome,
    };
    expect(decideSubmission(base, cased).kind).toBe("conflict");
  });

  test("one transaction cannot have carried two different amounts", () => {
    const result = decideSubmission(submission({ amount: "99" }), facts());
    expect(result).toEqual({ kind: "conflict", reason: "settlement fields differ from stored review: amount" });
  });

  test("every differing settlement field is named", () => {
    const result = decideSubmission(submission({ amount: "99", network: "eip155:8453" }), facts());
    expect(result.kind).toBe("conflict");
    expect(result.kind === "conflict" && result.reason).toContain("network, amount");
  });
});

describe("applyVerification", () => {
  const verified = (overrides: { proof?: typeof PROOF.paymentTraced | typeof PROOF.receiptOnly; amount?: string } = {}) =>
    ({ kind: "verified", proof: overrides.proof ?? PROOF.paymentTraced, amount: overrides.amount ?? "10000" }) as const;

  test("a matching log stores a verified review, stamps it, and records how it was proved", () => {
    expect(applyVerification(verified(), { claimedAmount: "10000" })).toEqual({
      status: "verified", store: true, httpStatus: 201, verifyAttempts: 1, stampVerifiedAt: true,
      proof: PROOF.paymentTraced,
    });
    expect(applyVerification(verified({ proof: PROOF.receiptOnly }), { claimedAmount: "10000" }).proof)
      .toBe(PROOF.receiptOnly);
  });

  test("a settlement that moved exactly what was claimed records no second figure", () => {
    expect(applyVerification(verified({ amount: "10000" }), { claimedAmount: "10000" }).settledAmount)
      .toBeUndefined();
  });

  test("a settlement that moved more than the claim records what it actually moved", () => {
    // The claim itself is never rewritten: idempotency compares against it.
    const t = applyVerification(verified({ amount: "12345" }), { claimedAmount: "10000" });
    expect(t.settledAmount).toBe("12345");
    expect(t.status).toBe("verified");
  });

  test("a fresh claim that fails its check is refused and never stored", () => {
    const t = applyVerification({ kind: "rejected", reason: "no Transfer log sent by payer" });
    expect(t.store).toBe(false);
    expect(t.httpStatus).toBe(422);
    expect(t.status).toBe("rejected");
  });

  test("a pending row that fails on retry is settled as rejected and stops being retried", () => {
    const t = applyVerification({ kind: "rejected", reason: "transaction not found" },
      { current: "pending", verifyAttempts: 2 });
    expect(t.store).toBe(true);
    expect(t.status).toBe("rejected");
    expect(t.verifyAttempts).toBe(3);
    expect(t.lastError).toBe("transaction not found");
  });

  test("with pending switched off an unreachable chain is a 503 and stores nothing", () => {
    const t = applyVerification({ kind: "unreachable", reason: "ECONNREFUSED" });
    expect(t.store).toBe(false);
    expect(t.httpStatus).toBe(503);
  });

  test("with pending switched on an unreachable chain parks the row and answers 202", () => {
    const t = applyVerification({ kind: "unreachable", reason: "ECONNREFUSED" }, { allowPending: true });
    expect(t).toEqual({
      status: "pending", store: true, httpStatus: 202, verifyAttempts: 1,
      lastError: "ECONNREFUSED", stampVerifiedAt: false,
    });
  });

  test("each retry increments the attempt count", () => {
    const t = applyVerification({ kind: "unreachable", reason: "timeout" },
      { current: "pending", verifyAttempts: 2, allowPending: true });
    expect(t.status).toBe("pending");
    expect(t.verifyAttempts).toBe(3);
  });

  test("an unreachable chain gives up after the attempt ceiling and records why", () => {
    const t = applyVerification({ kind: "unreachable", reason: "timeout" },
      { current: "pending", verifyAttempts: MAX_VERIFY_ATTEMPTS - 1, allowPending: true });
    expect(t.status).toBe("rejected");
    expect(t.store).toBe(true);
    expect(t.verifyAttempts).toBe(MAX_VERIFY_ATTEMPTS);
    expect(t.lastError).toContain("gave up after 5 attempts");
  });
});

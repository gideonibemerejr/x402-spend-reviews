import { describe, expect, test } from "vitest";
import {
  applyVerification, decideSubmission, MAX_VERIFY_ATTEMPTS, type SettlementFacts,
} from "../src/state";
import { submission } from "../src/fixtures";

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
  test("a matching log stores a verified review and stamps it", () => {
    expect(applyVerification({ kind: "verified" })).toEqual({
      status: "verified", store: true, httpStatus: 201, verifyAttempts: 1, stampVerifiedAt: true,
    });
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

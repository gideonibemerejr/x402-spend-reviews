import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { receiptWith, transferLog, FACILITATOR } from "../src/fixtures";
import { NETWORK } from "../src/network";
import { retryPending, type RetryRpcResolver } from "../src/retry";
import { MAX_VERIFY_ATTEMPTS } from "../src/state";
import { ReviewStore } from "../src/store";
import type { RpcCall } from "../src/verify";
import { harness } from "./helpers";

const unreachable: RpcCall = async () => {
  throw new Error("connect ECONNREFUSED");
};

/**
 * Answers only for the transaction under test and stays unreachable for anything
 * else, so one test's retry pass cannot settle another test's parked row.
 */
const answersOnlyFor = (transaction: string, receipt: unknown): RetryRpcResolver => () =>
  async (_method, params) => {
    if ((params[0] as string).toLowerCase() !== transaction.toLowerCase()) {
      throw new Error("connect ECONNREFUSED");
    }
    return receipt;
  };

/** Parks a review by posting it while the chain is unreachable. */
async function parked() {
  const api = harness({ rpc: () => unreachable });
  const response = await api.post(api.valid());
  expect(response.status).toBe(202);
  return api;
}

const row = (api: { transaction: string }) =>
  new ReviewStore(env.DB)
    .bySettlement(NETWORK.baseSepolia, api.transaction, "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc");

test("a parked review is published once the chain answers", async () => {
  const api = await parked();
  const report = await retryPending(env, 50, {
    rpc: answersOnlyFor(api.transaction, receiptWith([transferLog({})])),
  });
  expect(report.attempted).toBeGreaterThan(0);

  const stored = await row(api);
  expect(stored?.status).toBe("verified");
  expect(stored?.verifiedAt).toBeTruthy();
  expect(stored?.verifyAttempts).toBe(2);

  // Only now does it reach readers.
  const page = await (await api.page()).json<{ reviews: unknown[]; counts: Record<string, number> }>();
  expect(page.reviews).toHaveLength(1);
  expect(page.counts.useful).toBe(1);
});

test("a parked review the chain contradicts is settled as rejected and never published", async () => {
  const api = await parked();
  await retryPending(env, 50, {
    rpc: answersOnlyFor(api.transaction, receiptWith([transferLog({ to: FACILITATOR })])),
  });

  const stored = await row(api);
  expect(stored?.status).toBe("rejected");
  expect(stored?.lastError).toMatch(/payer to payTo/);
  expect(stored?.verifiedAt).toBeUndefined();
  expect((await (await api.page()).json<{ reviews: unknown[] }>()).reviews).toHaveLength(0);
});

test("a chain that is still down leaves the review parked with one more attempt spent", async () => {
  const api = await parked();
  expect((await row(api))?.verifyAttempts).toBe(1);

  await retryPending(env, 50, { rpc: () => unreachable });
  const stored = await row(api);
  expect(stored?.status).toBe("pending");
  expect(stored?.verifyAttempts).toBe(2);
  expect(stored?.lastError).toMatch(/ECONNREFUSED/);
});

test("a review that never verifies is given up on rather than retried forever", async () => {
  const api = await parked();
  const store = new ReviewStore(env.DB);
  const before = await row(api);
  // Spend the budget down to its last attempt.
  await store.applyRetry(before!.id, {
    status: "pending", verifyAttempts: MAX_VERIFY_ATTEMPTS - 1, stampVerifiedAt: false,
    lastError: "still down",
  });

  await retryPending(env, 50, { rpc: () => unreachable });
  const stored = await row(api);
  expect(stored?.status).toBe("rejected");
  expect(stored?.verifyAttempts).toBe(MAX_VERIFY_ATTEMPTS);
  expect(stored?.lastError).toMatch(/gave up after 5 attempts/);

  // Settled rows are not picked up again: another pass leaves this one alone.
  await retryPending(env, 50, { rpc: () => unreachable });
  const after = await row(api);
  expect(after?.status).toBe("rejected");
  expect(after?.verifyAttempts).toBe(MAX_VERIFY_ATTEMPTS);
});

test("a chain with no endpoint ages a review out instead of branding the claim false", async () => {
  const api = await parked();
  await retryPending(env, 50, { rpc: () => undefined });
  const stored = await row(api);
  expect(stored?.status).toBe("pending");
  expect(stored?.lastError).toMatch(/no RPC endpoint configured for eip155:84532/);
});

test("the retry route is closed without a matching admin token", async () => {
  const api = harness({ rpc: () => unreachable });
  const call = (headers: Record<string, string>) =>
    api.send(new Request("https://reviews.test/internal/retry", { method: "POST", headers }));

  const cases: Record<string, string>[] = [
    {},
    { authorization: "Bearer wrong-token" },
    { authorization: env.ADMIN_TOKEN },
    { authorization: `Bearer ${env.ADMIN_TOKEN.slice(0, -1)}` },
  ];
  for (const headers of cases) {
    const response = await call(headers);
    expect(response.status, JSON.stringify(headers)).toBe(401);
    expect((await response.json<{ error: string }>()).error).toBe("unauthorized");
  }
});

test("the retry route runs a pass for a caller holding the admin token", async () => {
  const api = await parked();
  const response = await api.send(new Request("https://reviews.test/internal/retry", {
    method: "POST",
    headers: { authorization: `Bearer ${env.ADMIN_TOKEN}` },
  }));
  expect(response.status).toBe(200);
  const report = await response.json<{ attempted: number; verified: number; stillPending: number }>();
  expect(report.attempted).toBeGreaterThan(0);

  // The default resolver reaches the real Base Sepolia endpoint, which cannot
  // know this fixture transaction, so the row is settled rather than published.
  const stored = await row(api);
  expect(stored?.status === "rejected" || stored?.status === "pending").toBe(true);
  expect(stored?.verifyAttempts).toBe(2);
});

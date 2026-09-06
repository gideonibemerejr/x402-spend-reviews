import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "./server.js";
import { ReviewStore } from "./store.js";
import type { RpcCall } from "./verify.js";
import { FACILITATOR, receiptWith, rpcReturning, submission, transferLog } from "./fixtures.js";

/** Starts the server on an ephemeral port with a fixture RPC; nothing here reaches a chain. */
async function serving(rpc: RpcCall | undefined, run: (base: string, store: ReviewStore) => Promise<void>) {
  const store = new ReviewStore(":memory:");
  const server = createServer({ store, rpc: () => rpc });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`, store);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
}

const post = (base: string, body: unknown) =>
  fetch(`${base}/v1/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const matching = () => rpcReturning(receiptWith([transferLog({})]));

test("a verified submission is stored and served back with counts", async () => {
  await serving(matching(), async (base) => {
    const created = await post(base, submission({ note: "worth it", taskClass: "search" }));
    assert.equal(created.status, 201);
    const body = await created.json() as { id: string; verified: boolean; updated: boolean };
    assert.equal(body.verified, true);
    assert.equal(body.updated, false);
    assert.ok(body.id);

    const listed = await fetch(`${base}/v1/reviews?resource=${encodeURIComponent("https://api.test/paid")}`);
    assert.equal(listed.status, 200);
    const page = await listed.json() as {
      resourceUrl: string; counts: Record<string, number>; reviews: { id: string; note: string; payer: string }[];
    };
    assert.equal(page.resourceUrl, "https://api.test/paid");
    assert.deepEqual(page.counts, { used: 1, retried: 0, discarded: 0, failed: 0 });
    assert.equal(page.reviews[0].id, body.id);
    assert.equal(page.reviews[0].note, "worth it");
    // Reviews are public and name the buyer; that is disclosed, not hidden.
    assert.ok(page.reviews[0].payer);

    const recent = await fetch(`${base}/v1/reviews/recent`);
    assert.equal(recent.status, 200);
    assert.equal(((await recent.json()) as { reviews: unknown[] }).reviews.length, 1);
  });
});

test("a failed check is refused with the check that failed", async () => {
  const cases: [string, RpcCall, RegExp][] = [
    ["wrong payTo", rpcReturning(receiptWith([transferLog({ to: FACILITATOR })])), /payer to payTo/],
    ["wrong payer", rpcReturning(receiptWith([transferLog({ from: FACILITATOR })])), /sent by payer/],
    ["wrong amount", rpcReturning(receiptWith([transferLog({ amount: "1" })])), /for amount 10000/],
    ["wrong asset", rpcReturning(receiptWith([transferLog({ address: FACILITATOR })])), /Transfer log for asset/],
    ["missing tx", rpcReturning(null), /transaction not found/],
    ["reverted tx", rpcReturning(receiptWith([transferLog({})], "0x0")), /did not succeed on chain/],
  ];
  for (const [name, rpc, reason] of cases) {
    await serving(rpc, async (base, store) => {
      const response = await post(base, submission());
      assert.equal(response.status, 422, name);
      assert.match(((await response.json()) as { error: string }).error, reason, name);
      assert.equal(store.recent().length, 0, `${name} must not be stored`);
    });
  }
});

test("the same settlement relabels rather than duplicating", async () => {
  await serving(matching(), async (base) => {
    const created = await post(base, submission({ outcome: "used" }));
    assert.equal(created.status, 201);
    const id = ((await created.json()) as { id: string }).id;

    const same = await post(base, submission({ outcome: "used" }));
    assert.equal(same.status, 409);
    assert.equal(((await same.json()) as { id: string }).id, id);

    const changed = await post(base, submission({ outcome: "discarded", note: "stale" }));
    assert.equal(changed.status, 200);
    const body = await changed.json() as { id: string; updated: boolean };
    assert.equal(body.id, id);
    assert.equal(body.updated, true);

    const page = await (await fetch(`${base}/v1/reviews?resource=${encodeURIComponent("https://api.test/paid")}`)).json() as
      { counts: Record<string, number>; reviews: unknown[] };
    assert.equal(page.reviews.length, 1);
    assert.deepEqual(page.counts, { used: 0, retried: 0, discarded: 1, failed: 0 });
  });
});

test("malformed submissions are refused before the chain is consulted", async () => {
  const exploding: RpcCall = async () => assert.fail("verification must not run on an invalid body");
  await serving(exploding, async (base) => {
    for (const [body, reason] of [
      [submission({ outcome: "unlabeled" as never }), /outcome must be one of/],
      [submission({ resourceUrl: "https://api.test/paid?k=v" }), /query string and fragment/],
      [submission({ transaction: "0x00" }), /32-byte hex hash/],
      [{ schema: 1 }, /is required/],
    ] as const) {
      const response = await post(base, body);
      assert.equal(response.status, 422);
      assert.match(((await response.json()) as { error: string }).error, reason);
    }
    const bad = await fetch(`${base}/v1/reviews`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{not json",
    });
    assert.equal(bad.status, 422);
    assert.match(((await bad.json()) as { error: string }).error, /valid JSON/);
  });
});

test("a non-EVM network is out of scope and never reaches the RPC", async () => {
  const exploding: RpcCall = async () => assert.fail("non-EVM networks must not be verified");
  await serving(exploding, async (base) => {
    const response = await post(base, submission({ network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }));
    assert.equal(response.status, 422);
    assert.equal(((await response.json()) as { error: string }).error, "network not supported in 0.3");
  });
});

test("an unconfigured chain says so rather than pretending to verify", async () => {
  await serving(undefined, async (base) => {
    const response = await post(base, submission({ network: "eip155:1" }));
    assert.equal(response.status, 422);
    assert.match(((await response.json()) as { error: string }).error, /no RPC endpoint configured for chain 1/);
  });
});

test("an unreachable chain is a server problem, not a rejected review", async () => {
  const broken: RpcCall = async () => { throw new Error("connect ECONNREFUSED"); };
  await serving(broken, async (base, store) => {
    const response = await post(base, submission());
    assert.equal(response.status, 503);
    assert.match(((await response.json()) as { error: string }).error, /could not reach the chain/);
    assert.equal(store.recent().length, 0);
  });
});

test("health, CORS, and unknown routes", async () => {
  await serving(matching(), async (base) => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    assert.equal(health.headers.get("access-control-allow-origin"), "*");

    const preflight = await fetch(`${base}/v1/reviews`, { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");

    assert.equal((await fetch(`${base}/v1/reviews`)).status, 422);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  });
});

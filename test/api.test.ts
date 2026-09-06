import { describe, expect, test, vi } from "vitest";
import { FACILITATOR, receiptWith, rpcReturning, transferLog } from "../src/fixtures";
import type { RpcCall } from "../src/verify";
import { harness } from "./helpers";

const matching = () => rpcReturning(receiptWith([transferLog({})]));
const rpc = (call: RpcCall | undefined) => ({ rpc: () => call });

describe("POST /v1/reviews", () => {
  test("a verified submission is stored and served back with counts", async () => {
    const api = harness(rpc(matching()));
    const created = await api.post(api.valid({ note: "worth it", taskClass: "search" }));
    expect(created.status).toBe(201);
    const body = await created.json<{ id: string; status: string; verified: boolean }>();
    expect(body).toMatchObject({ status: "verified", verified: true });
    expect(body.id).toBeTruthy();

    const listed = await api.page();
    expect(listed.status).toBe(200);
    const page = await listed.json<{ resourceUrl: string; counts: Record<string, number>; reviews: { id: string; note: string; payer: string }[] }>();
    expect(page.resourceUrl).toBe(api.resourceUrl);
    expect(page.counts).toEqual({ used: 1, retried: 0, discarded: 0, failed: 0 });
    expect(page.reviews[0].id).toBe(body.id);
    expect(page.reviews[0].note).toBe("worth it");
    // Reviews are public and name the buyer; that is disclosed, not hidden.
    expect(page.reviews[0].payer).toBeTruthy();

    const recent = await api.get("/v1/reviews/recent");
    const ids = (await recent.json<{ reviews: { id: string }[] }>()).reviews.map((r) => r.id);
    expect(ids).toContain(body.id);
  });

  test.each([
    ["wrong payTo", receiptWith([transferLog({ to: FACILITATOR })]), /payer to payTo/],
    ["wrong payer", receiptWith([transferLog({ from: FACILITATOR })]), /sent by payer/],
    ["wrong amount", receiptWith([transferLog({ amount: "1" })]), /for amount 10000/],
    ["wrong asset", receiptWith([transferLog({ address: FACILITATOR })]), /Transfer log for asset/],
    ["missing tx", null, /transaction not found/],
    ["reverted tx", receiptWith([transferLog({})], "0x0"), /did not succeed on chain/],
  ])("a failed check is refused with the check that failed: %s", async (_name, receipt, reason) => {
    const api = harness(rpc(rpcReturning(receipt)));
    const response = await api.post(api.valid());
    expect(response.status).toBe(422);
    expect((await response.json<{ error: string }>()).error).toMatch(reason);
    expect((await (await api.page()).json<{ reviews: unknown[] }>()).reviews).toHaveLength(0);
  });

  test("an identical repost is a no-op that returns the same body without a second chain call", async () => {
    const call = vi.fn(matching());
    const api = harness(rpc(call));

    const first = await api.post(api.valid());
    const second = await api.post(api.valid());
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    // A settlement already proved cannot change, so the replay must skip the chain.
    expect(call).toHaveBeenCalledTimes(1);
  });

  test("a changed verdict relabels in place rather than adding a second voice", async () => {
    const api = harness(rpc(matching()));
    const created = await api.post(api.valid({ outcome: "used", note: "worth it" }));
    const { id } = await created.json<{ id: string }>();

    const changed = await api.post(api.valid({ outcome: "discarded", note: "stale" }));
    expect(changed.status).toBe(200);
    expect((await changed.json<{ id: string }>()).id).toBe(id);

    const page = await (await api.page())
      .json<{ counts: Record<string, number>; reviews: { note: string }[] }>();
    expect(page.reviews).toHaveLength(1);
    expect(page.reviews[0].note).toBe("stale");
    expect(page.counts).toEqual({ used: 0, retried: 0, discarded: 1, failed: 0 });
  });

  test("notes are editable on their own", async () => {
    const api = harness(rpc(matching()));
    await api.post(api.valid({ note: "first" }));
    const again = await api.post(api.valid({ note: "second" }));
    expect(again.status).toBe(200);
    const page = await (await api.page())
      .json<{ reviews: { note: string }[] }>();
    expect(page.reviews[0].note).toBe("second");
  });

  test("one transaction cannot claim two different settlements", async () => {
    const api = harness(rpc(matching()));
    await api.post(api.valid());
    const conflicting = await api.post(api.valid({ amount: "999999" }));
    expect(conflicting.status).toBe(422);
    expect((await conflicting.json<{ error: string }>()).error)
      .toBe("settlement fields differ from stored review: amount");
  });

  test("malformed submissions are refused before the chain is consulted", async () => {
    const call = vi.fn<RpcCall>(async () => {
      throw new Error("verification must not run on an invalid body");
    });
    const api = harness(rpc(call));
    for (const [body, reason] of [
      [api.valid({ outcome: "unlabeled" as never }), /outcome/],
      [api.valid({ resourceUrl: "https://api.test/paid?k=v" }), /query string and fragment/],
      [api.valid({ transaction: "0x00" }), /32-byte hex hash/],
      [{ ...api.valid(), surprise: true }, /surprise|unrecognized/i],
      [api.valid({ note: "x".repeat(501) }), /note/],
      [{ schema: 1 }, /./],
    ] as const) {
      const response = await api.post(body);
      expect(response.status).toBe(422);
      expect((await response.json<{ error: string }>()).error).toMatch(reason);
    }
    expect(call).not.toHaveBeenCalled();
  });

  test("a self-payment is refused before the chain is consulted", async () => {
    const call = vi.fn<RpcCall>(async () => {
      throw new Error("a self-payment must not cost an RPC round trip");
    });
    const api = harness(rpc(call));
    const submission = api.valid();
    const response = await api.post({ ...submission, payTo: submission.payer });
    expect(response.status).toBe(422);
    expect((await response.json<{ error: string }>()).error).toBe("payer and payTo are the same address");
    expect(call).not.toHaveBeenCalled();
    expect((await (await api.page()).json<{ reviews: unknown[] }>()).reviews).toHaveLength(0);
  });

  test("a non-EVM network is out of scope and never reaches the RPC", async () => {
    const call = vi.fn<RpcCall>(async () => {
      throw new Error("non-EVM networks must not be verified");
    });
    const api = harness(rpc(call));
    const response = await api.post(api.valid({ network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }));
    expect(response.status).toBe(422);
    expect((await response.json<{ error: string }>()).error).toMatch(/eip155/);
    expect(call).not.toHaveBeenCalled();
  });

  test("an unconfigured chain says so rather than pretending to verify", async () => {
    const api = harness(rpc(undefined));
    const response = await api.post(api.valid({ network: "eip155:1" }));
    expect(response.status).toBe(422);
    expect((await response.json<{ error: string }>()).error).toMatch(/no RPC endpoint configured for chain 1/);
  });

  test("an unreachable chain parks the review instead of losing it", async () => {
    const broken: RpcCall = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const api = harness(rpc(broken));
    const response = await api.post(api.valid());
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "pending", verified: false });

    // Parked, not published: reads serve verified reviews only.
    expect((await (await api.page()).json<{ reviews: unknown[] }>()).reviews).toHaveLength(0);
    const health = await (await api.get("/health")).json<{ pending: number }>();
    expect(health.pending).toBeGreaterThan(0);
  });

  test("a parked review is still idempotent on repost", async () => {
    const broken: RpcCall = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const api = harness(rpc(broken));
    const first = await api.post(api.valid());
    const second = await api.post(api.valid());
    expect(first.status).toBe(202);
    // Already on record, so the repost replays the stored row rather than re-parking it.
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
  });

  test("with the pending path switched off an unreachable chain is refused outright", async () => {
    const broken: RpcCall = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const api = harness({ ...rpc(broken), allowPending: false });
    const response = await api.post(api.valid());
    expect(response.status).toBe(503);
    expect((await response.json<{ error: string }>()).error).toMatch(/could not reach the chain/);
    expect((await (await api.page()).json<{ reviews: unknown[] }>()).reviews).toHaveLength(0);
  });

  test("the 31st post in a minute from one IP is refused", async () => {
    const api = harness(rpc(matching()));
    for (let i = 0; i < 30; i++) {
      // Deliberately invalid: the limiter runs before validation, so this still spends budget.
      expect((await api.post({ schema: 1 })).status).toBe(422);
    }
    const throttled = await api.post({ schema: 1 });
    expect(throttled.status).toBe(429);
    expect((await throttled.json<{ error: string }>()).error).toBe("rate limit exceeded");
  });
});

describe("reads", () => {
  test("counts and listings exclude other resources", async () => {
    const api = harness(rpc(matching()));
    await api.post(api.valid());
    await api.post(api.valid({ transaction: api.otherTransaction, resourceUrl: "https://api.test/other" }));

    const page = await (await api.page())
      .json<{ counts: Record<string, number>; reviews: unknown[] }>();
    expect(page.reviews).toHaveLength(1);
    expect(page.counts).toEqual({ used: 1, retried: 0, discarded: 0, failed: 0 });

    const empty = await (await api.get("/v1/reviews?resource=https%3A%2F%2Fapi.test%2Fnever-reviewed"))
      .json<{ counts: Record<string, number> }>();
    expect(empty.counts).toEqual({ used: 0, retried: 0, discarded: 0, failed: 0 });
  });

  test("the resource parameter is required", async () => {
    const api = harness(rpc(matching()));
    expect((await api.get("/v1/reviews")).status).toBe(422);
  });

  test("health reports the pending backlog and is not rate limited", async () => {
    const api = harness(rpc(matching()));
    for (let i = 0; i < 40; i++) {
      const health = await api.get("/health");
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true, pending: expect.any(Number) });
    }
  });

  test("GET is CORS-open to any origin and POST is not", async () => {
    const api = harness(rpc(matching()));
    const read = await api.get("/v1/reviews/recent", { Origin: "https://somewhere.example" });
    expect(read.headers.get("access-control-allow-origin")).toBe("*");

    const write = await api.post(api.valid(), { Origin: "https://somewhere.example" });
    expect(write.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("an unknown route is a 404", async () => {
    const api = harness(rpc(matching()));
    expect((await api.get("/nope")).status).toBe(404);
  });
});

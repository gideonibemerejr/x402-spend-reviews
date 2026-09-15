/**
 * The two demo routes as HTTP: what they accept, what they refuse, and the two
 * properties the handoff puts on them — that neither stores anything, and that
 * neither is open to the whole web from a browser.
 */
import { expect, test } from "vitest";
import { env } from "cloudflare:test";
import { NETWORK } from "../src/network";
import { DEMO_ORIGINS } from "../src/app";
import { PROOF } from "../src/vocab";
import {
  PAYER, PAY_TO, TX_HASH, USDC_BASE_SEPOLIA, SOL_SIGNATURE,
  receiptWith, transferLog,
} from "../src/fixtures";
import { harness } from "./helpers";

/** A harness whose chain answers every EVM receipt lookup with one USDC transfer. */
const withChain = () =>
  harness({ rpc: () => async (method) => {
    if (method !== "eth_getTransactionReceipt") throw new Error(`unexpected ${method}`);
    return receiptWith([transferLog({})]);
  } });

const post = (h: ReturnType<typeof harness>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  h.send(new Request(`https://reviews.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": h.ip, ...headers },
    body: JSON.stringify(body),
  }));

test("POST /v1/verify describes a settlement from the hash alone", async () => {
  const h = withChain();
  const response = await post(h, "/v1/verify", { transaction: TX_HASH, network: "base-sepolia" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    found: true,
    network: NETWORK.baseSepolia,
    transaction: TX_HASH,
    truncated: false,
    transfers: [{
      asset: USDC_BASE_SEPOLIA.toLowerCase(),
      assetLabel: "USDC",
      payer: PAYER.toLowerCase(),
      payTo: PAY_TO.toLowerCase(),
      amount: "10000",
      proof: PROOF.paymentTraced,
    }],
  });
});

test("a verified lookup writes nothing", async () => {
  // The route is a lookup. If it ever started recording what it was asked
  // about, it would be building a log of who checked which transaction.
  const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM reviews").first<{ n: number }>();
  const h = withChain();
  await post(h, "/v1/verify", { transaction: TX_HASH, network: "base-sepolia" });
  const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM reviews").first<{ n: number }>();
  expect(after!.n).toBe(before!.n);
});

test("a settlement spelled for the wrong family is refused before any round trip", async () => {
  const h = harness({ rpc: () => { throw new Error("should not be reached"); } });
  const response = await post(h, "/v1/verify", { transaction: SOL_SIGNATURE, network: "base" });
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "transaction: must be a 32-byte hex hash" });
});

test("an unknown network is named rather than attempted", async () => {
  const h = withChain();
  const response = await post(h, "/v1/verify", { transaction: TX_HASH, network: "dogecoin" });
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({
    error: expect.stringContaining("eip155 or solana CAIP-2"),
  });
});

test("review fields are refused on the demo route, not quietly ignored", async () => {
  // The schema is strict on both routes. A caller sending a whole review here
  // is doing something they will want to be told about.
  const h = withChain();
  const response = await post(h, "/v1/verify", {
    transaction: TX_HASH, network: "base-sepolia", payer: PAYER, outcome: "useful",
  });
  expect(response.status).toBe(422);
});

test("an unreachable chain is a 503, distinct from a transaction that proves nothing", async () => {
  const h = harness({ rpc: () => async () => { throw new Error("node down"); } });
  const response = await post(h, "/v1/verify", { transaction: TX_HASH, network: "base-sepolia" });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: "could not reach the chain" });
});

test("POST /v1/probe refuses a private address without fetching it", async () => {
  const h = harness();
  const response = await post(h, "/v1/probe", { url: "http://169.254.169.254/latest/meta-data/" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: false, reason: "refusing to probe a private or loopback address",
  });
});

test("POST /v1/probe refuses something that is not a URL", async () => {
  const h = harness();
  const response = await post(h, "/v1/probe", { url: "not a url" });
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "url: must be an absolute URL" });
});

test("the demo routes answer the site's origin and not the whole web", async () => {
  const h = withChain();
  const allowed = await post(h, "/v1/verify",
    { transaction: TX_HASH, network: "base-sepolia" }, { origin: DEMO_ORIGINS[0]! });
  expect(allowed.headers.get("access-control-allow-origin")).toBe(DEMO_ORIGINS[0]);

  const stranger = await post(h, "/v1/verify",
    { transaction: TX_HASH, network: "base-sepolia" }, { origin: "https://someone-else.example" });
  expect(stranger.headers.get("access-control-allow-origin")).toBeNull();
});

test("posting a review from a browser is still not allowed", async () => {
  // The demo routes get CORS because they are lookups. Widening it to the
  // review route would let any page talk a visitor's browser into publishing.
  const h = withChain();
  const response = await h.post(h.valid(), { origin: DEMO_ORIGINS[0]! });
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
});

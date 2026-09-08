import { expect, test, vi } from "vitest";
import { canonicalNetwork, NETWORK } from "../src/network";
import { createRpc, RPC_USER_AGENT, RpcError, rpcUrlFor } from "../src/verify/rpc";

const ok = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    headers: { "content-type": "application/json" },
  });

test("every call identifies itself, because public endpoints refuse unknown clients", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => ok("0x1"));
  const rpc = createRpc(NETWORK.baseSepolia, { fetchImpl });
  await rpc!("eth_chainId", []);

  const [, init] = fetchImpl.mock.calls[0];
  const headers = init?.headers as Record<string, string>;
  expect(headers["user-agent"]).toBe(RPC_USER_AGENT);
  expect(headers["content-type"]).toBe("application/json");
  expect(RPC_USER_AGENT).toMatch(/^x402-spend-reviews\/\d/);
});

test("an explicit endpoint wins over the public fallback", () => {
  expect(rpcUrlFor(NETWORK.baseSepolia)).toBe("https://sepolia.base.org");
  expect(rpcUrlFor(NETWORK.baseMainnet)).toBe("https://mainnet.base.org");
  expect(rpcUrlFor(NETWORK.baseSepolia, { RPC_URL_84532: "https://private.example" }))
    .toBe("https://private.example");
  expect(rpcUrlFor("eip155:1")).toBeUndefined();
});

test("both Solana clusters have a public endpoint, overridable like any other", () => {
  expect(rpcUrlFor(NETWORK.solanaMainnet)).toBe("https://api.mainnet-beta.solana.com");
  expect(rpcUrlFor(NETWORK.solanaDevnet)).toBe("https://api.devnet.solana.com");
  expect(rpcUrlFor(NETWORK.solanaDevnet, { RPC_URL_SOLANA_DEVNET: "https://private.example" }))
    .toBe("https://private.example");
  // The two clusters are configured apart: a mainnet key must not answer for devnet.
  expect(rpcUrlFor(NETWORK.solanaMainnet, { RPC_URL_SOLANA_DEVNET: "https://private.example" }))
    .toBe("https://api.mainnet-beta.solana.com");
});

test("every chain the alias table names resolves to a caller, not a refusal", () => {
  // The method commits to five networks. A client writing any of their common
  // names should reach an endpoint rather than a "no RPC endpoint configured".
  for (const alias of [
    "base", "base-mainnet", "base-sepolia",
    "avalanche", "avalanche-fuji", "arbitrum", "arbitrum-one",
    "bsc", "bnb", "binance-smart-chain",
    "solana", "solana-mainnet-beta", "solana-devnet",
  ]) {
    expect(createRpc(canonicalNetwork(alias)), alias).toBeDefined();
  }
});

test("each chain reads its own secret and no other", () => {
  expect(rpcUrlFor(NETWORK.avalanche, { RPC_URL_43114: "https://avax.example" }))
    .toBe("https://avax.example");
  expect(rpcUrlFor(NETWORK.arbitrumOne, { RPC_URL_43114: "https://avax.example" }))
    .toBe("https://arb1.arbitrum.io/rpc");
  expect(rpcUrlFor(NETWORK.bnbSmartChain, { RPC_URL_56: "https://bnb.example" }))
    .toBe("https://bnb.example");
});

test("a network with no endpoint has no caller at all", () => {
  expect(createRpc("eip155:1")).toBeUndefined();
  expect(createRpc("solana:unknown")).toBeUndefined();
});

test("transport, HTTP and JSON-RPC failures all surface as RpcError", async () => {
  const cases: [string, typeof fetch][] = [
    ["transport", async () => { throw new Error("ECONNREFUSED"); }],
    ["http", async () => new Response("nope", { status: 500 })],
    ["rpc", async () => new Response(JSON.stringify({ error: { message: "bad params" } }),
      { headers: { "content-type": "application/json" } })],
  ];
  for (const [name, fetchImpl] of cases) {
    const rpc = createRpc(NETWORK.baseSepolia, { fetchImpl });
    await expect(rpc!("eth_chainId", []), name).rejects.toBeInstanceOf(RpcError);
  }
});

import { expect, test, vi } from "vitest";
import { createRpc, RPC_USER_AGENT, RpcError, rpcUrlFor } from "../src/rpc";

const ok = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    headers: { "content-type": "application/json" },
  });

test("every call identifies itself, because public endpoints refuse unknown clients", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => ok("0x1"));
  const rpc = createRpc("84532", { fetchImpl });
  await rpc!("eth_chainId", []);

  const [, init] = fetchImpl.mock.calls[0];
  const headers = init?.headers as Record<string, string>;
  expect(headers["user-agent"]).toBe(RPC_USER_AGENT);
  expect(headers["content-type"]).toBe("application/json");
  expect(RPC_USER_AGENT).toMatch(/^x402-spend-reviews\/\d/);
});

test("an explicit endpoint wins over the public fallback", () => {
  expect(rpcUrlFor("84532")).toBe("https://sepolia.base.org");
  expect(rpcUrlFor("8453")).toBe("https://mainnet.base.org");
  expect(rpcUrlFor("84532", { RPC_URL_84532: "https://private.example" })).toBe("https://private.example");
  expect(rpcUrlFor("1")).toBeUndefined();
});

test("a chain with no endpoint has no caller at all", () => {
  expect(createRpc("1")).toBeUndefined();
});

test("transport, HTTP and JSON-RPC failures all surface as RpcError", async () => {
  const cases: [string, typeof fetch][] = [
    ["transport", async () => { throw new Error("ECONNREFUSED"); }],
    ["http", async () => new Response("nope", { status: 500 })],
    ["rpc", async () => new Response(JSON.stringify({ error: { message: "bad params" } }),
      { headers: { "content-type": "application/json" } })],
  ];
  for (const [name, fetchImpl] of cases) {
    const rpc = createRpc("84532", { fetchImpl });
    await expect(rpc!("eth_chainId", []), name).rejects.toBeInstanceOf(RpcError);
  }
});

/** Minimal JSON-RPC over fetch. No client library, no provider abstraction. */
import type { RpcCall } from "./verify";

/** Configuration source. Deliberately not Node's ProcessEnv: this file runs on Workers too. */
export type RpcEnv = Record<string, string | undefined>;

/**
 * Public endpoints used when no `RPC_URL_<chainId>` is configured. They are
 * rate-limited and shared, so any real deployment should set its own.
 */
export const PUBLIC_RPC_URLS: Readonly<Record<string, string>> = {
  "8453": "https://mainnet.base.org",
  "84532": "https://sepolia.base.org",
};

/** Resolves the RPC endpoint for a chain, preferring explicit configuration. */
export function rpcUrlFor(chainId: string, env: RpcEnv = {}): string | undefined {
  return env[`RPC_URL_${chainId}`] || PUBLIC_RPC_URLS[chainId];
}

/** Raised when the endpoint is unreachable, slow, or answers with a JSON-RPC error. */
export class RpcError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RpcError";
  }
}

/**
 * Builds a JSON-RPC caller for one chain.
 *
 * @param chainId - Decimal EIP-155 chain id.
 * @param options.timeoutMs - Per-call deadline; defaults to 5 s.
 * @returns A caller, or `undefined` when the chain has no configured endpoint.
 */
export function createRpc(
  chainId: string,
  options: { env?: RpcEnv; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): RpcCall | undefined {
  const url = rpcUrlFor(chainId, options.env);
  if (!url) return undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;

  return async (method, params) => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((cause: unknown) => {
      throw new RpcError(`x402-spend-reviews: RPC call to ${url} failed`, { cause });
    });
    if (!response.ok) throw new RpcError(`x402-spend-reviews: RPC ${url} returned ${response.status}`);
    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new RpcError(`x402-spend-reviews: RPC error: ${body.error.message ?? "unknown"}`);
    return body.result;
  };
}

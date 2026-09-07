/** Minimal JSON-RPC over fetch. No client library, no provider abstraction. */
import { NETWORK } from "./network";
import type { RpcCall } from "./verify";

/** Configuration source. Deliberately not Node's ProcessEnv: this file runs on Workers too. */
export type RpcEnv = Record<string, string | undefined>;

/**
 * Public endpoints used when a network has none configured. They are
 * rate-limited and shared, so any real deployment should set its own — the
 * public Solana endpoints especially, which throttle hard enough that a busy
 * verifier would spend its time parking reviews as pending.
 */
export const PUBLIC_RPC_URLS: Readonly<Record<string, string>> = {
  [NETWORK.baseMainnet]: "https://mainnet.base.org",
  [NETWORK.baseSepolia]: "https://sepolia.base.org",
  [NETWORK.solanaMainnet]: "https://api.mainnet-beta.solana.com",
  [NETWORK.solanaDevnet]: "https://api.devnet.solana.com",
};

/**
 * The secret that names each network's own endpoint.
 *
 * Keyed by CAIP-2 rather than by chain id: Solana clusters have no chain id to
 * key on, and a network is what the rest of the server routes by anyway.
 */
export const RPC_ENV_VAR: Readonly<Record<string, string>> = {
  [NETWORK.baseMainnet]: "RPC_URL_8453",
  [NETWORK.baseSepolia]: "RPC_URL_84532",
  [NETWORK.solanaMainnet]: "RPC_URL_SOLANA",
  [NETWORK.solanaDevnet]: "RPC_URL_SOLANA_DEVNET",
};

/** Resolves the RPC endpoint for a network, preferring explicit configuration. */
export function rpcUrlFor(network: string, env: RpcEnv = {}): string | undefined {
  const configured = RPC_ENV_VAR[network];
  return (configured ? env[configured] : undefined) || PUBLIC_RPC_URLS[network];
}

/**
 * Sent on every RPC call. Public endpoints sit behind bot protection that
 * refuses unrecognised clients, so an absent User-Agent is a 403 waiting to
 * happen rather than a cosmetic detail.
 */
export const RPC_USER_AGENT =
  "x402-spend-reviews/0.3 (+github.com/gideonibemerejr/x402-spend-reviews)";

/** Raised when the endpoint is unreachable, slow, or answers with a JSON-RPC error. */
export class RpcError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RpcError";
  }
}

/**
 * Builds a JSON-RPC caller for one network.
 *
 * @param network - CAIP-2 network id.
 * @param options.timeoutMs - Per-call deadline; defaults to 5 s.
 * @returns A caller, or `undefined` when the network has no configured endpoint.
 */
export function createRpc(
  network: string,
  options: { env?: RpcEnv; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): RpcCall | undefined {
  const url = rpcUrlFor(network, options.env);
  if (!url) return undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;

  return async (method, params) => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": RPC_USER_AGENT },
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

/**
 * The endpoints this Worker may be given, named one by one.
 *
 * Listing them keeps the lookup honest: casting `Env` to a string map would let
 * a typo in a secret name resolve to `undefined` and read as "not configured"
 * rather than failing to compile.
 */
export const rpcEnvFrom = (env: Env): RpcEnv => ({
  RPC_URL_8453: env.RPC_URL_8453,
  RPC_URL_84532: env.RPC_URL_84532,
  RPC_URL_SOLANA: env.RPC_URL_SOLANA,
  RPC_URL_SOLANA_DEVNET: env.RPC_URL_SOLANA_DEVNET,
});

/** Resolves a caller for a network from the Worker's own configuration. */
export const defaultRpc = (network: string, env: Env): RpcCall | undefined =>
  createRpc(network, { env: rpcEnvFrom(env) });

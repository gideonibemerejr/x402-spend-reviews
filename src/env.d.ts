/**
 * Endpoints this Worker may be configured with that `wrangler types` cannot see.
 *
 * `worker-configuration.d.ts` is generated from `wrangler.toml` and `.dev.vars`,
 * so a secret that exists only in production is invisible to it. All optional:
 * a network with none configured falls back to its public endpoint, and one
 * with neither is refused by name rather than failing at startup.
 */
interface Env {
  RPC_URL_43114?: string;
  RPC_URL_43113?: string;
  RPC_URL_42161?: string;
  RPC_URL_56?: string;
  RPC_URL_SOLANA?: string;
  RPC_URL_SOLANA_DEVNET?: string;
}

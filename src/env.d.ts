/**
 * Endpoints this Worker may be configured with that `wrangler types` cannot see.
 *
 * `worker-configuration.d.ts` is generated from `wrangler.toml` and `.dev.vars`,
 * so a secret that exists only in production is invisible to it. Declared
 * optional here because a deployment without them falls back to the public
 * Solana endpoints rather than failing.
 */
interface Env {
  RPC_URL_SOLANA?: string;
  RPC_URL_SOLANA_DEVNET?: string;
}

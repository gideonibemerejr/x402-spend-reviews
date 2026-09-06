/**
 * The migrations bundle is injected as a miniflare binding by vitest.config.ts,
 * so wrangler cannot know about it. Augmenting `Cloudflare.Env` is what
 * `cloudflare:test`'s `env` is typed against.
 */
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("@cloudflare/vitest-pool-workers").D1Migration[];
  }
}

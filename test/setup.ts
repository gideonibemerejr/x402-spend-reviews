import { applyD1Migrations, env } from "cloudflare:test";

// Applied once against the local D1; per-test isolation then rolls back writes.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

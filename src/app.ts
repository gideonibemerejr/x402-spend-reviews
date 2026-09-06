/** HTTP surface: Hono on Workers. Routes, CORS, rate limiting, zod validation. */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { describeIssues, ReviewSubmission } from "./review";
import { createRpc } from "./rpc";
import { applyVerification, decideSubmission } from "./state";
import { ReviewStore, settlementFacts } from "./store";
import { verifySettlement, type RpcCall } from "./verify";

/** Resolves a JSON-RPC caller for a chain. Tests inject fixtures here so nothing reaches a chain. */
export type RpcResolver = (chainId: string, env: Env) => RpcCall | undefined;

export interface AppOptions {
  rpc?: RpcResolver;
  /**
   * Whether an unreachable chain parks the review as `pending` and answers 202.
   * Off until the pending path and its retry trigger exist; until then an
   * unreachable chain is a 503 and nothing is stored.
   */
  allowPending?: boolean;
}

/** Largest accepted POST body. A review is a few hundred bytes; this guards the parser. */
export const POST_BODY_LIMIT = 4096;

/** The two chains 0.3 verifies. Naming them keeps the lookup honest instead of casting through Env. */
const rpcUrlFromEnv = (env: Env, chainId: string): string | undefined =>
  ({ "8453": env.RPC_URL_8453, "84532": env.RPC_URL_84532 })[chainId];

const defaultRpc: RpcResolver = (chainId, env) => {
  const url = rpcUrlFromEnv(env, chainId);
  return createRpc(chainId, { env: url ? { [`RPC_URL_${chainId}`]: url } : {} });
};

/** Rate limits are keyed by client IP, so one noisy caller cannot spend everyone's budget. */
const rateLimited = (pick: (env: Env) => RateLimit) =>
  async (c: { env: Env; req: { header: (name: string) => string | undefined; method: string }; json: (body: unknown, status: 429) => Response }, next: () => Promise<void>) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const { success } = await pick(c.env).limit({ key: `${c.req.method}:${ip}` });
    if (!success) return c.json({ error: "rate limit exceeded" }, 429);
    await next();
  };

/**
 * Builds the review API.
 *
 * CORS is open for GET from any origin and absent on POST: the read side is
 * meant to be embedded anywhere, while posting a review is a server-to-server
 * act no browser should be talked into performing on someone's behalf.
 */
export function createApp(options: AppOptions = {}) {
  const resolveRpc = options.rpc ?? defaultRpc;
  const allowPending = options.allowPending ?? false;
  const app = new Hono<{ Bindings: Env }>();

  const readCors = cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] });
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "OPTIONS") return readCors(c, next);
    return next();
  });

  // Exempt from rate limiting: a health check that can be throttled is not a health check.
  app.get("/health", async (c) => {
    const pending = await new ReviewStore(c.env.DB).pendingCount();
    return c.json({ ok: true, pending });
  });

  app.post(
    "/v1/reviews",
    rateLimited((env) => env.POST_REVIEWS) as never,
    bodyLimit({ maxSize: POST_BODY_LIMIT, onError: (c) => c.json({ error: "request body too large" }, 413) }),
    zValidator("json", ReviewSubmission, (result, c) => {
      if (!result.success) return c.json({ error: describeIssues(result.error) }, 422);
    }),
    async (c) => {
      const submission = c.req.valid("json");
      const store = new ReviewStore(c.env.DB);
      const existing = await store.bySettlement(submission.transaction, submission.payer);
      const decision = decideSubmission(submission, existing ? settlementFacts(existing) : undefined);

      if (decision.kind === "conflict") return c.json({ error: decision.reason }, 422);

      // A settlement already proved cannot change, so a replay skips the chain
      // entirely. That is what makes POST safe to retry blindly.
      if (decision.kind === "replay") {
        const row = existing!;
        if (decision.changed) await store.relabel(row.id, submission.outcome, submission.note);
        return c.json({ id: row.id, status: row.status, verified: row.status === "verified" }, 200);
      }

      const chainId = submission.network.slice("eip155:".length);
      const rpc = resolveRpc(chainId, c.env);
      if (!rpc) return c.json({ error: `no RPC endpoint configured for chain ${chainId}` }, 422);

      let event;
      try {
        const result = await verifySettlement(submission, rpc);
        event = result.verified
          ? ({ kind: "verified" } as const)
          : ({ kind: "rejected", reason: result.reason } as const);
      } catch (cause: unknown) {
        // The claim may well be true; this server simply could not check it.
        event = { kind: "unreachable", reason: cause instanceof Error ? cause.message : String(cause) } as const;
      }

      const transition = applyVerification(event, { allowPending });
      if (!transition.store) {
        const body =
          transition.httpStatus === 503
            ? { error: "could not reach the chain to verify this settlement", detail: transition.lastError }
            : { error: transition.lastError ?? "verification failed" };
        return c.json(body, transition.httpStatus);
      }
      const created = await store.create(submission, transition);
      return c.json({ id: created.id, status: created.status, verified: created.status === "verified" },
        transition.httpStatus);
    }
  );

  app.get("/v1/reviews/recent", rateLimited((env) => env.GET_REVIEWS) as never, async (c) => {
    return c.json({ reviews: await new ReviewStore(c.env.DB).recent(100) });
  });

  app.get("/v1/reviews", rateLimited((env) => env.GET_REVIEWS) as never, async (c) => {
    const resource = c.req.query("resource");
    if (!resource) return c.json({ error: "resource: is required" }, 422);
    return c.json(await new ReviewStore(c.env.DB).byResource(resource));
  });

  return app;
}

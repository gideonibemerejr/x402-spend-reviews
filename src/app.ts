/** HTTP surface: Hono on Workers. Routes, CORS, rate limiting, zod validation. */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { renderPage } from "./page";
import { describeIssues, ReviewSubmission } from "./review";
import { defaultRpc } from "./verify/rpc";
import { applyVerification, decideSubmission } from "./state";
import { retryPending, type RetryRpcResolver } from "./retry";
import { ReviewStore, settlementFacts } from "./store";
import { verifySettlement, type RpcCall } from "./verify";
import { STATUS } from "./vocab";

/** Resolves a JSON-RPC caller for a network. Tests inject fixtures here so nothing reaches a chain. */
export type RpcResolver = (network: string, env: Env) => RpcCall | undefined;

export interface AppOptions {
  rpc?: RpcResolver;
  /**
   * Whether an unreachable chain parks the review as `pending` and answers 202
   * instead of refusing it. On by default: a node outage is this server's
   * problem, and turning it into a lost review would make an honest client pay
   * for it. Tests switch it off to exercise the refusing path.
   */
  allowPending?: boolean;
}

/** Largest accepted POST body. A review is a few hundred bytes; this guards the parser. */
export const POST_BODY_LIMIT = 4096;

/**
 * Compares a bearer token against the configured admin secret in constant time.
 *
 * Both sides are hashed to a fixed size first, so neither the token's length nor
 * how far it matched is observable in the response time. An unset secret fails
 * closed rather than opening the route.
 */
async function bearerMatches(header: string | undefined, secret: string | undefined): Promise<boolean> {
  const provided = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!provided || !secret) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(secret)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

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
  const allowPending = options.allowPending ?? true;
  const app = new Hono<{ Bindings: Env }>();

  const readCors = cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] });
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "OPTIONS") return readCors(c, next);
    return next();
  });

  // The dataset is meant to be checkable by anyone, so it has a page of its own:
  // rendered on the server, no client JavaScript, readable from view-source.
  app.get("/", rateLimited((env) => env.GET_REVIEWS) as never, async (c) => {
    const store = new ReviewStore(c.env.DB);
    const [reviews, pending] = await Promise.all([store.recent(100), store.pendingCount()]);
    return c.html(renderPage(reviews, pending));
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
      const existing = await store.bySettlement(submission.network, submission.transaction, submission.payer);
      const decision = decideSubmission(submission, existing ? settlementFacts(existing) : undefined);

      if (decision.kind === "conflict") return c.json({ error: decision.reason }, 422);

      // A settlement already proved cannot change, so a replay skips the chain
      // entirely. That is what makes POST safe to retry blindly.
      if (decision.kind === "replay") {
        const row = existing!;
        if (decision.changed) await store.relabel(row.id, submission.outcome, submission.note);
        return c.json({ id: row.id, status: row.status, verified: row.status === STATUS.verified }, 200);
      }

      const rpc = resolveRpc(submission.network, c.env);
      if (!rpc) {
        return c.json({ error: `no RPC endpoint configured for ${submission.network}` }, 422);
      }

      let event;
      try {
        const result = await verifySettlement(submission, rpc);
        event = result.verified
          ? ({ kind: "verified", proof: result.proof } as const)
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
      try {
        const created = await store.create(submission, transition);
        return c.json({ id: created.id, status: created.status, verified: created.status === STATUS.verified },
          transition.httpStatus);
      } catch (cause: unknown) {
        // The chain answered; only storage failed. Retrying is the right move.
        console.error(JSON.stringify({
          message: "review write failed",
          transaction: submission.transaction,
          error: cause instanceof Error ? cause.message : String(cause),
        }));
        return c.json({ error: "could not record this review" }, 503);
      }
    }
  );

  app.post("/internal/retry", async (c) => {
    if (!(await bearerMatches(c.req.header("authorization"), c.env.ADMIN_TOKEN))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.json(await retryPending(c.env, 50, { rpc: resolveRpc as RetryRpcResolver }));
  });

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

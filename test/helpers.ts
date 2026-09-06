/** Shared wiring for route tests: a real Worker env, a fixture chain, no network. */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { createApp, type AppOptions } from "../src/app";
import { submission, USDC_BASE_SEPOLIA } from "../src/fixtures";
import type { ReviewSubmission } from "../src/review";

/**
 * The shared fixture defaults `asset` to the symbolic "usdc", which the schema
 * no longer accepts; every submission here names the contract instead.
 */
export const valid = (overrides: Partial<ReviewSubmission> = {}): ReviewSubmission =>
  submission({ asset: USDC_BASE_SEPOLIA, ...overrides });

let harnessCount = 0;

/**
 * One harness per test, each with its own settlement and client IP.
 *
 * The pool does not roll D1 back between tests in a file, and rate-limit
 * counters are not reset either, so sharing a transaction hash or an IP would
 * make one test's writes decide another's result.
 */
export function harness(options: AppOptions = {}) {
  const app = createApp(options);
  const id = ++harnessCount;
  const ip = `10.${Math.floor(id / 65025) % 250}.${Math.floor(id / 255) % 250}.${id % 250}`;

  /** Settlement hashes derived from the harness id, so no two tests collide. */
  const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
  const transaction = hash(id);
  /** Reads are global, so each harness reviews its own resource to stay legible in isolation. */
  const resourceUrl = `https://api.test/paid/${id}`;

  const send = async (request: Request) => {
    const ctx = createExecutionContext();
    const response = await app.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    return response;
  };

  return {
    app,
    ip,
    transaction,
    resourceUrl,
    /** A submission for this harness's own settlement and resource. */
    valid: (overrides: Partial<ReviewSubmission> = {}) => valid({ transaction, resourceUrl, ...overrides }),
    /** A second, distinct settlement for the same harness. */
    otherTransaction: hash(id + 1_000_000),
    /** The review page for this harness's own resource. */
    page: () => send(new Request(
      `https://reviews.test/v1/reviews?resource=${encodeURIComponent(resourceUrl)}`,
      { headers: { "CF-Connecting-IP": ip } }
    )),
    post: (body: unknown, headers: Record<string, string> = {}) =>
      send(new Request("https://reviews.test/v1/reviews", {
        method: "POST",
        headers: { "content-type": "application/json", "CF-Connecting-IP": ip, ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      })),
    get: (path: string, headers: Record<string, string> = {}) =>
      send(new Request(`https://reviews.test${path}`, {
        headers: { "CF-Connecting-IP": ip, ...headers },
      })),
  };
}

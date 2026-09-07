/**
 * Re-verification for reviews parked while the chain was unreachable.
 *
 * A function, not a worker: the cron trigger and the admin route both call it,
 * and nothing here owns a schedule, a queue or a backoff policy.
 */
import { defaultRpc } from "./rpc";
import { applyVerification, MAX_VERIFY_ATTEMPTS, type VerificationEvent } from "./state";
import { ReviewStore } from "./store";
import { verifySettlement, type RpcCall } from "./verify";
import { STATUS } from "./vocab";

/** What one pass over the backlog did. Returned to the admin route and logged by the cron. */
export interface RetryReport {
  attempted: number;
  verified: number;
  rejected: number;
  stillPending: number;
}

/** Resolves a JSON-RPC caller for a network. Tests inject fixtures here. */
export type RetryRpcResolver = (network: string, env: Env) => RpcCall | undefined;

/**
 * Re-runs verification for pending reviews.
 *
 * Each row moves on its own: a proved settlement becomes `verified`, a
 * contradicted one becomes `rejected`, and one that still cannot be checked
 * keeps its place with its attempt count raised until it reaches the ceiling.
 * A chain with no endpoint counts as unreachable rather than as a rejection, so
 * a missing secret ages a row out instead of branding a claim false.
 *
 * @param limit - Most rows to touch in one pass; the cron calls this every few minutes.
 */
export async function retryPending(
  env: Env,
  limit = 50,
  options: { rpc?: RetryRpcResolver; now?: Date } = {}
): Promise<RetryReport> {
  const resolveRpc = options.rpc ?? defaultRpc;
  const store = new ReviewStore(env.DB);
  const rows = await store.pending(limit, MAX_VERIFY_ATTEMPTS);
  const report: RetryReport = { attempted: rows.length, verified: 0, rejected: 0, stillPending: 0 };

  for (const row of rows) {
    const rpc = resolveRpc(row.network, env);
    let event: VerificationEvent;
    if (!rpc) {
      event = { kind: "unreachable", reason: `no RPC endpoint configured for ${row.network}` };
    } else {
      try {
        const result = await verifySettlement(row, rpc);
        event = result.verified
          ? { kind: "verified", proof: result.proof }
          : { kind: "rejected", reason: result.reason };
      } catch (cause: unknown) {
        event = { kind: "unreachable", reason: cause instanceof Error ? cause.message : String(cause) };
      }
    }

    const transition = applyVerification(event, {
      current: row.status,
      verifyAttempts: row.verifyAttempts,
      allowPending: true,
    });
    await store.applyRetry(row.id, transition, options.now);
    if (transition.status === STATUS.verified) report.verified += 1;
    else if (transition.status === STATUS.rejected) report.rejected += 1;
    else report.stillPending += 1;
  }

  return report;
}

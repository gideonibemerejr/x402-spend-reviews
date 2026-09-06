/**
 * The review lifecycle as pure functions.
 *
 * Nothing here performs I/O, so every transition is testable on its own and the
 * routes are left holding only the wiring. The `pending` branch is modelled and
 * tested even while it is switched off in production, so enabling it is a code
 * change rather than a migration.
 */
import type { ReviewSubmission } from "./review";

/** Where a review sits in its verification lifecycle. */
export type ReviewStatus = "pending" | "verified" | "rejected";

/** Attempts after which an unverifiable review stops being retried. */
export const MAX_VERIFY_ATTEMPTS = 5;

/**
 * The facts about the payment itself, as opposed to the verdict about it.
 * Two posts for one settlement must agree on all four: a single transaction
 * cannot have carried two different amounts, so a mismatch means someone is
 * lying and the claim is refused rather than merged.
 */
export const SETTLEMENT_FIELDS = ["network", "asset", "amount", "payTo"] as const;

/** The stored facts a resubmission is checked against. */
export type SettlementFacts = Pick<ReviewSubmission, (typeof SETTLEMENT_FIELDS)[number]> & {
  outcome: ReviewSubmission["outcome"];
  note?: string;
};

/** What to do with a submission, decided before any chain call. */
export type SubmissionDecision =
  | { kind: "conflict"; reason: string }
  | { kind: "replay"; changed: boolean }
  | { kind: "verify" };

/** Addresses and chain ids are compared case-insensitively; amounts exactly. */
const sameFact = (field: (typeof SETTLEMENT_FIELDS)[number], a: string, b: string) =>
  field === "amount" ? a === b : a.toLowerCase() === b.toLowerCase();

/**
 * Decides how to handle a submission for a settlement that may already be known.
 *
 * A known settlement whose facts still agree skips the chain call entirely: the
 * transaction was already proved once and cannot change, so re-verifying it
 * would spend an RPC round trip to learn nothing. That is what makes POST safe
 * to retry blindly.
 */
export function decideSubmission(
  submission: ReviewSubmission,
  existing: SettlementFacts | undefined
): SubmissionDecision {
  if (!existing) return { kind: "verify" };
  const differing = SETTLEMENT_FIELDS.filter((field) => !sameFact(field, submission[field], existing[field]));
  if (differing.length > 0) {
    return { kind: "conflict", reason: `settlement fields differ from stored review: ${differing.join(", ")}` };
  }
  const changed = existing.outcome !== submission.outcome || (existing.note ?? undefined) !== submission.note;
  return { kind: "replay", changed };
}

/** The outcome of one verification attempt. */
export type VerificationEvent =
  | { kind: "verified" }
  | { kind: "rejected"; reason: string }
  | { kind: "unreachable"; reason: string };

/** What a verification attempt should do to storage and to the response. */
export interface StateTransition {
  status: ReviewStatus;
  /** Whether the row should be written or updated at all. */
  store: boolean;
  /** Response code for the POST path; the retry path ignores it. */
  httpStatus: 201 | 202 | 422 | 503;
  verifyAttempts: number;
  lastError?: string;
  /** Whether `verified_at` should be stamped now. */
  stampVerifiedAt: boolean;
}

/**
 * Applies a verification result to a review's state.
 *
 * @param event - What the chain call concluded.
 * @param context.current - Existing status, or `undefined` for a submission with no row yet.
 * @param context.verifyAttempts - Attempts already recorded.
 * @param context.allowPending - Whether an unreachable chain may park the row as `pending`.
 *   With this off, an unreachable chain is a 503 and nothing is stored.
 */
export function applyVerification(
  event: VerificationEvent,
  context: { current?: ReviewStatus; verifyAttempts?: number; allowPending?: boolean } = {}
): StateTransition {
  const verifyAttempts = (context.verifyAttempts ?? 0) + 1;
  const exists = context.current !== undefined;

  if (event.kind === "verified") {
    return { status: "verified", store: true, httpStatus: 201, verifyAttempts, stampVerifiedAt: true };
  }
  if (event.kind === "rejected") {
    // A fresh claim that fails its check is refused outright and never stored;
    // an existing pending row is settled as rejected so it stops being retried.
    return {
      status: "rejected",
      store: exists,
      httpStatus: 422,
      verifyAttempts,
      lastError: event.reason,
      stampVerifiedAt: false,
    };
  }
  if (!context.allowPending) {
    return {
      status: "pending",
      store: false,
      httpStatus: 503,
      verifyAttempts,
      lastError: event.reason,
      stampVerifiedAt: false,
    };
  }
  if (verifyAttempts >= MAX_VERIFY_ATTEMPTS) {
    return {
      status: "rejected",
      store: true,
      httpStatus: 422,
      verifyAttempts,
      lastError: `gave up after ${verifyAttempts} attempts: ${event.reason}`,
      stampVerifiedAt: false,
    };
  }
  return {
    status: "pending",
    store: true,
    httpStatus: 202,
    verifyAttempts,
    lastError: event.reason,
    stampVerifiedAt: false,
  };
}

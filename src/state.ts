/**
 * The review lifecycle as pure functions.
 *
 * Nothing here performs I/O, so every transition is testable on its own and the
 * routes are left holding only the wiring. The `pending` branch is modelled and
 * tested even while it is switched off in production, so enabling it is a code
 * change rather than a migration.
 */
import { foldCase } from "./network";
import type { ReviewSubmission } from "./review";
import { STATUS, type Proof, type ReviewStatus } from "./vocab";

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

/**
 * Amounts compare exactly; accounts compare however their network spells them.
 *
 * The fold is the network's, not a blanket `toLowerCase`: on Solana two
 * addresses differing only in case are two different accounts, so folding them
 * together would let one settlement's facts be matched by another's.
 */
const sameFact = (
  field: (typeof SETTLEMENT_FIELDS)[number],
  submission: SettlementFacts | ReviewSubmission,
  existing: SettlementFacts
) => {
  if (field === "amount") return submission.amount === existing.amount;
  if (field === "network") return submission.network.toLowerCase() === existing.network.toLowerCase();
  return foldCase(submission.network, submission[field]) === foldCase(existing.network, existing[field]);
};

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
  const differing = SETTLEMENT_FIELDS.filter((field) => !sameFact(field, submission, existing));
  if (differing.length > 0) {
    return { kind: "conflict", reason: `settlement fields differ from stored review: ${differing.join(", ")}` };
  }
  const changed = existing.outcome !== submission.outcome || (existing.note ?? undefined) !== submission.note;
  return { kind: "replay", changed };
}

/** The outcome of one verification attempt. */
export type VerificationEvent =
  | { kind: "verified"; proof: Proof; amount: string }
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
  /** How the payment was proved, on the transitions that proved one. */
  proof?: Proof;
  /**
   * What the chain actually moved, when that is not what the client claimed.
   * Absent when the two agree, which is the ordinary case.
   */
  settledAmount?: string;
}

/**
 * Applies a verification result to a review's state.
 *
 * @param event - What the chain call concluded.
 * @param context.current - Existing status, or `undefined` for a submission with no row yet.
 * @param context.verifyAttempts - Attempts already recorded.
 * @param context.allowPending - Whether an unreachable chain may park the row as `pending`.
 *   With this off, an unreachable chain is a 503 and nothing is stored.
 * @param context.claimedAmount - The amount the submission claimed, so a
 *   settlement that moved more can be recorded as having done so. The claim
 *   itself is never rewritten: idempotency compares against it, so replacing it
 *   with the observed figure would make an honest repost look like a different
 *   settlement.
 */
export function applyVerification(
  event: VerificationEvent,
  context: {
    current?: ReviewStatus;
    verifyAttempts?: number;
    allowPending?: boolean;
    claimedAmount?: string;
  } = {}
): StateTransition {
  const verifyAttempts = (context.verifyAttempts ?? 0) + 1;
  const exists = context.current !== undefined;

  if (event.kind === "verified") {
    const overpaid =
      context.claimedAmount !== undefined && event.amount !== context.claimedAmount;
    return {
      status: STATUS.verified, store: true, httpStatus: 201, verifyAttempts,
      stampVerifiedAt: true, proof: event.proof,
      ...(overpaid ? { settledAmount: event.amount } : {}),
    };
  }
  if (event.kind === "rejected") {
    // A fresh claim that fails its check is refused outright and never stored;
    // an existing pending row is settled as rejected so it stops being retried.
    return {
      status: STATUS.rejected,
      store: exists,
      httpStatus: 422,
      verifyAttempts,
      lastError: event.reason,
      stampVerifiedAt: false,
    };
  }
  if (!context.allowPending) {
    return {
      status: STATUS.pending,
      store: false,
      httpStatus: 503,
      verifyAttempts,
      lastError: event.reason,
      stampVerifiedAt: false,
    };
  }
  if (verifyAttempts >= MAX_VERIFY_ATTEMPTS) {
    return {
      status: STATUS.rejected,
      store: true,
      httpStatus: 422,
      verifyAttempts,
      lastError: `gave up after ${verifyAttempts} attempts: ${event.reason}`,
      stampVerifiedAt: false,
    };
  }
  return {
    status: STATUS.pending,
    store: true,
    httpStatus: 202,
    verifyAttempts,
    lastError: event.reason,
    stampVerifiedAt: false,
  };
}

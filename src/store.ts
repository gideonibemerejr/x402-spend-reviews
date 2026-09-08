/** D1 persistence. The only file that knows SQL. */
import { foldCase } from "./network";
import type { ReviewSubmission } from "./review";
import type { SettlementFacts } from "./state";
import { REVIEW_OUTCOMES, STATUS, type Proof, type ReviewOutcome, type ReviewStatus } from "./vocab";

/** A stored review: what was submitted, plus this server's own bookkeeping. */
export interface StoredReview extends ReviewSubmission {
  id: string;
  status: ReviewStatus;
  verifyAttempts: number;
  lastError?: string;
  /** When this server confirmed the settlement, not when the payment happened. */
  verifiedAt?: string;
  /** How the payment was proved. Absent on rows that were never verified. */
  proof?: Proof;
  /**
   * What the settlement actually moved, when it exceeded {@link amount}.
   * Absent when the chain matched the claim.
   */
  settledAmount?: string;
  createdAt: string;
  updatedAt: string;
}

/** Outcome tallies for one resource. */
export type OutcomeCounts = Record<ReviewOutcome, number>;

/** Aggregated reviews for one resource URL. */
export interface ResourceReviews {
  resourceUrl: string;
  counts: OutcomeCounts;
  reviews: StoredReview[];
}

/** Largest page of reviews returned for one resource. Counts are computed over the whole set. */
export const RESOURCE_PAGE_SIZE = 100;

interface Row {
  id: string;
  transaction: string;
  payer: string;
  resource_url: string;
  task_class: string | null;
  network: string;
  asset: string;
  amount: string;
  pay_to: string;
  outcome: string;
  note: string | null;
  paid_ms: number | null;
  ts: string;
  status: string;
  verify_attempts: number;
  last_error: string | null;
  verified_at: string | null;
  proof: string | null;
  settled_amount: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `id, "transaction", payer, resource_url, task_class, network, asset, amount,
  pay_to, outcome, note, paid_ms, ts, status, verify_attempts, last_error, verified_at,
  proof, settled_amount, created_at, updated_at`;

function toReview(row: Row): StoredReview {
  return {
    schema: 1,
    id: row.id,
    transaction: row.transaction,
    payer: row.payer,
    resourceUrl: row.resource_url,
    ...(row.task_class !== null ? { taskClass: row.task_class } : {}),
    network: row.network,
    asset: row.asset,
    amount: row.amount,
    payTo: row.pay_to,
    outcome: row.outcome as ReviewOutcome,
    ...(row.note !== null ? { note: row.note } : {}),
    ...(row.paid_ms !== null ? { paidMs: row.paid_ms } : {}),
    ts: row.ts,
    status: row.status as ReviewStatus,
    verifyAttempts: row.verify_attempts,
    ...(row.last_error !== null ? { lastError: row.last_error } : {}),
    ...(row.verified_at !== null ? { verifiedAt: row.verified_at } : {}),
    ...(row.proof !== null ? { proof: row.proof as Proof } : {}),
    ...(row.settled_amount !== null ? { settledAmount: row.settled_amount } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const emptyCounts = (): OutcomeCounts =>
  Object.fromEntries(REVIEW_OUTCOMES.map((outcome) => [outcome, 0])) as OutcomeCounts;

/** How a review should be written when a verification attempt concludes. */
export interface WriteState {
  status: ReviewStatus;
  verifyAttempts: number;
  lastError?: string;
  stampVerifiedAt: boolean;
  proof?: Proof;
  settledAmount?: string;
}

/**
 * Reviews in D1.
 *
 * Hashes and addresses are stored folded to their network's own spelling, so
 * the unique index on `(transaction, payer)` holds regardless of how a client
 * cased an EVM address — and holds just as well on Solana, where case is a
 * digit rather than a decoration and nothing may be folded away.
 */
export class ReviewStore {
  constructor(private readonly db: D1Database) {}

  /**
   * Looks up the single review for a settlement, whatever its status.
   *
   * @param network - The settlement's network, which decides how its
   *   identifiers are folded before the lookup.
   */
  async bySettlement(network: string, transaction: string, payer: string): Promise<StoredReview | undefined> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM reviews WHERE "transaction" = ? AND payer = ?`)
      .bind(foldCase(network, transaction), foldCase(network, payer))
      .first<Row>();
    return row ? toReview(row) : undefined;
  }

  /** Inserts a review that has just been through verification. */
  async create(submission: ReviewSubmission, state: WriteState, now: Date = new Date()): Promise<StoredReview> {
    const timestamp = now.toISOString();
    const fold = (value: string) => foldCase(submission.network, value);
    const review: StoredReview = {
      ...submission,
      transaction: fold(submission.transaction),
      payer: fold(submission.payer),
      payTo: fold(submission.payTo),
      asset: fold(submission.asset),
      id: crypto.randomUUID(),
      status: state.status,
      verifyAttempts: state.verifyAttempts,
      ...(state.lastError !== undefined ? { lastError: state.lastError } : {}),
      ...(state.stampVerifiedAt ? { verifiedAt: timestamp } : {}),
      ...(state.proof !== undefined ? { proof: state.proof } : {}),
      ...(state.settledAmount !== undefined ? { settledAmount: state.settledAmount } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db
      .prepare(
        `INSERT INTO reviews (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        review.id, review.transaction, review.payer, review.resourceUrl, review.taskClass ?? null,
        review.network, review.asset, review.amount, review.payTo, review.outcome,
        review.note ?? null, review.paidMs ?? null, review.ts, review.status,
        review.verifyAttempts, review.lastError ?? null, review.verifiedAt ?? null,
        review.proof ?? null, review.settledAmount ?? null, review.createdAt, review.updatedAt
      )
      .run();
    return review;
  }

  /**
   * Applies a new verdict to a settlement already on record.
   *
   * Only the verdict moves; the settlement facts are immutable once proved,
   * which is what lets a replay skip the chain entirely.
   */
  async relabel(
    id: string,
    outcome: ReviewOutcome,
    note: string | undefined,
    now: Date = new Date()
  ): Promise<void> {
    await this.db
      .prepare(`UPDATE reviews SET outcome = ?, note = ?, updated_at = ? WHERE id = ?`)
      .bind(outcome, note ?? null, now.toISOString(), id)
      .run();
  }

  /** Returns verified reviews for one exact resource URL, newest first, with tallies over the whole set. */
  async byResource(resourceUrl: string): Promise<ResourceReviews> {
    const [rows, tallies] = await Promise.all([
      this.db
        .prepare(
          `SELECT ${COLUMNS} FROM reviews
           WHERE resource_url = ? AND status = ?
           ORDER BY verified_at DESC, id DESC LIMIT ?`
        )
        .bind(resourceUrl, STATUS.verified, RESOURCE_PAGE_SIZE)
        .all<Row>(),
      this.db
        .prepare(
          `SELECT outcome, COUNT(*) AS n FROM reviews
           WHERE resource_url = ? AND status = ? GROUP BY outcome`
        )
        .bind(resourceUrl, STATUS.verified)
        .all<{ outcome: string; n: number }>(),
    ]);
    const counts = emptyCounts();
    for (const tally of tallies.results) {
      if (tally.outcome in counts) counts[tally.outcome as ReviewOutcome] = tally.n;
    }
    return { resourceUrl, counts, reviews: rows.results.map(toReview) };
  }

  /** Returns the most recently verified reviews, newest first. */
  async recent(limit = 100): Promise<StoredReview[]> {
    const rows = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM reviews WHERE status = ?
         ORDER BY verified_at DESC, id DESC LIMIT ?`
      )
      .bind(STATUS.verified, limit)
      .all<Row>();
    return rows.results.map(toReview);
  }

  /**
   * Reviews still worth another verification attempt, oldest first.
   *
   * Rows at the attempt ceiling are excluded: they have already been settled as
   * rejected, and re-reading them would starve newer work on every cron tick.
   */
  async pending(limit: number, maxAttempts: number): Promise<StoredReview[]> {
    const rows = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM reviews
         WHERE status = ? AND verify_attempts < ?
         ORDER BY created_at ASC LIMIT ?`
      )
      .bind(STATUS.pending, maxAttempts, limit)
      .all<Row>();
    return rows.results.map(toReview);
  }

  /** Records the result of a re-verification against an existing row. */
  async applyRetry(id: string, state: WriteState, now: Date = new Date()): Promise<void> {
    const timestamp = now.toISOString();
    await this.db
      .prepare(
        `UPDATE reviews
         SET status = ?, verify_attempts = ?, last_error = ?,
             verified_at = COALESCE(?, verified_at), proof = COALESCE(?, proof),
             settled_amount = COALESCE(?, settled_amount), updated_at = ?
         WHERE id = ?`
      )
      .bind(
        state.status, state.verifyAttempts, state.lastError ?? null,
        state.stampVerifiedAt ? timestamp : null, state.proof ?? null,
        state.settledAmount ?? null, timestamp, id
      )
      .run();
  }

  /** How many reviews are waiting on a chain that could not be reached. */
  async pendingCount(): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'`)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
}

/** Narrows a stored review to the facts a resubmission is checked against. */
export const settlementFacts = (review: StoredReview): SettlementFacts => ({
  network: review.network,
  asset: review.asset,
  amount: review.amount,
  payTo: review.payTo,
  outcome: review.outcome,
  ...(review.note !== undefined ? { note: review.note } : {}),
});

/** SQLite persistence for verified reviews. */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { ReviewOutcome, ReviewSubmission } from "./review.js";
import { REVIEW_OUTCOMES } from "./review.js";

/** Default database path used by the server entry point. */
export const DEFAULT_DB_PATH = "x402-spend-reviews.db";

/**
 * One row per settlement. The unique index on `(tx_hash, payer)` is the whole
 * anti-duplication rule: one settlement buys exactly one review, and a later
 * post for the same pair relabels it rather than adding a second voice.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS reviews (
  id           TEXT PRIMARY KEY,
  tx_hash      TEXT NOT NULL,
  payer        TEXT NOT NULL,
  resource_url TEXT NOT NULL,
  network      TEXT NOT NULL,
  asset        TEXT NOT NULL,
  amount       TEXT NOT NULL,
  pay_to       TEXT NOT NULL,
  outcome      TEXT NOT NULL,
  note         TEXT,
  task_class   TEXT,
  paid_ms      INTEGER,
  ts           TEXT NOT NULL,
  verified_at  TEXT NOT NULL,
  json         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_settlement ON reviews (tx_hash, payer);
CREATE INDEX IF NOT EXISTS idx_reviews_resource_url ON reviews (resource_url);
CREATE INDEX IF NOT EXISTS idx_reviews_verified_at   ON reviews (verified_at);
`;

/** A stored review: what was submitted, plus the server's own identifiers. */
export interface StoredReview extends ReviewSubmission {
  id: string;
  /** When this server confirmed the settlement, not when the payment happened. */
  verifiedAt: string;
}

/** Outcome tallies for one resource. */
export type OutcomeCounts = Record<ReviewOutcome, number>;

/** Aggregated reviews for one resource URL. */
export interface ResourceReviews {
  resourceUrl: string;
  counts: OutcomeCounts;
  reviews: StoredReview[];
}

/**
 * How a write landed. `created` is a new settlement, `updated` is the relabel
 * path for a settlement already on record, `duplicate` is the same verdict twice.
 */
export type WriteResult =
  | { status: "created" | "updated" | "duplicate"; review: StoredReview };

const emptyCounts = (): OutcomeCounts =>
  Object.fromEntries(REVIEW_OUTCOMES.map((outcome) => [outcome, 0])) as OutcomeCounts;

/** Persistence for verified reviews, backed by Node's built-in synchronous SQLite. */
export class ReviewStore {
  private readonly db: DatabaseSync;

  constructor(path: string = DEFAULT_DB_PATH) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  /**
   * Records a verified submission.
   *
   * A settlement already on record is relabelled when the outcome differs and
   * reported as a duplicate when it does not, so a caller changing their mind
   * never creates a second review for the same payment.
   */
  put(submission: ReviewSubmission, now: Date = new Date()): WriteResult {
    const txHash = submission.transaction.toLowerCase();
    const payer = submission.payer.toLowerCase();
    const existing = this.bySettlement(txHash, payer);

    if (existing) {
      if (existing.outcome === submission.outcome) return { status: "duplicate", review: existing };
      const review: StoredReview = { ...existing, outcome: submission.outcome, note: submission.note };
      this.db
        .prepare("UPDATE reviews SET outcome = ?, note = ?, json = ? WHERE id = ?")
        .run(review.outcome, review.note ?? null, JSON.stringify(review), review.id);
      return { status: "updated", review };
    }

    const review: StoredReview = { ...submission, id: randomUUID(), verifiedAt: now.toISOString() };
    this.db
      .prepare(
        `INSERT INTO reviews
           (id, tx_hash, payer, resource_url, network, asset, amount, pay_to,
            outcome, note, task_class, paid_ms, ts, verified_at, json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        review.id, txHash, payer, review.resourceUrl, review.network, review.asset,
        review.amount, review.payTo, review.outcome, review.note ?? null,
        review.taskClass ?? null, review.paidMs ?? null, review.ts, review.verifiedAt,
        JSON.stringify(review)
      );
    return { status: "created", review };
  }

  /** Looks up the single review for a settlement, if one exists. */
  bySettlement(transaction: string, payer: string): StoredReview | undefined {
    const row = this.db
      .prepare("SELECT json FROM reviews WHERE tx_hash = ? AND payer = ?")
      .get(transaction.toLowerCase(), payer.toLowerCase()) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as StoredReview) : undefined;
  }

  /** Returns every review for one exact resource URL, newest first, with outcome tallies. */
  byResource(resourceUrl: string): ResourceReviews {
    const rows = this.db
      .prepare("SELECT json FROM reviews WHERE resource_url = ? ORDER BY verified_at DESC, id DESC")
      .all(resourceUrl) as { json: string }[];
    const reviews = rows.map((row) => JSON.parse(row.json) as StoredReview);
    const counts = emptyCounts();
    for (const review of reviews) counts[review.outcome] += 1;
    return { resourceUrl, counts, reviews };
  }

  /** Returns the most recently verified reviews, newest first. */
  recent(limit = 100): StoredReview[] {
    const rows = this.db
      .prepare("SELECT json FROM reviews ORDER BY verified_at DESC, id DESC LIMIT ?")
      .all(limit) as { json: string }[];
    return rows.map((row) => JSON.parse(row.json) as StoredReview);
  }

  /** Releases the underlying database handle. */
  close(): void {
    this.db.close();
  }
}

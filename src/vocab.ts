/**
 * The closed sets of names this server uses, in one place.
 *
 * Every one of these values crosses a boundary — into the database, into a JSON
 * body, into the page — so each is written once here and referred to by name
 * everywhere else. A misspelled status or outcome then fails to compile instead
 * of quietly writing a row nothing will ever match.
 *
 * The string values are the wire format and must not change casually; the keys
 * are for reading the code.
 */

/**
 * What a buyer concluded about a paid call. Two outcomes, not four.
 *
 * The response either gave the buyer what they wrote down before paying, or it
 * did not. Whether they then retried, went elsewhere or gave up is what happened
 * *after* the failure — recovery, recorded separately — rather than a third kind
 * of outcome. Cost per useful result is spend divided by the count of `useful`;
 * everything spent reaching `not_useful` is waste, however it was recovered.
 */
export const OUTCOME = {
  useful: "useful",
  notUseful: "not_useful",
} as const;

/**
 * A published verdict about a paid resource. `unlabeled` is deliberately absent:
 * an unlabeled receipt has no verdict to review.
 */
export type ReviewOutcome = (typeof OUTCOME)[keyof typeof OUTCOME];

/**
 * The outcome labels this server accepted before the binary model.
 *
 * Kept only so a client still sending one is told what replaced it, rather than
 * being handed a bare "invalid option".
 */
export const RETIRED_OUTCOMES = ["used", "retried", "discarded", "failed"] as const;

/**
 * Why a response was not useful. Required on `not_useful`, forbidden on
 * `useful` — "it worked" is not a finding about anything.
 *
 * A closed set so reasons aggregate across calls instead of describing one.
 * `wrong`, `empty` and `malformed` are kept apart deliberately: the difference
 * between an endpoint that is broken and one that is lying is a different
 * finding about a seller, and collapsing them into a single failure rate throws
 * that away. The free-text `note` carries the specifics alongside the code.
 */
export const REASON = {
  noResponse: "no_response",
  empty: "empty",
  malformed: "malformed",
  wrong: "wrong",
  stale: "stale",
  insufficient: "insufficient",
} as const;

export type ReviewReason = (typeof REASON)[keyof typeof REASON];

export const REVIEW_REASONS = Object.values(REASON);

/**
 * What the buyer did after a response that was not useful.
 *
 * A separate axis, never an outcome: retrying and going elsewhere are both
 * recovery from the same failure and both cost money. Optional everywhere,
 * because it is often not worth recording.
 */
export const RECOVERY = {
  none: "none",
  retriedSame: "retried_same",
  wentElsewhere: "went_elsewhere",
  abandoned: "abandoned",
} as const;

export type ReviewRecovery = (typeof RECOVERY)[keyof typeof RECOVERY];

/** The outcomes in declaration order, for tallies that must name all of them. */
export const REVIEW_OUTCOMES = Object.values(OUTCOME);

/** Where a review sits in its verification lifecycle. */
export const STATUS = {
  pending: "pending",
  verified: "verified",
  rejected: "rejected",
} as const;

export type ReviewStatus = (typeof STATUS)[keyof typeof STATUS];

/**
 * How thoroughly a payment was proved.
 *
 * `payment_traced` is the real thing: the transfer itself was found, so the
 * payer is known. `receipt_only` means the transfer could not be read and the
 * payment was inferred from the recipient's balance rising — which shows that
 * payTo was credited but not who credited it. The distinction is recorded per
 * row because run 001 excludes `receipt_only` rows from its quality findings.
 */
export const PROOF = {
  paymentTraced: "payment_traced",
  receiptOnly: "receipt_only",
} as const;

export type Proof = (typeof PROOF)[keyof typeof PROOF];

/** How each proof is named to a reader. */
export const PROOF_LABEL: Readonly<Record<Proof, string>> = {
  [PROOF.paymentTraced]: "payment traced",
  [PROOF.receiptOnly]: "payer unconfirmed",
};

/**
 * CAIP-2 network families. The family decides which verifier runs, how
 * addresses are spelled, and whether their casing is meaningful.
 */
export const FAMILY = {
  evm: "eip155",
  svm: "solana",
} as const;

export type NetworkFamily = (typeof FAMILY)[keyof typeof FAMILY];

/**
 * Reasons a settlement can fail its check, as the 422 body states them.
 *
 * Distinct from {@link REASON}, which is why a *response* was not useful. This
 * one is why a *payment* could not be proved; they never mix.
 *
 * Only the fixed ones live here. A reason that names an address or an amount is
 * written where it is raised, because it is a sentence about one transaction
 * rather than a member of a closed set.
 */
export const REJECTION = {
  /**
   * No version in this message. It carried one, and the one it carried was
   * wrong at 0.2 and wrong again at 0.3, because a release number in a
   * client-facing string is a value that has to be remembered at a moment when
   * nobody is thinking about it. Which networks are supported is answerable
   * from the README and from this server's own behaviour.
   */
  networkUnsupported: "network not supported",
  transactionNotFound: "transaction not found",
  transactionFailed: "transaction did not succeed on chain",
  noMetadata: "transaction has no metadata to verify against",
  ambiguousTransfers: "ambiguous: multiple matching transfers",
  unattributedTransfer: "could not attribute the matching transfer to a payer",
  malformedAmount: "amount must be atomic units as a decimal string",
  noTransferFromPayer: "no Transfer log sent by payer",
  noTransferToPayTo: "no Transfer log from payer to payTo",
  /** Raised by the Solana verifier, which speaks of accounts rather than addresses. */
  selfPaymentAccount: "payer and payTo are the same account",
  /** Raised by the schema, before any verifier sees the submission. */
  selfPaymentAddress: "payer and payTo are the same address",
} as const;

export type RejectionReason = (typeof REJECTION)[keyof typeof REJECTION];

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

/** What a buyer concluded about a paid call. */
export const OUTCOME = {
  used: "used",
  retried: "retried",
  discarded: "discarded",
  failed: "failed",
} as const;

/**
 * A published verdict about a paid resource. `unlabeled` is deliberately absent:
 * an unlabeled receipt has no verdict to review.
 */
export type ReviewOutcome = (typeof OUTCOME)[keyof typeof OUTCOME];

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
 * Only the fixed ones live here. A reason that names an address or an amount is
 * written where it is raised, because it is a sentence about one transaction
 * rather than a member of a closed set.
 */
export const REASON = {
  networkUnsupported: "network not supported in 0.3",
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

export type RejectionReason = (typeof REASON)[keyof typeof REASON];

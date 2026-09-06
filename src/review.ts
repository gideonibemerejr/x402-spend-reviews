/** The review record as it crosses the wire, plus validation of untrusted bodies. */

/** Outcomes a caller may publish. `unlabeled` is deliberately absent: an unlabeled receipt has no verdict to review. */
export const REVIEW_OUTCOMES = ["used", "retried", "discarded", "failed"] as const;

/** A published verdict about a paid resource. */
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

/**
 * Everything a client publishes about one settled call, and nothing else.
 *
 * Legs, byte counts, HTTP status, offered alternatives and the local receipt id
 * stay on the client. `transaction` and `payer` are required because they are
 * what makes the record checkable; without them there is nothing to verify.
 */
export interface ReviewSubmission {
  schema: 1;
  /** `resource.url` with query string and fragment stripped. */
  resourceUrl: string;
  taskClass?: string;
  /** CAIP-2 chain identifier, e.g. `eip155:8453`. */
  network: string;
  /** Asset as recorded by the client; an address is matched directly against the transfer log. */
  asset: string;
  /** Settled amount in atomic units, as a decimal string. */
  amount: string;
  payTo: string;
  /** Settlement transaction hash. The proof of purchase. */
  transaction: string;
  /** Buyer address, read from the transfer log rather than the transaction sender. */
  payer: string;
  outcome: ReviewOutcome;
  note?: string;
  paidMs?: number;
  ts: string;
}

/** A rejected submission, carrying the single check that failed for the 422 body. */
export class ReviewValidationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ReviewValidationError";
  }
}

const isHex = (value: string, bytes: number) =>
  new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value);

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ReviewValidationError(`${field} is required`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ReviewValidationError(`${field} must be a string`);
  return value;
}

/**
 * Validates an untrusted request body into a {@link ReviewSubmission}.
 *
 * Shape only; nothing here consults the chain. Every rejection names one failed
 * check so the 422 body tells the caller what to fix.
 *
 * @throws {ReviewValidationError} When any field is missing or malformed.
 */
export function parseSubmission(body: unknown): ReviewSubmission {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ReviewValidationError("body must be a JSON object");
  }
  const raw = body as Record<string, unknown>;
  if (raw.schema !== 1) throw new ReviewValidationError("schema must be 1");

  const outcome = requireString(raw, "outcome");
  if (!REVIEW_OUTCOMES.includes(outcome as ReviewOutcome)) {
    throw new ReviewValidationError(
      `outcome must be one of ${REVIEW_OUTCOMES.join(", ")}; got ${JSON.stringify(outcome)}`
    );
  }

  const transaction = requireString(raw, "transaction");
  if (!isHex(transaction, 32)) throw new ReviewValidationError("transaction must be a 32-byte hex hash");
  const payer = requireString(raw, "payer");
  if (!isHex(payer, 20)) throw new ReviewValidationError("payer must be a 20-byte hex address");
  const payTo = requireString(raw, "payTo");
  if (!isHex(payTo, 20)) throw new ReviewValidationError("payTo must be a 20-byte hex address");

  const amount = requireString(raw, "amount");
  if (!/^\d+$/.test(amount)) throw new ReviewValidationError("amount must be atomic units as a decimal string");

  const ts = requireString(raw, "ts");
  if (Number.isNaN(Date.parse(ts))) throw new ReviewValidationError("ts must be a parseable timestamp");

  const resourceUrl = requireString(raw, "resourceUrl");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(resourceUrl);
  } catch {
    throw new ReviewValidationError("resourceUrl must be an absolute URL");
  }
  if (parsedUrl.search || parsedUrl.hash) {
    throw new ReviewValidationError("resourceUrl must have its query string and fragment stripped");
  }

  const paidMs = raw.paidMs;
  if (paidMs !== undefined && (typeof paidMs !== "number" || !Number.isFinite(paidMs) || paidMs < 0)) {
    throw new ReviewValidationError("paidMs must be a non-negative number");
  }

  return {
    schema: 1,
    resourceUrl,
    taskClass: optionalString(raw, "taskClass"),
    network: requireString(raw, "network"),
    asset: requireString(raw, "asset"),
    amount,
    payTo,
    transaction,
    payer,
    outcome: outcome as ReviewOutcome,
    note: optionalString(raw, "note"),
    paidMs: paidMs as number | undefined,
    ts,
  };
}

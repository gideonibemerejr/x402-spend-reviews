/** zod is the single source of truth for what a review submission may contain. */
import { z } from "zod";

/** Outcomes a caller may publish. `unlabeled` is deliberately absent: an unlabeled receipt has no verdict to review. */
export const REVIEW_OUTCOMES = ["used", "retried", "discarded", "failed"] as const;

/** A 20-byte EVM address. */
export const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte hex address");

/** A 32-byte transaction hash. */
export const TxHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex hash");

/**
 * Everything a client publishes about one settled call, and nothing else.
 *
 * `.strict()` is load-bearing: receipt internals the client should keep local
 * (legs, byte counts, HTTP status, the local receipt id) are rejected outright
 * rather than silently dropped, so a client over-sharing finds out immediately.
 *
 * `asset` must be a contract address. Symbolic names are refused here so that
 * verification never has to guess which token a name meant, which would let a
 * review claiming one asset be proved by a transfer of another.
 */
export const ReviewSubmission = z
  .object({
    schema: z.literal(1),
    resourceUrl: z
      .url("must be an absolute URL")
      // zod runs every check, so this refinement still sees values that failed
      // .url(); parsing one unguarded would throw instead of reporting an issue.
      .refine((value) => {
        if (!URL.canParse(value)) return true;
        const url = new URL(value);
        return !url.search && !url.hash;
      }, "must have its query string and fragment stripped"),
    taskClass: z.string().max(64).optional(),
    // 0.3 verifies EVM chains only; anything else is refused rather than stored unchecked.
    network: z.string().regex(/^eip155:\d+$/, "must be an eip155 CAIP-2 chain id"),
    asset: Address,
    amount: z.string().regex(/^\d{1,30}$/, "must be atomic units as a decimal string"),
    payTo: Address,
    transaction: TxHash,
    payer: Address,
    outcome: z.enum(REVIEW_OUTCOMES),
    note: z.string().max(500).optional(),
    paidMs: z.number().int().nonnegative().optional(),
    ts: z.iso.datetime("must be an ISO 8601 timestamp"),
  })
  .strict()
  // Paying yourself proves a transfer happened, not that a purchase did: the
  // Transfer log would verify while the review behind it means nothing. Caught
  // here so the claim is refused before it costs an RPC round trip.
  .refine(
    (submission) => submission.payer.toLowerCase() !== submission.payTo.toLowerCase(),
    "payer and payTo are the same address"
  );

/** A published verdict about a paid resource. */
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

/** Everything a client publishes about one settled call. */
export type ReviewSubmission = z.infer<typeof ReviewSubmission>;

/**
 * Renders a zod failure as one line naming the field and the check it failed.
 *
 * Typed structurally rather than against `z.ZodError` so it accepts the error
 * shape the Hono validator hands back, which differs between zod's own error
 * class and the core `$ZodError` the adapter surfaces.
 */
export function describeIssues(error: {
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
}): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

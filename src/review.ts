/** zod is the single source of truth for what a review submission may contain. */
import { z } from "zod";
import {
  canonicalNetwork, familyOf, foldCase,
  isEvmAddress, isEvmTxHash, isSvmAddress, isSvmSignature,
} from "./network";
import { FAMILY, OUTCOME, REASON, RECOVERY, REJECTION, RETIRED_OUTCOMES } from "./vocab";

/**
 * How each network family spells the accounts and settlements it names.
 *
 * Checked here rather than per field, because which spelling is correct depends
 * on a sibling field: `0x…` is a malformed account on Solana and a base58
 * signature is a malformed settlement on Base.
 */
const SPELLING = {
  [FAMILY.evm]: {
    account: isEvmAddress,
    accountMessage: "must be a 20-byte hex address",
    settlement: isEvmTxHash,
    settlementMessage: "must be a 32-byte hex hash",
  },
  [FAMILY.svm]: {
    account: isSvmAddress,
    accountMessage: "must be a base58 account address",
    settlement: isSvmSignature,
    settlementMessage: "must be a base58 transaction signature",
  },
} as const;

/** The fields that name an account, all spelled the same way as each other. */
const ACCOUNT_FIELDS = ["asset", "payTo", "payer"] as const;

/**
 * Everything a client publishes about one settled call, and nothing else.
 *
 * `.strict()` is load-bearing: receipt internals the client should keep local
 * (legs, byte counts, HTTP status, the local receipt id) are rejected outright
 * rather than silently dropped, so a client over-sharing finds out immediately.
 *
 * `asset` must be a mint or contract address. Symbolic names are refused so
 * that verification never has to guess which token a name meant, which would
 * let a review claiming one asset be proved by a transfer of another.
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
    // Normalized before it is judged: a client naming `solana-mainnet-beta` or
    // `base-mainnet` meant something unambiguous, and refusing it would cost a
    // real review over a spelling this server does not own.
    network: z
      .string()
      .transform(canonicalNetwork)
      .refine((network) => familyOf(network) !== undefined, "must be an eip155 or solana CAIP-2 network id"),
    // Spelled per family by the superRefine below, once the network is known.
    asset: z.string(),
    amount: z.string().regex(/^\d{1,30}$/, "must be atomic units as a decimal string"),
    payTo: z.string(),
    transaction: z.string(),
    payer: z.string(),
    // Named rather than left to zod's "invalid option": a client still sending
    // one of the four old labels is told what replaced it.
    outcome: z.enum(OUTCOME, {
      error: (issue) =>
        RETIRED_OUTCOMES.includes(issue.input as (typeof RETIRED_OUTCOMES)[number])
          ? `\`${String(issue.input)}\` is no longer an outcome: use \`${OUTCOME.useful}\`, or \`${OUTCOME.notUseful}\` with a reason`
          : `must be \`${OUTCOME.useful}\` or \`${OUTCOME.notUseful}\``,
    }),
    reason: z.enum(REASON).optional(),
    recovery: z.enum(RECOVERY).optional(),
    note: z.string().max(500).optional(),
    paidMs: z.number().int().nonnegative().optional(),
    ts: z.iso.datetime("must be an ISO 8601 timestamp"),
  })
  .strict()
  // Paying yourself proves a transfer happened, not that a purchase did: the
  // settlement would verify while the review behind it means nothing. Caught
  // here so the claim is refused before it costs an RPC round trip.
  .refine(
    (submission) => foldCase(submission.network, submission.payer) !== foldCase(submission.network, submission.payTo),
    REJECTION.selfPaymentAddress
  )
  .superRefine((submission, ctx) => {
    // A failure has to say why, in a word from the closed set, so reasons
    // aggregate across calls. A success has nothing to explain: "it worked" is
    // not a finding about anything, so a reason there is refused rather than
    // stored as noise.
    if (submission.outcome === OUTCOME.notUseful && submission.reason === undefined) {
      ctx.addIssue({
        code: "custom", path: ["reason"],
        message: `is required when outcome is \`${OUTCOME.notUseful}\``,
      });
    }
    if (submission.outcome === OUTCOME.useful && submission.reason !== undefined) {
      ctx.addIssue({
        code: "custom", path: ["reason"],
        message: `must be absent when outcome is \`${OUTCOME.useful}\``,
      });
    }

    const family = familyOf(submission.network);
    if (!family) return;
    const spelling = SPELLING[family];
    for (const field of ACCOUNT_FIELDS) {
      if (!spelling.account(submission[field])) {
        ctx.addIssue({ code: "custom", path: [field], message: spelling.accountMessage });
      }
    }
    if (!spelling.settlement(submission.transaction)) {
      ctx.addIssue({ code: "custom", path: ["transaction"], message: spelling.settlementMessage });
    }
  });

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

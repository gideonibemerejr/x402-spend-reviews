/**
 * On-chain verification: a review is only as good as the settlement behind it.
 *
 * This file owns the seam and the dispatch, not a rule. Each network family
 * proves a payment in its own terms — an ERC-20 `Transfer` log on EVM, a token
 * transfer among a transaction's instructions on Solana — so each lives in its
 * own module and this one decides which is being asked for.
 */
import { familyOf } from "../network";
import type { ReviewSubmission } from "../review";
import { FAMILY, REJECTION, type Proof } from "../vocab";
import { verifyEvmSettlement } from "./evm";
import { verifySvmSettlement } from "./svm";

/** A JSON-RPC caller. Tests supply fixtures through this; nothing else touches the network. */
export type RpcCall = (method: string, params: unknown[]) => Promise<unknown>;

/**
 * Verification outcome. `reason` names the single check that failed, for the
 * 422 body. A pass says how the payment was proved and what actually moved on
 * chain, which the exact-SVM scheme allows to exceed the amount claimed.
 */
export type VerificationResult =
  | { verified: true; proof: Proof; amount: string }
  | { verified: false; reason: string };

/**
 * Checks a submission against its settlement transaction.
 *
 * @param submission - Already shape-validated submission.
 * @param rpc - JSON-RPC caller for the submission's network.
 * @returns Verified, or the first check that failed.
 */
export async function verifySettlement(
  submission: ReviewSubmission,
  rpc: RpcCall
): Promise<VerificationResult> {
  switch (familyOf(submission.network)) {
    case FAMILY.evm:
      return verifyEvmSettlement(submission, rpc);
    case FAMILY.svm:
      return verifySvmSettlement(submission, rpc);
    default:
      return { verified: false, reason: REJECTION.networkUnsupported };
  }
}

/**
 * The EVM rule: an ERC-20 `Transfer` log proves the payment a review claims.
 *
 * Reached through {@link verifySettlement}, which dispatches on network family.
 */
import { referenceOf } from "../network";
import type { ReviewSubmission } from "../review";
import { PROOF, REASON } from "../vocab";
import type { RpcCall, VerificationResult } from "./index";

/** `keccak256("Transfer(address,address,uint256)")`. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Circle-issued native USDC, verified against Circle's published contract list
 * rather than recalled: https://developers.circle.com/stablecoins/usdc-contract-addresses
 *
 * Keyed by EIP-155 chain id. Used only when a submission's `asset` is not itself
 * a contract address.
 */
export const USDC_BY_CHAIN_ID: Readonly<Record<string, string>> = {
  "8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

/** One log entry as returned by `eth_getTransactionReceipt`. */
export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
}

/** The subset of `eth_getTransactionReceipt` this server reads. */
export interface RpcTransactionReceipt {
  status: string;
  logs: RpcLog[];
}

const isAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Reads the 20-byte address out of a 32-byte indexed log topic. */
function addressFromTopic(topic: string): string | undefined {
  if (typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return undefined;
  return `0x${topic.slice(26)}`;
}

/** Reads a uint256 out of a log's data word. */
function uint256(data: string): bigint | undefined {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]+$/.test(data)) return undefined;
  try {
    return BigInt(data);
  } catch {
    return undefined;
  }
}

/**
 * Resolves the token contract whose Transfer log must carry the payment.
 *
 * An `asset` that is already a contract address is authoritative. A symbolic
 * name must be one this server actually knows, because falling back to the
 * chain's USDC for *any* name would verify a submission claiming some other
 * token against a USDC transfer — recording an asset the proof does not show.
 * USDC is the only symbolic name 0.2 recognizes.
 */
function resolveToken(asset: string, chainId: string): string | undefined {
  if (isAddress(asset)) return asset;
  return asset.toLowerCase() === "usdc" ? USDC_BY_CHAIN_ID[chainId] : undefined;
}

/**
 * Checks a submission against its settlement transaction on an EVM chain.
 *
 * The payer is always read from the Transfer log, never from the transaction
 * sender: under EIP-3009 `transferWithAuthorization` the facilitator broadcasts
 * and pays gas, so `tx.from` is the facilitator and not the buyer.
 *
 * @param submission - Already shape-validated submission.
 * @param rpc - JSON-RPC caller for the submission's chain.
 * @returns Verified, or the first check that failed.
 */
export async function verifyEvmSettlement(
  submission: ReviewSubmission,
  rpc: RpcCall
): Promise<VerificationResult> {
  const chainId = referenceOf(submission.network);
  const token = resolveToken(submission.asset, chainId);
  if (!token) {
    return { verified: false, reason: `no known contract for asset ${submission.asset} on chain ${chainId}` };
  }

  const receipt = (await rpc("eth_getTransactionReceipt", [submission.transaction])) as
    | RpcTransactionReceipt
    | null
    | undefined;
  if (!receipt || !Array.isArray(receipt.logs)) {
    return { verified: false, reason: REASON.transactionNotFound };
  }
  if (receipt.status !== "0x1") {
    return { verified: false, reason: REASON.transactionFailed };
  }

  const transfers = receipt.logs.filter(
    (log) =>
      log && typeof log.address === "string" &&
      sameAddress(log.address, token) &&
      Array.isArray(log.topics) &&
      log.topics[0]?.toLowerCase() === TRANSFER_TOPIC
  );
  if (transfers.length === 0) {
    return { verified: false, reason: `no Transfer log for asset contract ${token}` };
  }

  const expected = BigInt(submission.amount);
  const fromPayer = transfers.filter((log) => {
    const from = addressFromTopic(log.topics[1]);
    return from !== undefined && sameAddress(from, submission.payer);
  });
  if (fromPayer.length === 0) {
    return { verified: false, reason: REASON.noTransferFromPayer };
  }
  const toPayTo = fromPayer.filter((log) => {
    const to = addressFromTopic(log.topics[2]);
    return to !== undefined && sameAddress(to, submission.payTo);
  });
  if (toPayTo.length === 0) {
    return { verified: false, reason: REASON.noTransferToPayTo };
  }
  const settled = toPayTo.find((log) => uint256(log.data) === expected);
  if (!settled) {
    return { verified: false, reason: `no Transfer log from payer to payTo for amount ${submission.amount}` };
  }
  // Exact by construction on EVM, so this never differs from the claim. Returned
  // all the same, so both families answer the same shape.
  return { verified: true, proof: PROOF.paymentTraced, amount: uint256(settled.data)!.toString() };
}

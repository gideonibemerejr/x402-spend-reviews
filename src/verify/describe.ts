/**
 * Reading a settlement transaction, rather than checking a claim about one.
 *
 * {@link verifySettlement} answers "does this transaction prove what the review
 * says?" — it is handed a payer, a payTo, an asset and an amount, and it looks
 * for exactly that. This file answers the question underneath it: "what payment
 * is in this transaction at all?", with nothing supplied but the hash and the
 * network.
 *
 * That is what the site's demo needs. A reader arriving with a transaction hash
 * has no claim to check; they want to see what the chain says. The decoding is
 * the verifiers' own — the same `Transfer` topic, the same instruction parser,
 * the same notion of what counts as attribution — so the two can never disagree
 * about what a transaction contains. Only the question differs.
 *
 * Nothing here writes. Describing a transaction is a lookup.
 */
import { familyOf, referenceOf } from "../network";
import { FAMILY, PROOF, PROOF_LABEL, REJECTION, type Proof } from "../vocab";
import {
  addressFromTopic,
  sameAddress,
  uint256,
  USDC_BY_CHAIN_ID,
  TRANSFER_TOPIC,
  type RpcTransactionReceipt,
} from "./evm";
import {
  parseTransfer,
  tokenAccountFacts,
  SOLANA_NETWORKS,
  USDC_BY_SOLANA_NETWORK,
  type SvmTransaction,
} from "./svm";
import type { RpcCall } from "./index";

/**
 * The most transfers reported from one transaction.
 *
 * A payment settles in one transfer; a transaction carrying dozens is a batch
 * or a swap route, and listing all of it would turn a demo into an unbounded
 * response. The cap is stated in the answer when it bites, so a truncated list
 * is never mistaken for a complete one.
 */
export const MAX_TRANSFERS = 20;

/** One token movement found inside a settlement. */
export interface DescribedTransfer {
  /** Contract address on EVM, mint on Solana. */
  asset: string;
  /** `USDC` when the asset is that chain's Circle-issued USDC, else absent. */
  assetLabel?: string;
  /** Absent exactly when the chain shows the credit but not who sent it. */
  payer?: string;
  payTo: string;
  /** Atomic units, as a decimal string. */
  amount: string;
  /**
   * How well this transfer is attributed — the same distinction a stored review
   * carries, so the site can label a lookup with the vocabulary it already uses
   * for rows.
   */
  proof: Proof;
  /**
   * How {@link proof} is named to a reader, sent rather than left for the
   * caller to map. The site renders this verbatim, so there is no second copy
   * of the vocabulary to fall out of step with this one.
   */
  proofLabel: string;
}

/** What a transaction turned out to contain, or why it could not be read. */
export type DescriptionResult =
  | {
      found: true;
      network: string;
      transaction: string;
      transfers: DescribedTransfer[];
      /** True when {@link MAX_TRANSFERS} cut the list short. */
      truncated: boolean;
    }
  | { found: false; reason: string };

/** Names the chain's own USDC, and only that. Any other token is reported by address alone. */
function labelFor(asset: string, network: string): string | undefined {
  if (familyOf(network) === FAMILY.evm) {
    const usdc = USDC_BY_CHAIN_ID[referenceOf(network)];
    return usdc && sameAddress(asset, usdc) ? "USDC" : undefined;
  }
  return asset === USDC_BY_SOLANA_NETWORK[network] ? "USDC" : undefined;
}

/** Reads every ERC-20 `Transfer` in a receipt, whoever sent it and whatever token it moved. */
async function describeEvm(
  transaction: string,
  network: string,
  rpc: RpcCall
): Promise<DescriptionResult> {
  const receipt = (await rpc("eth_getTransactionReceipt", [transaction])) as
    | RpcTransactionReceipt
    | null
    | undefined;
  if (!receipt || !Array.isArray(receipt.logs)) {
    return { found: false, reason: REJECTION.transactionNotFound };
  }
  if (receipt.status !== "0x1") {
    return { found: false, reason: REJECTION.transactionFailed };
  }

  const all: DescribedTransfer[] = [];
  for (const log of receipt.logs) {
    if (!log || typeof log.address !== "string" || !Array.isArray(log.topics)) continue;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    const payer = addressFromTopic(log.topics[1]);
    const payTo = addressFromTopic(log.topics[2]);
    const amount = uint256(log.data);
    // A Transfer whose indexed topics do not decode is not a transfer this
    // server can report; an ERC-721 `Transfer` shares the topic and carries a
    // token id in the third topic rather than an amount in data.
    if (!payer || !payTo || amount === undefined) continue;
    const label = labelFor(log.address, network);
    all.push({
      asset: log.address.toLowerCase(),
      ...(label ? { assetLabel: label } : {}),
      payer: payer.toLowerCase(),
      payTo: payTo.toLowerCase(),
      amount: amount.toString(),
      // The log names its own sender, so an EVM transfer is always attributed.
      proof: PROOF.paymentTraced,
      proofLabel: PROOF_LABEL[PROOF.paymentTraced],
    });
  }

  if (all.length === 0) {
    return { found: false, reason: "no ERC-20 Transfer log in this transaction" };
  }
  return {
    found: true, network, transaction,
    transfers: all.slice(0, MAX_TRANSFERS),
    truncated: all.length > MAX_TRANSFERS,
  };
}

/**
 * Reads every SPL token transfer in a transaction, top level and CPI alike.
 *
 * A transfer whose authority the transaction does not record is reported as
 * `receipt_only` rather than dropped: the credit demonstrably happened, and
 * saying so while admitting the sender is unknown is more honest than either
 * hiding the transfer or naming a payer the chain did not.
 */
async function describeSvm(
  transaction: string,
  network: string,
  rpc: RpcCall
): Promise<DescriptionResult> {
  if (!SOLANA_NETWORKS.includes(network)) {
    return { found: false, reason: REJECTION.networkUnsupported };
  }
  const tx = (await rpc("getTransaction", [
    transaction,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
  ])) as SvmTransaction | null | undefined;
  if (!tx) return { found: false, reason: REJECTION.transactionNotFound };
  if (!tx.meta) return { found: false, reason: REJECTION.noMetadata };
  if (tx.meta.err != null) return { found: false, reason: REJECTION.transactionFailed };

  const inner = tx.meta.innerInstructions;
  const instructions = [
    ...(tx.transaction?.message?.instructions ?? []),
    ...(Array.isArray(inner) ? inner.flatMap((group) => group?.instructions ?? []) : []),
  ];

  const all: DescribedTransfer[] = [];
  for (const instruction of instructions) {
    const transfer = parseTransfer(instruction);
    if (!transfer) continue;
    // The destination is a token account, not a wallet. Its balance record is
    // what names the owner being paid and — for a bare `transfer`, which names
    // no mint — which token moved.
    const destination = tokenAccountFacts(tx, transfer.destination);
    const asset = transfer.mint ?? destination?.mint;
    const payTo = destination?.owner;
    if (!asset || !payTo) continue;
    const payer = transfer.authority ?? tokenAccountFacts(tx, transfer.source)?.owner;
    const label = labelFor(asset, network);
    all.push({
      asset,
      ...(label ? { assetLabel: label } : {}),
      ...(payer ? { payer } : {}),
      payTo,
      amount: transfer.amount.toString(),
      proof: payer ? PROOF.paymentTraced : PROOF.receiptOnly,
      proofLabel: PROOF_LABEL[payer ? PROOF.paymentTraced : PROOF.receiptOnly],
    });
  }

  if (all.length === 0) {
    return { found: false, reason: "no SPL token transfer in this transaction" };
  }
  return {
    found: true, network, transaction,
    transfers: all.slice(0, MAX_TRANSFERS),
    truncated: all.length > MAX_TRANSFERS,
  };
}

/**
 * Describes what a settlement transaction moved.
 *
 * @param transaction - Hash on EVM, signature on Solana. Spelling is the
 *   caller's to validate; this function only reads what the node returns.
 * @param network - Canonical CAIP-2 id.
 * @param rpc - JSON-RPC caller for that network.
 */
export async function describeSettlement(
  transaction: string,
  network: string,
  rpc: RpcCall
): Promise<DescriptionResult> {
  switch (familyOf(network)) {
    case FAMILY.evm:
      return describeEvm(transaction, network, rpc);
    case FAMILY.svm:
      return describeSvm(transaction, network, rpc);
    default:
      return { found: false, reason: REJECTION.networkUnsupported };
  }
}

/**
 * The Solana rule, from the exact-SVM scheme's own verification requirements
 * (`specs/schemes/exact/scheme_exact_svm.md`, §1.2–§1.4).
 *
 * Across every top-level instruction *and the full CPI trace*, exactly one
 * token transfer must credit the destination the review claims. Zero is not a
 * payment; two is ambiguous, and accepting either would let one transaction be
 * read as paying for a review it did not pay for. The transfer may sit at the
 * top level or inside another program's CPI, which is how smart wallets such as
 * Squads and Swig satisfy the scheme, so a verifier that only reads top-level
 * instructions would refuse honest payments.
 *
 * The balance delta of §3.4 is the documented fallback for when a node cannot
 * return the inner instructions, not the rule.
 */
import { NETWORK } from "../network";
import type { ReviewSubmission } from "../review";
import { associatedTokenAddress, isPubkey } from "./solana-address";
import { PROOF, REASON } from "../vocab";
import type { RpcCall, VerificationResult } from "./index";

/** The Solana clusters this server verifies. Any other `solana:` id is refused. */
export const SOLANA_NETWORKS: readonly string[] = [NETWORK.solanaMainnet, NETWORK.solanaDevnet];

/**
 * Circle-issued native USDC, verified against Circle's published list rather
 * than recalled: https://developers.circle.com/stablecoins/usdc-contract-addresses
 *
 * Both are SPL Token mints with 6 decimals. Verification never consults this
 * map — a `solana:` submission must name its mint outright — but the page and
 * the fixtures need to know which mint is the real one.
 */
export const USDC_BY_SOLANA_NETWORK: Readonly<Record<string, string>> = {
  [NETWORK.solanaMainnet]: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  [NETWORK.solanaDevnet]: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

/**
 * The two token programs a transfer may run on, taken from the programs' own
 * published documentation rather than recalled:
 * https://www.solana-program.com/docs/token and
 * https://www.solana-program.com/docs/token-2022
 *
 * The program is a property of the mint, not of the chain: USDC is SPL Token,
 * while USDG, PYUSD and CASH are Token-2022, so the destination account is
 * derived under whichever program the transfer actually used and both are tried.
 */
export const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const TOKEN_PROGRAMS: readonly string[] = [SPL_TOKEN_PROGRAM, TOKEN_2022_PROGRAM];

/** One instruction as `getTransaction` returns it under `jsonParsed`. */
export interface ParsedInstruction {
  /** The parser's name for the program, e.g. `spl-token`. Read only for legibility. */
  program?: string;
  programId?: string;
  parsed?: { type?: string; info?: Record<string, unknown> } | string;
}

/** The instructions one top-level instruction invoked by CPI. */
export interface InnerInstructionGroup {
  index?: number;
  instructions?: ParsedInstruction[];
}

/** A token account's balance before or after the transaction. */
export interface TokenBalance {
  accountIndex?: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number };
}

/** The subset of `getTransaction` this server reads. */
export interface SvmTransaction {
  meta?: {
    err?: unknown;
    /** Absent — not merely empty — when the node cannot supply the CPI trace. */
    innerInstructions?: InnerInstructionGroup[] | null;
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
    loadedAddresses?: { writable?: string[]; readonly?: string[] } | null;
  } | null;
  transaction?: {
    message?: {
      accountKeys?: (string | { pubkey?: string })[];
      instructions?: ParsedInstruction[];
    };
  } | null;
}

/** A token transfer, as much of one as the parsed instruction reveals. */
interface TokenTransfer {
  programId: string;
  destination: string;
  amount: bigint;
  source?: string;
  authority?: string;
  /** Present on `transferChecked` only; a bare `transfer` does not name the mint. */
  mint?: string;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Reads atomic units. Anything that is not a plain decimal string is not an amount. */
function atomic(value: unknown): bigint | undefined {
  const text = asString(value);
  return text && /^\d+$/.test(text) ? BigInt(text) : undefined;
}

/**
 * Reads a token transfer out of a parsed instruction, or `undefined` if the
 * instruction is not one.
 *
 * `transferCheckedWithFee` is deliberately not read: the amount a Token-2022
 * fee-bearing transfer credits is not the amount it names, and a scheme that
 * tolerated the difference would verify an underpayment.
 */
function parseTransfer(instruction: ParsedInstruction | undefined): TokenTransfer | undefined {
  const programId = asString(instruction?.programId);
  if (!programId || !TOKEN_PROGRAMS.includes(programId)) return undefined;
  const parsed = instruction?.parsed;
  if (!parsed || typeof parsed !== "object") return undefined;
  if (parsed.type !== "transfer" && parsed.type !== "transferChecked") return undefined;
  const info = parsed.info;
  if (!info || typeof info !== "object") return undefined;

  const destination = asString(info.destination);
  const tokenAmount = (info.tokenAmount as { amount?: unknown } | undefined)?.amount;
  const amount = atomic(tokenAmount ?? info.amount);
  if (!destination || amount === undefined) return undefined;

  return {
    programId,
    destination,
    amount,
    source: asString(info.source),
    authority: asString(info.authority) ?? asString(info.multisigAuthority),
    mint: asString(info.mint),
  };
}

/**
 * Resolves the owner of a token account from the transaction's own balance
 * records, for the `transfer` variants that name no authority.
 *
 * Account indices count across the static keys and then the addresses loaded
 * from lookup tables, in that order, so a versioned transaction resolves too.
 */
function ownerOfTokenAccount(transaction: SvmTransaction, account: string | undefined): string | undefined {
  if (!account) return undefined;
  const meta = transaction.meta;
  const keys = [
    ...(transaction.transaction?.message?.accountKeys ?? []).map((key) =>
      typeof key === "string" ? key : key?.pubkey
    ),
    ...(meta?.loadedAddresses?.writable ?? []),
    ...(meta?.loadedAddresses?.readonly ?? []),
  ];
  const index = keys.indexOf(account);
  if (index < 0) return undefined;
  const balances = [...(meta?.postTokenBalances ?? []), ...(meta?.preTokenBalances ?? [])];
  return balances.find((balance) => balance?.accountIndex === index)?.owner;
}

/**
 * §3.4's fallback: the destination's balance rose by at least the amount.
 *
 * Weaker than the rule it stands in for, and knowingly so. A balance delta
 * shows that the payTo account was credited; it cannot show who credited it,
 * so this path confirms the payment without attributing it to the claimed
 * payer. It runs only when the node returned no CPI trace at all.
 */
function verifyByBalanceDelta(
  transaction: SvmTransaction,
  submission: ReviewSubmission,
  required: bigint
): VerificationResult {
  const pre = transaction.meta?.preTokenBalances ?? [];
  const post = transaction.meta?.postTokenBalances ?? [];
  const credited = post.filter(
    (balance) => balance?.mint === submission.asset && balance?.owner === submission.payTo
  );
  if (credited.length === 0) {
    return {
      verified: false,
      reason: `no matching transfer, and payTo holds no ${submission.asset} balance in this transaction`,
    };
  }

  let largest: bigint | undefined;
  for (const balance of credited) {
    const after = atomic(balance.uiTokenAmount?.amount);
    if (after === undefined) continue;
    const before =
      atomic(
        pre.find((entry) => entry?.accountIndex === balance.accountIndex)?.uiTokenAmount?.amount
      ) ?? 0n;
    const delta = after - before;
    if (largest === undefined || delta > largest) largest = delta;
  }
  if (largest !== undefined && largest >= required) {
    return { verified: true, proof: PROOF.receiptOnly, amount: largest.toString() };
  }
  return {
    verified: false,
    reason: `payTo's ${submission.asset} balance rose by ${largest ?? 0n}, less than the required ${submission.amount}`,
  };
}

/**
 * Checks a submission against its settlement transaction on Solana.
 *
 * The payer is read from the transfer's own authority, never from the
 * transaction's fee payer: a sponsored transaction is signed and paid for by
 * the facilitator, exactly as the facilitator broadcasts on EVM, so the fee
 * payer is the last account that should be credited with the purchase.
 *
 * @param submission - Already shape-validated submission.
 * @param rpc - JSON-RPC caller for the submission's cluster.
 * @returns Verified — with the amount actually moved — or the check that failed.
 */
export async function verifySvmSettlement(
  submission: ReviewSubmission,
  rpc: RpcCall
): Promise<VerificationResult> {
  if (!SOLANA_NETWORKS.includes(submission.network)) {
    return { verified: false, reason: REASON.networkUnsupported };
  }
  // Refused before the round trip: paying yourself proves a transfer, not a purchase.
  if (submission.payer === submission.payTo) {
    return { verified: false, reason: REASON.selfPaymentAccount };
  }
  for (const field of ["asset", "payTo", "payer"] as const) {
    if (!isPubkey(submission[field])) {
      return { verified: false, reason: `${field} must be a base58 address on ${submission.network}` };
    }
  }
  const required = atomic(submission.amount);
  if (required === undefined) {
    return { verified: false, reason: REASON.malformedAmount };
  }

  const transaction = (await rpc("getTransaction", [
    submission.transaction,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
  ])) as SvmTransaction | null | undefined;
  if (!transaction) return { verified: false, reason: REASON.transactionNotFound };
  if (!transaction.meta) {
    return { verified: false, reason: REASON.noMetadata };
  }
  if (transaction.meta.err != null) {
    return { verified: false, reason: REASON.transactionFailed };
  }

  // The associated token account address commits to owner, mint and token
  // program at once, so a transfer that credits it cannot have credited a
  // different mint — which is what lets a bare `transfer`, which names no mint,
  // be checked at all.
  const expected = new Map<string, string>();
  for (const program of TOKEN_PROGRAMS) {
    const ata = await associatedTokenAddress(submission.payTo, submission.asset, program);
    if (ata) expected.set(program, ata);
  }

  const inner = transaction.meta.innerInstructions;
  const traced = Array.isArray(inner);
  const instructions = [
    ...(transaction.transaction?.message?.instructions ?? []),
    ...(traced ? inner.flatMap((group) => group?.instructions ?? []) : []),
  ];

  const candidates = instructions
    .map(parseTransfer)
    .filter((transfer): transfer is TokenTransfer => transfer !== undefined)
    .filter(
      (transfer) =>
        transfer.destination === expected.get(transfer.programId) &&
        (transfer.mint === undefined || transfer.mint === submission.asset)
    );
  // Overpayment is tolerated — a smart wallet may round up — but never a shortfall.
  const matches = candidates.filter((transfer) => transfer.amount >= required);

  if (matches.length > 1) {
    return { verified: false, reason: REASON.ambiguousTransfers };
  }
  if (matches.length === 1) {
    const match = matches[0]!;
    const payer = match.authority ?? ownerOfTokenAccount(transaction, match.source);
    if (payer === undefined) {
      return { verified: false, reason: REASON.unattributedTransfer };
    }
    if (payer !== submission.payer) {
      return { verified: false, reason: `transfer was authorized by ${payer}, not by payer ${submission.payer}` };
    }
    return { verified: true, proof: PROOF.paymentTraced, amount: match.amount.toString() };
  }

  // Nothing matched. If the node never gave us the CPI trace, the transfer may
  // simply be somewhere we were not shown; only then is the balance delta asked.
  if (!traced) return verifyByBalanceDelta(transaction, submission, required);
  if (candidates.length > 0) {
    const largest = candidates.reduce((a, b) => (b.amount > a.amount ? b : a));
    return {
      verified: false,
      reason: `transfer to payTo was for ${largest.amount}, less than the required ${submission.amount}`,
    };
  }
  return {
    verified: false,
    reason: `no transfer of ${submission.asset} to payTo's associated token account`,
  };
}

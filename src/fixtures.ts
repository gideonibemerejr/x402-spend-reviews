/** Chain-free fixtures: hand-built transaction receipts so tests never touch a network. */
import type { ReviewSubmission } from "./review";
import type { RpcCall } from "./verify";
import { OUTCOME } from "./vocab";
import type { RpcLog, RpcTransactionReceipt } from "./verify-evm";
import { TRANSFER_TOPIC } from "./verify-evm";
import { NETWORK } from "./network";
import type { ParsedInstruction, SvmTransaction, TokenBalance } from "./verify-svm";
import { SPL_TOKEN_PROGRAM, USDC_BY_SOLANA_NETWORK } from "./verify-svm";

// --- EVM ---

export const PAYER = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
export const PAY_TO = "0x976EA74026E726554dB657fA54763abd0C3a0aa9";
export const FACILITATOR = "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955";
export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const TX_HASH = `0x${"ab".repeat(32)}`;

/** Left-pads a 20-byte address into a 32-byte indexed log topic. */
export const topicFor = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;

/** Encodes a uint256 into a log data word. */
export const wordFor = (value: bigint | string) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;

/** Builds an ERC-20 `Transfer` log. */
export function transferLog(options: {
  address?: string;
  from?: string;
  to?: string;
  amount?: bigint | string;
}): RpcLog {
  return {
    address: options.address ?? USDC_BASE_SEPOLIA,
    topics: [TRANSFER_TOPIC, topicFor(options.from ?? PAYER), topicFor(options.to ?? PAY_TO)],
    data: wordFor(options.amount ?? "10000"),
  };
}

/** Builds a transaction receipt around the given logs. */
export const receiptWith = (logs: RpcLog[], status = "0x1"): RpcTransactionReceipt => ({ status, logs });

/** An RPC caller that answers `eth_getTransactionReceipt` with a fixed fixture. */
export function rpcReturning(receipt: RpcTransactionReceipt | null): RpcCall {
  return async (method) => {
    if (method !== "eth_getTransactionReceipt") throw new Error(`unexpected RPC method ${method}`);
    return receipt;
  };
}

/** A submission that matches {@link transferLog}'s defaults. */
export function submission(overrides: Partial<ReviewSubmission> = {}): ReviewSubmission {
  return {
    schema: 1,
    resourceUrl: "https://api.test/paid",
    network: NETWORK.baseSepolia,
    asset: USDC_BASE_SEPOLIA,
    amount: "10000",
    payTo: PAY_TO,
    transaction: TX_HASH,
    payer: PAYER,
    outcome: OUTCOME.used,
    ts: "2026-09-06T12:00:00.000Z",
    ...overrides,
  };
}

// --- Solana ---
//
// The keys are ed25519 public keys and the token accounts are their real
// associated token addresses, both generated with `@solana/web3.js` and
// `@solana/spl-token` so the fixtures come from the canonical implementation
// rather than from the derivation they are used to check.

export const SOL_PAYER = "7v54NWdBtkjuAFJrLGsS2SXnuk8nKam81mZJeeYxVFi9";
export const SOL_PAY_TO = "6TcyBfPdBt1kjsvDZLzmBFnuMaLWiTaAt4RjUr9VA5YD";
/** Signs and pays the fee on a sponsored transaction. Never the buyer. */
export const SOL_FEE_PAYER = "AB3FQHskSYuWVw4M9EpGdxNzrAjBNiYGpbH4CVzLFene";
export const SOL_OTHER = "AzXW61LgzhJTXN1so7rBR5auU2oCSzRyNEqFxPkZct3G";

export const USDC_SOLANA_DEVNET = USDC_BY_SOLANA_NETWORK[NETWORK.solanaDevnet]!;
export const SOL_OTHER_MINT = "3znAGhp6Tk4kmebhXnk9K3jaTMffu82PJfEG91AeRkq2";

/** Associated token accounts for USDC on devnet, under the SPL Token program. */
export const SOL_PAYER_ATA = "2LNTFpNjKosFwWxqgMsW6zbqSy4NuSPyr8rFf2nHZAPm";
export const SOL_PAY_TO_ATA = "BSBoMDfQvY6uCDfBASPx2Q62gHb4Xtmf9x5CyYXfC833";
/** payTo's account for the same mint under Token-2022: a different address entirely. */
export const SOL_PAY_TO_ATA_2022 = "2jAR3PUz48VAjK6QptZGE1RAzPCevvmgrrpsMazUpGDe";
/** payTo's account for a different mint. */
export const SOL_PAY_TO_ATA_OTHER_MINT = "93cdCmkmVT1dzogKqRSBBvxF8QrBVrhgE7ejRm4x7ACq";
export const SOL_OTHER_ATA = "Dj6wkvL1d1wAkJBqx21UysbYSzxApRgGkpt6hEhrxM2V";

/** A 64-byte base58 transaction signature. */
export const SOL_SIGNATURE =
  "4S55ApgNWn8YKQL5J2uuxtfZrYXQZqBs8BUJTqGv3us4cAefggxxMLavbor7u47x4BfUhDRkfFBpW2rJTU6YMxux";

const SOL_ACCOUNT_KEYS = [SOL_FEE_PAYER, SOL_PAYER_ATA, SOL_PAY_TO_ATA, SPL_TOKEN_PROGRAM];

/** Builds one parsed token transfer instruction, `transferChecked` by default. */
export function svmTransfer(
  options: {
    programId?: string;
    type?: "transfer" | "transferChecked";
    source?: string;
    destination?: string;
    /** Omit with `authority: null` to make an instruction that names no signer. */
    authority?: string | null;
    mint?: string;
    amount?: bigint | string;
  } = {}
): ParsedInstruction {
  const type = options.type ?? "transferChecked";
  const amount = String(options.amount ?? "10000");
  const info: Record<string, unknown> = {
    source: options.source ?? SOL_PAYER_ATA,
    destination: options.destination ?? SOL_PAY_TO_ATA,
    ...(options.authority === null ? {} : { authority: options.authority ?? SOL_PAYER }),
  };
  if (type === "transferChecked") {
    info.mint = options.mint ?? USDC_SOLANA_DEVNET;
    info.tokenAmount = { amount, decimals: 6, uiAmountString: amount };
  } else {
    info.amount = amount;
  }
  return {
    program: "spl-token",
    programId: options.programId ?? SPL_TOKEN_PROGRAM,
    parsed: { type, info },
  };
}

/** Builds one `preTokenBalances` / `postTokenBalances` entry. */
export function svmBalance(options: {
  accountIndex: number;
  amount: string;
  mint?: string;
  owner?: string;
}): TokenBalance {
  return {
    accountIndex: options.accountIndex,
    mint: options.mint ?? USDC_SOLANA_DEVNET,
    owner: options.owner ?? SOL_PAY_TO,
    uiTokenAmount: { amount: options.amount, decimals: 6 },
  };
}

/**
 * Builds a `getTransaction` response.
 *
 * `inner: null` is the §3.4 case: a node that returned no CPI trace at all,
 * which is different from a transaction that made no CPI calls (`inner: []`).
 */
export function svmTransaction(
  options: {
    instructions?: ParsedInstruction[];
    inner?: ParsedInstruction[] | null;
    err?: unknown;
    accountKeys?: string[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } = {}
): SvmTransaction {
  const inner = options.inner === undefined ? [] : options.inner;
  return {
    transaction: {
      message: {
        accountKeys: options.accountKeys ?? SOL_ACCOUNT_KEYS,
        instructions: options.instructions ?? [],
      },
    },
    meta: {
      err: options.err ?? null,
      ...(inner === null
        ? {}
        : { innerInstructions: inner.length > 0 ? [{ index: 0, instructions: inner }] : [] }),
      preTokenBalances: options.preTokenBalances ?? [
        svmBalance({ accountIndex: 1, owner: SOL_PAYER, amount: "1000000" }),
        svmBalance({ accountIndex: 2, amount: "0" }),
      ],
      postTokenBalances: options.postTokenBalances ?? [
        svmBalance({ accountIndex: 1, owner: SOL_PAYER, amount: "990000" }),
        svmBalance({ accountIndex: 2, amount: "10000" }),
      ],
    },
  };
}

/** An RPC caller that answers `getTransaction` with a fixed fixture. */
export function svmRpcReturning(transaction: SvmTransaction | null): RpcCall {
  return async (method) => {
    if (method !== "getTransaction") throw new Error(`unexpected RPC method ${method}`);
    return transaction;
  };
}

/** A submission that matches {@link svmTransfer}'s defaults. */
export function svmSubmission(overrides: Partial<ReviewSubmission> = {}): ReviewSubmission {
  return {
    schema: 1,
    resourceUrl: "https://api.test/paid",
    network: NETWORK.solanaDevnet,
    asset: USDC_SOLANA_DEVNET,
    amount: "10000",
    payTo: SOL_PAY_TO,
    transaction: SOL_SIGNATURE,
    payer: SOL_PAYER,
    outcome: OUTCOME.used,
    ts: "2026-09-06T12:00:00.000Z",
    ...overrides,
  };
}

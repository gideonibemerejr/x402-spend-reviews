/** Chain-free fixtures: hand-built transaction receipts so tests never touch a network. */
import type { ReviewSubmission } from "./review";
import type { RpcCall, RpcLog, RpcTransactionReceipt } from "./verify";
import { TRANSFER_TOPIC } from "./verify";

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
    network: "eip155:84532",
    asset: "usdc",
    amount: "10000",
    payTo: PAY_TO,
    transaction: TX_HASH,
    payer: PAYER,
    outcome: "used",
    ts: "2026-09-06T12:00:00.000Z",
    ...overrides,
  };
}

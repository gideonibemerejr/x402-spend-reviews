/**
 * Describing a settlement: what is in this transaction, asked without a claim.
 *
 * The verifier's tests cover whether a transaction proves a *stated* payment.
 * These cover the question the demo asks instead — given only a hash, what
 * moved — and in particular that the answer is drawn from the same decoders, so
 * the two can never disagree about one transaction.
 */
import { expect, test } from "vitest";
import { NETWORK } from "../src/network";
import { describeSettlement, MAX_TRANSFERS } from "../src/verify/describe";
import { PROOF } from "../src/vocab";
import {
  PAYER, PAY_TO, FACILITATOR, TX_HASH, USDC_BASE_SEPOLIA,
  SOL_PAYER, SOL_PAY_TO, SOL_OTHER_ATA, SOL_SIGNATURE, USDC_SOLANA_DEVNET,
  receiptWith, rpcReturning, svmRpcReturning, svmTransaction, svmTransfer, transferLog,
} from "../src/fixtures";

const evm = (rpc: ReturnType<typeof rpcReturning>) =>
  describeSettlement(TX_HASH, NETWORK.baseSepolia, rpc);
const svm = (rpc: ReturnType<typeof svmRpcReturning>) =>
  describeSettlement(SOL_SIGNATURE, NETWORK.solanaDevnet, rpc);

test("an EVM transfer is reported with its payer, recipient and amount", async () => {
  const result = await evm(rpcReturning(receiptWith([transferLog({})])));
  expect(result).toEqual({
    found: true,
    network: NETWORK.baseSepolia,
    transaction: TX_HASH,
    truncated: false,
    transfers: [{
      asset: USDC_BASE_SEPOLIA.toLowerCase(),
      assetLabel: "USDC",
      payer: PAYER.toLowerCase(),
      payTo: PAY_TO.toLowerCase(),
      amount: "10000",
      proof: PROOF.paymentTraced,
      proofLabel: "payment traced",
    }],
  });
});

test("the payer is the log's sender, not whoever broadcast the transaction", async () => {
  // The same EIP-3009 point the verifier makes: under transferWithAuthorization
  // the facilitator pays the gas, so a describer reading tx.from would name the
  // wrong party to every reader of the demo.
  const result = await evm(rpcReturning(receiptWith([transferLog({ from: PAYER, to: PAY_TO })])));
  expect(result).toMatchObject({ found: true, transfers: [{ payer: PAYER.toLowerCase() }] });
  expect(JSON.stringify(result)).not.toContain(FACILITATOR.toLowerCase());
});

test("a token that is not the chain's own USDC is reported by address, unlabelled", async () => {
  const other = "0x1111111111111111111111111111111111111111";
  const result = await evm(rpcReturning(receiptWith([transferLog({ address: other })])));
  expect(result).toMatchObject({ found: true, transfers: [{ asset: other }] });
  expect(result).not.toHaveProperty("transfers.0.assetLabel");
});

test("every transfer in the transaction is listed, not only the first", async () => {
  const result = await evm(rpcReturning(receiptWith([
    transferLog({ amount: "10000" }),
    transferLog({ from: PAY_TO, to: FACILITATOR, amount: "250" }),
  ])));
  expect(result).toMatchObject({ found: true, truncated: false });
  expect(result).toHaveProperty("transfers.1.amount", "250");
});

test("a batch longer than the cap is cut short and says so", async () => {
  const many = Array.from({ length: MAX_TRANSFERS + 5 }, (_, i) => transferLog({ amount: String(i + 1) }));
  const result = await evm(rpcReturning(receiptWith(many)));
  expect(result).toMatchObject({ found: true, truncated: true });
  expect((result as { transfers: unknown[] }).transfers).toHaveLength(MAX_TRANSFERS);
});

test("a transaction with no token transfer is a found:false answer, not an error", async () => {
  expect(await evm(rpcReturning(receiptWith([])))).toEqual({
    found: false, reason: "no ERC-20 Transfer log in this transaction",
  });
});

test("a missing transaction and a reverted one are told apart", async () => {
  expect(await evm(rpcReturning(null))).toEqual({ found: false, reason: "transaction not found" });
  expect(await evm(rpcReturning(receiptWith([transferLog({})], "0x0")))).toEqual({
    found: false, reason: "transaction did not succeed on chain",
  });
});

test("an unsupported network is refused before any round trip", async () => {
  const rpc = () => { throw new Error("should not be called"); };
  expect(await describeSettlement(TX_HASH, "cosmos:hub", rpc)).toEqual({
    found: false, reason: "network not supported",
  });
});

test("a Solana transfer names the account owners, not their token accounts", async () => {
  const result = await svm(svmRpcReturning(svmTransaction({ instructions: [svmTransfer({})] })));
  expect(result).toEqual({
    found: true,
    network: NETWORK.solanaDevnet,
    transaction: SOL_SIGNATURE,
    truncated: false,
    transfers: [{
      asset: USDC_SOLANA_DEVNET,
      assetLabel: "USDC",
      payer: SOL_PAYER,
      payTo: SOL_PAY_TO,
      amount: "10000",
      proof: PROOF.paymentTraced,
      proofLabel: "payment traced",
    }],
  });
});

test("a transfer inside a CPI is found, as the scheme requires", async () => {
  const result = await svm(svmRpcReturning(svmTransaction({ inner: [svmTransfer({})] })));
  expect(result).toMatchObject({ found: true, transfers: [{ payTo: SOL_PAY_TO, amount: "10000" }] });
});

test("a transfer the chain cannot attribute is reported as payer-unconfirmed", async () => {
  // A bare `transfer` names no authority, and this one's source account is not
  // one the transaction carries a balance record for. The credit happened; who
  // sent it is not knowable from this transaction, and the answer says so
  // rather than dropping the transfer or inventing a payer.
  const result = await svm(svmRpcReturning(svmTransaction({
    instructions: [svmTransfer({ type: "transfer", authority: null, source: SOL_OTHER_ATA })],
  })));
  expect(result).toMatchObject({
    found: true,
    transfers: [{ payTo: SOL_PAY_TO, amount: "10000", proof: PROOF.receiptOnly }],
  });
  expect(result).not.toHaveProperty("transfers.0.payer");
});

test("a failed Solana transaction is refused even though it carries a transfer", async () => {
  const result = await svm(svmRpcReturning(svmTransaction({
    instructions: [svmTransfer({})], err: { InstructionError: [0, "Custom"] },
  })));
  expect(result).toEqual({ found: false, reason: "transaction did not succeed on chain" });
});

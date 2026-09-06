import { expect, test } from "vitest";
import { USDC_BY_CHAIN_ID, verifySettlement } from "../src/verify";
import {
  FACILITATOR, PAYER, PAY_TO, USDC_BASE_SEPOLIA,
  receiptWith, rpcReturning, submission, transferLog,
} from "../src/fixtures";

test("USDC addresses match Circle's published contract list", () => {
  expect(USDC_BY_CHAIN_ID["8453"]).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  expect(USDC_BY_CHAIN_ID["84532"]).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
});

test("a matching transfer verifies", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({})]));
  expect(await verifySettlement(submission(), rpc)).toEqual({ verified: true });
});

test("the payer is read from the transfer log, not the transaction sender", async () => {
  // EIP-3009: the facilitator broadcasts and pays gas, so tx.from is never the buyer.
  const rpc = rpcReturning(receiptWith([transferLog({ from: PAYER, to: PAY_TO })]));
  expect(await verifySettlement(submission({ payer: PAYER }), rpc)).toEqual({ verified: true });
  expect(await verifySettlement(submission({ payer: FACILITATOR }), rpc)).toEqual({
    verified: false, reason: "no Transfer log sent by payer",
  });
});

test("a wrong payTo is rejected and named", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({ to: FACILITATOR })]));
  expect(await verifySettlement(submission(), rpc)).toEqual({
    verified: false, reason: "no Transfer log from payer to payTo",
  });
});

test("a wrong amount is rejected and named", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({ amount: "9999" })]));
  expect(await verifySettlement(submission({ amount: "10000" }), rpc)).toEqual({
    verified: false, reason: "no Transfer log from payer to payTo for amount 10000",
  });
});

test("a transfer of the right shape on the wrong contract is rejected", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({ address: FACILITATOR })]));
  expect(await verifySettlement(submission(), rpc)).toEqual({
    verified: false, reason: `no Transfer log for asset contract ${USDC_BASE_SEPOLIA}`,
  });
});

test("an explicit asset address overrides the symbolic USDC lookup", async () => {
  const token = "0x1111111111111111111111111111111111111111";
  const rpc = rpcReturning(receiptWith([transferLog({ address: token })]));
  expect(await verifySettlement(submission({ asset: token }), rpc)).toEqual({ verified: true });
});

test("a missing transaction is rejected", async () => {
  expect(await verifySettlement(submission(), rpcReturning(null))).toEqual({
    verified: false, reason: "transaction not found",
  });
});

test("a reverted transaction is rejected even with a matching log", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({})], "0x0"));
  expect(await verifySettlement(submission(), rpc)).toEqual({
    verified: false, reason: "transaction did not succeed on chain",
  });
});

test("the matching transfer is found among unrelated logs", async () => {
  const rpc = rpcReturning(receiptWith([
    { address: USDC_BASE_SEPOLIA, topics: ["0xdead"], data: "0x" },
    transferLog({ to: FACILITATOR, amount: "1" }),
    transferLog({}),
  ]));
  expect(await verifySettlement(submission(), rpc)).toEqual({ verified: true });
});

test("addresses compare case-insensitively", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({})]));
  const result = await verifySettlement(
    submission({ payer: PAYER.toUpperCase().replace("0X", "0x"), payTo: PAY_TO.toLowerCase() }),
    rpc
  );
  expect(result).toEqual({ verified: true });
});

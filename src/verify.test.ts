import { test } from "node:test";
import assert from "node:assert/strict";
import { USDC_BY_CHAIN_ID, verifySettlement } from "./verify.js";
import {
  FACILITATOR, PAYER, PAY_TO, USDC_BASE_SEPOLIA,
  receiptWith, rpcReturning, submission, transferLog,
} from "./fixtures.js";

test("USDC addresses match Circle's published contract list", () => {
  assert.equal(USDC_BY_CHAIN_ID["8453"], "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(USDC_BY_CHAIN_ID["84532"], "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
});

test("a matching transfer verifies", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({})]));
  assert.deepEqual(await verifySettlement(submission(), rpc), { verified: true });
});

test("the payer is read from the transfer log, not the transaction sender", async () => {
  // EIP-3009: the facilitator broadcasts and pays gas, so tx.from is never the buyer.
  const rpc = rpcReturning(receiptWith([transferLog({ from: PAYER, to: PAY_TO })]));
  assert.deepEqual(await verifySettlement(submission({ payer: PAYER }), rpc), { verified: true });
  const spoofed = await verifySettlement(submission({ payer: FACILITATOR }), rpc);
  assert.deepEqual(spoofed, { verified: false, reason: "no Transfer log sent by payer" });
});

test("a wrong payTo is rejected and named", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({ to: FACILITATOR })]));
  assert.deepEqual(await verifySettlement(submission(), rpc), {
    verified: false, reason: "no Transfer log from payer to payTo",
  });
});

test("a wrong amount is rejected and named", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({ amount: "9999" })]));
  assert.deepEqual(await verifySettlement(submission({ amount: "10000" }), rpc), {
    verified: false, reason: "no Transfer log from payer to payTo for amount 10000",
  });
});

test("a transfer of the right shape on the wrong contract is rejected", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({ address: FACILITATOR })]));
  assert.deepEqual(await verifySettlement(submission(), rpc), {
    verified: false, reason: `no Transfer log for asset contract ${USDC_BASE_SEPOLIA}`,
  });
});

test("an explicit asset address overrides the symbolic USDC lookup", async () => {
  const token = "0x1111111111111111111111111111111111111111";
  const rpc = rpcReturning(receiptWith([transferLog({ address: token })]));
  assert.deepEqual(await verifySettlement(submission({ asset: token }), rpc), { verified: true });
});

test("an unknown symbolic asset has no contract to check against", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({})]));
  const result = await verifySettlement(submission({ asset: "dai" }), rpc);
  assert.deepEqual(result, { verified: false, reason: "no known contract for asset dai on chain 84532" });
});

test("a missing transaction is rejected", async () => {
  assert.deepEqual(await verifySettlement(submission(), rpcReturning(null)), {
    verified: false, reason: "transaction not found",
  });
});

test("a reverted transaction is rejected even with a matching log", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({})], "0x0"));
  assert.deepEqual(await verifySettlement(submission(), rpc), {
    verified: false, reason: "transaction did not succeed on chain",
  });
});

test("non-EVM networks are out of scope for 0.3", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({})]));
  for (const network of ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "eip155:not-a-number"]) {
    assert.deepEqual(await verifySettlement(submission({ network }), rpc), {
      verified: false, reason: "network not supported in 0.3",
    });
  }
});

test("the matching transfer is found among unrelated logs", async () => {
  const rpc = rpcReturning(receiptWith([
    { address: USDC_BASE_SEPOLIA, topics: ["0xdead"], data: "0x" },
    transferLog({ to: FACILITATOR, amount: "1" }),
    transferLog({}),
  ]));
  assert.deepEqual(await verifySettlement(submission(), rpc), { verified: true });
});

test("addresses compare case-insensitively", async () => {
  const rpc = rpcReturning(receiptWith([transferLog({})]));
  const result = await verifySettlement(
    submission({ payer: PAYER.toUpperCase().replace("0X", "0x"), payTo: PAY_TO.toLowerCase() }),
    rpc
  );
  assert.deepEqual(result, { verified: true });
});

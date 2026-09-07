import { expect, test } from "vitest";
import { NETWORK } from "../src/network";
import { verifySettlement } from "../src/verify";
import {
  SPL_TOKEN_PROGRAM, TOKEN_2022_PROGRAM, USDC_BY_SOLANA_NETWORK, verifySvmSettlement,
} from "../src/verify-svm";
import { PROOF } from "../src/vocab";
import {
  SOL_FEE_PAYER, SOL_OTHER, SOL_OTHER_ATA, SOL_OTHER_MINT, SOL_PAYER, SOL_PAYER_ATA,
  SOL_PAY_TO, SOL_PAY_TO_ATA, SOL_PAY_TO_ATA_2022, SOL_PAY_TO_ATA_OTHER_MINT,
  svmBalance, svmRpcReturning, svmSubmission, svmTransaction, svmTransfer,
} from "../src/fixtures";

/** What a transaction that credits nothing to payTo's own account is refused with. */
const noMatch = {
  verified: false,
  reason: `no transfer of ${USDC_BY_SOLANA_NETWORK[NETWORK.solanaDevnet]} to payTo's associated token account`,
};

/** Fails the test if verification reaches the chain at all. */
const noRpc = () => {
  throw new Error("verification should not have called the chain");
};

test("USDC mints match Circle's published list", () => {
  expect(USDC_BY_SOLANA_NETWORK[NETWORK.solanaMainnet]).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  expect(USDC_BY_SOLANA_NETWORK[NETWORK.solanaDevnet]).toBe("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
});

test("the token program ids match the programs' published addresses", () => {
  // Same reason the mints are pinned: a wrong constant here would not fail
  // loudly, it would refuse every honest payment on that program.
  expect(SPL_TOKEN_PROGRAM).toBe("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  expect(TOKEN_2022_PROGRAM).toBe("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
});

test("a matching top-level transferChecked verifies", async () => {
  const rpc = svmRpcReturning(svmTransaction({ instructions: [svmTransfer()] }));
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual({
    verified: true, proof: PROOF.paymentTraced, amount: "10000",
  });
});

test("a transfer found only in the CPI trace verifies", async () => {
  // A smart wallet (Squads, Swig) invokes the token program; the transfer is an
  // inner instruction and nothing at the top level looks like a payment at all.
  const rpc = svmRpcReturning(
    svmTransaction({
      instructions: [{ program: "squads", programId: SOL_OTHER, parsed: { type: "execute", info: {} } }],
      inner: [svmTransfer()],
    })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual({
    verified: true, proof: PROOF.paymentTraced, amount: "10000",
  });
});

test("two matching transfers are ambiguous rather than doubly good", async () => {
  const rpc = svmRpcReturning(
    svmTransaction({ instructions: [svmTransfer()], inner: [svmTransfer()] })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual({
    verified: false, reason: "ambiguous: multiple matching transfers",
  });
});

test("a transaction with no transfer to payTo is rejected", async () => {
  const rpc = svmRpcReturning(
    svmTransaction({ instructions: [svmTransfer({ destination: SOL_OTHER_ATA })] })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual({
    verified: false,
    reason: `no transfer of ${USDC_BY_SOLANA_NETWORK[NETWORK.solanaDevnet]} to payTo's associated token account`,
  });
});

test("a transfer of a different mint is rejected", async () => {
  const rpc = svmRpcReturning(
    svmTransaction({
      instructions: [svmTransfer({ mint: SOL_OTHER_MINT, destination: SOL_PAY_TO_ATA_OTHER_MINT })],
    })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual(noMatch);
});

test("a transfer naming the right mint into the wrong account is rejected", async () => {
  const rpc = svmRpcReturning(
    svmTransaction({ instructions: [svmTransfer({ destination: SOL_PAY_TO_ATA_OTHER_MINT })] })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual(noMatch);
});

test("payTo's Token-2022 account does not settle an SPL Token transfer", async () => {
  // The destination address commits to the token program, so the two cannot be
  // swapped: this is the §1.2 "correct token program" check doing its work.
  const rpc = svmRpcReturning(
    svmTransaction({ instructions: [svmTransfer({ destination: SOL_PAY_TO_ATA_2022 })] })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual(noMatch);
});

test("a transfer under an unknown program is not a token transfer", async () => {
  const rpc = svmRpcReturning(
    svmTransaction({ instructions: [svmTransfer({ programId: SOL_OTHER })] })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual(noMatch);
});

test("less than the required amount is rejected and named", async () => {
  const rpc = svmRpcReturning(svmTransaction({ instructions: [svmTransfer({ amount: "9999" })] }));
  expect(await verifySvmSettlement(svmSubmission({ amount: "10000" }), rpc)).toEqual({
    verified: false, reason: "transfer to payTo was for 9999, less than the required 10000",
  });
});

test("more than the required amount verifies, and the on-chain amount is what is recorded", async () => {
  // Overpayment is tolerated by the scheme for smart wallets; the review should
  // record what moved, not what was claimed.
  const rpc = svmRpcReturning(svmTransaction({ instructions: [svmTransfer({ amount: "12345" })] }));
  expect(await verifySvmSettlement(svmSubmission({ amount: "10000" }), rpc)).toEqual({
    verified: true, proof: PROOF.paymentTraced, amount: "12345",
  });
});

test("a bare transfer, which names no mint, is settled by the destination account", async () => {
  const rpc = svmRpcReturning(
    svmTransaction({ instructions: [svmTransfer({ type: "transfer" })] })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual({
    verified: true, proof: PROOF.paymentTraced, amount: "10000",
  });
});

test("a transfer with no authority is attributed through the token balances", async () => {
  const rpc = svmRpcReturning(
    svmTransaction({ instructions: [svmTransfer({ type: "transfer", authority: null })] })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual({
    verified: true, proof: PROOF.paymentTraced, amount: "10000",
  });
});

test("a failed transaction is rejected even with a matching transfer", async () => {
  const rpc = svmRpcReturning(
    svmTransaction({ instructions: [svmTransfer()], err: { InstructionError: [0, "Custom"] } })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual({
    verified: false, reason: "transaction did not succeed on chain",
  });
});

test("a missing transaction is rejected", async () => {
  expect(await verifySvmSettlement(svmSubmission(), svmRpcReturning(null))).toEqual({
    verified: false, reason: "transaction not found",
  });
});

test("the fee payer is not the buyer", async () => {
  // Solana's analogue of the EIP-3009 facilitator: the sponsor signs and pays
  // the fee, so a review claiming the fee payer paid is refused.
  const rpc = svmRpcReturning(svmTransaction({ instructions: [svmTransfer()] }));
  expect(await verifySvmSettlement(svmSubmission({ payer: SOL_FEE_PAYER }), rpc)).toEqual({
    verified: false,
    reason: `transfer was authorized by ${SOL_PAYER}, not by payer ${SOL_FEE_PAYER}`,
  });
});

test("paying yourself is refused before the chain is asked", async () => {
  expect(await verifySvmSettlement(svmSubmission({ payer: SOL_PAY_TO }), noRpc)).toEqual({
    verified: false, reason: "payer and payTo are the same account",
  });
});

test("an asset that is not a base58 address is refused before the chain is asked", async () => {
  for (const asset of ["USDC", "0x036CbD53842c5426634e7929541eC2318f3dCF7e"]) {
    expect(await verifySvmSettlement(svmSubmission({ asset }), noRpc)).toEqual({
      verified: false, reason: `asset must be a base58 address on ${NETWORK.solanaDevnet}`,
    });
  }
});

test("the balance delta settles a transaction whose CPI trace the node withheld", async () => {
  // §3.4: inner instructions unavailable, so the payment is inferred from the
  // destination's balance rather than from an instruction. Recorded as such.
  const rpc = svmRpcReturning(svmTransaction({ inner: null }));
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual({
    verified: true, proof: PROOF.receiptOnly, amount: "10000",
  });
});

test("the fallback still insists on the full amount", async () => {
  const rpc = svmRpcReturning(
    svmTransaction({
      inner: null,
      preTokenBalances: [svmBalance({ accountIndex: 2, amount: "0" })],
      postTokenBalances: [svmBalance({ accountIndex: 2, amount: "9999" })],
    })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual({
    verified: false,
    reason: `payTo's ${USDC_BY_SOLANA_NETWORK[NETWORK.solanaDevnet]} balance rose by 9999, less than the required 10000`,
  });
});

test("a credited balance is no substitute for a transfer when the trace was returned", async () => {
  // The delta is the fallback, not the rule: an empty trace is an answer, and a
  // balance that moved for some other reason must not stand in for a payment.
  const rpc = svmRpcReturning(svmTransaction({ instructions: [], inner: [] }));
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual(noMatch);
});

test("both cluster ids route to the Solana rule, and no other does", async () => {
  const reached = svmRpcReturning(null);
  for (const network of [NETWORK.solanaDevnet, NETWORK.solanaMainnet]) {
    const asset = USDC_BY_SOLANA_NETWORK[network]!;
    expect(await verifySettlement(svmSubmission({ network, asset }), reached)).toEqual({
      verified: false, reason: "transaction not found",
    });
  }
  const unknown = "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z";
  expect(await verifySettlement(svmSubmission({ network: unknown }), noRpc)).toEqual({
    verified: false, reason: "network not supported in 0.3",
  });
  expect(await verifySettlement(svmSubmission({ network: "sui:mainnet" }), noRpc)).toEqual({
    verified: false, reason: "network not supported in 0.3",
  });
});

test("a transfer someone else authorized is not the payer's payment", async () => {
  const rpc = svmRpcReturning(
    svmTransaction({
      instructions: [svmTransfer({ source: SOL_PAYER_ATA, authority: SOL_OTHER })],
    })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual({
    verified: false,
    reason: `transfer was authorized by ${SOL_OTHER}, not by payer ${SOL_PAYER}`,
  });
});

test("a Token-2022 transfer into payTo's Token-2022 account verifies", async () => {
  const rpc = svmRpcReturning(
    svmTransaction({
      instructions: [
        svmTransfer({ programId: TOKEN_2022_PROGRAM, destination: SOL_PAY_TO_ATA_2022 }),
      ],
    })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual({
    verified: true, proof: PROOF.paymentTraced, amount: "10000",
  });
});

test("an unrelated transfer alongside the payment does not make it ambiguous", async () => {
  // §1.3: extra instructions are allowed; only matching transfers are counted.
  const rpc = svmRpcReturning(
    svmTransaction({
      instructions: [svmTransfer({ destination: SOL_OTHER_ATA, amount: "5" }), svmTransfer()],
      inner: [{ program: "system", programId: SOL_OTHER, parsed: { type: "transfer", info: {} } }],
    })
  );
  expect(await verifySvmSettlement(svmSubmission(), rpc)).toEqual({
    verified: true, proof: PROOF.paymentTraced, amount: "10000",
  });
});

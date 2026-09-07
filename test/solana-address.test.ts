import { expect, test } from "vitest";
import {
  ASSOCIATED_TOKEN_PROGRAM, associatedTokenAddress, decodeBase58, decodePubkey,
  encodeBase58, isOnCurve, isPubkey,
} from "../src/verify/solana-address";
import {
  SOL_OTHER_ATA, SOL_OTHER, SOL_PAY_TO, SOL_PAY_TO_ATA, SOL_PAY_TO_ATA_2022,
  SOL_PAY_TO_ATA_OTHER_MINT, SOL_OTHER_MINT, USDC_SOLANA_DEVNET,
} from "../src/fixtures";
import { SPL_TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "../src/verify/svm";

test("the associated token account program id matches its published address", () => {
  // A seed of every ATA derived here, so a wrong value would derive addresses
  // that match nothing rather than fail in a way anyone would notice.
  expect(ASSOCIATED_TOKEN_PROGRAM).toBe("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
});

test("base58 round trips, including the leading zero bytes it encodes as '1'", () => {
  for (const address of [USDC_SOLANA_DEVNET, SOL_PAY_TO, ASSOCIATED_TOKEN_PROGRAM]) {
    expect(encodeBase58(decodePubkey(address)!)).toBe(address);
  }
  expect(encodeBase58(new Uint8Array(32))).toBe("1".repeat(32));
  expect(decodeBase58("1".repeat(32))).toEqual(new Uint8Array(32));
  expect(encodeBase58(Uint8Array.of(0, 0, 1))).toBe("112");
});

test("characters outside the alphabet are refused rather than misread", () => {
  // 0, O, I and l are left out of base58 precisely because they are confusable.
  for (const value of ["0OIl", "not base58!", ""]) expect(decodeBase58(value)).toBeUndefined();
  expect(isPubkey("deadbeef")).toBe(false);
  expect(isPubkey(`${USDC_SOLANA_DEVNET}x`)).toBe(false);
  expect(isPubkey(USDC_SOLANA_DEVNET)).toBe(true);
});

test("a public key is a curve point and a derived address is not", () => {
  // This is the whole of what makes a PDA a PDA: no private key can exist for it.
  expect(isOnCurve(decodePubkey(SOL_PAY_TO)!)).toBe(true);
  expect(isOnCurve(decodePubkey(SOL_PAY_TO_ATA)!)).toBe(false);
});

test("associated token addresses match the ones @solana/spl-token derives", async () => {
  expect(await associatedTokenAddress(SOL_PAY_TO, USDC_SOLANA_DEVNET, SPL_TOKEN_PROGRAM))
    .toBe(SOL_PAY_TO_ATA);
  expect(await associatedTokenAddress(SOL_OTHER, USDC_SOLANA_DEVNET, SPL_TOKEN_PROGRAM))
    .toBe(SOL_OTHER_ATA);
  expect(await associatedTokenAddress(SOL_PAY_TO, SOL_OTHER_MINT, SPL_TOKEN_PROGRAM))
    .toBe(SOL_PAY_TO_ATA_OTHER_MINT);
});

test("the same owner and mint give a different account under each token program", () => {
  // The token program is a property of the mint, so the address has to commit to it.
  expect(SOL_PAY_TO_ATA_2022).not.toBe(SOL_PAY_TO_ATA);
  return expect(associatedTokenAddress(SOL_PAY_TO, USDC_SOLANA_DEVNET, TOKEN_2022_PROGRAM))
    .resolves.toBe(SOL_PAY_TO_ATA_2022);
});

test("an address that is not 32 bytes derives nothing", async () => {
  expect(await associatedTokenAddress("nope", USDC_SOLANA_DEVNET, SPL_TOKEN_PROGRAM)).toBeUndefined();
  expect(await associatedTokenAddress(SOL_PAY_TO, "1", SPL_TOKEN_PROGRAM)).toBeUndefined();
});

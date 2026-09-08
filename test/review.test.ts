import { expect, test } from "vitest";
import { ReviewSubmission } from "../src/review";
import { SOL_PAYER, SOL_PAY_TO, submission, svmSubmission } from "../src/fixtures";
import { NETWORK } from "../src/network";
import { OUTCOME, REASON, RECOVERY } from "../src/vocab";

/** Asserts the schema refuses a body, naming the check that failed. */
const rejects = (body: unknown, reason: RegExp) => {
  const result = ReviewSubmission.safeParse(body);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")).toMatch(reason);
  }
};

test("a well-formed submission round trips", () => {
  const parsed = ReviewSubmission.parse({ ...submission(), taskClass: "search", note: "clean answer", paidMs: 42 });
  expect(parsed.taskClass).toBe("search");
  expect(parsed.note).toBe("clean answer");
  expect(parsed.paidMs).toBe(42);
});

test("unlabeled is not a publishable verdict", () => {
  rejects({ ...submission(), outcome: "unlabeled" }, /outcome/);
});

test("a settlement is required to have something to verify", () => {
  rejects({ ...submission(), transaction: undefined }, /transaction/);
  rejects({ ...submission(), payer: undefined }, /payer/);
  rejects({ ...submission(), transaction: "0xabc" }, /32-byte hex hash/);
  rejects({ ...submission(), payer: "not-an-address" }, /20-byte hex address/);
});

test("a failure has to say why, in a word from the closed set", () => {
  rejects({ ...submission(), outcome: OUTCOME.notUseful },
    /reason: is required when outcome is `not_useful`/);
  rejects({ ...submission(), outcome: OUTCOME.notUseful, reason: "just bad" }, /reason/);
  expect(ReviewSubmission.safeParse(
    { ...submission(), outcome: OUTCOME.notUseful, reason: REASON.wrong }).success).toBe(true);
});

test("a success has nothing to explain, so a reason on one is refused", () => {
  // "It worked" is not a finding about anything.
  rejects({ ...submission(), outcome: OUTCOME.useful, reason: REASON.wrong },
    /reason: must be absent when outcome is `useful`/);
});

test("the four old labels are refused by name, not as an invalid option", () => {
  for (const retired of ["used", "retried", "discarded", "failed"]) {
    rejects({ ...submission(), outcome: retired },
      new RegExp(`\\\`${retired}\\\` is no longer an outcome`));
  }
  rejects({ ...submission(), outcome: "unlabeled" }, /must be `useful` or `not_useful`/);
});

test("recovery is a separate axis, optional and never an outcome", () => {
  // Retrying and going elsewhere are both recovery from the same failure.
  const failed = { ...submission(), outcome: OUTCOME.notUseful, reason: REASON.empty };
  for (const recovery of Object.values(RECOVERY)) {
    expect(ReviewSubmission.safeParse({ ...failed, recovery }).success, recovery).toBe(true);
  }
  expect(ReviewSubmission.safeParse({ ...failed, recovery: "gave_up" }).success).toBe(false);
  // Absent is fine everywhere, including on a success.
  expect(ReviewSubmission.safeParse(submission()).success).toBe(true);
});

test("a resource URL still carrying a query string or fragment is rejected", () => {
  rejects({ ...submission(), resourceUrl: "https://api.test/paid?key=secret" }, /query string and fragment/);
  rejects({ ...submission(), resourceUrl: "https://api.test/paid#top" }, /query string and fragment/);
  rejects({ ...submission(), resourceUrl: "/paid" }, /absolute URL/);
});

test("amounts stay atomic decimal strings", () => {
  rejects({ ...submission(), amount: "0.01" }, /atomic units/);
  rejects({ ...submission(), amount: "1e4" }, /atomic units/);
  expect(ReviewSubmission.parse({ ...submission(), amount: "0" }).amount).toBe("0");
});

test("the envelope is checked before anything else", () => {
  rejects(null, /./);
  rejects([submission()], /./);
  rejects({ ...submission(), schema: 2 }, /schema/);
  rejects({ ...submission(), ts: "whenever" }, /ISO 8601/);
});

test("fields the client keeps to itself are rejected rather than silently dropped", () => {
  rejects({ ...submission(), id: "local-only" }, /id/);
  rejects({ ...submission(), legs: [{ kind: "paid" }] }, /legs/);
  rejects({ ...submission(), status: 200 }, /status/);
});

test("a symbolic asset name is no longer accepted", () => {
  rejects({ ...submission(), asset: "usdc" }, /asset: must be a 20-byte hex address/);
});

test("free text is bounded", () => {
  rejects({ ...submission(), note: "x".repeat(501) }, /note/);
  rejects({ ...submission(), taskClass: "x".repeat(65) }, /taskClass/);
});

test("a payer cannot review a payment to itself", () => {
  const payer = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
  rejects({ ...submission(), payer, payTo: payer }, /payer and payTo are the same address/);
  // Casing is not a way around it.
  rejects({ ...submission(), payer, payTo: payer.toLowerCase() }, /payer and payTo are the same address/);
  rejects({ ...submission(), payer: payer.toLowerCase(), payTo: payer.toUpperCase().replace("0X", "0x") },
    /payer and payTo are the same address/);
  // Distinct addresses still pass.
  expect(ReviewSubmission.safeParse(submission()).success).toBe(true);
});

test("a network is normalized to CAIP-2 rather than refused over spelling", () => {
  const network = (value: string, base = submission()) =>
    ReviewSubmission.parse({ ...base, network: value }).network;

  expect(network("base-sepolia")).toBe(NETWORK.baseSepolia);
  expect(network("Base-Mainnet")).toBe(NETWORK.baseMainnet);
  expect(network("solana-mainnet-beta", svmSubmission())).toBe(NETWORK.solanaMainnet);
  expect(network("solana:devnet", svmSubmission())).toBe(NETWORK.solanaDevnet);
  expect(network("solana", svmSubmission())).toBe(NETWORK.solanaMainnet);
  // A chain with no verifier is normalized all the same, and refused later for
  // want of an endpoint rather than for how it was spelled.
  expect(network("polygon")).toBe("eip155:137");
  expect(network("bsc")).toBe("eip155:56");
  // An id that already is CAIP-2 passes through untouched, casing included:
  // the Solana half of one is base58, where case is a digit.
  expect(network(NETWORK.solanaMainnet, svmSubmission())).toBe(NETWORK.solanaMainnet);
});

test("a network belonging to no known family is refused", () => {
  rejects({ ...submission(), network: "sui:mainnet" }, /eip155 or solana/);
  rejects({ ...submission(), network: "nonsense" }, /eip155 or solana/);
});

test("accounts and settlements are spelled the way their own network spells them", () => {
  rejects({ ...svmSubmission(), payer: submission().payer }, /payer: must be a base58 account address/);
  rejects({ ...svmSubmission(), asset: submission().asset }, /asset: must be a base58 account address/);
  rejects({ ...svmSubmission(), transaction: submission().transaction },
    /transaction: must be a base58 transaction signature/);
  rejects({ ...submission(), payer: SOL_PAYER }, /payer: must be a 20-byte hex address/);
  expect(ReviewSubmission.safeParse(svmSubmission()).success).toBe(true);
});

test("a Solana settlement is a 64-byte signature, not merely base58", () => {
  // An account address is base58 too, and is not a signature.
  rejects({ ...svmSubmission(), transaction: SOL_PAYER }, /base58 transaction signature/);
});

test("a payer cannot review a payment to itself on Solana either", () => {
  rejects({ ...svmSubmission(), payer: SOL_PAY_TO }, /payer and payTo are the same address/);
});

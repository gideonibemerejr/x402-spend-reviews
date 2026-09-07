# x402-spend — research method, run 001

Written 2026-09-06

Written before any mainnet payment, so I can't adjust the standard to fit the result.

## The question

Does an endpoint being *reachable, compliant and well-graded* predict that it is *worth
paying for*?

Everything published about x402 endpoints today is measured from outside: uptime probes,
402-envelope compliance, price stability, on-chain settlement volume. Nothing measures
whether the buyer got what they paid for. This run tests whether the outside measures
predict the inside one.

**Prediction, stated before the run:** they will not fully predict it. Some share of
endpoints that pass every external check will return responses a buyer cannot use. I expect
that share to be non-trivial. If it turns out to be zero, that is the finding and I publish
it as such.

## Three axes, three batches, one report

I run these as separate batches so that a quality label is never a side effect of testing
whether the plumbing works.

### Axis 1 — Coverage
*Can I verify a payment on the networks that matter?*

Target networks, by listed endpoints (source: x402.fuchss.app/network, read 2026-09-06):
Base 38,541 · Solana 1,619 · Base Sepolia 453 · Avalanche 261 · Arbitrum 92 · BNB 14.

- Solana: new verifier.
- Avalanche, Arbitrum, BNB: EVM, so config only — USDC contract address and RPC per chain.
- Deliverable: one verified review on each network, with tx hash.
- I also normalise the network-name aliases that show up in the wild (`solana:mainnet`,
  `solana-mainnet`, `solana-mainnet-beta`, `base-mainnet`, bare `polygon` / `bsc`) to CAIP-2
  rather than rejecting a payment over spelling.

### Axis 2 — Reach
*Of the endpoints I select, how many can actually take a payment?*

This isn't a re-run of the ecosystem probe study that already exists. It's a check that the
same pattern holds on my sample, measured by payment rather than by probe.

- For every endpoint I attempt, I record: reachable, returned a well-formed 402, payment
  settled, response returned.
- Deliverable: a count. "Of N endpoints attempted, M returned a valid 402, K settled a
  payment, J returned a response."
- Reference point I cite rather than reproduce: of 72,395 listed endpoints, x402 Trust
  reports 51% unreachable, 23% of reachable ones non-compliant, and 67.8% of pay-to wallets
  having ever received a payment.

### Axis 3 — Quality
*Of the endpoints that are up, compliant and well-graded, how many returned something I
could use?*

This is the finding. Everything above exists to make it credible.

- Sample frame: x402 Trust's top-25 leaderboard — their highest-graded endpoints — filtered
  to categories where I can check the answer. Using their leaderboard is deliberate: I want
  to test the best case, not a random sample.
- Deliverable: labeled outcomes with tx hashes, published, re-verifiable by anyone.
- **Exclusion:** reviews where the payment could only be confirmed as *recipient credited*
  rather than *payment traced* are excluded from the quality findings, because the payer
  isn't attributable on that path. They still appear in the published dataset, marked, and
  they still count for Axis 1 and Axis 2. This path only occurs under node indexing lag, so
  I expect it to be rare; if it isn't, that itself goes in the report.

## The labeling rule (written once, applied to every call)

**`used` means the response answered the question I wrote down before I paid.**

Before each call I record one line: what I'm asking for, and what a correct answer looks
like. Then:

- `used` — I got what I asked for and could act on it
- `discarded` — it responded, but the answer was wrong, empty, or useless for what I asked
- `retried` — I had to call again, or call somewhere else, to get the answer
- `failed` — no response, an error, or I paid and got nothing

The pre-written expected answer is what makes the dataset defensible. Without it the label is
my mood.

## Category selection (the checkability rule)

**I only buy from endpoints whose answers I can independently check.** A guess in the dataset
is worse than an absence.

In scope, anchor category first:

- **Geocoding** — venue names and addresses from The Blueprint, where I already have the
  coordinates. The cleanest category I have: the correct answer exists before I ask. Public
  venue names and addresses only. **No user-account data from Blueprint's ~80k registrants,
  ever.**
- **Web search** — queries on topics where I can judge relevance without expertise.
- **Weather** — a location whose conditions I can observe directly.
- **Price / market lookups** — verifiable against a public source in seconds.

Out of scope for run 001: trading signals, DeFi yield analysis, whale movements, "insights" —
anything where grading the answer needs domain expertise I don't have. I exclude them because
my label would be a guess, not because the endpoints are bad, and I say so in the report.

Three or four categories at roughly ten calls each, rather than thirty of one. Thirty geocode
calls would prove geocoding endpoints work; it wouldn't test whether grades predict quality
across the board.

## Protocol

1. Freeze the sample. Pull the leaderboard and record it — endpoint, grade, score, price,
   network — *before* I pay anyone. The list doesn't change once the run starts.
2. Write the question and the expected answer for each call, in advance, one line each.
3. Pay. One call per endpoint, same dedicated wallet throughout.
4. Label immediately, against what I wrote down. No re-labeling later to tidy the dataset; if
   a label does change, I record that it changed and why.
5. Publish every row, including the ones where the endpoint did fine.

## Wallet and spend

A dedicated run wallet per network family, funded with a few dollars and nothing more. Key in
the password manager first, `.env` second, deleted after. Never in a handoff, a chat, or a
repo. `maxAmountPerPayment` set as a hard ceiling. At typical prices, around a cent or two a
call, the whole run comes in under $5.

## What would falsify my prediction

If every endpoint on the leaderboard returns a usable answer, the finding is that external
grades *do* predict quality, and x402-spend is narrower than I've been assuming — closer to
spend accounting than to a quality signal. I publish that in the same words as any other
result. Saying so in advance is what makes this an experiment instead of a marketing
exercise.

## Known limits, stated in the report

- Single reviewer, single judgment. One rater, no inter-rater check.
- Small n per category.
- The sample is the best-graded endpoints, so nothing here generalises to the whole directory.
- Latency measured from one location.
- I chose categories for checkability, and checkability correlates with simplicity. The
  hardest endpoints to grade are also where quality problems are most likely to hide.
- I built the tool this finding argues for, so my bias runs toward finding a gap. The
  pre-registered prediction and the falsification clause above are the only guards against
  that, plus publishing every row so anyone can re-check my work.

## Outputs

- The dataset, public, CC BY 4.0, at x402-spend-reviews — every row re-verifiable against the
  chain by tx hash.
- One report covering all three axes. The headline is Axis 3; Axes 1 and 2 are what make it
  credible.
- A message to x402 Trust with the finding, framed as complementary: they measure whether an
  endpoint is alive, this measures whether it delivered.
- A message to Orthogonal with the same finding, since routing on price and availability has
  the same blind spot.

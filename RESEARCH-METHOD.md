# x402-spend — research method, run 001

Written 2026-09-06

Written before any mainnet payment, so I can't adjust the standard to fit the result.

## The question

Does an endpoint being _reachable, compliant and well-graded_ predict that it is _worth
paying for_?

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

_Can I verify a payment on the networks carrying the most endpoints?_

I rank by endpoint count because it's the number I can cite. Solana leads on daily transactions, though, so this sample skews toward where endpoints are listed rather than where payments actually happen.

Target networks, by listed endpoints (source: x402.fuchss.app/network, read 2026-09-06):
Base 38,541 · Solana 1,619 · Base Sepolia 453 · Avalanche 261 · Arbitrum 92 · BNB 14.

- Solana: new verifier.
- Avalanche, Arbitrum, BNB: EVM, so config only — USDC contract address and RPC per chain.
- Deliverable: one verified review on each network, with tx hash.
- I also normalize the network-name aliases that show up in the wild (`solana:mainnet`,
  `solana-mainnet`, `solana-mainnet-beta`, `base-mainnet`, bare `polygon` / `bsc`) to CAIP-2
  rather than rejecting a payment over spelling.

### Axis 2 — Reach

_Of the endpoints I select, how many can actually take a payment?_

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

_Of the endpoints that are up, compliant and well-graded, how many returned something I
could use?_

This is the finding. Everything above exists to make it credible.

- Sample frame: x402 Trust's top-25 leaderboard — their highest-graded endpoints — filtered
  to categories where I can check the answer. Using their leaderboard is deliberate: I want
  to test the best case, not a random sample.
- Deliverable: labeled outcomes with tx hashes, published, re-verifiable by anyone.
- **Exclusion:** reviews where the payment could only be confirmed as _recipient credited_
  rather than _payment traced_ are excluded from the quality findings, because the payer
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
  venue names and addresses only. **No user-account data from Blueprint's registrants,
  ever.**

  **Forward geocoding (name + address in, coordinates out), 8 Blueprint venues:**
  - `used` if the returned point is within 100 meters of the coordinate I already hold for
    that venue. `discarded` beyond that, or if it returns a point in the wrong city.
  - 100 m absorbs the legitimate difference between a building centroid, a street entrance
    and a parcel center without letting a wrong-block answer through. My reference
    coordinates are not survey-grade either; they are what the platform used in production.

  **Reverse geocoding (coordinates in, address out), 8 different Blueprint venues:**
  - `used` if the street number and street name match the address I hold, ignoring
    formatting differences (abbreviations, casing, suite numbers, ZIP+4). `discarded` if
    either differs, or if it returns a neighboring address.
  - A returned business name is a bonus, not part of the pass condition.

- **Web search** — checkable in the strict sense first, in a judgmental sense second. Both
  standards run against the same search providers, which is how I spread across endpoints
  rather than across topics.

  **Known-answer lookups:**
  - Factual queries where the answer is fixed and I can verify it — World Cup goal scorers,
    the year a named venue opened, anything checkable against a public source in seconds.
  - `used` if the correct answer is present and correct in the results. `discarded` if it's
    absent, or if the results assert something wrong.
  - Queries spread across four difficulty tiers, two each, because a failure means something
    different in each: **easy and famous** (baseline coverage), **specific but public**
    (index depth), **recent** (index freshness), **precise numeric** (returns the value, not
    pages that might contain it).
  - A query only belongs here if I wouldn't have to argue about whether a returned answer is
    right. If "famous" or "best" appears, or the subject is ambiguous (two people with the
    same name), it moves to relevance or gets dropped.
  - I verify each expected answer against a source at grading time, not from memory.

  **Web search relevance:**
  - Open queries where there's no single right answer, graded on whether the results are
    on-topic and current. `used` if on-topic and current enough to act on; `discarded` if
    off-topic, stale, or empty. This is the softer standard and I label it as such.

- **Weather** — a location whose conditions I can observe directly. `used` if the value is
  correct at the time of the call, within the endpoint's own advertised resolution.
  `discarded` if wrong, for the wrong location, or materially stale.

- **Price / market lookups** — verifiable against a public source in seconds. `used` if
  within 1% of spot at call time, `discarded` otherwise. Crypto rather than equities, because
  it trades 24/7 and there's no market-hours ambiguity.

Out of scope for run 001: trading signals, DeFi yield analysis, whale movements, "insights" —
anything where grading the answer needs domain expertise I don't have. I exclude them because
my label would be a guess, not because the endpoints are bad.

### Sample shape

Roughly eight calls per category, spread across at least three or four **distinct endpoints**
per category where the frozen leaderboard supports it. Eight calls to one geocoder tests that
geocoder; eight calls across four tests whether the grade predicts quality, which is the
actual question. If a category has fewer graded endpoints than that, I shrink the category
rather than padding it with repeat calls to the same place, and I report the endpoint count
alongside the call count.

### Trial calls

Some catalogs offer a free trial call. Where one exists I use it once before paying, only to
confirm the endpoint is alive and returns parseable data — never to preview the answer I am
about to grade. The paid call is the one that gets reviewed. I record which endpoints were
trial-checked first.

## Protocol

1. Freeze the sample. Pull the leaderboard and record it — endpoint, grade, score, price,
   network — _before_ I pay anyone. The list doesn't change once the run starts.
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
grades _do_ predict quality, and x402-spend is narrower than I've been assuming — closer to
spend accounting than to a quality signal. I publish that in the same words as any other
result. Saying so in advance is what makes this an experiment instead of a marketing
exercise.

## Known limits

- Single reviewer, single judgment. One rater, no inter-rater check.
- Small n per category.
- The sample is the best-graded endpoints, so nothing here generalizes to the whole directory.
- Latency measured from one location.
- I chose categories for checkability, and checkability correlates with simplicity. The
  hardest endpoints to grade are also where quality problems are most likely to hide.
- My own recall is part of the instrument. I grade against a source at grading time rather
  than from memory, but a mis-specified expected answer is still possible, and I flag any
  call where I had to correct one.
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

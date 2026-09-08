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

**Secondary prediction, about the shape of the failures:** most of what I find will be
mechanically detectable — `empty`, `malformed`, `insufficient`, `no_response` — and
**`wrong` will be rare, or hard to catch.** Confidently incorrect answers are the failure I
expect to be hardest to surface.

If that holds it is the more interesting result, because small and invisible is a worse
problem than large and obvious: a `wrong` answer is the one that propagates into whatever the
agent produces. And note the bias it runs against — my checkability rule deliberately selects
for conditions where `wrong` *can* be caught, since I only buy where I already know the right
answer. A real buyer usually doesn't. So if `wrong` stays rare even under conditions optimized
to detect it, then in production it is effectively undetectable by a single buyer, and only
corroboration across buyers could surface it.

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

- Sample frame: x402 Trust's **grade A** endpoints, sampled across **distinct providers**,
  filtered to categories where I can check the answer. Sampling their top grade is
  deliberate: I want to test the best case, not a random sample.
- I do not use their top-25 leaderboard, even though it is the obvious frame. Every one of
  the visible top ten is a proxy route on a single host, so a sample drawn from it would
  measure one provider rather than whether a grade predicts quality.
- The obvious version of this question is already answered and I don't re-ask it. x402 Trust
  publishes the grade distribution — 36.4% of monitored endpoints grade F, 16.3% grade A — so
  "most endpoints are bad" is public knowledge. The open question is the narrow one: **of the
  endpoints that grade A, how many deliver.**
- Deliverable: labeled outcomes with tx hashes, published, re-verifiable by anyone.
- **Exclusion:** reviews where the payment could only be confirmed as _recipient credited_
  rather than _payment traced_ are excluded from the quality findings, because the payer
  isn't attributable on that path. They still appear in the published dataset, marked, and
  they still count for Axis 1 and Axis 2. This path only occurs under node indexing lag, so
  I expect it to be rare; if it isn't, that itself goes in the report.

## The labeling rule (written once, applied to every call)

There are two outcomes, not four:

1. **The response gave me what I wrote down before I paid.**
2. **It didn't.**

Everything else — whether I retried, went elsewhere, or gave up — is what happened *after*
outcome 2, not a third outcome. Retrying and discarding are both recovery from the same
failure and both cost money.

Before each call I record one line: what I'm asking for, and what a correct answer looks like.
Then I ask one question of the response: **did it give me that?**

**Cost per useful result is spend ÷ count of outcome 1.** Everything spent reaching outcome 2
is waste, however I recovered.

The pre-written expected answer is what makes the dataset defensible. Without it the label is
my mood.

### Reasons, for outcome 2 only

Outcome 1 needs no reason — "it worked" is not a finding about anything. Outcome 2 gets a
short code from a fixed set, so that reasons aggregate across calls rather than describing one:

| code | meaning |
|---|---|
| `no_response` | transport error, timeout, or non-2xx after payment |
| `empty` | well-formed, and nothing in it |
| `malformed` | didn't match the advertised shape |
| `wrong` | well-formed, plausible, and incorrect |
| `stale` | correct once, out of date now |
| `insufficient` | right kind of answer, not enough of it |

Plus an optional free-text note, so the specific detail survives without polluting the codes.

The distinction between `wrong`, `empty` and `malformed` is the distinction between an endpoint
that is broken and one that is lying. Those are different findings about a seller and I don't
collapse them into a single failure rate.

### Why the labeling is by hand

Not because automation isn't ready. **The human correction is the signal the tool is built to
capture.** In production, the label arrives when whoever the agent serves says "that's wrong,"
and the agent relays it. Doing it by hand here is a faithful instance of the primary signal,
not a stopgap — with the expected answer written first, so the correction is grounded rather
than a reaction.

That is also why these labels are the reference set: any automatic labeler built later gets
validated against them, and its agreement rate published alongside anything it computes.
Validating a labeler against itself would prove nothing.

## Category selection (the checkability rule)

**I only buy from endpoints whose answers I can independently check.** A guess in the dataset
is worse than an absence.

In scope, anchor category first:

- **Geocoding** — venue names and addresses from The Blueprint, where I already have the
  coordinates. The cleanest category I have: the correct answer exists before I ask. Public
  venue names and addresses only. **No user-account data from Blueprint's registrants,
  ever.**

  **Forward geocoding (name + address in, coordinates out), 8 Blueprint venues:**
  - Outcome 1 if the returned point is within 100 meters of the coordinate I already hold for
    that venue. Outcome 2 beyond that, or if it returns a point in the wrong city.
  - 100 m absorbs the legitimate difference between a building centroid, a street entrance
    and a parcel center without letting a wrong-block answer through. My reference
    coordinates are not survey-grade either; they are what the platform used in production.

  **Reverse geocoding (coordinates in, address out), 8 different Blueprint venues:**
  - Outcome 1 if the street number and street name match the address I hold, ignoring
    formatting differences (abbreviations, casing, suite numbers, ZIP+4). Outcome 2 if either
    differs, or if it returns a neighboring address.
  - A returned business name is a bonus, not part of the pass condition.

- **Web search** — checkable in the strict sense first, in a judgmental sense second. Both
  standards run against the same search providers, which is how I spread across endpoints
  rather than across topics.

  **Known-answer lookups:**
  - Factual queries where the answer is fixed and I can verify it — World Cup goal scorers,
    the year a named venue opened, anything checkable against a public source in seconds.
  - Outcome 1 if the correct answer is present and correct in the results. Outcome 2 if it's
    absent (`empty` or `insufficient`), or if the results assert something wrong (`wrong`).
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
    on-topic and current. Outcome 1 if on-topic and current enough to act on; outcome 2 if
    off-topic (`wrong`), out of date (`stale`), or empty (`empty`). This is the softer standard and I label it as such.

- **Weather** — a location whose conditions I can observe directly. Outcome 1 if the value is
  correct at the time of the call, within the endpoint's own advertised resolution. Outcome 2
  if wrong (`wrong`), for the wrong location (`wrong`), or materially out of date (`stale`).

- **Price / market lookups** — verifiable against a public source in seconds. Outcome 1 if
  within 1% of spot at call time, outcome 2 (`stale` or `wrong`) otherwise. Crypto rather than equities, because
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

1. Freeze the sample. Pull the grade A endpoints across distinct providers and record them —
   endpoint, grade, score, price, network — _before_ I pay anyone. The list doesn't change once
   the run starts.
2. Write the question and the expected answer for each call, in advance, one line each, and
   commit that file before any payment. The expected answers exist in git before the run, so
   nobody has to take my word for when they were written.
3. Pay. One call per endpoint, same dedicated wallet throughout.
4. Label immediately, against what I wrote down: outcome 1 or 2, plus a reason code and an
   optional note when it's 2. No re-labeling later to tidy the dataset; if a label does change,
   I record that it changed and why.
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

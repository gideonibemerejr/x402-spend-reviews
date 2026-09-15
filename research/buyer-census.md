# Buyer census — Base

**Status: Base only, v2 frame. Arbitrum, Avalanche and Solana not scanned — awaiting Gideon's go.**
Read-only: `eth_getLogs` only, no payments, no writes to D1. Nothing published.

**This is not part of run 001 and does not ship with it.** Different question, different method,
different frame. Nothing here was pre-registered, no hypothesis was declared before the data was
pulled, and none of run 001's pre-registration claims apply to any number on this page. It stands
or falls on its own, published separately and later. Bundling it with the run would invite a
reader to extend the run's guarantees to data that never had them.

## What changed from v1

v1 scanned the 9 seller addresses run-001 happened to pay. v2 scans **1,115 Base sellers** from
the public catalogue. v1's numbers are retained below, relabelled as the narrow frame; they were
not wrong, they were answering a much smaller question.

## Method

1. **Seller set.** Every `payTo` on `eip155:8453` in the CDP Bazaar discovery catalogue
   (`https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`, public, no key), pulled
   in full: 15,583 resources across 156 pages → **1,115 distinct Base `payTo` addresses**, all
   quoting USDC. Saved to `research/base-seller-set.json`.
2. **Scan.** USDC `Transfer` logs filtered by `topics[2]` against all 1,115 addresses at once,
   over the trailing 30 days (blocks 50,039,151–51,335,151).
3. **Group by payer.** Each distinct `topics[1]` — the Transfer `from` — is one buyer.
   **Never `tx.from`**: v1 sampled 400 transactions and found the sender differed in 400 of 400.

### Why not Etherscan

The v2 handoff specified Etherscan's unified API on the premise that one free key covers Base,
Arbitrum and Avalanche. **That premise is wrong.** The docs list Base and Avalanche as paid-plan
chains, and a live call with our key confirms it:

> `chainid=8453` → `"Free API access is not supported for this chain. Please upgrade your api plan"`
> `chainid=43114` → same. `chainid=42161` (Arbitrum) → works.

So Base ran on the node. That is also the better tool here for a reason the handoff did not
anticipate: `eth_getLogs` accepts an **array** of `topic2` values, so all 1,115 sellers ride in a
single filter, whereas Etherscan's `topic2` takes one value and would need one call per seller per
range. The node method got cheaper as the frame got wider, not more expensive.

**Arbitrum and Avalanche will need a paid Etherscan plan or a node.** That is Gideon's call.

## Completeness — what was verified

| Check | Result |
|---|---|
| **Ground truth** — run-001's own Base settlements must appear | **21 / 21 found** |
| Unresolved block ranges | **0** of 649 (676 adaptive splits) |
| Head freshness guard (v1 was burned by a 37h-stale head) | head stale by < 600s, else the scan aborts |
| Block→timestamp formula, checked at 4 depths | exact, 0s drift at all four |
| Truncation test — whole range vs sum of halves | 3 of 3 matched exactly |

`mainnet.base.org` **errors rather than truncating** when a response is too large: a deep
2,000-block window across 1,115 addresses returns HTTP 500, while the same window in 500-block
pieces returns 2,694 logs. The scanner therefore splits a failing range recursively rather than
recording it as empty — the v1 failure mode, closed.

## Frame

| | |
|---|---|
| Chain | Base, `eip155:8453` |
| Window | 30.0 days, ending 2026-09-15T08:07:29Z |
| Seller addresses | **1,115** (v1: 9) |
| Asset | USDC only |
| Settlements | **5,049,516** |
| Distinct payers | **10,167** (v1: 356) |

## THE AGGREGATOR FINDING

**The v1 single-seller figure was an artifact, and correcting it inverts the conclusion.**

A payer that pays one `payTo` is not a payer that used one service — that `payTo` may front
hundreds of endpoints. Counting catalogue resources behind each address:

| | Share of payers |
|---|---|
| Paid exactly one `payTo` (**raw**) | **89.4%** |
| …whose `payTo` fronts ≥2 resources | 78.6% |
| …whose `payTo` fronts ≥6 resources | 52.7% |
| …whose `payTo` fronts ≥21 resources | 28.9% |
| **…whose `payTo` fronts exactly 1 resource (true single-service)** | **10.8%** |

**The raw 89.4% overstates single-service behaviour by 78.6 points.** Only about one payer in ten
can only ever have reached a single service. Services reachable per payer:

| Services reachable | Payers | % |
|---|---|---|
| 1 | 1,096 | 10.8% |
| 2–5 | 2,675 | 26.3% |
| 6–20 | 2,530 | 24.9% |
| 21–100 | 3,247 | 31.9% |
| 101+ | 618 | 6.1% |

Two caveats that keep this honest. First, "reachable" is capacity, not observed use — the chain
shows a payment to an aggregator, not which endpoint behind it was called. Second, the named
aggregators do **not** behave as single fronts: Orthogonal appears under 23 distinct `payTo`
addresses and x402atlas under 22, so the router hypothesis is real but messier than "one address,
many services".

Comparison *is* happening at the wider frame — 85 payers touched ≥20 distinct `payTo` addresses,
and the broadest touched **630**. Not one of those was visible in v1's 9-seller frame.

## Distribution and concentration

One address pair accounts for most of the dataset and is reported separately. The ledger shows
**`0x2b4ee3387008e5ff1a9996fc8b48d2fd61389037` sent 4,412,388 settlements to
`0xe9030014f5dae217d0a152f02a043567b16c1abf` (a `payTo` listed in the catalogue under
blockrun.ai) — 87.4% of all settlements in the frame**, totalling $58,905 across 17 active days,
an average of ~260,000 per active day. Those are the figures the chain carries; this page makes no
claim about what the payments were for, or about either party.

A single pair at 87.4% determines the shape of any distribution it is included in, so the table
below excludes it, and excludes our own wallet.

| Payments | Payers | % payers | Settlements | % settlements |
|---|---|---|---|---|
| 1 | 1,993 | 19.6% | 1,993 | 0.3% |
| 2–5 | 3,711 | 36.5% | 14,433 | 2.3% |
| 6–20 | 2,738 | 26.9% | 29,851 | 4.7% |
| 21–100 | 1,125 | 11.1% | 49,622 | 7.8% |
| 100+ | 598 | 5.9% | 541,205 | **84.9%** |

Median 5 payments per payer, mean 62.7. Concentration excluding the dominant pair: top 10 payers
38.2%, top 1% (102 payers) 65.0%. **Including** it: top 10 = 92.0%. Both numbers are true; the
second is mostly the single pair above, which is why both are given.

Repeat rate: 3,540 payers (34.8%) active on more than one day. Recency: 9.9% seen within 24h of
window end, 37.5% within 1–7 days, 52.6% 7–30 days.

## Sweep signature

Criteria, stated so they can be argued with: **15–60 settlements, ≥7 distinct `payTo`, ≤3 active
days**. **23 addresses match the criteria; 22 are other parties and one is ours, excluded.** Our
run-001 wallet `0x0059d9e9…` (24 settlements, 8 `payTo`, 1 day) meets the same test and **is
excluded from every figure above**. Recomputing the criteria against the data returns 23, so both
numbers are stated rather than leaving a reader to decide which one is wrong.

That these 22 are surveys is an **inference from shape, not a fact** — the chain cannot show
intent. They are named as a group rather than silently dropped or counted as production agents.

## Value — treat with suspicion

Total USDC into the seller set is 800,639.62, but that figure is **not x402 spend**. 99.1% of
transfers are ≤ $0.10, yet the total is dominated by a handful of large transfers — one address
sent $70,000 in 18 payments (avg $3,889), another $43,111 in 57. Transfers of that size are orders
of magnitude above the advertised price of any resource in the catalogue, so they cannot be read
as per-call payments; what they were instead is not something the ledger says and this page does
not guess. A `payTo` address receives everything sent to it, x402 or otherwise. **Settlement counts
are the robust metric here; the dollar total is not.**

## v1 numbers, retained — the narrow frame

Scanned against only the 9 sellers run-001 paid, same 30-day window shape:

| | v1 (9 sellers) | v2 (1,115 sellers) |
|---|---|---|
| Distinct payers | 356 | 10,167 |
| Settlements | 18,978 | 5,049,516 |
| Single-`payTo` payers | 67.7% | 89.4% |
| True single-service payers | not computable | 10.8% |
| Broadest payer | 9 sellers | 630 sellers |

v1's 67.7% was read as "two thirds never compare". At the wider frame that reading does not
survive: the same behaviour, measured against the real catalogue, is mostly aggregator-mediated.

## Limits

- **Reachability is capacity, not use.** The chain cannot say which endpoint behind an aggregator
  was called. The 10.8% figure is a floor on single-service behaviour, not a measurement of it.
- **The catalogue is not the population.** 1,115 addresses is what Bazaar indexes; sellers absent
  from it are invisible, and one known Bazaar bug omits resources whose `payTo` varies per call.
- **One address is not one buyer.** No clustering or identification was attempted.
- **USDC only**, Base only, 30 days only.
- **The dollar total is unreliable** — see above.
- No claim about *why* anyone paid.

## Re-checking

- `research/base-seller-set.json` — the 1,115 sellers, with resource and host counts.
- `research/buyer-census-base-v2.json` — per-payer and per-seller aggregates, v2 frame.
- `research/buyer-census-base.json` — v1 frame aggregates, retained for the comparison table.

`research/buyer-census-base-transfers.json` — v1's raw 4.5 MB transfer log — **was discarded as
superseded.** It was the per-transfer record behind the 9-seller frame, and nothing on this page
rests on it: every v1 figure quoted here comes from the aggregates above, and the v2 frame rescans
from chain rather than deriving from it. Keeping it would have quadrupled the repository to carry
raw data for a frame this write-up already describes as answering a much smaller question. The
scan is reproducible from the method and the seller set.

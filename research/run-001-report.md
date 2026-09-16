# Run 001 — do grade A x402 endpoints deliver?

Gideon Ibemere Jr. · run executed 2026-09-15 · report written 2026-09-16

Method pre-registered 2026-09-06 in `RESEARCH-METHOD.md`, before any mainnet payment. Ten
amendments are in that file's git history, each dated; the substantive ones are named where
they bear on a number below.

## The count, first

**31 calls were graded. 30 can be published.** The difference is one row, `geo-r-02`, and it is
not a clerical error.

`api.relaystation.ai` advertises `$0.005/lookup … 1¢ x402 min; remainder auto-credits`. The first
call transferred 10,000 atomic units on chain, consumed 5,000 and credited the rest. The second
consumed the remaining balance: a real settlement, correctly recorded as `settled: true` with
`amountSettled: 5000`, and **no transaction hash, because no transfer occurred.**

The chain reconciles to the atomic unit. Across both attempts, Base shows 25 claimed settlements
against 24 transfers, and 306,000 atomic claimed against 306,000 moved. The money is exact; only
the count differs, by precisely the row with no hash. Writing a hash into that row would have been
fabrication, and copying `geo-r-01`'s would have pointed two rows at one transfer.

My published dataset promises every row is re-verifiable by tx hash. This row cannot be, so it
stays in the local dataset and out of the published one. Axis 3 below is computed on all 31 graded
rows; the published set is 30, and the difference is 22 useful rather than 23.

## The question

Does an endpoint being reachable, compliant and well-graded predict that it is worth paying for?

Everything published about x402 endpoints is measured from outside — uptime, 402-envelope
compliance, price stability, settlement volume. None of it measures whether the buyer got what
they paid for. This run tests whether the outside measures predict the inside one.

**Prediction, written before the run:** they will not fully predict it. Some non-trivial share of
endpoints passing every external check will return responses a buyer cannot use. If that share is
zero, I publish that instead.

**Secondary prediction:** most failures will be mechanically detectable — `empty`, `malformed`,
`insufficient`, `no_response` — and **`wrong` will be rare, or hard to catch.**

The primary prediction held. **The secondary prediction did not, and the direction it failed in
matters more than the fact that it failed.** See Axis 3.

## What was done

34 paid calls across **11 distinct providers** and **18 distinct endpoints**, every one grade A on
x402 Trust, sampled across providers and filtered to categories where I can check the answer:
geocoding forward (8) and reverse (8), known-answer search (8), search relevance (4), price (4),
weather (2).

The sample was frozen 2026-09-14, before any payment, with the question and the expected answer
written for each row and committed to git first. Grading is by hand against those pre-written
answers. Total spend, attempt 2: **308,000 atomic units — $0.308.**

### Attempt 1 is void, and stays in the record

Run 001 was executed once at 05:59–06:00 UTC on 2026-09-15. **All 34 rows are void as quality
data.** The harness sent every request with no query parameters at all: the plan's `endpoint`
column held the bare URLs from the frozen catalog, the harness treated that as the complete
request, and the pre-registered `query` column was prose for a reader that never reached the wire.

It cost 8 settled rows and $0.041. 22 endpoints answered `400` after the payment leg but before
settlement, so those cost nothing; 2 returned `404` and 2 `401`.

Eight rows returned `200`, and those are the ones worth keeping. Three calls to one search
endpoint — nominally carrying three different questions — came back byte-identical at 386 bytes.
Two geocoder calls came back identical at 473. Read one way that is `wrong`: well-formed,
plausible and incorrect, which is exactly the failure this method predicted would be hardest to
catch, and it nearly passed as success because the status was 200. Read the other way, an endpoint
given no parameter cannot be said to have ignored one. **Neither reading is labeled**, because
attempt 1 cannot separate them — the request was malformed, so the endpoint's behaviour toward a
well-formed request is simply unobserved.

No attempt 1 row is labeled, published or counted, for any axis. Three things changed before
attempt 2: rows carry a `params` object separate from `endpoint`, so the provenance chain back to
the frozen catalog survives; the harness refuses to pay a row whose parameter names are absent
from the 402's own declared input; and the harness records response bodies, which attempt 1
discarded — including the 22 `400` bodies that would have named the missing parameter immediately.

I record this rather than re-running quietly because a run re-done in silence is a run whose
published numbers nobody can reconcile against its own history. One consequence is concrete:
`api.relaystation.ai` is POST with a JSON body, attempt 1 sent a naked GET and recorded a bare
404. **Attempt 1 would have published the best reverse geocoder in the run as a dead endpoint.**

## Axis 1 — Coverage

*Can I verify a payment on the networks carrying the most endpoints?*

**Four networks, one verified settlement each, all with tx hashes.**

| network | calls | settled | spend (atomic) | asset |
|---|---|---|---|---|
| Base `eip155:8453` | 25 | 22 | 283,000 | USDC `0x8335…2913` |
| Solana mainnet | 4 | 4 | 16,000 | USDC `EPjF…TDt1v` |
| Arbitrum One `eip155:42161` | 3 | 3 | 7,000 | USDC `0xaf88…5831` |
| Avalanche `eip155:43114` | 2 | 2 | 2,000 | USDC `0xB97E…8a6E` |

**BNB is absent by decision, amended into the method on 2026-09-14 at the sample freeze and before
any payment.** All 13 BNB endpoints in the catalog belong to one provider, all grade B, all in DeFi
categories this run excludes as ungradeable. There is no BNB endpoint that is both grade A and in
scope. I could have bought one call outside the frame to fill the axis; it would have proved that a
chain I had already configured verifies a payment — which the test suite establishes more cheaply —
from a row that would then need excluding from Axis 3 anyway. **A chain with 13 listed endpoints and
one operator behind them is not a chain with a supply of things to buy.** That is an observation
about the ecosystem, not a gap in the run.

Separately: Circle publishes no native USDC on BNB Smart Chain. What trades there under that name
is Binance-Peg USDC, a different issuer with different redemption, so prices across the five
networks are not directly comparable. The verifier supports BNB regardless.

## Axis 2 — Reach

*Of the endpoints I select, how many can actually take a payment?*

Of 34 endpoints attempted: **34 returned a well-formed 402** (100%), **31 settled a payment**
(91.2%), **31 returned a response** (91.2%).

The three that did not are the same endpoint, `api.x402node.dev/serp/web`, which returned `502`
three times and was never paid. Those rows are unsettled, ungraded and excluded from Axis 3 — an
endpoint that never took money never had a chance to deliver.

This is a much higher compliance rate than the ecosystem-wide reference figures I cite rather than
reproduce (x402 Trust reports 51% of 72,395 listed endpoints unreachable, 23% of reachable ones
non-compliant). That is expected and is the point of the frame: **this is the best case, sampled
deliberately.** Nothing in Axis 2 generalizes to the directory.

One price check worth recording, since external graders score price stability: **29 of 31 settled
rows were charged exactly the advertised price.** The two exceptions are both `api.relaystation.ai`,
charged 5,000 against an advertised 10,000 — the credit model described above drawing down a
balance, not price drift.

## Axis 3 — Quality

*Of the endpoints that are up, compliant and well-graded, how many returned something I could use?*

**This is the finding. Of 31 graded calls, 23 were useful and 8 were not — a 25.8% failure rate
among endpoints where every external signal is green.**

| category | calls | useful | not useful | unsettled | spend | waste | cost per useful |
|---|---|---|---|---|---|---|---|
| geocode_forward | 8 | 5 | 3 | – | 15,000 | 4,000 | 3,000 |
| geocode_reverse | 8 | 5 | 3 | – | 37,000 | 21,000 | 7,400 |
| search_known | 8 | 4 | 2 | 2 | 160,000 | 60,000 | 40,000 |
| search_relevance | 4 | 3 | 0 | 1 | 80,000 | 0 | 26,667 |
| price | 4 | 4 | 0 | – | 10,000 | 0 | 2,500 |
| weather | 2 | 2 | 0 | – | 6,000 | 0 | 3,000 |
| **total** | **34** | **23** | **8** | **3** | **308,000** | **85,000** | **13,391** |

Amounts are atomic units. **$0.308 spent, $0.085 of it wasted, $0.0134 per useful result.** Cost
per useful result is spend divided by count of outcome 1; everything spent reaching outcome 2 is
waste however I recovered from it.

### The secondary prediction failed, and failed informatively

I predicted failures would be mostly mechanically detectable and that `wrong` would be rare. The
reason codes say otherwise:

| reason | count |
|---|---|
| `wrong` | 6 |
| `insufficient` | 2 |
| `empty` | 0 |
| `malformed` | 0 |
| `no_response` | 0 |
| `stale` | 0 |

**Every failure in this run was a semantic failure.** Not one endpoint returned nothing, returned
the wrong shape, timed out, or served something visibly out of date. Every one of them returned
well-formed JSON matching its advertised schema, promptly, and settled payment correctly. The
failure was always in the content.

The distribution is sharp: **all six `wrong` rows are geocoding** — three forward, three reverse —
and **both `insufficient` rows are known-answer search.** Price and weather did not fail at all.

I want to be careful about what this licenses. `wrong` being common here is partly an artifact of
my own checkability rule, which deliberately selects for conditions where `wrong` *can* be caught,
because I only buy where I already know the right answer. A real buyer usually does not. The
honest statement is narrower than "endpoints lie often": **under conditions optimized to detect
confidently-incorrect answers, confidently-incorrect answers were the dominant failure mode.** In
production, where nobody holds the reference, these are the failures that pass silently.

### The single most important row

`agent402.tools/api/geocode`, $0.0010 on Avalanche, grade A, ~97% uptime, fast, valid JSON
matching its advertised schema, settles correctly. Sent two different Austin venues, it returned
**byte-identical responses both times** — a correct, well-attributed, verifiable lookup of the
White House, carrying a `query` field reporting `"1600 Pennsylvania Ave NW, Washington, DC"`, which
is the example query from the provider's own documentation. The caller's input appears nowhere.

*Mechanical:* the `query` field does not echo what was sent. *Inference:* the endpoint ignores its
input and returns a canned response.

Three consequences, in order of severity. The caller's input never reached a lookup. **An agent
logging the `query` field for its own audit trail records that it asked about the White House** —
the falsification propagates into the buyer's own records. And everything else about the response
is internally consistent and correct: real OSM relation ID, correct coordinates, proper
attribution. It is a well-formed, verifiable, attributable answer to a question nobody asked.

The control is within the same provider. `agent402.tools`' reverse-geocode, search and price
endpoints all answered correctly — **three of four routes on the host work, and the defect is
isolated to one route.** That is a stronger control than any cross-provider comparison. **Every
external signal on this endpoint is green. The only way to know is to pay it, read the body, and
already know the right answer.**

### Where I loosened, and then tightened, a pass condition

`sk-02` asked who was men's soccer head coach at Austin College in 2013. Expected `Mark Hudson` —
first-hand knowledge; he coached me. He appears at rank 4, attached to a **2018** media-day video.
Nothing in the response binds him to 2013.

My original pass condition for the known-answer tier was looser than what I ended up applying, and
would have let this through on the grounds that the correct name was present. While labeling I
made the criterion explicit — **the answer has to be attached to the thing asked about** — and
applied it across all three rows in the tier:

| row | answer present? | bound to the subject asked? | label |
|---|---|---|---|
| `sk-08` Q2 Stadium capacity | yes, ranks 2–3 | yes — "Capacity: 20,738" for Q2 Stadium | outcome 1 |
| `sk-02` Austin College 2013 | yes, rank 4 | no — bound to a 2018 season | outcome 2 `insufficient` |
| `sk-07` Cypress Woods 2010 | no | — | outcome 2 `insufficient` |

The operative test is: *had I not already known the answer, would I have come away with it?* I
state the criterion rather than the verdicts so a reader can check all three rows against it
instead of taking my labels on trust. This is a tightening applied uniformly within a tier during
labeling, not a per-row adjustment, and I record it because a pass condition I had to sharpen
mid-grading is exactly the kind of thing a reader should be able to audit.

`sk-02` is also a retrieval failure demonstrated against a control. The identical query on Google
returns, as the first two organic results, `acroos.com`'s own 2013 season preview ("Head coach Mark
Hudson") and the 2013 roster page. **The endpoint crawled that same domain — three of its other
results come from it — and surfaced a 2018 video instead of two pages stating the answer.**

### An asymmetry in my own grading standard

Two of the three reverse-geocoding failures were "correct street, wrong door": `geo-r-07` expected
2922 E. Cesar Chavez and returned 2968; `geo-r-03` expected 611 E. 7th and returned 613.

**My forward condition allows 100 m of tolerance. My reverse condition requires an exact
house-number match.** That is an asymmetry I did not notice when writing the standard, and it means
a coordinate near a property line fails by construction. Those rows cannot cleanly separate three
possibilities: the endpoint resolved to the wrong building, my reference coordinate (not
survey-grade) points at the neighbour, or OSM footprints disagree with postal addresses at that
point.

The labels stand as pre-registered — tightening or loosening mid-run is what the pre-registration
exists to prevent — but the standard was not symmetric and a future run should define a spatial
tolerance for reverse geocoding. Related, and bearing on the same margin: `2s.io` records
`meta.query.input` as `30.2621,-97.7294` for a coordinate I sent as `30.2621072, -97.7294149`,
truncated to four decimals, introducing ~11 m of positional error before the lookup. It changed
nothing there. **It is exactly the margin that decides which building you land on**, only one
seller reports what it actually used, and an exact-match pass condition is sensitive to a
transformation the buyer never sees.

## Exploratory observations

**Not pre-registered.** Everything above tests what I declared before paying. What follows is what
I noticed while looking, which means I cannot rule out that I noticed it because it was there to be
noticed. These are hypothesis-generating. **None of them changed any label**, mechanical
observations are separated from the inferences drawn on them, and none is presented as tested or as
generalizing beyond the 34 rows it was seen in. The full versions are in
`research/run-001-observations.md`.

**Resale is invisible, and the price spread does not track it.** All four price rows asked for
BTC/USD within four seconds and returned the same number. *Mechanical:* two of them agree to eight
decimal places, both name DefiLlama, and carry identical payload shape. *Inference:* at least three
of the four resell the same upstream. The spread across them is 5×, and the cheapest two are the
most auditable — named source, upstream timestamp, confidence score — while the most expensive
spends a large share of its payload promoting three sibling endpoints. All four are outcome 1.
Resale is not a defect; an endpoint wrapping DefiLlama for a tenth of a cent with no key and no
account is providing real service. **The finding is that a buyer cannot see they are the same data,
and so cannot see that one costs five times the others for it.**

**One seller, one price, two products.** Both `2s.io` weather endpoints cost $0.0030 and were called
1.2 seconds apart. One reads Open-Meteo in °C with a ~5-minute-old reading and 15 fields; the other
reads NOAA in °F with an ~80-minute-old reading and 8 fields. A 16× difference in freshness at an
identical price, and nothing external — grade, uptime, compliance, price stability — separates
them. The lag was noise here only because the temperature barely moved overnight.

**Price ordering inverts against payload quality.** Three search endpoints answered the same
relevance query within eight seconds, all outcome 1. The $0.010 endpoint returned extracted page
content and a per-result relevance score; the $0.020 and $0.050 endpoints returned snippets only,
and *mechanical:* seven of ten of their results appear in near-identical rank order with
byte-identical snippets, including the same truncation. *Inference:* they share an upstream.
Neither says so. The cheapest is the only one that saves an agent a second fetch. The $0.020
endpoint carries `untrustedContent: true` — **the only safety flag anywhere in the run**, on a
prompt-injection surface — and the endpoint charging 2.5× more does not.

**A seller arguing its price inside the payload.** The $0.0500 search endpoint returned a `_notice`
explaining that its price rose on 2026-09-08, announced 2026-08-24, and that the funds go to
dedicated always-on compute. That is the opacity problem from the seller's side: **a seller who
genuinely is better has no channel to prove it**, so it writes the comparison into the response,
after the buyer has already paid.

**A failure mode none of my six reason codes fits.** `sk-08` asked Q2 Stadium's capacity and was
outcome 1 — 20,738, at ranks 2 and 3. The same ten results also contain 20,500, 20,000, 20,700 and
"20,500+". An agent taking the first number it meets gets 20,000, wrong by 738, from the company
that supplied the chairs. Not wrong, not stale, not empty, not malformed — *unresolved*: the
response hands disambiguation back to the buyer, and the noise is plausible enough that resolving it
requires already knowing the answer. The control is `sk-04`, same tier and endpoint, asking Real
Madrid's Champions League count: nine of ten results say 15, no competing figure. **The difference is
the subject, not the endpoint.** Nothing in the run reports consensus, and a field as simple as "how
many of these results agree" would separate the two completely. I did not change the vocabulary
mid-run; `unresolved` is a candidate seventh code for a later one.

**The endpoint's failure and the agent's failure are different failures.** `sk-07` is `insufficient`
at the endpoint level — the name never appears. But an agent taking the top-ranked coach name
returns a real coach at the right school, wrong by eleven years, with nothing in the payload
signalling the date was never matched. **The endpoint's failure is `insufficient`; the agent's
failure is `wrong`; only the second reaches whoever asked.** This is where my secondary prediction
was pointing even though the codes went the other way: `wrong` answers are produced routinely by
endpoints that are merely unresolved, and that is invisible to every external grade, to a buyer
without a reference, and to the endpoint itself.

**Two endpoints flagged their own bad answers in fields nobody reads.** `sat.ipintel.ai` returned a
point ~10 km from the record store I asked about, and said so three times in the same response:
`result_type: "suburb"`, `confidence: 0.25`, `confidence_city_level: 1`. Seven seconds earlier the
same endpoint returned a point ~8 m out with `confidence: 1`. **An agent thresholding at 0.5 would
have caught the 10 km error for free, using data the seller already sends.** One field in that
response actively misleads: `distance_m: 0`, measured from the matched suburb centroid rather than
from anything I asked about. Three sellers in this run express match confidence in three
incompatible vocabularies and none of it appears in the 402's declared schema — a concrete candidate
for a work-unit extension.

**A reading I made and withdrew.** Four reverse-geocoding rows initially suggested Nominatim's
`importance` field tracked correctness: near-zero on both wrong answers, 0.2+ on both correct ones.
Two later rows killed it. `geo-f-05` and `geo-f-06` are the same endpoint three seconds apart, both
correct, and the *less* specific match scores 2,000× higher; `geo-f-04`, the most wrong row in the
run, scores 0.696. `importance` is a prominence score for the matched object, not a match-quality
score. **The apparent separation was coincidence and the reading is withdrawn.** What survives is
the explicit, documented `confidence` / `result_type` pair above. I record the retraction because
conflating a prominence score with a confidence score would have been a real error, and it was live
for part of the labeling.

**Returning the ambiguity instead of hiding it.** `api.relaystation.ai` returned the address plus
four ranked candidates, each with a distance in metres. Every other reverse geocode in the run picks
one building and hands back a number with no indication a choice was made. **Both of the
"correct street, wrong door" failures above would have been recoverable from a response shaped like
this** — the right address would have been in the set with a distance attached. The failure in those
rows is not that reverse geocoding is hard near property lines; it is that those endpoints discard
the ambiguity before answering, and this one does not.

**The credit model is a product gap, not a clerical one.** The 31/30 discrepancy at the top of this
report surfaced as a bookkeeping mismatch. *Mechanical:* one on-chain transfer covered two paid
calls, and the second has no transaction. *Inference:* per-call verification is structurally
incomplete for sellers using prepaid credit. My review server's premise — one payment, one review,
verified against the chain — cannot express a settlement that draws down a balance, and this is not
exotic; the seller advertises it in its own 402. It fails safe, in that the row simply never reaches
the published dataset, but it fails silently. Verifying it needs a different primitive: proof a
balance was drawn down, not proof a transfer occurred. The `offer-receipt` extension's signed
receipt is a candidate — a third proof class alongside `payment_traced` and `receipt_only`,
seller-attested and shown as visibly weaker, which is better than a real settlement vanishing
without a trace.

**The thread.** The axes on which these endpoints genuinely differ — payload type, provenance,
freshness, upstream identity, relevance scoring, safety flagging, result hygiene, confidence
reporting, whether the input echo is truthful, whether ambiguity is returned or discarded — are
orthogonal to price and invisible to every external grade. A buyer sorting by price gets one answer;
sorting by grade gets another; neither has anything to do with which response an agent could
actually use.

## Limits

- **Single reviewer, single judgment.** One rater, no inter-rater check.
- **Small n per category**, and smaller still after the split by network. Weather is 2 calls on 1
  provider; no finding about weather generalizes past that provider.
- **The sample is the best-graded endpoints**, chosen deliberately to test the best case. Nothing
  here generalizes to the whole directory, and Axis 2's high compliance rate in particular is a
  property of the frame, not of x402.
- **Checkability correlates with simplicity.** I chose categories where I can verify the answer,
  which means the hardest endpoints to grade — and the ones where quality problems are most likely
  to hide — are the ones I excluded.
- **My own recall is part of the instrument.** I graded against a source at grading time rather than
  from memory, but a mis-specified expected answer remains possible.
- **The reverse-geocoding standard was not symmetric with the forward one**, as stated above. Three
  rows sit on that asymmetry.
- **Latency measured from one location.**
- **I built the tool this finding argues for**, so my bias runs toward finding a gap. The
  pre-registered prediction, the falsification clause, and publishing every row are the only guards
  against that.

## Where the data lives

- **Method and its full amendment history:** `RESEARCH-METHOD.md` in this repo, 10 commits from the
  2026-09-06 pre-registration onward.
- **Exploratory observations, in full:** `research/run-001-observations.md`.
- **The frozen sample, with pre-written questions and expected answers:**
  `x402-spend/examples/run-001.json` and `run-001-sample.md`, both committed before any payment.
- **Results and receipts:** `x402-spend/examples/run-001.results.json`, `run-001.db`.
- **Attempt 1, void but retained:** `x402-spend/examples/run-001-attempt-1.results.json` and
  `run-001-attempt-1.receipts.json`.
- **Response bodies:** `x402-spend/examples/run-001-responses/`.
- **Published dataset:** 30 rows, CC BY 4.0, each re-verifiable against the chain by tx hash.

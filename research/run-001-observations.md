# Run 001 — exploratory observations

Written during labeling, from the response bodies in `examples/run-001-responses/`, against the
expected answers committed in `examples/run-001.json` before any payment.

**These are exploratory, not confirmatory.** The pre-registered question was whether grade A
endpoints deliver. Everything here is something noticed while looking, so it cannot claim the
pre-registered strength: the patterns may have been noticed because they were there to be
noticed. Per `RESEARCH-METHOD.md`, exploratory findings never change a label, mechanical
observations are separated from the inferences drawn on them, and nothing here is presented as
tested.

None of these changed any outcome or reason code.

---

## 1. Four price endpoints, one upstream, 5× spread

All four `price` rows asked for BTC/USD within four seconds of each other and returned the same
number.

| row | provider | price | network | returned | attribution |
|---|---|---|---|---|---|
| px-01 | agent402.tools | $0.0010 | Base | `77571` | none stated; `change24h: null` |
| px-02 | crypto.apitoll.cloud | $0.0010 | Solana | `77570.64` | DefiLlama, named, with docs link |
| px-03 | coingecko.use.x402atlas.com | $0.0050 | Arbitrum | `77571` | CoinGecko implied by host |
| px-04 | keyronne.com | $0.0030 | Base | `77570.64047211048` | DefiLlama, named |

**Mechanical:** px-02 and px-04 agree to eight decimal places, both name DefiLlama, both carry
`confidence: 0.99` and `decimals: null` — the same payload shape. px-01 and px-03 return the
rounded figure.

**Inference:** at least three of the four resell the same upstream data.

The 5× spread buys no better number. It buys different amounts of wrapper, and the wrapper varies
in a direction unrelated to price:

- The two **cheapest** are the most auditable — named source, upstream timestamp, confidence score.
- px-01, same price as px-02, states no source and advertises a `change24h` field it returned as
  `null` — a shape promised and not delivered.
- px-03, at 5× the cheapest, spends a large share of its payload on an `_atlas` block promoting
  three sibling endpoints. The buyer paid for a price and received a price plus cross-promotion.

**All four are outcome 1.** Each gave what was written down (spot within 1%).

Three axes surfaced here, none in the pass condition: **richness** (how much is returned for the
same price), **provenance** (whether the response says where the number came from and when), and
**payload serving the seller** rather than the buyer.

**Resale is not a defect.** An endpoint wrapping DefiLlama for a tenth of a cent — no key, no
account, x402 access — is providing real service. The finding is that a buyer cannot see they are
the same data, and therefore cannot see that one costs five times the others for it.

## 2. Same seller, same price, two weather endpoints, different products

Both 2s.io at $0.0030 on Base, called 1.2 seconds apart. Both correct locations, both outcome 1.

| | `weather/current` (wx-01) | `weather/zip` (wx-02) |
|---|---|---|
| upstream | Open-Meteo | NOAA National Weather Service |
| units | °C (28.5) | °F (83) |
| reading timestamp | 01:15 Central | 00:00 Central |
| staleness at call | ~5 minutes | ~80 minutes |
| fields | 15 | 8 |
| price | $0.0030 | $0.0030 |

Cross-checked: Austin at ~01:20 was 81–82 °F at the airport, warmer at central stations. 83 °F /
28.5 °C is correct downtown. The 80-minute lag is noise *here* only because the temperature
barely moved overnight; the same lag on a fast-moving quantity would be `stale`.

**Both endpoints echo the buyer's own settlement back** — tx hash, network, success, and the price
charged. Worth naming as a positive: this seller tells you what you paid and proves it, unprompted.

One seller, one price, two upstreams, a 16× difference in freshness. A buyer choosing on price
sees no difference. Nothing external — grade, uptime, compliance, price stability — separates them.

## 3. Three search endpoints, and the price ordering inverts

Same relevance query, called within eight seconds. All three outcome 1.

| | sr-01 x402atlas **$0.010** | sr-02 agent402 $0.020 | sr-04 kadec0 $0.050 |
|---|---|---|---|
| what comes back | **extracted page content** — paragraphs, a Wikipedia table as markdown | snippet only | snippet only |
| relevance signal | **per-result `score`** (0.51–0.91) | rank order | rank order |
| likely upstream | content extraction + scores | Brave-shaped | Brave-shaped |
| safety flag | none | **`untrustedContent: true`** | none |
| markup | extraction noise (nav text, "Sign in now") | raw `<strong>`, HTML entities | cleaned |

sr-02 and sr-04 **share an upstream**: seven of ten results in near-identical rank order with
byte-identical snippets, including the same SI.com truncation. Both carry a date field per
result; agent402 returns `<strong>` highlight tags. Neither says so.

For an agent, a snippet is a pointer — you still have to fetch the page, another call and another
round trip. Extracted content is the answer. **The cheapest endpoint in the category is the only
one that saves the agent a second fetch, and the only one returning a relevance score it could
route on.**

So: the $0.010 endpoint has the best payload, the $0.020 endpoint has the only prompt-injection
warning, and the $0.050 endpoint has the cleanest text. **There is no ordering in which price
tracks quality.**

`untrustedContent: true` is the only safety flag anywhere in the run. Search results fed to a
model are a prompt-injection surface; exactly one endpoint says so, and the one charging 2.5× more
does not.

## 4. A seller justifying its price inside the payload

sr-04 (kadec0, $0.0500) returned a `_notice`:

> "Pricing update: /v1/serp is $0.05 per call as of 2026-09-08 (announced 2026-08-24; the change
> was delayed). Funds dedicated always-on compute and zero-downtime deploys. Other endpoints
> unchanged."

$0.05 is 50× the run's floor and 2.5–5× the other search providers answering the identical query.

**The seller is justifying its price inside the response, because there is nowhere else to do it.**
A buyer cannot see that this endpoint runs dedicated always-on compute while a competitor at a
fifth the price does not. So the seller writes the comparison into the payload — after the buyer
has already paid. **That is the opacity problem from the seller's side:** a seller who genuinely is
better has no channel to prove it.

Also: a price change landed inside the sample window (announced 08-24, effective 09-08; frozen
09-14, paid 09-15). Worth checking whether the plan's recorded price matches what was charged —
external graders score price stability, and this is a case where that grade is directly checkable
against a settlement.

## 5. On a precise-numeric question, a set containing the answer is not the answer

sk-08 asked Q2 Stadium's capacity; expected `20,738`. **Outcome 1** — correct, at ranks 2 and 3.

But the ten results contain **five different capacities**: 20,738 (correct, ranks 2–3), 20,500
(the *design* figure), 20,000 (Irwin Seating), 20,700 (Copa América), "20,500+" (Austin FC). Rank
1 is Wikipedia with no number in the snippet.

An agent taking rank 1 gets nothing. An agent taking the first number it encounters gets 20,000 —
wrong by 738, from the company that supplied the chairs, which reads authoritative.

**A distinct failure mode:** not wrong, not stale, not empty, not malformed. *Unresolved* — the
response hands disambiguation back to the buyer, and the noise is plausible enough that resolving
it requires already knowing the answer.

**Control (sk-04):** same tier, same behaviour, asked how many Champions League trophies Real
Madrid has won. Nine of ten results say 15; no competing figure anywhere. **The difference is the
subject, not the endpoint.** These endpoints return what the web contains, and the web is
unanimous about Real Madrid and inconsistent about a stadium's seat count. The response shape is
identical either way.

**Nothing in the run reports consensus.** A field as simple as "how many of these results agree"
would separate sk-04 from sk-08 completely, and no seller offers it. (sr-01's per-result relevance
score is the closest anything comes, and relevance is not agreement.)

**Note for after the run:** none of the six reason codes fits "returned a set containing the
answer among plausible alternatives." `insufficient` is closest and isn't right, since the answer
*is* present. Possibly a seventh code — `unresolved` — or possibly an observation about a
category rather than a verdict on a call. The vocabulary was not changed mid-run.

## 6. The endpoint's failure and the agent's failure are different failures

sk-07 asked who coached Cypress Woods High School football in 2010; expected `David Jones`.
**Outcome 2, `insufficient`.** The name appears nowhere. What came back was the right school and
the wrong years — Cody Simper (2021), Tyrone Carter (2024), Jeremy Hickman (2025). The one page
that would answer it, MaxPreps' "Coach History," returned a snippet with no names in it.

**An agent taking the top-ranked coach name returns Cody Simper** — a real coach at the right
school, wrong by eleven years, with nothing in the payload signalling the date was never matched.

**The endpoint's failure is `insufficient`. The agent's failure is `wrong`. Only the second one
reaches whoever asked.**

This sharpens the method's secondary prediction. `wrong` at the *endpoint* level is rare, as
predicted. `wrong` at the *answer* level is produced routinely by endpoints that are merely
unresolved — invisible to every external grade, to a buyer without a reference, and to the
endpoint itself.

## 7. Retrieval failure proved against a control, and the criterion that resolves the tier

sk-02 asked who was men's soccer head coach at Austin College in 2013; expected `Mark Hudson`
(first-hand knowledge — he coached the reviewer). **Outcome 2, `insufficient`.**

Mark Hudson appears at rank 4, attached to a **2018** media-day video. Nothing binds him to 2013.
What a reader without prior knowledge takes away: rank 1 Taylor Goyen (hired 2022), rank 2 Truett
Cates (undated), rank 3 "Corona finished her first season at Austin College in 2013" — the
**women's** program, and the only result containing the year.

**The control.** The identical query on Google returns, as the first two organic results,
`acroos.com`'s own "2013 Kangaroo Men's Soccer Season Preview" (Aug 30 2013 — "Head coach Mark
Hudson") and the 2013 roster page ("Head Coach: Mark Hudson").

**The answer is indexed, plainly stated, and on `acroos.com` — the same domain the endpoint
returned three other results from.** It crawled the right site and surfaced a 2018 video instead
of two pages stating the answer. That is a retrieval quality failure demonstrated against a
control, not an obscure question.

### The criterion applied across the tier

> **The answer has to be attached to the thing asked about.**

| row | answer present? | bound to the subject asked about? | label |
|---|---|---|---|
| sk-08 Q2 capacity | yes, ranks 2–3 | **yes** — "Capacity: 20,738" for Q2 Stadium | outcome 1 |
| sk-02 Austin College | yes, rank 4 | **no** — bound to a 2018 season | outcome 2 `insufficient` |
| sk-07 Cypress Woods | no | — | outcome 2 `insufficient` |

Operative test: *had I not already known the answer, would I have come away with it?* In sk-08,
yes. In sk-02, no. The original pass condition was looser than this and the criterion is stated
so a reader can check all three rows against it rather than taking the labels on trust.

**Same endpoint, other tier (sk-01):** asked who won the 2026 Men's World Cup. Eight of nine
results say Spain, including fifa.com, with full context. Same provider, same price, same session.
**The difference is between an index having something prominently and having it at all** — which
is what the four-tier design was built to separate.

## 8. HEADLINE — a canned response that fabricates the question it answers

geo-f-03 and geo-f-04 (agent402.tools `/api/geocode`, $0.0010, Avalanche) were sent two different
Austin venues. Both returned **byte-identical** responses. **Outcome 2, `wrong`.**

```json
{
  "query": "1600 Pennsylvania Ave NW, Washington, DC",
  "count": 1,
  "results": [{
    "displayName": "White House, 1600, Pennsylvania Avenue Northwest, Ward 2, Washington, District of Columbia, 20500, United States",
    "lat": 38.8976387, "lon": -77.0365525,
    "type": "government", "class": "office",
    "importance": 0.6958339719610435,
    "osm": "relation/19761182"
  }],
  "source": "nominatim.openstreetmap.org (ODbL)"
}
```

**Mechanical:** the `query` field does not echo what was sent. It reports the example query from
the provider's own documentation. The caller's input appears nowhere.

**Inference:** the endpoint ignores its input and returns a canned response.

Consequences in order of severity:

1. The caller's input never reached a lookup.
2. **An agent logging the `query` field for its own audit trail records that it asked about the
   White House.** The falsification propagates into the buyer's records.
3. Everything else is internally consistent and correct — real OSM relation ID, correct
   coordinates, proper attribution. It is a well-formed, verifiable, attributable answer **to a
   question nobody asked**.

### The input-echo contrast

| row | provider | `query` field reports | reality |
|---|---|---|---|
| geo-f-01 | 2s.io | `"Inn Cahoots, 1221 E. 6th, Austin, TX"` | **verbatim, correct** |
| geo-f-02 | 2s.io | `"Maggie Mae's, 323 E. 6th, Austin, TX"` | **verbatim, correct** |
| geo-f-03 | agent402 | `"1600 Pennsylvania Ave NW, Washington, DC"` | **fabricated** |
| geo-f-04 | agent402 | `"1600 Pennsylvania Ave NW, Washington, DC"` | **fabricated** |

Same field name, same purpose, same category, calls seconds apart. One seller reports what it
processed; the other reports a query the caller never sent, twice, deterministically. **Nothing
outside the response body distinguishes the two.**

### The within-provider control

| endpoint | sent | returned | label |
|---|---|---|---|
| agent402 `/api/geocode` | two Austin venues | byte-identical White House, both times | outcome 2 `wrong` |
| agent402 `/api/reverse-geocode` | Austin coordinates | correct address, venue name, structured, attributed | outcome 1 |

agent402's `/api/search` and `/api/price-coingecko` also answered correctly. **Three of four
endpoints on the host work; the defect is isolated to one route.** That is a stronger control than
any cross-provider comparison: one seller, one price, one API surface, where one endpoint ignores
its input and its sibling is among the best-built things in the run.

**Why this is the study's headline.** Grade A, ~97% uptime, $0.001 a call, responds fast, valid
JSON matching its advertised schema, settles payment correctly. **Every external signal is
green.** The only way to know is to pay it, read the body, and already know the right answer.

## 9. Endpoints that flag their own bad answers in fields nobody reads

geo-f-08 (sat.ipintel.ai, $0.0020) was sent `Waterloo Records, 1105 N. Lamar, Austin, TX` and
returned a point ~**10 km** away — the North Lamar *neighbourhood*, not the record store.
**Outcome 2, `wrong`.** Three fields say so:

| field | value | meaning |
|---|---|---|
| `result_type` | `"suburb"` | a district match, not an address |
| `confidence` | `0.25` | low |
| `confidence_city_level` | `1` | confident it's in Austin; nothing beyond |

**Control, same endpoint, seven seconds earlier (geo-f-07):** sent `YETI Flagship, 220 S.
Congress`, returned a point ~8 m out. `result_type: "amenity"`, **`confidence: 1`**, `housenumber`
present.

**The endpoint correctly assessed its own output both times and published that assessment.** An
agent thresholding at 0.5 would have accepted one and rejected the other — turning a silent 10 km
error into a caught one, for free, using data the seller already sends.

**One field actively misleads:** `distance_m: 0` on the wrong answer — distance from the matched
*suburb centroid*, not from anything the caller asked about. The same response contains three
fields saying the answer is weak and one that, misread, says it is flawless.

**Three sellers, three incompatible vocabularies for the same idea**, none of them in the 402's
declared input or output schema: `importance` (Nominatim, undocumented), `confidence` +
`result_type` (Geoapify scale), and nothing at all from agent402. **That is a concrete candidate
for a work-unit Extension:** a standard field for how confident an answer is, which every one of
these upstreams already computes and each exposes differently or not at all.

### Retracted during analysis: `importance` as a confidence signal

Recorded because it was made and withdrawn while labeling, and the retraction is part of the
process rather than something to tidy away.

Four reverse-geocoding rows initially suggested `importance` tracked correctness: near-zero on
both wrong answers (0.000075, 0.00001) and 0.2+ on both correct ones. Two later rows contradicted
it:

| row | direction | matched | importance | correct? |
|---|---|---|---|---|
| geo-r-05 / geo-r-06 | reverse | — | 0.2 / 0.225 | ✓ |
| geo-r-03 / geo-r-04 | reverse | — | 0.000075 / 0.00001 | ✗ |
| geo-f-06 | forward | named POI (Hotel Van Zandt) | **0.0001** | **✓** |
| geo-f-05 | forward | bare address (609 Davis) | **0.2** | **✓** |
| geo-f-04 | forward | White House | **0.696** | **✗ (most wrong in the run)** |

geo-f-05 and geo-f-06 are the same endpoint three seconds apart, both correct, and the **less**
specific match scores 2,000× higher. In Nominatim, `importance` is a *prominence* score for the
matched object, not a match-quality score. **The apparent separation was coincidence and the
reading is withdrawn.** What survives is §9's `confidence` / `result_type` — an explicit,
self-assessed match quality on a documented scale. Conflating the two would have been the error.

## 10. Returning the ambiguity instead of hiding it

geo-r-02 (api.relaystation.ai, $0.0050) returned the address **and four ranked candidates, each
with a `Distance` in metres**:

| result | type | address | distance |
|---|---|---|---|
| 515 E 6th St | PointAddress | 515 | **5 m** |
| Flamingo Cantina | PointOfInterest | 515 | 5 m |
| Casino El Camino | PointOfInterest | 517 | 9 m |
| Rio Colorado | PointOfInterest | 511 | 13 m |
| Dirty Laundry USA | PointOfInterest | 509 | 17 m |

Plus categories per POI, ZIP+4, and street components broken into prefix, base name and type.

**Every other reverse geocode in the run picks one building and hands back a number with no
indication a choice was made.** geo-r-07 picked 2968 (wrong, 46 numbers off). geo-r-03 picked 613
(wrong, two doors down). geo-r-04 picked a different street entirely. **Both of the first two
would have been recoverable from a response shaped like this** — the correct address would have
been in the set with a distance attached.

The failure in those rows is not "reverse geocoding is hard near property lines." **It is that
those endpoints discard the ambiguity before answering, and this one doesn't.**

**Also worth recording:** this endpoint returned a bare 404 in attempt 1 — it is POST with a JSON
body and the first harness sent a naked GET. **Attempt 1 would have recorded the best reverse
geocoder in the run as a dead endpoint.** That is the clearest single justification for voiding
attempt 1 rather than reporting it.

## 11. A methodological gap the pass conditions left open

Two of the three reverse-geocoding failures were "correct street, wrong door":

- geo-r-07: expected 2922 E. Cesar Chavez, returned 2968. Reference verified against Yelp, Apple
  Maps, the venue's own site and a Texas licensing permit record.
- geo-r-03: expected 611 E. 7th, returned 613.

**The forward condition has a 100 m tolerance; the reverse condition requires an exact
house-number match.** So a coordinate near a property line fails by construction, and these rows
cannot cleanly separate three possibilities: the endpoint resolved to the wrong building,
Blueprint's coordinate (not survey-grade) points at the neighbour, or OSM's footprints disagree
with postal addresses at that point.

The labels stand as pre-registered — tightening or loosening mid-run is what the document exists
to prevent — but **the report must state that reverse geocoding was graded on an exact match with
no spatial tolerance, that this is an asymmetry with the forward condition, and that a future run
should define one.**

**Related, from geo-r-06:** 2s.io records `meta.query.input` as `30.2621,-97.7294` for a
coordinate sent as `30.2621072, -97.7294149` — truncated to four decimals, ~11 m of positional
error introduced before the lookup. It made no difference there. **It is exactly the margin that
decides which building you land on**, only one seller reports what it used, and a pass condition
graded on exact match is sensitive to a transformation the buyer never sees.

## 12. FINDING — a credit-model seller produces settlements no per-call verification can check

Surfaced as a bookkeeping discrepancy: 31 settled receipts in the database, 30 rows in the results
file carrying a transaction. **Not a bug.** Both files agree and both are accurate.

`geo-r-02` records `settled: true`, `amountSettled: 5000`, `transaction: ''`. The endpoint's
advertised terms, captured at sample freeze, explain it:

> `$0.005/lookup … 1¢ x402 min; remainder auto-credits`

Half a cent per lookup, one-cent x402 minimum. The **first** call transferred 10,000 atomic on
chain, consumed 5,000, credited the rest. The **second** consumed the remaining 5,000 — a real
settlement, no new transfer, no hash.

**The chain confirms it to the atomic unit:**

| | claimed | on chain |
|---|---|---|
| Base settlements, both attempts | 25 | **24** transfers |
| Base spend, both attempts | 306,000 atomic | **306,000** atomic |
| payer → relaystation | 2 × 5,000 | **1 × 10,000** |

Money reconciles exactly; only the count differs, by precisely the row with no hash. **An empty
`transaction` here is accurate data, not missing data.** Writing a hash in would have been
fabrication; copying geo-r-01's would have pointed two rows at one transfer.

**Mechanical:** one on-chain transfer covered two paid calls; the second has no transaction.

**Inference:** per-call verification is structurally incomplete for sellers using prepaid credit.
The review server's premise — one payment, one review, verified against the chain — cannot express
a settlement that draws down a balance. Not exotic: the seller advertises it in its own 402.

**Consequences:**

1. The method promises every row is "re-verifiable against the chain by tx hash." One of 31 isn't,
   because of a billing model rather than a failure. It remains a real settlement, stays in the
   local dataset, and cannot enter the published one.
2. **The report must state the count discrepancy up front: 31 graded locally, 30 publishable, and
   why.** A reader who counts 30 should not have to work out the difference.
3. It is a product gap found by the study, in a row that looked like a clerical error. Verifying a
   credit-model settlement needs a different primitive: proof a balance was drawn down, not proof
   a transfer occurred.

**Fails safe:** `buildSubmission` returns undefined with no transaction, so `label()` reports
`{ posted: false, error: "no settlement to verify" }`. Nothing crashes, nothing bogus is published
— the row simply never reaches the dataset, silently.

**Candidate answer, open:** the `offer-receipt` extension's signed *receipt* — the resource server
attesting cryptographically that a call was delivered. A review could point at that signature
rather than at a transfer that doesn't exist. It costs something: verifying a signature means
trusting the signer about delivery, weaker than reading a transfer off a chain. It would be a
third proof class alongside `payment_traced` and `receipt_only` — seller-attested, shown as
visibly weaker, and better than the row vanishing in silence.

---

## The thread through all of it

Twelve observations, one pattern. The axes on which these endpoints genuinely differ —
payload type, provenance, freshness, upstream identity, relevance scoring, safety flagging,
result hygiene, confidence reporting, whether the input echo is truthful, whether ambiguity is
returned or discarded — are **orthogonal to price and invisible to every external grade.**

A buyer sorting by price gets one answer. Sorting by grade gets another. Neither has anything to
do with which response their agent could actually use.

**Comparison is not absent from this market because buyers don't want it. It is absent because
nothing in the market makes these things comparable.**

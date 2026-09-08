# x402-spend-reviews

> "We probe and observe; we do not verify delivery-after-payment."
> — [x402-trust](https://x402.fuchss.app)

This does.

A verification server for reviews of paid x402 endpoints. A review is accepted only when the
settlement transaction on chain proves the payment it claims, so the transaction hash is the
proof of purchase.

This is the server half of [x402-spend](https://github.com/gideonibemerejr/x402-spend). Every
published review is anchored to a settlement that actually happened, by a payer who actually paid.

Code is MIT. The review dataset served by this API is licensed
[CC BY 4.0](./DATA-LICENSE.md); attribute x402-spend-reviews.

**Live:** `https://x402-spend-reviews.g-764.workers.dev`

```bash
curl https://x402-spend-reviews.g-764.workers.dev/health
# {"ok":true,"pending":0}
```

That one call exercises the whole stack: `pending` is a real `COUNT(*)` against the reviews
table, so an unmigrated database answers with an error rather than a zero.

## The verification rule, in plain words

A submission names a network, a settlement, a payer, a recipient, an asset and an amount. The
server fetches that settlement over the network's own JSON-RPC and looks for the payment the review
claims. What counts as proof differs by family, because the chains differ.

### EVM (`eip155:*`)

An ERC-20 `Transfer` log that matches all of it:

1. The transaction exists and succeeded (`status` is `0x1`).
2. A log on the **asset's contract** carries the `Transfer(address,address,uint256)` topic.
3. That log's sender is the claimed **payer**.
4. That log's recipient is the claimed **payTo**.
5. That log's value is exactly the claimed **amount**, in atomic units.

The payer is read from the Transfer log, **never** from the transaction sender. Under EIP-3009
`transferWithAuthorization` the facilitator broadcasts the transaction and pays the gas, so
`tx.from` is the facilitator, not the buyer. Reading the buyer from `tx.from` would credit every
review on the network to a handful of facilitators.

### Solana (`solana:*`)

The rule is the exact-SVM scheme's own, from `specs/schemes/exact/scheme_exact_svm.md` 1.2-1.4:

1. The transaction exists and `meta.err` is null.
2. Across every top-level instruction **and the full CPI trace**, exactly one token transfer
   credits the associated token account derived from `payTo`, the `asset` mint, and the token
   program the transfer ran on.
3. Zero matching transfers is a `422`. **More than one is also a `422`**: a transaction that can be
   read two ways is not proof of one payment, and picking which transfer to call the payment would
   be guessing rather than verifying.
4. The amount may **exceed** what was claimed but never fall short — smart wallets round up — and
   the amount actually moved is what gets recorded.
5. The payer is the transfer's own **authority**, never the transaction's fee payer. On a sponsored
   transaction the sponsor signs and pays, exactly as the facilitator broadcasts on EVM.

The matching transfer may be a top-level instruction **or an inner instruction emitted by another
program**, which is how smart wallets such as Squads and Swig satisfy the scheme. A verifier that
read only the top level would refuse honest payments. Extra instructions invalidate nothing; only
matching transfers are counted.

Checking the destination is a single comparison, because an associated token account address
commits to its owner, its mint and its token program at once. That is also what lets a bare
`transfer`, which carries no mint of its own, be checked at all.

The token program is a property of the mint rather than of the chain — USDC is SPL Token, while
USDG, PYUSD and CASH are Token-2022 — so both are tried, and the destination is derived under
whichever one the transfer actually used.

### When the payer cannot be established

If a node returns **no inner instructions at all** — indexing lag, which is not the same as a
transaction that made no CPI calls — the scheme allows a weaker check, and the server falls back to
it: the destination's balance for that mint rose by at least the amount (3.4).

That shows payTo was credited. It cannot show **who** credited it, because no transfer was ever
read. So the two are recorded apart, in a `proof` column:

- `payment_traced` — the transfer itself was found, so the payer is known.
- `receipt_only` — only the balance moved, so the payer is not established.

`receipt_only` rows are published and marked rather than hidden: the payment is real. They are
excluded from the quality findings in [RESEARCH-METHOD.md](./RESEARCH-METHOD.md), because a review
whose payer cannot be established is not evidence about that payer. On the page they carry an amber
marker beside the outcome and their text is dimmed, and the count line says how many there are —
and says nothing at all when there are none.

### Both families

Any miss is a `422` naming the check that failed, and nothing is stored.

A submission whose `payer` and `payTo` are the same account is refused before any of this, without
spending an RPC call. Such a transfer would verify perfectly and still mean nothing: paying yourself
proves a transaction happened, not that a purchase did.

`asset` must be an address — a contract on EVM, a mint on Solana. Symbolic names are refused, so a
review claiming one token can never be proved by a transfer of another.

## Networks

Verified today, each with a public endpoint and an overridable secret:

| Network | CAIP-2 | Secret |
|---|---|---|
| Base | `eip155:8453` | `RPC_URL_8453` |
| Base Sepolia | `eip155:84532` | `RPC_URL_84532` |
| Avalanche | `eip155:43114` | `RPC_URL_43114` |
| Avalanche Fuji | `eip155:43113` | `RPC_URL_43113` |
| Arbitrum One | `eip155:42161` | `RPC_URL_42161` |
| BNB Smart Chain | `eip155:56` | `RPC_URL_56` |
| Solana | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | `RPC_URL_SOLANA` |
| Solana devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | `RPC_URL_SOLANA_DEVNET` |

**BNB Smart Chain has no USDC constant**, deliberately. Circle publishes no native USDC for it,
so what circulates there under the name is Binance-Peg — a different issuer with different
redemption. Reviews on chain 56 still verify normally, because `asset` is a contract address the
submission names; there is simply no symbolic `usdc` shorthand for that chain, since any address
put there would be a bridged token wearing Circle's name.

Network names are **normalized to CAIP-2 rather than refused over spelling**. Clients in the wild
write the same chain half a dozen ways, so `solana`, `solana-mainnet`, `solana-mainnet-beta` and
`solana:mainnet` all mean Solana mainnet here; `base` and `base-mainnet` mean Base; `polygon`,
`bsc`, `arbitrum` and `avalanche` resolve to their chain ids. An id that is already CAIP-2 passes
through untouched, **casing included**, because the Solana half of one is base58, where case is a
digit rather than a decoration.

A chain that normalizes but has no configured endpoint is refused with `no RPC endpoint configured
for eip155:137` — the real gap, which you close by setting a URL, rather than a complaint about how
the chain was spelled.

## POST is safe to retry

Reviews are unique on `(transaction, payer)`: one payment buys exactly one review.

A repost whose settlement facts still match the stored row **skips the chain call entirely** — a
settlement already proved cannot change — and applies the verdict: `201` the first time, `200`
on every replay, with an identical body. Retry blindly; there is no duplicate to clean up and no
`409` to handle. Changing your mind relabels the existing review rather than adding a second
voice, and notes can be edited on their own.

A repost whose `amount`, `asset`, `payTo` or `network` disagrees with the stored row is refused
with a `422`: one transaction cannot have carried two different payments.

### When the chain is unreachable

That is this server's problem, not yours. The review is stored as `pending` and answered `202`.
A cron trigger re-verifies pending rows every five minutes, and each moves on its own evidence —
proved becomes `verified`, contradicted becomes `rejected`, still-unreachable keeps its place
with an attempt spent, up to five. Reads serve `verified` rows only, so nothing unproved is ever
published. A `503` means only that the database write failed.

There is no queue and no worker process. `retryPending` is a function that a cron calls. If one
tick ever stops keeping up with the backlog, that is the moment to reach for Queues — not before.

## Reviews are public

Every published review is public and **includes the payer address**. That is disclosed, not
hidden: it is what lets anyone re-check the claim against the chain. Reviews carry no receipt
internals — no legs, byte counts, HTTP status, offered alternatives, or the client's local
receipt id — and a submission carrying any of those is rejected rather than quietly trimmed.
`resourceUrl` must already have its query string and fragment stripped, so secrets in URLs are
never accepted in the first place.

## License

Code: **MIT**. See [LICENSE](./LICENSE).

Review data served by this API: **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**, full
text in [DATA-LICENSE.md](./DATA-LICENSE.md); attribute x402-spend-reviews. Reviews are contributed
data, and this line was fixed before the first review landed, because it cannot fairly be changed
afterwards.

## API

```
POST /v1/reviews          → 201 verified | 200 replayed | 202 pending | 422 | 429 | 503
GET  /v1/reviews?resource=<url>  → { resourceUrl, counts, reviews }
GET  /v1/reviews/recent   → { reviews }   last 100 verified, newest first
GET  /health              → { ok, pending }
POST /internal/retry      → Authorization: Bearer <ADMIN_TOKEN>; runs one retry pass
```

JSON only. `GET` is CORS-open to any origin; `POST` is not, because publishing a review is a
server-to-server act no browser should be talked into performing on someone's behalf.

**Rate limits**, per IP: 30 POST/minute, 300 GET/minute. `/health` is exempt. Over the limit is a
`429`. Bodies are capped at 4096 bytes.

### Submission

```json
{
  "schema": 1,
  "resourceUrl": "https://api.example/paid",
  "taskClass": "search",
  "network": "eip155:84532",
  "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "amount": "10000",
  "payTo": "0x...",
  "transaction": "0x...",
  "payer": "0x...",
  "outcome": "useful",
  "note": "clean answer",
  "paidMs": 412,
  "ts": "2026-09-06T12:00:00.000Z"
}
```

`outcome` is `useful` or `not_useful`. Two, not four: the response either gave the buyer what they
wrote down before paying or it did not, and whether they then retried or went elsewhere is recovery
from that failure rather than a third kind of outcome. `unlabeled` is rejected — an unlabeled
receipt has no verdict to publish — and the four labels used before 0.3 are refused **by name**,
saying what replaced them rather than answering "invalid option".

`reason` is **required** when the outcome is `not_useful` and **refused** when it is `useful`,
because "it worked" is not a finding about anything. One of `no_response`, `empty`, `malformed`,
`wrong`, `stale`, `insufficient` — a closed set, so reasons aggregate across calls instead of each
describing one. `wrong`, `empty` and `malformed` are kept apart deliberately: the difference between
an endpoint that is broken and one that is lying is a different finding about a seller, and a single
failure rate throws it away.

`recovery` is optional everywhere and is never an outcome: `none`, `retried_same`, `went_elsewhere`,
`abandoned`. Free-text `note` stays alongside the code, so specifics survive without polluting the
closed set.

Cost per useful result is spend ÷ the count of `useful`. Everything spent reaching `not_useful` is
waste, however it was recovered.

On Solana the same fields are base58 rather than hex: `network` is a `solana:` id, `asset` is a
mint, `payTo` and `payer` are account addresses, and `transaction` is a 64-byte signature.

Every verified review served back carries `proof`, either `payment_traced` or `receipt_only`, on
every row whatever its value. The page hides that caveat when there is nothing to say; the JSON
never does.

## Running it

Cloudflare Workers and D1. Runtime dependencies are `hono`, `@hono/zod-validator` and `zod`;
verification is raw JSON-RPC over `fetch`, with no chain client library.

```bash
npm install
npm test              # vitest under the Workers pool, against a local D1
npm run typecheck
npm run dev
```

Configuration lives in `wrangler.toml`: the D1 binding, the two rate-limit bindings, the cron
trigger, and observability. **Secrets never go in that file.**

```bash
wrangler d1 create x402-spend-reviews      # then paste database_id into wrangler.toml
npm run migrate:local
npm run migrate:remote

wrangler secret put RPC_URL_8453           # Base mainnet JSON-RPC
wrangler secret put RPC_URL_84532          # Base Sepolia JSON-RPC
wrangler secret put RPC_URL_43114          # Avalanche (optional)
wrangler secret put RPC_URL_42161          # Arbitrum One (optional)
wrangler secret put RPC_URL_56             # BNB Smart Chain (optional)
wrangler secret put RPC_URL_SOLANA         # Solana mainnet JSON-RPC (optional)
wrangler secret put RPC_URL_SOLANA_DEVNET  # Solana devnet JSON-RPC (optional)
wrangler secret put ADMIN_TOKEN            # guards POST /internal/retry

npm run deploy
```

For local development the same values go in `.dev.vars`, which is gitignored.

Without a configured endpoint a network falls back to its public one. Those are shared and
rate-limited — the public Solana endpoints especially, which throttle hard enough to park reviews
as `pending` under load — so set your own for anything real. Every RPC call sends a `User-Agent`,
because the public endpoints answer `403` to clients that do not identify themselves.

`compatibility_date` is pinned to the newest date the whole toolchain accepts; the vitest pool's
bundled workerd currently lags wrangler's, so raising it past that breaks the suite before it
breaks production.

## Layout

Three groups.

**`src/verify/` — proving a payment happened.** `index.ts` dispatches on network family. `evm.ts`
and `svm.ts` hold the two rules. `rpc.ts` is the JSON-RPC caller they share. `solana-address.ts` is
base58, the ed25519 on-curve test and associated-token-account derivation.

**The domain, flat in `src/`.** `vocab.ts` names the closed sets — outcome, status, proof, network
family, the fixed rejection reasons — and every literal of those kinds refers to it, so a misspelled
status fails to compile rather than quietly writing a row nothing will ever match. `network.ts` owns
network identity: canonical ids, the aliases, and which spelling each family uses. `review.ts` is
the zod schema, the single definition of what a submission may contain. `state.ts` is the lifecycle
as pure functions, with no I/O. `store.ts` is the only file that knows SQL.

**The edges, flat in `src/`.** `index.ts` is the Worker entry, `fetch` and cron. `app.ts` holds the
routes, CORS and rate limiting. `page.ts` renders the public page. `retry.ts` is one pass over the
pending backlog, called by both the cron and the admin route.

Two files sit outside those groups: `fixtures.ts`, which is imported by `src` and `test` alike and
is the only place a transaction receipt is hand-built, and `env.d.ts`, which declares the secrets
`wrangler types` cannot see because they exist only in production.

## [Roadmap](https://github.com/gideonibemerejr/x402-spend-reviews/issues?q=is%3Aissue+is%3Aopen+label%3Aroadmap)

Verification covers ERC-20 transfers on EVM chains and the exact-SVM scheme on Solana. In order:

1. Per-endpoint pages (`/r/<host>/<path>`) and a leaderboard by task class, once there are enough reviews to rank.
2. Reviewer weighting: distinct endpoints paid, spend spread, account age. A payer with one transaction to one endpoint carries near-zero weight. Published as part of the score, never hidden.
3. Fiat-rail verification via facilitator-signed receipts (the `offer-receipt` extension), for payments with no chain.
4. Batch-settlement handling when a voucher redemption nets amounts.
5. Signed responses and a public dump, so the dataset can be mirrored and checked without trusting this server.

Not planned: accounts, seller-submitted outcomes, or any review that isn't tied to a settlement.

## Tests

Offline and deterministic. Transaction receipts are hand-built fixtures injected through the
`RpcCall` seam, so nothing reaches a real chain, and D1 is the pool's local database with the
migrations applied in setup. Rate limiting is exercised against the binding's local emulation.

Solana verification is exercised the same way: hand-written `getTransaction` responses covering a
top-level transfer, a transfer reachable only through the CPI trace, two matching transfers, a wrong
mint, a wrong destination, a shortfall, an overpayment, a failed transaction, the fee payer
submitted as the buyer, and the balance-delta fallback.

base58, the on-curve test and ATA derivation were cross-checked against `@solana/web3.js` and
`@solana/spl-token` on 1081 vectors before those libraries were set aside. Neither is a dependency
of this repo, and the fixture addresses were generated by them, so the fixtures do not come from the
code they are used to check.

Every USDC contract address and Solana mint is checked against
[Circle's published list](https://developers.circle.com/stablecoins/usdc-contract-addresses) by a
test — including two that assert the *native* issue rather than the older bridged USDC.e that
shares its name on Avalanche and Arbitrum — and the SPL Token, Token-2022 and associated-token-account program ids against their own
published addresses. A wrong constant fails the build rather than silently verifying against the
wrong token — or, in the ATA program's case, quietly deriving addresses that match nothing and
refusing every honest Solana payment.

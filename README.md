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

A submission names a transaction, a payer, a recipient, an asset contract and an amount. The
server fetches that transaction's receipt over JSON-RPC and looks for an ERC-20 `Transfer` log
that matches all of it:

1. The transaction exists and succeeded (`status` is `0x1`).
2. A log on the **asset's contract** carries the `Transfer(address,address,uint256)` topic.
3. That log's sender is the claimed **payer**.
4. That log's recipient is the claimed **payTo**.
5. That log's value is exactly the claimed **amount**, in atomic units.

Any miss is a `422` naming the check that failed, and nothing is stored.

A submission whose `payer` and `payTo` are the same address is refused before any of this, without
spending an RPC call. Such a transfer would verify perfectly and still mean nothing: paying yourself
proves a transaction happened, not that a purchase did.

The payer is read from the Transfer log, **never** from the transaction sender. Under EIP-3009
`transferWithAuthorization` the facilitator broadcasts the transaction and pays the gas, so
`tx.from` is the facilitator, not the buyer. Reading the buyer from `tx.from` would credit every
review on the network to a handful of facilitators.

`asset` must be a contract address. Symbolic names are refused, so a review claiming one token
can never be proved by a transfer of another.

EVM chains only (`eip155:*`); Base mainnet and Base Sepolia are configured. Anything else is a
`422`. Solana verification is a follow-up.

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

## Licence

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
  "outcome": "used",
  "note": "clean answer",
  "paidMs": 412,
  "ts": "2026-09-06T12:00:00.000Z"
}
```

`outcome` is one of `used`, `retried`, `discarded`, `failed`. `unlabeled` is rejected: an
unlabeled receipt has no verdict to publish.

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
wrangler secret put ADMIN_TOKEN            # guards POST /internal/retry

npm run deploy
```

For local development the same three values go in `.dev.vars`, which is gitignored.

Without a configured endpoint, a chain falls back to the public Base RPC. Those are shared and
rate-limited, so set your own for anything real. Every RPC call sends a `User-Agent`, because the
public endpoints answer `403` to clients that do not identify themselves.

`compatibility_date` is pinned to the newest date the whole toolchain accepts; the vitest pool's
bundled workerd currently lags wrangler's, so raising it past that breaks the suite before it
breaks production.

## Tests

Offline and deterministic. Transaction receipts are hand-built fixtures injected through the
`RpcCall` seam, so nothing reaches a real chain, and D1 is the pool's local database with the
migrations applied in setup. Rate limiting is exercised against the binding's local emulation.

USDC contract addresses are checked against
[Circle's published list](https://developers.circle.com/stablecoins/usdc-contract-addresses) by a
test, so a wrong constant fails the build rather than silently verifying against the wrong token.

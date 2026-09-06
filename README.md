# x402-spend-reviews

A verification server for reviews of paid x402 endpoints. A review is accepted only when the
settlement transaction on chain proves the payment it claims, so the tx hash is the proof of purchase.

This is the server half of [x402-spend](https://github.com/gideonibemerejr/x402-spend) 0.3. Existing
tools grade x402 endpoints from probes and on-chain volume, and state plainly that they do not verify
whether anything was delivered after payment. That is the gap this fills: every review here is anchored
to a settlement that actually happened, by a payer who actually paid.

## The verification rule, in plain words

A submission names a transaction, a payer, a recipient, an asset and an amount. The server fetches
that transaction's receipt over JSON-RPC and looks for an ERC-20 `Transfer` log that matches all of it:

1. The transaction exists and succeeded (`status` is `0x1`).
2. A log on the **asset's contract** carries the `Transfer(address,address,uint256)` topic.
3. That log's sender is the claimed **payer**.
4. That log's recipient is the claimed **payTo**.
5. That log's value is exactly the claimed **amount**, in atomic units.

Any miss is a `422` naming the check that failed. Nothing is stored until every check passes.

The payer is always read from the transfer log, **never** from the transaction sender. Under EIP-3009
`transferWithAuthorization` the facilitator broadcasts the transaction and pays the gas, so `tx.from`
is the facilitator, not the buyer. Reading the buyer from `tx.from` would attribute every review to
the facilitator.

Asset resolution is deliberately narrow: an `asset` that is already a contract address is used as-is,
and the only symbolic name recognised is `usdc`, which resolves to Circle's published contract for that
chain. An unrecognised name is rejected rather than assumed to be USDC — otherwise a review claiming
one token could be verified against a transfer of another.

EVM chains only in 0.3 (`eip155:*`). Anything else is a `422`. Solana verification is a follow-up.

### One settlement, one review

Rows are unique on `(transaction, payer)`. Posting the same settlement again with a **different**
outcome relabels the existing review (`200`); posting the same outcome again is a `409`. A buyer can
change their mind, but cannot vote twice with one payment.

## Reviews are public

Every stored review is public and **includes the payer address**. That is disclosed, not hidden — it
is what makes a review checkable by anyone. Reviews carry no receipt internals: no legs, byte counts,
HTTP status, offered alternatives, or the client's local receipt id. Receipts stay on the client
machine by default; publishing a review is opt-in, per meter instance.

## Licence

Code: **MIT**. See [LICENSE](./LICENSE).

Review data served by this API: **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**.
Reviews are contributed data, and this line is fixed before the first review lands, because it cannot
fairly be changed afterwards.

## API

```
POST /v1/reviews          → 201 {id, verified, updated} | 200 relabelled | 409 | 422 | 503
GET  /v1/reviews?resource=<url>  → { resourceUrl, counts, reviews }
GET  /v1/reviews/recent   → { reviews }   last 100, newest first
GET  /health              → { ok: true }
```

JSON only. `GET` is CORS-open to any origin. A `503` means the chain could not be reached — the claim
may well be true, this server just could not check it, so retry rather than treating it as a rejection.

### Submission

```json
{
  "schema": 1,
  "resourceUrl": "https://api.example/paid",
  "taskClass": "search",
  "network": "eip155:84532",
  "asset": "usdc",
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

`outcome` is one of `used`, `retried`, `discarded`, `failed`. `unlabeled` is rejected: an unlabeled
receipt has no verdict to publish. `resourceUrl` must already have its query string and fragment
stripped, so secrets in URLs are never accepted in the first place.

## Running it

Requires Node **≥ 22.5** for `node:sqlite`. No runtime dependencies: `node:http`, `node:sqlite`, and
raw JSON-RPC over `fetch`.

```bash
npm install
npm test
npm run build && npm start
```

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8402` | Listen port |
| `DB_PATH` | `x402-spend-reviews.db` | SQLite file |
| `RPC_URL_8453` | `https://mainnet.base.org` | Base mainnet JSON-RPC |
| `RPC_URL_84532` | `https://sepolia.base.org` | Base Sepolia JSON-RPC |

The public Base endpoints are shared and rate-limited; set your own for any real deployment. A chain
with no configured endpoint is refused rather than silently skipped.

Deploys anywhere Node ≥ 22.5 runs. The database is a single file.

## Tests

The suite is fixture-driven and never touches a network: transaction receipts are hand-built and
injected through the `RpcCall` seam, so `npm test` is fully offline and deterministic.

USDC contract addresses are checked against
[Circle's published list](https://developers.circle.com/stablecoins/usdc-contract-addresses)
by a test, so a bad constant fails the build rather than silently verifying against the wrong token.

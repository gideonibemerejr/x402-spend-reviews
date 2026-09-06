/**
 * The public page: the recent verified reviews, rendered on the server.
 *
 * No client JavaScript, no framework, no build step — the whole point of the
 * dataset is that anyone can check it, so the page that shows it should be
 * legible from `view-source` and work with scripting off.
 */
import type { StoredReview } from "./store";

const REPO_CLIENT = "https://github.com/gideonibemerejr/x402-spend";
const REPO_SERVER = "https://github.com/gideonibemerejr/x402-spend-reviews";

/** Block explorers by EIP-155 chain id. An unknown chain renders the hash unlinked. */
const EXPLORERS: Readonly<Record<string, string>> = {
  "eip155:8453": "https://basescan.org",
  "eip155:84532": "https://sepolia.basescan.org",
};

/** USDC atomic units. Every asset this server verifies today is USDC. */
const USDC_DECIMALS = 6;

/**
 * Escapes text for HTML.
 *
 * Every value on this page came from a request body, so all of it is untrusted
 * regardless of having passed verification: proving a payment says nothing
 * about the note attached to it.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Renders atomic units as a fixed-point amount. Non-numeric input is shown as-is. */
export function formatAmount(atomic: string, decimals = USDC_DECIMALS): string {
  if (!/^\d+$/.test(atomic)) return atomic;
  const digits = atomic.padStart(decimals + 1, "0");
  return `${digits.slice(0, digits.length - decimals)}.${digits.slice(digits.length - decimals)}`;
}

/** Shortens a transaction hash for display; the full value stays in `title`. */
export function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

/** `2026-09-06 19:38 UTC`, sortable and unambiguous. */
function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #0f1115;
  color: #d6d8de;
  font: 13px/1.5 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
main { max-width: 1100px; margin: 0 auto; padding: 24px; }
h1 { font-size: 15px; font-weight: 700; margin: 0; }
.sub { color: #8a8f9c; margin: 4px 0 20px; }
.foot { color: #8a8f9c; margin: 20px 0 0; }
a { color: #d6d8de; }
.sub a, .foot a { color: #8a8f9c; }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #23262e; vertical-align: top; }
th { text-transform: uppercase; font-size: 11px; font-weight: 400; color: #8a8f9c; white-space: nowrap; }
tbody tr:hover { background: #171a21; }
.endpoint { word-break: break-all; min-width: 180px; }
.amount { text-align: right; white-space: nowrap; }
.hash, .at { white-space: nowrap; }
.muted { color: #8a8f9c; }
.pill {
  display: inline-block; padding: 1px 8px; border-radius: 10px;
  font-size: 11px; color: #0f1115; background: #8a8f9c;
}
.used { background: #2ea56b; }
.retried { background: #d9a441; }
.discarded, .failed { background: #d05252; }
.empty { color: #8a8f9c; padding: 24px 0; }
@media (max-width: 639px) {
  main { padding: 16px; }
  .col-network, .col-task { display: none; }
}
`.trim();

/** One table row, with every field escaped. */
function row(review: StoredReview): string {
  const explorer = EXPLORERS[review.network];
  const hash = escapeHtml(review.transaction);
  const hashCell = explorer
    ? `<a href="${escapeHtml(`${explorer}/tx/${review.transaction}`)}" title="${hash}" rel="noopener noreferrer">${escapeHtml(shortHash(review.transaction))}</a>`
    : `<span title="${hash}">${escapeHtml(shortHash(review.transaction))}</span>`;
  const outcome = escapeHtml(review.outcome);

  return `<tr>
<td class="endpoint">${escapeHtml(review.resourceUrl)}</td>
<td class="col-task">${review.taskClass ? escapeHtml(review.taskClass) : '<span class="muted">—</span>'}</td>
<td><span class="pill ${outcome}">${outcome}</span></td>
<td class="amount" title="${escapeHtml(review.amount)} atomic units">${escapeHtml(formatAmount(review.amount))}</td>
<td class="col-network">${escapeHtml(review.network)}</td>
<td class="hash">${hashCell}</td>
<td class="at" title="${escapeHtml(review.verifiedAt ?? "")}">${escapeHtml(formatTimestamp(review.verifiedAt))}</td>
</tr>`;
}

/**
 * Renders the recent-reviews page.
 *
 * @param reviews - Verified reviews, newest first.
 */
export function renderPage(reviews: StoredReview[]): string {
  const body = reviews.length
    ? `<div class="scroll"><table>
<thead><tr>
<th>Endpoint</th><th class="col-task">Task</th><th>Outcome</th>
<th class="amount">Amount</th><th class="col-network">Network</th>
<th>Tx</th><th>Reviewed at</th>
</tr></thead>
<tbody>
${reviews.map(row).join("\n")}
</tbody></table></div>`
    : `<p class="empty">No verified reviews yet.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402-spend-reviews — recent verified reviews</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>x402-spend-reviews</h1>
<p class="sub">The last 100 reviews verified against their settlement on chain, newest first. <a href="/v1/reviews/recent">JSON</a> · <a href="${REPO_SERVER}">server</a> · <a href="${REPO_CLIENT}">client</a></p>
${body}
<p class="foot">Reviews are verified against the settlement on-chain. Data <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</p>
</main>
</body>
</html>
`;
}

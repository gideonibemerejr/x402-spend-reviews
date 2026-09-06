/**
 * The public page: the recent verified reviews, rendered on the server.
 *
 * No client JavaScript, no framework, no build step — the whole point of the
 * dataset is that anyone can check it, so the page that shows it should be
 * legible from `view-source` and work with scripting off.
 *
 * The markup and the style block below follow design/index.mock.html.
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
  return hash.length > 14 ? `${hash.slice(0, 8)}\u2026${hash.slice(-5)}` : hash;
}

/** Drops the scheme so the endpoint column reads as a name rather than a URL. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** `Sep 6, 18:59 UTC` — short enough for the column, unambiguous about the zone. */
function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "\u2014";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const month = at.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = at.getUTCDate();
  const time = at.toISOString().slice(11, 16);
  return `${month} ${day}, ${time} UTC`;
}

const STYLE = `
  :root{
    --bg:#121417; --panel:#171a1e; --rule:#262b33; --text:#d7dae0; --muted:#8b919d;
    --used:#37b26f; --retried:#d8a33b; --bad:#d4574f; --link:#9ec1ff;
  }
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,"Segoe UI",Inter,Roboto,sans-serif}
  a{color:var(--link);text-decoration:none}
  a:hover,a:focus-visible{text-decoration:underline;outline:none}
  .wrap{max-width:1100px;margin:0 auto;padding:40px 24px 64px}
  header{margin-bottom:28px}
  h1{font-size:32px;line-height:1.15;margin:0 0 8px;font-weight:650;letter-spacing:-.01em}
  h1 span{color:var(--muted);font-weight:500}
  p.lede{margin:0;color:var(--muted);max-width:62ch}
  .links{margin-top:14px;display:flex;flex-wrap:wrap;gap:14px;font-size:14px}
  .count{display:inline-flex;align-items:center;gap:8px;margin:22px 0 10px;font-size:14px;color:var(--muted)}
  .count b{color:var(--text);font-weight:600}
  .count i{width:8px;height:8px;border-radius:50%;background:var(--used);display:inline-block}
  table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--rule);border-radius:6px;overflow:hidden}
  th,td{padding:10px 12px;text-align:left;vertical-align:top;border-top:1px solid var(--rule)}
  thead th{border-top:0;color:var(--muted);font-weight:500;font-size:13px}
  tbody tr:hover{background:#1c2026}
  td.mono,th.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13.5px}
  td.amt,th.amt{text-align:right}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12.5px;font-weight:600;line-height:1.6;color:#0c0f12}
  .pill.used{background:var(--used)} .pill.retried{background:var(--retried)} .pill.discarded,.pill.failed{background:var(--bad)}
  .ep{display:block;max-width:34ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .note{color:var(--muted);font-size:13.5px;margin-top:4px;max-width:44ch;white-space:normal}
  footer{margin-top:22px;color:var(--muted);font-size:13.5px;display:flex;flex-wrap:wrap;gap:6px 18px}
  @media (max-width:640px){
    .wrap{padding:28px 16px 48px}
    h1{font-size:26px}
    .hide-sm{display:none}
    th,td{padding:9px 10px}
  }
  .scroll{overflow-x:auto}
  .empty{color:var(--muted);padding:24px 0}
  @media (prefers-reduced-motion:no-preference){ tbody tr{transition:background .12s} }
`.trim();

/** One table row, with every field escaped. */
function row(review: StoredReview): string {
  const explorer = EXPLORERS[review.network];
  const url = escapeHtml(review.resourceUrl);
  const hash = escapeHtml(review.transaction);
  const short = escapeHtml(shortHash(review.transaction));
  const outcome = escapeHtml(review.outcome);

  const txCell = explorer
    ? `<a href="${escapeHtml(`${explorer}/tx/${review.transaction}`)}" title="${hash}" rel="noopener noreferrer">${short}</a>`
    : `<span title="${hash}">${short}</span>`;
  const note = review.note ? `<div class="note">${escapeHtml(review.note)}</div>` : "";

  return `      <tr>
        <td><a class="ep" href="${url}" title="${url}" rel="noopener noreferrer">${escapeHtml(displayUrl(review.resourceUrl))}</a>${note}</td>
        <td class="hide-sm">${review.taskClass ? escapeHtml(review.taskClass) : "\u2014"}</td>
        <td><span class="pill ${outcome}">${outcome}</span></td>
        <td class="amt mono" title="${escapeHtml(review.amount)} atomic units">${escapeHtml(formatAmount(review.amount))} USDC</td>
        <td class="hide-sm mono">${escapeHtml(review.network)}</td>
        <td class="mono">${txCell}</td>
        <td class="hide-sm">${escapeHtml(formatTimestamp(review.verifiedAt))}</td>
      </tr>`;
}

/**
 * Renders the recent-reviews page.
 *
 * @param reviews - Verified reviews, newest first.
 * @param pending - Reviews waiting on a chain that could not be reached.
 */
export function renderPage(reviews: StoredReview[], pending = 0): string {
  const table = reviews.length
    ? `  <div class="scroll">
  <table>
    <thead>
      <tr>
        <th>Endpoint</th>
        <th class="hide-sm">Task</th>
        <th>Outcome</th>
        <th class="amt">Paid</th>
        <th class="hide-sm">Network</th>
        <th class="mono">Tx</th>
        <th class="hide-sm">Reviewed</th>
      </tr>
    </thead>
    <tbody>
${reviews.map(row).join("\n")}
    </tbody>
  </table>
  </div>`
    : `  <p class="empty">No verified reviews yet.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402-spend-reviews</title>
<style>
${STYLE}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Verified reviews <span>of things agents paid for</span></h1>
    <p class="lede">Each row is a buyer's own verdict on an x402 endpoint, kept only after the payment behind it was found on-chain: the reviewer's address paid the endpoint's address the stated amount.</p>
    <nav class="links">
      <a href="/v1/reviews/recent">JSON</a>
      <a href="${REPO_CLIENT}">x402-spend</a>
      <a href="${REPO_SERVER}">x402-spend-reviews</a>
    </nav>
  </header>

  <div class="count"><i></i><b>${reviews.length} verified</b> \u00b7 newest first \u00b7 ${pending} pending</div>

${table}

  <footer>
    <span>Reviews are verified against the settlement on-chain.</span>
    <span>Data CC BY 4.0.</span>
  </footer>
</div>
</body>
</html>
`;
}

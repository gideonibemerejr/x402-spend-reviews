import { describe, expect, test } from "vitest";
import { escapeHtml, formatAmount, renderPage, shortHash } from "../src/page";
import type { StoredReview } from "../src/store";
import { harness } from "./helpers";

const stored = (overrides: Partial<StoredReview> = {}): StoredReview => ({
  schema: 1,
  id: "r1",
  resourceUrl: "https://api.test/paid",
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  amount: "10000",
  payTo: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  transaction: `0x${"ab".repeat(32)}`,
  payer: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  outcome: "used",
  ts: "2026-09-06T12:00:00.000Z",
  status: "verified",
  verifyAttempts: 1,
  verifiedAt: "2026-09-06T19:38:00.000Z",
  createdAt: "2026-09-06T19:38:00.000Z",
  updatedAt: "2026-09-06T19:38:00.000Z",
  ...overrides,
});

describe("formatting", () => {
  test("atomic units render as USDC with six decimals", () => {
    expect(formatAmount("10000")).toBe("0.010000");
    expect(formatAmount("1000000")).toBe("1.000000");
    expect(formatAmount("0")).toBe("0.000000");
    expect(formatAmount("123456789")).toBe("123.456789");
    // Anything the schema would not have accepted is shown rather than mangled.
    expect(formatAmount("not-a-number")).toBe("not-a-number");
  });

  test("a hash is shortened for display but kept whole for the title", () => {
    expect(shortHash(`0x58156fc5${"0".repeat(52)}478c6`)).toBe("0x58156f…478c6");
    expect(shortHash("0xshort")).toBe("0xshort");
  });

  test("markup characters are escaped", () => {
    expect(escapeHtml(`<script>"&'`)).toBe("&lt;script&gt;&quot;&amp;&#39;");
  });
});

describe("the page", () => {
  test("a review links its transaction to the explorer for its chain", () => {
    const sepolia = renderPage([stored()]);
    expect(sepolia).toContain(`https://sepolia.basescan.org/tx/0x${"ab".repeat(32)}`);

    const mainnet = renderPage([stored({ network: "eip155:8453" })]);
    expect(mainnet).toContain(`https://basescan.org/tx/0x${"ab".repeat(32)}`);
    expect(mainnet).not.toContain("sepolia.basescan.org");
  });

  test("an unknown chain shows the hash without inventing an explorer", () => {
    const html = renderPage([stored({ network: "eip155:1" })]);
    expect(html).toContain("0xababab…babab");
    expect(html).not.toContain("basescan.org");
  });

  test("the amount is displayed formatted with the raw atomic value kept", () => {
    const html = renderPage([stored({ amount: "5001" })]);
    expect(html).toContain("0.005001");
    expect(html).toContain('title="5001 atomic units"');
  });

  test("values from the database cannot inject markup", () => {
    const html = renderPage([stored({
      taskClass: '<script>alert("x")</script>',
      resourceUrl: "https://api.test/a&b",
    })]);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("https://api.test/a&amp;b");
  });

  test("the count line reports the verified total and the pending backlog", () => {
    expect(renderPage([stored(), stored({ id: "r2" })], 3))
      .toContain("<b>2 verified</b> · newest first · 3 pending");
    expect(renderPage([], 0)).toContain("<b>0 verified</b> · newest first · 0 pending");
  });

  test("a note is shown under its endpoint, and omitted entirely when absent", () => {
    const withNote = renderPage([stored({ note: "stale results, 3 of 10 links dead" })]);
    expect(withNote).toContain('<div class="note">stale results, 3 of 10 links dead</div>');
    expect(renderPage([stored()])).not.toContain('class="note"');
  });

  test("the amount carries its unit and the endpoint drops its scheme", () => {
    const html = renderPage([stored()]);
    expect(html).toContain("0.010000 USDC");
    expect(html).toContain(">api.test/paid</a>");
  });

  test("an empty dataset says so rather than rendering an empty table", () => {
    const html = renderPage([]);
    expect(html).toContain("No verified reviews yet.");
    expect(html).not.toContain("<table>");
  });

  test("the page states what it is and links the JSON and both repos", () => {
    const html = renderPage([stored()]);
    expect(html).toContain("Verified reviews <span>of things agents paid for</span>");
    expect(html).toContain("kept only after the payment behind it was found on-chain");
    expect(html).toContain('href="/v1/reviews/recent"');
    expect(html).toContain("https://github.com/gideonibemerejr/x402-spend-reviews");
    expect(html).toContain("https://github.com/gideonibemerejr/x402-spend");
    expect(html).toContain("Reviews are verified against the settlement on-chain.");
    expect(html).toContain("CC BY 4.0");
    // One style block, no scripts, no web fonts.
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("fonts.googleapis");
  });
});

test("GET / serves the verified reviews as HTML", async () => {
  const api = harness({ rpc: () => async () => ({ status: "0x1", logs: [
    { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        `0x${"0".repeat(24)}9965507d1a55bcc2695c58ba16fb37d819b0a4dc`,
        `0x${"0".repeat(24)}976ea74026e726554db657fa54763abd0c3a0aa9`,
      ],
      data: `0x${(10000).toString(16).padStart(64, "0")}` },
  ] }) });
  expect((await api.post(api.valid({ taskClass: "web-search" }))).status).toBe(201);

  const response = await api.get("/");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/text\/html/);

  const html = await response.text();
  expect(html).toContain(api.transaction);
  expect(html).toContain(`https://sepolia.basescan.org/tx/${api.transaction}`);
  expect(html).toContain("web-search");
  expect(html).toContain("0.010000");
});

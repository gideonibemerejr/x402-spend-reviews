import { test } from "node:test";
import assert from "node:assert/strict";
import { ReviewStore } from "./store.js";
import { PAYER, TX_HASH, submission } from "./fixtures.js";

const store = () => new ReviewStore(":memory:");

test("a new settlement is created and reads back", () => {
  const reviews = store();
  const write = reviews.put(submission({ note: "worth it" }));
  assert.equal(write.status, "created");
  assert.equal(reviews.bySettlement(TX_HASH, PAYER)?.note, "worth it");
  assert.ok(write.review.verifiedAt);
  reviews.close();
});

test("one settlement holds one review: the same verdict twice is a duplicate", () => {
  const reviews = store();
  const first = reviews.put(submission());
  const second = reviews.put(submission());
  assert.equal(second.status, "duplicate");
  assert.equal(second.review.id, first.review.id);
  assert.equal(reviews.recent().length, 1);
  reviews.close();
});

test("a changed verdict relabels in place rather than adding a second voice", () => {
  const reviews = store();
  const first = reviews.put(submission({ outcome: "used", note: "worth it" }));
  const second = reviews.put(submission({ outcome: "discarded", note: "stale data" }));
  assert.equal(second.status, "updated");
  assert.equal(second.review.id, first.review.id);
  assert.equal(reviews.bySettlement(TX_HASH, PAYER)?.outcome, "discarded");
  assert.equal(reviews.bySettlement(TX_HASH, PAYER)?.note, "stale data");
  assert.equal(reviews.recent().length, 1);
  reviews.close();
});

test("the settlement key ignores address and hash casing", () => {
  const reviews = store();
  reviews.put(submission());
  const again = reviews.put(submission({
    transaction: TX_HASH.toUpperCase().replace("0X", "0x"),
    payer: PAYER.toLowerCase(),
    outcome: "failed",
  }));
  assert.equal(again.status, "updated");
  assert.equal(reviews.recent().length, 1);
  reviews.close();
});

test("counts tally per outcome for one resource and exclude other resources", () => {
  const reviews = store();
  reviews.put(submission({ transaction: `0x${"11".repeat(32)}`, outcome: "used" }));
  reviews.put(submission({ transaction: `0x${"22".repeat(32)}`, outcome: "used" }));
  reviews.put(submission({ transaction: `0x${"33".repeat(32)}`, outcome: "failed" }));
  reviews.put(submission({ transaction: `0x${"44".repeat(32)}`, resourceUrl: "https://api.test/other" }));

  const page = reviews.byResource("https://api.test/paid");
  assert.equal(page.reviews.length, 3);
  assert.deepEqual(page.counts, { used: 2, retried: 0, discarded: 0, failed: 1 });
  assert.deepEqual(reviews.byResource("https://api.test/none").counts,
    { used: 0, retried: 0, discarded: 0, failed: 0 });
  reviews.close();
});

test("recent returns newest first and honours its limit", () => {
  const reviews = store();
  for (let i = 0; i < 5; i++) {
    reviews.put(submission({ transaction: `0x${String(i).repeat(64)}`, note: `n${i}` }),
      new Date(Date.UTC(2026, 0, 1 + i)));
  }
  const recent = reviews.recent(3);
  assert.equal(recent.length, 3);
  assert.deepEqual(recent.map((r) => r.note), ["n4", "n3", "n2"]);
  reviews.close();
});

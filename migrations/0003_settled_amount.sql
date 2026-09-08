-- What the settlement actually moved, when it moved more than the review
-- claimed. The exact-SVM scheme tolerates an overpayment (spec 1.4: a match MAY
-- exceed the required amount, it MUST NOT be less), so the two figures can
-- honestly differ.
--
-- It needs its own column rather than overwriting `amount`, because `amount` is
-- what idempotency compares against: rewriting it with the observed figure would
-- make an honest repost of the same review look like a second, conflicting
-- settlement and refuse it with a 422. Null means the chain matched the claim.
ALTER TABLE reviews ADD COLUMN settled_amount TEXT;

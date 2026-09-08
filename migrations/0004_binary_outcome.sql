-- Two outcomes, not four, with the reason carried in its own closed set.
--
-- RESEARCH-METHOD.md is pre-registered on the binary model: a response either
-- gave the buyer what they wrote down before paying or it did not, and whether
-- they retried, went elsewhere or gave up is recovery from that failure rather
-- than a third kind of outcome.
ALTER TABLE reviews ADD COLUMN reason TEXT;
ALTER TABLE reviews ADD COLUMN recovery TEXT;

-- `used` was the one label that already meant "this answered the question".
UPDATE reviews SET outcome = 'useful' WHERE outcome = 'used';

-- `retried` recorded the recovery, never the reason. The recovery survives; no
-- reason is invented for it, because none was ever collected.
UPDATE reviews SET outcome = 'not_useful', recovery = 'retried_same' WHERE outcome = 'retried';

-- `discarded` said only that the answer was unusable, not which way. Guessing
-- between `wrong`, `empty` and `malformed` here would be fabricating the very
-- distinction the reason codes exist to preserve, so it stays null.
UPDATE reviews SET outcome = 'not_useful' WHERE outcome = 'discarded';

-- `failed` meant no response, an error, or paid-and-got-nothing, which is what
-- `no_response` now names.
UPDATE reviews SET outcome = 'not_useful', reason = 'no_response' WHERE outcome = 'failed';

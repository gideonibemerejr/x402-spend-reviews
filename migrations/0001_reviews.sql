-- One row per settlement. The unique index is the idempotency rule: a single
-- payment buys exactly one review, and a repost relabels it rather than adding
-- a second voice.
CREATE TABLE reviews (
  id            TEXT PRIMARY KEY,
  "transaction" TEXT NOT NULL,
  payer         TEXT NOT NULL,
  resource_url  TEXT NOT NULL,
  task_class    TEXT,
  network       TEXT NOT NULL,
  asset         TEXT NOT NULL,
  amount        TEXT NOT NULL,
  pay_to        TEXT NOT NULL,
  outcome       TEXT NOT NULL,
  note          TEXT,
  paid_ms       INTEGER,
  ts            TEXT NOT NULL,
  status        TEXT NOT NULL,        -- pending | verified | rejected
  verify_attempts INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  verified_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_reviews_tx_payer ON reviews ("transaction", payer);
CREATE INDEX ix_reviews_resource ON reviews (resource_url, status);
CREATE INDEX ix_reviews_status ON reviews (status, verify_attempts);

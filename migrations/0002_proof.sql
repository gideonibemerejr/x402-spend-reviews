-- How each verified payment was proved. `payment_traced` means the transfer
-- itself was found, so the payer is known; `receipt_only` means it was inferred
-- from the recipient's balance rising, which shows payTo was credited but not
-- who credited it. Run 001 excludes `receipt_only` rows from its quality
-- findings, so the distinction has to survive in the data, not just in a log.
ALTER TABLE reviews ADD COLUMN proof TEXT;

-- Every row verified before this column existed was proved by an EVM Transfer
-- log, which names its sender: that is a traced payment by any reading.
UPDATE reviews SET proof = 'payment_traced' WHERE status = 'verified';

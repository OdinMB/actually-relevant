-- Data only, no schema change: store subscriber addresses trimmed and lowercased,
-- the form the code now normalizes every lookup and write to (ADR-0023).
-- Safe: "email" has no unique constraint, so two rows collapsing to one address
-- cannot fail.
UPDATE "pending_subscriptions" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));

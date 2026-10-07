-- The unique index "pending_subscriptions_token_key" already serves lookups by token.
-- DropIndex
DROP INDEX "pending_subscriptions_token_idx";

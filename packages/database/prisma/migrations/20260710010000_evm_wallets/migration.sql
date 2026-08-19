-- Robinhood Chain migration: users get EVM wallets; preserve the old
-- Solana wallet + key so any funds remain recoverable.
ALTER TABLE "users" ADD COLUMN "legacy_wallet_address" VARCHAR(44);
ALTER TABLE "users" ADD COLUMN "legacy_encrypted_key" TEXT;

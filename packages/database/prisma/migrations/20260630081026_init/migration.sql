-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "wallet_address" VARCHAR(44) NOT NULL,
    "encrypted_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" SERIAL NOT NULL,
    "address" VARCHAR(44) NOT NULL,
    "name" VARCHAR(100),
    "symbol" VARCHAR(20),
    "image_uri" TEXT,
    "creator_wallet" VARCHAR(44) NOT NULL,
    "tier" VARCHAR(10) NOT NULL,
    "fee_wallet_pda" VARCHAR(44),
    "sharing_config_pda" VARCHAR(44),
    "listed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_auto_listed" BOOLEAN NOT NULL DEFAULT false,
    "total_fees_claimed" BIGINT NOT NULL DEFAULT 0,
    "total_trading_volume" BIGINT NOT NULL DEFAULT 0,
    "total_creator_payouts" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" SERIAL NOT NULL,
    "user_wallet" VARCHAR(44) NOT NULL,
    "token_id" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "user_capital" BIGINT NOT NULL,
    "protocol_capital" BIGINT NOT NULL,
    "leverage" DECIMAL(4,2) NOT NULL,
    "flat_fee" BIGINT NOT NULL,
    "tier" VARCHAR(10) NOT NULL,
    "entry_price" DECIMAL(20,10),
    "exit_price" DECIMAL(20,10),
    "tokens_bought" BIGINT,
    "exit_threshold" DECIMAL(5,2) NOT NULL,
    "slippage_risk" INTEGER,
    "pnl_sol" BIGINT,
    "user_profit" BIGINT,
    "protocol_revenue" BIGINT,
    "creator_payout" BIGINT,
    "burn_amount" BIGINT,
    "pool_return" BIGINT,
    "lock_amount" BIGINT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "close_tx" VARCHAR(88),
    "open_tx" VARCHAR(88),

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "burns" (
    "id" SERIAL NOT NULL,
    "sol_amount" BIGINT NOT NULL,
    "token_amount" BIGINT NOT NULL,
    "tx_signature" VARCHAR(88) NOT NULL,
    "position_id" INTEGER,
    "burned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "burns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profit_locks" (
    "id" SERIAL NOT NULL,
    "user_wallet" VARCHAR(44) NOT NULL,
    "sol_amount" BIGINT NOT NULL,
    "token_amount" BIGINT NOT NULL,
    "position_id" INTEGER,
    "buy_tx" VARCHAR(88) NOT NULL,
    "lock_tx" VARCHAR(88),
    "unlock_tx" VARCHAR(88),
    "claim_tx" VARCHAR(88),
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlocks_at" TIMESTAMP(3) NOT NULL,
    "is_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "is_claimed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "profit_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_payouts" (
    "id" SERIAL NOT NULL,
    "token_id" INTEGER NOT NULL,
    "creator_wallet" VARCHAR(44) NOT NULL,
    "amount" BIGINT NOT NULL,
    "position_id" INTEGER,
    "status" VARCHAR(20) NOT NULL,
    "claim_tx" VARCHAR(88),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),

    CONSTRAINT "creator_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_claims" (
    "id" SERIAL NOT NULL,
    "token_id" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "tx_signature" VARCHAR(88) NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_users" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "wallet_address" VARCHAR(44) NOT NULL,
    "encrypted_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settings" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "telegram_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_ledger" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "amount" BIGINT NOT NULL,
    "reference_id" INTEGER,
    "tx_signature" VARCHAR(88),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pool_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_fund" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" VARCHAR(200),
    "tx_signature" VARCHAR(88),
    "position_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_fund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_address_key" ON "users"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_address_key" ON "tokens"("address");

-- CreateIndex
CREATE INDEX "positions_user_wallet_idx" ON "positions"("user_wallet");

-- CreateIndex
CREATE INDEX "positions_token_id_idx" ON "positions"("token_id");

-- CreateIndex
CREATE INDEX "positions_status_idx" ON "positions"("status");

-- CreateIndex
CREATE INDEX "profit_locks_user_wallet_idx" ON "profit_locks"("user_wallet");

-- CreateIndex
CREATE INDEX "profit_locks_is_unlocked_unlocks_at_idx" ON "profit_locks"("is_unlocked", "unlocks_at");

-- CreateIndex
CREATE INDEX "profit_locks_is_claimed_idx" ON "profit_locks"("is_claimed");

-- CreateIndex
CREATE INDEX "creator_payouts_creator_wallet_status_idx" ON "creator_payouts"("creator_wallet", "status");

-- CreateIndex
CREATE INDEX "creator_payouts_token_id_idx" ON "creator_payouts"("token_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_users_telegram_id_key" ON "telegram_users"("telegram_id");

-- CreateIndex
CREATE INDEX "pool_ledger_type_idx" ON "pool_ledger"("type");

-- CreateIndex
CREATE INDEX "insurance_fund_type_idx" ON "insurance_fund"("type");

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "burns" ADD CONSTRAINT "burns_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_locks" ADD CONSTRAINT "profit_locks_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_payouts" ADD CONSTRAINT "creator_payouts_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_payouts" ADD CONSTRAINT "creator_payouts_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_claims" ADD CONSTRAINT "fee_claims_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

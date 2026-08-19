-- Points + referrals (pre-token flywheel)
ALTER TABLE "users" ADD COLUMN "referral_code" VARCHAR(12);
ALTER TABLE "users" ADD COLUMN "referred_by_id" INTEGER;

CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");
CREATE INDEX "users_referred_by_id_idx" ON "users"("referred_by_id");

ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_id_fkey"
  FOREIGN KEY ("referred_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "points_ledger" (
    "id" SERIAL NOT NULL,
    "user_wallet" VARCHAR(44) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "points" BIGINT NOT NULL,
    "position_id" INTEGER,
    "referee_wallet" VARCHAR(44),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_ledger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "points_ledger_user_wallet_idx" ON "points_ledger"("user_wallet");
CREATE INDEX "points_ledger_type_idx" ON "points_ledger"("type");
CREATE INDEX "points_ledger_created_at_idx" ON "points_ledger"("created_at");

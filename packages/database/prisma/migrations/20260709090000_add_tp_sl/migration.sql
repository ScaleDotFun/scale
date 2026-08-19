-- Add take-profit / stop-loss levels to positions (price move %, relative to entry)
ALTER TABLE "positions" ADD COLUMN "take_profit_pct" DECIMAL(7,2);
ALTER TABLE "positions" ADD COLUMN "stop_loss_pct" DECIMAL(5,2);

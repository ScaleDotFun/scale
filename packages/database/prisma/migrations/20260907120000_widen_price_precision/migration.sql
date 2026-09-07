-- Price columns hold ETH-per-whole-token, which for a memecoin is routinely
-- below 1e-10. DECIMAL(20,10) quantized those to a handful of significant
-- digits and rounded anything under 5e-11 to exactly zero — the zero then
-- became the denominator of the P&L ratio and stranded the position.
ALTER TABLE "positions" ALTER COLUMN "entry_price" TYPE DECIMAL(50,30);
ALTER TABLE "positions" ALTER COLUMN "exit_price"  TYPE DECIMAL(50,30);

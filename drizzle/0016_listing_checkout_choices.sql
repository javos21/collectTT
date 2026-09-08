ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "settlement_method" text;
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "settlement_method" text;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "settlement_method" text;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "settlement_method" text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_settlement_method_valid') THEN
    ALTER TABLE "claims" ADD CONSTRAINT "claim_settlement_method_valid"
      CHECK ("settlement_method" IS NULL OR "settlement_method" IN ('cash', 'bank_transfer', 'linx', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bid_settlement_method_valid') THEN
    ALTER TABLE "bids" ADD CONSTRAINT "bid_settlement_method_valid"
      CHECK ("settlement_method" IS NULL OR "settlement_method" IN ('cash', 'bank_transfer', 'linx', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_settlement_method_valid') THEN
    ALTER TABLE "offers" ADD CONSTRAINT "offer_settlement_method_valid"
      CHECK ("settlement_method" IS NULL OR "settlement_method" IN ('cash', 'bank_transfer', 'linx', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tx_settlement_method_valid') THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "tx_settlement_method_valid"
      CHECK ("settlement_method" IS NULL OR "settlement_method" IN ('cash', 'bank_transfer', 'linx', 'other'));
  END IF;
END $$;

CREATE TYPE "public"."transaction_dispute_state" AS ENUM('none', 'open', 'resolved');--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "tx_completion_requires_both";--> statement-breakpoint
DROP INDEX IF EXISTS "tx_one_open_per_listing";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "dispute_state" "transaction_dispute_state" DEFAULT 'none' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tx_one_open_per_listing" ON "transactions" USING btree ("listing_id") WHERE "transactions"."state" = 'open';
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "tx_completion_requires_both" CHECK ("transactions"."state" <> 'completed'
          or ("transactions"."payment_state" = 'confirmed'
              and "transactions"."custody_state" in ('not_applicable', 'picked_up')
              and "transactions"."handoff_state" in ('not_applicable', 'buyer_received')
              and "transactions"."dispute_state" <> 'open'));

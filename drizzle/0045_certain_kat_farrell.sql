ALTER TABLE "transactions" DROP CONSTRAINT "tx_dropoff_before_payment";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "tx_custody_required";--> statement-breakpoint
DROP INDEX "custody_clock";--> statement-breakpoint
DROP INDEX "tx_deadlines";--> statement-breakpoint
DROP INDEX "tx_dropoff_deadlines";--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "payment_deadline_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "tx_custody_required" CHECK ("transactions"."fulfillment_path" not in ('relay', 'full_service')
          or "transactions"."custody_state" <> 'not_applicable');--> statement-breakpoint
UPDATE "transactions"
SET "payment_deadline_at" = NULL,
    "seller_dropoff_deadline_at" = NULL,
    "receipt_deadline_at" = NULL,
    "updated_at" = now()
WHERE "state" = 'open';--> statement-breakpoint
UPDATE "custody_holdings"
SET "custody_expires_at" = NULL,
    "overstay_flagged_at" = NULL,
    "updated_at" = now()
WHERE "state" IN ('awaiting_dropoff', 'at_relay', 'release_authorized');--> statement-breakpoint
UPDATE "reputation_counters"
SET "buy_reneged_90d" = 0,
    "sell_reneged_90d" = 0,
    "recomputed_at" = now();--> statement-breakpoint
UPDATE "restrictions"
SET "lifecycle_status" = 'lifted',
    "lifted_at" = now()
WHERE "source" = 'automatic'
  AND "lifecycle_status" = 'active'
  AND "lifted_at" IS NULL
  AND "type" IN ('prepay_required', 'meetup_only', 'reserve_blocked', 'bid_blocked', 'publish_blocked', 'claim_blocked', 'listing_cap');

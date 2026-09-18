CREATE TYPE "public"."fallback_offer_status" AS ENUM('pending', 'accepted', 'expired', 'declined', 'superseded');--> statement-breakpoint
CREATE TABLE "auction_fallback_offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "listing_id" uuid NOT NULL,
  "bid_id" uuid NOT NULL,
  "seller_id" text NOT NULL,
  "buyer_id" text NOT NULL,
  "amount_cents" bigint NOT NULL,
  "fulfillment_path" "fulfillment_path" NOT NULL,
  "delivery_option_id" uuid,
  "settlement_method" text,
  "relay_store_id" uuid,
  "status" "fallback_offer_status" DEFAULT 'pending' NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "responded_at" timestamptz,
  "transaction_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "auction_fallback_positive_amount" CHECK ("amount_cents" > 0),
  CONSTRAINT "auction_fallback_distinct_parties" CHECK ("seller_id" <> "buyer_id")
);--> statement-breakpoint
ALTER TABLE "auction_fallback_offers" ADD CONSTRAINT "auction_fallback_offers_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_fallback_offers" ADD CONSTRAINT "auction_fallback_offers_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_fallback_offers" ADD CONSTRAINT "auction_fallback_offers_seller_id_profiles_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_fallback_offers" ADD CONSTRAINT "auction_fallback_offers_buyer_id_profiles_user_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_fallback_offers" ADD CONSTRAINT "auction_fallback_offers_delivery_option_id_marketplace_options_id_fk" FOREIGN KEY ("delivery_option_id") REFERENCES "public"."marketplace_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auction_fallback_one_pending_listing" ON "auction_fallback_offers" USING btree ("listing_id") WHERE "auction_fallback_offers"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "auction_fallback_one_bid" ON "auction_fallback_offers" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "auction_fallback_buyer" ON "auction_fallback_offers" USING btree ("buyer_id", "status", "expires_at");--> statement-breakpoint
CREATE INDEX "auction_fallback_expiry" ON "auction_fallback_offers" USING btree ("expires_at") WHERE "auction_fallback_offers"."status" = 'pending';

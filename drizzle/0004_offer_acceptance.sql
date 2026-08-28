ALTER TYPE "transaction_source" ADD VALUE IF NOT EXISTS 'offer_accept';--> statement-breakpoint
CREATE TYPE "offer_status" AS ENUM ('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"buyer_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"fulfillment_path" "fulfillment_path" NOT NULL,
	"relay_store_id" uuid,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "offer_id" uuid;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_buyer_id_profiles_user_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_relay_store_id_relay_stores_id_fk" FOREIGN KEY ("relay_store_id") REFERENCES "public"."relay_stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offer_relay_store_required" CHECK ("fulfillment_path" <> 'relay' OR "relay_store_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offer_positive_amount" CHECK ("amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE SET NULL ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offers_listing_status" ON "offers" USING btree ("listing_id", "status", "created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "offers_buyer" ON "offers" USING btree ("buyer_id", "created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "offers_one_pending_per_buyer" ON "offers" USING btree ("listing_id", "buyer_id") WHERE "status" = 'pending';

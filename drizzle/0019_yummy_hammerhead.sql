CREATE TABLE "listing_delivery_options" (
	"listing_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"expected_delivery_days" integer NOT NULL,
	CONSTRAINT "listing_delivery_options_listing_id_option_id_pk" PRIMARY KEY("listing_id","option_id"),
	CONSTRAINT "listing_delivery_option_days_positive" CHECK ("listing_delivery_options"."expected_delivery_days" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "marketplace_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"requires_store" boolean DEFAULT false NOT NULL,
	"fulfillment_path" "fulfillment_path",
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_options_kind_valid" CHECK ("marketplace_options"."kind" in ('delivery', 'payment')),
	CONSTRAINT "marketplace_options_shape" CHECK (("marketplace_options"."kind" = 'delivery' and "marketplace_options"."fulfillment_path" is not null)
          or ("marketplace_options"."kind" = 'payment' and "marketplace_options"."fulfillment_path" is null and "marketplace_options"."requires_store" = false))
);
--> statement-breakpoint
ALTER TABLE "bids" DROP CONSTRAINT "bid_settlement_method_valid";--> statement-breakpoint
ALTER TABLE "claims" DROP CONSTRAINT "claim_settlement_method_valid";--> statement-breakpoint
ALTER TABLE "offers" DROP CONSTRAINT "offer_settlement_method_valid";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "tx_settlement_method_valid";--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "delivery_option_id" uuid;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "delivery_option_id" uuid;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "delivery_option_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "delivery_option_id" uuid;--> statement-breakpoint
ALTER TABLE "listing_delivery_options" ADD CONSTRAINT "listing_delivery_options_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_delivery_options" ADD CONSTRAINT "listing_delivery_options_option_id_marketplace_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."marketplace_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_options" ADD CONSTRAINT "marketplace_options_updated_by_profiles_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_options_kind_key" ON "marketplace_options" USING btree ("kind","key");--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_delivery_option_id_marketplace_options_id_fk" FOREIGN KEY ("delivery_option_id") REFERENCES "public"."marketplace_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_delivery_option_id_marketplace_options_id_fk" FOREIGN KEY ("delivery_option_id") REFERENCES "public"."marketplace_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_delivery_option_id_marketplace_options_id_fk" FOREIGN KEY ("delivery_option_id") REFERENCES "public"."marketplace_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_delivery_option_id_marketplace_options_id_fk" FOREIGN KEY ("delivery_option_id") REFERENCES "public"."marketplace_options"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "marketplace_options"
  ("kind", "key", "label", "description", "requires_store", "fulfillment_path", "sort_order")
VALUES
  ('delivery', 'cash_meetup', 'Meet in person', 'Buyer and seller arrange a safe public handoff.', false, 'cash_meetup', 10),
  ('delivery', 'remote_ship', 'Seller ships to buyer', 'The seller arranges shipping directly.', false, 'remote_ship', 20),
  ('delivery', 'relay', 'Pick up at a store', 'Buyer collects from a selected pickup store.', true, 'relay', 30),
  ('delivery', 'full_service', 'CollectTT delivery', 'CollectTT handles collection and delivery.', false, 'full_service', 40),
  ('payment', 'cash', 'Cash', null, false, null, 10),
  ('payment', 'bank_transfer', 'Bank transfer', null, false, null, 20),
  ('payment', 'linx', 'LINX', null, false, null, 30),
  ('payment', 'other', 'Other', null, false, null, 40)
ON CONFLICT ("kind", "key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "listing_delivery_options" ("listing_id", "option_id", "expected_delivery_days")
SELECT terms."listing_id", options."id", terms."expected_delivery_days"
FROM "listing_fulfillment_terms" terms
INNER JOIN "marketplace_options" options
  ON options."kind" = 'delivery'
 AND options."key" = terms."fulfillment_path"::text
ON CONFLICT ("listing_id", "option_id") DO NOTHING;
--> statement-breakpoint
UPDATE "claims" rows
SET "delivery_option_id" = options."id"
FROM "marketplace_options" options
WHERE options."kind" = 'delivery'
  AND options."key" = rows."fulfillment_path"::text;
--> statement-breakpoint
UPDATE "bids" rows
SET "delivery_option_id" = options."id"
FROM "marketplace_options" options
WHERE options."kind" = 'delivery'
  AND options."key" = rows."fulfillment_path"::text;
--> statement-breakpoint
UPDATE "offers" rows
SET "delivery_option_id" = options."id"
FROM "marketplace_options" options
WHERE options."kind" = 'delivery'
  AND options."key" = rows."fulfillment_path"::text;
--> statement-breakpoint
UPDATE "transactions" rows
SET "delivery_option_id" = options."id"
FROM "marketplace_options" options
WHERE options."kind" = 'delivery'
  AND options."key" = rows."fulfillment_path"::text;

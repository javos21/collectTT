CREATE TABLE "listing_fulfillment_terms" (
	"listing_id" uuid NOT NULL,
	"fulfillment_path" "fulfillment_path" NOT NULL,
	"expected_delivery_days" integer NOT NULL,
	CONSTRAINT "listing_fulfillment_terms_listing_id_fulfillment_path_pk" PRIMARY KEY("listing_id","fulfillment_path"),
	CONSTRAINT "listing_delivery_days_positive" CHECK ("listing_fulfillment_terms"."expected_delivery_days" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"integer_value" integer NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" DROP CONSTRAINT "claim_stack_depth";--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "accepts_offers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "payment_window_hours" integer DEFAULT 72 NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listing_payment_window_valid" CHECK ("listings"."payment_window_hours" between 24 and 168);--> statement-breakpoint
ALTER TABLE "listing_fulfillment_terms" ADD CONSTRAINT "listing_fulfillment_terms_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_profiles_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "claims" SET "status" = 'superseded' WHERE "position" > 3 AND "status" IN ('active', 'queued', 'promoted');
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claim_stack_depth" CHECK ("claims"."position" between 1 and 3 OR "claims"."status" NOT IN ('active', 'queued', 'promoted')); 
--> statement-breakpoint
INSERT INTO "platform_settings" ("key", "integer_value")
VALUES ('full_service_delivery_days', 14)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "listing_fulfillment_terms" ("listing_id", "fulfillment_path", "expected_delivery_days")
SELECT l.id, path, CASE path
  WHEN 'cash_meetup' THEN 2
  WHEN 'remote_ship' THEN 5
  WHEN 'relay' THEN 5
  WHEN 'full_service' THEN 14
END
FROM listings l
CROSS JOIN LATERAL unnest(l.fulfillment_paths) AS path
ON CONFLICT ("listing_id", "fulfillment_path") DO NOTHING;

ALTER TYPE "public"."listing_status" ADD VALUE 'sold_outside';--> statement-breakpoint
CREATE TABLE "seller_marketplace_preferences" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"default_meetup_location_id" uuid,
	"default_payment_methods" text[] DEFAULT ARRAY['cash']::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_meetup_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" text NOT NULL,
	"label" text NOT NULL,
	"area" text NOT NULL,
	"instructions" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "meetup_location_id" uuid;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "listings"
SET "expires_at" = coalesce("published_at", "created_at") + interval '30 days'
WHERE "status" = 'active' AND "sale_type" = 'straight_sale' AND "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "seller_marketplace_preferences" ADD CONSTRAINT "seller_marketplace_preferences_seller_id_profiles_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_marketplace_preferences" ADD CONSTRAINT "seller_marketplace_preferences_default_meetup_location_id_seller_meetup_locations_id_fk" FOREIGN KEY ("default_meetup_location_id") REFERENCES "public"."seller_meetup_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_meetup_locations" ADD CONSTRAINT "seller_meetup_locations_seller_id_profiles_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seller_meetup_locations_owner" ON "seller_meetup_locations" USING btree ("seller_id","active");--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_meetup_location_id_seller_meetup_locations_id_fk" FOREIGN KEY ("meetup_location_id") REFERENCES "public"."seller_meetup_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listings_fixed_price_expiry" ON "listings" USING btree ("expires_at") WHERE "listings"."status" = 'active' and "listings"."sale_type" = 'straight_sale' and "listings"."expires_at" is not null;

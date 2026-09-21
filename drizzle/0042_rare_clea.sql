CREATE TABLE "listing_meetup_locations" (
	"listing_id" uuid NOT NULL,
	"meetup_location_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "listing_meetup_locations_listing_id_meetup_location_id_pk" PRIMARY KEY("listing_id","meetup_location_id"),
	CONSTRAINT "listing_meetup_location_position" CHECK ("listing_meetup_locations"."position" between 0 and 2)
);
--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "meetup_location_id" uuid;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "meetup_location_id" uuid;--> statement-breakpoint
ALTER TABLE "auction_fallback_offers" ADD COLUMN "meetup_location_id" uuid;--> statement-breakpoint
ALTER TABLE "listing_meetup_locations" ADD CONSTRAINT "listing_meetup_locations_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_meetup_locations" ADD CONSTRAINT "listing_meetup_locations_meetup_location_id_seller_meetup_locations_id_fk" FOREIGN KEY ("meetup_location_id") REFERENCES "public"."seller_meetup_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "listing_meetup_locations" ("listing_id", "meetup_location_id", "position")
SELECT "id", "meetup_location_id", 0
FROM "listings"
WHERE "meetup_location_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_meetup_locations_position" ON "listing_meetup_locations" USING btree ("listing_id","position");--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_meetup_location_id_seller_meetup_locations_id_fk" FOREIGN KEY ("meetup_location_id") REFERENCES "public"."seller_meetup_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_meetup_location_id_seller_meetup_locations_id_fk" FOREIGN KEY ("meetup_location_id") REFERENCES "public"."seller_meetup_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_fallback_offers" ADD CONSTRAINT "auction_fallback_offers_meetup_location_id_seller_meetup_locations_id_fk" FOREIGN KEY ("meetup_location_id") REFERENCES "public"."seller_meetup_locations"("id") ON DELETE set null ON UPDATE no action;

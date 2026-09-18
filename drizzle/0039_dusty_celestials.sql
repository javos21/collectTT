ALTER TABLE "seller_marketplace_preferences" DROP CONSTRAINT "seller_marketplace_preferences_default_meetup_location_id_seller_meetup_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "seller_marketplace_preferences" DROP COLUMN "default_meetup_location_id";
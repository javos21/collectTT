ALTER TABLE "claims" ADD COLUMN "meetup_location_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "meetup_location_id" uuid;--> statement-breakpoint
UPDATE "claims" c
SET "meetup_location_id" = l."meetup_location_id"
FROM "listings" l
WHERE l."id" = c."listing_id" AND c."meetup_location_id" IS NULL;--> statement-breakpoint
UPDATE "transactions" t
SET "meetup_location_id" = l."meetup_location_id"
FROM "listings" l
WHERE l."id" = t."listing_id" AND t."meetup_location_id" IS NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_meetup_location_id_seller_meetup_locations_id_fk" FOREIGN KEY ("meetup_location_id") REFERENCES "public"."seller_meetup_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_meetup_location_id_seller_meetup_locations_id_fk" FOREIGN KEY ("meetup_location_id") REFERENCES "public"."seller_meetup_locations"("id") ON DELETE set null ON UPDATE no action;

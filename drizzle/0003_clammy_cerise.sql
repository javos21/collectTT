CREATE TABLE "listing_relay_stores" (
	"listing_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	CONSTRAINT "listing_relay_stores_listing_id_store_id_pk" PRIMARY KEY("listing_id","store_id")
);
--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "fulfillment_path" "fulfillment_path";--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "relay_store_id" uuid;--> statement-breakpoint
ALTER TABLE "custody_holdings" ADD COLUMN "dropoff_code" text;--> statement-breakpoint
UPDATE "custody_holdings"
   SET "dropoff_code" = 'CT-' || upper(substr(md5(random()::text || id::text), 1, 4))
 WHERE "dropoff_code" IS NULL;--> statement-breakpoint
ALTER TABLE "custody_holdings" ALTER COLUMN "dropoff_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_relay_stores" ADD CONSTRAINT "listing_relay_stores_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_relay_stores" ADD CONSTRAINT "listing_relay_stores_store_id_relay_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."relay_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_holdings" ADD CONSTRAINT "custody_holdings_dropoff_code_unique" UNIQUE("dropoff_code");
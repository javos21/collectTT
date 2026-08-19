CREATE TABLE "listing_relay_stores" (
	"listing_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	CONSTRAINT "listing_relay_stores_listing_id_store_id_pk" PRIMARY KEY("listing_id","store_id")
);
--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "fulfillment_path" "fulfillment_path";--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "relay_store_id" uuid;--> statement-breakpoint
ALTER TABLE "custody_holdings" ADD COLUMN "dropoff_code" text;--> statement-breakpoint
-- ★ Backfill using the REAL drop-off alphabet (src/domain/dropoff-code.ts), which omits
--    I, L, O, 0 and 1 so a misread character cannot resolve to a different valid code.
--    md5() is hex, so the obvious `substr(md5(...),1,4)` would mint exactly the codes
--    that alphabet exists to exclude.
--
--    Uniqueness is established BEFORE the UNIQUE constraint below, not hoped for: each
--    row draws until it finds a code no other row holds. Over a 31^4 space that is one
--    draw in practice, and it cannot fail the migration the way a blind insert into a
--    65,536-value space could.
DO $$
DECLARE
  alphabet CONSTANT text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  target record;
  candidate text;
BEGIN
  FOR target IN SELECT id FROM "custody_holdings" WHERE "dropoff_code" IS NULL LOOP
    LOOP
      candidate := 'CT-'
        || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1)
        || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1)
        || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1)
        || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "custody_holdings" WHERE "dropoff_code" = candidate
      );
    END LOOP;
    UPDATE "custody_holdings" SET "dropoff_code" = candidate WHERE id = target.id;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "custody_holdings" ALTER COLUMN "dropoff_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_relay_stores" ADD CONSTRAINT "listing_relay_stores_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_relay_stores" ADD CONSTRAINT "listing_relay_stores_store_id_relay_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."relay_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_holdings" ADD CONSTRAINT "custody_holdings_dropoff_code_unique" UNIQUE("dropoff_code");
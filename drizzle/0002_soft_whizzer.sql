ALTER TABLE "claims" ADD COLUMN "relay_store_id" uuid;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_relay_store_id_relay_stores_id_fk"
  FOREIGN KEY ("relay_store_id") REFERENCES "public"."relay_stores"("id") ON DELETE no action ON UPDATE no action;

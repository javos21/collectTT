CREATE TABLE "listing_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"actor_user_id" text,
	"event_type" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_audit_events" ADD CONSTRAINT "listing_audit_events_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "listing_audit_events" ADD CONSTRAINT "listing_audit_events_actor_user_id_profiles_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "listing_audit_by_listing" ON "listing_audit_events" USING btree ("listing_id","occurred_at" DESC NULLS LAST);
--> statement-breakpoint
INSERT INTO "listing_audit_events" ("listing_id", "actor_user_id", "event_type", "metadata", "occurred_at")
SELECT "id", "seller_id", 'created', jsonb_build_object('status', "status"::text), "created_at"
FROM "listings";

ALTER TABLE "restrictions" ADD COLUMN IF NOT EXISTS "source_event_id" uuid;--> statement-breakpoint
ALTER TABLE "restrictions" ADD COLUMN IF NOT EXISTS "source_actor_user_id" text;--> statement-breakpoint
ALTER TABLE "restrictions" ADD COLUMN IF NOT EXISTS "lifecycle_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_source_event_id_reputation_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."reputation_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_source_actor_user_id_profiles_user_id_fk" FOREIGN KEY ("source_actor_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_lifecycle_status_valid" CHECK ("lifecycle_status" in ('active', 'lifted', 'expired'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Milestone 6: independent marketplace restriction scopes and contextual support cases.
-- Enum values are additive so existing automatic/admin rows remain readable.
ALTER TYPE "public"."restriction_type" ADD VALUE IF NOT EXISTS 'reserve_blocked';--> statement-breakpoint
ALTER TYPE "public"."restriction_type" ADD VALUE IF NOT EXISTS 'publish_blocked';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "support_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "reporter_user_id" text NOT NULL,
  "category" text NOT NULL,
  "detail" text NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "assigned_to" text,
  "internal_notes" text,
  "resolution" text,
  "resolved_by" text,
  "resolved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "support_cases_target_type_valid" CHECK ("support_cases"."target_type" in ('listing', 'auction', 'transaction', 'account')),
  CONSTRAINT "support_cases_status_valid" CHECK ("support_cases"."status" in ('open', 'in_review', 'resolved', 'dismissed')),
  CONSTRAINT "support_cases_category_nonempty" CHECK (length(trim("support_cases"."category")) between 2 and 80),
  CONSTRAINT "support_cases_detail_length" CHECK (length(trim("support_cases"."detail")) between 10 and 4000)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_reporter_user_id_profiles_user_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_assigned_to_profiles_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_resolved_by_profiles_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_cases_queue" ON "support_cases" USING btree ("status", "created_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_cases_target" ON "support_cases" USING btree ("target_type", "target_id", "created_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_cases_reporter" ON "support_cases" USING btree ("reporter_user_id", "created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_cases_one_open_per_reporter_target" ON "support_cases" USING btree ("reporter_user_id", "target_type", "target_id") WHERE "support_cases"."status" in ('open', 'in_review');

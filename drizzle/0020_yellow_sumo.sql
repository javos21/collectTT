CREATE TYPE "public"."admin_audit_outcome" AS ENUM('succeeded', 'failed', 'rejected');--> statement-breakpoint
CREATE TABLE "admin_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"outcome" "admin_audit_outcome" DEFAULT 'succeeded' NOT NULL,
	"before_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"after_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_actor_user_id_profiles_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_actor_time" ON "admin_audit_events" USING btree ("actor_user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_target_time" ON "admin_audit_events" USING btree ("target_type","target_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_action_time" ON "admin_audit_events" USING btree ("action","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_time" ON "admin_audit_events" USING btree ("occurred_at" DESC NULLS LAST);

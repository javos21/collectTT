CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"user_id" text,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_events_idempotency" ON "analytics_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "analytics_events_name_time" ON "analytics_events" USING btree ("event_name","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_events_subject_time" ON "analytics_events" USING btree ("subject_type","subject_id","occurred_at" DESC NULLS LAST);
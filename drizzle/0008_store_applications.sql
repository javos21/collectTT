CREATE TYPE "public"."store_application_status" AS ENUM('pending', 'confirmed', 'declined');--> statement-breakpoint
CREATE TABLE "store_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" text NOT NULL,
	"store_name" text NOT NULL,
	"address_line_1" text NOT NULL,
	"address_line_2" text,
	"area" text NOT NULL,
	"city" text NOT NULL,
	"country" text DEFAULT 'Trinidad and Tobago' NOT NULL,
	"phone_e164" text NOT NULL,
	"website_url" text,
	"instagram_url" text,
	"facebook_url" text,
	"tiktok_url" text,
	"accepts_size_classes" "size_class"[] NOT NULL,
	"terms_version" text NOT NULL,
	"terms_accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "store_application_status" DEFAULT 'pending' NOT NULL,
	"admin_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"store_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "store_applications" ADD CONSTRAINT "store_applications_applicant_id_profiles_user_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_applications" ADD CONSTRAINT "store_applications_reviewed_by_profiles_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_applications" ADD CONSTRAINT "store_applications_store_id_relay_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."relay_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_applications_one_active" ON "store_applications" USING btree ("applicant_id") WHERE "store_applications"."status" in ('pending', 'confirmed');--> statement-breakpoint
CREATE INDEX "store_applications_status_created_at" ON "store_applications" USING btree ("status", "created_at" DESC);

CREATE TYPE "public"."catalog_value_kind" AS ENUM('game', 'condition');--> statement-breakpoint
CREATE TABLE "catalog_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "catalog_value_kind" NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_values_kind_key_unique" ON "catalog_values" USING btree ("kind","key");--> statement-breakpoint
CREATE INDEX "catalog_values_kind_active_order" ON "catalog_values" USING btree ("kind","active","sort_order");

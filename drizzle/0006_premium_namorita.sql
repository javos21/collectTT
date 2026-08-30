ALTER TABLE "profiles" ADD COLUMN "delivery_address_line_1" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "delivery_address_line_2" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "delivery_city" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "delivery_country" text DEFAULT 'Trinidad and Tobago' NOT NULL;
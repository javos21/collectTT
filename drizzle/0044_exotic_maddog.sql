ALTER TABLE "marketplace_options" DROP CONSTRAINT "marketplace_options_shape";--> statement-breakpoint
ALTER TABLE "marketplace_options" ADD COLUMN "requires_meetup_location" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "marketplace_options"
SET "requires_meetup_location" = true
WHERE "kind" = 'delivery'
  AND "fulfillment_path" = 'cash_meetup'
  AND "requires_store" = false;--> statement-breakpoint
ALTER TABLE "marketplace_options" ADD CONSTRAINT "marketplace_options_shape" CHECK (("marketplace_options"."kind" = 'delivery' and "marketplace_options"."fulfillment_path" is not null and not ("marketplace_options"."requires_store" and "marketplace_options"."requires_meetup_location"))
          or ("marketplace_options"."kind" = 'payment' and "marketplace_options"."fulfillment_path" is null and "marketplace_options"."requires_store" = false and "marketplace_options"."requires_meetup_location" = false));

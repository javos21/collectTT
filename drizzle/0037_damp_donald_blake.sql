ALTER TABLE "seller_marketplace_preferences" ADD COLUMN "default_delivery_option_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;--> statement-breakpoint
UPDATE "seller_marketplace_preferences" preferences
SET "default_delivery_option_ids" = ARRAY(
  SELECT options."id"
  FROM "marketplace_options" options
  WHERE options."kind" = 'delivery'
    AND options."key" = 'cash_meetup'
    AND options."active" = true
  LIMIT 1
)
WHERE cardinality("default_delivery_option_ids") = 0;

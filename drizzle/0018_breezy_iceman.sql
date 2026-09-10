ALTER TABLE "listings" DROP COLUMN "size_class";--> statement-breakpoint
ALTER TABLE "custody_holdings" DROP COLUMN "size_class";--> statement-breakpoint
ALTER TABLE "relay_stores" DROP COLUMN "accepts_size_classes";--> statement-breakpoint
ALTER TABLE "store_applications" DROP COLUMN "accepts_size_classes";--> statement-breakpoint
DROP TYPE "public"."size_class";
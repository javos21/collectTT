-- WhatsApp was never a supported delivery channel. Remove legacy skipped rows and
-- preference records before rebuilding the enum without that value.
DELETE FROM "notification_deliveries" WHERE "channel" = 'whatsapp';--> statement-breakpoint
DELETE FROM "notification_preferences" WHERE "channel" = 'whatsapp';--> statement-breakpoint
ALTER TABLE "notification_deliveries" ALTER COLUMN "channel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "notification_preferences" ALTER COLUMN "channel" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."notification_channel";--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'sms');--> statement-breakpoint
ALTER TABLE "notification_deliveries" ALTER COLUMN "channel" SET DATA TYPE "public"."notification_channel" USING "channel"::"public"."notification_channel";--> statement-breakpoint
ALTER TABLE "notification_preferences" ALTER COLUMN "channel" SET DATA TYPE "public"."notification_channel" USING "channel"::"public"."notification_channel";

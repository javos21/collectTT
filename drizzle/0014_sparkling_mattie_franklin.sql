DROP TABLE "ratings" CASCADE;--> statement-breakpoint
ALTER TABLE "reputation_counters" DROP COLUMN "rating_avg";--> statement-breakpoint
ALTER TABLE "reputation_counters" DROP COLUMN "rating_count";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "rating_window_ends_at";--> statement-breakpoint
DROP TYPE "public"."rating_direction";

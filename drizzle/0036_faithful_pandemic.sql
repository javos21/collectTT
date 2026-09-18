ALTER TABLE "phone_verification_challenges" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "phone_verification_challenges" CASCADE;--> statement-breakpoint
DROP INDEX "profiles_phone_key";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "phone_verified_at";
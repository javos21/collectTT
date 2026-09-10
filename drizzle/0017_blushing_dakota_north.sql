DROP INDEX IF EXISTS "claims_one_per_claimant";--> statement-breakpoint
CREATE UNIQUE INDEX "claims_one_per_claimant" ON "claims" USING btree ("listing_id","claimant_id") WHERE "claims"."status" = 'active';

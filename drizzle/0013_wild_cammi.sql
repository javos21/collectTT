DROP INDEX IF EXISTS "claims_position";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "claims_position" ON "claims" USING btree ("listing_id","position") WHERE "claims"."status" in ('active', 'queued', 'promoted');

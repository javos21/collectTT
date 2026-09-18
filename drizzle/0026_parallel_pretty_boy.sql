CREATE TYPE "public"."handoff_state" AS ENUM('not_applicable', 'awaiting_handoff', 'seller_handed_over', 'buyer_received');--> statement-breakpoint
CREATE TYPE "public"."transaction_evidence_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."transaction_evidence_type" AS ENUM('payment_screenshot');--> statement-breakpoint
CREATE TABLE "transaction_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"uploaded_by" text NOT NULL,
	"type" "transaction_evidence_type" DEFAULT 'payment_screenshot' NOT NULL,
	"status" "transaction_evidence_status" DEFAULT 'pending' NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text,
	"content_type" text NOT NULL,
	"bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "transaction_evidence_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "tx_completion_requires_both";--> statement-breakpoint
DROP INDEX "tx_one_open_per_listing";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "handoff_state" "handoff_state" DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "handed_over_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "receipt_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction_evidence" ADD CONSTRAINT "transaction_evidence_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_evidence" ADD CONSTRAINT "transaction_evidence_uploaded_by_profiles_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_evidence_by_tx" ON "transaction_evidence" USING btree ("transaction_id","created_at");--> statement-breakpoint
CREATE INDEX "transaction_evidence_by_uploader" ON "transaction_evidence" USING btree ("uploaded_by","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tx_one_open_per_listing" ON "transactions" USING btree ("listing_id") WHERE "transactions"."state" = 'open';--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "tx_completion_requires_both" CHECK ("transactions"."state" <> 'completed'
          or ("transactions"."payment_state" = 'confirmed'
              and "transactions"."custody_state" in ('not_applicable', 'picked_up')
              and "transactions"."handoff_state" in ('not_applicable', 'buyer_received')));

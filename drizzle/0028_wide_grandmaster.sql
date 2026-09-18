ALTER TABLE "transactions" DROP CONSTRAINT "tx_completion_requires_both";--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "tx_completion_requires_both" CHECK ("transactions"."state" <> 'completed'
          or ("transactions"."payment_state" = 'confirmed'
              and "transactions"."custody_state" in ('not_applicable', 'picked_up')
              and "transactions"."handoff_state" in ('not_applicable', 'buyer_received')
              and "transactions"."dispute_state" <> 'open'));
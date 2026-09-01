ALTER TABLE "listings" ADD CONSTRAINT "listing_payment_window_valid" CHECK ("listings"."payment_window_hours" between 48 and 168);

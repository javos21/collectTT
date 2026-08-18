CREATE TYPE "public"."actor_role" AS ENUM('buyer', 'seller', 'store', 'system', 'admin');--> statement-breakpoint
CREATE TYPE "public"."bid_status" AS ENUM('active', 'outbid', 'won', 'retracted', 'void');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('active', 'queued', 'promoted', 'reneged', 'withdrawn', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."custody_holder" AS ENUM('relay_store', 'platform_courier');--> statement-breakpoint
CREATE TYPE "public"."custody_state" AS ENUM('not_applicable', 'awaiting_dropoff', 'at_relay', 'release_authorized', 'picked_up', 'returned_to_seller', 'voided');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."dispute_reason" AS ENUM('payment_not_received', 'item_not_received', 'item_not_as_described', 'no_show', 'other');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."event_track" AS ENUM('overall', 'payment', 'custody');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_path" AS ENUM('cash_meetup', 'remote_ship', 'relay', 'full_service');--> statement-breakpoint
CREATE TYPE "public"."image_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('draft', 'active', 'claimed', 'ended_won', 'ended_no_sale', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'whatsapp', 'sms');--> statement-breakpoint
CREATE TYPE "public"."payment_state" AS ENUM('pending', 'buyer_marked_paid', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."rating_direction" AS ENUM('buyer_rates_seller', 'seller_rates_buyer');--> statement-breakpoint
CREATE TYPE "public"."reputation_event_type" AS ENUM('purchase_completed', 'sale_completed', 'buyer_paid_on_time', 'buyer_paid_late', 'buyer_reneged_nonpayment', 'buyer_no_show', 'seller_delivered_on_time', 'seller_reneged_no_dropoff', 'seller_no_show', 'custody_overstay', 'rating_received', 'admin_adjustment');--> statement-breakpoint
CREATE TYPE "public"."restriction_source" AS ENUM('automatic', 'admin');--> statement-breakpoint
CREATE TYPE "public"."restriction_type" AS ENUM('prepay_required', 'meetup_only', 'claim_blocked', 'bid_blocked', 'listing_cap');--> statement-breakpoint
CREATE TYPE "public"."sale_type" AS ENUM('straight_sale', 'auction');--> statement-breakpoint
CREATE TYPE "public"."size_class" AS ENUM('small', 'medium', 'large', 'oversize');--> statement-breakpoint
CREATE TYPE "public"."store_staff_role" AS ENUM('staff', 'manager');--> statement-breakpoint
CREATE TYPE "public"."termination_reason" AS ENUM('non_payment', 'buyer_no_show', 'seller_no_dropoff', 'seller_no_show', 'mutual_cancel', 'admin');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('claim', 'claim_promotion', 'auction_win', 'auction_runner_up');--> statement-breakpoint
CREATE TYPE "public"."transaction_state" AS ENUM('open', 'completed', 'reneged_buyer', 'reneged_seller', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('member', 'store_staff', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'restricted', 'suspended', 'banned');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"status" "image_status" DEFAULT 'pending' NOT NULL,
	"r2_key_original" text NOT NULL,
	"variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_type" text,
	"bytes" bigint,
	"width" integer,
	"height" integer,
	"checksum_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"handle" text NOT NULL,
	"phone_e164" text,
	"phone_verified_at" timestamp with time zone,
	"avatar_image_id" uuid,
	"bio" text,
	"area" text,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"member_since" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"rater_id" text NOT NULL,
	"ratee_id" text NOT NULL,
	"direction" text NOT NULL,
	"stars" integer NOT NULL,
	"comment" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revealed_at" timestamp with time zone,
	CONSTRAINT "rating_stars_range" CHECK ("ratings"."stars" between 1 and 5),
	CONSTRAINT "rating_distinct" CHECK ("ratings"."rater_id" <> "ratings"."ratee_id")
);
--> statement-breakpoint
CREATE TABLE "reputation_counters" (
	"user_id" text PRIMARY KEY NOT NULL,
	"buy_claims_total" integer DEFAULT 0 NOT NULL,
	"buy_completed" integer DEFAULT 0 NOT NULL,
	"buy_reneged_total" integer DEFAULT 0 NOT NULL,
	"buy_reneged_90d" integer DEFAULT 0 NOT NULL,
	"buy_paid_on_time" integer DEFAULT 0 NOT NULL,
	"buy_no_shows" integer DEFAULT 0 NOT NULL,
	"sell_listings_resolved" integer DEFAULT 0 NOT NULL,
	"sell_completed" integer DEFAULT 0 NOT NULL,
	"sell_reneged_total" integer DEFAULT 0 NOT NULL,
	"sell_reneged_90d" integer DEFAULT 0 NOT NULL,
	"sell_no_shows" integer DEFAULT 0 NOT NULL,
	"rating_avg" numeric(3, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"recomputed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reputation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"counterparty_user_id" text,
	"transaction_id" uuid,
	"type" "reputation_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restrictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" "restriction_type" NOT NULL,
	"source" "restriction_source" NOT NULL,
	"reason" text NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"lifted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"bidder_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"is_buyout" boolean DEFAULT false NOT NULL,
	"status" "bid_status" DEFAULT 'active' NOT NULL,
	"extended_auction" boolean DEFAULT false NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bid_positive" CHECK ("bids"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"claimant_id" text NOT NULL,
	"position" integer NOT NULL,
	"status" "claim_status" NOT NULL,
	"fulfillment_path" "fulfillment_path" NOT NULL,
	"transaction_id" uuid,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_stack_depth" CHECK ("claims"."position" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "listing_images" (
	"listing_id" uuid NOT NULL,
	"image_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "listing_images_listing_id_image_id_pk" PRIMARY KEY("listing_id","image_id")
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" text NOT NULL,
	"category" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attributes_version" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"sale_type" "sale_type" NOT NULL,
	"status" "listing_status" DEFAULT 'draft' NOT NULL,
	"currency" char(3) DEFAULT 'TTD' NOT NULL,
	"price_cents" bigint,
	"start_bid_cents" bigint,
	"reserve_cents" bigint,
	"buyout_cents" bigint,
	"current_bid_cents" bigint,
	"current_bid_id" uuid,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"ends_at" timestamp with time zone,
	"antisnipe_window_s" integer DEFAULT 120 NOT NULL,
	"antisnipe_extend_s" integer DEFAULT 120 NOT NULL,
	"extension_count" integer DEFAULT 0 NOT NULL,
	"max_extensions" integer,
	"fulfillment_paths" "fulfillment_path"[] NOT NULL,
	"settlement_methods" text[] NOT NULL,
	"size_class" "size_class" DEFAULT 'small' NOT NULL,
	"auto_relist_on_renege" boolean DEFAULT true NOT NULL,
	"active_transaction_id" uuid,
	"published_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_straight_sale_shape" CHECK ("listings"."sale_type" <> 'straight_sale' or ("listings"."price_cents" is not null and "listings"."ends_at" is null)),
	CONSTRAINT "listing_auction_shape" CHECK ("listings"."sale_type" <> 'auction' or ("listings"."start_bid_cents" is not null and "listings"."ends_at" is not null)),
	CONSTRAINT "listing_positive_money" CHECK (coalesce("listings"."price_cents", 1) > 0 and coalesce("listings"."start_bid_cents", 1) > 0 and coalesce("listings"."buyout_cents", 1) > 0),
	CONSTRAINT "listing_paths_nonempty" CHECK (array_length("listings"."fulfillment_paths", 1) >= 1)
);
--> statement-breakpoint
CREATE TABLE "custody_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"current_transaction_id" uuid,
	"holder" "custody_holder" NOT NULL,
	"store_id" uuid,
	"state" "custody_state" DEFAULT 'awaiting_dropoff' NOT NULL,
	"size_class" "size_class" NOT NULL,
	"dropped_off_at" timestamp with time zone,
	"received_by_user_id" text,
	"release_authorized_at" timestamp with time zone,
	"released_by_user_id" text,
	"picked_up_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"custody_expires_at" timestamp with time zone,
	"overstay_flagged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custody_store_required" CHECK ("custody_holdings"."holder" <> 'relay_store' or "custody_holdings"."store_id" is not null),
	CONSTRAINT "custody_courier_has_no_store" CHECK ("custody_holdings"."holder" <> 'platform_courier' or "custody_holdings"."store_id" is null)
);
--> statement-breakpoint
CREATE TABLE "relay_store_staff" (
	"store_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "store_staff_role" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relay_store_staff_store_id_user_id_pk" PRIMARY KEY("store_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "relay_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"area" text NOT NULL,
	"address" text,
	"phone_e164" text,
	"accepts_size_classes" "size_class"[] NOT NULL,
	"paid_custody_days" integer DEFAULT 7 NOT NULL,
	"unpaid_custody_days" integer DEFAULT 3 NOT NULL,
	"holding_fee_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"track" "event_track" NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"actor_user_id" text,
	"actor_role" "actor_role" NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"seller_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"source" "transaction_source" NOT NULL,
	"claim_id" uuid,
	"winning_bid_id" uuid,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'TTD' NOT NULL,
	"fulfillment_path" "fulfillment_path" NOT NULL,
	"state" "transaction_state" DEFAULT 'open' NOT NULL,
	"payment_state" "payment_state" DEFAULT 'pending' NOT NULL,
	"custody_state" "custody_state" DEFAULT 'not_applicable' NOT NULL,
	"payment_deadline_at" timestamp with time zone NOT NULL,
	"seller_dropoff_deadline_at" timestamp with time zone,
	"rating_window_ends_at" timestamp with time zone,
	"marked_paid_at" timestamp with time zone,
	"payment_confirmed_at" timestamp with time zone,
	"payment_disputed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"terminated_at" timestamp with time zone,
	"terminated_reason" "termination_reason",
	"relay_store_id" uuid,
	"custody_holding_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tx_distinct_parties" CHECK ("transactions"."buyer_id" <> "transactions"."seller_id"),
	CONSTRAINT "tx_positive_amount" CHECK ("transactions"."amount_cents" > 0),
	CONSTRAINT "tx_p2p_no_custody" CHECK ("transactions"."fulfillment_path" not in ('cash_meetup', 'remote_ship')
          or ("transactions"."custody_state" = 'not_applicable' and "transactions"."relay_store_id" is null)),
	CONSTRAINT "tx_custody_required" CHECK ("transactions"."fulfillment_path" not in ('relay', 'full_service')
          or ("transactions"."custody_state" <> 'not_applicable' and "transactions"."seller_dropoff_deadline_at" is not null)),
	CONSTRAINT "tx_dropoff_before_payment" CHECK ("transactions"."seller_dropoff_deadline_at" is null
          or "transactions"."seller_dropoff_deadline_at" < "transactions"."payment_deadline_at"),
	CONSTRAINT "tx_completion_requires_both" CHECK ("transactions"."state" <> 'completed'
          or ("transactions"."payment_state" = 'confirmed'
              and "transactions"."custody_state" in ('not_applicable', 'picked_up')))
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"raised_by" text NOT NULL,
	"reason" "dispute_reason" NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"detail" text NOT NULL,
	"resolution" text,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_preferences_user_id_event_type_channel_pk" PRIMARY KEY("user_id","event_type","channel")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_url" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_image_id_images_id_fk" FOREIGN KEY ("avatar_image_id") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_id_profiles_user_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ratee_id_profiles_user_id_fk" FOREIGN KEY ("ratee_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_counters" ADD CONSTRAINT "reputation_counters_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_events" ADD CONSTRAINT "reputation_events_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_events" ADD CONSTRAINT "reputation_events_counterparty_user_id_profiles_user_id_fk" FOREIGN KEY ("counterparty_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_profiles_user_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimant_id_profiles_user_id_fk" FOREIGN KEY ("claimant_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_profiles_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_category_categories_key_fk" FOREIGN KEY ("category") REFERENCES "public"."categories"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_holdings" ADD CONSTRAINT "custody_holdings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_holdings" ADD CONSTRAINT "custody_holdings_store_id_relay_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."relay_stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_holdings" ADD CONSTRAINT "custody_holdings_received_by_user_id_profiles_user_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_holdings" ADD CONSTRAINT "custody_holdings_released_by_user_id_profiles_user_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_store_staff" ADD CONSTRAINT "relay_store_staff_store_id_relay_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."relay_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_store_staff" ADD CONSTRAINT "relay_store_staff_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_events" ADD CONSTRAINT "transaction_events_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_events" ADD CONSTRAINT "transaction_events_actor_user_id_profiles_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_seller_id_profiles_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_buyer_id_profiles_user_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_winning_bid_id_bids_id_fk" FOREIGN KEY ("winning_bid_id") REFERENCES "public"."bids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_relay_store_id_relay_stores_id_fk" FOREIGN KEY ("relay_store_id") REFERENCES "public"."relay_stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_custody_holding_id_custody_holdings_id_fk" FOREIGN KEY ("custody_holding_id") REFERENCES "public"."custody_holdings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_profiles_user_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_profiles_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "images_owner" ON "images" USING btree ("owner_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "images_pending" ON "images" USING btree ("created_at") WHERE "images"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_handle_key" ON "profiles" USING btree (lower("handle"));--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_phone_key" ON "profiles" USING btree ("phone_e164") WHERE "profiles"."phone_e164" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_one_per_rater" ON "ratings" USING btree ("transaction_id","rater_id");--> statement-breakpoint
CREATE INDEX "ratings_public" ON "ratings" USING btree ("ratee_id") WHERE "ratings"."revealed_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reputation_events_idem" ON "reputation_events" USING btree ("transaction_id","user_id","type") WHERE "reputation_events"."transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "reputation_events_user_time" ON "reputation_events" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "restrictions_active" ON "restrictions" USING btree ("user_id","expires_at") WHERE "restrictions"."lifted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "bids_amount_unique" ON "bids" USING btree ("listing_id","amount_cents");--> statement-breakpoint
CREATE INDEX "bids_ladder" ON "bids" USING btree ("listing_id","amount_cents" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bids_bidder" ON "bids" USING btree ("bidder_id","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "claims_one_per_claimant" ON "claims" USING btree ("listing_id","claimant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_position" ON "claims" USING btree ("listing_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_one_active" ON "claims" USING btree ("listing_id") WHERE "claims"."status" = 'active';--> statement-breakpoint
CREATE INDEX "claims_stack" ON "claims" USING btree ("listing_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_images_position" ON "listing_images" USING btree ("listing_id","position");--> statement-breakpoint
CREATE INDEX "listings_browse" ON "listings" USING btree ("status","category","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "listings_seller" ON "listings" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "listings_attrs" ON "listings" USING gin ("attributes");--> statement-breakpoint
CREATE INDEX "listings_auction_close" ON "listings" USING btree ("ends_at") WHERE "listings"."status" = 'active' and "listings"."sale_type" = 'auction';--> statement-breakpoint
CREATE UNIQUE INDEX "custody_one_live_per_listing" ON "custody_holdings" USING btree ("listing_id") WHERE "custody_holdings"."state" not in ('picked_up', 'returned_to_seller', 'voided');--> statement-breakpoint
CREATE INDEX "custody_store_board" ON "custody_holdings" USING btree ("store_id","state");--> statement-breakpoint
CREATE INDEX "custody_clock" ON "custody_holdings" USING btree ("custody_expires_at") WHERE "custody_holdings"."state" in ('at_relay', 'release_authorized');--> statement-breakpoint
CREATE INDEX "tx_events_by_tx" ON "transaction_events" USING btree ("transaction_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tx_one_open_per_listing" ON "transactions" USING btree ("listing_id") WHERE "transactions"."state" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "tx_listing_attempt" ON "transactions" USING btree ("listing_id","attempt_number");--> statement-breakpoint
CREATE INDEX "tx_buyer" ON "transactions" USING btree ("buyer_id","state");--> statement-breakpoint
CREATE INDEX "tx_seller" ON "transactions" USING btree ("seller_id","state");--> statement-breakpoint
CREATE INDEX "tx_deadlines" ON "transactions" USING btree ("payment_deadline_at") WHERE "transactions"."state" = 'open';--> statement-breakpoint
CREATE INDEX "tx_dropoff_deadlines" ON "transactions" USING btree ("seller_dropoff_deadline_at") WHERE "transactions"."state" = 'open';--> statement-breakpoint
CREATE INDEX "disputes_open" ON "disputes" USING btree ("created_at" DESC NULLS LAST) WHERE "disputes"."status" = 'open';--> statement-breakpoint
CREATE INDEX "disputes_by_tx" ON "disputes" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_dedupe" ON "notification_deliveries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_deliveries_pending" ON "notification_deliveries" USING btree ("created_at") WHERE "notification_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notifications_unread" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "notifications"."read_at" is null;
-- Foreign keys that are genuinely circular and therefore cannot be declared inline in
-- the Drizzle schema. Applied by scripts/migrate.ts after every table exists.
--
--   listings.active_transaction_id      -> transactions.id   (listings <-> transactions)
--   custody_holdings.current_transaction_id -> transactions.id
--   reputation_events.transaction_id    -> transactions.id
--   ratings.transaction_id              -> transactions.id
--   claims.transaction_id               -> transactions.id
--   listings.current_bid_id             -> bids.id           (listings <-> bids)
--
-- Every statement is guarded, so this file is safe to re-run on every deploy.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_active_transaction_fk') then
    alter table listings
      add constraint listings_active_transaction_fk
      foreign key (active_transaction_id) references transactions(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'listings_current_bid_fk') then
    alter table listings
      add constraint listings_current_bid_fk
      foreign key (current_bid_id) references bids(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'custody_current_transaction_fk') then
    alter table custody_holdings
      add constraint custody_current_transaction_fk
      foreign key (current_transaction_id) references transactions(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'reputation_events_transaction_fk') then
    alter table reputation_events
      add constraint reputation_events_transaction_fk
      foreign key (transaction_id) references transactions(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ratings_transaction_fk') then
    alter table ratings
      add constraint ratings_transaction_fk
      foreign key (transaction_id) references transactions(id)
      on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'claims_transaction_fk') then
    alter table claims
      add constraint claims_transaction_fk
      foreign key (transaction_id) references transactions(id)
      on delete set null;
  end if;
end
$$;

-- The ratings.direction column is a plain text column in Drizzle (the enum lives in the
-- domain); constrain it here so bad values cannot be written.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ratings_direction_valid') then
    alter table ratings
      add constraint ratings_direction_valid
      check (direction in ('buyer_rates_seller', 'seller_rates_buyer'));
  end if;
end
$$;

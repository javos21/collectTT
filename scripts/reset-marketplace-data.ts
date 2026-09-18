/**
 * Remove marketplace activity while preserving authentication and profile data.
 *
 * Staging execution requires two explicit environment gates. The script also checks
 * that the configured database and storage endpoints match the declared target.
 */

import '../src/lib/load-env';

import type { PoolClient } from 'pg';

import { pool } from '../src/db/client';
import { deleteObjects } from '../src/lib/storage';

const MARKETPLACE_NOTIFICATION_TYPES = [
  'auction_ended_seller',
  'auction_fallback_offer_buyer',
  'auction_fallback_offer_expired_buyer',
  'auction_fallback_offer_seller',
  'auction_outbid',
  'auction_runner_up_buyer',
  'auction_won',
  'buyer_told_to_hold_payment',
  'claim_confirmed_buyer',
  'claim_queued_buyer',
  'custody_overstay_store',
  'custody_ready_for_pickup',
  'custody_received_buyer',
  'custody_return_to_seller',
  'dispute_submitted_member',
  'item_handed_over_buyer',
  'item_received_seller',
  'listing_claimed_seller',
  'offer_accepted_buyer',
  'offer_accepted_seller',
  'offer_cancelled_seller',
  'offer_closed_after_payment_buyer',
  'offer_received_seller',
  'offer_rejected_buyer',
  'payment_confirmed_buyer',
  'payment_disputed_buyer',
  'payment_marked_paid_seller',
  'payment_reminder',
  'payment_window_lapsed_buyer',
  'payment_window_lapsed_seller',
  'seller_dropoff_lapsed',
  'transaction_completed',
] as const;

const MARKETPLACE_TASKS = [
  'auction:close',
  'auction:fallback_expire',
  'custody:overstay',
  'listing:expire',
  'ratings:reveal',
  'transaction:dropoff_window',
  'transaction:payment_reminder',
  'transaction:payment_window',
  'transaction:promote_next',
  'transaction:receipt_window',
] as const;

interface StoredImage {
  sourceKey: string;
  variants: unknown;
}

function isLocal(value: string): boolean {
  return value.includes('localhost') || value.includes('127.0.0.1');
}

function assertTarget(): 'local' | 'staging' {
  const target = process.env.RESET_TARGET;
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const storageEndpoint = process.env.STORAGE_ENDPOINT ?? '';

  if (target === 'local') {
    if (!isLocal(databaseUrl) || !isLocal(storageEndpoint)) {
      throw new Error('RESET_TARGET=local requires local database and storage endpoints.');
    }
    return target;
  }

  if (target === 'staging') {
    if (process.env.CONFIRM_STAGING_MARKETPLACE_WIPE !== 'wipe-staging-marketplace') {
      throw new Error('Set CONFIRM_STAGING_MARKETPLACE_WIPE=wipe-staging-marketplace to continue.');
    }
    if (isLocal(databaseUrl) || !databaseUrl.includes('supabase.com')) {
      throw new Error('RESET_TARGET=staging requires the configured Supabase database.');
    }
    if (isLocal(storageEndpoint) || !storageEndpoint.includes('r2.cloudflarestorage.com')) {
      throw new Error('RESET_TARGET=staging requires the configured Cloudflare R2 endpoint.');
    }
    return target;
  }

  throw new Error('Set RESET_TARGET to local or staging.');
}

function variantKeys(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];

  return Object.values(value).flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const key = (entry as { key?: unknown }).key;
      return typeof key === 'string' ? [key] : [];
    }
    return [];
  });
}

function sameIds(before: readonly string[], after: readonly string[]): boolean {
  return before.length === after.length && before.every((id, index) => id === after[index]);
}

async function rowCount(client: PoolClient, table: string): Promise<number> {
  const result = await client.query<{ count: number }>(`select count(*)::int as count from ${table}`);
  return result.rows[0]?.count ?? 0;
}

async function deleteStorageObjects(keys: readonly string[]): Promise<void> {
  const unique = [...new Set(keys)].filter((key) => key !== '');
  for (let index = 0; index < unique.length; index += 1_000) {
    await deleteObjects(unique.slice(index, index + 1_000));
  }
}

async function main(): Promise<void> {
  const target = assertTarget();
  const client = await pool.connect();
  let committed = false;

  try {
    const profileIdsBefore = (await client.query<{ user_id: string }>(
      'select user_id from profiles order by user_id',
    )).rows.map((row) => row.user_id);
    const userIdsBefore = (await client.query<{ id: string }>(
      'select id from "user" order by id',
    )).rows.map((row) => row.id);
    const storedImages = (await client.query<StoredImage>(`
      select distinct i.r2_key_original as "sourceKey", i.variants
      from listing_images li
      inner join images i on i.id = li.image_id
      where not exists (
        select 1 from profiles p where p.avatar_image_id = i.id
      )
    `)).rows;
    const storageKeys = storedImages.flatMap((image) => [
      image.sourceKey,
      ...variantKeys(image.variants),
    ]);

    await client.query('begin');
    await client.query('create temp table reset_listings on commit drop as select id from listings');
    await client.query('create temp table reset_transactions on commit drop as select id from transactions');
    await client.query(`
      create temp table reset_images on commit drop as
      select distinct li.image_id
      from listing_images li
      inner join reset_listings l on l.id = li.listing_id
    `);
    await client.query(`
      create temp table reset_holdings on commit drop as
      select distinct h.id
      from custody_holdings h
      left join reset_listings l on l.id = h.listing_id
      left join reset_transactions t on t.id = h.current_transaction_id
      where l.id is not null or t.id is not null
    `);
    await client.query(`
      create temp table reset_notifications on commit drop as
      select n.id
      from notifications n
      where n.event_type = any($1::text[])
         or n.link_url like '/deals/%'
         or n.link_url like '/listings/%'
         or n.data->>'transactionId' in (select id::text from reset_transactions)
         or n.data->>'listingId' in (select id::text from reset_listings)
    `, [MARKETPLACE_NOTIFICATION_TYPES]);
    await client.query(`
      create temp table reset_deliveries on commit drop as
      select d.id
      from notification_deliveries d
      where d.event_type = any($1::text[])
         or d.payload->'message'->>'linkUrl' like '/deals/%'
         or d.payload->'message'->>'linkUrl' like '/listings/%'
         or d.payload->'data'->>'transactionId' in (select id::text from reset_transactions)
         or d.payload->'data'->>'listingId' in (select id::text from reset_listings)
    `, [MARKETPLACE_NOTIFICATION_TYPES]);

    const targeted = {
      listings: await rowCount(client, 'reset_listings'),
      transactions: await rowCount(client, 'reset_transactions'),
      images: await rowCount(client, 'reset_images'),
      notifications: await rowCount(client, 'reset_notifications'),
      deliveries: await rowCount(client, 'reset_deliveries'),
    };

    const deleted: Record<string, number> = {};
    const runDelete = async (name: string, query: string, values: unknown[] = []) => {
      const result = await client.query(query, values);
      deleted[name] = result.rowCount ?? 0;
    };

    await runDelete('jobs', `
      delete from graphile_worker._private_jobs j
      using graphile_worker._private_tasks t
      where t.id = j.task_id
        and (
          t.identifier = any($1::text[])
          or (
            t.identifier = 'notifications:dispatch'
            and (
              j.payload->>'deliveryId' in (select id::text from reset_deliveries)
              or not exists (
                select 1 from notification_deliveries d
                where d.id::text = j.payload->>'deliveryId'
              )
            )
          )
        )
    `, [MARKETPLACE_TASKS]);
    await runDelete(
      'supportCases',
      `delete from support_cases where target_type = any($1::text[])`,
      [['listing', 'auction', 'transaction']],
    );
    await runDelete(
      'analyticsEvents',
      `delete from analytics_events where subject_type = any($1::text[])`,
      [['listing', 'auction', 'transaction']],
    );
    await runDelete('deliveries', 'delete from notification_deliveries where id in (select id from reset_deliveries)');
    await runDelete('notifications', 'delete from notifications where id in (select id from reset_notifications)');
    await runDelete('reputationEvents', 'delete from reputation_events where transaction_id in (select id from reset_transactions)');
    await runDelete('disputes', 'delete from disputes where transaction_id in (select id from reset_transactions)');
    await runDelete('transactionEvidence', 'delete from transaction_evidence where transaction_id in (select id from reset_transactions)');
    await runDelete('transactionEvents', 'delete from transaction_events where transaction_id in (select id from reset_transactions)');
    await runDelete('transactions', 'delete from transactions where id in (select id from reset_transactions)');
    await runDelete('custodyHoldings', 'delete from custody_holdings where id in (select id from reset_holdings)');
    await runDelete('listings', 'delete from listings where id in (select id from reset_listings)');
    await runDelete('images', `
      delete from images
      where id in (select image_id from reset_images)
        and not exists (select 1 from profiles p where p.avatar_image_id = images.id)
    `);

    const profileIdsAfter = (await client.query<{ user_id: string }>(
      'select user_id from profiles order by user_id',
    )).rows.map((row) => row.user_id);
    const userIdsAfter = (await client.query<{ id: string }>(
      'select id from "user" order by id',
    )).rows.map((row) => row.id);
    if (!sameIds(profileIdsBefore, profileIdsAfter) || !sameIds(userIdsBefore, userIdsAfter)) {
      throw new Error('Profile or account identity changed during the marketplace reset.');
    }

    await client.query('commit');
    committed = true;

    await deleteStorageObjects(storageKeys);

    const remaining = {
      listings: await rowCount(client, 'listings'),
      transactions: await rowCount(client, 'transactions'),
      profiles: await rowCount(client, 'profiles'),
      users: await rowCount(client, '"user"'),
      images: await rowCount(client, 'images'),
    };
    console.log(JSON.stringify({
      ok: true,
      target,
      targeted,
      deleted,
      deletedStorageObjects: [...new Set(storageKeys)].length,
      remaining,
      profilesPreserved: true,
      usersPreserved: true,
    }));
  } catch (error) {
    if (!committed) await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[reset:marketplace] failed', error);
  process.exit(1);
});

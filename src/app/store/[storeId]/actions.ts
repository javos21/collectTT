'use server';

/**
 * The four things a clerk does at the counter.
 *
 * ★ `requireStoreStaff` here is routing and UX, NOT the security boundary.
 *   `assertStoreAuthority` inside services/custody.ts re-checks staff membership
 *   against each holding's own store on every one of these writes.
 */

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { requireStoreStaff } from '@/lib/store-session';
import {
  findHoldingByCode,
  markReceived,
  authorizeRelease,
  markPickedUp,
  returnToSeller,
} from '@/services/custody';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

/** The counter's primary interaction: a code in, an item on the shelf or a refusal. */
export async function receiveByCodeAction(formData: FormData): Promise<void> {
  const storeId = String(formData.get('storeId') ?? '');
  const code = String(formData.get('code') ?? '');
  const session = await requireStoreStaff(storeId);

  const found = await findHoldingByCode(db, storeId, code);
  if (found === null) {
    redirect(
      `/store/${storeId}?refuse=${encodeURIComponent(
        'No expected drop-off with that code. Do not accept this item.',
      )}`,
    );
  }

  try {
    await db.transaction(async (tx) => {
      await markReceived({
        tx,
        holdingId: found.holdingId,
        actorUserId: session.user.userId,
        actorRole: 'store',
      });
    });
  } catch (error) {
    redirect(`/store/${storeId}?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath(`/store/${storeId}`);
  redirect(`/store/${storeId}?ok=${encodeURIComponent(`Received "${found.listingTitle}"`)}`);
}

/**
 * ★ Deliberately its own act, separate from "Mark picked up". The payment gate is this
 *   system's most important check and it earns its own actor and timestamp — and
 *   `release_authorized` is a real durable state on the full_service courier path.
 */
export async function authorizeReleaseAction(formData: FormData): Promise<void> {
  const storeId = String(formData.get('storeId') ?? '');
  const holdingId = String(formData.get('holdingId') ?? '');
  const session = await requireStoreStaff(storeId);

  try {
    await db.transaction(async (tx) => {
      await authorizeRelease({
        tx,
        holdingId,
        actorUserId: session.user.userId,
        actorRole: 'store',
      });
    });
  } catch (error) {
    redirect(`/store/${storeId}?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath(`/store/${storeId}`);
  redirect(
    `/store/${storeId}?ok=${encodeURIComponent(
      'Cleared for collection. Hand it over and mark it picked up.',
    )}`,
  );
}

export async function markPickedUpAction(formData: FormData): Promise<void> {
  const storeId = String(formData.get('storeId') ?? '');
  const holdingId = String(formData.get('holdingId') ?? '');
  const session = await requireStoreStaff(storeId);

  try {
    await db.transaction(async (tx) => {
      await markPickedUp({
        tx,
        holdingId,
        actorUserId: session.user.userId,
        actorRole: 'store',
      });
    });
  } catch (error) {
    redirect(`/store/${storeId}?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath(`/store/${storeId}`);
  redirect(`/store/${storeId}?ok=${encodeURIComponent('Collected. Off your shelf.')}`);
}

export async function returnToSellerAction(formData: FormData): Promise<void> {
  const storeId = String(formData.get('storeId') ?? '');
  const holdingId = String(formData.get('holdingId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  const session = await requireStoreStaff(storeId);

  try {
    await db.transaction(async (tx) => {
      await returnToSeller({
        tx,
        holdingId,
        actorUserId: session.user.userId,
        actorRole: 'store',
        ...(reason !== '' ? { reason } : {}),
      });
    });
  } catch (error) {
    redirect(`/store/${storeId}?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath(`/store/${storeId}`);
  redirect(
    `/store/${storeId}?ok=${encodeURIComponent('Marked returned to seller. The seller is told.')}`,
  );
}

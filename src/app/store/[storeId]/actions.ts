'use server';

/**
 * The three things a clerk does at the counter: receive, collect, or return.
 *
 * ★ `requireStoreStaff` here is routing and UX, NOT the security boundary.
 *   `assertStoreAuthority` inside services/custody.ts re-checks staff membership
 *   against each holding's own store on every one of these writes.
 */

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { currentUser, SignInRequiredError } from '@/lib/session';
import { requireStoreStaff, NotStoreStaffError, type StoreSession } from '@/lib/store-session';
import {
  findHoldingByCode,
  markReceived,
  authorizeRelease,
  markPickedUp,
  returnToSeller,
  storeBoard,
} from '@/services/custody';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

function view(formData: FormData): string {
  const candidate = String(formData.get('view') ?? '');
  return ['overview', 'shelf', 'ready', 'expected', 'settled'].includes(candidate)
    ? candidate
    : 'overview';
}

function storeUrl(storeId: string, query: string, dashboardView: string): string {
  return `/store/${storeId}?${query}&view=${encodeURIComponent(dashboardView)}`;
}

function mode(formData: FormData): 'receive' | 'release' {
  return formData.get('mode') === 'receive' ? 'receive' : 'release';
}

function counterUrl(storeId: string, query: string, counterMode: 'receive' | 'release'): string {
  return `/store/${storeId}?${query}&mode=${counterMode}`;
}

/**
 * ★ A counter terminal is the likeliest place in this app to meet an expired session —
 *   a tab open since morning, a customer at the till. That must be a sign-in redirect,
 *   never a crash page. Still not the security boundary: the services re-check every
 *   write against the holding's own store.
 */
async function counterSession(storeId: string): Promise<StoreSession> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  try {
    return await requireStoreStaff(storeId);
  } catch (error) {
    if (error instanceof NotStoreStaffError) redirect('/store');
    // The session can also lapse between the check above and this call.
    if (error instanceof SignInRequiredError) redirect('/sign-in');
    throw error;
  }
}

/** The counter's primary interaction: a code in, an item on the shelf or a refusal. */
export async function receiveByCodeAction(formData: FormData): Promise<void> {
  const storeId = String(formData.get('storeId') ?? '');
  const code = String(formData.get('code') ?? '');
  const dashboardView = view(formData);
  const session = await counterSession(storeId);

  const found = await findHoldingByCode(db, storeId, code);
  if (found === null) {
    redirect(
      storeUrl(storeId, `refuse=${encodeURIComponent(
        'No expected drop-off with that code. Do not accept this item.',
      )}`, dashboardView),
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
    redirect(storeUrl(storeId, `error=${encodeURIComponent(message(error))}`, dashboardView));
  }

  revalidatePath(`/store/${storeId}`);
  redirect(storeUrl(storeId, `ok=${encodeURIComponent(`Received "${found.listingTitle}"`)}`, dashboardView));
}

/** Look up either side of the counter flow without changing custody. */
export async function lookupByCodeAction(formData: FormData): Promise<void> {
  const storeId = String(formData.get('storeId') ?? '');
  const code = String(formData.get('code') ?? '').trim();
  const counterMode = mode(formData);
  await counterSession(storeId);

  const rows = await storeBoard(db, storeId);
  const found = rows.find((row) => row.dropoffCode.toUpperCase() === code.toUpperCase());
  if (found === undefined || code === '') {
    redirect(
      counterUrl(
        storeId,
        `refuse=${encodeURIComponent('No item found with that code at this Store.')}`,
        counterMode,
      ),
    );
  }

  redirect(counterUrl(storeId, `lookup=${encodeURIComponent(found.holdingId)}`, counterMode));
}

/** One counter action: verify payment and buyer, then release the item. */
export async function releaseItemAction(formData: FormData): Promise<void> {
  const storeId = String(formData.get('storeId') ?? '');
  const holdingId = String(formData.get('holdingId') ?? '');
  const session = await counterSession(storeId);

  try {
    await db.transaction(async (tx) => {
      const rows = await storeBoard(tx, storeId);
      const holding = rows.find((row) => row.holdingId === holdingId);
      if (holding === undefined) throw new Error('This item is not held at this Store.');

      if (holding.state === 'at_relay') {
        // Keep the existing SQL payment gate as the security boundary, but make the
        // transient authorization invisible to the clerk by completing both writes
        // in one counter action.
        await authorizeRelease({
          tx,
          holdingId,
          actorUserId: session.user.userId,
          actorRole: 'store',
        });
      }

      await markPickedUp({
        tx,
        holdingId,
        actorUserId: session.user.userId,
        actorRole: 'store',
      });
    });
  } catch (error) {
    redirect(counterUrl(storeId, `error=${encodeURIComponent(message(error))}`, 'release'));
  }

  revalidatePath(`/store/${storeId}`);
  redirect(counterUrl(storeId, `ok=${encodeURIComponent('Released to buyer. Off your shelf.')}`, 'release'));
}

export async function markPickedUpAction(formData: FormData): Promise<void> {
  const storeId = String(formData.get('storeId') ?? '');
  const holdingId = String(formData.get('holdingId') ?? '');
  const dashboardView = view(formData);
  const session = await counterSession(storeId);

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
    redirect(storeUrl(storeId, `error=${encodeURIComponent(message(error))}`, dashboardView));
  }

  revalidatePath(`/store/${storeId}`);
  redirect(storeUrl(storeId, `ok=${encodeURIComponent('Collected. Off your shelf.')}`, dashboardView));
}

export async function returnToSellerAction(formData: FormData): Promise<void> {
  const storeId = String(formData.get('storeId') ?? '');
  const holdingId = String(formData.get('holdingId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  const dashboardView = view(formData);
  const session = await counterSession(storeId);

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
    redirect(storeUrl(storeId, `error=${encodeURIComponent(message(error))}`, dashboardView));
  }

  revalidatePath(`/store/${storeId}`);
  redirect(storeUrl(storeId, `ok=${encodeURIComponent('Marked returned to seller. The seller is told.')}`, dashboardView));
}

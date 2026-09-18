'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { enforceUserAndIpRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { markPaid, confirmCustodyCollection, markItemHandedOver, confirmItemReceived } from '@/services/transactions';
import { isDisputeReason, submitDispute, validDisputeDetail, type DisputeReason } from '@/services/disputes';

function fail(id: string, error: unknown): never {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  redirect(`/deals/${id}?error=${encodeURIComponent(message)}`);
}

export async function markPaidAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const id = String(formData.get('transactionId') ?? '');

  try {
    await enforceUserAndIpRateLimit('deal:mutation', user.userId, RATE_LIMITS.transaction);
    await db.transaction(async (tx) => markPaid(tx, id, user.userId));
  } catch (error) {
    fail(id, error);
  }
  revalidatePath(`/deals/${id}`);
  redirect(`/deals/${id}?done=marked`);
}

export async function confirmCollectionAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const id = String(formData.get('transactionId') ?? '');

  try {
    await enforceUserAndIpRateLimit('deal:mutation', user.userId, RATE_LIMITS.transaction);
    await db.transaction(async (tx) => confirmCustodyCollection(tx, id, user.userId));
  } catch (error) {
    fail(id, error);
  }
  revalidatePath(`/deals/${id}`);
  redirect(`/deals/${id}?done=collected`);
}

export async function markItemHandedOverAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const id = String(formData.get('transactionId') ?? '');
  try {
    await enforceUserAndIpRateLimit('deal:mutation', user.userId, RATE_LIMITS.transaction);
    await db.transaction(async (tx) => markItemHandedOver(tx, id, user.userId));
  } catch (error) {
    fail(id, error);
  }
  revalidatePath(`/deals/${id}`);
  redirect(`/deals/${id}?done=handed-over`);
}

export async function confirmItemReceivedAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const id = String(formData.get('transactionId') ?? '');
  try {
    await enforceUserAndIpRateLimit('deal:mutation', user.userId, RATE_LIMITS.transaction);
    await db.transaction(async (tx) => confirmItemReceived(tx, id, user.userId));
  } catch (error) {
    fail(id, error);
  }
  revalidatePath(`/deals/${id}`);
  redirect(`/deals/${id}?done=received`);
}

export async function submitDisputeAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const id = String(formData.get('transactionId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  const detail = String(formData.get('detail') ?? '').trim();

  if (!isDisputeReason(reason) || !validDisputeDetail(detail)) {
    fail(id, new Error('Choose a reason and describe the issue in 10 to 2,000 characters.'));
  }

  try {
    await enforceUserAndIpRateLimit('deal:mutation', user.userId, RATE_LIMITS.transaction);
    await db.transaction(async (tx) => submitDispute({
      tx,
      transactionId: id,
      raisedBy: user.userId,
      reason: reason as DisputeReason,
      detail,
    }));
  } catch (error) {
    fail(id, error);
  }
  revalidatePath(`/deals/${id}`);
  redirect(`/deals/${id}?done=dispute-submitted`);
}

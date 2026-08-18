'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { markPaid, confirmPayment, disputePayment } from '@/services/transactions';
import { submitRating } from '@/services/ratings';

function fail(id: string, error: unknown): never {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  redirect(`/deals/${id}?error=${encodeURIComponent(message)}`);
}

export async function markPaidAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const id = String(formData.get('transactionId') ?? '');

  try {
    await db.transaction(async (tx) => markPaid(tx, id, user.userId));
  } catch (error) {
    fail(id, error);
  }
  revalidatePath(`/deals/${id}`);
  redirect(`/deals/${id}?done=marked`);
}

export async function confirmPaymentAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const id = String(formData.get('transactionId') ?? '');

  try {
    await db.transaction(async (tx) => confirmPayment(tx, id, user.userId));
  } catch (error) {
    fail(id, error);
  }
  revalidatePath(`/deals/${id}`);
  redirect(`/deals/${id}?done=confirmed`);
}

export async function disputePaymentAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const id = String(formData.get('transactionId') ?? '');

  try {
    await db.transaction(async (tx) => disputePayment(tx, id, user.userId));
  } catch (error) {
    fail(id, error);
  }
  revalidatePath(`/deals/${id}`);
  redirect(`/deals/${id}?done=disputed`);
}

export async function rateAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const id = String(formData.get('transactionId') ?? '');
  const stars = Number(formData.get('stars') ?? 0);
  const comment = String(formData.get('comment') ?? '').trim();

  try {
    await submitRating({
      transactionId: id,
      raterId: user.userId,
      stars,
      ...(comment !== '' ? { comment } : {}),
    });
  } catch (error) {
    fail(id, error);
  }
  revalidatePath(`/deals/${id}`);
  redirect(`/deals/${id}?done=rated`);
}

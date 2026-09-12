'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/admin';
import { confirmStoreApplication, declineStoreApplication, deleteRelayStore } from '@/services/store-applications';

function text(formData: FormData, field: string): string {
  return String(formData.get(field) ?? '').trim();
}

function finish(message: string): never {
  revalidatePath('/admin/stores');
  revalidatePath('/store');
  redirect(`/admin/stores?notice=${encodeURIComponent(message)}`);
}

export async function confirmStoreApplicationAction(formData: FormData): Promise<void> {
  const viewer = await requireAdmin();
  const id = text(formData, 'applicationId');
  if (id === '') finish('Choose a Store application first.');
  try {
    await confirmStoreApplication(id, viewer.userId);
  } catch (error) {
    finish(error instanceof Error ? error.message : 'The Store could not be confirmed.');
  }
  finish('Store confirmed and manager access created.');
}

export async function declineStoreApplicationAction(formData: FormData): Promise<void> {
  const viewer = await requireAdmin();
  const id = text(formData, 'applicationId');
  if (id === '') finish('Choose a Store application first.');
  try {
    await declineStoreApplication(id, viewer.userId, text(formData, 'adminNote'));
  } catch (error) {
    finish(error instanceof Error ? error.message : 'The Store application could not be declined.');
  }
  finish('Store application declined.');
}

export async function deleteStoreAction(formData: FormData): Promise<void> {
  const viewer = await requireAdmin();
  const id = text(formData, 'storeId');
  if (id === '') finish('Choose a Store first.');
  try {
    await deleteRelayStore(id, viewer.userId);
  } catch (error) {
    finish(error instanceof Error ? error.message : 'The Store could not be deleted.');
  }
  finish('Store deleted.');
}

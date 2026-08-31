'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db } from '../../../../src/db/client';
import { profiles } from '../../../../src/db/schema/profiles';
import { currentUser } from '../../../../src/lib/session';
import { confirmStoreApplication, declineStoreApplication } from '../../../../src/services/store-applications';

async function requireAdmin() {
  const viewer = await currentUser();
  if (viewer === null) redirect('/');
  const profile = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.userId, viewer.userId)).limit(1);
  if (profile[0]?.role !== 'admin') redirect('/');
  return viewer;
}

function text(formData: FormData, field: string): string {
  return String(formData.get(field) ?? '').trim();
}

function finish(message: string): never {
  revalidatePath('/stores');
  revalidatePath('/store');
  redirect(`/stores?notice=${encodeURIComponent(message)}`);
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

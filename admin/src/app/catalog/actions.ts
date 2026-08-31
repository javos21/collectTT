'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { db } from '../../../../src/db/client';
import { catalogValues } from '../../../../src/db/schema/catalog';
import { categories } from '../../../../src/db/schema/listings';
import { profiles } from '../../../../src/db/schema/profiles';
import { currentUser } from '../../../../src/lib/session';

function text(formData: FormData, field: string): string {
  return String(formData.get(field) ?? '').trim();
}

function safeKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
}

async function requireAdmin() {
  const viewer = await currentUser();
  if (viewer === null) redirect('/');
  const profile = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.userId, viewer.userId)).limit(1);
  if (profile[0]?.role !== 'admin') redirect('/');
  return viewer;
}

function finish(message: string): never {
  revalidatePath('/catalog');
  redirect(`/catalog?notice=${encodeURIComponent(message)}`);
}

export async function saveCategoryAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const originalKey = text(formData, 'originalKey');
  const label = text(formData, 'label');
  const key = safeKey(text(formData, 'key') || label);
  const sortOrder = Number(text(formData, 'sortOrder') || 0);
  if (label === '' || key === '' || !Number.isInteger(sortOrder)) finish('Add a name and a valid display order.');

  if (originalKey !== '') {
    await db.update(categories).set({ label, sortOrder, active: true, updatedAt: new Date() }).where(eq(categories.key, originalKey));
    finish(`Updated ${label}.`);
  }

  await db.insert(categories).values({ key, label, schemaVersion: 1, sortOrder, active: true }).onConflictDoUpdate({
    target: categories.key,
    set: { label, sortOrder, active: true, updatedAt: new Date() },
  });
  finish(`Added ${label}.`);
}

export async function removeCategoryAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const key = text(formData, 'key');
  const label = text(formData, 'label') || key;
  const sortOrder = Number(text(formData, 'sortOrder') || 0);
  if (key !== '') {
    const updated = await db.update(categories).set({ active: false, updatedAt: new Date() }).where(eq(categories.key, key)).returning({ key: categories.key });
    if (updated.length === 0) await db.insert(categories).values({ key, label, schemaVersion: 1, sortOrder, active: false });
  }
  finish('Category removed from the marketplace.');
}

export async function saveCatalogValueAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = text(formData, 'id');
  const kind = text(formData, 'kind');
  const label = text(formData, 'label');
  const key = safeKey(text(formData, 'key') || label);
  const sortOrder = Number(text(formData, 'sortOrder') || 0);
  if ((kind !== 'game' && kind !== 'condition') || label === '' || key === '' || !Number.isInteger(sortOrder)) finish('Add a name and a valid display order.');

  if (id !== '') {
    await db.update(catalogValues).set({ label, sortOrder, active: true, updatedAt: new Date() }).where(and(eq(catalogValues.id, id), eq(catalogValues.kind, kind)));
    finish(`Updated ${label}.`);
  }

  await db.insert(catalogValues).values({ kind, key, label, sortOrder, active: true }).onConflictDoUpdate({
    target: [catalogValues.kind, catalogValues.key],
    set: { label, sortOrder, active: true, updatedAt: new Date() },
  });
  finish(`Added ${label}.`);
}

export async function removeCatalogValueAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = text(formData, 'id');
  const kind = text(formData, 'kind');
  const key = text(formData, 'key');
  const label = text(formData, 'label') || key;
  const sortOrder = Number(text(formData, 'sortOrder') || 0);
  if (id !== '') {
    await db.update(catalogValues).set({ active: false, updatedAt: new Date() }).where(eq(catalogValues.id, id));
  } else if ((kind === 'game' || kind === 'condition') && key !== '') {
    await db.insert(catalogValues).values({ kind, key, label, sortOrder, active: false }).onConflictDoUpdate({
      target: [catalogValues.kind, catalogValues.key],
      set: { active: false, updatedAt: new Date() },
    });
  }
  finish('Catalog value removed.');
}

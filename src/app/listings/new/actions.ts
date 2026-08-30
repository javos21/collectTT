'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { currentUser } from '@/lib/session';
import { createListing } from '@/services/listings';
import { getCategory } from '@/domain/categories/definitions';
import { parseMoneyInput } from '@/domain/money';

function collectAttributes(categoryKey: string, formData: FormData): Record<string, unknown> {
  const definition = getCategory(categoryKey);
  const attributes: Record<string, unknown> = {};

  for (const attribute of definition.attributes) {
    const raw = formData.get(`attr__${attribute.key}`);
    if (raw === null || String(raw).trim() === '') continue;

    if (attribute.type === 'boolean') {
      attributes[attribute.key] = true;
    } else if (attribute.type === 'number' || attribute.type === 'year') {
      const number = Number(raw);
      if (Number.isFinite(number)) attributes[attribute.key] = number;
    } else {
      attributes[attribute.key] = String(raw).trim();
    }
  }

  return attributes;
}

const money = (formData: FormData, field: string): number | undefined => {
  const raw = String(formData.get(field) ?? '').trim();
  return raw === '' ? undefined : parseMoneyInput(raw) ?? undefined;
};

export async function createListingAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const category = String(formData.get('category') ?? '');
  const saleType = String(formData.get('saleType') ?? 'straight_sale');

  try {
    const listing = await createListing(user.userId, {
      category,
      title: String(formData.get('title') ?? ''),
      description: String(formData.get('description') ?? '') || undefined,
      saleType,
      priceCents: money(formData, 'price'),
      startBidCents: money(formData, 'startBid'),
      buyoutCents: money(formData, 'buyout'),
      durationHours: saleType === 'auction' ? Number(formData.get('durationHours') ?? 48) : undefined,
      fulfillmentPaths: formData.getAll('fulfillmentPaths').map(String),
      settlementMethods: formData.getAll('settlementMethods').map(String),
      relayStoreIds: formData.getAll('relayStoreIds').map(String),
      sizeClass: String(formData.get('sizeClass') ?? 'small'),
      autoRelistOnRenege: formData.get('autoRelistOnRenege') !== null,
      imageIds: formData.getAll('imageIds').map(String),
      attributes: collectAttributes(category, formData),
    }, { publish: true });

    redirect(`/listings/${listing.id}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' | ');
      redirect(`/listings/new?error=${encodeURIComponent(detail)}`);
    }
    throw error;
  }
}

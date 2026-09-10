'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { currentUser } from '@/lib/session';
import { createListing } from '@/services/listings';
import { UnavailableMarketplaceOptionError } from '@/services/platform-settings';
import { categoryDefinitionWithCatalogValues } from '@/services/catalog';
import { parseMoneyInput } from '@/domain/money';

function collectAttributes(definition: Awaited<ReturnType<typeof categoryDefinitionWithCatalogValues>>, formData: FormData): Record<string, unknown> {
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
    const definition = await categoryDefinitionWithCatalogValues(category, { activeOnly: true });
    const listing = await createListing(user.userId, {
      category,
      title: String(formData.get('title') ?? ''),
      description: String(formData.get('description') ?? '') || undefined,
      saleType,
      priceCents: money(formData, 'price'),
      acceptsOffers: formData.get('acceptsOffers') !== null,
      paymentWindowHours: Number(formData.get('paymentWindowHours') ?? 72),
      startBidCents: money(formData, 'startBid'),
      buyoutCents: money(formData, 'buyout'),
      durationHours: saleType === 'auction' ? Number(formData.get('durationHours') || 48) : undefined,
      deliveryOptionIds: formData.getAll('deliveryOptionIds').map(String),
      paymentOptionKeys: formData.getAll('paymentOptionKeys').map(String),
      relayStoreIds: formData.getAll('relayStoreIds').map(String),
      deliveryEstimates: Object.fromEntries(
        formData.getAll('deliveryOptionIds').map(String).map((optionId) => [
          optionId,
          Number(formData.get(`deliveryEstimate__${optionId}`) ?? 0),
        ]),
      ),
      autoRelistOnRenege: formData.get('autoRelistOnRenege') !== null,
      imageIds: formData.getAll('imageIds').map(String),
      attributes: collectAttributes(definition, formData),
    }, { publish: true });

    redirect(`/listings/${listing.id}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' | ');
      redirect(`/listings/new?error=${encodeURIComponent(detail)}`);
    }
    if (error instanceof UnavailableMarketplaceOptionError) {
      redirect(`/listings/new?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

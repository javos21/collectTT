import type { FulfillmentPath } from '@/domain/states/transaction';

type DeliveryOptionLocationPolicy = {
  fulfillmentPath: FulfillmentPath | null;
  requiresMeetupLocation: boolean;
};

/** Legacy callers without an exact delivery option retain the original meetup requirement. */
export function requiresMeetupLocationForPath(
  fulfillmentPath: FulfillmentPath | undefined,
  option?: DeliveryOptionLocationPolicy,
): boolean {
  return fulfillmentPath === 'cash_meetup' && (option?.requiresMeetupLocation ?? true);
}

export function selectionRequiresMeetupLocation(
  options: readonly DeliveryOptionLocationPolicy[],
  fulfillmentPaths: readonly FulfillmentPath[],
): boolean {
  return options.length > 0
    ? options.some((option) => requiresMeetupLocationForPath(option.fulfillmentPath ?? undefined, option))
    : fulfillmentPaths.includes('cash_meetup');
}

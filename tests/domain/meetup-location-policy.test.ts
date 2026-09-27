import { describe, expect, it } from 'vitest';

import {
  requiresMeetupLocationForPath,
  selectionRequiresMeetupLocation,
} from '../../src/domain/policy/meetup-location';

describe('meetup location policy', () => {
  it('allows an event collection option to use the meetup flow without a location', () => {
    const eventCollection = {
      fulfillmentPath: 'cash_meetup' as const,
      requiresMeetupLocation: false,
    };

    expect(requiresMeetupLocationForPath('cash_meetup', eventCollection)).toBe(false);
    expect(selectionRequiresMeetupLocation([eventCollection], ['cash_meetup'])).toBe(false);
  });

  it('preserves the location requirement for ordinary and legacy meetups', () => {
    const ordinaryMeetup = {
      fulfillmentPath: 'cash_meetup' as const,
      requiresMeetupLocation: true,
    };

    expect(requiresMeetupLocationForPath('cash_meetup', ordinaryMeetup)).toBe(true);
    expect(selectionRequiresMeetupLocation([ordinaryMeetup], ['cash_meetup'])).toBe(true);
    expect(requiresMeetupLocationForPath('cash_meetup')).toBe(true);
    expect(selectionRequiresMeetupLocation([], ['cash_meetup'])).toBe(true);
  });
});

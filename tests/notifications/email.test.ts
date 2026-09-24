import { describe, expect, it } from 'vitest';

import {
  notificationActionLabel,
  renderEmailHtml,
} from '../../src/notifications/adapters/email';
import { EVENTS, isEssentialEvent, OPTIONAL_NOTIFICATION_PREFERENCES } from '../../src/notifications/events';

describe('notification email CTAs', () => {
  it('describes meetup payment at the hand-off instead of before it', () => {
    const meetupBody = EVENTS.claim_confirmed_buyer.body({
      listingTitle: 'Card',
      fulfillmentPath: 'cash_meetup',
    });
    const remoteBody = EVENTS.claim_confirmed_buyer.body({ listingTitle: 'Card', fulfillmentPath: 'remote_ship' });

    expect(meetupBody).toContain('pay at the agreed meetup');
    expect(meetupBody).not.toContain('mark it paid');
    expect(remoteBody).toContain('mark it paid');
  });

  it('routes every event only to in-app and email in the beta', () => {
    const channels = new Set(Object.values(EVENTS).flatMap((event) => event.channels));
    expect([...channels].sort()).toEqual(['email', 'in_app']);
  });

  it('emails members when an auction is extended', () => {
    expect(EVENTS.auction_extended.channels).toEqual(['in_app', 'email']);
  });

  it('keeps preference controls limited to nonessential events', () => {
    expect(OPTIONAL_NOTIFICATION_PREFERENCES.every(({ eventType }) => !isEssentialEvent(eventType))).toBe(true);
    expect('payment_deadline_soon' in EVENTS).toBe(false);
    expect(isEssentialEvent('restriction_applied')).toBe(true);
    expect(isEssentialEvent('auction_outbid')).toBe(false);
  });

  it('labels listing destinations as View listing', () => {
    expect(notificationActionLabel('/listings/listing-123')).toBe('View listing');
    expect(notificationActionLabel('/listings/listing-123?from=email')).toBe('View listing');
  });

  it('labels deal destinations as View deal', () => {
    expect(notificationActionLabel('/deals/deal-123')).toBe('View deal');
    expect(notificationActionLabel('/deals/deal-123?from=email')).toBe('View deal');
  });

  it('does not invent a deal label for another destination', () => {
    expect(notificationActionLabel('/notifications')).toBeUndefined();
  });

  it('renders the selected CTA label in the shared HTML shell', () => {
    const listingHtml = renderEmailHtml({
      to: 'buyer@example.com',
      subject: 'You were outbid',
      text: 'Someone placed a higher bid.',
      actionUrl: '/listings/listing-123',
      actionLabel: notificationActionLabel('/listings/listing-123'),
    });
    const dealHtml = renderEmailHtml({
      to: 'buyer@example.com',
      subject: 'Payment confirmed',
      text: 'Your payment was confirmed.',
      actionUrl: '/deals/deal-123',
      actionLabel: notificationActionLabel('/deals/deal-123'),
    });

    expect(listingHtml).toContain('>View listing</a>');
    expect(listingHtml).not.toContain('>View deal</a>');
    expect(dealHtml).toContain('>View deal</a>');
    expect(dealHtml).not.toContain('>View listing</a>');
  });
});

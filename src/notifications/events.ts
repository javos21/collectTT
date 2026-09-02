/**
 * The notification event catalogue.
 *
 * Every event names its default channels. In-app and email are live now; WhatsApp is
 * listed against the events that will eventually justify a paid message (won auction,
 * payment reminder, custody ready) so the routing decision is already recorded — the
 * adapter simply is not built yet.
 *
 * Keeping the catalogue as data rather than scattered `notify(...)` calls is what makes
 * "one dispatch job, pluggable adapters" true.
 */

import type { NotificationChannel } from './dispatch';

export interface EventDefinition {
  type: string;
  /** Channels attempted unless the member has opted out. */
  channels: readonly NotificationChannel[];
  /** Terse by design — WhatsApp bills per message from Oct 2026. One message, not five. */
  title: (data: Record<string, unknown>) => string;
  body: (data: Record<string, unknown>) => string;
}

const str = (data: Record<string, unknown>, key: string, fallback = ''): string => {
  const v = data[key];
  return typeof v === 'string' ? v : fallback;
};

export const EVENTS = {
  // ---------------------------------------------------------------- listings
  listing_claimed_seller: {
    type: 'listing_claimed_seller',
    channels: ['in_app', 'email'],
    title: (d) => `${str(d, 'buyerName', 'Someone')} claimed "${str(d, 'listingTitle')}"`,
    body: (d) =>
      `${str(d, 'buyerName', 'A buyer')} claimed your listing. They have until ${str(d, 'deadline')} to pay.`,
  },
  claim_confirmed_buyer: {
    type: 'claim_confirmed_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `You claimed "${str(d, 'listingTitle')}"`,
    body: (d) => `Pay the seller by ${str(d, 'deadline')}, then mark it paid in the app.`,
  },
  claim_queued_buyer: {
    type: 'claim_queued_buyer',
    channels: ['in_app'],
    title: (d) => `You're #${str(d, 'position')} in line for "${str(d, 'listingTitle')}"`,
    body: () => `If the current claimer doesn't pay in time, it comes to you automatically.`,
  },
  offer_received_seller: {
    type: 'offer_received_seller',
    channels: ['in_app', 'email'],
    title: (d) => `${str(d, 'buyerName', 'Someone')} offered ${str(d, 'amount')} for "${str(d, 'listingTitle')}"`,
    body: () => `Review the offer and accept or reject it from your listing.`,
  },
  offer_accepted_buyer: {
    type: 'offer_accepted_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `Your offer was accepted for "${str(d, 'listingTitle')}"`,
    body: (d) => `Pay ${str(d, 'amount')} by ${str(d, 'deadline')}, then mark it paid.`,
  },
  offer_accepted_seller: {
    type: 'offer_accepted_seller',
    channels: ['in_app'],
    title: (d) => `You accepted ${str(d, 'buyerName', 'a buyer')}'s offer for "${str(d, 'listingTitle')}"`,
    body: (d) => `The deal is open at ${str(d, 'amount')}.`,
  },
  offer_rejected_buyer: {
    type: 'offer_rejected_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `Your offer was declined for "${str(d, 'listingTitle')}"`,
    body: () => `The seller declined this offer. You can try again while the listing is available.`,
  },
  claim_promoted_buyer: {
    type: 'claim_promoted_buyer',
    channels: ['in_app', 'email', 'whatsapp'],
    title: (d) => `You're up — "${str(d, 'listingTitle')}" is yours to claim`,
    body: (d) => `The previous buyer didn't pay in time. Pay by ${str(d, 'deadline')} to secure it.`,
  },

  // ---------------------------------------------------------------- auctions
  auction_outbid: {
    type: 'auction_outbid',
    channels: ['in_app', 'email'],
    title: (d) => `You were outbid on "${str(d, 'listingTitle')}"`,
    body: (d) => `The bid is now ${str(d, 'currentBid')}. Auction closes ${str(d, 'endsAt')}.`,
  },
  auction_extended: {
    type: 'auction_extended',
    channels: ['in_app'],
    title: (d) => `"${str(d, 'listingTitle')}" was extended`,
    body: (d) => `A late bid pushed the close out to ${str(d, 'endsAt')}.`,
  },
  auction_won: {
    type: 'auction_won',
    channels: ['in_app', 'email', 'whatsapp'],
    title: (d) => `You won "${str(d, 'listingTitle')}"`,
    body: (d) => `Pay ${str(d, 'amount')} by ${str(d, 'deadline')}, then mark it paid.`,
  },
  auction_ended_seller: {
    type: 'auction_ended_seller',
    channels: ['in_app', 'email'],
    title: (d) => `"${str(d, 'listingTitle')}" closed`,
    body: (d) => str(d, 'summary'),
  },

  // ---------------------------------------------------------------- payment track
  payment_marked_paid_seller: {
    type: 'payment_marked_paid_seller',
    channels: ['in_app', 'email', 'whatsapp'],
    title: (d) => `${str(d, 'buyerName', 'The buyer')} marked "${str(d, 'listingTitle')}" as paid`,
    body: () => `Confirm you received it, or dispute if you haven't.`,
  },
  payment_confirmed_buyer: {
    type: 'payment_confirmed_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `Payment confirmed for "${str(d, 'listingTitle')}"`,
    body: () => `The seller confirmed receipt.`,
  },
  payment_disputed_buyer: {
    type: 'payment_disputed_buyer',
    channels: ['in_app', 'email', 'whatsapp'],
    title: (d) => `The seller hasn't received payment for "${str(d, 'listingTitle')}"`,
    body: (d) => `Your deadline is still ${str(d, 'deadline')} — it was not extended.`,
  },
  payment_reminder: {
    type: 'payment_reminder',
    channels: ['in_app', 'email', 'whatsapp'],
    title: (d) => `Payment due for "${str(d, 'listingTitle')}"`,
    body: (d) => `You have until ${str(d, 'deadline')}. After that it goes to the next buyer.`,
  },
  payment_window_lapsed_buyer: {
    type: 'payment_window_lapsed_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `You lost "${str(d, 'listingTitle')}"`,
    body: () => `The payment window closed. This is recorded on your account.`,
  },

  // ---------------------------------------------------------------- seller side
  seller_dropoff_reminder: {
    type: 'seller_dropoff_reminder',
    channels: ['in_app', 'email', 'whatsapp'],
    title: (d) => `Drop off "${str(d, 'listingTitle')}" by ${str(d, 'deadline')}`,
    body: (d) => `Take it to ${str(d, 'storeName')} so the buyer can collect.`,
  },
  seller_dropoff_lapsed: {
    type: 'seller_dropoff_lapsed',
    channels: ['in_app', 'email'],
    title: (d) => `"${str(d, 'listingTitle')}" was cancelled — item never dropped off`,
    body: () => `This is recorded on your account.`,
  },
  buyer_told_to_hold_payment: {
    type: 'buyer_told_to_hold_payment',
    channels: ['in_app', 'email', 'whatsapp'],
    title: (d) => `Do not pay for "${str(d, 'listingTitle')}"`,
    body: () =>
      `The seller did not deliver the item in time and the deal has been cancelled. ` +
      `If you already paid, open a dispute.`,
  },

  // ---------------------------------------------------------------- custody track
  custody_received_buyer: {
    type: 'custody_received_buyer',
    channels: ['in_app', 'email', 'whatsapp'],
    title: (d) => `"${str(d, 'listingTitle')}" is at ${str(d, 'storeName')}`,
    body: (d) => `Once your payment is confirmed you can collect it. Pay by ${str(d, 'deadline')}.`,
  },
  custody_ready_for_pickup: {
    type: 'custody_ready_for_pickup',
    channels: ['in_app', 'email', 'whatsapp'],
    title: (d) => `Ready to collect at ${str(d, 'storeName')}`,
    body: (d) => `Collect "${str(d, 'listingTitle')}" by ${str(d, 'expiresAt')}.`,
  },
  custody_overstay_store: {
    type: 'custody_overstay_store',
    channels: ['in_app', 'email'],
    title: (d) => `Overstayed: "${str(d, 'listingTitle')}"`,
    body: (d) => `Held since ${str(d, 'droppedOffAt')}. Owner: ${str(d, 'ownerContact')}.`,
  },
  custody_return_to_seller: {
    type: 'custody_return_to_seller',
    channels: ['in_app', 'email', 'whatsapp'],
    title: (d) => `Collect "${str(d, 'listingTitle')}" from ${str(d, 'storeName')}`,
    body: () => `The buyer never paid, so the item is yours to reclaim.`,
  },

  // ---------------------------------------------------------------- completion
  transaction_completed: {
    type: 'transaction_completed',
    channels: ['in_app', 'email'],
    title: (d) => `Deal complete: "${str(d, 'listingTitle')}"`,
    body: () => `Your verified transaction record has been updated.`,
  },
  restriction_applied: {
    type: 'restriction_applied',
    channels: ['in_app', 'email'],
    title: () => `A restriction was applied to your account`,
    body: (d) => str(d, 'reason'),
  },
} as const satisfies Record<string, EventDefinition>;

export type EventType = keyof typeof EVENTS;

export function eventDefinition(type: EventType): EventDefinition {
  return EVENTS[type];
}

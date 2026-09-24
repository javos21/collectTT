/**
 * The notification event catalogue.
 *
 * Every event names its default channels. The v1 catalogue uses in-app and email
 * delivery; SMS is reserved for identity verification and is not a preference-driven
 * marketplace channel.
 *
 * Keeping the catalogue as data rather than scattered `notify(...)` calls is what makes
 * "one dispatch job, pluggable adapters" true.
 */

import type { NotificationChannel } from './dispatch';

export interface EventDefinition {
  type: string;
  /** Channels attempted unless the member has opted out. */
  channels: readonly NotificationChannel[];
  title: (data: Record<string, unknown>) => string;
  body: (data: Record<string, unknown>) => string;
}

const str = (data: Record<string, unknown>, key: string, fallback = ''): string => {
  const v = data[key];
  return typeof v === 'string' ? v : fallback;
};

const isCashMeetup = (data: Record<string, unknown>): boolean => data.fulfillmentPath === 'cash_meetup';

export const EVENTS = {
  // ---------------------------------------------------------------- listings
  listing_claimed_seller: {
    type: 'listing_claimed_seller',
    channels: ['in_app', 'email'],
    title: (d) => `${str(d, 'buyerName', 'Someone')} reserved "${str(d, 'listingTitle')}"`,
    body: (d) =>
      `${str(d, 'buyerName', 'A buyer')} reserved your listing. Open the deal to review the next steps.`,
  },
  claim_confirmed_buyer: {
    type: 'claim_confirmed_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `You reserved "${str(d, 'listingTitle')}"`,
    body: (d) => isCashMeetup(d)
      ? `Your purchase commitment is open. Meet the seller, pay at the agreed meetup, and confirm collection in the app.`
      : `Your purchase commitment is open. Pay the seller, then mark it paid in the app.`,
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
    body: (d) => isCashMeetup(d)
      ? `Meet the seller, pay ${str(d, 'amount')} at the agreed meetup, and confirm collection.`
      : `Pay ${str(d, 'amount')}, then mark it paid.`,
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
  offer_closed_after_payment_buyer: {
    type: 'offer_closed_after_payment_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `Another offer completed for "${str(d, 'listingTitle')}"`,
    body: () => `The accepted buyer paid, so this offer is now closed.`,
  },
  offer_cancelled_seller: {
    type: 'offer_cancelled_seller',
    channels: ['in_app'],
    title: (d) => `An offer was cancelled for "${str(d, 'listingTitle')}"`,
    body: () => `The buyer cancelled their offer and may have claimed the item at the asking price.`,
  },
  auction_runner_up_buyer: {
    type: 'auction_runner_up_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `You're up for "${str(d, 'listingTitle')}"`,
    body: (d) => isCashMeetup(d)
      ? `The previous auction buyer did not complete the deal. Meet the seller, pay at the agreed meetup, and confirm collection to secure it.`
      : `The previous auction buyer did not complete the deal. Pay to secure it.`,
  },
  auction_fallback_offer_buyer: {
    type: 'auction_fallback_offer_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `A fallback offer is waiting for "${str(d, 'listingTitle')}"`,
    body: (d) => `You are next in line at ${str(d, 'amount')}. Accept by ${str(d, 'expiresAt')} to open the deal.`,
  },
  auction_fallback_offer_seller: {
    type: 'auction_fallback_offer_seller',
    channels: ['in_app'],
    title: (d) => `A fallback offer was sent for "${str(d, 'listingTitle')}"`,
    body: (d) => `The next bidder has until ${str(d, 'expiresAt')} to accept at ${str(d, 'amount')}.`,
  },
  auction_fallback_offer_expired_buyer: {
    type: 'auction_fallback_offer_expired_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `The fallback offer expired for "${str(d, 'listingTitle')}"`,
    body: () => `The offer was not accepted in time, so the item moved to the next auction candidate.`,
  },
  auction_bid_invalidated_buyer: {
    type: 'auction_bid_invalidated_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `Your bid was invalidated for "${str(d, 'listingTitle')}"`,
    body: (d) => `An administrator reviewed the auction and invalidated your ${str(d, 'amount')} bid. Reason: ${str(d, 'reason')}`,
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
    channels: ['in_app', 'email'],
    title: (d) => `"${str(d, 'listingTitle')}" was extended`,
    body: (d) => `A late bid pushed the close out to ${str(d, 'endsAt')}.`,
  },
  auction_won: {
    type: 'auction_won',
    channels: ['in_app', 'email'],
    title: (d) => `You won "${str(d, 'listingTitle')}"`,
    body: (d) => isCashMeetup(d)
      ? `Meet the seller, pay ${str(d, 'amount')} at the agreed meetup, and confirm collection.`
      : `Pay ${str(d, 'amount')}, then mark it paid.`,
  },
  auction_ended_seller: {
    type: 'auction_ended_seller',
    channels: ['in_app', 'email'],
    title: (d) => `"${str(d, 'listingTitle')}" closed`,
    body: (d) => str(d, 'summary'),
  },
  listing_expired_seller: {
    type: 'listing_expired_seller',
    channels: ['in_app', 'email'],
    title: (d) => `"${str(d, 'listingTitle')}" expired`,
    body: () => `Your listing expired after the platform listing lifetime. You can relist it as a new draft.`,
  },

  // ---------------------------------------------------------------- payment track
  payment_marked_paid_seller: {
    type: 'payment_marked_paid_seller',
    channels: ['in_app', 'email'],
    title: (d) => `${str(d, 'buyerName', 'The buyer')} marked "${str(d, 'listingTitle')}" as paid`,
    body: () => `The payment step is complete. No confirmation is required from you.`,
  },
  payment_confirmed_buyer: {
    type: 'payment_confirmed_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `Payment confirmed for "${str(d, 'listingTitle')}"`,
    body: () => `The seller confirmed receipt.`,
  },
  payment_disputed_buyer: {
    type: 'payment_disputed_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `The seller hasn't received payment for "${str(d, 'listingTitle')}"`,
    body: () => `The seller reported that payment has not arrived. Review the deal and contact the seller if needed.`,
  },
  payment_window_lapsed_buyer: {
    type: 'payment_window_lapsed_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `You lost "${str(d, 'listingTitle')}"`,
    body: () => `Payment was not confirmed, so the reservation was released. This is recorded on your account.`,
  },
  payment_window_lapsed_seller: {
    type: 'payment_window_lapsed_seller',
    channels: ['in_app', 'email'],
    title: (d) => `The reservation was released for "${str(d, 'listingTitle')}"`,
    body: () => `The buyer did not confirm payment, so the reservation was released.`,
  },
  meetup_window_lapsed_buyer: {
    type: 'meetup_window_lapsed_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `You lost "${str(d, 'listingTitle')}"`,
    body: () => `The meetup was not completed in time, so the reservation was released. This is recorded on your account.`,
  },
  meetup_window_lapsed_seller: {
    type: 'meetup_window_lapsed_seller',
    channels: ['in_app', 'email'],
    title: (d) => `The reservation was released for "${str(d, 'listingTitle')}"`,
    body: () => `The buyer did not complete the meetup, so the reservation was released.`,
  },

  // ---------------------------------------------------------------- disputes
  dispute_submitted_member: {
    type: 'dispute_submitted_member',
    channels: ['in_app', 'email'],
    title: (d) => `A dispute was opened for "${str(d, 'listingTitle')}"`,
    body: (d) => `The reported issue is: ${str(d, 'reason', 'an issue')}. CollectTT support will review the deal.`,
  },
  dispute_reviewed_member: {
    type: 'dispute_reviewed_member',
    channels: ['in_app', 'email'],
    title: (d) => `A dispute about "${str(d, 'listingTitle')}" was ${str(d, 'status', 'reviewed')}`,
    body: (d) => str(d, 'resolution', 'CollectTT support reviewed the dispute.'),
  },
  item_handed_over_buyer: {
    type: 'item_handed_over_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `Meetup hand-off recorded for "${str(d, 'listingTitle')}"`,
    body: () => `Confirm that you received the item, or report a problem before the receipt window closes.`,
  },
  item_received_seller: {
    type: 'item_received_seller',
    channels: ['in_app', 'email'],
    title: (d) => `Receipt confirmed for "${str(d, 'listingTitle')}"`,
    body: () => `The buyer confirmed receipt. Your deal is complete.`,
  },

  // ---------------------------------------------------------------- seller side
  seller_dropoff_reminder: {
    type: 'seller_dropoff_reminder',
    channels: ['in_app', 'email'],
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
    channels: ['in_app', 'email'],
    title: (d) => `Do not pay for "${str(d, 'listingTitle')}"`,
    body: () =>
      `The seller did not deliver the item in time and the deal has been cancelled. ` +
      `If you already paid, open a dispute.`,
  },

  // ---------------------------------------------------------------- custody track
  custody_received_buyer: {
    type: 'custody_received_buyer',
    channels: ['in_app', 'email'],
    title: (d) => `"${str(d, 'listingTitle')}" is at ${str(d, 'storeName')}`,
    body: () => `Once you mark payment as sent you can collect it.`,
  },
  custody_return_to_seller: {
    type: 'custody_return_to_seller',
    channels: ['in_app', 'email'],
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
  restriction_warning: {
    type: 'restriction_warning',
    channels: ['in_app', 'email'],
    title: () => `Your account is approaching a marketplace restriction`,
    body: (d) => str(d, 'reason'),
  },
  support_case_updated: {
    type: 'support_case_updated',
    channels: ['in_app', 'email'],
    title: (d) => `Your support report was ${str(d, 'status', 'updated')}`,
    body: (d) => str(d, 'resolution', 'CollectTT support updated your report.'),
  },
  listing_moderation_updated: {
    type: 'listing_moderation_updated',
    channels: ['in_app', 'email'],
    title: (d) => `Your listing "${str(d, 'listingTitle')}" was updated by support`,
    body: (d) => str(d, 'reason'),
  },
  transaction_admin_cancelled: {
    type: 'transaction_admin_cancelled',
    channels: ['in_app', 'email'],
    title: (d) => `Your deal for "${str(d, 'listingTitle')}" was cancelled`,
    body: (d) => str(d, 'reason'),
  },
} as const satisfies Record<string, EventDefinition>;

export type EventType = keyof typeof EVENTS;

/**
 * These events are operationally important and cannot be muted by a member. They
 * cover commitment, payment, dispute, security, and restriction changes.
 * Preference rows only affect nonessential events; an absent row means enabled.
 */
const MANDATORY_EVENT_TYPES = new Set<EventType>([
  'listing_claimed_seller',
  'claim_confirmed_buyer',
  'auction_won',
  'auction_runner_up_buyer',
  'auction_fallback_offer_buyer',
  'payment_marked_paid_seller',
  'payment_confirmed_buyer',
  'payment_disputed_buyer',
  'payment_window_lapsed_buyer',
  'payment_window_lapsed_seller',
  'meetup_window_lapsed_buyer',
  'meetup_window_lapsed_seller',
  'item_handed_over_buyer',
  'item_received_seller',
  'dispute_submitted_member',
  'dispute_reviewed_member',
  'transaction_completed',
  'restriction_applied',
  'restriction_warning',
  'support_case_updated',
  'transaction_admin_cancelled',
  'listing_moderation_updated',
  'auction_bid_invalidated_buyer',
]);

export function isEssentialEvent(type: EventType): boolean {
  return MANDATORY_EVENT_TYPES.has(type);
}

/** Member-facing controls for optional email notifications. */
export const OPTIONAL_NOTIFICATION_PREFERENCES = [
  {
    eventType: 'auction_outbid',
    label: 'Auction outbid updates',
    description: 'Email me when another bidder moves ahead of me.',
  },
  {
    eventType: 'auction_extended',
    label: 'Auction extension updates',
    description: 'Email me when a late bid extends an auction.',
  },
  {
    eventType: 'auction_ended_seller',
    label: 'Auction close updates',
    description: 'Email me when one of my auctions closes.',
  },
  {
    eventType: 'listing_expired_seller',
    label: 'Listing expiry updates',
    description: 'Email me when one of my fixed-price listings expires.',
  },
] as const satisfies ReadonlyArray<{
  eventType: EventType;
  label: string;
  description: string;
}>;

export function eventDefinition(type: EventType): EventDefinition {
  return EVENTS[type];
}

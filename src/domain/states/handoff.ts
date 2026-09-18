/**
 * The peer-to-peer item hand-off track used by v1 cash-meetup transactions.
 * Payment confirmation is not the same thing as receipt: the seller records the
 * hand-off, then the buyer records receipt. Legacy transactions use
 * `not_applicable` and keep their historical two-track behaviour.
 */

import type { ActorRole } from './actors';
import type { FulfillmentPath } from './transaction';

export const HANDOFF_STATES = [
  'not_applicable',
  'awaiting_handoff',
  'seller_handed_over',
  'buyer_received',
] as const;

export type HandoffState = (typeof HANDOFF_STATES)[number];

export const HANDOFF_TRANSITIONS = {
  not_applicable: [],
  awaiting_handoff: ['seller_handed_over'],
  seller_handed_over: ['buyer_received'],
  buyer_received: [],
} as const satisfies Record<HandoffState, readonly HandoffState[]>;

export const HANDOFF_TRANSITION_ACTORS: Record<string, readonly ActorRole[]> = {
  'awaiting_handoff->seller_handed_over': ['seller', 'system', 'admin'],
  'seller_handed_over->buyer_received': ['buyer', 'system', 'admin'],
};

export function canTransitionHandoff(from: HandoffState, to: HandoffState): boolean {
  return (HANDOFF_TRANSITIONS[from] as readonly HandoffState[]).includes(to);
}

export function assertHandoffTransition(from: HandoffState, to: HandoffState): void {
  if (!canTransitionHandoff(from, to)) {
    throw new IllegalHandoffTransitionError(from, to);
  }
}

export function isHandoffSettled(state: HandoffState): boolean {
  return state === 'not_applicable' || state === 'buyer_received';
}

export function initialHandoffState(path: FulfillmentPath, v1: boolean): HandoffState {
  return v1 && path === 'cash_meetup' ? 'awaiting_handoff' : 'not_applicable';
}

export class IllegalHandoffTransitionError extends Error {
  constructor(readonly from: HandoffState, readonly to: HandoffState) {
    super(`Illegal handoff transition: ${from} -> ${to}`);
    this.name = 'IllegalHandoffTransitionError';
  }
}

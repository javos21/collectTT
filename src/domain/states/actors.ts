/**
 * Who can drive a transition. Recorded on every `transaction_events` row so the
 * audit log answers "who moved this, and were they allowed to?" after the fact.
 */

export const ACTOR_ROLES = ['buyer', 'seller', 'store', 'system', 'admin'] as const;

export type ActorRole = (typeof ACTOR_ROLES)[number];

/** Which track a recorded event belongs to. */
export const EVENT_TRACKS = ['overall', 'payment', 'custody'] as const;

export type EventTrack = (typeof EVENT_TRACKS)[number];

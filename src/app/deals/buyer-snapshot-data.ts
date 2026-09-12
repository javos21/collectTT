import type { TrustSnapshot } from '@/services/reputation';

export type BuyerSnapshotData = {
  userId: string;
  displayName: string;
  handle: string;
  area: string | null;
  memberSince: string;
  counters: {
    buyClaimsTotal: number;
    buyCompleted: number;
    buyReneged90d: number;
    buyPaidOnTime: number;
    sellCompleted: number;
    sellReneged90d: number;
  };
  events: Array<{
    id: string;
    type: string;
    title: string | null;
    occurredAt: string;
  }>;
};

export function serializeTrustSnapshot(snapshot: TrustSnapshot): BuyerSnapshotData {
  return {
    userId: snapshot.userId,
    displayName: snapshot.displayName,
    handle: snapshot.handle,
    area: snapshot.area,
    memberSince: snapshot.memberSince.toISOString(),
    counters: snapshot.counters,
    events: snapshot.events.map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      occurredAt: event.occurredAt.toISOString(),
    })),
  };
}

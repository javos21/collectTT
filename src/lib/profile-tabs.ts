export const profileTabs = [
  { id: 'activity', label: 'Activity' },
  { id: 'bids-offers', label: 'Bids & Offers' },
  { id: 'trust', label: 'Trust' },
  { id: 'listings', label: 'Listings' },
] as const;

export type ProfileTabId = (typeof profileTabs)[number]['id'];

export function isProfileTabId(value: string | undefined): value is ProfileTabId {
  return profileTabs.some((tab) => tab.id === value);
}

/**
 * Keep previously shared profile links useful while the profile navigation is
 * intentionally reduced to the four jobs users return to most often.
 */
export function normalizeProfileTab(value: string | undefined): ProfileTabId {
  if (isProfileTabId(value)) return value;
  if (value === 'bids' || value === 'offers') return 'bids-offers';
  if (value === 'details' || value === 'claims' || value === 'history' || value === 'settings') return 'activity';
  return 'activity';
}

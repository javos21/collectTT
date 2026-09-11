export const profileTabs = [
  { id: 'details', label: 'My Details' },
  { id: 'trust', label: 'Trust & Activity' },
  { id: 'listings', label: 'My Listings' },
  { id: 'claims', label: 'Claims' },
  { id: 'bids-offers', label: 'Bids / Offers' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
] as const;

export type ProfileTabId = (typeof profileTabs)[number]['id'];

export function isProfileTabId(value: string | undefined): value is ProfileTabId {
  return profileTabs.some((tab) => tab.id === value);
}

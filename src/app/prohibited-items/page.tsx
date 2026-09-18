import type { Metadata } from 'next';
import { LegalPage } from '../legal-page';

export const metadata: Metadata = { title: 'Prohibited Items — CollectTT' };

export default function ProhibitedItemsPage() {
  return <LegalPage eyebrow="Safety" title="Prohibited items" updated="Last updated September 13, 2026 · Draft pending legal review">
    <p>CollectTT is for lawful collectibles and related items. If an item is illegal to possess, sell, import, export, or transfer, do not list it here.</p>
    <h2>Do not list</h2>
    <ul><li>Stolen, counterfeit, fraudulent, or knowingly misrepresented goods.</li><li>Weapons, ammunition, explosives, controlled substances, or hazardous materials.</li><li>Items that infringe another person’s intellectual-property or privacy rights.</li><li>Adult, exploitative, or abusive material, including anything involving minors.</li><li>Financial products, accounts, personal data, or items whose sale requires a regulated licence not held by the seller.</li></ul>
    <h2>If you see a prohibited listing</h2>
    <p>Use the listing’s report flow and explain the concern. Support may hide or remove the listing and may restrict the account while it investigates.</p>
  </LegalPage>;
}

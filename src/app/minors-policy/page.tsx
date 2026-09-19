import type { Metadata } from 'next';
import { LegalPage } from '../legal-page';

export const metadata: Metadata = { title: 'Minors Policy — CollectTT' };

export default function MinorsPolicyPage() {
  return <LegalPage eyebrow="Safety" title="Minors policy" updated="Last updated September 13, 2026">
    <h2>Account age</h2>
    <p>CollectTT marketplace accounts are intended for adults who can enter binding purchase and sale commitments. Do not create or operate an account for a child without the involvement and responsibility of a parent or legal guardian where applicable.</p>
    <h2>Safety boundary</h2>
    <p>Never arrange a private meetup involving a minor. Do not share a child’s name, phone number, image, school, address, or other identifying information in a listing, report, or transaction evidence.</p>
    <h2>Report a concern</h2>
    <p>If a listing or account appears to put a minor at risk, report it immediately from the relevant context. Support may pause the account and preserve the report for safety review.</p>
  </LegalPage>;
}

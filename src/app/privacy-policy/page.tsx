import type { Metadata } from 'next';
import { LegalPage } from '../legal-page';

export const metadata: Metadata = { title: 'Privacy Policy — CollectTT' };

export default function PrivacyPolicyPage() {
  return <LegalPage eyebrow="Legal" title="Privacy Policy" updated="Last updated September 13, 2026 · Draft pending legal review">
    <h2>Information we use</h2>
    <p>CollectTT uses account details, public display information, private contact details, listings, bids, reservations, transaction milestones, support reports, delivery records, and audit events to provide and protect the marketplace.</p>
    <h2>What is public</h2>
    <p>Your public display name, listings, and factual Trust Snapshot activity may be visible to other members. Your account name, email, phone number, reports, private evidence, and administrator notes are not public profile fields.</p>
    <h2>When contact details are disclosed</h2>
    <p>Phone numbers are private before a valid commitment. After a reservation or settled auction transaction, the two transaction parties may see the contact details needed to coordinate hand-off. Authorized support staff access sensitive information only for a documented support reason.</p>
    <h2>Retention</h2>
    <p>We retain transaction history, support records, notification delivery history, security challenges, and audit events for as long as needed to operate the service, investigate disputes, enforce rules, and meet legal obligations. Private evidence is retained only for the approved operational retention period.</p>
    <h2>Your choices</h2>
    <p>You can update your account and public display name, manage optional email notifications, and ask support about an account-data request. Essential commitment, security, deadline, dispute, and restriction messages cannot be disabled.</p>
  </LegalPage>;
}

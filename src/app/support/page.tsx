import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '../legal-page';

export const metadata: Metadata = { title: 'Support — CollectTT' };

export default function SupportPage() {
  return <LegalPage eyebrow="Help" title="CollectTT support" updated="Support guidance for v1">
    <h2>Report a marketplace problem</h2>
    <p>Open the relevant listing, member profile, or deal and use its private report form. Include what happened, when it happened, and only the evidence support needs to review the issue.</p>
    <h2>Payment questions</h2>
    <p>CollectTT does not hold or reverse direct cash or bank-transfer payments. If a deal is open, use the deal room to report a payment or hand-off problem so the deadline and automatic completion rules can pause while support reviews it.</p>
    <h2>Account and privacy requests</h2>
    <p>For account access, contact details, privacy, or safety concerns, sign in and report the account context from the member page when available. Do not post phone numbers, passwords, or banking details in a public listing.</p>
    <h2>Quick links</h2>
    <ul><li><Link href="/terms-of-service">Terms of Service</Link></li><li><Link href="/privacy-policy">Privacy Policy</Link></li><li><Link href="/prohibited-items">Prohibited items</Link></li></ul>
  </LegalPage>;
}

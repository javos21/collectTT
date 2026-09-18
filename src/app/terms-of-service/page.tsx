import type { Metadata } from 'next';
import { LegalPage } from '../legal-page';

export const metadata: Metadata = { title: 'Terms of Service — CollectTT' };

export default function TermsOfServicePage() {
  return <LegalPage eyebrow="Legal" title="Terms of Service" updated="Last updated September 13, 2026 · Draft pending legal review">
    <h2>What CollectTT is</h2>
    <p>CollectTT is a structured marketplace for collectibles in Trinidad and Tobago. Members create listings, make binding reservations or bids, and coordinate ordinary payments and hand-off directly with one another.</p>
    <h2>Member responsibilities</h2>
    <p>You must provide accurate account and listing details, keep your account secure, and complete commitments you make. Do not list prohibited, counterfeit, stolen, unsafe, or unlawful items.</p>
    <h2>Direct payments and authenticity</h2>
    <p>CollectTT does not hold ordinary marketplace funds, authenticate collectibles, or guarantee a member’s identity, item condition, payment, or delivery. Payments made directly to another member are not protected by CollectTT. Review the item and payment details before proceeding.</p>
    <h2>Support and disputes</h2>
    <p>Members may report a problem from the relevant listing, account, or deal. Support may pause a deal, request evidence, resolve a report, remove a listing, apply restrictions, or cancel a transaction where the rules or safety of the marketplace require it.</p>
    <h2>Account action</h2>
    <p>We may limit or suspend marketplace capabilities for policy violations, unsafe activity, fraud indicators, repeated incomplete commitments, or legal reasons. Objective transaction history and support decisions may be retained to operate the marketplace.</p>
  </LegalPage>;
}

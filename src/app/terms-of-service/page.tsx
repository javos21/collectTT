import type { Metadata } from 'next';
import { LegalPage } from '../legal-page';
import { TERMS_VERSION } from '@/lib/legal';

export const metadata: Metadata = { title: 'Terms of Service — CollectTT' };

export default function TermsOfServicePage() {
  return <LegalPage eyebrow="Legal" title="Terms of Service" updated={`Version ${TERMS_VERSION} · Last updated September 19, 2026`}>
    <p>These Terms describe the rules for the CollectTT marketplace, including listings, offers, auctions, direct payments, and meetups. Please read them before using CollectTT.</p>

    <h2>1. Who operates CollectTT</h2>
    <p>CollectTT operates the CollectTT marketplace (“CollectTT”, “we”, “us”, or “our”).</p>
    <p>Questions about these Terms can be sent through the <a href="/support">CollectTT support page</a>.</p>

    <h2>2. Accepting these Terms</h2>
    <p>By creating an account, checking the acceptance box, or using a feature that requires an account, you agree to these Terms and the <a href="/privacy-policy">Privacy Policy</a>. If you do not agree, do not create an account or use the marketplace. We record the Terms version accepted at account creation.</p>
    <p>If you accept on behalf of a business or another person, you confirm that you have authority to bind them. A later material change may require you to accept a new version before continuing to use affected features.</p>

    <h2>3. Eligibility and account security</h2>
    <p>CollectTT is intended for adults who can enter binding commitments. Do not create an account for a child or use the marketplace to arrange a private meetup involving a minor. You must provide accurate information, keep your password and verification codes private, and promptly report suspected account compromise.</p>
    <p>One person may not create accounts to evade a restriction, manipulate a listing, or mislead another member. You are responsible for activity carried out through your account unless you promptly report unauthorized access.</p>

    <h2>4. CollectTT is a marketplace platform</h2>
    <p>CollectTT provides software for members to publish listings, communicate structured offers and bids, record commitment milestones, and coordinate a hand-off. CollectTT is not the seller, buyer, owner, shipper, appraiser, authenticator, insurer, payment processor, escrow agent, or agent of either member.</p>
    <p>Except where a separately identified service says otherwise, CollectTT does not take custody of items or ordinary marketplace funds. A listing, profile, Trust Snapshot, or verification indicator is not a guarantee of identity, ownership, authenticity, condition, value, availability, or performance.</p>

    <h2>5. Listings and seller responsibilities</h2>
    <p>Sellers must have the right to sell the item and must describe it honestly, including material defects, condition, completeness, photographs, price, payment methods, and any delivery or meetup terms. Do not list stolen, counterfeit, unsafe, unlawful, recalled, regulated, or prohibited items. The <a href="/prohibited-items">Prohibited Items</a> page forms part of these rules.</p>
    <p>Sellers must honor an accepted commitment unless cancellation is permitted by the listing terms, a safety issue, a support decision, or applicable law. Sellers remain responsible for taxes, licences, consumer obligations, packaging, delivery, and any promises they make to a buyer.</p>

    <h2>6. Offers, reservations, and auctions</h2>
    <p>An offer is a proposal from a buyer; it is not a reservation until the seller accepts it. Once an offer, reservation, or auction result is accepted or otherwise marked as a commitment in CollectTT, the relevant members must follow the displayed payment and hand-off steps, subject to cancellation rights, support intervention, and applicable law.</p>
    <p>Bids must be genuine. Do not bid on your own listing, coordinate artificial bids, submit bids you do not intend to honor, or use another account to manipulate price or availability. Auction deadlines and fallback offers are recorded by the marketplace system; do not assume that a message outside CollectTT changes them.</p>

    <h2>7. Meetups, delivery, and personal safety</h2>
    <p>Members arrange ordinary cash meetups, bank transfers, shipping, or other displayed hand-off options directly with one another. Meet in a public, lawful, well-lit place, tell someone where you are going, inspect an item before paying where practical, and do not share more personal information than needed.</p>
    <p>CollectTT does not guarantee a meetup, delivery, payment, or return. Do not put yourself or another person at risk to complete a commitment. Report a safety concern immediately; CollectTT may pause a deal or restrict an account.</p>

    <h2>8. Payments, fees, refunds, and consumer rights</h2>
    <p>Unless a page expressly says otherwise, payment is made directly between members. CollectTT does not receive, hold, reverse, or insure those funds. A payment made directly to another member is not protected by CollectTT, and a bank-transfer or cash payment may be difficult or impossible to recover.</p>
    <p>Any CollectTT fee will be shown before it is charged and will be described in the applicable flow. Sellers and buyers remain responsible for taxes and legally required invoices or disclosures. Refunds, cancellations, returns, and remedies are governed by the parties’ stated terms and applicable consumer law. Nothing in these Terms removes a right that cannot lawfully be excluded; a blanket “no refund” statement does not override mandatory law.</p>

    <h2>9. Prohibited conduct</h2>
    <p>You may not use CollectTT for fraud, money laundering, harassment, threats, discrimination, doxxing, spam, scraping, malware, evasion of a restriction, intellectual-property infringement, unlawful goods, or any activity that puts members or the service at unreasonable risk.</p>
    <p>Do not post passwords, full payment-card details, government identification numbers, private addresses, or another person’s personal information in a public listing or message.</p>

    <h2>10. Reports, support, and enforcement</h2>
    <p>You can report a listing, account, payment, hand-off, or safety concern through the relevant private report flow. Provide truthful, relevant information and preserve evidence. Support may request more information, hide or remove content, pause a deal, cancel a transaction state, restrict capabilities, or refer a matter to law enforcement where appropriate.</p>
    <p>We do not promise to resolve every dispute or to act as a court. A support action is not an admission of liability and does not prevent a member from using a lawful remedy.</p>

    <h2>11. User content and feedback</h2>
    <p>You retain rights you have in your photos, descriptions, and other content. You grant CollectTT a non-exclusive, worldwide, royalty-free licence to host, reproduce, format, display, and moderate that content as needed to operate, secure, improve, and promote the service. You confirm that you have permission to upload it and that it does not violate another person’s rights.</p>
    <p>If you send feedback, you allow CollectTT to use it without owing compensation. We may remove content that violates these Terms, the law, or the safety of the marketplace.</p>

    <h2>12. Intellectual property</h2>
    <p>The CollectTT software, branding, design, and service materials belong to CollectTT or its licensors. We give you a limited, revocable, non-transferable permission to use them for the marketplace. Do not copy, reverse engineer, frame, resell, or use CollectTT marks without written permission, except where law permits.</p>

    <h2>13. Privacy and service providers</h2>
    <p>Our <a href="/privacy-policy">Privacy Policy</a> explains the information we collect, why we use it, when we share it, and how to submit a privacy request. We use infrastructure and service providers to host the database, store images, deliver messages, prevent abuse, and operate the site. Those providers may process information in countries where they or their infrastructure operate.</p>

    <h2>14. Suspension, termination, and deletion</h2>
    <p>You may stop using CollectTT and request account deletion through support, subject to records we must retain for security, disputes, accounting, fraud prevention, or legal obligations. We may suspend or close an account, remove content, or limit a feature if we reasonably believe it is necessary for safety, policy enforcement, legal compliance, or service integrity.</p>
    <p>Closing an account does not erase commitments, reports, audit records, or obligations that arose before closure. Sections intended by their nature to continue will survive termination.</p>

    <h2>15. Availability and disclaimers</h2>
    <p>The service is provided on an “as available” basis. We do not promise uninterrupted operation, error-free records, a particular number of buyers or sellers, or that information supplied by a member is accurate. To the extent permitted by law, we disclaim implied warranties that cannot be expressly verified from the service.</p>

    <h2>16. Liability</h2>
    <p>To the maximum extent permitted by applicable law, CollectTT is not responsible for indirect, incidental, special, consequential, exemplary, or punitive loss, lost profit, lost opportunity, loss of data, or loss arising from a member’s conduct, item, payment, delivery, meetup, or content. Nothing in these Terms excludes liability that the law does not allow us to exclude, including liability for fraud or deliberate misconduct.</p>
    <h2>17. Indemnity</h2>
    <p>To the extent permitted by law, you agree to reimburse CollectTT for reasonable losses, claims, costs, and professional fees arising from your breach of these Terms, unlawful conduct, content, or dispute with another member. This does not require you to indemnify CollectTT for its own non-excludable misconduct.</p>

    <h2>18. Governing law and disputes</h2>
    <p>These Terms and disputes arising from them are governed by the laws of Trinidad and Tobago and may be heard by a court with proper jurisdiction there, subject to mandatory consumer protections and any right to bring a claim elsewhere that cannot lawfully be waived.</p>

    <h2>19. Changes to these Terms</h2>
    <p>We may update these Terms to reflect product, safety, or legal changes. We will publish the new version and update the version date. If a change materially affects your rights or obligations, we will provide a reasonable notice and may require renewed acceptance before you use the affected features.</p>

    <h2>20. Contact</h2>
    <p>For legal notices, privacy requests, or questions about these Terms, contact us through the <a href="/support">CollectTT support page</a>.</p>
  </LegalPage>;
}

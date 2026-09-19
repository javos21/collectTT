import type { Metadata } from 'next';
import { LegalPage } from '../legal-page';
import { PRIVACY_VERSION } from '@/lib/legal';

export const metadata: Metadata = { title: 'Privacy Policy — CollectTT' };

export default function PrivacyPolicyPage() {
  return <LegalPage eyebrow="Legal" title="Privacy Policy" updated={`Working draft · Version ${PRIVACY_VERSION} · Last updated September 19, 2026`}>
    <p><strong>This is a first working draft.</strong> It explains how CollectTT proposes to handle personal information for the launch product. It is not legal advice. Before publication, confirm the operator identity, privacy contact, service providers, retention periods, and the rights and notices required in every launch jurisdiction with local counsel.</p>

    <h2>1. Who is responsible for your information</h2>
    <p>CollectTT is operated by <strong>[INSERT LEGAL OPERATOR NAME]</strong>, of <strong>[INSERT REGISTERED BUSINESS ADDRESS]</strong> (“CollectTT”, “we”, “us”, or “our”). CollectTT is the organisation responsible for the marketplace information described here. For privacy questions or requests, contact <strong>[INSERT PRIVACY EMAIL]</strong>.</p>

    <h2>2. Information we collect</h2>
    <ul>
      <li><strong>Account information:</strong> account name, email address, password credentials, email-verification status, terms version accepted, and account timestamps.</li>
      <li><strong>Profile information:</strong> public display name, handle, optional bio, area, avatar, and private phone or delivery details.</li>
      <li><strong>Marketplace information:</strong> listings, images, descriptions, prices, offers, bids, reservations, auction results, delivery or meetup choices, and transaction milestones.</li>
      <li><strong>Safety and support information:</strong> reports, dispute descriptions, uploaded evidence, moderation actions, restriction history, and audit events.</li>
      <li><strong>Technical information:</strong> IP address, device and browser information, session identifiers, security events, notification delivery status, and basic diagnostics needed to protect the service.</li>
      <li><strong>Communications:</strong> messages or support requests you send and whether essential or optional notifications were delivered.</li>
    </ul>
    <p>Please do not include passwords, full payment-card numbers, government identification numbers, or unrelated sensitive information in listings, reports, or evidence.</p>

    <h2>3. How we use information</h2>
    <p>We use information to create and secure accounts; publish and search listings; process offers, bids, commitments, and deadlines; coordinate the contact details needed after a valid transaction; deliver essential notices; prevent fraud, abuse, and unsafe meetups; investigate reports; provide support; maintain audit and reputation records; improve reliability; and comply with legal obligations.</p>
    <p>We may use aggregated or de-identified information for service measurement and product improvement. We do not sell personal information.</p>

    <h2>4. Public and private information</h2>
    <p>Public display names, active listings, listing images, and factual Trust Snapshot activity may be visible to other members and visitors. Your email, phone number, private account name, reports, private evidence, and administrator notes are not public profile fields.</p>
    <p>After a reservation, accepted offer, or settled auction transaction, the members involved may see the contact details needed to coordinate the displayed hand-off. Support staff may access sensitive information only for a documented operational, safety, security, or legal reason.</p>

    <h2>5. When we share information</h2>
    <p>We share information with:</p>
    <ul>
      <li>the members involved in a valid commitment, limited to what is needed for that transaction;</li>
      <li>hosting, database, image-storage, email, monitoring, security, and other service providers that process information for CollectTT under instructions;</li>
      <li>professional advisers, insurers, law enforcement, regulators, or courts where reasonably necessary to protect people, enforce rules, investigate suspected unlawful activity, or comply with law; and</li>
      <li>a buyer, successor, or adviser in a merger, financing, restructuring, or sale of all or part of the service, subject to appropriate confidentiality protections.</li>
    </ul>
    <p>We do not disclose private phone or email details to another member before a valid commitment unless you choose to share them.</p>

    <h2>6. Service providers and international processing</h2>
    <p>The launch product uses a hosted Postgres/Supabase database and object storage, an application host, and an email delivery adapter. <strong>[INSERT THE FINAL PROVIDER NAMES, REGIONS, AND ANALYTICS/ERROR-MONITORING TOOLS BEFORE PUBLICATION.]</strong> Providers may process information outside Trinidad and Tobago. We will use reasonable contractual and technical safeguards appropriate to the information and applicable law.</p>

    <h2>7. Retention</h2>
    <p>We retain account and transaction records for as long as needed to provide the service, preserve the history of commitments, investigate disputes and abuse, enforce restrictions, maintain security, and meet legal or accounting obligations. We retain private evidence and delivery logs only for the approved operational period. <strong>[COUNSEL AND OPERATIONS TO SET SPECIFIC RETENTION PERIODS AND A DELETION SCHEDULE.]</strong></p>

    <h2>8. Security</h2>
    <p>We use access controls, authentication, rate limits, private storage boundaries, audit records, and other safeguards designed to reduce unauthorised access or disclosure. No internet service is risk-free. If you believe your account or information is compromised, change your password and contact support promptly.</p>

    <h2>9. Cookies and similar technology</h2>
    <p>CollectTT uses essential cookies or similar storage for sessions, security, and core functionality. <strong>[CONFIRM WHETHER ANALYTICS, ADVERTISING, OR OPTIONAL COOKIE TECHNOLOGY WILL BE ENABLED.]</strong> If optional analytics or marketing technology is added, we will describe it here and provide any required controls before using it.</p>

    <h2>10. Your choices and requests</h2>
    <p>You can update your profile and notification preferences in the product. You may contact <strong>[INSERT PRIVACY EMAIL]</strong> to ask for access to, correction of, or deletion of personal information, to object to a use, or to ask a question about a disclosure. We may need to verify your identity and may retain information that we must keep for security, disputes, fraud prevention, or legal obligations.</p>
    <p>Essential security, commitment, deadline, dispute, and restriction notices cannot be disabled while you use the relevant features. Where applicable law provides a right to complain to a regulator, we will identify the appropriate contact in the final version.</p>

    <h2>11. Minors</h2>
    <p>CollectTT is intended for adults. We do not knowingly invite a child to create a marketplace account or participate in a private meetup. If you believe a child has provided information or is at risk, contact support immediately; we may remove the information or restrict the account subject to safety and legal requirements.</p>

    <h2>12. Breach and safety notices</h2>
    <p>If we confirm an incident that requires notice, we will notify affected people and authorities as required by applicable law. Notices may be sent to the email address on the account or displayed in the service.</p>

    <h2>13. Changes to this Policy</h2>
    <p>We may update this Policy when the product, providers, or legal requirements change. We will publish the new version and date. If a change materially affects how we use information, we will provide a reasonable notice and any consent or choice required by law.</p>

    <h2>14. Contact</h2>
    <p>For privacy requests or questions, contact <strong>[INSERT PRIVACY EMAIL]</strong> and include “Privacy” in the subject line. Replace every bracketed placeholder and obtain local counsel review before public launch.</p>
  </LegalPage>;
}

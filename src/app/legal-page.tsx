import Link from 'next/link';

export function LegalPage({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="legal-page">
      <div className="legal-page__intro">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="legal-page__updated">{updated}</p>
      </div>
      <div className="legal-page__body">{children}</div>
      <p className="legal-page__notice">These v1 surfaces are published for product use and remain subject to final legal review. Questions? <Link href="/support">Contact CollectTT support</Link>.</p>
    </main>
  );
}

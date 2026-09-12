import Link from 'next/link';
import { ArrowRight, CircleCheck, Info } from 'lucide-react';

import { AdminFrame, type AdminNav } from './admin-frame';

interface AdminSectionPlaceholderProps {
  activeNav: Exclude<AdminNav, 'overview' | 'stores' | 'catalog' | 'settings'>;
  title: string;
  description: string;
  nextStep: string;
  plannedItems: string[];
  relatedHref?: string;
  relatedLabel?: string;
}

export function AdminSectionPlaceholder({
  activeNav,
  title,
  description,
  nextStep,
  plannedItems,
  relatedHref,
  relatedLabel,
}: AdminSectionPlaceholderProps) {
  return (
    <AdminFrame activeNav={activeNav}>
      <main className="admin-main" id="admin-main">
        <div className="admin-heading">
          <div>
            <p className="admin-kicker">Admin workspace</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <span className="admin-environment">Read-only foundation</span>
        </div>

        <section className="admin-panel admin-panel--placeholder" aria-labelledby="admin-section-next-step">
          <div className="admin-panel__heading">
            <div>
              <h2 id="admin-section-next-step">Next step</h2>
              <p>{nextStep}</p>
            </div>
            <Info size={19} aria-hidden="true" />
          </div>
          <div className="admin-placeholder__notice" role="status">
            <CircleCheck size={18} aria-hidden="true" />
            <span>This route is protected and its information architecture is ready for the first read-only data slice.</span>
          </div>
          <ul className="admin-checklist admin-placeholder__list">
            {plannedItems.map((item) => (
              <li key={item}>
                <span className="admin-checklist__indicator admin-checklist__indicator--blue" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          {relatedHref !== undefined && relatedLabel !== undefined && (
            <Link className="admin-button admin-button--secondary admin-placeholder__link" href={relatedHref}>
              {relatedLabel}
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          )}
        </section>
      </main>
    </AdminFrame>
  );
}

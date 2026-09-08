'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, CircleCheck, Clock3, MapPin, PackageCheck, ShoppingBag, Store } from 'lucide-react';
import { useEffect, useState } from 'react';

import { formatMoney } from '@/domain/money';
import type { ActiveDealSummary, ActiveDealRole, PhysicalDealTask } from '@/services/deals';

export type ActiveDealFilter = 'all' | ActiveDealRole;
export type PhysicalDealFilter = 'all' | Exclude<PhysicalDealTask, null>;

type ActiveDealsListProps = {
  deals: ActiveDealSummary[];
  initialFilter?: ActiveDealFilter;
  initialTask?: PhysicalDealFilter;
  mode?: 'all' | 'physical';
};

const roleFilters: Array<{ value: ActiveDealFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'buying', label: 'Buying' },
  { value: 'selling', label: 'Selling' },
];

const physicalFilters: Array<{ value: PhysicalDealFilter; label: string }> = [
  { value: 'all', label: 'All hand-offs' },
  { value: 'to_drop_off', label: 'To drop off' },
  { value: 'to_collect', label: 'To collect' },
  { value: 'at_store', label: 'At store / waiting' },
];

const taskLabels: Record<Exclude<PhysicalDealTask, null>, string> = {
  to_drop_off: 'To drop off',
  to_collect: 'To collect',
  at_store: 'At store / waiting',
};

function formatDeadline(value: string): string {
  return new Date(value).toLocaleString('en-TT', {
    timeZone: 'America/Port_of_Spain',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function roleLabel(role: ActiveDealRole): string {
  return role === 'buying' ? 'Buying' : 'Selling';
}

function physicalEmptyLabel(filter: PhysicalDealFilter): string {
  if (filter === 'to_drop_off') return 'Nothing needs a drop-off right now.';
  if (filter === 'to_collect') return 'Nothing is ready for collection right now.';
  if (filter === 'at_store') return 'No items are waiting at a store.';
  return 'No physical hand-offs are in progress.';
}

function dealMatchesPhysicalFilter(deal: ActiveDealSummary, filter: PhysicalDealFilter): boolean {
  return deal.physicalTask !== null && (filter === 'all' || deal.physicalTask === filter);
}

export function ActiveDealsList({
  deals,
  initialFilter = 'all',
  initialTask = 'all',
  mode = 'all',
}: ActiveDealsListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<ActiveDealFilter>(initialFilter);
  const [task, setTask] = useState<PhysicalDealFilter>(initialTask);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const queryString = searchParams.toString();

  useEffect(() => {
    const query = new URLSearchParams(queryString);
    if (mode === 'physical') {
      const nextTask = query.get('task');
      if (nextTask === 'to_drop_off' || nextTask === 'to_collect' || nextTask === 'at_store') setTask(nextTask);
      else setTask('all');
    } else {
      const nextFilter = query.get('filter');
      if (nextFilter === 'buying' || nextFilter === 'selling') setFilter(nextFilter);
      else setFilter('all');
    }
  }, [mode, queryString]);

  const updateUrl = (key: 'filter' | 'task', value: string, defaultValue: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.size > 0 ? `?${next.toString()}` : ''}`, { scroll: false });
  };

  const changeFilter = (next: ActiveDealFilter) => {
    setFilter(next);
    setExpandedId(null);
    setAnnouncement(`${next === 'all' ? 'All active deals' : `${next === 'buying' ? 'Buying' : 'Selling'} deals`} selected.`);
    updateUrl('filter', next, 'all');
  };

  const changeTask = (next: PhysicalDealFilter) => {
    setTask(next);
    setExpandedId(null);
    setAnnouncement(`${next === 'all' ? 'All hand-offs' : taskLabels[next]} selected.`);
    updateUrl('task', next, 'all');
  };

  const visibleDeals = mode === 'physical'
    ? deals.filter((deal) => dealMatchesPhysicalFilter(deal, task))
    : deals.filter((deal) => filter === 'all' || deal.role === filter);

  const filters = mode === 'physical' ? physicalFilters : roleFilters;
  const selectedFilter = mode === 'physical' ? task : filter;

  return (
    <div className={`active-deals${mode === 'physical' ? ' active-deals--physical' : ''}`}>
      <div className="active-deals__toolbar">
        <div className="active-deals__filters" role="group" aria-label={mode === 'physical' ? 'Filter hand-offs' : 'Filter active deals'}>
          {filters.map((item) => (
            <button
              className="active-deals__filter"
              key={item.value}
              type="button"
              aria-pressed={selectedFilter === item.value}
              onClick={() => mode === 'physical' ? changeTask(item.value as PhysicalDealFilter) : changeFilter(item.value as ActiveDealFilter)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="active-deals__result-count">
          {visibleDeals.length} {visibleDeals.length === 1 ? 'deal' : 'deals'}
        </span>
      </div>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>

      {visibleDeals.length === 0 ? (
        <div className="active-deals__empty">
          <CircleCheck aria-hidden="true" />
          <strong>{mode === 'physical' ? physicalEmptyLabel(task) : 'No active deals match this filter.'}</strong>
          <span>{mode === 'physical' ? 'Your other open deals are still available in In action.' : 'Accepted deals will appear here while payment or fulfilment is in progress.'}</span>
        </div>
      ) : (
        <ol className="active-deals__list" aria-label={mode === 'physical' ? 'Collect and drop-off hand-offs' : 'Active deals'}>
          {visibleDeals.map((deal) => {
            const isExpanded = expandedId === deal.id;
            const panelId = `active-deal-panel-${deal.id}`;
            return (
              <li className={`active-deals__item${isExpanded ? ' is-expanded' : ''}`} key={deal.id}>
                <article className="active-deal">
                  <div className="active-deal__summary">
                    <div className="active-deal__title-block">
                      <Link className="active-deal__title" href={`/deals/${deal.id}`}>{deal.title}</Link>
                      <span className={`active-deal__role active-deal__role--${deal.role}`}>
                        {deal.role === 'buying' ? <ShoppingBag aria-hidden="true" /> : <PackageCheck aria-hidden="true" />}
                        {roleLabel(deal.role)}
                      </span>
                      {mode === 'physical' && deal.physicalTask !== null && (
                        <span className="active-deal__task">{taskLabels[deal.physicalTask]}</span>
                      )}
                    </div>
                    <strong className="active-deal__amount num">{formatMoney(deal.amountCents)}</strong>
                    <div className="active-deal__state">
                      <span>{deal.currentState}</span>
                      <strong>{deal.nextStep}</strong>
                    </div>
                    <div className="active-deal__deadline">
                      <Clock3 aria-hidden="true" />
                      <span>Due</span>
                      <time dateTime={deal.deadlineAt}>{formatDeadline(deal.deadlineAt)}</time>
                    </div>
                    <button
                      className="active-deal__toggle"
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      onClick={() => {
                        setExpandedId(isExpanded ? null : deal.id);
                        setAnnouncement(`${deal.title} ${isExpanded ? 'collapsed' : 'expanded'}.`);
                      }}
                    >
                      <span className="sr-only">{isExpanded ? `Collapse ${deal.title}` : `Expand ${deal.title}`}</span>
                      <ChevronDown aria-hidden="true" />
                    </button>
                  </div>

                  <div className="active-deal__details" id={panelId} hidden={!isExpanded}>
                    <dl className="active-deal__facts">
                      <div><dt>Payment</dt><dd>{deal.paymentStatus}</dd></div>
                      <div><dt>Delivery</dt><dd>{deal.deliveryStatus}</dd></div>
                      <div><dt>Next step</dt><dd>{deal.nextStep}</dd></div>
                      <div><dt>Deadline</dt><dd><time dateTime={deal.deadlineAt}>{formatDeadline(deal.deadlineAt)}</time></dd></div>
                      {deal.location !== null && <div><dt>Location</dt><dd><MapPin aria-hidden="true" />{deal.location.name}{deal.location.area ? ` · ${deal.location.area}` : ''}</dd></div>}
                    </dl>
                    <div className="active-deal__detail-actions">
                      <Link className="button" href={`/deals/${deal.id}`}>View full deal</Link>
                      {mode === 'physical' && deal.canShowCode && (
                        <Link className="active-deal__code-link" href={`/deals/${deal.id}`}>
                          <Store aria-hidden="true" /> Show code on full deal
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

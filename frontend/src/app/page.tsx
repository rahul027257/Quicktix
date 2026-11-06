'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { EventCard } from '@/components/EventCard';
import { EmptyState, Notice, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CATEGORIES } from '@/lib/format';
import type { EventCardData } from '@/lib/types';

const BLANK = { q: '', category: '', city: '', from: '', to: '', minPrice: '', maxPrice: '', sort: 'date_asc' };
type Filters = typeof BLANK;
const PAGE_SIZE = 12;

function query(f: Filters, page: number) {
  const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort: f.sort });
  (['q', 'category', 'city', 'from', 'to', 'minPrice', 'maxPrice'] as const).forEach((k) => f[k] && p.set(k, f[k]));
  return p.toString();
}

export default function Home() {
  const [filters, setFilters] = useState<Filters>(BLANK);
  const [applied, setApplied] = useState<Filters>(BLANK);
  const [items, setItems] = useState<EventCardData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [cities, setCities] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const set = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  // Debounce typing; discrete controls apply on the same tick.
  useEffect(() => {
    const t = setTimeout(() => setApplied(filters), 300);
    return () => clearTimeout(t);
  }, [filters]);

  useEffect(() => {
    api<{ cities: string[] }>('/events/meta/cities').then((d) => setCities(d.cities)).catch(() => undefined);
  }, []);

  const ctl = useRef<AbortController | null>(null);
  useEffect(() => {
    ctl.current?.abort();
    const c = (ctl.current = new AbortController());
    setLoading(true);
    setError('');
    api<{ events: EventCardData[]; total: number }>(`/events?${query(applied, 1)}`, { signal: c.signal })
      .then((d) => { setItems(d.events); setTotal(d.total); setPage(1); setLoading(false); })
      .catch((e) => { if (e.name !== 'AbortError') { setError(errorMessage(e)); setLoading(false); } });
    return () => c.abort();
  }, [applied]);

  async function loadMore() {
    setMore(true);
    try {
      const d = await api<{ events: EventCardData[] }>(`/events?${query(applied, page + 1)}`);
      setItems((x) => [...x, ...d.events]);
      setPage((p) => p + 1);
    } catch (e) { setError(errorMessage(e)); }
    setMore(false);
  }

  const active = Object.entries(filters).filter(([k, v]) => v && k !== 'sort' && k !== 'category').length;

  return (
    <div className="space-y-8">
      <section className="pt-4 sm:pt-8">
        <h1 className="max-w-3xl text-balance text-4xl font-extrabold leading-[1.05] sm:text-6xl">Find your next night out.</h1>
        <p className="mt-4 max-w-xl text-lg text-ink-soft">Concerts, comedy, sports, workshops and more. Book in a minute and pay with any UPI app.</p>
        <div className="relative mt-6 max-w-2xl">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input
            className="input !rounded-2xl !py-4 !pl-12 text-base shadow-[0_12px_28px_-18px_rgba(61,47,217,.5)]"
            placeholder="Search by event or venue"
            aria-label="Search events by title or venue"
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
          />
        </div>
      </section>

      <div className="-mx-4 overflow-x-auto px-4" role="tablist" aria-label="Categories">
        <div className="flex w-max gap-2 pb-1">
          {[{ value: '', label: 'All events' }, ...CATEGORIES].map((c) => (
            <button
              key={c.value}
              role="tab"
              aria-selected={filters.category === c.value}
              onClick={() => set('category', c.value)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                filters.category === c.value ? 'bg-ink text-white' : 'bg-white text-ink-soft ring-1 ring-lilac hover:bg-brand-soft'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <section aria-label="Filters" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <button className="btn-ghost sm:hidden" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters{active ? ` (${active})` : ''}
          </button>
          <p className="hidden text-sm text-ink-soft sm:block" aria-live="polite">{loading ? 'Searching…' : `${total} event${total === 1 ? '' : 's'}`}</p>
          <label className="flex items-center gap-2 text-sm font-semibold">
            Sort
            <select className="input !w-auto !py-2" value={filters.sort} onChange={(e) => set('sort', e.target.value)}>
              <option value="date_asc">Date: soonest first</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </label>
        </div>
        <div className={`${showFilters ? 'grid' : 'hidden'} grid-cols-2 gap-3 sm:grid sm:grid-cols-3 lg:grid-cols-6`}>
          <label className="col-span-2 sm:col-span-1">
            <span className="label">City</span>
            <select className="input" value={filters.city} onChange={(e) => set('city', e.target.value)}>
              <option value="">Any city</option>
              {cities.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label><span className="label">From</span><input type="date" className="input" value={filters.from} onChange={(e) => set('from', e.target.value)} /></label>
          <label><span className="label">To</span><input type="date" className="input" value={filters.to} min={filters.from} onChange={(e) => set('to', e.target.value)} /></label>
          <label><span className="label">Min price (₹)</span><input type="number" min={0} inputMode="numeric" className="input" value={filters.minPrice} onChange={(e) => set('minPrice', e.target.value)} /></label>
          <label><span className="label">Max price (₹)</span><input type="number" min={0} inputMode="numeric" className="input" value={filters.maxPrice} onChange={(e) => set('maxPrice', e.target.value)} /></label>
          <div className="flex items-end">
            <button className="btn-ghost w-full" onClick={() => { setFilters({ ...BLANK, sort: filters.sort, category: filters.category }); }} disabled={!active}>
              <X className="h-4 w-4" aria-hidden /> Clear filters
            </button>
          </div>
        </div>
      </section>

      {error && <Notice>{error}</Notice>}
      {loading ? (
        <Spinner label="Finding events…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No events match those filters"
          action={<button className="btn-primary" onClick={() => setFilters(BLANK)}>Show all events</button>}
        >
          Try a different category, widen the dates or price range, or search for another venue.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
          {items.length < total && (
            <div className="text-center">
              <button className="btn-ghost" onClick={loadMore} disabled={more}>{more ? 'Loading…' : `Show more (${total - items.length} left)`}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

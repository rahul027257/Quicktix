import Link from 'next/link';
import { Calendar, MapPin } from 'lucide-react';
import { CATEGORY_BG, categoryLabel, fmtDay, fmtTime, rupees } from '@/lib/format';
import type { EventCardData } from '@/lib/types';

export function EventBanner({ category, url, className = '' }: { category: string; url: string | null; className?: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={`object-cover ${className}`} />
  ) : (
    <div className={`flex items-end p-4 ${className}`} style={{ background: CATEGORY_BG[category] ?? CATEGORY_BG.OTHERS }} aria-hidden>
      <span className="font-display text-2xl font-extrabold text-white/90">{categoryLabel(category)}</span>
    </div>
  );
}

export function EventCard({ event: e }: { event: EventCardData }) {
  const soldOut = e.status === 'SOLD_OUT' || e.available === 0;
  const low = !soldOut && e.available <= Math.max(5, Math.ceil(e.capacity * 0.1));
  return (
    <Link href={`/events/${e.id}`} className="ticket group block transition-transform hover:-translate-y-0.5">
      <div className="relative">
        <EventBanner category={e.category} url={e.bannerUrl} className="h-40 w-full" />
        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-ink">{categoryLabel(e.category)}</span>
      </div>
      <div className="space-y-2 px-5 pb-4 pt-4">
        <h3 className="line-clamp-2 text-lg font-bold leading-snug">{e.title}</h3>
        <p className="flex items-center gap-1.5 text-sm text-ink-soft"><Calendar className="h-4 w-4 shrink-0" aria-hidden />{fmtDay(e.startsAt)}, {fmtTime(e.startsAt)}</p>
        <p className="flex items-center gap-1.5 text-sm text-ink-soft"><MapPin className="h-4 w-4 shrink-0" aria-hidden /><span className="truncate">{e.venue}, {e.city}</span></p>
      </div>
      <div className="ticket-stub flex items-center justify-between">
        <span className="rounded-lg bg-sun px-2.5 py-1 font-display text-base font-extrabold text-ink">{rupees(e.pricePaise)}</span>
        <span className={`text-sm font-semibold ${soldOut ? 'text-bad' : low ? 'text-warn' : 'text-ink-soft'}`}>
          {soldOut ? 'Sold out' : low ? `Only ${e.available} left` : 'Tickets available'}
        </span>
      </div>
    </Link>
  );
}

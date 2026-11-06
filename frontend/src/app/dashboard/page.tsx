'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Calendar, Download, MapPin, Store } from 'lucide-react';
import { Guard, useAuth } from '@/components/AuthProvider';
import { EmptyState, Notice, Spinner, StatusBadge } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtDateTime, rupees } from '@/lib/format';
import type { BookingListItem } from '@/lib/types';

type Tab = 'upcoming' | 'pending' | 'past';
const TABS: { id: Tab; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming / Confirmed' },
  { id: 'pending', label: 'Pending Approval' },
  { id: 'past', label: 'Past / Cancelled' },
];

function tabOf(b: BookingListItem, now: number): Tab {
  const eventLive = b.event.status !== 'CANCELLED' && new Date(b.event.endsAt ?? b.event.startsAt).getTime() > now;
  if (b.status === 'CONFIRMED' && eventLive) return 'upcoming';
  if (b.status === 'PENDING_ORGANIZER_VERIFICATION' && b.event.status !== 'CANCELLED') return 'pending';
  if (b.status === 'AWAITING_PAYMENT' && new Date(b.holdExpiresAt).getTime() > now && eventLive) return 'pending';
  return 'past';
}

export default function Dashboard() {
  return <Guard><Content /></Guard>;
}

function Content() {
  const { user, organizerRequest } = useAuth();
  const [items, setItems] = useState<BookingListItem[] | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('upcoming');

  useEffect(() => { api<{ bookings: BookingListItem[] }>('/bookings/mine').then((d) => setItems(d.bookings)).catch((e) => setError(errorMessage(e))); }, []);

  const grouped = useMemo(() => {
    const now = Date.now();
    const g: Record<Tab, BookingListItem[]> = { upcoming: [], pending: [], past: [] };
    items?.forEach((b) => g[tabOf(b, now)].push(b));
    return g;
  }, [items]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold sm:text-4xl">My tickets</h1>

      {user?.role === 'customer' && (
        <div className="panel flex flex-wrap items-center justify-between gap-4 !bg-brand-soft">
          <div className="flex items-start gap-3">
            <Store className="mt-0.5 h-6 w-6 text-brand" aria-hidden />
            <div>
              <p className="font-bold">Host your own events</p>
              <p className="text-sm text-ink-soft">
                {organizerRequest?.status === 'PENDING' ? 'Your organizer request is waiting for admin review.'
                  : organizerRequest?.status === 'REJECTED' ? `Your last request wasn’t approved${organizerRequest.rejectionReason ? `: ${organizerRequest.rejectionReason}` : '.'}`
                  : 'Request organizer access to sell tickets and verify UPI payments yourself.'}
              </p>
            </div>
          </div>
          {organizerRequest?.status !== 'PENDING' && <Link href="/become-organizer" className="btn-primary">{organizerRequest ? 'Apply again' : 'Become an organizer'}</Link>}
        </div>
      )}

      <div role="tablist" aria-label="Booking status" className="flex gap-1 overflow-x-auto border-b border-lilac">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${tab === t.id ? 'border-brand text-brand' : 'border-transparent text-ink-soft hover:text-ink'}`}>
            {t.label}{grouped[t.id].length ? <span className="ml-2 rounded-full bg-lilac/70 px-2 py-0.5 text-xs">{grouped[t.id].length}</span> : null}
          </button>
        ))}
      </div>

      {error && <Notice>{error}</Notice>}
      {!items ? <Spinner /> : grouped[tab].length === 0 ? (
        <EmptyState title={tab === 'upcoming' ? 'No upcoming tickets yet' : tab === 'pending' ? 'Nothing waiting for approval' : 'No past or cancelled bookings'}
          action={tab === 'upcoming' ? <Link href="/" className="btn-primary">Browse events</Link> : undefined}>
          {tab === 'upcoming' ? 'Confirmed bookings show up here, with a PDF ticket you can download.' : tab === 'pending' ? 'Once you submit a payment reference, the booking waits here until the organizer confirms it.' : 'Finished, rejected, expired and cancelled bookings are kept here.'}
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {grouped[tab].map((b) => (
            <li key={b.id} className="panel flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/events/${b.event.id}`} className="text-lg font-bold hover:text-brand">{b.event.title}</Link>
                  <StatusBadge status={b.status === 'AWAITING_PAYMENT' && tab === 'past' ? 'EXPIRED' : b.status} />
                  {b.event.status === 'CANCELLED' && <StatusBadge status="CANCELLED" />}
                </div>
                <p className="flex items-center gap-1.5 text-sm text-ink-soft"><Calendar className="h-4 w-4" aria-hidden />{fmtDateTime(b.event.startsAt)}</p>
                <p className="flex items-center gap-1.5 text-sm text-ink-soft"><MapPin className="h-4 w-4" aria-hidden />{b.event.venue}, {b.event.city}</p>
                <p className="text-sm text-ink-soft">Ref {b.reference}: {b.quantity} ticket{b.quantity > 1 ? 's' : ''}, {rupees(b.totalPaise)}</p>
                {b.status === 'REJECTED' && b.rejectionReason && <p className="text-sm text-bad">Reason: {b.rejectionReason}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {b.status === 'CONFIRMED' && b.event.status !== 'CANCELLED' && (
                  <>
                    <a href={`/api/bookings/${b.id}/pdf`} download className="btn-primary"><Download className="h-4 w-4" aria-hidden />Download PDF Ticket</a>
                    <Link href={`/bookings/${b.id}`} className="btn-ghost">View QR codes</Link>
                  </>
                )}
                {tab === 'pending' && b.status === 'AWAITING_PAYMENT' && <Link href={`/checkout/${b.id}`} className="btn-primary">Continue to payment</Link>}
                {tab === 'pending' && b.status === 'PENDING_ORGANIZER_VERIFICATION' && <Link href={`/checkout/${b.id}`} className="btn-ghost">View status</Link>}
                {tab === 'past' && b.status === 'CONFIRMED' && <Link href={`/bookings/${b.id}`} className="btn-ghost">Details</Link>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

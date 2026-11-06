'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Calendar, ClipboardCheck, MapPin, Minus, Pencil, Plus, Users } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { EventBanner } from '@/components/EventCard';
import { Notice, Spinner, StatusBadge } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { categoryLabel, fmtDateTime, rupees } from '@/lib/format';
import type { BookingView, EventCardData } from '@/lib/types';

interface Detail { event: EventCardData & { description: string }; viewer: { canManage: boolean; isCreator: boolean } }
const MAX_PER_BOOKING = 10;

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<Detail>(`/events/${id}`).then(setData).catch((e) => (e instanceof ApiError && e.status === 404 ? setMissing(true) : setError(errorMessage(e))));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, user?.id]);

  if (missing) return <Notice>This event doesn’t exist or is no longer available. <Link href="/" className="font-semibold underline">Browse events</Link></Notice>;
  if (!data) return error ? <Notice>{error}</Notice> : <Spinner />;
  const { event: e, viewer } = data;

  const bookable = e.status === 'PUBLISHED' && e.available > 0;
  const maxQty = Math.min(MAX_PER_BOOKING, e.available);

  async function book() {
    if (!user) return router.push(`/login?next=${encodeURIComponent(`/events/${id}`)}`);
    setBusy(true); setError('');
    try {
      const { booking } = await api<{ booking: BookingView }>('/bookings/reserve', { json: { eventId: id, quantity: qty } });
      router.push(`/checkout/${booking.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ACTIVE_HOLD' && err.details?.bookingId) return router.push(`/checkout/${err.details.bookingId}`);
      setError(errorMessage(err));
      setBusy(false);
      void load(); // inventory may have changed under us
    }
  }

  async function cancelEvent() {
    if (!window.confirm('Cancel this event? Tickets on hold are released immediately. Customers who already paid will need refunds from you directly.')) return;
    setBusy(true);
    try { await api(`/events/${id}/cancel`, { method: 'POST' }); await load(); } catch (err) { setError(errorMessage(err)); }
    setBusy(false);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <div className="overflow-hidden rounded-[20px]"><EventBanner category={e.category} url={e.bannerUrl} className="h-56 w-full sm:h-80" /></div>
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="badge bg-brand-soft text-brand">{categoryLabel(e.category)}</span>
            {e.status !== 'PUBLISHED' && <StatusBadge status={e.status} />}
          </div>
          <h1 className="text-3xl font-extrabold sm:text-5xl">{e.title}</h1>
          <p className="mt-1 text-ink-soft">Hosted by {e.organizer.name}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="panel flex items-start gap-3 !p-4"><Calendar className="mt-0.5 h-5 w-5 text-brand" aria-hidden /><div><p className="font-semibold">{fmtDateTime(e.startsAt)}</p>{e.endsAt && <p className="text-sm text-ink-soft">until {fmtDateTime(e.endsAt)}</p>}</div></div>
          <div className="panel flex items-start gap-3 !p-4"><MapPin className="mt-0.5 h-5 w-5 text-brand" aria-hidden /><div><p className="font-semibold">{e.venue}</p><p className="text-sm text-ink-soft">{e.city}</p></div></div>
        </div>
        <section><h2 className="mb-2 text-xl font-bold">About this event</h2><p className="max-w-prose whitespace-pre-line leading-relaxed text-ink-soft">{e.description}</p></section>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        {viewer.canManage ? (
          <div className="panel space-y-3">
            <h2 className="text-lg font-bold">Manage this event</h2>
            <p className="text-sm text-ink-soft">{e.capacity - e.available} of {e.capacity} tickets booked or on hold.</p>
            {error && <Notice>{error}</Notice>}
            <Link href={`/organizer/events/${e.id}/edit`} className="btn-primary w-full"><Pencil className="h-4 w-4" aria-hidden />Edit Event</Link>
            <Link href={`/organizer/events/${e.id}/attendees`} className="btn-ghost w-full"><Users className="h-4 w-4" aria-hidden />Manage Attendees</Link>
            <Link href="/organizer/approvals" className="btn-ghost w-full"><ClipboardCheck className="h-4 w-4" aria-hidden />Payment approvals</Link>
            {e.status !== 'CANCELLED' && e.status !== 'COMPLETED' && (
              <button className="btn-danger w-full" onClick={cancelEvent} disabled={busy}>Cancel Event</button>
            )}
          </div>
        ) : (
          <div className="ticket">
            <div className="space-y-4 p-5">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-3xl font-extrabold">{rupees(e.pricePaise)}</span>
                <span className="text-sm text-ink-soft">per ticket</span>
              </div>
              {error && <Notice>{error}</Notice>}
              {e.status === 'CANCELLED' ? <Notice>This event has been cancelled.</Notice>
                : e.status === 'COMPLETED' ? <Notice tone="info">This event has ended.</Notice>
                : e.status === 'SOLD_OUT' || e.available === 0 ? <Notice tone="info">Sold out. Check back soon, as unpaid holds are released every few minutes.</Notice>
                : e.status !== 'PUBLISHED' ? <Notice tone="info">Bookings are not open yet.</Notice>
                : (
                  <div className="flex items-center justify-between">
                    <span className="font-semibold" id="qty-label">Tickets</span>
                    <div className="flex items-center gap-3" role="group" aria-labelledby="qty-label">
                      <button className="grid h-10 w-10 place-items-center rounded-full border border-lilac hover:bg-brand-soft disabled:opacity-40" aria-label="Fewer tickets" disabled={qty <= 1} onClick={() => setQty(qty - 1)}><Minus className="h-4 w-4" /></button>
                      <output className="w-6 text-center text-lg font-bold" aria-live="polite">{Math.min(qty, maxQty)}</output>
                      <button className="grid h-10 w-10 place-items-center rounded-full border border-lilac hover:bg-brand-soft disabled:opacity-40" aria-label="More tickets" disabled={qty >= maxQty} onClick={() => setQty(qty + 1)}><Plus className="h-4 w-4" /></button>
                    </div>
                  </div>
                )}
            </div>
            {bookable && (
              <div className="ticket-stub space-y-3">
                <div className="flex items-center justify-between"><span className="text-ink-soft">Total</span><span className="font-display text-xl font-extrabold">{rupees(e.pricePaise * Math.min(qty, maxQty))}</span></div>
                <button className="btn-primary w-full !py-3 text-base" onClick={book} disabled={busy}>{busy ? 'Reserving…' : 'Book Ticket'}</button>
                <p className="text-center text-xs text-ink-soft">Your tickets are held for 10 minutes while you pay{e.available <= 10 ? `, and only ${e.available} are left` : ''}.</p>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

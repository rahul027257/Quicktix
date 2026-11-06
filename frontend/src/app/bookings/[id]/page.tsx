'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Calendar, Download, MapPin } from 'lucide-react';
import { Guard } from '@/components/AuthProvider';
import { Notice, QrImage, Spinner, StatusBadge } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtDateTime, fmtShort, rupees } from '@/lib/format';
import type { BookingView } from '@/lib/types';

export default function BookingPage() {
  return <Guard><Booking /></Guard>;
}

function Booking() {
  const { id } = useParams<{ id: string }>();
  const [b, setB] = useState<BookingView | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api<{ booking: BookingView }>(`/bookings/${id}`).then((d) => setB(d.booking)).catch((e) => setError(errorMessage(e))), [id]);
  useEffect(() => { void load(); }, [load]);

  if (!b) return error ? <Notice>{error}</Notice> : <Spinner />;
  const cancelled = b.event.status === 'CANCELLED';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/events/${b.event.id}`} className="text-3xl font-extrabold hover:text-brand">{b.event.title}</Link>
          <p className="mt-2 flex items-center gap-2 text-ink-soft"><Calendar className="h-4 w-4" aria-hidden />{fmtDateTime(b.event.startsAt)}</p>
          <p className="mt-1 flex items-center gap-2 text-ink-soft"><MapPin className="h-4 w-4" aria-hidden />{b.event.venue}, {b.event.city}</p>
        </div>
        <div className="text-right"><StatusBadge status={b.status} /><p className="mt-2 text-sm text-ink-soft">Ref {b.reference}</p><p className="font-display text-xl font-extrabold">{rupees(b.totalPaise)}</p></div>
      </div>

      {cancelled && <Notice>This event was cancelled by the organizer. Contact them directly about a refund; your tickets are no longer valid for entry.</Notice>}

      {b.status === 'CONFIRMED' && !cancelled && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink-soft">Show each QR code at the entrance. One code admits one person, once.</p>
            <a href={`/api/bookings/${b.id}/pdf`} className="btn-primary" download><Download className="h-4 w-4" aria-hidden />Download PDF Ticket</a>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {b.tickets.map((t) => (
              <div key={t.id} className="ticket">
                <div className="flex flex-col items-center gap-3 px-5 pb-5 pt-6">
                  <p className="font-display text-lg font-extrabold">Ticket {t.ticketNumber} of {b.quantity}</p>
                  {t.code && <div className={t.used ? 'opacity-30' : ''}><QrImage value={`quicktix:${t.code}`} size={180} label={`Entry QR code for ticket ${t.ticketNumber}`} /></div>}
                </div>
                <div className="ticket-stub text-center text-sm font-semibold">
                  {t.used ? <span className="text-ink-soft">Used {t.checkedInAt ? `on ${fmtShort(t.checkedInAt)}` : ''}</span> : <span className="text-ok">Valid for entry</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {b.status === 'PENDING_ORGANIZER_VERIFICATION' && <Notice tone="info">The organizer is verifying your payment (UTR {b.utr}). Your tickets will appear here once confirmed.</Notice>}
      {b.status === 'AWAITING_PAYMENT' && <Link href={`/checkout/${b.id}`} className="btn-primary">Continue to payment</Link>}
      {b.status === 'REJECTED' && <Notice>Payment couldn’t be verified{b.rejectionReason ? `: ${b.rejectionReason}` : '.'} If you did pay, contact the organizer with UTR {b.utr}.</Notice>}
    </div>
  );
}

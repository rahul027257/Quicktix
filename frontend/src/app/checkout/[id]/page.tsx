'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Calendar, Clock, ImagePlus, ShieldCheck, Smartphone } from 'lucide-react';
import { Guard } from '@/components/AuthProvider';
import { Countdown, CopyButton, Notice, Spinner, StatusBadge } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { fmtDateTime, rupees } from '@/lib/format';
import type { BookingView } from '@/lib/types';

export default function CheckoutPage() {
  return <Guard><Checkout /></Guard>;
}

function Checkout() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [b, setBooking] = useState<BookingView | null>(null);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [expired, setExpired] = useState(false);
  const [utr, setUtr] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const statusRef = useRef('');          // latest known booking status (read by the release logic)
  const upiLaunched = useRef(false);     // the customer jumped to a UPI app: keep the hold alive
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const apply = useCallback((v: BookingView) => {
    statusRef.current = v.status;
    setBooking(v);
    setExpired(v.status === 'AWAITING_PAYMENT' && new Date(v.hold.expiresAt) <= new Date(v.serverNow));
  }, []);

  const load = useCallback(async () => {
    try {
      const { booking } = await api<{ booking: BookingView }>(`/bookings/${id}`);
      if (booking.status === 'CONFIRMED') return router.replace(`/bookings/${id}`);
      apply(booking);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true); else setError(errorMessage(e));
    }
  }, [id, router, apply]);
  useEffect(() => { void load(); }, [load]);

  // While the organizer reviews, check in periodically so the page flips to "confirmed" on its own.
  useEffect(() => {
    if (b?.status !== 'PENDING_ORGANIZER_VERIFICATION') return;
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [b?.status, load]);

  // Leaving checkout releases the hold straight away (explicit cancel, in-app navigation, tab close).
  const holdActive = b?.status === 'AWAITING_PAYMENT' && !expired;
  useEffect(() => {
    if (!holdActive) return;
    clearTimeout(releaseTimer.current); // React StrictMode re-mounts the effect; don't release on the fake unmount
    const onPageHide = () => {
      if (upiLaunched.current || statusRef.current !== 'AWAITING_PAYMENT') return;
      navigator.sendBeacon(`/api/bookings/${id}/cancel`, new Blob(['{}'], { type: 'application/json' }));
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      releaseTimer.current = setTimeout(() => {
        if (upiLaunched.current || statusRef.current !== 'AWAITING_PAYMENT') return;
        void fetch(`/api/bookings/${id}/cancel`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: '{}' });
      }, 80);
    };
  }, [holdActive, id]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pickFile(f: File | undefined) {
    setError('');
    if (!f) return setFile(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) return setError('Choose a JPEG, PNG or WebP screenshot.');
    if (f.size > 5 * 1024 * 1024) return setError('The screenshot must be 5 MB or smaller.');
    setFile(f);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{12}$/.test(utr)) return setError('The UTR / UPI reference number is exactly 12 digits.');
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.set('utr', utr);
      if (file) form.set('screenshot', file);
      const { booking } = await api<{ booking: BookingView }>(`/bookings/${id}/submit-proof`, { form });
      apply(booking);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'HOLD_EXPIRED') { statusRef.current = 'EXPIRED'; setExpired(true); }
      else setError(errorMessage(err));
    }
    setBusy(false);
  }

  async function cancel() {
    if (!b) return;
    setBusy(true);
    try { await api(`/bookings/${id}/cancel`, { method: 'POST' }); statusRef.current = 'CANCELLED'; router.push(`/events/${b.event.id}`); }
    catch (err) { setError(errorMessage(err)); setBusy(false); }
  }

  if (notFound) return <Notice>We couldn’t find that booking. <Link href="/dashboard" className="font-semibold underline">Go to My tickets</Link></Notice>;
  if (!b) return error ? <Notice>{error}</Notice> : <Spinner />;

  const ev = b.event;
  const summary = (
    <div className="panel space-y-3">
      <div className="flex items-start justify-between gap-3"><h2 className="text-lg font-bold">{ev.title}</h2><StatusBadge status={expired ? 'EXPIRED' : b.status} /></div>
      <p className="flex items-center gap-2 text-sm text-ink-soft"><Calendar className="h-4 w-4" aria-hidden />{fmtDateTime(ev.startsAt)}</p>
      <dl className="space-y-1.5 border-t border-dashed border-lilac pt-3 text-sm">
        <div className="flex justify-between"><dt className="text-ink-soft">Booking reference</dt><dd className="font-semibold">{b.reference}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-soft">{b.quantity} × {rupees(b.unitPricePaise)}</dt><dd className="font-display text-xl font-extrabold">{rupees(b.totalPaise)}</dd></div>
      </dl>
    </div>
  );

  if (expired || ['EXPIRED', 'CANCELLED', 'REJECTED'].includes(b.status)) {
    const rejected = b.status === 'REJECTED';
    return (
      <div className="mx-auto max-w-xl space-y-4">
        {summary}
        <Notice tone={rejected ? 'error' : 'info'}>
          {rejected ? `The organizer couldn’t verify this payment${b.rejectionReason ? `: ${b.rejectionReason}` : '.'} Your tickets were released. If you did pay, contact the organizer with your UTR.`
            : b.status === 'CANCELLED' ? 'This booking was cancelled and the tickets were released.'
            : 'Your 10-minute hold ended and the tickets went back on sale.'}
        </Notice>
        <Link href={`/events/${ev.id}`} className="btn-primary">Book again</Link>
      </div>
    );
  }

  if (b.status === 'PENDING_ORGANIZER_VERIFICATION') {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        {summary}
        <div className="panel space-y-2 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-brand" aria-hidden />
          <h1 className="text-2xl font-extrabold">Payment submitted</h1>
          <p className="text-ink-soft">The organizer is checking UTR <span className="font-semibold text-ink">{b.utr}</span>. Your tickets stay reserved while they review, and you’ll see them here and in My tickets once confirmed.</p>
          <Link href="/dashboard" className="btn-ghost mt-2">Go to My tickets</Link>
        </div>
      </div>
    );
  }

  const pay = b.payment!;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <section className="panel space-y-5">
          <h1 className="text-2xl font-extrabold">Pay {rupees(pay.amountPaise)} with UPI</h1>
          <ol className="space-y-6">
            <li className="space-y-3">
              <h2 className="font-bold"><span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-brand text-xs text-white">1</span>Send the payment</h2>
              <div className="flex flex-col items-center gap-5 rounded-2xl bg-paper p-5 sm:flex-row sm:items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pay.upiQrUrl} alt={`UPI QR code for ${pay.upiId}`} width={200} height={200} className="h-[200px] w-[200px] rounded-xl bg-white object-contain p-2 ring-1 ring-lilac" />
                <div className="w-full space-y-3 text-sm">
                  <div><p className="text-ink-soft">UPI ID</p><p className="flex items-center gap-2 text-base font-bold break-all">{pay.upiId} <CopyButton value={pay.upiId} /></p></div>
                  <div><p className="text-ink-soft">Amount to pay</p><p className="flex items-center gap-2 text-base font-bold">{rupees(pay.amountPaise)} <CopyButton value={(pay.amountPaise / 100).toFixed(2)} label="Copy amount" /></p></div>
                  <a href={pay.upiLink} onClick={() => { upiLaunched.current = true; }} className="btn-primary w-full sm:hidden"><Smartphone className="h-4 w-4" aria-hidden />Pay with a UPI app</a>
                  <p className="text-ink-soft">On a computer, scan the QR code with GPay, PhonePe, Paytm or any UPI app. On a phone, tap “Pay with a UPI app” and come back to this page afterwards.</p>
                </div>
              </div>
            </li>
            <li>
              <form onSubmit={submit} className="space-y-4">
                <h2 className="font-bold"><span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-brand text-xs text-white">2</span>Tell us it’s done</h2>
                {error && <Notice>{error}</Notice>}
                <div>
                  <label className="label" htmlFor="utr">UTR / UPI reference number</label>
                  <input id="utr" className="input font-mono tracking-widest" inputMode="numeric" autoComplete="off" placeholder="12 digits" value={utr} onChange={(e) => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))} required aria-describedby="utr-hint" />
                  <p id="utr-hint" className="hint">Open the payment in your UPI app and look for “UTR”, “UPI Ref No.” or “Transaction ID”. {utr.length}/12</p>
                </div>
                <div>
                  <span className="label">Payment screenshot <span className="font-normal text-ink-soft">(recommended)</span></span>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-lilac p-3 hover:bg-brand-soft">
                    {preview ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={preview} alt="Selected screenshot" className="h-16 w-16 rounded-lg object-cover" /> : <ImagePlus className="h-6 w-6 text-brand" aria-hidden />}
                    <span className="text-sm font-semibold">{file ? file.name : 'Choose an image'}</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
                  </label>
                </div>
                <button className="btn-primary w-full !py-3" disabled={busy || utr.length !== 12}>{busy ? 'Submitting…' : 'Submit payment proof'}</button>
              </form>
            </li>
          </ol>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="panel flex items-center justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft"><Clock className="h-4 w-4" aria-hidden />Your tickets are held for</p>
            <Countdown expiresAt={b.hold.expiresAt} serverNow={b.serverNow} onExpire={() => { statusRef.current = 'EXPIRED'; setExpired(true); }} />
          </div>
        </div>
        {summary}
        <button className="btn-danger w-full" onClick={cancel} disabled={busy}>Cancel and release tickets</button>
        <p className="text-center text-xs text-ink-soft">Leaving this page also releases your tickets, unless you’ve opened a UPI app.</p>
      </aside>
    </div>
  );
}

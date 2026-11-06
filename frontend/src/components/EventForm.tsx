'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus, QrCode } from 'lucide-react';
import { Notice } from './ui';
import { api, errorMessage } from '@/lib/api';
import { CATEGORIES, fromIstInput, toIstInput } from '@/lib/format';

export interface ManagedEvent {
  id: string; title: string; description: string; category: string; venue: string; city: string;
  startsAt: string; endsAt: string | null; pricePaise: number; capacity: number; available: number; status: string;
  bannerUrl: string | null; upiId: string | null; upiQrUrl: string | null;
}

function ImagePicker({ label, hint, current, file, onFile, icon }: {
  label: string; hint: string; current: string | null; file: File | null; onFile: (f: File | null) => void; icon: 'image' | 'qr';
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const shown = preview ?? current;
  const Icon = icon === 'qr' ? QrCode : ImagePlus;
  return (
    <div>
      <span className="label">{label}</span>
      <label className="flex cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed border-lilac p-3 hover:bg-brand-soft">
        {shown ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={shown} alt="" className="h-20 w-20 rounded-lg bg-white object-contain ring-1 ring-lilac" /> : <span className="grid h-20 w-20 place-items-center rounded-lg bg-brand-soft text-brand"><Icon className="h-7 w-7" aria-hidden /></span>}
        <span className="text-sm"><span className="block font-semibold">{file ? file.name : shown ? 'Replace image' : 'Choose an image'}</span><span className="text-ink-soft">{hint}</span></span>
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f && f.size > 5 * 1024 * 1024) { alert('Images must be 5 MB or smaller.'); return; } onFile(f); }} />
      </label>
    </div>
  );
}

export function EventForm({ initial }: { initial?: ManagedEvent }) {
  const router = useRouter();
  const [f, setF] = useState({
    title: initial?.title ?? '', description: initial?.description ?? '', category: initial?.category ?? 'CONCERTS',
    venue: initial?.venue ?? '', city: initial?.city ?? '',
    startsAt: initial ? toIstInput(initial.startsAt) : '', endsAt: initial?.endsAt ? toIstInput(initial.endsAt) : '',
    price: initial ? String(initial.pricePaise / 100) : '', capacity: initial ? String(initial.capacity) : '',
    upiId: initial?.upiId ?? '', status: initial && initial.status === 'DRAFT' ? 'DRAFT' : initial ? 'PUBLISHED' : 'DRAFT',
  });
  const [banner, setBanner] = useState<File | null>(null);
  const [upiQr, setUpiQr] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (f.status === 'PUBLISHED' && (!f.upiId || (!upiQr && !initial?.upiQrUrl))) return setError('Add the UPI ID and UPI QR code for this event before publishing.');
    setBusy(true);
    try {
      const form = new FormData();
      Object.entries({ ...f, startsAt: fromIstInput(f.startsAt), endsAt: f.endsAt ? fromIstInput(f.endsAt) : '' }).forEach(([k, v]) => form.set(k, v));
      if (banner) form.set('banner', banner);
      if (upiQr) form.set('upiQr', upiQr);
      const res = await api<{ event: { id: string } }>(initial ? `/events/${initial.id}` : '/events', { form, method: initial ? 'PUT' : 'POST' });
      router.push(f.status === 'PUBLISHED' ? `/events/${res.event.id}` : '/organizer');
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-8">
      <h1 className="text-3xl font-extrabold sm:text-4xl">{initial ? 'Edit event' : 'Create an event'}</h1>
      {error && <Notice>{error}</Notice>}

      <section className="panel space-y-4">
        <h2 className="text-xl font-bold">Event details</h2>
        <div><label className="label" htmlFor="title">Title</label><input id="title" className="input" required minLength={3} maxLength={150} value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="cat">Category</label><select id="cat" className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
          <div><label className="label" htmlFor="city">City</label><input id="city" className="input" required value={f.city} onChange={(e) => set('city', e.target.value)} /></div>
        </div>
        <div><label className="label" htmlFor="venue">Venue</label><input id="venue" className="input" required value={f.venue} onChange={(e) => set('venue', e.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="starts">Starts (India time)</label><input id="starts" type="datetime-local" className="input" required value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></div>
          <div><label className="label" htmlFor="ends">Ends <span className="font-normal text-ink-soft">(optional)</span></label><input id="ends" type="datetime-local" className="input" min={f.startsAt} value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></div>
        </div>
        <div><label className="label" htmlFor="desc">Description</label><textarea id="desc" className="input min-h-32" required minLength={10} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
        <ImagePicker label="Banner image (optional)" hint="JPEG, PNG or WebP, up to 5 MB" current={initial?.bannerUrl ?? null} file={banner} onFile={setBanner} icon="image" />
      </section>

      <section className="panel space-y-4">
        <h2 className="text-xl font-bold">Tickets</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="price">Price per ticket (₹)</label><input id="price" type="number" min={1} step="0.01" inputMode="decimal" className="input" required value={f.price} onChange={(e) => set('price', e.target.value)} /></div>
          <div>
            <label className="label" htmlFor="cap">Total capacity</label>
            <input id="cap" type="number" min={1} step={1} className="input" required value={f.capacity} onChange={(e) => set('capacity', e.target.value)} />
            {initial && <p className="hint">{initial.capacity - initial.available} already booked or on hold.</p>}
          </div>
        </div>
      </section>

      <section className="panel space-y-4">
        <div><h2 className="text-xl font-bold">UPI payment for this event</h2><p className="mt-1 text-sm text-ink-soft">Customers pay this account directly. Every event can use a different UPI ID and QR code.</p></div>
        <div><label className="label" htmlFor="upi">UPI ID</label><input id="upi" className="input" placeholder="name@bank" autoCapitalize="none" value={f.upiId} onChange={(e) => set('upiId', e.target.value.trim())} /></div>
        <ImagePicker label="UPI payment QR code" hint="A clear screenshot or export of this account’s UPI QR" current={initial?.upiQrUrl ?? null} file={upiQr} onFile={setUpiQr} icon="qr" />
      </section>

      <section className="panel space-y-3">
        <h2 className="text-xl font-bold">Visibility</h2>
        {[['DRAFT', 'Save as draft', 'Only you and admins can see it.'], ['PUBLISHED', 'Publish', 'Listed on the homepage and open for booking.']].map(([v, t, d]) => (
          <label key={v} className="flex cursor-pointer items-start gap-3 rounded-xl border border-lilac p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
            <input type="radio" name="status" className="mt-1" checked={f.status === v} onChange={() => set('status', v)} />
            <span><span className="block font-semibold">{t}</span><span className="text-sm text-ink-soft">{d}</span></span>
          </label>
        ))}
      </section>

      <div className="flex gap-3">
        <button className="btn-primary !px-6 !py-3" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : f.status === 'PUBLISHED' ? 'Publish event' : 'Save draft'}</button>
        <button type="button" className="btn-ghost !py-3" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Calendar, ClipboardCheck, Pencil, Plus, ScanLine, Users } from 'lucide-react';
import { Guard } from '@/components/AuthProvider';
import { EmptyState, Notice, Spinner, StatusBadge } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtDateTime, rupees } from '@/lib/format';

interface Row {
  id: string; title: string; status: string; city: string; venue: string; startsAt: string; pricePaise: number;
  capacity: number; available: number; sold: number; revenuePaise: number; pendingApprovals: number;
}

export default function OrganizerHome() {
  return <Guard roles={['organizer', 'admin']}><Content /></Guard>;
}

function Content() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const load = useCallback(() => api<{ events: Row[] }>('/organizer/events').then((d) => setRows(d.events)).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { void load(); }, [load]);

  async function toggle(r: Row) {
    setBusyId(r.id); setError('');
    try { await api(`/events/${r.id}/status`, { json: { status: r.status === 'DRAFT' ? 'PUBLISHED' : 'DRAFT' } }); await load(); }
    catch (e) { setError(errorMessage(e)); }
    setBusyId('');
  }

  const pending = rows?.reduce((s, r) => s + r.pendingApprovals, 0) ?? 0;
  const sold = rows?.reduce((s, r) => s + r.sold, 0) ?? 0;
  const revenue = rows?.reduce((s, r) => s + r.revenuePaise, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold sm:text-4xl">Your events</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/organizer/approvals" className="btn-secondary"><ClipboardCheck className="h-4 w-4" aria-hidden />Payment Approvals{pending ? <span className="rounded-full bg-brand px-2 py-0.5 text-xs text-white">{pending}</span> : null}</Link>
          <Link href="/organizer/check-in" className="btn-ghost"><ScanLine className="h-4 w-4" aria-hidden />Check-in</Link>
          <Link href="/organizer/events/new" className="btn-primary"><Plus className="h-4 w-4" aria-hidden />Create event</Link>
        </div>
      </div>

      {rows && rows.length > 0 && (
        <dl className="grid grid-cols-3 gap-3 text-center sm:max-w-xl">
          {[['Tickets sold', String(sold)], ['Confirmed revenue', rupees(revenue)], ['Awaiting approval', String(pending)]].map(([k, v]) => (
            <div key={k} className="panel !p-4"><dd className="font-display text-2xl font-extrabold">{v}</dd><dt className="text-xs text-ink-soft">{k}</dt></div>
          ))}
        </dl>
      )}

      {error && <Notice>{error}</Notice>}
      {!rows ? <Spinner /> : rows.length === 0 ? (
        <EmptyState title="Create your first event" action={<Link href="/organizer/events/new" className="btn-primary">Create event</Link>}>
          Add the details, set a price and attach your UPI ID and QR code. Customers pay you directly and you confirm each payment.
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => {
            const pct = Math.round(((r.capacity - r.available) / r.capacity) * 100);
            return (
              <li key={r.id} className="panel space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><Link href={`/events/${r.id}`} className="text-lg font-bold hover:text-brand">{r.title}</Link><StatusBadge status={r.status} />{r.pendingApprovals > 0 && <span className="badge bg-warn-soft text-warn">{r.pendingApprovals} to verify</span>}</div>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft"><Calendar className="h-4 w-4" aria-hidden />{fmtDateTime(r.startsAt)}, {r.venue}, {r.city}</p>
                  </div>
                  <div className="text-right text-sm"><p className="font-semibold">{rupees(r.pricePaise)} per ticket</p><p className="text-ink-soft">{rupees(r.revenuePaise)} confirmed</p></div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-ink-soft"><span>{r.sold} sold, {r.capacity - r.available - r.sold} held or pending</span><span>{r.available} of {r.capacity} left</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-lilac/60" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Capacity used"><div className="h-full bg-brand" style={{ width: `${pct}%` }} /></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.status !== 'CANCELLED' && r.status !== 'COMPLETED' && <Link href={`/organizer/events/${r.id}/edit`} className="btn-ghost !py-2"><Pencil className="h-4 w-4" aria-hidden />Edit</Link>}
                  <Link href={`/organizer/events/${r.id}/attendees`} className="btn-ghost !py-2"><Users className="h-4 w-4" aria-hidden />Attendees</Link>
                  {(r.status === 'DRAFT' || r.status === 'PUBLISHED' || r.status === 'SOLD_OUT') && (
                    <button className="btn-ghost !py-2" disabled={busyId === r.id} onClick={() => toggle(r)}>{r.status === 'DRAFT' ? 'Publish' : 'Unpublish'}</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

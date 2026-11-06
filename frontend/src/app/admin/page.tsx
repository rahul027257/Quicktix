'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { Guard } from '@/components/AuthProvider';
import { EmptyState, Notice, Spinner, StatusBadge } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtDateTime, fmtShort, rupees } from '@/lib/format';

type Tab = 'overview' | 'organizers' | 'events' | 'bookings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'organizers', label: 'Organizer requests' },
  { id: 'events', label: 'Event moderation' }, { id: 'bookings', label: 'All bookings' },
];

export default function Admin() {
  return <Guard roles={['admin']}><Content /></Guard>;
}

function Content() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold sm:text-4xl">Admin</h1>
      <div role="tablist" aria-label="Admin sections" className="flex gap-1 overflow-x-auto border-b border-lilac">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${tab === t.id ? 'border-brand text-brand' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'overview' && <Overview go={setTab} />}
      {tab === 'organizers' && <Organizers />}
      {tab === 'events' && <Events />}
      {tab === 'bookings' && <Bookings />}
    </div>
  );
}

function Overview({ go }: { go: (t: Tab) => void }) {
  const [s, setS] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/admin/stats').then(setS).catch((e) => setError(errorMessage(e))); }, []);
  if (error) return <Notice>{error}</Notice>;
  if (!s) return <Spinner />;
  const tiles: [string, string][] = [
    ['Total revenue (confirmed)', rupees(s.revenuePaise)], ['Tickets sold', String(s.ticketsSold)],
    ['Active events', String(s.activeEvents)], ['Registered users', String(s.users)],
  ];
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map(([k, v]) => <div key={k} className="panel"><dd className="font-display text-3xl font-extrabold">{v}</dd><dt className="mt-1 text-sm text-ink-soft">{k}</dt></div>)}
      </dl>
      <div className="grid gap-4 sm:grid-cols-2">
        <button onClick={() => go('organizers')} className="panel text-left hover:bg-brand-soft"><p className="font-display text-2xl font-extrabold">{s.pendingOrganizerRequests}</p><p className="text-sm text-ink-soft">organizer request{s.pendingOrganizerRequests === 1 ? '' : 's'} waiting for review</p></button>
        <button onClick={() => go('bookings')} className="panel text-left hover:bg-brand-soft"><p className="font-display text-2xl font-extrabold">{s.pendingPayments}</p><p className="text-sm text-ink-soft">payment{s.pendingPayments === 1 ? '' : 's'} awaiting organizer verification</p></button>
      </div>
    </div>
  );
}

function Organizers() {
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => { setRows(null); api<{ requests: any[] }>(`/admin/organizer-requests?status=${status}`).then((d) => setRows(d.requests)).catch((e) => setError(errorMessage(e))); }, [status]);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, kind: 'approve' | 'reject') {
    setBusy(id); setError('');
    try { await api(`/admin/organizer-requests/${id}/${kind}`, { json: kind === 'reject' ? { reason: reason.trim() || undefined } : {} }); setRejecting(''); setReason(''); await load(); }
    catch (e) { setError(errorMessage(e)); }
    setBusy('');
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">{(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => <button key={s} onClick={() => setStatus(s)} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${status === s ? 'bg-ink text-white' : 'bg-white ring-1 ring-lilac'}`}>{s[0] + s.slice(1).toLowerCase()}</button>)}</div>
      {error && <Notice>{error}</Notice>}
      {!rows ? <Spinner /> : rows.length === 0 ? <EmptyState title={`No ${status.toLowerCase()} requests`} /> : (
        <ul className="space-y-4">
          {rows.map((r) => (
            <li key={r.id} className="panel space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="text-lg font-bold">{r.organizationName}</p><p className="text-sm text-ink-soft">{r.user.name}, {r.user.email}, {r.contactPhone}</p></div>
                <StatusBadge status={r.status} />
              </div>
              <p className="whitespace-pre-line text-sm">{r.description}</p>
              {r.website && <a href={r.website} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand">{r.website}</a>}
              {r.rejectionReason && <p className="text-sm text-bad">Reason given: {r.rejectionReason}</p>}
              {r.status === 'PENDING' && (rejecting === r.id ? (
                <div className="flex flex-wrap gap-2">
                  <input className="input !w-64" placeholder="Reason (optional)" aria-label="Reason for rejecting" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button className="btn-danger" disabled={busy === r.id} onClick={() => act(r.id, 'reject')}>Confirm reject</button>
                  <button className="btn-ghost" onClick={() => setRejecting('')}>Back</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button className="btn-ok" disabled={busy === r.id} onClick={() => act(r.id, 'approve')}><Check className="h-4 w-4" aria-hidden />Approve</button>
                  <button className="btn-danger" onClick={() => { setRejecting(r.id); setReason(''); }}><X className="h-4 w-4" aria-hidden />Reject</button>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Events() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    const p = new URLSearchParams(); if (status) p.set('status', status); if (q.trim()) p.set('q', q.trim());
    api<{ events: any[] }>(`/admin/events?${p}`).then((d) => setRows(d.events)).catch((e) => setError(errorMessage(e)));
  }, [status, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function run(id: string, label: string, call: () => Promise<unknown>) {
    if (!window.confirm(label)) return;
    setBusy(id); setError('');
    try { await call(); load(); } catch (e) { setError(errorMessage(e)); }
    setBusy('');
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="Search event title" aria-label="Search events" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-auto" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{['DRAFT', 'PUBLISHED', 'SOLD_OUT', 'CANCELLED', 'COMPLETED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
        </select>
      </div>
      {error && <Notice>{error}</Notice>}
      {!rows ? <Spinner /> : rows.length === 0 ? <EmptyState title="No events found" /> : (
        <div className="overflow-x-auto rounded-2xl border border-lilac/70 bg-white">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-lilac/70 bg-paper"><tr>{['Event', 'Organizer', 'Date', 'Seats left', 'Status', 'Actions'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-lilac/50">
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="td"><Link href={`/events/${e.id}`} className="font-semibold hover:text-brand">{e.title}</Link><p className="text-xs text-ink-soft">{e.city}</p></td>
                  <td className="td"><p>{e.organizer.name}</p><p className="text-xs text-ink-soft">{e.organizer.email}</p></td>
                  <td className="td whitespace-nowrap">{fmtDateTime(e.startsAt)}</td>
                  <td className="td">{e.available} / {e.capacity}</td>
                  <td className="td"><StatusBadge status={e.status} /></td>
                  <td className="td">
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/organizer/events/${e.id}/edit`} className="btn-ghost !px-3 !py-1.5">Edit</Link>
                      {(e.status === 'PUBLISHED' || e.status === 'SOLD_OUT') && <button className="btn-ghost !px-3 !py-1.5" disabled={busy === e.id} onClick={() => run(e.id, 'Take this event offline? It becomes a draft and stops appearing on the homepage.', () => api(`/events/${e.id}/status`, { json: { status: 'DRAFT' } }))}>Unpublish</button>}
                      {e.status !== 'CANCELLED' && e.status !== 'COMPLETED' && <button className="btn-danger !px-3 !py-1.5" disabled={busy === e.id} onClick={() => run(e.id, 'Cancel this event? Held tickets are released immediately.', () => api(`/events/${e.id}/cancel`, { method: 'POST' }))}>Cancel</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Bookings() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ bookings: any[]; total: number; pageSize: number } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    const p = new URLSearchParams({ page: String(page) }); if (status) p.set('status', status);
    api<any>(`/admin/bookings?${p}`).then(setData).catch((e) => setError(errorMessage(e)));
  }, [status, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <select className="input !w-auto" aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
        <option value="">All bookings</option>{['AWAITING_PAYMENT', 'PENDING_ORGANIZER_VERIFICATION', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}
      </select>
      {error && <Notice>{error}</Notice>}
      {!data ? <Spinner /> : data.bookings.length === 0 ? <EmptyState title="No bookings found" /> : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-lilac/70 bg-white">
            <table className="w-full min-w-[820px]">
              <thead className="border-b border-lilac/70 bg-paper"><tr>{['Reference', 'Event', 'Customer', 'Tickets', 'Amount', 'UTR', 'Status', 'Created'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-lilac/50">
                {data.bookings.map((b) => (
                  <tr key={b.id}>
                    <td className="td font-mono text-xs">{b.reference}</td>
                    <td className="td max-w-[220px] font-semibold">{b.event.title}</td>
                    <td className="td"><p>{b.customer.name}</p><p className="text-xs text-ink-soft">{b.customer.email}</p></td>
                    <td className="td">{b.quantity}</td>
                    <td className="td">{rupees(b.totalPaise)}</td>
                    <td className="td font-mono text-xs">{b.utr ?? 'Not submitted'}</td>
                    <td className="td"><StatusBadge status={b.status} /></td>
                    <td className="td whitespace-nowrap text-ink-soft">{fmtShort(b.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-soft">{data.total} booking{data.total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-2"><button className="btn-ghost !py-1.5" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="btn-ghost !py-1.5" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
          </div>
        </>
      )}
    </div>
  );
}

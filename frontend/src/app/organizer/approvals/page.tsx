'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import { Guard } from '@/components/AuthProvider';
import { CopyButton, EmptyState, Notice, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtShort, rupees } from '@/lib/format';

interface Approval {
  id: string; reference: string; quantity: number; totalPaise: number; utr: string; screenshotUrl: string | null;
  submittedAt: string; customer: { name: string; email: string }; event: { id: string; title: string };
}

export default function Approvals() {
  return <Guard roles={['organizer', 'admin']}><Queue /></Guard>;
}

function Queue() {
  const [rows, setRows] = useState<Approval[] | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(() => api<{ approvals: Approval[] }>('/organizer/approvals').then((d) => setRows(d.approvals)).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(a: Approval, kind: 'approve' | 'reject') {
    setBusy(a.id); setError(''); setDone('');
    try {
      await api(`/bookings/${a.id}/${kind}`, { json: kind === 'reject' ? { reason: reason.trim() || undefined } : {} });
      setRows((r) => r?.filter((x) => x.id !== a.id) ?? null);
      setDone(kind === 'approve' ? `Confirmed ${a.customer.name}’s ${a.quantity} ticket${a.quantity > 1 ? 's' : ''}.` : `Rejected ${a.reference}. The tickets are back on sale.`);
      setRejecting(''); setReason('');
    } catch (e) { setError(errorMessage(e)); void load(); }
    setBusy('');
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-extrabold sm:text-4xl">Payment Approvals</h1><p className="mt-1 max-w-2xl text-ink-soft">Match each UTR against your UPI app’s transaction history before confirming. Rejecting releases the tickets back to the event.</p></div>
      {error && <Notice>{error}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      {!rows ? <Spinner /> : rows.length === 0 ? (
        <EmptyState title="No payments waiting">New submissions appear here automatically.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-lilac/70 bg-white">
          <table className="w-full min-w-[820px]">
            <thead className="border-b border-lilac/70 bg-paper"><tr>{['Customer', 'Event', 'Tickets', 'Amount', 'UTR number', 'Proof', 'Submitted', 'Decision'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-lilac/50">
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="td"><p className="font-semibold">{a.customer.name}</p><p className="text-xs text-ink-soft">{a.customer.email}</p></td>
                  <td className="td max-w-[200px]"><p className="font-semibold">{a.event.title}</p><p className="text-xs text-ink-soft">{a.reference}</p></td>
                  <td className="td">{a.quantity}</td>
                  <td className="td font-semibold">{rupees(a.totalPaise)}</td>
                  <td className="td"><span className="font-mono">{a.utr}</span> <CopyButton value={a.utr} /></td>
                  <td className="td">
                    {a.screenshotUrl ? (
                      <a href={a.screenshotUrl} target="_blank" rel="noreferrer" className="group block w-fit" aria-label={`Open payment screenshot for ${a.reference}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.screenshotUrl} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-lilac" />
                        <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand">Open <ExternalLink className="h-3 w-3" aria-hidden /></span>
                      </a>
                    ) : <span className="text-xs text-ink-soft">None attached</span>}
                  </td>
                  <td className="td whitespace-nowrap text-ink-soft">{fmtShort(a.submittedAt)}</td>
                  <td className="td">
                    {rejecting === a.id ? (
                      <div className="w-52 space-y-2">
                        <input className="input !py-2" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for rejecting" />
                        <div className="flex gap-2"><button className="btn-danger !px-3 !py-1.5" disabled={busy === a.id} onClick={() => act(a, 'reject')}>Confirm reject</button><button className="btn-ghost !px-3 !py-1.5" onClick={() => setRejecting('')}>Back</button></div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <button className="btn-ok !px-3 !py-1.5" disabled={busy === a.id} onClick={() => act(a, 'approve')}><Check className="h-4 w-4" aria-hidden />Verify &amp; Confirm</button>
                        <button className="btn-danger !px-3 !py-1.5" disabled={busy === a.id} onClick={() => { setRejecting(a.id); setReason(''); }}><X className="h-4 w-4" aria-hidden />Reject &amp; Release</button>
                      </div>
                    )}
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

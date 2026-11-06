'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Guard } from '@/components/AuthProvider';
import { EmptyState, Notice, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtShort } from '@/lib/format';

interface Attendee { id: string; ticketNumber: number; used: boolean; checkedInAt: string | null; attendee: string; email: string; reference: string; quantity: number }

export default function Attendees() {
  return <Guard roles={['organizer', 'admin']}><Content /></Guard>;
}

function Content() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ event: { id: string; title: string }; attendees: Attendee[]; checkedIn: number } | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { api<typeof data>(`/events/${id}/attendees`).then(setData).catch((e) => setError(errorMessage(e))); }, [id]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.attendees ?? []).filter((a) => !s || [a.attendee, a.email, a.reference].some((v) => v.toLowerCase().includes(s)));
  }, [data, q]);

  if (error) return <Notice>{error}</Notice>;
  if (!data) return <Spinner />;
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/events/${data.event.id}`} className="text-sm font-semibold text-brand">Back to event</Link>
        <h1 className="mt-1 text-3xl font-extrabold sm:text-4xl">Attendees</h1>
        <p className="text-ink-soft">{data.event.title}: {data.checkedIn} of {data.attendees.length} confirmed tickets checked in.</p>
      </div>
      {data.attendees.length === 0 ? <EmptyState title="No confirmed tickets yet">Tickets appear here after you confirm a payment.</EmptyState> : (
        <>
          <input className="input max-w-sm" placeholder="Search name, email or booking ref" aria-label="Search attendees" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="overflow-x-auto rounded-2xl border border-lilac/70 bg-white">
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-lilac/70 bg-paper"><tr>{['Attendee', 'Booking', 'Ticket', 'Entry'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-lilac/50">
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="td"><p className="font-semibold">{a.attendee}</p><p className="text-xs text-ink-soft">{a.email}</p></td>
                    <td className="td font-mono text-xs">{a.reference}</td>
                    <td className="td">{a.ticketNumber} of {a.quantity}</td>
                    <td className="td">{a.used ? <span className="badge bg-ok-soft text-ok">Checked in {a.checkedInAt ? fmtShort(a.checkedInAt) : ''}</span> : <span className="badge bg-lilac/60 text-ink-soft">Not yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

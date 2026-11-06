'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Guard, useAuth } from '@/components/AuthProvider';
import { Notice } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function BecomeOrganizer() {
  return <Guard><Form /></Guard>;
}

function Form() {
  const { user, organizerRequest, refresh } = useAuth();
  const [f, setF] = useState({ organizationName: '', description: '', contactPhone: '', website: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await api('/auth/organizer-request', { json: f }); await refresh(); }
    catch (err) { setError(errorMessage(err)); }
    setBusy(false);
  }

  if (user && user.role !== 'customer') {
    return <div className="panel mx-auto max-w-lg space-y-3 text-center"><h1 className="text-2xl font-extrabold">You can already manage events</h1><Link href="/organizer" className="btn-primary">Open organizer dashboard</Link></div>;
  }
  if (organizerRequest?.status === 'PENDING') {
    return (
      <div className="panel mx-auto max-w-lg space-y-3 text-center">
        <h1 className="text-2xl font-extrabold">Request received</h1>
        <p className="text-ink-soft">An admin will review <b>{organizerRequest.organizationName}</b>. Organizer tools unlock after approval; you’ll see the change the next time you open QuickTix.</p>
        <Link href="/dashboard" className="btn-ghost">Back to My tickets</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="panel mx-auto max-w-xl space-y-4">
      <div><h1 className="text-3xl font-extrabold">Become an organizer</h1><p className="mt-1 text-ink-soft">Tell us who you are. An admin reviews every request before organizer tools are switched on.</p></div>
      {organizerRequest?.status === 'REJECTED' && <Notice>Your previous request wasn’t approved{organizerRequest.rejectionReason ? `: ${organizerRequest.rejectionReason}` : '.'} You can update the details and apply again.</Notice>}
      {error && <Notice>{error}</Notice>}
      <div><label className="label" htmlFor="org">Organization or brand name</label><input id="org" className="input" required minLength={2} value={f.organizationName} onChange={(e) => set('organizationName', e.target.value)} /></div>
      <div><label className="label" htmlFor="desc">What events do you run?</label><textarea id="desc" className="input min-h-28" required minLength={20} value={f.description} onChange={(e) => set('description', e.target.value)} /><p className="hint">At least 20 characters. Mention the kinds of events, cities and how long you’ve been hosting.</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="phone">Contact phone</label><input id="phone" type="tel" className="input" required value={f.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} /></div>
        <div><label className="label" htmlFor="web">Website or social page <span className="font-normal text-ink-soft">(optional)</span></label><input id="web" type="url" placeholder="https://" className="input" value={f.website} onChange={(e) => set('website', e.target.value)} /></div>
      </div>
      <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
    </form>
  );
}

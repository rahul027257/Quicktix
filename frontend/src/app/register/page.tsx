'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Notice } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/auth/register', { json: form });
      await refresh();
      router.replace('/');
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="panel mx-auto mt-6 max-w-md space-y-4">
      <h1 className="text-3xl font-extrabold">Create your account</h1>
      {error && <Notice>{error}</Notice>}
      <div><label className="label" htmlFor="name">Full name</label><input id="name" autoComplete="name" required minLength={2} className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
      <div><label className="label" htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required className="input" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} className="input" value={form.password} onChange={(e) => set('password', e.target.value)} />
        <p className="hint">At least 8 characters.</p>
      </div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      <p className="text-center text-sm text-ink-soft">Already have an account? <Link className="font-semibold text-brand" href="/login">Sign in</Link></p>
      <p className="text-center text-xs text-ink-faint">Want to host events? Create an account first, then request organizer access from My tickets.</p>
    </form>
  );
}

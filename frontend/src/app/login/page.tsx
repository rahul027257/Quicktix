'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Notice } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/auth/login', { json: { email, password } });
      await refresh();
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="panel mx-auto mt-6 max-w-md space-y-4">
      <h1 className="text-3xl font-extrabold">Sign in</h1>
      {error && <Notice>{error}</Notice>}
      <div><label className="label" htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><label className="label" htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="text-center text-sm text-ink-soft">New to QuickTix? <Link className="font-semibold text-brand" href="/register">Create an account</Link></p>
    </form>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}

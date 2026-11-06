'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, ScanLine, Ticket, X } from 'lucide-react';
import { useAuth } from './AuthProvider';

export function Navbar() {
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const links: { href: string; label: string }[] = [{ href: '/', label: 'Explore' }];
  if (user && user.role !== 'admin') links.push({ href: '/dashboard', label: 'My tickets' });
  if (user && (user.role === 'organizer' || user.role === 'admin')) {
    links.push({ href: '/organizer', label: 'Organizer' }, { href: '/organizer/check-in', label: 'Check-in' });
  }
  if (user?.role === 'admin') links.push({ href: '/admin', label: 'Admin' });

  return (
    <header className="sticky top-0 z-30 border-b border-lilac/70 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2" onClick={close}>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white"><Ticket className="h-5 w-5" aria-hidden /></span>
          <span className="font-display text-xl font-extrabold">QuickTix</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-brand-soft hover:text-brand">
              {l.label === 'Check-in' && <ScanLine className="h-4 w-4" aria-hidden />}{l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {loading ? null : user ? (
            <>
              <span className="max-w-[10rem] truncate text-sm font-semibold">{user.name}</span>
              <button className="btn-ghost !py-2" onClick={logout}>Sign out</button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost !py-2">Sign in</Link>
              <Link href="/register" className="btn-primary !py-2">Create account</Link>
            </>
          )}
        </div>

        <button className="rounded-lg p-2 md:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-lilac/70 bg-paper px-4 pb-4 md:hidden">
          <nav aria-label="Mobile" className="flex flex-col py-2">
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={close} className="rounded-lg px-2 py-3 text-base font-semibold">{l.label}</Link>
            ))}
          </nav>
          {user ? (
            <button className="btn-ghost w-full" onClick={() => { close(); void logout(); }}>Sign out ({user.name})</button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Link href="/login" onClick={close} className="btn-ghost">Sign in</Link>
              <Link href="/register" onClick={close} className="btn-primary">Create account</Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

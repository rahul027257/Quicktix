'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { OrganizerRequest, Role, User } from '@/lib/types';

interface AuthState {
  user: User | null;
  organizerRequest: OrganizerRequest | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthState>({ user: null, organizerRequest: null, loading: true, refresh: async () => {}, logout: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organizerRequest, setReq] = useState<OrganizerRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const d = await api<{ user: User | null; organizerRequest: OrganizerRequest | null }>('/auth/me');
      setUser(d.user);
      setReq(d.organizerRequest);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    setReq(null);
    router.push('/');
  }, [router]);

  return <Ctx.Provider value={{ user, organizerRequest, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

/** Wraps a page that needs a signed-in user (optionally with one of the given roles). */
export function Guard({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [loading, user, router, path]);

  if (loading || !user) return <div className="py-24 text-center text-ink-soft">Loading…</div>;
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="panel mx-auto mt-10 max-w-lg text-center">
        <h1 className="text-xl font-bold">You don’t have access to this page</h1>
        <p className="mt-2 text-ink-soft">This area is for {roles.join(' and ')} accounts.</p>
      </div>
    );
  }
  return <>{children}</>;
}

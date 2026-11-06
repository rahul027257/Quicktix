import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { users } from '../db/schema';
import { forbidden, unauthorized } from './errors';

export type Role = 'customer' | 'organizer' | 'admin';
export interface AuthUser { id: string; name: string; email: string; role: Role }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export const SESSION_COOKIE = 'qt_session';
const maxAgeMs = config.JWT_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000;

export function startSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: `${config.JWT_EXPIRES_IN_DAYS}d` });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: maxAgeMs,
    path: '/',
  });
}

export function endSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' });
}

/** Resolves the session (cookie, or `Authorization: Bearer` for API clients) into req.user. Never rejects. */
export const attachUser: RequestHandler = async (req, _res, next) => {
  try {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const token = req.cookies?.[SESSION_COOKIE] ?? bearer;
    if (token) {
      const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as { sub: string };
      // Always load fresh so role changes (organizer approval) and deletions apply immediately.
      const [u] = await db
        .select({ id: users.id, name: users.name, email: users.email, role: users.role })
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);
      if (u) req.user = u;
    }
  } catch {
    /* invalid or expired token: treat as signed out */
  }
  next();
};

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export const requireRole = (...roles: Role[]): RequestHandler => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

/** Blocks cross-site state-changing requests (defence in depth on top of SameSite=Lax cookies). */
export const originGuard: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && !config.allowedOrigins.includes(origin)) return next(forbidden('Cross-origin request blocked'));
  next();
};

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db/client';
import { organizerProfiles, users } from '../db/schema';
import { endSession, requireAuth, startSession } from '../lib/auth';
import { conflict, isUniqueViolation, unauthorized } from '../lib/errors';

export const authRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false,
  skip: () => config.isTest,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' } },
});

const email = z.string().trim().toLowerCase().email().max(254);
const registerBody = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  email,
  password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password must be 72 characters or fewer'),
}); // note: no `role` field. Public sign-ups are always customers.

// Compared against when the email is unknown so response timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const publicUser = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

authRouter.post('/register', limiter, async (req, res) => {
  const body = registerBody.parse(req.body);
  try {
    const [u] = await db
      .insert(users)
      .values({ name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, 12), role: 'customer' })
      .returning();
    startSession(res, u.id);
    res.status(201).json({ user: publicUser(u) });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('An account with this email already exists', 'EMAIL_TAKEN');
    throw err;
  }
});

authRouter.post('/login', limiter, async (req, res) => {
  const body = z.object({ email, password: z.string().min(1).max(200) }).parse(req.body);
  const [u] = await db.select().from(users).where(eq(users.email, body.email));
  const ok = await bcrypt.compare(body.password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !ok) throw unauthorized('Incorrect email or password');
  startSession(res, u.id);
  res.json({ user: publicUser(u) });
});

authRouter.post('/logout', (_req, res) => {
  endSession(res);
  res.json({ ok: true });
});

async function organizerRequestOf(userId: string) {
  const [p] = await db.select().from(organizerProfiles).where(eq(organizerProfiles.userId, userId));
  return p
    ? { status: p.status, organizationName: p.organizationName, description: p.description, contactPhone: p.contactPhone,
        website: p.website, rejectionReason: p.rejectionReason, createdAt: p.createdAt }
    : null;
}

authRouter.get('/me', async (req, res) => {
  if (!req.user) return void res.json({ user: null, organizerRequest: null });
  res.json({ user: publicUser(req.user), organizerRequest: await organizerRequestOf(req.user.id) });
});

const organizerBody = z.object({
  organizationName: z.string().trim().min(2, 'Enter your organization name').max(120),
  description: z.string().trim().min(20, 'Tell us a bit more (at least 20 characters)').max(1500),
  contactPhone: z.string().trim().regex(/^[+0-9][0-9 \-]{7,18}$/, 'Enter a valid phone number'),
  website: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().url('Enter a full website address, e.g. https://example.com').max(300).optional()),
});

/** Customers ask to become organizers; nothing changes until an admin approves. */
authRouter.post('/organizer-request', requireAuth, async (req, res) => {
  const user = req.user!;
  if (user.role !== 'customer') throw conflict('Your account can already manage events', 'ALREADY_ORGANIZER');
  const body = organizerBody.parse(req.body);
  const existing = await organizerRequestOf(user.id);
  if (existing?.status === 'PENDING') throw conflict('Your request is already waiting for review', 'REQUEST_PENDING');

  const values = { ...body, website: body.website ?? null, status: 'PENDING' as const, rejectionReason: null, reviewedBy: null, reviewedAt: null };
  if (existing) await db.update(organizerProfiles).set(values).where(eq(organizerProfiles.userId, user.id));
  else await db.insert(organizerProfiles).values({ userId: user.id, ...values });
  res.status(201).json({ organizerRequest: await organizerRequestOf(user.id) });
});

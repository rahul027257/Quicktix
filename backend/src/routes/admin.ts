import { Router } from 'express';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { bookings, events, organizerProfiles, users } from '../db/schema';
import { requireRole } from '../lib/auth';
import { conflict, notFound } from '../lib/errors';

export const adminRouter = Router();
adminRouter.use(requireRole('admin'));

adminRouter.get('/stats', async (_req, res) => {
  const r = await db.execute(sql`
    SELECT
      coalesce((SELECT sum(total_paise) FROM bookings WHERE status = 'CONFIRMED'), 0)::float8 AS revenue_paise,
      (SELECT count(*) FROM events WHERE status IN ('PUBLISHED', 'SOLD_OUT'))::int AS active_events,
      (SELECT count(*) FROM users)::int AS users,
      (SELECT count(*) FROM organizer_profiles WHERE status = 'PENDING')::int AS pending_organizers,
      (SELECT count(*) FROM bookings WHERE status = 'PENDING_ORGANIZER_VERIFICATION')::int AS pending_payments,
      coalesce((SELECT sum(quantity) FROM bookings WHERE status = 'CONFIRMED'), 0)::int AS tickets_sold`);
  const x = r.rows[0];
  res.json({
    revenuePaise: x.revenue_paise, activeEvents: x.active_events, users: x.users,
    pendingOrganizerRequests: x.pending_organizers, pendingPayments: x.pending_payments, ticketsSold: x.tickets_sold,
  });
});

adminRouter.get('/organizer-requests', async (req, res) => {
  const { status } = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING') }).parse(req.query);
  const rows = await db
    .select({ p: organizerProfiles, name: users.name, email: users.email })
    .from(organizerProfiles)
    .innerJoin(users, eq(users.id, organizerProfiles.userId))
    .where(eq(organizerProfiles.status, status))
    .orderBy(desc(organizerProfiles.createdAt));
  res.json({
    requests: rows.map(({ p, name, email }) => ({
      id: p.id, status: p.status, organizationName: p.organizationName, description: p.description,
      contactPhone: p.contactPhone, website: p.website, createdAt: p.createdAt, rejectionReason: p.rejectionReason,
      user: { id: p.userId, name, email },
    })),
  });
});

adminRouter.post('/organizer-requests/:id/approve', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(organizerProfiles).where(eq(organizerProfiles.id, id)).for('update');
    if (!p) throw notFound('Request not found');
    if (p.status !== 'PENDING') throw conflict(`This request was already ${p.status.toLowerCase()}`, 'INVALID_STATE');
    await tx.update(organizerProfiles)
      .set({ status: 'APPROVED', reviewedBy: req.user!.id, reviewedAt: new Date(), rejectionReason: null })
      .where(eq(organizerProfiles.id, id));
    // Permissions activate only now, and only for plain customers (never downgrade an admin).
    await tx.update(users).set({ role: 'organizer' }).where(and(eq(users.id, p.userId), eq(users.role, 'customer')));
  });
  res.json({ ok: true });
});

adminRouter.post('/organizer-requests/:id/reject', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body ?? {});
  const [p] = await db.select().from(organizerProfiles).where(eq(organizerProfiles.id, id));
  if (!p) throw notFound('Request not found');
  if (p.status !== 'PENDING') throw conflict(`This request was already ${p.status.toLowerCase()}`, 'INVALID_STATE');
  await db.update(organizerProfiles)
    .set({ status: 'REJECTED', reviewedBy: req.user!.id, reviewedAt: new Date(), rejectionReason: reason || null })
    .where(and(eq(organizerProfiles.id, id), eq(organizerProfiles.status, 'PENDING')));
  res.json({ ok: true });
});

// Moderation view: every event regardless of status.
adminRouter.get('/events', async (req, res) => {
  const q = z.object({
    status: z.enum(['DRAFT', 'PUBLISHED', 'SOLD_OUT', 'CANCELLED', 'COMPLETED']).optional(),
    q: z.string().trim().max(100).optional(),
  }).parse(req.query);
  const conds = [];
  if (q.status) conds.push(eq(events.status, q.status));
  if (q.q) conds.push(ilike(events.title, `%${q.q.replace(/[\\%_]/g, '\\$&')}%`));
  const rows = await db
    .select({ e: events, organizer: users.name, organizerEmail: users.email })
    .from(events).innerJoin(users, eq(users.id, events.organizerId))
    .where(and(...conds)).orderBy(desc(events.createdAt)).limit(200);
  res.json({
    events: rows.map(({ e, organizer, organizerEmail }) => ({
      id: e.id, title: e.title, status: e.status, city: e.city, startsAt: e.startsAt, capacity: e.capacity,
      available: e.available, pricePaise: e.pricePaise, organizer: { name: organizer, email: organizerEmail },
    })),
  });
});

// Full booking oversight.
adminRouter.get('/bookings', async (req, res) => {
  const q = z.object({
    status: z.enum(['AWAITING_PAYMENT', 'PENDING_ORGANIZER_VERIFICATION', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
  }).parse(req.query);
  const where = q.status ? eq(bookings.status, q.status) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db.select({ b: bookings, eventTitle: events.title, customer: users.name, customerEmail: users.email })
      .from(bookings).innerJoin(events, eq(events.id, bookings.eventId)).innerJoin(users, eq(users.id, bookings.userId))
      .where(where).orderBy(desc(bookings.createdAt)).limit(25).offset((q.page - 1) * 25),
    db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(where),
  ]);
  res.json({
    total: n, page: q.page, pageSize: 25,
    bookings: rows.map(({ b, eventTitle, customer, customerEmail }) => ({
      id: b.id, reference: b.reference, status: b.status, quantity: b.quantity, totalPaise: b.totalPaise, utr: b.utr,
      createdAt: b.createdAt, event: { id: b.eventId, title: eventTitle }, customer: { name: customer, email: customerEmail },
    })),
  });
});

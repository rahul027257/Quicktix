import { Router } from 'express';
import { asc, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { bookings, events, users } from '../db/schema';
import { requireRole } from '../lib/auth';

export const organizerRouter = Router();
organizerRouter.use(requireRole('organizer', 'admin'));

// "My events" with live sales stats. Admins see every event.
organizerRouter.get('/events', async (req, res) => {
  const scope = req.user!.role === 'admin' ? sql`TRUE` : sql`e.organizer_id = ${req.user!.id}`;
  const r = await db.execute(sql`
    SELECT e.id, e.title, e.status, e.category, e.city, e.venue, e.starts_at, e.price_paise, e.capacity, e.available, e.banner_url,
           coalesce((SELECT sum(b.quantity) FROM bookings b WHERE b.event_id = e.id AND b.status = 'CONFIRMED'), 0)::int AS sold,
           coalesce((SELECT sum(b.total_paise) FROM bookings b WHERE b.event_id = e.id AND b.status = 'CONFIRMED'), 0)::float8 AS revenue_paise,
           (SELECT count(*) FROM bookings b WHERE b.event_id = e.id AND b.status = 'PENDING_ORGANIZER_VERIFICATION')::int AS pending
      FROM events e WHERE ${scope} ORDER BY e.starts_at DESC`);
  res.json({
    events: r.rows.map((x) => ({
      id: x.id, title: x.title, status: x.status, category: x.category, city: x.city, venue: x.venue,
      startsAt: x.starts_at, pricePaise: x.price_paise, capacity: x.capacity, available: x.available,
      bannerUrl: x.banner_url, sold: x.sold, revenuePaise: x.revenue_paise, pendingApprovals: x.pending,
    })),
  });
});

// "Payment Approvals" queue: oldest submission first.
organizerRouter.get('/approvals', async (req, res) => {
  const isAdmin = req.user!.role === 'admin';
  const rows = await db
    .select({
      id: bookings.id, reference: bookings.reference, quantity: bookings.quantity, totalPaise: bookings.totalPaise,
      utr: bookings.utr, hasScreenshot: sql<boolean>`${bookings.screenshotPath} IS NOT NULL`, submittedAt: bookings.submittedAt,
      customerName: users.name, customerEmail: users.email, eventId: events.id, eventTitle: events.title,
    })
    .from(bookings)
    .innerJoin(events, eq(events.id, bookings.eventId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(
      isAdmin
        ? eq(bookings.status, 'PENDING_ORGANIZER_VERIFICATION')
        : sql`${bookings.status} = 'PENDING_ORGANIZER_VERIFICATION' AND ${events.organizerId} = ${req.user!.id}`,
    )
    .orderBy(asc(bookings.submittedAt));
  res.json({
    approvals: rows.map((r) => ({
      id: r.id, reference: r.reference, quantity: r.quantity, totalPaise: r.totalPaise, utr: r.utr,
      screenshotUrl: r.hasScreenshot ? `/api/bookings/${r.id}/screenshot` : null, submittedAt: r.submittedAt,
      customer: { name: r.customerName, email: r.customerEmail }, event: { id: r.eventId, title: r.eventTitle },
    })),
  });
});

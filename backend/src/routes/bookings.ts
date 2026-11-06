import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db/client';
import { bookings, events, reservations, tickets, users } from '../db/schema';
import { requireAuth } from '../lib/auth';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { writeTicketPdf } from '../lib/pdf';
import { proofFilePath, removeUpload, saveImage, upload } from '../lib/upload';
import { eventSummary, getBookingView } from '../lib/views';
import { approveBooking, rejectBooking, releaseHold, reserveTickets, submitProof } from '../services/bookings';

export const bookingsRouter = Router();
bookingsRouter.use(requireAuth);

const uuid = (v: unknown) => {
  const r = z.string().uuid().safeParse(v);
  if (!r.success) throw notFound('Booking not found');
  return r.data;
};

// Atomic reservation: row lock + inventory decrement + 10-minute hold, all in one transaction.
bookingsRouter.post('/reserve', async (req, res) => {
  const body = z.object({
    eventId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1, 'Choose at least 1 ticket'),
  }).parse(req.body);
  const bookingId = await reserveTickets({ user: req.user!, ...body });
  res.status(201).json({ booking: await getBookingView(req.user!, bookingId) });
});

bookingsRouter.get('/mine', async (req, res) => {
  const rows = await db
    .select({ b: bookings, e: events, holdExpiresAt: reservations.expiresAt })
    .from(bookings)
    .innerJoin(events, eq(events.id, bookings.eventId))
    .innerJoin(reservations, eq(reservations.id, bookings.reservationId))
    .where(eq(bookings.userId, req.user!.id))
    .orderBy(desc(bookings.createdAt))
    .limit(200);
  const out = await Promise.all(
    rows.map(async ({ b, e, holdExpiresAt }) => {
      const ts = b.status === 'CONFIRMED'
        ? await db.select().from(tickets).where(eq(tickets.bookingId, b.id)).orderBy(tickets.ticketNumber)
        : [];
      return {
        id: b.id, reference: b.reference, status: b.status, quantity: b.quantity, totalPaise: b.totalPaise,
        createdAt: b.createdAt, rejectionReason: b.rejectionReason, holdExpiresAt, event: eventSummary(e),
        tickets: ts.map((t) => ({ id: t.id, ticketNumber: t.ticketNumber, used: t.used, checkedInAt: t.checkedInAt })),
      };
    }),
  );
  res.json({ bookings: out });
});

bookingsRouter.get('/:id', async (req, res) => {
  res.json({ booking: await getBookingView(req.user!, uuid(req.params.id)) });
});

// Explicit cancel, and also the target of the browser's page-leave beacon.
bookingsRouter.post('/:id/cancel', async (req, res) => {
  const status = await releaseHold(req.user!, uuid(req.params.id));
  res.json({ ok: true, status });
});

bookingsRouter.post('/:id/submit-proof', upload.single('screenshot'), async (req, res) => {
  const id = uuid(req.params.id);
  const { utr } = z.object({
    utr: z.string().trim().regex(/^\d{12}$/, 'The UTR / UPI reference number must be exactly 12 digits'),
  }).parse(req.body);
  if (config.REQUIRE_PAYMENT_SCREENSHOT && !req.file) throw badRequest('Attach a screenshot of your payment', 'SCREENSHOT_REQUIRED');

  const screenshotRef = req.file ? await saveImage(req.file, 'proofs') : null;
  try {
    await submitProof({ user: req.user!, bookingId: id, utr, screenshotRef });
  } catch (err) {
    await removeUpload(screenshotRef, 'proofs');
    throw err;
  }
  res.json({ booking: await getBookingView(req.user!, id) });
});

bookingsRouter.post('/:id/approve', async (req, res) => {
  await approveBooking(req.user!, uuid(req.params.id));
  res.json({ ok: true });
});

bookingsRouter.post('/:id/reject', async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body ?? {});
  await rejectBooking(req.user!, uuid(req.params.id), reason || undefined);
  res.json({ ok: true });
});

// Payment screenshots are private: buyer, the event's organizer and admins only.
bookingsRouter.get('/:id/screenshot', async (req, res) => {
  const [row] = await db
    .select({ b: bookings, organizerId: events.organizerId })
    .from(bookings).innerJoin(events, eq(events.id, bookings.eventId))
    .where(eq(bookings.id, uuid(req.params.id)));
  if (!row || !row.b.screenshotPath) throw notFound('No screenshot for this booking');
  const user = req.user!;
  if (row.b.userId !== user.id && row.organizerId !== user.id && user.role !== 'admin') throw notFound('No screenshot for this booking');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(proofFilePath(row.b.screenshotPath));
});

bookingsRouter.get('/:id/pdf', async (req, res) => {
  const id = uuid(req.params.id);
  const [row] = await db
    .select({ b: bookings, e: events, buyer: users.name })
    .from(bookings)
    .innerJoin(events, eq(events.id, bookings.eventId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(eq(bookings.id, id));
  const user = req.user!;
  if (!row || (row.b.userId !== user.id && user.role !== 'admin')) throw notFound('Booking not found');
  if (row.b.status !== 'CONFIRMED') throw conflict('Tickets are available once the organizer confirms your payment', 'NOT_CONFIRMED');
  if (row.e.status === 'CANCELLED') throw forbidden('This event was cancelled');

  const ts = await db.select().from(tickets)
    .where(and(eq(tickets.bookingId, id), eq(tickets.status, 'CONFIRMED'))).orderBy(tickets.ticketNumber);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="QuickTix-${row.b.reference}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  await writeTicketPdf(res, {
    reference: row.b.reference,
    attendee: row.buyer,
    event: { title: row.e.title, venue: row.e.venue, city: row.e.city, startsAt: row.e.startsAt, category: row.e.category },
    unitPricePaise: row.b.unitPricePaise,
    tickets: ts.map((t) => ({ ticketNumber: t.ticketNumber, code: t.code })),
  });
});

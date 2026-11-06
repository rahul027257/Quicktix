import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { bookings, events, organizerProfiles, reservations, tickets, users } from '../db/schema';
import type { AuthUser } from './auth';
import { notFound } from './errors';

export function buildUpiLink(p: { upiId: string; payeeName: string; amountPaise: number; note: string }) {
  const q = new URLSearchParams({ pa: p.upiId, pn: p.payeeName, am: (p.amountPaise / 100).toFixed(2), cu: 'INR', tn: p.note });
  return `upi://pay?${q.toString().replace(/\+/g, '%20').replace(/%40/g, '@')}`;
}

type EventRow = typeof events.$inferSelect;

export function eventSummary(e: EventRow) {
  return {
    id: e.id, title: e.title, category: e.category, venue: e.venue, city: e.city,
    startsAt: e.startsAt, endsAt: e.endsAt, pricePaise: e.pricePaise, available: e.available,
    capacity: e.capacity, status: e.status, bannerUrl: e.bannerUrl,
  };
}

/** Full booking view, shaped for who is looking at it. Throws 404 for anyone without access. */
export async function getBookingView(viewer: AuthUser, bookingId: string) {
  const [row] = await db
    .select({ b: bookings, e: events, r: reservations, c: { id: users.id, name: users.name, email: users.email } })
    .from(bookings)
    .innerJoin(events, eq(events.id, bookings.eventId))
    .innerJoin(reservations, eq(reservations.id, bookings.reservationId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(eq(bookings.id, bookingId));
  if (!row) throw notFound('Booking not found');

  const isOwner = row.b.userId === viewer.id;
  const isManager = viewer.role === 'admin' || row.e.organizerId === viewer.id;
  if (!isOwner && !isManager) throw notFound('Booking not found');
  const { b, e, r } = row;

  let payment = null;
  if (isOwner && b.status === 'AWAITING_PAYMENT' && e.upiId && e.upiQrUrl) {
    const [org] = await db
      .select({ name: organizerProfiles.organizationName })
      .from(organizerProfiles)
      .where(eq(organizerProfiles.userId, e.organizerId));
    payment = {
      upiId: e.upiId,
      upiQrUrl: e.upiQrUrl,
      amountPaise: b.totalPaise,
      upiLink: buildUpiLink({ upiId: e.upiId, payeeName: org?.name ?? e.title, amountPaise: b.totalPaise, note: `QuickTix ${b.reference}` }),
    };
  }

  const ts = await db.select().from(tickets).where(eq(tickets.bookingId, b.id)).orderBy(tickets.ticketNumber);
  return {
    id: b.id, reference: b.reference, status: b.status, quantity: b.quantity,
    unitPricePaise: b.unitPricePaise, totalPaise: b.totalPaise, utr: b.utr,
    hasScreenshot: !!b.screenshotPath, submittedAt: b.submittedAt, reviewedAt: b.reviewedAt,
    rejectionReason: b.rejectionReason, createdAt: b.createdAt,
    hold: { status: r.status, expiresAt: r.expiresAt },
    serverNow: new Date(),
    event: eventSummary(e),
    customer: isManager ? row.c : undefined,
    payment,
    tickets: ts.map((t) => ({
      id: t.id, ticketNumber: t.ticketNumber, status: t.status, used: t.used, checkedInAt: t.checkedInAt,
      // Entry codes are only ever shown for confirmed tickets, and only to the buyer.
      code: isOwner && t.status === 'CONFIRMED' ? t.code : undefined,
    })),
  };
}

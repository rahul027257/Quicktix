import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { bookings, events, reservations, tickets } from '../db/schema';
import type { AuthUser } from '../lib/auth';
import { AppError, conflict, forbidden, isUniqueViolation, notFound } from '../lib/errors';
import { expireHeldReservations, lockEvent, restoreInventory } from './inventory';

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const makeReference = () =>
  'QT-' + Array.from(crypto.randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join('');
/** 144 bits of entropy; unguessable, so possession of the code is the credential. */
const makeTicketCode = () => crypto.randomBytes(18).toString('base64url');

export async function reserveTickets(args: { user: AuthUser; eventId: string; quantity: number }) {
  const { user, eventId, quantity } = args;
  if (user.role === 'admin') throw forbidden('Admins manage events and cannot book tickets');
  if (quantity > config.MAX_TICKETS_PER_BOOKING) {
    throw conflict(`You can book up to ${config.MAX_TICKETS_PER_BOOKING} tickets at a time`, 'QUANTITY_LIMIT');
  }

  return db.transaction(async (tx) => {
    // Row lock: concurrent buyers of the same event are serialised here, so available can never go negative.
    if (!(await lockEvent(tx, eventId))) throw notFound('Event not found');
    // Sweep stale holds first so inventory is accurate even if the worker is behind.
    await expireHeldReservations(tx, eventId);

    const [event] = await tx.select().from(events).where(eq(events.id, eventId));
    if (event.organizerId === user.id) throw forbidden('You cannot book tickets for your own event');
    if (event.status === 'SOLD_OUT') throw conflict('This event is sold out', 'SOLD_OUT');
    if (event.status !== 'PUBLISHED') throw conflict('Bookings are not open for this event', 'NOT_BOOKABLE');
    if ((event.endsAt ?? event.startsAt) <= new Date()) throw conflict('This event has already taken place', 'EVENT_OVER');
    if (quantity > event.available) {
      throw conflict(`Only ${event.available} ticket${event.available === 1 ? '' : 's'} left`, 'INSUFFICIENT_INVENTORY', {
        available: event.available,
      });
    }

    const [active] = await tx
      .select({ bookingId: bookings.id })
      .from(reservations)
      .innerJoin(bookings, eq(bookings.reservationId, reservations.id))
      .where(and(eq(reservations.eventId, eventId), eq(reservations.userId, user.id), eq(reservations.status, 'HELD')));
    if (active) {
      throw conflict('You already have tickets on hold for this event', 'ACTIVE_HOLD', { bookingId: active.bookingId });
    }

    const remaining = event.available - quantity;
    await tx
      .update(events)
      .set({ available: remaining, status: remaining === 0 ? 'SOLD_OUT' : event.status })
      .where(eq(events.id, eventId));

    const [reservation] = await tx
      .insert(reservations)
      .values({
        eventId,
        userId: user.id,
        quantity,
        expiresAt: sql`clock_timestamp() + make_interval(mins => ${config.HOLD_MINUTES}::int)`,
      })
      .returning();

    const [booking] = await tx
      .insert(bookings)
      .values({
        reference: makeReference(),
        reservationId: reservation.id,
        eventId,
        userId: user.id,
        quantity,
        unitPricePaise: event.pricePaise,
        totalPaise: event.pricePaise * quantity,
      })
      .returning();
    return booking.id;
  });
}

/** Customer cancels checkout / leaves the page: the hold is invalidated and tickets return to inventory at once. */
export async function releaseHold(user: AuthUser, bookingId: string): Promise<string> {
  const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!b || b.userId !== user.id) throw notFound('Booking not found');

  return db.transaction(async (tx) => {
    await lockEvent(tx, b.eventId);
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, b.reservationId)).for('update');
    if (r.status === 'HELD') {
      await tx.update(reservations).set({ status: 'RELEASED' }).where(eq(reservations.id, r.id));
      await tx.update(bookings).set({ status: 'CANCELLED' }).where(eq(bookings.id, b.id));
      await restoreInventory(tx, b.eventId, r.quantity);
      return 'RELEASED';
    }
    if (r.status === 'UNDER_REVIEW' || r.status === 'CONVERTED') {
      throw conflict('Payment was already submitted, so this booking can no longer be cancelled here', 'NOT_CANCELLABLE');
    }
    return r.status; // already RELEASED / EXPIRED: idempotent
  });
}

export async function submitProof(args: { user: AuthUser; bookingId: string; utr: string; screenshotRef: string | null }) {
  const { user, bookingId, utr, screenshotRef } = args;
  const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!b || b.userId !== user.id) throw notFound('Booking not found');

  try {
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(reservations).where(eq(reservations.id, b.reservationId)).for('update');
      if (r.status === 'UNDER_REVIEW') throw conflict('Payment proof was already submitted for this booking', 'ALREADY_SUBMITTED');
      const live = await tx.execute(sql`SELECT (expires_at > clock_timestamp()) AS live FROM reservations WHERE id = ${r.id}`);
      if (r.status !== 'HELD' || !live.rows[0]?.live) {
        throw new AppError(410, 'HOLD_EXPIRED', 'Your hold has expired and the tickets were released. Please book again.');
      }
      const [ev] = await tx.select({ status: events.status }).from(events).where(eq(events.id, b.eventId));
      if (ev.status === 'CANCELLED') throw conflict('This event has been cancelled', 'EVENT_CANCELLED');

      // The 10-minute lock persists but no longer expires: only HELD rows are swept by the worker.
      await tx.update(reservations).set({ status: 'UNDER_REVIEW' }).where(eq(reservations.id, r.id));
      await tx
        .update(bookings)
        .set({ status: 'PENDING_ORGANIZER_VERIFICATION', utr, screenshotPath: screenshotRef, submittedAt: new Date() })
        .where(eq(bookings.id, b.id));
      // One distinct ticket record (and QR code) per seat.
      await tx.insert(tickets).values(
        Array.from({ length: b.quantity }, (_, i) => ({
          bookingId: b.id,
          eventId: b.eventId,
          ticketNumber: i + 1,
          code: makeTicketCode(),
        })),
      );
    });
  } catch (err) {
    if (isUniqueViolation(err, 'bookings_active_utr_idx')) {
      throw conflict('This UTR number has already been used for another booking. Check the number and try again.', 'DUPLICATE_UTR');
    }
    throw err;
  }
}

async function loadManageable(actor: AuthUser, bookingId: string) {
  const [row] = await db
    .select({ b: bookings, organizerId: events.organizerId })
    .from(bookings)
    .innerJoin(events, eq(events.id, bookings.eventId))
    .where(eq(bookings.id, bookingId));
  if (!row) throw notFound('Booking not found');
  if (actor.role !== 'admin' && row.organizerId !== actor.id) throw forbidden('This booking is for another organizer’s event');
  return row.b;
}

/** "Verify & Confirm": booking CONFIRMED, tickets become valid for entry. */
export async function approveBooking(actor: AuthUser, bookingId: string) {
  const b = await loadManageable(actor, bookingId);
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, b.reservationId)).for('update');
    const [cur] = await tx.select().from(bookings).where(eq(bookings.id, b.id)).for('update');
    if (cur.status !== 'PENDING_ORGANIZER_VERIFICATION' || r.status !== 'UNDER_REVIEW') {
      throw conflict(`This booking is already ${cur.status.toLowerCase().replace(/_/g, ' ')}`, 'INVALID_STATE');
    }
    const [ev] = await tx.select({ status: events.status }).from(events).where(eq(events.id, b.eventId));
    if (ev.status === 'CANCELLED') throw conflict('This event was cancelled, so the booking cannot be confirmed', 'EVENT_CANCELLED');

    await tx.update(reservations).set({ status: 'CONVERTED' }).where(eq(reservations.id, r.id));
    await tx.update(bookings).set({ status: 'CONFIRMED', reviewedBy: actor.id, reviewedAt: new Date() }).where(eq(bookings.id, b.id));
    await tx.update(tickets).set({ status: 'CONFIRMED' }).where(and(eq(tickets.bookingId, b.id), eq(tickets.status, 'PENDING_VERIFICATION')));
  });
}

/** "Reject & Release": booking REJECTED, hold invalidated, tickets return to the event pool. */
export async function rejectBooking(actor: AuthUser, bookingId: string, reason: string | undefined) {
  const b = await loadManageable(actor, bookingId);
  await db.transaction(async (tx) => {
    await lockEvent(tx, b.eventId);
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, b.reservationId)).for('update');
    const [cur] = await tx.select().from(bookings).where(eq(bookings.id, b.id)).for('update');
    if (cur.status !== 'PENDING_ORGANIZER_VERIFICATION' || r.status !== 'UNDER_REVIEW') {
      throw conflict(`This booking is already ${cur.status.toLowerCase().replace(/_/g, ' ')}`, 'INVALID_STATE');
    }
    await tx.update(reservations).set({ status: 'RELEASED' }).where(eq(reservations.id, r.id));
    await tx
      .update(bookings)
      .set({ status: 'REJECTED', reviewedBy: actor.id, reviewedAt: new Date(), rejectionReason: reason ?? null })
      .where(eq(bookings.id, b.id));
    await tx.update(tickets).set({ status: 'CANCELLED' }).where(eq(tickets.bookingId, b.id));
    await restoreInventory(tx, b.eventId, r.quantity);
  });
}

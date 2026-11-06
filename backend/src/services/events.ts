import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { bookings, events, reservations } from '../db/schema';
import type { AuthUser } from '../lib/auth';
import { conflict, forbidden, notFound } from '../lib/errors';
import { expireHeldReservations, lockEvent, restoreInventory } from './inventory';

export function canManageEvent(user: AuthUser | undefined, event: { organizerId: string }) {
  return !!user && (user.role === 'admin' || event.organizerId === user.id);
}

/** Cancels an event: held reservations are released immediately; confirmed/pending bookings are left for refunds. */
export async function cancelEvent(actor: AuthUser, eventId: string) {
  await db.transaction(async (tx) => {
    if (!(await lockEvent(tx, eventId))) throw notFound('Event not found');
    const [ev] = await tx.select().from(events).where(eq(events.id, eventId));
    if (!canManageEvent(actor, ev)) throw forbidden();
    if (ev.status === 'CANCELLED') throw conflict('This event is already cancelled', 'ALREADY_CANCELLED');
    if (ev.status === 'COMPLETED') throw conflict('A completed event cannot be cancelled', 'ALREADY_COMPLETED');

    const held = await tx
      .select({ id: reservations.id, quantity: reservations.quantity })
      .from(reservations)
      .where(and(eq(reservations.eventId, eventId), eq(reservations.status, 'HELD')))
      .for('update');
    if (held.length) {
      const ids = held.map((h) => h.id);
      await tx.update(reservations).set({ status: 'RELEASED' }).where(inArray(reservations.id, ids));
      await tx.update(bookings).set({ status: 'CANCELLED' }).where(inArray(bookings.reservationId, ids));
      await restoreInventory(tx, eventId, held.reduce((s, h) => s + h.quantity, 0));
    }
    await tx.update(events).set({ status: 'CANCELLED' }).where(eq(events.id, eventId));
  });
}

export interface EventEdit {
  title: string; description: string; category: (typeof events.$inferInsert)['category'];
  venue: string; city: string; startsAt: Date; endsAt: Date | null; pricePaise: number; capacity: number;
  upiId: string | null; bannerUrl?: string | null; upiQrUrl?: string | null; status: 'DRAFT' | 'PUBLISHED';
}

/** Edits an event under the row lock so capacity changes stay consistent with live holds and sales. */
export async function updateEvent(actor: AuthUser, eventId: string, edit: EventEdit) {
  return db.transaction(async (tx) => {
    if (!(await lockEvent(tx, eventId))) throw notFound('Event not found');
    await expireHeldReservations(tx, eventId);
    const [ev] = await tx.select().from(events).where(eq(events.id, eventId));
    if (!canManageEvent(actor, ev)) throw forbidden();
    if (ev.status === 'CANCELLED' || ev.status === 'COMPLETED') throw conflict('Cancelled or completed events cannot be edited', 'NOT_EDITABLE');

    const taken = ev.capacity - ev.available; // sold + held + under review
    if (edit.capacity < taken) {
      throw conflict(`Capacity cannot be lower than the ${taken} tickets already booked or on hold`, 'CAPACITY_TOO_LOW');
    }
    const available = edit.capacity - taken;
    const upiId = edit.upiId ?? ev.upiId;
    const upiQrUrl = edit.upiQrUrl ?? ev.upiQrUrl;
    if (edit.status === 'PUBLISHED' && (!upiId || !upiQrUrl)) {
      throw conflict('Add a UPI ID and UPI QR code before publishing', 'UPI_REQUIRED');
    }
    // DRAFT <-> live toggles; live events flip between PUBLISHED and SOLD_OUT with inventory.
    const status = edit.status === 'DRAFT' ? 'DRAFT' : available === 0 ? 'SOLD_OUT' : 'PUBLISHED';

    const [updated] = await tx
      .update(events)
      .set({
        title: edit.title, description: edit.description, category: edit.category, venue: edit.venue, city: edit.city,
        startsAt: edit.startsAt, endsAt: edit.endsAt, pricePaise: edit.pricePaise, capacity: edit.capacity,
        available, status, upiId, upiQrUrl, bannerUrl: edit.bannerUrl ?? ev.bannerUrl,
      })
      .where(eq(events.id, eventId))
      .returning();
    return { updated, previous: ev };
  });
}

export const completeFinishedEvents = async () => {
  const r = await db.execute(sql`
    UPDATE events SET status = 'COMPLETED'
     WHERE status IN ('PUBLISHED', 'SOLD_OUT')
       AND coalesce(ends_at, starts_at + interval '12 hours') < now()`);
  return r.rowCount ?? 0;
};

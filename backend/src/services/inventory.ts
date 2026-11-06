import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { bookings, reservations } from '../db/schema';

/**
 * LOCK ORDER (prevents deadlocks): always lock the event row first, then reservation/booking rows.
 * Every inventory-changing code path goes through lockEvent().
 */
export async function lockEvent(tx: Tx, eventId: string): Promise<boolean> {
  const r = await tx.execute(sql`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`);
  return r.rows.length === 1;
}

/** Returns tickets to the pool. Caller must hold the event row lock. A SOLD_OUT event becomes bookable again. */
export async function restoreInventory(tx: Tx, eventId: string, qty: number) {
  await tx.execute(sql`
    UPDATE events
       SET available = available + ${qty},
           status = CASE WHEN status = 'SOLD_OUT' THEN 'PUBLISHED'::event_status ELSE status END
     WHERE id = ${eventId}`);
}

/**
 * Expires every HELD reservation of an event whose window has passed and restores its inventory.
 * Idempotent and safe to run concurrently: rows are claimed with FOR UPDATE SKIP LOCKED and a
 * reservation can only leave HELD once, so inventory is restored exactly once.
 * Caller must hold the event row lock. UNDER_REVIEW reservations are never touched.
 */
export async function expireHeldReservations(tx: Tx, eventId: string): Promise<number> {
  const stale = await tx
    .select({ id: reservations.id, quantity: reservations.quantity })
    .from(reservations)
    .where(and(eq(reservations.eventId, eventId), eq(reservations.status, 'HELD'), lt(reservations.expiresAt, sql`clock_timestamp()`)))
    .for('update', { skipLocked: true });
  if (stale.length === 0) return 0;

  const ids = stale.map((r) => r.id);
  await tx.update(reservations).set({ status: 'EXPIRED' }).where(inArray(reservations.id, ids));
  await tx
    .update(bookings)
    .set({ status: 'EXPIRED' })
    .where(and(inArray(bookings.reservationId, ids), eq(bookings.status, 'AWAITING_PAYMENT')));
  await restoreInventory(tx, eventId, stale.reduce((sum, r) => sum + r.quantity, 0));
  return stale.length;
}

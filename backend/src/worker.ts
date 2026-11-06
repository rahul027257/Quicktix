import { eq, and, lt, sql } from 'drizzle-orm';
import { config } from './config';
import { db, pool } from './db/client';
import { reservations } from './db/schema';
import { completeFinishedEvents } from './services/events';
import { expireHeldReservations, lockEvent } from './services/inventory';

/**
 * Finds reservations with status = 'HELD' and expires_at < NOW(), marks them EXPIRED and restores inventory.
 * Idempotent and single-execution per reservation, even with several worker processes (see expireHeldReservations).
 */
export async function expireStaleReservations(): Promise<number> {
  const due = await db
    .selectDistinct({ eventId: reservations.eventId })
    .from(reservations)
    .where(and(eq(reservations.status, 'HELD'), lt(reservations.expiresAt, sql`clock_timestamp()`)));

  let expired = 0;
  for (const { eventId } of due) {
    expired += await db.transaction(async (tx) => {
      await lockEvent(tx, eventId); // lock order: event first, then reservations
      return expireHeldReservations(tx, eventId);
    });
  }
  return expired;
}

export async function runWorkerOnce() {
  const expired = await expireStaleReservations();
  const completed = await completeFinishedEvents();
  if (expired || completed) console.log(`[worker] expired ${expired} hold(s), completed ${completed} event(s)`);
  return { expired, completed };
}

/** Starts the 60-second loop (interval configurable). Returns a stop function. */
export function startWorker(): () => void {
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap runs in one process
    running = true;
    try {
      await runWorkerOnce();
    } catch (err) {
      console.error('[worker] run failed', err);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, config.WORKER_INTERVAL_SECONDS * 1000);
  console.log(`[worker] started, interval ${config.WORKER_INTERVAL_SECONDS}s`);
  return () => clearInterval(timer);
}

if (require.main === module) {
  const stop = startWorker();
  const shutdown = async () => {
    stop();
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

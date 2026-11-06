import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { AuthUser } from '../lib/auth';

export type ScanResult =
  | 'VALID_ENTRY' | 'ALREADY_USED' | 'PAYMENT_UNVERIFIED' | 'TICKET_INVALID' | 'WRONG_EVENT';

const MESSAGES: Record<ScanResult, string> = {
  VALID_ENTRY: 'Valid entry',
  ALREADY_USED: 'This ticket was already used',
  PAYMENT_UNVERIFIED: 'Payment has not been verified yet. Do not admit.',
  TICKET_INVALID: 'This ticket is not valid',
  WRONG_EVENT: 'This ticket is for a different event',
};

/** QR codes encode `quicktix:<code>`; a bare code (manual entry) works too. */
export const normaliseCode = (raw: string) => raw.trim().replace(/^quicktix:/i, '');

export async function verifyScan(actor: AuthUser, rawCode: string, eventId?: string) {
  const code = normaliseCode(rawCode);
  const authz = actor.role === 'admin' ? sql`TRUE` : sql`e.organizer_id = ${actor.id}`;
  const onlyEvent = eventId ? sql`t.event_id = ${eventId}` : sql`TRUE`;

  // Single atomic statement: of any number of simultaneous scans of one ticket, exactly one can win.
  const claimed = await db.execute(sql`
    UPDATE tickets t
       SET used = true, checked_in_at = clock_timestamp(), checked_in_by = ${actor.id}
      FROM events e, bookings b
     WHERE t.code = ${code}
       AND t.status = 'CONFIRMED' AND t.used = false
       AND e.id = t.event_id AND e.status IN ('PUBLISHED', 'SOLD_OUT')
       AND b.id = t.booking_id AND b.status = 'CONFIRMED'
       AND ${authz} AND ${onlyEvent}
    RETURNING t.id`);

  const info = await db.execute(sql`
    SELECT t.id, t.status, t.used, t.checked_in_at, t.ticket_number, t.event_id,
           b.quantity, b.reference, u.name AS attendee, e.title AS event_title,
           e.status AS event_status, e.organizer_id
      FROM tickets t
      JOIN bookings b ON b.id = t.booking_id
      JOIN users u ON u.id = b.user_id
      JOIN events e ON e.id = t.event_id
     WHERE t.code = ${code}`);
  const row = info.rows[0] as Record<string, any> | undefined;

  let result: ScanResult;
  if (!row) result = 'TICKET_INVALID';
  else if (claimed.rows.length === 1) result = 'VALID_ENTRY';
  else if (actor.role !== 'admin' && row.organizer_id !== actor.id) result = 'TICKET_INVALID';
  else if (eventId && row.event_id !== eventId) result = 'WRONG_EVENT';
  else if (row.used) result = 'ALREADY_USED';
  else if (row.status === 'PENDING_VERIFICATION') result = 'PAYMENT_UNVERIFIED';
  else result = 'TICKET_INVALID'; // CANCELLED ticket, or event cancelled / no longer live

  // Never reveal another organizer's attendee details.
  const reveal = row && (actor.role === 'admin' || row.organizer_id === actor.id) && result !== 'TICKET_INVALID';
  return {
    result,
    message: MESSAGES[result],
    ticket: reveal
      ? {
          ticketNumber: row.ticket_number as number,
          of: row.quantity as number,
          attendee: row.attendee as string,
          bookingReference: row.reference as string,
          eventTitle: row.event_title as string,
          checkedInAt: row.checked_in_at as Date | null,
        }
      : null,
  };
}

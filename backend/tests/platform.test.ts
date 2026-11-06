import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/client';
import { bookings, events, reservations, tickets } from '../src/db/schema';
import { runWorkerOnce } from '../src/worker';
import { PNG, app, closePool, inventoryDrift, loginAs, makeEvent, makeUser, resetDatabase } from './helpers';

beforeAll(resetDatabase);
afterAll(closePool);

const UTR = () => String(Math.floor(1e11 + Math.random() * 9e11));
const eventRow = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

describe('auth and roles', () => {
  it('registers customers only and ignores a client-supplied role', async () => {
    const r = await request(app).post('/api/auth/register').send({ name: 'Eve', email: 'EVE@example.com', password: 'longenough1', role: 'admin' });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe('customer');
    expect(r.body.user.email).toBe('eve@example.com');
    expect((await request(app).post('/api/auth/register').send({ name: 'Eve', email: 'eve@example.com', password: 'longenough1' })).status).toBe(409);
  });

  it('organizer access needs admin approval', async () => {
    const customer = await makeUser('customer');
    const admin = await makeUser('admin');
    const c = await loginAs(customer);
    const a = await loginAs(admin);

    expect((await c.post('/api/events').field('title', 'x')).status).toBe(403);
    const reqBody = { organizationName: 'Acme Live', description: 'We run concerts and festivals across the country.', contactPhone: '+91 98765 43210' };
    const sub = await c.post('/api/auth/organizer-request').send(reqBody);
    expect(sub.status).toBe(201);
    expect((await c.get('/api/auth/me')).body.user.role).toBe('customer'); // still a customer while pending
    expect((await c.post('/api/auth/organizer-request').send(reqBody)).status).toBe(409);
    expect((await c.get('/api/admin/organizer-requests')).status).toBe(403);

    const list = await a.get('/api/admin/organizer-requests');
    const id = list.body.requests.find((x: any) => x.user.id === customer.id).id;
    expect((await a.post(`/api/admin/organizer-requests/${id}/approve`)).status).toBe(200);
    expect((await c.get('/api/auth/me')).body.user.role).toBe('organizer');
    expect((await a.post(`/api/admin/organizer-requests/${id}/approve`)).status).toBe(409);
  });
});

describe('concurrency safety', () => {
  it('never oversells when 15 customers race for 5 tickets', async () => {
    const org = await makeUser('organizer');
    const ev = await makeEvent(org.id, { capacity: 5 });
    const agents = await Promise.all(Array.from({ length: 15 }, async () => loginAs(await makeUser('customer'))));
    const results = await Promise.all(agents.map((a) => a.post('/api/bookings/reserve').send({ eventId: ev.id, quantity: 1 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(10);
    const after = await eventRow(ev.id);
    expect(after.available).toBe(0);
    expect(after.status).toBe('SOLD_OUT');
    expect(await inventoryDrift(ev.id)).toBe(0);
  });

  it('grants a 2-ticket request only when 2 are free', async () => {
    const org = await makeUser('organizer');
    const ev = await makeEvent(org.id, { capacity: 3 });
    const [a, b] = await Promise.all([loginAs(await makeUser('customer')), loginAs(await makeUser('customer'))]);
    const rs = await Promise.all([a, b].map((x) => x.post('/api/bookings/reserve').send({ eventId: ev.id, quantity: 2 })));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await eventRow(ev.id)).available).toBe(1);
  });

  it('allows only one active hold per customer per event', async () => {
    const org = await makeUser('organizer');
    const ev = await makeEvent(org.id, { capacity: 10 });
    const c = await loginAs(await makeUser('customer'));
    const rs = await Promise.all([1, 2, 3].map(() => c.post('/api/bookings/reserve').send({ eventId: ev.id, quantity: 1 })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await eventRow(ev.id)).available).toBe(9);
  });
});

describe('hold expiry worker', () => {
  it('expires stale holds exactly once, even when run concurrently, and reopens sold-out events', async () => {
    const org = await makeUser('organizer');
    const ev = await makeEvent(org.id, { capacity: 2 });
    const c = await loginAs(await makeUser('customer'));
    const r = await c.post('/api/bookings/reserve').send({ eventId: ev.id, quantity: 2 });
    expect(r.status).toBe(201);
    expect(r.body.booking.hold.status).toBe('HELD');
    expect((await eventRow(ev.id)).status).toBe('SOLD_OUT');

    // fresh holds are untouched
    expect((await runWorkerOnce()).expired).toBe(0);
    await db.execute(sql`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE event_id = ${ev.id}`);

    const runs = await Promise.all([runWorkerOnce(), runWorkerOnce(), runWorkerOnce()]);
    expect(runs.reduce((s, x) => s + x.expired, 0)).toBe(1);
    const after = await eventRow(ev.id);
    expect(after.available).toBe(2);
    expect(after.status).toBe('PUBLISHED');
    expect((await runWorkerOnce()).expired).toBe(0);
    expect((await c.get(`/api/bookings/${r.body.booking.id}`)).body.booking.status).toBe('EXPIRED');
    expect(await inventoryDrift(ev.id)).toBe(0);
  });

  it('never expires a booking that is under organizer review', async () => {
    const org = await makeUser('organizer');
    const ev = await makeEvent(org.id, { capacity: 4 });
    const c = await loginAs(await makeUser('customer'));
    const id = (await c.post('/api/bookings/reserve').send({ eventId: ev.id, quantity: 2 })).body.booking.id;
    expect((await c.post(`/api/bookings/${id}/submit-proof`).field('utr', UTR())).status).toBe(200);
    await db.execute(sql`UPDATE reservations SET expires_at = now() - interval '1 hour' WHERE event_id = ${ev.id}`);
    expect((await runWorkerOnce()).expired).toBe(0);
    expect((await eventRow(ev.id)).available).toBe(2);
    expect((await c.get(`/api/bookings/${id}`)).body.booking.status).toBe('PENDING_ORGANIZER_VERIFICATION');
  });

  it('rejects proof after the hold lapsed and releases inventory when the customer cancels', async () => {
    const org = await makeUser('organizer');
    const ev = await makeEvent(org.id, { capacity: 4 });
    const c = await loginAs(await makeUser('customer'));
    const late = (await c.post('/api/bookings/reserve').send({ eventId: ev.id, quantity: 1 })).body.booking.id;
    await db.execute(sql`UPDATE reservations SET expires_at = now() - interval '1 second' WHERE event_id = ${ev.id}`);
    expect((await c.post(`/api/bookings/${late}/submit-proof`).field('utr', UTR())).status).toBe(410);
    await runWorkerOnce();

    const id = (await c.post('/api/bookings/reserve').send({ eventId: ev.id, quantity: 3 })).body.booking.id;
    expect((await eventRow(ev.id)).available).toBe(1);
    expect((await c.post(`/api/bookings/${id}/cancel`)).status).toBe(200);
    expect((await c.post(`/api/bookings/${id}/cancel`)).status).toBe(200); // idempotent
    expect((await eventRow(ev.id)).available).toBe(4);
    expect(await inventoryDrift(ev.id)).toBe(0);
  });
});

describe('payment verification and entry', () => {
  it('runs the whole journey: reserve, pay, approve, PDF, scan', async () => {
    const organizer = await makeUser('organizer');
    const o = await loginAs(organizer);

    // create through the real API, including the UPI QR upload
    const created = await o.post('/api/events')
      .field('title', 'Indie Night').field('description', 'An evening of independent music')
      .field('category', 'CONCERTS').field('venue', 'Blue Hall').field('city', 'Pune')
      .field('startsAt', new Date(Date.now() + 5 * 864e5).toISOString()).field('price', '750').field('capacity', '10')
      .field('upiId', 'bluehall@okicici').field('status', 'PUBLISHED')
      .attach('upiQr', PNG, { filename: 'qr.png', contentType: 'image/png' });
    expect(created.status).toBe(201);
    const evId = created.body.event.id;

    const customer = await makeUser('customer', 'Priya Nair');
    const c = await loginAs(customer);
    const booked = await c.post('/api/bookings/reserve').send({ eventId: evId, quantity: 3 });
    expect(booked.status).toBe(201);
    const b = booked.body.booking;
    expect(b.totalPaise).toBe(3 * 75000);
    expect(b.payment.upiId).toBe('bluehall@okicici');
    expect(b.payment.upiLink).toMatch(/^upi:\/\/pay\?pa=bluehall@okicici&pn=.*&am=2250\.00&cu=INR/);
    expect(new Date(b.hold.expiresAt).getTime() - new Date(b.serverNow).getTime()).toBeGreaterThan(9 * 60_000);

    // validation, then submit
    expect((await c.post(`/api/bookings/${b.id}/submit-proof`).field('utr', '12345')).status).toBe(400);
    const submitted = await c.post(`/api/bookings/${b.id}/submit-proof`).field('utr', '402112345678')
      .attach('screenshot', PNG, { filename: 'pay.png', contentType: 'image/png' });
    expect(submitted.status).toBe(200);
    expect(submitted.body.booking.status).toBe('PENDING_ORGANIZER_VERIFICATION');
    expect((await c.post(`/api/bookings/${b.id}/cancel`)).status).toBe(409); // no abandoning after paying
    expect((await c.post(`/api/bookings/${b.id}/submit-proof`).field('utr', '402112345678')).status).toBe(409);

    // pending state: tickets exist but are not usable and expose no codes
    expect(submitted.body.booking.tickets).toHaveLength(3);
    expect(submitted.body.booking.tickets.every((t: any) => t.code === undefined)).toBe(true);
    expect((await c.get(`/api/bookings/${b.id}/pdf`)).status).toBe(409);
    const rows = await db.select().from(tickets).where(eq(tickets.bookingId, b.id)).orderBy(tickets.ticketNumber);
    expect(new Set(rows.map((t) => t.code)).size).toBe(3);
    const scan = (code: string, eventId?: string, agent = o) => agent.post('/api/tickets/verify-scan').send({ code: `quicktix:${code}`, eventId });
    expect((await scan(rows[0].code)).body.result).toBe('PAYMENT_UNVERIFIED');

    // approvals queue + authorization
    const queue = await o.get('/api/organizer/approvals');
    expect(queue.body.approvals).toHaveLength(1);
    expect(queue.body.approvals[0]).toMatchObject({ utr: '402112345678', quantity: 3, totalPaise: 225000 });
    expect(queue.body.approvals[0].customer.name).toBe('Priya Nair');
    expect((await o.get(queue.body.approvals[0].screenshotUrl)).status).toBe(200);
    const stranger = await loginAs(await makeUser('organizer'));
    expect((await stranger.post(`/api/bookings/${b.id}/approve`)).status).toBe(403);
    expect((await c.post(`/api/bookings/${b.id}/approve`)).status).toBe(403);
    expect((await stranger.get(`/api/bookings/${b.id}/screenshot`)).status).toBe(404);

    expect((await o.post(`/api/bookings/${b.id}/approve`)).status).toBe(200);
    expect((await o.post(`/api/bookings/${b.id}/approve`)).status).toBe(409);
    expect((await o.post(`/api/bookings/${b.id}/reject`).send({})).status).toBe(409);

    // confirmed: customer sees QR codes and can download the PDF
    const view = (await c.get(`/api/bookings/${b.id}`)).body.booking;
    expect(view.status).toBe('CONFIRMED');
    expect(view.tickets.map((t: any) => t.code)).toEqual(rows.map((t) => t.code));
    const pdf = await c.get(`/api/bookings/${b.id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.body as Buffer).length).toBeGreaterThan(5000);

    // entry: each ticket is independent
    const first = await scan(rows[0].code, evId);
    expect(first.body.result).toBe('VALID_ENTRY');
    expect(first.body.ticket).toMatchObject({ ticketNumber: 1, of: 3, attendee: 'Priya Nair' });
    const again = await scan(rows[0].code, evId);
    expect(again.body.result).toBe('ALREADY_USED');
    expect(first.body.ticket.checkedInAt).toBeTruthy();
    expect(again.body.ticket.checkedInAt).toBe(first.body.ticket.checkedInAt); // original check-in time is reported
    const others = await db.select().from(tickets).where(eq(tickets.bookingId, b.id));
    expect(others.filter((t) => t.used)).toHaveLength(1);
    expect((await scan(rows[1].code, evId)).body.result).toBe('VALID_ENTRY');

    // simultaneous scans of one ticket: exactly one wins
    const race = await Promise.all(Array.from({ length: 6 }, () => scan(rows[2].code)));
    expect(race.filter((r) => r.body.result === 'VALID_ENTRY')).toHaveLength(1);
    expect(race.filter((r) => r.body.result === 'ALREADY_USED')).toHaveLength(5);

    // guards: unknown codes, other organizers, customers, wrong event
    expect((await scan('does-not-exist-12345')).body.result).toBe('TICKET_INVALID');
    expect((await scan(rows[0].code, undefined, stranger)).body.result).toBe('TICKET_INVALID');
    expect((await scan(rows[0].code, undefined, c)).status).toBe(403);
    const otherEvent = await makeEvent(organizer.id);
    expect((await scan(rows[0].code, otherEvent.id)).body.result).toBe('WRONG_EVENT');

    // attendees page data
    const att = await o.get(`/api/events/${evId}/attendees`);
    expect(att.body.attendees).toHaveLength(3);
    expect(att.body.checkedIn).toBe(3);
  });

  it('reject & release restores inventory and voids the tickets; duplicate UTRs are blocked', async () => {
    const organizer = await makeUser('organizer');
    const o = await loginAs(organizer);
    const ev = await makeEvent(organizer.id, { capacity: 4 });
    const c1 = await loginAs(await makeUser('customer'));
    const c2 = await loginAs(await makeUser('customer'));

    const b1 = (await c1.post('/api/bookings/reserve').send({ eventId: ev.id, quantity: 2 })).body.booking.id;
    const b2 = (await c2.post('/api/bookings/reserve').send({ eventId: ev.id, quantity: 2 })).body.booking.id;
    expect((await eventRow(ev.id)).status).toBe('SOLD_OUT');

    const utr = UTR();
    expect((await c1.post(`/api/bookings/${b1}/submit-proof`).field('utr', utr)).status).toBe(200);
    const dup = await c2.post(`/api/bookings/${b2}/submit-proof`).field('utr', utr);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_UTR');
    expect((await db.select().from(bookings).where(eq(bookings.id, b2)))[0].status).toBe('AWAITING_PAYMENT'); // rolled back cleanly

    const ts = await db.select().from(tickets).where(eq(tickets.bookingId, b1));
    expect((await o.post(`/api/bookings/${b1}/reject`).send({ reason: 'No matching payment' })).status).toBe(200);
    const after = await eventRow(ev.id);
    expect(after.available).toBe(2);
    expect(after.status).toBe('PUBLISHED'); // sold-out event reopens once tickets are released
    const rejected = (await c1.get(`/api/bookings/${b1}`)).body.booking;
    expect(rejected).toMatchObject({ status: 'REJECTED', rejectionReason: 'No matching payment' });
    expect((await db.select().from(tickets).where(eq(tickets.bookingId, b1))).every((t) => t.status === 'CANCELLED')).toBe(true);
    expect((await o.post('/api/tickets/verify-scan').send({ code: ts[0].code })).body.result).toBe('TICKET_INVALID');
    const [bk] = await db.select().from(bookings).where(eq(bookings.id, b1));
    expect((await db.select().from(reservations).where(eq(reservations.id, bk.reservationId)))[0].status).toBe('RELEASED');
    expect(await inventoryDrift(ev.id)).toBe(0);
  });

  it('keeps organizers and admins on management actions and cancels events cleanly', async () => {
    const organizer = await makeUser('organizer');
    const admin = await makeUser('admin');
    const o = await loginAs(organizer);
    const a = await loginAs(admin);
    const ev = await makeEvent(organizer.id, { capacity: 5 });
    const c = await loginAs(await makeUser('customer'));

    expect((await o.post('/api/bookings/reserve').send({ eventId: ev.id, quantity: 1 })).status).toBe(403);
    expect((await a.post('/api/bookings/reserve').send({ eventId: ev.id, quantity: 1 })).status).toBe(403);
    expect((await c.get(`/api/events/${ev.id}`)).body.viewer.canManage).toBe(false);
    expect((await o.get(`/api/events/${ev.id}`)).body.viewer.canManage).toBe(true);
    expect((await a.get(`/api/events/${ev.id}`)).body.viewer.canManage).toBe(true);

    const held = (await c.post('/api/bookings/reserve').send({ eventId: ev.id, quantity: 2 })).body.booking.id;
    expect((await c.post(`/api/events/${ev.id}/cancel`)).status).toBe(403);
    expect((await a.post(`/api/events/${ev.id}/cancel`)).status).toBe(200);
    const after = await eventRow(ev.id);
    expect(after.status).toBe('CANCELLED');
    expect(after.available).toBe(5);
    expect((await c.get(`/api/bookings/${held}`)).body.booking.status).toBe('CANCELLED');
    expect((await c.post('/api/bookings/reserve').send({ eventId: ev.id, quantity: 1 })).status).toBe(409);
  });
});

describe('discovery', () => {
  it('searches, filters and sorts', async () => {
    const org = await makeUser('organizer');
    const day = (n: number) => new Date(Date.now() + n * 864e5);
    await makeEvent(org.id, { title: 'Zebra Jazz', venue: 'Opera House', city: 'Kochi', pricePaise: 90000, startsAt: day(3), category: 'CONCERTS' });
    await makeEvent(org.id, { title: 'Alpha Stand-up', venue: 'Laugh Lounge', city: 'Kochi', pricePaise: 30000, startsAt: day(10), category: 'COMEDY_SHOWS' });
    await makeEvent(org.id, { title: 'Draft Thing', city: 'Kochi', status: 'DRAFT' });
    const get = (qs: string) => request(app).get(`/api/events?${qs}`);

    const all = await get('city=kochi');
    expect(all.body.events.map((e: any) => e.title)).toEqual(['Zebra Jazz', 'Alpha Stand-up']);
    expect((await get('city=kochi&sort=price_asc')).body.events[0].title).toBe('Alpha Stand-up');
    expect((await get('city=kochi&sort=price_desc')).body.events[0].title).toBe('Zebra Jazz');
    expect((await get('q=laugh')).body.events.map((e: any) => e.title)).toEqual(['Alpha Stand-up']);
    expect((await get('q=zebra')).body.total).toBe(1);
    expect((await get('city=kochi&category=COMEDY_SHOWS')).body.total).toBe(1);
    expect((await get('city=kochi&minPrice=500&maxPrice=1000')).body.events.map((e: any) => e.title)).toEqual(['Zebra Jazz']);
    const d = (n: number) => day(n).toISOString().slice(0, 10);
    expect((await get(`city=kochi&from=${d(8)}&to=${d(12)}`)).body.events.map((e: any) => e.title)).toEqual(['Alpha Stand-up']);
    expect((await get('city=kochi&category=NOPE')).status).toBe(400);
  });
});

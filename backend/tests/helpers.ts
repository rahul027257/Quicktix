import bcrypt from 'bcryptjs';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { events, users } from '../src/db/schema';
import { runMigrations } from '../src/db/migrate';

export const app = createApp();
const HASH = bcrypt.hashSync('Password#12345', 4);
export const PASSWORD = 'Password#12345';
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export async function resetDatabase() {
  const name = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error(`Refusing to reset non-test database "${name}"`);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await runMigrations(() => undefined);
}

let n = 0;
export async function makeUser(role: 'customer' | 'organizer' | 'admin', name = `${role} ${++n}`) {
  const email = `${role}${n}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const [u] = await db.insert(users).values({ name, email, passwordHash: HASH, role }).returning();
  return u;
}

export async function loginAs(u: { email: string }) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ email: u.email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
  return agent;
}

export async function makeEvent(organizerId: string, over: Partial<typeof events.$inferInsert> = {}) {
  const capacity = over.capacity ?? 100;
  const [e] = await db.insert(events).values({
    organizerId, title: 'Test Concert', description: 'A test concert for QuickTix', category: 'CONCERTS',
    venue: 'Test Arena', city: 'Mumbai', startsAt: new Date(Date.now() + 7 * 864e5), pricePaise: 50000,
    status: 'PUBLISHED', upiId: 'host@okaxis', upiQrUrl: '/uploads/upi-qr/x.png', ...over, capacity, available: over.available ?? capacity,
  }).returning();
  return e;
}

/** capacity - available must always equal the quantity held, under review or sold. */
export async function inventoryDrift(eventId: string) {
  const r = await db.execute(sql`
    SELECT (e.capacity - e.available) - coalesce(sum(r.quantity) FILTER (WHERE r.status IN ('HELD','UNDER_REVIEW','CONVERTED')), 0) AS drift
      FROM events e LEFT JOIN reservations r ON r.event_id = e.id WHERE e.id = ${eventId} GROUP BY e.id`);
  return Number(r.rows[0].drift);
}

export const closePool = () => pool.end();

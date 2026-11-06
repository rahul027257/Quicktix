import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { db, pool } from '../db/client';
import { events, organizerProfiles, users } from '../db/schema';

/** Development sample data: one approved organizer, one customer and a spread of upcoming events. */
async function main() {
  if (config.isProd) throw new Error('seed:demo is for development only');
  const password = 'DemoPass#2026';
  const hash = await bcrypt.hash(password, 12);

  const upsertUser = async (name: string, email: string, role: 'customer' | 'organizer') => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    if (u) return u;
    return (await db.insert(users).values({ name, email, passwordHash: hash, role }).returning())[0];
  };
  const organizer = await upsertUser('Riya Sharma', 'organizer@quicktix.local', 'organizer');
  await upsertUser('Arjun Mehta', 'customer@quicktix.local', 'customer');
  await db.insert(organizerProfiles).values({
    userId: organizer.id, organizationName: 'Lantern Live', description: 'Independent promoters of live music and comedy across India.',
    contactPhone: '+91 98765 43210', status: 'APPROVED',
  }).onConflictDoNothing();

  const dir = path.join(config.uploadRoot, 'public', 'upi-qr');
  await fs.mkdir(dir, { recursive: true });
  const qrFor = async (upi: string, key: string) => {
    await QRCode.toFile(path.join(dir, `${key}.png`), `upi://pay?pa=${upi}&pn=Lantern%20Live&cu=INR`, { width: 480, margin: 2 });
    return `/uploads/upi-qr/${key}.png`;
  };

  const day = 24 * 3600 * 1000;
  const at = (days: number, hour: number) => {
    const d = new Date(Date.now() + days * day);
    d.setUTCHours(hour - 5, 30 - 0, 0, 0); // IST wall clock
    return d;
  };
  const rows = [
    ['Sunburn Rooftop Sessions', 'CONCERTS', 'Skyline Terrace', 'Mumbai', 12, 20, 1499, 300, 'lantern.concerts@okaxis'],
    ['Open Mic Night: Laugh Riot', 'COMEDY_SHOWS', 'The Humour Club', 'Bengaluru', 6, 19, 499, 120, 'lantern.comedy@okhdfcbank'],
    ['Inter-College Football Cup Final', 'SPORTS', 'City Stadium', 'Pune', 20, 16, 199, 800, 'lantern.sports@oksbi'],
    ['Product Design Intensive', 'WORKSHOPS', 'Studio 9', 'Hyderabad', 15, 10, 2500, 40, 'lantern.learn@okicici'],
    ['DevSummit India 2026', 'CONFERENCES', 'Convention Centre', 'Bengaluru', 35, 9, 3999, 600, 'lantern.conf@okaxis'],
    ['Monsoon Lights Festival', 'FESTIVALS', 'Riverfront Grounds', 'Ahmedabad', 28, 17, 799, 1500, 'lantern.fest@okhdfcbank'],
    ['Modern Indian Art Showcase', 'EXHIBITIONS', 'Gallery Kala', 'Delhi', 9, 11, 350, 200, 'lantern.art@oksbi'],
    ['Cine Club: Midnight Classics', 'MOVIES', 'Regal Screening Room', 'Delhi', 4, 22, 250, 90, 'lantern.cine@okicici'],
    ['Techfest Hackathon Finale', 'COLLEGE_EVENTS', 'Main Auditorium, IIT Campus', 'Chennai', 18, 14, 150, 400, 'lantern.campus@okaxis'],
  ] as const;

  for (const [i, [title, category, venue, city, inDays, hour, price, capacity, upi]] of rows.entries()) {
    const exists = (await db.select({ id: events.id }).from(events).where(eq(events.title, title)))[0];
    if (exists) continue;
    await db.insert(events).values({
      organizerId: organizer.id, title, category, venue, city, startsAt: at(inDays, hour), pricePaise: price * 100,
      capacity, available: capacity, status: 'PUBLISHED', upiId: upi, upiQrUrl: await qrFor(upi, `demo-${i}`),
      description: `${title} at ${venue}, ${city}. Doors open one hour before the start. Bring a valid ID and your QuickTix pass (printed or on your phone).`,
    });
  }
  console.log(`Demo data ready.\n  organizer@quicktix.local / ${password}\n  customer@quicktix.local  / ${password}`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end().catch(() => undefined); process.exit(1); });

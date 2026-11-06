import { Router, type Request } from 'express';
import { and, asc, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db/client';
import { bookings, CATEGORIES, events, organizerProfiles, tickets, users } from '../db/schema';
import { requireRole } from '../lib/auth';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { removeUpload, saveImage, upload } from '../lib/upload';
import { cancelEvent, canManageEvent, updateEvent, type EventEdit } from '../services/events';

export const eventsRouter = Router();

const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
const uuid = (v: unknown) => {
  const r = z.string().uuid().safeParse(v);
  if (!r.success) throw notFound('Event not found');
  return r.data;
};
const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const like = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(CATEGORIES).optional(),
  city: z.string().trim().max(100).optional(),
  from: z.preprocess(blank, ymd.optional()),
  to: z.preprocess(blank, ymd.optional()),
  minPrice: z.preprocess(blank, z.coerce.number().min(0).optional()),
  maxPrice: z.preprocess(blank, z.coerce.number().min(0).optional()),
  sort: z.enum(['date_asc', 'price_asc', 'price_desc']).default('date_asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(12),
});

const organizerCols = {
  organizerName: users.name,
  organizationName: organizerProfiles.organizationName,
};
const toCard = (row: { e: typeof events.$inferSelect; organizerName: string; organizationName: string | null }) => ({
  id: row.e.id, title: row.e.title, category: row.e.category, venue: row.e.venue, city: row.e.city,
  startsAt: row.e.startsAt, endsAt: row.e.endsAt, pricePaise: row.e.pricePaise, available: row.e.available,
  capacity: row.e.capacity, status: row.e.status, bannerUrl: row.e.bannerUrl,
  organizer: { id: row.e.organizerId, name: row.organizationName ?? row.organizerName },
});

// Public discovery: search, filters, sorting, pagination. Only upcoming, live events are listed.
eventsRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  const day = (col: typeof events.startsAt) => sql`(${col} AT TIME ZONE ${config.timezone})::date`;
  const conds = [
    inArray(events.status, ['PUBLISHED', 'SOLD_OUT']),
    sql`coalesce(${events.endsAt}, ${events.startsAt}) > now()`,
  ];
  if (q.q) conds.push(or(ilike(events.title, like(q.q)), ilike(events.venue, like(q.q)))!);
  if (q.category) conds.push(eq(events.category, q.category));
  if (q.city) conds.push(sql`lower(${events.city}) = lower(${q.city})`);
  if (q.from) conds.push(sql`${day(events.startsAt)} >= ${q.from}::date`);
  if (q.to) conds.push(sql`${day(events.startsAt)} <= ${q.to}::date`);
  if (q.minPrice != null) conds.push(gte(events.pricePaise, Math.round(q.minPrice * 100)));
  if (q.maxPrice != null) conds.push(sql`${events.pricePaise} <= ${Math.round(q.maxPrice * 100)}`);

  const order =
    q.sort === 'price_asc' ? [asc(events.pricePaise), asc(events.startsAt)]
    : q.sort === 'price_desc' ? [desc(events.pricePaise), asc(events.startsAt)]
    : [asc(events.startsAt)];

  const where = and(...conds);
  const [rows, [{ n }]] = await Promise.all([
    db.select({ e: events, ...organizerCols }).from(events)
      .innerJoin(users, eq(users.id, events.organizerId))
      .leftJoin(organizerProfiles, eq(organizerProfiles.userId, events.organizerId))
      .where(where).orderBy(...order).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(events).where(where),
  ]);
  res.json({ events: rows.map(toCard), total: n, page: q.page, pageSize: q.pageSize });
});

eventsRouter.get('/meta/cities', async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT DISTINCT initcap(city) AS city FROM events
     WHERE status IN ('PUBLISHED', 'SOLD_OUT') AND coalesce(ends_at, starts_at) > now() ORDER BY 1`);
  res.json({ cities: rows.rows.map((r) => r.city as string) });
});

async function loadCard(id: string) {
  const [row] = await db.select({ e: events, ...organizerCols }).from(events)
    .innerJoin(users, eq(users.id, events.organizerId))
    .leftJoin(organizerProfiles, eq(organizerProfiles.userId, events.organizerId))
    .where(eq(events.id, id));
  return row;
}

eventsRouter.get('/:id', async (req, res) => {
  const row = await loadCard(uuid(req.params.id));
  if (!row) throw notFound('Event not found');
  const canManage = canManageEvent(req.user, row.e);
  if (row.e.status === 'DRAFT' && !canManage) throw notFound('Event not found');
  res.json({
    event: { ...toCard(row), description: row.e.description },
    viewer: { canManage, isCreator: req.user?.id === row.e.organizerId, role: req.user?.role ?? null },
  });
});

// Everything needed to edit an event, including its private-ish payment config.
eventsRouter.get('/:id/manage', requireRole('organizer', 'admin'), async (req, res) => {
  const [e] = await db.select().from(events).where(eq(events.id, uuid(req.params.id)));
  if (!e || !canManageEvent(req.user, e)) throw notFound('Event not found');
  res.json({ event: e });
});

const fields = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(150),
  description: z.string().trim().min(10, 'Add a short description (10+ characters)').max(5000),
  category: z.enum(CATEGORIES),
  venue: z.string().trim().min(2, 'Enter the venue').max(200),
  city: z.string().trim().min(2, 'Enter the city').max(100),
  startsAt: z.coerce.date({ invalid_type_error: 'Choose a start date and time' }),
  endsAt: z.preprocess(blank, z.coerce.date().optional()),
  price: z.coerce.number({ invalid_type_error: 'Enter a ticket price' }).min(1, 'Price must be at least ₹1').max(1_000_000),
  capacity: z.coerce.number().int().min(1, 'Capacity must be at least 1').max(100_000),
  upiId: z.preprocess(blank, z.string().trim().regex(UPI_RE, 'Enter a valid UPI ID, e.g. name@bank').optional()),
  status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'),
});

const uploadFields = upload.fields([{ name: 'banner', maxCount: 1 }, { name: 'upiQr', maxCount: 1 }]);
const filesOf = (req: Request) => (req.files ?? {}) as Record<string, Express.Multer.File[]>;

function toEdit(b: z.infer<typeof fields>): EventEdit {
  if (b.endsAt && b.endsAt <= b.startsAt) throw badRequest('End time must be after the start time', 'VALIDATION_ERROR');
  return {
    title: b.title, description: b.description, category: b.category, venue: b.venue, city: b.city,
    startsAt: b.startsAt, endsAt: b.endsAt ?? null, pricePaise: Math.round(b.price * 100), capacity: b.capacity,
    upiId: b.upiId ?? null, status: b.status,
  };
}

eventsRouter.post('/', requireRole('organizer', 'admin'), uploadFields, async (req, res) => {
  const body = fields.parse(req.body);
  const edit = toEdit(body);
  const f = filesOf(req);
  if (edit.startsAt <= new Date()) throw badRequest('Start time must be in the future', 'VALIDATION_ERROR');
  if (edit.status === 'PUBLISHED' && (!edit.upiId || !f.upiQr?.[0])) {
    throw badRequest('Add a UPI ID and a UPI QR code image before publishing', 'UPI_REQUIRED');
  }
  const bannerUrl = f.banner?.[0] ? await saveImage(f.banner[0], 'banners') : null;
  const upiQrUrl = f.upiQr?.[0] ? await saveImage(f.upiQr[0], 'upi-qr') : null;
  try {
    const [created] = await db.insert(events).values({
      organizerId: req.user!.id, ...edit, available: edit.capacity, bannerUrl, upiQrUrl,
    }).returning();
    res.status(201).json({ event: created });
  } catch (err) {
    await Promise.all([removeUpload(bannerUrl, 'banners'), removeUpload(upiQrUrl, 'upi-qr')]);
    throw err;
  }
});

eventsRouter.put('/:id', requireRole('organizer', 'admin'), uploadFields, async (req, res) => {
  const id = uuid(req.params.id);
  const edit = toEdit(fields.parse(req.body));
  const f = filesOf(req);
  const [before] = await db.select().from(events).where(eq(events.id, id));
  if (!before) throw notFound('Event not found');
  if (!canManageEvent(req.user, before)) throw forbidden();
  if (+edit.startsAt !== +before.startsAt && edit.startsAt <= new Date()) {
    throw badRequest('Start time must be in the future', 'VALIDATION_ERROR');
  }

  const bannerUrl = f.banner?.[0] ? await saveImage(f.banner[0], 'banners') : undefined;
  const upiQrUrl = f.upiQr?.[0] ? await saveImage(f.upiQr[0], 'upi-qr') : undefined;
  try {
    const { updated, previous } = await updateEvent(req.user!, id, { ...edit, bannerUrl, upiQrUrl });
    if (bannerUrl) await removeUpload(previous.bannerUrl, 'banners');
    if (upiQrUrl) await removeUpload(previous.upiQrUrl, 'upi-qr');
    res.json({ event: updated });
  } catch (err) {
    await Promise.all([removeUpload(bannerUrl, 'banners'), removeUpload(upiQrUrl, 'upi-qr')]);
    throw err;
  }
});

// Publish / unpublish without resubmitting the whole form.
eventsRouter.post('/:id/status', requireRole('organizer', 'admin'), async (req, res) => {
  const id = uuid(req.params.id);
  const { status } = z.object({ status: z.enum(['DRAFT', 'PUBLISHED']) }).parse(req.body);
  const [e] = await db.select().from(events).where(eq(events.id, id));
  if (!e || !canManageEvent(req.user, e)) throw notFound('Event not found');
  const { updated } = await updateEvent(req.user!, id, {
    title: e.title, description: e.description, category: e.category, venue: e.venue, city: e.city,
    startsAt: e.startsAt, endsAt: e.endsAt, pricePaise: e.pricePaise, capacity: e.capacity, upiId: e.upiId, status,
  });
  res.json({ event: updated });
});

eventsRouter.post('/:id/cancel', requireRole('organizer', 'admin'), async (req, res) => {
  await cancelEvent(req.user!, uuid(req.params.id));
  res.json({ ok: true });
});

eventsRouter.get('/:id/attendees', requireRole('organizer', 'admin'), async (req, res) => {
  const id = uuid(req.params.id);
  const [e] = await db.select().from(events).where(eq(events.id, id));
  if (!e || !canManageEvent(req.user, e)) throw notFound('Event not found');
  const rows = await db
    .select({
      id: tickets.id, ticketNumber: tickets.ticketNumber, used: tickets.used, checkedInAt: tickets.checkedInAt,
      attendee: users.name, email: users.email, reference: bookings.reference, quantity: bookings.quantity,
    })
    .from(tickets)
    .innerJoin(bookings, eq(bookings.id, tickets.bookingId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(and(eq(tickets.eventId, id), eq(tickets.status, 'CONFIRMED')))
    .orderBy(asc(users.name), asc(bookings.reference), asc(tickets.ticketNumber));
  res.json({
    event: { id: e.id, title: e.title, status: e.status },
    attendees: rows,
    checkedIn: rows.filter((r) => r.used).length,
  });
});

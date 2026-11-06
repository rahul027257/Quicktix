import { pgTable, pgEnum, uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

export const CATEGORIES = [
  'CONCERTS', 'SPORTS', 'MOVIES', 'COMEDY_SHOWS', 'WORKSHOPS',
  'CONFERENCES', 'FESTIVALS', 'EXHIBITIONS', 'COLLEGE_EVENTS', 'OTHERS',
] as const;

export const userRole = pgEnum('user_role', ['customer', 'organizer', 'admin']);
export const organizerRequestStatus = pgEnum('organizer_request_status', ['PENDING', 'APPROVED', 'REJECTED']);
export const eventCategory = pgEnum('event_category', CATEGORIES);
export const eventStatus = pgEnum('event_status', ['DRAFT', 'PUBLISHED', 'SOLD_OUT', 'CANCELLED', 'COMPLETED']);
export const reservationStatus = pgEnum('reservation_status', ['HELD', 'UNDER_REVIEW', 'CONVERTED', 'RELEASED', 'EXPIRED']);
export const bookingStatus = pgEnum('booking_status', [
  'AWAITING_PAYMENT', 'PENDING_ORGANIZER_VERIFICATION', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED',
]);
export const ticketStatus = pgEnum('ticket_status', ['PENDING_VERIFICATION', 'CONFIRMED', 'CANCELLED']);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('customer'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const organizerProfiles = pgTable('organizer_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  organizationName: text('organization_name').notNull(),
  description: text('description').notNull(),
  contactPhone: text('contact_phone').notNull(),
  website: text('website'),
  status: organizerRequestStatus('status').notNull().default('PENDING'),
  rejectionReason: text('rejection_reason'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: ts('reviewed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizerId: uuid('organizer_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  description: text('description').notNull(),
  category: eventCategory('category').notNull(),
  venue: text('venue').notNull(),
  city: text('city').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at'),
  pricePaise: integer('price_paise').notNull(),
  capacity: integer('capacity').notNull(),
  available: integer('available').notNull(),
  status: eventStatus('status').notNull().default('DRAFT'),
  bannerUrl: text('banner_url'),
  upiId: text('upi_id'),
  upiQrUrl: text('upi_qr_url'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const reservations = pgTable('reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  quantity: integer('quantity').notNull(),
  status: reservationStatus('status').notNull().default('HELD'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reference: text('reference').notNull().unique(),
  reservationId: uuid('reservation_id').notNull().unique().references(() => reservations.id),
  eventId: uuid('event_id').notNull().references(() => events.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  quantity: integer('quantity').notNull(),
  unitPricePaise: integer('unit_price_paise').notNull(),
  totalPaise: integer('total_paise').notNull(),
  status: bookingStatus('status').notNull().default('AWAITING_PAYMENT'),
  utr: text('utr'),
  screenshotPath: text('screenshot_path'),
  submittedAt: ts('submitted_at'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: ts('reviewed_at'),
  rejectionReason: text('rejection_reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id),
  eventId: uuid('event_id').notNull().references(() => events.id),
  ticketNumber: integer('ticket_number').notNull(),
  code: text('code').notNull().unique(),
  status: ticketStatus('status').notNull().default('PENDING_VERIFICATION'),
  used: boolean('used').notNull().default(false),
  checkedInAt: ts('checked_in_at'),
  checkedInBy: uuid('checked_in_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

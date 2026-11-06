-- QuickTix initial schema. Requires PostgreSQL 13+ (gen_random_uuid is built in).

CREATE TYPE user_role AS ENUM ('customer', 'organizer', 'admin');
CREATE TYPE organizer_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE event_category AS ENUM (
  'CONCERTS', 'SPORTS', 'MOVIES', 'COMEDY_SHOWS', 'WORKSHOPS',
  'CONFERENCES', 'FESTIVALS', 'EXHIBITIONS', 'COLLEGE_EVENTS', 'OTHERS'
);
CREATE TYPE event_status AS ENUM ('DRAFT', 'PUBLISHED', 'SOLD_OUT', 'CANCELLED', 'COMPLETED');
-- Inventory hold lifecycle. Only HELD rows are ever expired by the worker.
CREATE TYPE reservation_status AS ENUM ('HELD', 'UNDER_REVIEW', 'CONVERTED', 'RELEASED', 'EXPIRED');
-- Payment / commercial lifecycle.
CREATE TYPE booking_status AS ENUM (
  'AWAITING_PAYMENT', 'PENDING_ORGANIZER_VERIFICATION', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED'
);
CREATE TYPE ticket_status AS ENUM ('PENDING_VERIFICATION', 'CONFIRMED', 'CANCELLED');

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          user_role NOT NULL DEFAULT 'customer',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);

CREATE TABLE organizer_profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  organization_name text NOT NULL,
  description       text NOT NULL,
  contact_phone     text NOT NULL,
  website           text,
  status            organizer_request_status NOT NULL DEFAULT 'PENDING',
  rejection_reason  text,
  reviewed_by       uuid REFERENCES users(id),
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organizer_profiles_status_idx ON organizer_profiles (status, created_at);

CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES users(id),
  title        text NOT NULL,
  description  text NOT NULL,
  category     event_category NOT NULL,
  venue        text NOT NULL,
  city         text NOT NULL,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz,
  price_paise  integer NOT NULL,
  capacity     integer NOT NULL,
  available    integer NOT NULL,
  status       event_status NOT NULL DEFAULT 'DRAFT',
  banner_url   text,
  upi_id       text,
  upi_qr_url   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_price_min CHECK (price_paise >= 100),
  CONSTRAINT events_capacity_positive CHECK (capacity > 0),
  CONSTRAINT events_available_range CHECK (available >= 0 AND available <= capacity),
  CONSTRAINT events_end_after_start CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT events_live_needs_upi CHECK (
    status NOT IN ('PUBLISHED', 'SOLD_OUT') OR (upi_id IS NOT NULL AND upi_qr_url IS NOT NULL)
  )
);
CREATE INDEX events_status_starts_idx ON events (status, starts_at);
CREATE INDEX events_organizer_idx ON events (organizer_id);
CREATE INDEX events_city_idx ON events (lower(city));

CREATE TABLE reservations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES events(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  quantity   integer NOT NULL CHECK (quantity > 0),
  status     reservation_status NOT NULL DEFAULT 'HELD',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Drives the expiry worker: only unexpired-state HELD rows are indexed.
CREATE INDEX reservations_held_expiry_idx ON reservations (expires_at) WHERE status = 'HELD';
CREATE INDEX reservations_event_held_idx ON reservations (event_id) WHERE status = 'HELD';
-- A customer can have at most one active hold per event (race-free, enforced by the database).
CREATE UNIQUE INDEX reservations_one_hold_per_user_event ON reservations (event_id, user_id) WHERE status = 'HELD';

CREATE TABLE bookings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        text NOT NULL UNIQUE,
  reservation_id   uuid NOT NULL UNIQUE REFERENCES reservations(id),
  event_id         uuid NOT NULL REFERENCES events(id),
  user_id          uuid NOT NULL REFERENCES users(id),
  quantity         integer NOT NULL CHECK (quantity > 0),
  unit_price_paise integer NOT NULL CHECK (unit_price_paise > 0),
  total_paise      integer NOT NULL CHECK (total_paise > 0),
  status           booking_status NOT NULL DEFAULT 'AWAITING_PAYMENT',
  utr              text,
  screenshot_path  text,
  submitted_at     timestamptz,
  reviewed_by      uuid REFERENCES users(id),
  reviewed_at      timestamptz,
  rejection_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_utr_format CHECK (utr IS NULL OR utr ~ '^[0-9]{12}$'),
  CONSTRAINT bookings_total_matches CHECK (total_paise = unit_price_paise * quantity)
);
CREATE INDEX bookings_user_idx ON bookings (user_id, created_at DESC);
CREATE INDEX bookings_event_status_idx ON bookings (event_id, status);
CREATE INDEX bookings_status_submitted_idx ON bookings (status, submitted_at);
-- The same UTR cannot back two live bookings.
CREATE UNIQUE INDEX bookings_active_utr_idx ON bookings (utr)
  WHERE status IN ('PENDING_ORGANIZER_VERIFICATION', 'CONFIRMED');

CREATE TABLE tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  event_id      uuid NOT NULL REFERENCES events(id),
  ticket_number integer NOT NULL CHECK (ticket_number > 0),
  code          text NOT NULL UNIQUE,
  status        ticket_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  used          boolean NOT NULL DEFAULT false,
  checked_in_at timestamptz,
  checked_in_by uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, ticket_number),
  CONSTRAINT tickets_used_requires_confirmed CHECK (NOT used OR status = 'CONFIRMED'),
  CONSTRAINT tickets_checkin_consistent CHECK (used = (checked_in_at IS NOT NULL))
);
CREATE INDEX tickets_event_idx ON tickets (event_id);

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER organizer_profiles_updated_at BEFORE UPDATE ON organizer_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER events_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER reservations_updated_at BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

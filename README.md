# QuickTix

Event ticket booking where customers pay the organizer **directly by UPI** and the organizer verifies each payment by hand.

* **Backend:** Node 20+, TypeScript, Express 5, PostgreSQL, Drizzle ORM, hand-written SQL migrations
* **Frontend:** Next.js 15 (App Router), React 19, Tailwind CSS 3, Lucide icons, `html5-qrcode` scanner
* **Background work:** a PostgreSQL-backed expiry worker (no Redis needed)
* **Tickets:** per-ticket QR codes (`qrcode`) and server-rendered PDF passes (`pdfkit`)

\## Quick Start (Local Development)



\### Prerequisites

\- Node.js 20 or later

\- npm

\- PostgreSQL 13 or later



\### 1. Create the database



Create a PostgreSQL database named `quicktix` using pgAdmin or the PostgreSQL command line.



\### 2. Configure environment variables



```powershell

Copy-Item backend/.env.example backend/.env

Copy-Item frontend/.env.example frontend/.env

```



Update `backend/.env` with your PostgreSQL password and a secure JWT secret.



Generate a JWT secret:



```powershell

node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

```



\### 3. Install dependencies



```powershell

npm run setup

```



\### 4. Run database migrations



```powershell

npm run migrate

```



\### 5. Create an administrator account



```powershell

$env:ADMIN\_EMAIL = "admin@example.com"

$env:ADMIN\_PASSWORD = "your-strong-password"

npm run seed:admin

```



\### 6. Start QuickTix



```powershell

npm run dev

```



Open:

\- Frontend: http://localhost:3000

\- Backend: http://localhost:4000



\### Optional: Add demo data



```powershell

npm run seed:demo

```



Demo accounts:

\- Organizer: `organizer@quicktix.local`

\- Customer: `customer@quicktix.local`

\- Password: `DemoPass#2026`



Use demo credentials only for local development.



With `EMBED\_WORKER=true`, the API process also runs the expiry worker. In production, run it separately using `npm run worker`.



\## Docker



```bash

JWT\_SECRET=$(openssl rand -hex 32) docker compose up --build

docker compose run --rm -e ADMIN\_EMAIL=you@example.com -e ADMIN\_PASSWORD='a-long-passphrase' api node dist/scripts/seed-admin.js

```



Compose starts Postgres, runs migrations once, then starts the API, the worker and the web app. Set `COOKIE\_SECURE=true` and `PUBLIC\_URL=https://your.domain` when serving over HTTPS.



## \## How it works



### \### Roles

`customer` (every public sign-up), `organizer`, `admin`. The register endpoint ignores any `role` in the request. A customer submits organization details at `/become-organizer`; nothing changes until an admin approves it (Admin > Organizer requests). The role is re-read from the database on every request, so approval takes effect immediately.

### \### Booking lifecycle

```
Book Ticket ─► HELD (10 min) ─► submit UTR + screenshot ─► UNDER\_REVIEW ─► Verify \& Confirm ─► CONVERTED  (booking CONFIRMED, tickets valid)
     │              │                                            └────────► Reject \& Release ─► RELEASED   (inventory restored)
     │              ├─ customer cancels / leaves checkout ─────────────────► RELEASED
     │              └─ 10 minutes pass ────────────────────────────────────► EXPIRED   (inventory restored)
```

Two tables share one lifecycle: `reservations` owns the inventory hold (HELD, UNDER\_REVIEW, CONVERTED, RELEASED, EXPIRED) and `bookings` owns the payment record (AWAITING\_PAYMENT, PENDING\_ORGANIZER\_VERIFICATION, CONFIRMED, REJECTED, EXPIRED, CANCELLED).

### \### Concurrency and inventory

* `POST /api/bookings/reserve` runs in one transaction that takes `SELECT … FOR UPDATE` on the event row, so competing buyers are serialised and `available` can never go below zero. A `CHECK` constraint backs this up.
* A partial unique index allows only one active hold per customer per event.
* **Lock order is always event first, then reservation/booking**, which rules out deadlocks.
* The worker (every 60 s) finds `status = 'HELD' AND expires\_at < now()`, claims rows with `FOR UPDATE SKIP LOCKED`, marks them `EXPIRED` and restores inventory in the same transaction. A reservation can leave `HELD` only once, so restoring is exactly-once even with several workers. `UNDER\_REVIEW` rows are never touched, so a hold survives manual review. Reservations are also swept inline whenever someone books that event, so inventory is right even if the worker is down.
* Expiry uses the database clock, and the countdown is computed against the server's time, so a wrong device clock gains nothing.
* Leaving checkout releases the hold: explicit Cancel, in-app navigation, and `sendBeacon` on `pagehide`. Opening the UPI app link deliberately skips the release, because on mobile that navigation would otherwise cancel the booking you are about to pay for. The 10-minute expiry is the backstop.

### \### Payments

Each event stores its own UPI ID and UPI QR image. Checkout shows the QR, the UPI ID, the exact amount and a `upi://pay` deep link. The customer submits a 12-digit UTR (optionally a screenshot; set `REQUIRE\_PAYMENT\_SCREENSHOT=true` to make it mandatory). A unique index prevents the same UTR backing two live bookings. Screenshots are stored privately and served only to the buyer, the event's organizer and admins.

### \### Tickets and entry

Submitting proof creates N ticket rows (one QR each). Codes are 144-bit random values and are only revealed to the buyer once the booking is confirmed. The scanner (`/organizer/check-in`) posts the decoded code to `POST /api/tickets/verify-scan`, which claims the ticket with a **single atomic `UPDATE … WHERE status = 'CONFIRMED' AND used = false`**. Outcomes: `VALID\_ENTRY`, `ALREADY\_USED` (with the first check-in time), `PAYMENT\_UNVERIFIED`, `TICKET\_INVALID`, `WRONG\_EVENT`. Scanning one ticket never touches the others in the booking.

## \### API summary

|Area|Endpoints|
|-|-|
|Auth|`POST /api/auth/register`, `login`, `logout`, `GET /me`, `POST /organizer-request`|
|Events|`GET /api/events` (q, category, city, from, to, minPrice, maxPrice, sort, page), `GET /api/events/:id`, `POST/PUT /api/events` (multipart: `banner`, `upiQr`), `POST /:id/status`, `POST /:id/cancel`, `GET /:id/attendees`|
|Bookings|`POST /api/bookings/reserve`, `GET /mine`, `GET /:id`, `POST /:id/cancel`, `POST /:id/submit-proof`, `POST /:id/approve`, `POST /:id/reject`, `GET /:id/pdf`, `GET /:id/screenshot`|
|Tickets|`POST /api/tickets/verify-scan`|
|Organizer|`GET /api/organizer/events`, `GET /api/organizer/approvals`|
|Admin|`GET /api/admin/stats`, `organizer-requests` (+ `approve`/`reject`), `events`, `bookings`|

Errors are `{ "error": { "code", "message", "details" } }`.

## \### Configuration (backend/.env)

|Variable|Default|Notes|
|-|-|-|
|`DATABASE\_URL`|none|required|
|`JWT\_SECRET`|none|required, 32+ characters|
|`ALLOWED\_ORIGINS`|`http://localhost:3000`|comma-separated; also used for CSRF origin checks|
|`COOKIE\_SECURE`|`true` in production|set `false` only for plain-HTTP testing|
|`HOLD\_MINUTES`|`10`|reservation window|
|`WORKER\_INTERVAL\_SECONDS`|`60`||
|`EMBED\_WORKER`|`false`|run the worker inside the API process|
|`MAX\_TICKETS\_PER\_BOOKING`|`10`||
|`REQUIRE\_PAYMENT\_SCREENSHOT`|`false`||
|`UPLOAD\_DIR`|`./uploads`|`public/` (banners, UPI QRs) and `private/` (payment proofs)|

`frontend/.env`: `BACKEND\_URL` (default `http://localhost:4000`). Next.js proxies `/api` and `/uploads` to it, so the browser only talks to one origin and session cookies stay first-party.

## \### Tests

```bash
createdb quicktix\_test
npm test        # uses TEST\_DATABASE\_URL or postgresql://postgres:postgres@localhost:5432/quicktix\_test
```

The suite runs against a real PostgreSQL database (it refuses to reset any database whose name does not end in `\_test`) and covers: role rules, 15 buyers racing for 5 tickets, concurrent worker runs expiring a hold exactly once, holds under review surviving expiry, the full reserve/pay/approve/PDF/scan journey, simultaneous scans of one ticket, UTR de-duplication, reject-and-release, event cancellation and discovery filters.

## \### Production notes and known limits

* Serve over HTTPS. Browsers only allow camera access (the scanner) on HTTPS or localhost.
* Uploads live on local disk. For more than one API instance, mount shared storage or swap `lib/upload.ts` for S3-compatible storage.
* Payments are verified by people, not by a bank API. The system cannot confirm that money arrived; organizers must match each UTR against their UPI app.
* Cancelling an event releases held tickets but does not refund paid bookings. Refunds happen outside QuickTix, and pending bookings stay in the organizer's queue.
* Ticket price must be at least ₹1 (free events are not supported).
* PDF passes use PDFKit's built-in Latin fonts, so non-Latin event titles print as `?`. Embed a Unicode font in `lib/pdf.ts` if you need Hindi or other scripts.
* Event dates are entered and shown in India time (`Asia/Kolkata`).

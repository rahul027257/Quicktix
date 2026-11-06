import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { sql } from 'drizzle-orm';
import { config } from './config';
import { db } from './db/client';
import { attachUser, originGuard } from './lib/auth';
import { AppError, errorHandler } from './lib/errors';
import { publicUploadsDir } from './lib/upload';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { bookingsRouter } from './routes/bookings';
import { eventsRouter } from './routes/events';
import { organizerRouter } from './routes/organizer';
import { ticketsRouter } from './routes/tickets';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.allowedOrigins, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));
  app.use(originGuard);
  app.use(attachUser);

  app.use('/uploads', express.static(publicUploadsDir(), { maxAge: '7d', index: false, dotfiles: 'deny' }));

  app.get('/api/health', async (_req, res) => {
    await db.execute(sql`SELECT 1`);
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/tickets', ticketsRouter);
  app.use('/api/organizer', organizerRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Unknown endpoint')));
  app.use(errorHandler);
  return app;
}

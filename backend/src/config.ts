import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const flag = (def: string) => z.string().default(def).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  COOKIE_SECURE: z.string().optional(),
  UPLOAD_DIR: z.string().default('./uploads'),
  HOLD_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(60),
  EMBED_WORKER: flag('false'),
  MAX_TICKETS_PER_BOOKING: z.coerce.number().int().min(1).max(50).default(10),
  REQUIRE_PAYMENT_SCREENSHOT: flag('false'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  uploadRoot: path.resolve(env.UPLOAD_DIR),
  timezone: 'Asia/Kolkata',
};

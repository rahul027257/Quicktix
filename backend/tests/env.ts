import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/quicktix_test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'quicktix-test-uploads');
process.env.HOLD_MINUTES = '10';
process.env.EMBED_WORKER = 'false';
process.env.REQUIRE_PAYMENT_SCREENSHOT = 'false';

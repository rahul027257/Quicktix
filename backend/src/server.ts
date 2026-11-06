import { config } from './config';
import { pool } from './db/client';
import { createApp } from './app';
import { startWorker } from './worker';

const app = createApp();
const server = app.listen(config.PORT, () => console.log(`QuickTix API listening on :${config.PORT}`));
const stopWorker = config.EMBED_WORKER ? startWorker() : () => undefined;

const shutdown = () => {
  stopWorker();
  server.close(async () => {
    await pool.end().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

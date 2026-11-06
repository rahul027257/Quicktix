import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { config } from '../config';

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 20 });
pool.on('error', (err) => console.error('Unexpected Postgres pool error', err));

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { users } from '../db/schema';

/**
 * Creates the initial Super Admin. Credentials come from the environment, never from source code:
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-passphrase' npm run seed:admin
 * Safe to re-run: an existing account is promoted to admin but its password is never overwritten.
 */
async function main() {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const name = (process.env.ADMIN_NAME ?? 'Super Admin').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Set ADMIN_EMAIL to a valid email address');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  if (password.length > 72) throw new Error('ADMIN_PASSWORD must be 72 characters or fewer (bcrypt limit)');

  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    if (existing.role !== 'admin') await db.update(users).set({ role: 'admin' }).where(eq(users.id, existing.id));
    console.log(`${email} already exists${existing.role === 'admin' ? ' as admin' : '; promoted to admin'}. Password left unchanged.`);
  } else {
    await db.insert(users).values({ name, email, passwordHash: await bcrypt.hash(password, 12), role: 'admin' });
    console.log(`Created admin account for ${email}`);
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err.message ?? err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });

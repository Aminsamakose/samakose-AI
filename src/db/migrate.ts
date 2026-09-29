import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { db, closeDb } from './client';

export async function runMigrations() {
  await migrate(db(), { migrationsFolder: path.join(process.cwd(), 'migrations') });
}

if (require.main === module || process.argv[1]?.endsWith('migrate.ts')) {
  runMigrations().then(() => { console.log('Migrations applied'); return closeDb(); }).catch((e) => { console.error(e); process.exit(1); });
}

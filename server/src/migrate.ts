import fs from 'node:fs';
import path from 'node:path';
import { pool } from './db.js';
import { config } from './config.js';

export async function migrate(log = true) {
  const dir = path.join(config.rootDir, 'migrations');
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations(name) values ($1)', [f]);
      await client.query('commit');
      if (log) console.log(`migración aplicada: ${f}`);
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}

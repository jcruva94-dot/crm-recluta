import pg from 'pg';

export default async function () {
  process.env.VITEST = 'true';
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://crm:crm_dev@localhost:5432/crm_recluta_test';
  if (!/test/.test(url)) throw new Error('La base de pruebas debe contener "test" en su nombre');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('drop schema public cascade; create schema public;');
  await c.end();
  const { seedBase } = await import('../src/seed.js');
  const { pool } = await import('../src/db.js');
  await seedBase();
  await pool.end();
}

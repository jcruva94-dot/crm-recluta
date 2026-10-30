import { describe, it, expect } from 'vitest';
import { pool, staff } from './helpers.js';
import { seedDemoActivity } from '../src/demo-activity.js';

describe('actividad de demostración', () => {
  it('crea postulaciones marcadas como DEMO, coherentes con el historial y una sola vez', async () => {
    expect(await seedDemoActivity(30)).toBe(true);
    expect(await seedDemoActivity(30)).toBe(false);
    const r = (await pool.query(`select count(*)::int n, count(*) filter (where not c.is_demo or c.last_name not like '%(DEMO)' or c.email not like '%@ejemplo.test')::int bad
      from applications a join candidates c on c.id = a.candidate_id where a.is_demo`)).rows[0];
    expect(r.n).toBe(30);
    expect(r.bad).toBe(0);
    // La etapa actual de cada postulación es la última del historial
    const mismatch = (await pool.query(`select count(*)::int n from applications a where a.is_demo and a.stage_code <>
      (select to_code from stage_history h where h.application_id = a.id order by created_at desc, id desc limit 1)`)).rows[0].n;
    expect(mismatch).toBe(0);
    // Nada queda en el futuro
    expect((await pool.query(`select count(*)::int n from stage_history where created_at > now()`)).rows[0].n).toBe(0);
    const d = (await (await staff('admin@demo.test')).get('/api/admin/dashboard?from=2026-01-01&to=2030-01-01')).body;
    expect(d.totals.postulaciones).toBeGreaterThanOrEqual(30);
  });
});

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

describe('mi día del reclutador', () => {
  it('solo muestra lo asignado al usuario y cuadra con la base', async () => {
    const r1 = await staff('reclutador1@demo.test');
    const res = await r1.get('/api/admin/my-day');
    expect(res.status).toBe(200);
    const me = (await pool.query(`select id from users where email = 'reclutador1@demo.test'`)).rows[0].id;
    const ids = res.body.toContact.map((x: any) => x.id);
    if (ids.length) {
      const other = (await pool.query(`select count(*)::int n from applications where id = any($1) and recruiter_id is distinct from $2`, [ids, me])).rows[0].n;
      expect(other).toBe(0);
    }
    const open = (await pool.query(`select count(*)::int n from tasks where assignee_id = $1 and status in ('pendiente','en_proceso')`, [me])).rows[0].n;
    expect(res.body.tasks.open).toBe(open);
    expect(res.body.tasks.top.length).toBeLessThanOrEqual(6);
    const active = (await pool.query(`select count(*)::int n from applications a join pipeline_stages ps on ps.code = a.stage_code where a.recruiter_id = $1 and ps.category = 'activo'`, [me])).rows[0].n;
    expect(res.body.pipeline.reduce((s: number, p: any) => s + p.total, 0)).toBe(active);
    // Otro reclutador no ve los pendientes de Rocío
    const r2 = (await (await staff('reclutador2@demo.test')).get('/api/admin/my-day')).body;
    expect(r2.toContact.filter((x: any) => ids.includes(x.id))).toHaveLength(0);
  });
});

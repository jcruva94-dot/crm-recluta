import { describe, it, expect } from 'vitest';
import { staff, compatibleCandidate, applyCandidate, pool } from './helpers.js';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

describe('indicadores calculados con datos reales', () => {
  it('candidatos únicos ≠ postulaciones; oferta aceptada ≠ ingreso efectivo', async () => {
    const admin = await staff('admin@demo.test');
    // Segunda vacante para que la misma persona tenga dos postulaciones
    const rec = (await pool.query(`select id from users where email = 'reclutador2@demo.test'`)).rows[0].id;
    const v = await admin.post('/api/admin/vacancies', { title: 'Cobranza (KPI test)', modality: 'hibrido', positions: 2, hireGoal: 2, summary: 'Cobranza', requirements: ['Experiencia'], recruiterIds: [rec] });
    const src = (await pool.query(`select id from sources where code = 'referidos'`)).rows[0].id;
    await admin.post(`/api/admin/vacancies/${v.body.id}/links`, { sourceId: src, code: 'kpi-cobranza' });
    await admin.post(`/api/admin/vacancies/${v.body.id}/status`, { status: 'publicada' });

    const f = `from=${today()}&to=${today()}`;
    const before = (await admin.get(`/api/admin/dashboard?${f}`)).body.totals;

    const c = await compatibleCandidate();
    const second = await applyCandidate({ phone: c.phone, link: 'kpi-cobranza' });
    expect(second.resumed).toBe(false);

    const after = (await admin.get(`/api/admin/dashboard?${f}`)).body;
    expect(after.totals.postulaciones - before.postulaciones).toBe(2);
    expect(after.totals.candidatos_unicos - before.candidatos_unicos).toBe(1);
    // La tendencia diaria cuadra con el total del periodo
    expect(after.daily).toHaveLength(1);
    expect(after.daily[0].dia).toBe(today());
    expect(after.daily[0].postulaciones).toBe(after.totals.postulaciones);

    // Llevamos la postulación hasta oferta aceptada por la vía de excepción autorizada
    const g = await staff('gerente@demo.test');
    const move = (to: string, from: string) => g.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: to, expectedStage: from, override: true, reason: 'Prueba de indicadores' });
    expect((await move('oferta', 'contacto_pendiente')).status).toBe(200);
    expect((await move('oferta_aceptada', 'oferta')).status).toBe(200);
    let d = (await admin.get(`/api/admin/dashboard?${f}`)).body.totals;
    expect(d.ofertas_aceptadas - before.ofertas_aceptadas).toBe(1);
    expect(d.contrataciones - before.contrataciones).toBe(0);
    expect(d.ingresos_efectivos - before.ingresos_efectivos).toBe(0);
    expect((await move('contratacion_confirmada', 'oferta_aceptada')).status).toBe(200);
    d = (await admin.get(`/api/admin/dashboard?${f}`)).body.totals;
    expect(d.contrataciones - before.contrataciones).toBe(1);
    expect(d.ingresos_efectivos - before.ingresos_efectivos).toBe(0);
  });

  it('cada KPI trae definición y las conversiones traen numerador y denominador', async () => {
    const d = (await (await staff('director@demo.test')).get(`/api/admin/dashboard?from=${today()}&to=${today()}`)).body;
    expect(d.definitions.conv_agenda.formula).toContain('/');
    for (const k of Object.keys(d.conversions)) {
      expect(d.conversions[k]).toHaveProperty('num');
      expect(d.conversions[k]).toHaveProperty('den');
      expect(d.definitions[k]).toBeTruthy();
    }
    expect(d.byStage.length).toBe(23);
  });

  it('el dashboard respeta el alcance del usuario', async () => {
    const r3 = (await (await staff('reclutador3@demo.test')).get(`/api/admin/dashboard?from=${today()}&to=${today()}`)).body;
    expect(r3.totals.postulaciones).toBe(0);
  });

  it('alertas de estancamiento usan el SLA de la etapa', async () => {
    const c = await compatibleCandidate();
    await pool.query(`update applications set stage_entered_at = now() - interval '3 days' where id = $1`, [c.applicationId]);
    const al = (await (await staff('gerente@demo.test')).get('/api/admin/alerts')).body.alerts;
    const stalled = al.find((a: any) => a.type === 'estancados');
    expect(stalled).toBeTruthy();
    expect(stalled.evidence.some((e: any) => e.id === c.applicationId)).toBe(true);
    expect(stalled.suggestion).toBeTruthy();
  });
});

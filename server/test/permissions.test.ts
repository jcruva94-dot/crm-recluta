import { describe, it, expect } from 'vitest';
import { Agent, getApp, staff, compatibleCandidate, applyCandidate, pool } from './helpers.js';

describe('seguridad y permisos', () => {
  it('un candidato no puede ver ni modificar la postulación de otro (IDOR)', async () => {
    const a = await applyCandidate();
    const b = await applyCandidate();
    expect((await b.agent.get(`/api/portal/applications/${a.applicationId}`)).status).toBe(404);
    expect((await b.agent.put(`/api/portal/applications/${a.applicationId}/answers`, { answers: {} })).status).toBe(404);
    expect((await b.agent.post(`/api/portal/applications/${a.applicationId}/withdraw`, {})).status).toBe(404);
    expect((await b.agent.get(`/api/portal/applications/no-es-uuid`)).status).toBe(404);
  });

  it('un candidato no puede manipular la cita de otro', async () => {
    const a = await compatibleCandidate();
    const slots = (await a.agent.get(`/api/portal/applications/${a.applicationId}/slots`)).body.slots;
    const booked = await a.agent.post(`/api/portal/applications/${a.applicationId}/interviews`, { slotId: slots[0].id });
    const iid = booked.body.interviews[0].id;
    const b = await applyCandidate();
    expect((await b.agent.post(`/api/portal/interviews/${iid}/cancel`, { reason: 'ataque' })).status).toBe(404);
    expect((await b.agent.post(`/api/portal/interviews/${iid}/confirm`)).status).toBe(404);
  });

  it('las peticiones que modifican datos exigen cabecera anti-CSRF', async () => {
    const app = await getApp();
    const r = await app.inject({ method: 'POST', url: '/api/public/apply/start', payload: {} });
    expect(r.statusCode).toBe(403);
    const adm = await staff('admin@demo.test');
    const bad = await adm.req('POST', '/api/admin/clients', { name: 'X' }, { 'x-csrf-token': 'falso' });
    expect(bad.status).toBe(403);
  });

  it('login de staff: credenciales incorrectas y bloqueo tras 5 intentos', async () => {
    const a = new Agent(await getApp());
    for (let i = 0; i < 5; i++) expect((await a.post('/api/admin/auth/login', { email: 'reclutador3@demo.test', password: 'mala' })).status).toBe(401);
    const locked = await a.post('/api/admin/auth/login', { email: 'reclutador3@demo.test', password: 'Demo-2026!' });
    expect(locked.status).toBe(423);
    await pool.query(`update users set locked_until = null where email = 'reclutador3@demo.test'`);
    const hash = (await pool.query(`select password_hash from users where email = 'admin@demo.test'`)).rows[0].password_hash;
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('endpoints administrativos sin sesión responden 401', async () => {
    const a = new Agent(await getApp());
    for (const url of ['/api/admin/applications', '/api/admin/vacancies', '/api/admin/dashboard?from=2026-01-01&to=2026-12-31', '/api/admin/audit', '/api/admin/tasks', '/api/admin/messages']) {
      expect((await a.get(url)).status, url).toBe(401);
    }
  });

  it('matriz de permisos por rol en endpoints sensibles', async () => {
    const c = await compatibleCandidate();
    const cases: [string, string, string, any, number[]][] = [
      // [rol, método, url, body, estados aceptados]
      ['auditor', 'POST', `/api/admin/applications/${c.applicationId}/move`, { toStage: 'rechazado', expectedStage: 'contacto_pendiente' }, [403]],
      ['director', 'POST', `/api/admin/applications/${c.applicationId}/move`, { toStage: 'rechazado', expectedStage: 'contacto_pendiente' }, [403]],
      ['entrevistador', 'GET', `/api/admin/applications/${c.applicationId}`, null, [404]],
      ['reclutador3', 'GET', `/api/admin/applications/${c.applicationId}`, null, [404]], // otro equipo, no asignada
      ['reclutador1', 'GET', '/api/admin/audit', null, [403]],
      ['reclutador1', 'GET', '/api/admin/applications/export.csv', null, [403]],
      ['reclutador1', 'POST', '/api/admin/vacancies', { title: 'No permitido', modality: 'remoto', positions: 1, hireGoal: 1 }, [403]],
      ['coordinador', 'POST', '/api/admin/clients', { name: 'No permitido' }, [403]],
      ['auditor', 'GET', '/api/admin/audit', null, [200]],
      ['director', 'GET', '/api/admin/applications/export.csv', null, [200]],
      ['gerente', 'GET', `/api/admin/applications/${c.applicationId}`, null, [200]],
    ];
    for (const [who, method, url, body, ok] of cases) {
      const ag = await staff(`${who}@demo.test`.replace(/^(reclutador\d)@/, '$1@'));
      const r = await ag.req(method, url, body ?? undefined);
      expect(ok, `${who} ${method} ${url} -> ${r.status}`).toContain(r.status);
    }
  });

  it('el entrevistador no ve datos de contacto y el auditor los ve enmascarados', async () => {
    const c = await compatibleCandidate();
    const rec = await staff('reclutador1@demo.test');
    const slots = (await rec.get(`/api/admin/applications/${c.applicationId}/slots`)).body.slots;
    const b = await rec.post(`/api/admin/applications/${c.applicationId}/interviews`, { slotId: slots[0].id });
    expect(b.status).toBe(200);
    const int = await staff('entrevistador@demo.test');
    const v = await int.get(`/api/admin/applications/${c.applicationId}`);
    expect(v.status).toBe(200);
    expect(v.body.candidate.phone).toBeNull();
    expect(v.body.candidate.email).toBeNull();
    expect(v.body.consents).toEqual([]);
    const aud = await staff('auditor@demo.test');
    const va = await aud.get(`/api/admin/applications/${c.applicationId}`);
    expect(va.body.candidate.phone).toMatch(/•/);
    // El entrevistador no puede mover etapas
    const mv = await int.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: 'rechazado', expectedStage: 'entrevista_agendada' });
    expect(mv.status).toBe(403);
  });

  it('un reclutador solo lista postulaciones de su alcance', async () => {
    const r3 = await staff('reclutador3@demo.test');
    const list = await r3.get('/api/admin/applications');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0);
    const r1 = await staff('reclutador1@demo.test');
    expect((await r1.get('/api/admin/applications')).body.total).toBeGreaterThan(0);
  });

  it('las consultas de expediente y exportaciones quedan en auditoría', async () => {
    const c = await compatibleCandidate();
    const g = await staff('gerente@demo.test');
    await g.get(`/api/admin/applications/${c.applicationId}`);
    const exp = await g.get('/api/admin/applications/export.csv');
    expect(exp.raw.headers['content-type']).toContain('text/csv');
    const log = (await pool.query(`select action from audit_log where actor_id = (select id from users where email = 'gerente@demo.test') order by id desc limit 5`)).rows.map((r) => r.action);
    expect(log).toContain('application.view');
    expect(log).toContain('export.applications');
  });

  it('no se aceptan preguntas sobre datos protegidos ni indispensables sin justificación', async () => {
    const g = await staff('gerente@demo.test');
    const vid = (await pool.query(`select id from vacancies where slug = 'asesor-ventas-telefonicas'`)).rows[0].id;
    const p1 = await g.post(`/api/admin/vacancies/${vid}/questions`, { text: '¿Cuál es tu estado civil?', type: 'yes_no', weight: 0 });
    expect(p1.status).toBe(400);
    const p2 = await g.post(`/api/admin/vacancies/${vid}/questions`, { text: '¿Tienes experiencia en cobranza?', type: 'yes_no', isKnockout: true, options: [{ value: 'si', label: 'Sí', score: 100 }, { value: 'no', label: 'No', knockout: true }] });
    expect(p2.status).toBe(400);
    expect(JSON.stringify(p2.body.fields)).toContain('justification');
  });
});

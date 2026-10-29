import { describe, it, expect } from 'vitest';
import { Agent, getApp, applyCandidate, completeRegistration, answersFor, compatibleCandidate, uniquePhone, staff, pool } from './helpers.js';

describe('flujo del candidato (extremo a extremo vía API)', () => {
  it('liga → registro → OTP → aviso → precalificación → agenda → reprogramación → confirmación', async () => {
    const app = await getApp();
    const visitor = new Agent(app);
    const landing = await visitor.get('/api/public/links/ventas-fb');
    expect(landing.status).toBe(200);
    expect(landing.body.vacancy.title).toContain('Asesor');
    expect(landing.body.vacancy.accepting).toBe(true);
    expect(landing.body.vacancy).not.toHaveProperty('threshold_compatible');

    const { agent, applicationId, resumed } = await applyCandidate();
    expect(resumed).toBe(false);
    let view = (await agent.get(`/api/portal/applications/${applicationId}`)).body;
    expect(view.nextStep).toBe('registro');

    view = await completeRegistration(agent, applicationId);
    expect(view.nextStep).toBe('precalificacion');
    expect(view.questions.length).toBe(6);
    // Las opciones no exponen puntuaciones ni marcas de descarte
    expect(JSON.stringify(view.questions)).not.toMatch(/score|knockout|weight/);

    // Guardado parcial y "continuar más tarde"
    const ans = await answersFor(view);
    const firstId = Object.keys(ans)[0];
    expect((await agent.put(`/api/portal/applications/${applicationId}/answers`, { answers: { [firstId]: ans[firstId] } })).status).toBe(200);
    const incomplete = await agent.post(`/api/portal/applications/${applicationId}/prequal/submit`);
    expect(incomplete.status).toBe(400);
    const reloaded = (await agent.get(`/api/portal/applications/${applicationId}`)).body;
    expect(reloaded.answers[firstId]).toBe(ans[firstId]);

    await agent.put(`/api/portal/applications/${applicationId}/answers`, { answers: ans });
    const done = await agent.post(`/api/portal/applications/${applicationId}/prequal/submit`);
    expect(done.status).toBe(200);
    expect(done.body.resultMessage.kind).toBe('agendar');
    expect(JSON.stringify(done.body)).not.toMatch(/prequal_score|"score"/);
    expect(done.body.nextStep).toBe('agendar');

    const slots = (await agent.get(`/api/portal/applications/${applicationId}/slots`)).body.slots;
    expect(slots.length).toBeGreaterThan(2);
    const booked = await agent.post(`/api/portal/applications/${applicationId}/interviews`, { slotId: slots[0].id });
    expect(booked.status).toBe(200);
    expect(booked.body.nextStep).toBe('cita');
    const interviewId = booked.body.interviews[0].id;

    // No puede tener dos citas pendientes
    const again = await agent.post(`/api/portal/applications/${applicationId}/interviews`, { slotId: slots[1].id });
    expect(again.status).toBe(400);

    const resch = await agent.post(`/api/portal/interviews/${interviewId}/reschedule`, { slotId: slots[1].id });
    expect(resch.status).toBe(200);
    const newInterview = resch.body.interviews.find((i: any) => i.status === 'agendada');
    expect(new Date(newInterview.starts_at).toISOString()).toBe(new Date(slots[1].startsAt).toISOString());
    // El horario original queda libre otra vez
    const slots2 = (await agent.get(`/api/portal/applications/${applicationId}/slots`)).body.slots;
    expect(slots2.some((s: any) => s.id === slots[0].id)).toBe(true);

    const conf = await agent.post(`/api/portal/interviews/${newInterview.id}/confirm`);
    expect(conf.body.interviews[0].status).toBe('confirmada');

    // Trazabilidad: historial de etapas completo
    const hist = (await pool.query('select from_code, to_code, actor_type from stage_history where application_id = $1 order by id', [applicationId])).rows;
    expect(hist.map((h) => h.to_code)).toEqual(['nuevo_prospecto', 'registro_iniciado', 'registro_completado', 'precalificacion_pendiente', 'precalificacion_completada', 'contacto_pendiente', 'entrevista_agendada']);
    // Mensajes quedan como simulados, nunca como enviados
    const msgs = (await pool.query(`select status from outbox_messages m join applications a on a.candidate_id = m.candidate_id where a.id = $1`, [applicationId])).rows;
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.every((m) => m.status === 'simulado')).toBe(true);
    // Consentimiento registrado con versión del aviso
    const cons = (await pool.query(`select k.* from consents k join applications a on a.candidate_id = k.candidate_id where a.id = $1 and purpose = 'aviso_privacidad'`, [applicationId])).rows;
    expect(cons).toHaveLength(1);
  });

  it('candidato que no cumple un indispensable va a revisión humana (no se rechaza solo)', async () => {
    const c = await applyCandidate();
    const view = await completeRegistration(c.agent, c.applicationId);
    const ans = await answersFor(view, { '¿Puedes trabajar de forma presencial en Av. Insurgentes, CDMX?': 'no' });
    await c.agent.put(`/api/portal/applications/${c.applicationId}/answers`, { answers: ans });
    const r = await c.agent.post(`/api/portal/applications/${c.applicationId}/prequal/submit`);
    expect(r.body.resultMessage.kind).toBe('revision');
    expect(r.body.resultMessage.text).toContain('presencial');
    const a = (await pool.query('select stage_code, prequal_result, prequal_explanation from applications where id = $1', [c.applicationId])).rows[0];
    expect(a.stage_code).toBe('revision_compatibilidad');
    expect(a.prequal_result).toBe('no_cumple');
    expect(a.prequal_explanation.criteria.length).toBe(6);
    // No puede autoagendar
    const book = await c.agent.get(`/api/portal/applications/${c.applicationId}/slots`);
    expect(book.body.slots).toEqual([]);
  });

  it('el OTP se valida en el backend: código incorrecto, intentos máximos y vencimiento', async () => {
    const a = new Agent(await getApp());
    const start = await a.post('/api/public/apply/start', { linkCode: 'ventas-fb', firstName: 'Otp', lastName: 'Prueba', phone: uniquePhone(), channel: 'sms' });
    const wrong = start.body.devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await a.post('/api/public/otp/verify', { challengeId: start.body.challengeId, code: wrong });
      expect(r.status).toBe(400);
    }
    const locked = await a.post('/api/public/otp/verify', { challengeId: start.body.challengeId, code: start.body.devCode });
    expect(locked.status).toBe(429);
    expect(a.cookies.has('cand_sid')).toBe(false);

    const s2 = await a.post('/api/public/apply/start', { linkCode: 'ventas-fb', firstName: 'Otp', lastName: 'Prueba', phone: uniquePhone(), channel: 'sms' });
    await pool.query(`update otp_challenges set expires_at = now() - interval '1 minute' where id = $1`, [s2.body.challengeId]);
    const expired = await a.post('/api/public/otp/verify', { challengeId: s2.body.challengeId, code: s2.body.devCode });
    expect(expired.status).toBe(400);
    expect(expired.body.message).toMatch(/venció/);
    // El código no se guarda en claro
    const row = (await pool.query('select code_hash from otp_challenges where id = $1', [s2.body.challengeId])).rows[0];
    expect(row.code_hash).not.toContain(s2.body.devCode);
  });

  it('limita el envío de códigos por destino', async () => {
    const a = new Agent(await getApp());
    const phone = uniquePhone();
    const body = { linkCode: 'ventas-fb', firstName: 'Rate', lastName: 'Limit', phone, channel: 'sms' };
    for (let i = 0; i < 3; i++) expect((await a.post('/api/public/apply/start', body)).status).toBe(200);
    expect((await a.post('/api/public/apply/start', body)).status).toBe(429);
  });

  it('el portal no funciona sin sesión verificada', async () => {
    const a = new Agent(await getApp());
    expect((await a.get('/api/portal/me')).status).toBe(401);
  });

  it('continuar más tarde: login con OTP recupera la misma postulación', async () => {
    const c = await applyCandidate();
    const other = new Agent(await getApp());
    const s = await other.post('/api/public/login/start', { identifier: c.phone, channel: 'sms' });
    expect(s.status).toBe(200);
    const v = await other.post('/api/public/otp/verify', { challengeId: s.body.challengeId, code: s.body.devCode });
    expect(v.status).toBe(200);
    const me = await other.get('/api/portal/me');
    expect(me.body.applications.map((x: any) => x.id)).toContain(c.applicationId);
  });

  it('login con identificador inexistente no revela si existe', async () => {
    const a = new Agent(await getApp());
    const r = await a.post('/api/public/login/start', { identifier: uniquePhone() });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('challengeId');
    expect(r.body.devCode).toBeUndefined();
    const v = await a.post('/api/public/otp/verify', { challengeId: r.body.challengeId, code: '123456' });
    expect(v.status).toBe(400);
  });

  it('duplicados: misma persona y misma vacante recupera el proceso; correo de otra persona va a revisión', async () => {
    const first = await applyCandidate({ email: `dup${Date.now()}@ejemplo.test` });
    const again = await applyCandidate({ phone: first.phone, link: 'ventas-rocio' });
    expect(again.resumed).toBe(true);
    expect(again.applicationId).toBe(first.applicationId);
    const n = (await pool.query(`select count(*)::int n from candidates where phone_e164 = $1`, ['+52' + first.phone])).rows[0].n;
    expect(n).toBe(1);
    // Última fuente de contacto actualizada, fuente original intacta
    const a = (await pool.query(`select s1.code first, s2.code last from applications a join sources s1 on s1.id = a.first_source_id join sources s2 on s2.id = a.last_source_id where a.id = $1`, [first.applicationId])).rows[0];
    expect(a).toEqual({ first: 'facebook', last: 'whatsapp' });

    const email = (await pool.query('select email from candidates c join applications a on a.candidate_id = c.id where a.id = $1', [first.applicationId])).rows[0].email;
    const otherPerson = await applyCandidate({ email });
    expect(otherPerson.applicationId).not.toBe(first.applicationId);
    const d = (await pool.query(`select * from duplicate_reviews where match_on = 'correo' and matched_candidate_id = (select candidate_id from applications where id = $1)`, [first.applicationId])).rows;
    expect(d).toHaveLength(1);
    expect(d[0].status).toBe('pendiente');
  });

  it('candidato sin correo puede registrarse por teléfono', async () => {
    const c = await applyCandidate({ email: null });
    const me = await c.agent.get('/api/portal/me');
    expect(me.body.candidate.email).toBeNull();
    expect(me.body.candidate.phone_verified_at).toBeTruthy();
  });

  it('una vacante cerrada no recibe nuevas postulaciones', async () => {
    const admin = await staff('admin@demo.test');
    const v = await admin.post('/api/admin/vacancies', { title: 'Vacante para cerrar', modality: 'remoto', positions: 1, hireGoal: 1, summary: 'x', requirements: ['a'], recruiterIds: [] });
    const vid = v.body.id;
    const src = (await pool.query(`select id from sources where code = 'tiktok'`)).rows[0].id;
    const link = await admin.post(`/api/admin/vacancies/${vid}/links`, { sourceId: src, code: 'cerrar-test' });
    expect(link.status).toBe(200);
    // Sin reclutador no se puede publicar
    expect((await admin.post(`/api/admin/vacancies/${vid}/status`, { status: 'publicada' })).status).toBe(400);
    await pool.query(`insert into vacancy_recruiters select $1, id from users where email = 'reclutador1@demo.test'`, [vid]);
    expect((await admin.post(`/api/admin/vacancies/${vid}/status`, { status: 'publicada' })).status).toBe(200);
    const c = await applyCandidate({ link: 'cerrar-test' });
    expect(c.applicationId).toBeTruthy();
    expect((await admin.post(`/api/admin/vacancies/${vid}/status`, { status: 'cerrada' })).status).toBe(200);
    const a = new Agent(await getApp());
    const r = await a.post('/api/public/apply/start', { linkCode: 'cerrar-test', firstName: 'Tarde', lastName: 'Llegada', phone: uniquePhone(), channel: 'sms' });
    expect(r.status).toBe(409);
    const landing = await a.get('/api/public/links/cerrar-test');
    expect(landing.body.vacancy.accepting).toBe(false);
    // No se puede reabrir
    expect((await admin.post(`/api/admin/vacancies/${vid}/status`, { status: 'publicada' })).status).toBe(400);
  });

  it('el candidato puede retirarse y se libera su cita', async () => {
    const c = await compatibleCandidate();
    const slots = (await c.agent.get(`/api/portal/applications/${c.applicationId}/slots`)).body.slots;
    await c.agent.post(`/api/portal/applications/${c.applicationId}/interviews`, { slotId: slots[2].id });
    const w = await c.agent.post(`/api/portal/applications/${c.applicationId}/withdraw`, { reason: 'Encontré otro trabajo' });
    expect(w.status).toBe(200);
    expect(w.body.stage.closed).toBe(true);
    const i = (await pool.query('select status from interviews where application_id = $1', [c.applicationId])).rows;
    expect(i.every((x) => x.status === 'cancelada')).toBe(true);
  });
});

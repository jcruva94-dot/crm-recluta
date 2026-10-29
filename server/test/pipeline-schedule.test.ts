import { describe, it, expect } from 'vitest';
import { staff, compatibleCandidate, pool } from './helpers.js';

async function reasonId(stage: string) {
  return (await pool.query('select id from closure_reasons where stage_code = $1 limit 1', [stage])).rows[0].id;
}

describe('pipeline: reglas de transición', () => {
  it('rechaza transiciones inválidas y exige motivo para cerrar', async () => {
    const c = await compatibleCandidate();
    const r = await staff('reclutador1@demo.test');
    const inv = await r.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: 'oferta', expectedStage: 'contacto_pendiente' });
    expect(inv.status).toBe(400);
    expect(inv.body.details.code).toBe('transicion_invalida');
    const noReason = await r.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: 'no_localizado', expectedStage: 'contacto_pendiente' });
    expect(noReason.status).toBe(400);
    const wrongReason = await r.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: 'no_localizado', expectedStage: 'contacto_pendiente', closureReasonId: await reasonId('rechazado') });
    expect(wrongReason.status).toBe(400);
    const ok = await r.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: 'no_localizado', expectedStage: 'contacto_pendiente', closureReasonId: await reasonId('no_localizado'), comment: '3 llamadas sin respuesta' });
    expect(ok.status).toBe(200);
    // Al cerrar se cancelan tareas abiertas
    const open = (await pool.query(`select count(*)::int n from tasks where application_id = $1 and status = 'pendiente'`, [c.applicationId])).rows[0].n;
    expect(open).toBe(0);
    // Reactivación permitida
    const back = await r.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: 'contacto_pendiente', expectedStage: 'no_localizado', reason: 'Devolvió la llamada' });
    expect(back.status).toBe(200);
  });

  it('excepciones: solo con permiso y motivo, quedan marcadas', async () => {
    const c = await compatibleCandidate();
    const r = await staff('reclutador1@demo.test');
    const denied = await r.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: 'evaluacion', expectedStage: 'contacto_pendiente', override: true, reason: 'Entrevista hecha en feria' });
    expect(denied.status).toBe(403);
    const g = await staff('gerente@demo.test');
    const noReason = await g.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: 'evaluacion', expectedStage: 'contacto_pendiente', override: true });
    expect(noReason.status).toBe(400);
    const ok = await g.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: 'evaluacion', expectedStage: 'contacto_pendiente', override: true, reason: 'Entrevista realizada en feria de empleo' });
    expect(ok.status).toBe(200);
    expect(ok.body.isOverride).toBe(true);
    const h = (await pool.query(`select is_override, user_id is not null as has_user from stage_history where application_id = $1 order by id desc limit 1`, [c.applicationId])).rows[0];
    expect(h).toEqual({ is_override: true, has_user: true });
  });

  it('concurrencia: dos usuarios moviendo la misma postulación, uno recibe 409', async () => {
    const c = await compatibleCandidate();
    const r1 = await staff('reclutador1@demo.test');
    const g = await staff('gerente@demo.test');
    const results = await Promise.all([
      r1.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: 'no_localizado', expectedStage: 'contacto_pendiente', closureReasonId: await reasonId('no_localizado') }),
      g.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: 'reserva', expectedStage: 'contacto_pendiente', closureReasonId: await reasonId('reserva') }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    const n = (await pool.query(`select count(*)::int n from stage_history where application_id = $1 and to_code in ('no_localizado','reserva')`, [c.applicationId])).rows[0].n;
    expect(n).toBe(1);
  });

  it('no permite marcar "entrevista agendada" sin reservar un horario', async () => {
    const c = await compatibleCandidate();
    const r = await staff('reclutador1@demo.test');
    const mv = await r.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: 'entrevista_agendada', expectedStage: 'contacto_pendiente' });
    expect(mv.status).toBe(400);
  });

  it('registro de contacto actualiza último contacto y cierra la tarea de contactar', async () => {
    const c = await compatibleCandidate();
    const r = await staff('reclutador1@demo.test');
    const before = (await pool.query(`select count(*)::int n from tasks where application_id = $1 and type = 'contactar' and status = 'pendiente'`, [c.applicationId])).rows[0].n;
    expect(before).toBe(1);
    await r.post(`/api/admin/applications/${c.applicationId}/notes`, { body: 'Confirmó interés', kind: 'contacto', contactOutcome: 'contactado' });
    const a = (await pool.query('select last_contact_at from applications where id = $1', [c.applicationId])).rows[0];
    expect(a.last_contact_at).toBeTruthy();
    const after = (await pool.query(`select count(*)::int n from tasks where application_id = $1 and type = 'contactar' and status = 'pendiente'`, [c.applicationId])).rows[0].n;
    expect(after).toBe(0);
  });

  it('tareas vencidas se identifican en la bandeja', async () => {
    const c = await compatibleCandidate();
    await pool.query(`update tasks set due_at = now() - interval '2 hours' where application_id = $1`, [c.applicationId]);
    const rid = (await pool.query('select recruiter_id from applications where id = $1', [c.applicationId])).rows[0].recruiter_id;
    const email = (await pool.query('select email from users where id = $1', [rid])).rows[0].email;
    const r = await staff(email);
    const tasks = (await r.get('/api/admin/tasks')).body.tasks;
    const mine = tasks.filter((t: any) => t.application_id === c.applicationId);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((t: any) => t.overdue)).toBe(true);
    expect(tasks[0].overdue).toBe(true); // vencidas primero
  });
});

describe('agenda', () => {
  it('dos candidatos no pueden reservar el mismo horario al mismo tiempo', async () => {
    const a = await compatibleCandidate();
    const b = await compatibleCandidate();
    const slot = (await a.agent.get(`/api/portal/applications/${a.applicationId}/slots`)).body.slots[0];
    const [ra, rb] = await Promise.all([
      a.agent.post(`/api/portal/applications/${a.applicationId}/interviews`, { slotId: slot.id }),
      b.agent.post(`/api/portal/applications/${b.applicationId}/interviews`, { slotId: slot.id }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const n = (await pool.query(`select count(*)::int n from interviews where slot_id = $1 and status in ('agendada','confirmada')`, [slot.id])).rows[0].n;
    expect(n).toBe(1);
    // El perdedor sigue en contacto_pendiente
    const loser = ra.status === 409 ? a.applicationId : b.applicationId;
    expect((await pool.query('select stage_code from applications where id = $1', [loser])).rows[0].stage_code).toBe('contacto_pendiente');
  });

  it('la base de datos impide horarios traslapados del mismo entrevistador', async () => {
    const g = await staff('gerente@demo.test');
    const iid = (await pool.query(`select id from users where email = 'reclutador2@demo.test'`)).rows[0].id;
    const start = new Date(Date.now() + 30 * 86400_000);
    start.setUTCMinutes(0, 0, 0);
    const ok = await g.post('/api/admin/slots', { interviewerId: iid, mode: 'virtual', meetingUrl: 'https://meet.ejemplo.test/abc', starts: [start.toISOString()], durationMin: 30 });
    expect(ok.status).toBe(200);
    const overlap = await g.post('/api/admin/slots', { interviewerId: iid, mode: 'virtual', meetingUrl: 'https://meet.ejemplo.test/abc', starts: [new Date(start.getTime() + 15 * 60000).toISOString()], durationMin: 30 });
    expect(overlap.status).toBe(409);
    const past = await g.post('/api/admin/slots', { interviewerId: iid, mode: 'presencial', location: 'Sala 1', starts: [new Date(Date.now() - 3600_000).toISOString()], durationMin: 30 });
    expect(past.status).toBe(400);
  });

  it('inasistencia: ruta de recuperación y reagenda; asistencia avanza la etapa', async () => {
    const c = await compatibleCandidate();
    const slots = (await c.agent.get(`/api/portal/applications/${c.applicationId}/slots`)).body.slots;
    const booked = await c.agent.post(`/api/portal/applications/${c.applicationId}/interviews`, { slotId: slots[0].id });
    const iid = booked.body.interviews[0].id;
    const int = await staff('entrevistador@demo.test');
    // No se puede registrar antes de la hora
    expect((await int.post(`/api/admin/interviews/${iid}/attendance`, { status: 'no_asistio' })).status).toBe(400);
    // Simulamos que la cita ya pasó (se crea un horario pasado sin traslape)
    await pool.query(`update interview_slots set starts_at = now() - interval '3 hours', ends_at = now() - interval '150 minutes' where id = (select slot_id from interviews where id = $1)`, [iid]);
    const ns = await int.post(`/api/admin/interviews/${iid}/attendance`, { status: 'no_asistio' });
    expect(ns.status).toBe(200);
    const a = (await pool.query('select stage_code, no_show_count from applications where id = $1', [c.applicationId])).rows[0];
    expect(a).toEqual({ stage_code: 'contacto_pendiente', no_show_count: 1 });
    const t = (await pool.query(`select count(*)::int n from tasks where application_id = $1 and type = 'recuperar' and status = 'pendiente'`, [c.applicationId])).rows[0].n;
    expect(t).toBe(1);
    // El candidato puede reagendar
    const s2 = (await c.agent.get(`/api/portal/applications/${c.applicationId}/slots`)).body.slots;
    const re = await c.agent.post(`/api/portal/applications/${c.applicationId}/interviews`, { slotId: s2[0].id });
    expect(re.status).toBe(200);
    const iid2 = re.body.interviews.find((i: any) => i.status === 'agendada').id;
    await pool.query(`update interview_slots set starts_at = now() - interval '5 hours', ends_at = now() - interval '270 minutes' where id = (select slot_id from interviews where id = $1)`, [iid2]);
    const att = await int.post(`/api/admin/interviews/${iid2}/attendance`, { status: 'realizada', result: 'avanza', notes: 'Buena comunicación' });
    expect(att.status).toBe(200);
    expect((await pool.query('select stage_code from applications where id = $1', [c.applicationId])).rows[0].stage_code).toBe('entrevista_realizada');
    // No se registra dos veces
    expect((await int.post(`/api/admin/interviews/${iid2}/attendance`, { status: 'no_asistio' })).status).toBe(400);
  });

  it('notificaciones con clave de idempotencia no se duplican', async () => {
    const c = await compatibleCandidate();
    const { queueMessage } = await import('../src/modules/messaging.js');
    const cid = (await pool.query('select candidate_id from applications where id = $1', [c.applicationId])).rows[0].candidate_id;
    const m = { candidateId: cid, channel: 'whatsapp' as const, destination: '+520000000000', template: 'recordatorio', body: 'x', idempotencyKey: `rem:${c.applicationId}` };
    const first = await queueMessage(pool, m);
    const second = await queueMessage(pool, m);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    // Respeta "no contactar" en mensajes no transaccionales
    await pool.query('update candidates set do_not_contact = true where id = $1', [cid]);
    expect(await queueMessage(pool, { ...m, idempotencyKey: 'otra' })).toBeNull();
  });
});

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx, one, many, type Db } from '../db.js';
import { CANDIDATE_COOKIE, parse, requireCandidate } from '../app.js';
import { badRequest, notFound } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { normalizeEmail } from '../lib/contact.js';
import { audit } from '../lib/audit.js';
import { CANDIDATE_STATUS, CANDIDATE_STEPS, moveStage } from '../modules/pipeline.js';
import { evaluate, validateAnswer, type Question } from '../modules/prequal-engine.js';
import { availableSlots, book, cancelInterview, reschedule } from '../modules/scheduling.js';
import { messageCandidate, notifyUser } from '../modules/messaging.js';

/** Carga la postulación SOLO si pertenece al candidato de la sesión (evita IDOR). */
async function ownApplication(db: Db, candidateId: string, applicationId: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(applicationId)) throw notFound('Postulación no encontrada');
  const a = await one(db, `select * from applications where id = $1 and candidate_id = $2 ${lock ? 'for update' : ''}`, [applicationId, candidateId]);
  if (!a) throw notFound('Postulación no encontrada');
  return a;
}

async function ownInterview(db: Db, candidateId: string, interviewId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(interviewId)) throw notFound('Cita no encontrada');
  const i = await one(db, `select i.* from interviews i join applications a on a.id = i.application_id where i.id = $1 and a.candidate_id = $2`, [interviewId, candidateId]);
  if (!i) throw notFound('Cita no encontrada');
  return i;
}

export async function activeQuestions(db: Db, vacancyId: string): Promise<(Question & { help_text: string | null; position: number })[]> {
  return many(db,
    `select id, text, help_text, type, required, weight, is_knockout, knockout_message, options, number_rules, position
       from prequal_questions where vacancy_id = $1 and is_active order by position, created_at`, [vacancyId]);
}

/** Opciones visibles para el candidato: nunca se exponen puntuaciones ni marcas de descarte. */
const publicQuestion = (q: any) => ({
  id: q.id, text: q.text, helpText: q.help_text, type: q.type, required: q.required,
  options: (q.options ?? []).map((o: any) => ({ value: o.value, label: o.label })),
  min: q.number_rules?.min, max: q.number_rules?.max,
});

function candidateMessageFor(app: any) {
  const r = app.prequal_result as string | null;
  if (!r) return null;
  if (r === 'compatible' || r === 'compatible_con_observaciones') {
    return { kind: 'agendar', title: '¡Gracias! Recibimos tus respuestas', text: 'Tu perfil coincide con los requisitos principales. El siguiente paso es una entrevista: elige el horario que mejor te acomode.' };
  }
  if (r === 'no_cumple') {
    const msgs: string[] = app.prequal_explanation?.knockoutMessages ?? [];
    return { kind: 'revision', title: 'Recibimos tus respuestas', text: `Tus respuestas indican que podrías no cumplir un requisito indispensable de esta vacante${msgs.length ? ': ' + msgs.join('; ') : ''}. Un reclutador revisará tu caso antes de tomar una decisión y te avisará por tu medio de contacto preferido.` };
  }
  return { kind: 'revision', title: 'Recibimos tus respuestas', text: 'Un reclutador revisará tu perfil y te contactará por tu medio preferido. Puedes consultar aquí el estado de tu postulación.' };
}

async function applicationView(db: Db, app: any) {
  const v = await one(db,
    `select v.id, v.title, v.slug, v.modality, v.status, v.response_time_text, v.process_steps, s.name site_name, s.address site_address
       from vacancies v left join sites s on s.id = v.site_id where v.id = $1`, [app.vacancy_id]);
  const stage = await one(db, 'select code, category, candidate_step from pipeline_stages where code = $1', [app.stage_code]);
  const questions = await activeQuestions(db, app.vacancy_id);
  const answers = Object.fromEntries((await many(db, 'select question_id, value from prequal_answers where application_id = $1', [app.id])).map((r) => [r.question_id, r.value]));
  const interviews = await many(db,
    `select i.id, i.status, i.created_at, s.starts_at, s.ends_at, s.mode, s.location, s.meeting_url, u.full_name interviewer_name
       from interviews i join interview_slots s on s.id = i.slot_id join users u on u.id = s.interviewer_id
      where i.application_id = $1 order by s.starts_at desc`, [app.id]);
  const status = CANDIDATE_STATUS[app.stage_code] ?? { title: 'En proceso', message: '' };
  const closed = ['cerrado', 'reserva'].includes(stage.category);
  const hasConsent = !!(await one(db, `select 1 from consents k join privacy_notices n on n.id = k.notice_id and n.is_current where k.candidate_id = $1 and k.purpose = 'aviso_privacidad' and k.granted`, [app.candidate_id]));
  const reschedules = interviews.filter((i) => i.status === 'reprogramada').length;
  // Siguiente acción para el candidato
  let nextStep: string | null = null;
  if (app.stage_code === 'registro_iniciado') nextStep = 'registro';
  else if (app.stage_code === 'precalificacion_pendiente') nextStep = 'precalificacion';
  else if (app.stage_code === 'contacto_pendiente') nextStep = 'agendar';
  else if (app.stage_code === 'entrevista_agendada') nextStep = 'cita';
  return {
    id: app.id,
    vacancy: v,
    stage: { title: status.title, message: status.message, step: closed ? null : stage.candidate_step, closed },
    steps: CANDIDATE_STEPS,
    nextStep,
    hasConsent,
    resultMessage: candidateMessageFor(app),
    questions: app.stage_code === 'precalificacion_pendiente' || app.stage_code === 'registro_iniciado' ? questions.map(publicQuestion) : [],
    answers: app.stage_code === 'precalificacion_pendiente' ? answers : {},
    interviews: interviews.filter((i) => i.status !== 'reprogramada'),
    canReschedule: reschedules < 3,
    createdAt: app.created_at,
  };
}

export async function portalRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    const cid = requireCandidate(req);
    const c = await one(pool, 'select id, first_name, last_name, phone_e164, email, phone_verified_at, email_verified_at, preferred_channel, do_not_contact, city from candidates where id = $1', [cid]);
    const apps = await many(pool,
      `select a.id, a.stage_code, a.created_at, v.title, ps.category from applications a join vacancies v on v.id = a.vacancy_id join pipeline_stages ps on ps.code = a.stage_code
        where a.candidate_id = $1 order by a.created_at desc`, [cid]);
    return {
      candidate: c,
      applications: apps.map((a) => ({ id: a.id, title: a.title, createdAt: a.created_at, status: CANDIDATE_STATUS[a.stage_code]?.title ?? 'En proceso', closed: a.category !== 'activo' && a.category !== 'contratado' })),
    };
  });

  app.patch('/me', async (req) => {
    const cid = requireCandidate(req);
    const b = parse(z.object({
      email: z.string().max(254).nullable().optional(),
      city: z.string().trim().max(80).nullable().optional(),
      preferredChannel: z.enum(['whatsapp', 'sms', 'email', 'llamada']).optional(),
      doNotContact: z.boolean().optional(),
    }), req.body);
    await tx(async (c) => {
      const cur = (await c.query('select * from candidates where id = $1 for update', [cid])).rows[0];
      if (b.email !== undefined) {
        const e = normalizeEmail(b.email);
        if (e !== cur.email) {
          if (e) {
            const taken = (await c.query('select id from candidates where email = $1 and id <> $2 and anonymized_at is null', [e, cid])).rows[0];
            if (taken) throw badRequest('Ese correo ya está registrado en otro perfil. Solicita ayuda si es tuyo.');
          }
          if (!e && !cur.phone_e164) throw badRequest('Necesitamos al menos un medio de contacto');
          await c.query('update candidates set email = $2, email_verified_at = null where id = $1', [cid, e]);
        }
      }
      const pref = b.preferredChannel ?? cur.preferred_channel;
      if (pref === 'email' && !(b.email !== undefined ? normalizeEmail(b.email) : cur.email)) throw badRequest('Para preferir correo, registra un correo electrónico');
      await c.query(`update candidates set city = coalesce($2, city), preferred_channel = $3, do_not_contact = coalesce($4, do_not_contact), updated_at = now() where id = $1`,
        [cid, b.city ?? null, pref, b.doNotContact ?? null]);
      await audit(c, { type: 'candidate', id: cid, ip: req.ip }, 'candidate.profile_update', 'candidate', cid, { fields: Object.keys(b) });
    });
    return { ok: true };
  });

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[CANDIDATE_COOKIE];
    if (token) await pool.query('update candidate_sessions set revoked_at = now() where token_hash = $1', [sha256(token)]);
    reply.clearCookie(CANDIDATE_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/applications/:id', async (req) => {
    const cid = requireCandidate(req);
    const a = await ownApplication(pool, cid, (req.params as any).id);
    return applicationView(pool, a);
  });

  /** Completa el registro: aviso de privacidad, consentimientos y datos de perfil. */
  app.post('/applications/:id/registration', async (req) => {
    const cid = requireCandidate(req);
    const b = parse(z.object({
      noticeId: z.string().uuid(),
      acceptPrivacy: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar el aviso de privacidad para continuar' }) }),
      city: z.string().trim().min(2, 'Indica tu ciudad o municipio').max(80),
      preferredChannel: z.enum(['whatsapp', 'sms', 'email', 'llamada']),
      consents: z.object({ whatsapp: z.boolean(), sms: z.boolean(), email: z.boolean() }).partial().default({}),
    }), req.body);
    const ua = String(req.headers['user-agent'] ?? '').slice(0, 300);
    await tx(async (c) => {
      const a = await ownApplication(c, cid, (req.params as any).id, true);
      const notice = (await c.query('select id from privacy_notices where id = $1 and is_current', [b.noticeId])).rows[0];
      if (!notice) throw badRequest('El aviso de privacidad cambió. Recarga la página para leer la versión vigente.');
      const cand = (await c.query('select email from candidates where id = $1', [cid])).rows[0];
      if (b.preferredChannel === 'email' && !cand.email) throw badRequest('Para preferir correo, registra un correo electrónico');
      await c.query(`insert into consents(candidate_id, notice_id, purpose, granted, ip, user_agent) values ($1,$2,'aviso_privacidad',true,$3,$4)`, [cid, b.noticeId, req.ip, ua]);
      for (const [k, purpose] of [['whatsapp', 'contacto_whatsapp'], ['sms', 'contacto_sms'], ['email', 'contacto_email']] as const) {
        if (b.consents[k] !== undefined) await c.query(`insert into consents(candidate_id, notice_id, purpose, granted, ip, user_agent) values ($1,$2,$3,$4,$5,$6)`, [cid, b.noticeId, purpose, b.consents[k], req.ip, ua]);
      }
      await c.query('update candidates set city = $2, preferred_channel = $3, updated_at = now() where id = $1', [cid, b.city, b.preferredChannel]);
      if (a.stage_code === 'registro_iniciado') {
        const actor = { type: 'candidate' as const, id: cid, ip: req.ip };
        await moveStage(c, a.id, 'registro_completado', { actor, reason: 'Aviso aceptado y perfil completo' });
        await c.query('update applications set registration_completed_at = now() where id = $1', [a.id]);
        const hasQuestions = (await c.query('select 1 from prequal_questions where vacancy_id = $1 and is_active limit 1', [a.vacancy_id])).rowCount;
        await moveStage(c, a.id, hasQuestions ? 'precalificacion_pendiente' : 'contacto_pendiente', { actor, reason: hasQuestions ? 'Inicia precalificación' : 'Vacante sin precalificación' });
        await messageCandidate(c, cid, 'registro_completado', 'Registro recibido', 'Recibimos tu registro. Puedes continuar tu proceso desde tu portal en cualquier momento.', `registro:${a.id}`);
      }
    });
    return applicationView(pool, await ownApplication(pool, cid, (req.params as any).id));
  });

  /** Guarda respuestas parciales (permite continuar más tarde). */
  app.put('/applications/:id/answers', async (req) => {
    const cid = requireCandidate(req);
    const b = parse(z.object({ answers: z.record(z.string().uuid(), z.any()) }), req.body);
    await tx(async (c) => {
      const a = await ownApplication(c, cid, (req.params as any).id, true);
      if (a.stage_code !== 'precalificacion_pendiente') throw badRequest('La precalificación ya no admite cambios');
      const qs = new Map((await activeQuestions(c, a.vacancy_id)).map((q) => [q.id, q]));
      for (const [qid, value] of Object.entries(b.answers)) {
        const q = qs.get(qid);
        if (!q) throw badRequest('Pregunta no válida');
        if (value === null || value === '' || (Array.isArray(value) && !value.length)) {
          await c.query('delete from prequal_answers where application_id = $1 and question_id = $2', [a.id, qid]);
          continue;
        }
        const err = validateAnswer({ ...q, required: false }, value);
        if (err) throw badRequest(err, { questionId: qid });
        await c.query(`insert into prequal_answers(application_id, question_id, value) values ($1,$2,$3)
                       on conflict (application_id, question_id) do update set value = excluded.value, answered_at = now()`, [a.id, qid, JSON.stringify(value)]);
      }
    });
    return { ok: true, savedAt: new Date().toISOString() };
  });

  app.post('/applications/:id/prequal/submit', async (req) => {
    const cid = requireCandidate(req);
    await tx(async (c) => {
      const a = await ownApplication(c, cid, (req.params as any).id, true);
      if (a.stage_code !== 'precalificacion_pendiente') throw badRequest('La precalificación ya fue enviada');
      const v = (await c.query('select threshold_compatible, threshold_observations from vacancies where id = $1', [a.vacancy_id])).rows[0];
      const questions = await activeQuestions(c, a.vacancy_id);
      const answers = Object.fromEntries((await c.query('select question_id, value from prequal_answers where application_id = $1', [a.id])).rows.map((r) => [r.question_id, r.value]));
      const missing = questions.filter((q) => validateAnswer(q, answers[q.id] ?? null));
      if (missing.length) throw badRequest('Faltan respuestas obligatorias', { questionIds: missing.map((q) => q.id) });
      const ev = evaluate(questions, answers, { compatible: v.threshold_compatible, observations: v.threshold_observations });
      const snapshot = { ...ev, evaluatedAt: new Date().toISOString(), questionsSnapshot: questions.map((q) => ({ id: q.id, text: q.text, weight: q.weight, is_knockout: q.is_knockout })) };
      await c.query(`update applications set prequal_result = $2, prequal_score = $3, prequal_explanation = $4, prequal_completed_at = now() where id = $1`,
        [a.id, ev.result, ev.score, snapshot]);
      const actor = { type: 'system' as const };
      await moveStage(c, a.id, 'precalificacion_completada', { actor: { type: 'candidate', id: cid, ip: req.ip }, reason: 'Precalificación enviada' });
      const canSelfSchedule = ev.result === 'compatible' || ev.result === 'compatible_con_observaciones';
      await moveStage(c, a.id, canSelfSchedule ? 'contacto_pendiente' : 'revision_compatibilidad', { actor, reason: `Resultado automático: ${ev.result}` });
      if (ev.result === 'compatible_con_observaciones') {
        await c.query(`insert into tasks(application_id, type, title, assignee_id, due_at, priority, auto_key) values ($1,'revisar_perfil','Revisar observaciones de precalificación',$2, now() + interval '24 hours','media',$3) on conflict do nothing`,
          [a.id, a.recruiter_id, `obs:${a.id}`]);
      }
      await notifyUser(c, a.recruiter_id, 'Precalificación completada', `Resultado: ${ev.result.replaceAll('_', ' ')}`, `/admin/postulaciones/${a.id}`);
      await audit(c, { type: 'system' }, 'prequal.evaluated', 'application', a.id, { result: ev.result, score: ev.score });
    });
    return applicationView(pool, await ownApplication(pool, cid, (req.params as any).id));
  });

  app.get('/applications/:id/slots', async (req) => {
    const cid = requireCandidate(req);
    const a = await ownApplication(pool, cid, (req.params as any).id);
    if (!['contacto_pendiente', 'entrevista_agendada'].includes(a.stage_code)) return { slots: [] };
    const slots = await availableSlots(pool, a.id);
    return { slots: slots.map((s) => ({ id: s.id, startsAt: s.starts_at, endsAt: s.ends_at, mode: s.mode, location: s.mode === 'presencial' ? s.location : null })) };
  });

  app.post('/applications/:id/interviews', async (req) => {
    const cid = requireCandidate(req);
    const b = parse(z.object({ slotId: z.string().uuid() }), req.body);
    await tx(async (c) => {
      const a = await ownApplication(c, cid, (req.params as any).id);
      await book(c, a.id, b.slotId, 'candidato', { type: 'candidate', id: cid, ip: req.ip });
    });
    return applicationView(pool, await ownApplication(pool, cid, (req.params as any).id));
  });

  app.post('/interviews/:id/reschedule', async (req) => {
    const cid = requireCandidate(req);
    const b = parse(z.object({ slotId: z.string().uuid() }), req.body);
    const i = await ownInterview(pool, cid, (req.params as any).id);
    await tx((c) => reschedule(c, i.id, b.slotId, { type: 'candidate', id: cid, ip: req.ip }, true));
    return applicationView(pool, await ownApplication(pool, cid, i.application_id));
  });

  app.post('/interviews/:id/confirm', async (req) => {
    const cid = requireCandidate(req);
    const i = await ownInterview(pool, cid, (req.params as any).id);
    if (i.status !== 'agendada') throw badRequest('La cita no está pendiente de confirmar');
    await pool.query(`update interviews set status = 'confirmada', confirmed_at = now(), updated_at = now() where id = $1`, [i.id]);
    await audit(pool, { type: 'candidate', id: cid, ip: req.ip }, 'interview.confirm', 'interview', i.id);
    return applicationView(pool, await ownApplication(pool, cid, i.application_id));
  });

  app.post('/interviews/:id/cancel', async (req) => {
    const cid = requireCandidate(req);
    const b = parse(z.object({ reason: z.string().trim().min(3, 'Cuéntanos brevemente el motivo').max(300) }), req.body);
    const i = await ownInterview(pool, cid, (req.params as any).id);
    await tx(async (c) => {
      await cancelInterview(c, i.id, b.reason, { type: 'candidate', id: cid, ip: req.ip });
      const a = (await c.query('select recruiter_id from applications where id = $1', [i.application_id])).rows[0];
      await c.query(`insert into tasks(application_id, type, title, assignee_id, due_at, priority, auto_key) values ($1,'agendar','El candidato canceló su cita: dar seguimiento',$2, now() + interval '24 hours','alta',$3) on conflict do nothing`,
        [i.application_id, a.recruiter_id, `cancel:${i.id}`]);
    });
    return applicationView(pool, await ownApplication(pool, cid, i.application_id));
  });

  /** El candidato puede retirarse del proceso. */
  app.post('/applications/:id/withdraw', async (req) => {
    const cid = requireCandidate(req);
    const b = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body);
    await tx(async (c) => {
      const a = await ownApplication(c, cid, (req.params as any).id, true);
      const reason = (await c.query(`select id from closure_reasons where stage_code = 'retirado' and name = 'Retiro desde el portal'`)).rows[0];
      await c.query(`update interviews set status = 'cancelada', cancelled_at = now(), cancel_reason = 'Retiro del candidato' where application_id = $1 and status in ('agendada','confirmada')`, [a.id]);
      await moveStage(c, a.id, 'retirado', { actor: { type: 'candidate', id: cid, ip: req.ip }, closureReasonId: reason.id, reason: b.reason || 'Retiro desde el portal' });
    });
    return applicationView(pool, await ownApplication(pool, cid, (req.params as any).id));
  });

  app.post('/help', async (req) => {
    const cid = requireCandidate(req);
    const b = parse(z.object({ applicationId: z.string().uuid().optional(), topic: z.enum(['continuar', 'cita', 'datos', 'problema_tecnico', 'otro']), message: z.string().trim().min(5, 'Describe brevemente tu solicitud').max(1000) }), req.body);
    await tx(async (c) => {
      let app: any = null;
      if (b.applicationId) app = await ownApplication(c, cid, b.applicationId);
      else app = (await c.query('select * from applications where candidate_id = $1 order by created_at desc limit 1', [cid])).rows[0];
      if (!app) throw badRequest('No encontramos una postulación asociada');
      await c.query(`insert into tasks(application_id, type, title, assignee_id, due_at, priority) values ($1,'incidencia',$2,$3, now() + interval '24 hours','alta')`,
        [app.id, `Solicitud de ayuda (${b.topic}): ${b.message.slice(0, 160)}`, app.recruiter_id]);
      await notifyUser(c, app.recruiter_id, 'Solicitud de ayuda de un candidato', b.message.slice(0, 120), `/admin/postulaciones/${app.id}`);
      await audit(c, { type: 'candidate', id: cid, ip: req.ip }, 'candidate.help_request', 'application', app.id, { topic: b.topic });
    });
    return { ok: true };
  });
}

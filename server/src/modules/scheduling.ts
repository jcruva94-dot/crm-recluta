import type { PoolClient } from 'pg';
import type { Db } from '../db.js';
import { audit, type Actor } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { moveStage } from './pipeline.js';
import { messageCandidate, notifyUser } from './messaging.js';
import { config } from '../config.js';

export const MAX_RESCHEDULES = 3;
const MIN_LEAD_MINUTES = 60; // no se puede reservar con menos de 1 h de anticipación

export function fmtDate(d: Date | string) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: config.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(d));
}

export async function availableSlots(db: Db, applicationId: string) {
  return (await db.query(
    `select s.id, s.starts_at, s.ends_at, s.mode, s.location, u.full_name as interviewer_name
       from interview_slots s
       join applications a on a.id = $1
       join users u on u.id = s.interviewer_id
      where s.status = 'disponible'
        and (s.vacancy_id = a.vacancy_id or s.vacancy_id is null)
        and s.starts_at > now() + interval '${MIN_LEAD_MINUTES} minutes'
        and s.starts_at < now() + interval '21 days'
        and not exists (select 1 from interviews i where i.slot_id = s.id and i.status in ('agendada','confirmada','realizada'))
      order by s.starts_at limit 80`,
    [applicationId],
  )).rows;
}

async function lockFreeSlot(c: PoolClient, slotId: string, applicationId: string) {
  const s = (await c.query(
    `select s.*, a.vacancy_id as app_vacancy from interview_slots s join applications a on a.id = $2 where s.id = $1 for update of s`,
    [slotId, applicationId],
  )).rows[0];
  if (!s || s.status !== 'disponible') throw notFound('El horario no está disponible');
  if (s.vacancy_id && s.vacancy_id !== s.app_vacancy) throw badRequest('El horario no corresponde a la vacante');
  if (new Date(s.starts_at).getTime() < Date.now() + MIN_LEAD_MINUTES * 60_000) throw badRequest('El horario ya no puede reservarse');
  return s;
}

async function insertInterview(c: PoolClient, applicationId: string, slotId: string, bookedBy: 'candidato' | 'reclutador') {
  try {
    await c.query('savepoint book');
    const r = await c.query(
      `insert into interviews(application_id, slot_id, booked_by) values ($1,$2,$3) returning *`,
      [applicationId, slotId, bookedBy],
    );
    await c.query('release savepoint book');
    return r.rows[0];
  } catch (e: any) {
    await c.query('rollback to savepoint book');
    if (e.code === '23505') throw conflict('Ese horario acaba de ser reservado por otra persona. Elige otro.');
    throw e;
  }
}

async function confirmationMessage(c: PoolClient, applicationId: string, interviewId: string, slot: any, kind: 'agendada' | 'reprogramada') {
  const a = (await c.query('select a.candidate_id, a.recruiter_id, v.title from applications a join vacancies v on v.id = a.vacancy_id where a.id = $1', [applicationId])).rows[0];
  const where = slot.mode === 'presencial' ? `Lugar: ${slot.location}` : `Enlace: ${slot.meeting_url}`;
  await messageCandidate(c, a.candidate_id, 'entrevista_' + kind, `Entrevista ${kind}`,
    `Tu entrevista para ${a.title} quedó ${kind} el ${fmtDate(slot.starts_at)}. ${where}. Puedes confirmar o reprogramar desde tu portal.`,
    `interview:${interviewId}:${kind}`, true);
  await notifyUser(c, slot.interviewer_id, `Entrevista ${kind}`, `${a.title} · ${fmtDate(slot.starts_at)}`, `/admin/agenda`);
  if (a.recruiter_id && a.recruiter_id !== slot.interviewer_id) await notifyUser(c, a.recruiter_id, `Entrevista ${kind}`, `${a.title} · ${fmtDate(slot.starts_at)}`, `/admin/postulaciones/${applicationId}`);
}

export async function book(c: PoolClient, applicationId: string, slotId: string, bookedBy: 'candidato' | 'reclutador', actor: Actor) {
  const app = (await c.query('select * from applications where id = $1 for update', [applicationId])).rows[0];
  if (!app) throw notFound();
  if (app.stage_code !== 'contacto_pendiente') {
    throw badRequest(app.stage_code === 'entrevista_agendada' ? 'Ya tienes una entrevista agendada; puedes reprogramarla.' : 'Esta postulación no está en etapa de agendamiento');
  }
  const slot = await lockFreeSlot(c, slotId, applicationId);
  const interview = await insertInterview(c, applicationId, slotId, bookedBy);
  await moveStage(c, applicationId, 'entrevista_agendada', { actor, reason: bookedBy === 'candidato' ? 'Agendada por el candidato desde el portal' : 'Agendada por reclutador' });
  await c.query(`update applications set next_action = 'Entrevista', next_action_at = $2 where id = $1`, [applicationId, slot.starts_at]);
  await audit(c, actor, 'interview.book', 'interview', interview.id, { slotId, applicationId });
  await confirmationMessage(c, applicationId, interview.id, slot, 'agendada');
  return interview;
}

export async function reschedule(c: PoolClient, interviewId: string, newSlotId: string, actor: Actor, limitForCandidate: boolean) {
  const i = (await c.query('select * from interviews where id = $1 for update', [interviewId])).rows[0];
  if (!i) throw notFound();
  if (!['agendada', 'confirmada'].includes(i.status)) throw badRequest('Solo se puede reprogramar una cita pendiente');
  await c.query('select id from applications where id = $1 for update', [i.application_id]);
  if (limitForCandidate) {
    const n = (await c.query(`select count(*)::int n from interviews where application_id = $1 and status = 'reprogramada'`, [i.application_id])).rows[0].n;
    if (n >= MAX_RESCHEDULES) throw badRequest('Alcanzaste el máximo de reprogramaciones. Solicita ayuda a tu reclutador.');
  }
  await c.query(`update interviews set status = 'reprogramada', updated_at = now() where id = $1`, [interviewId]);
  const slot = await lockFreeSlot(c, newSlotId, i.application_id);
  const ni = await insertInterview(c, i.application_id, newSlotId, actor.type === 'candidate' ? 'candidato' : 'reclutador');
  await c.query(`update applications set next_action_at = $2, updated_at = now() where id = $1`, [i.application_id, slot.starts_at]);
  await audit(c, actor, 'interview.reschedule', 'interview', ni.id, { previous: interviewId, slotId: newSlotId });
  await confirmationMessage(c, i.application_id, ni.id, slot, 'reprogramada');
  return ni;
}

export async function cancelInterview(c: PoolClient, interviewId: string, reason: string, actor: Actor) {
  const i = (await c.query('select * from interviews where id = $1 for update', [interviewId])).rows[0];
  if (!i) throw notFound();
  if (!['agendada', 'confirmada'].includes(i.status)) throw badRequest('La cita ya no está pendiente');
  await c.query(`update interviews set status = 'cancelada', cancelled_at = now(), cancel_reason = $2, updated_at = now() where id = $1`, [interviewId, reason]);
  await moveStage(c, i.application_id, 'contacto_pendiente', { actor, reason: `Cita cancelada: ${reason}` });
  await audit(c, actor, 'interview.cancel', 'interview', interviewId, { reason });
}

export async function recordAttendance(c: PoolClient, interviewId: string, status: 'realizada' | 'no_asistio', notes: string | undefined, result: string | undefined, actor: Actor) {
  const i = (await c.query('select i.*, s.starts_at from interviews i join interview_slots s on s.id = i.slot_id where i.id = $1 for update of i', [interviewId])).rows[0];
  if (!i) throw notFound();
  if (!['agendada', 'confirmada'].includes(i.status)) throw badRequest('La asistencia de esta cita ya fue registrada');
  if (new Date(i.starts_at).getTime() > Date.now()) throw badRequest('No se puede registrar asistencia antes de la hora de la cita');
  await c.query(`update interviews set status = $2, interviewer_notes = $3, result = $4, updated_at = now() where id = $1`, [interviewId, status, notes ?? null, status === 'realizada' ? result ?? 'pendiente' : null]);
  if (status === 'realizada') {
    await moveStage(c, i.application_id, 'entrevista_realizada', { actor, reason: 'Asistencia registrada', comment: notes });
  } else {
    await c.query('update applications set no_show_count = no_show_count + 1 where id = $1', [i.application_id]);
    await moveStage(c, i.application_id, 'contacto_pendiente', { actor, reason: 'Inasistencia: ruta de recuperación', nextAction: 'Recuperar y reagendar' });
    const a = (await c.query('select candidate_id, recruiter_id from applications where id = $1', [i.application_id])).rows[0];
    await c.query(
      `insert into tasks(application_id, type, title, assignee_id, due_at, priority, auto_key)
       values ($1,'recuperar','Candidato no asistió: contactar y reagendar',$2, now() + interval '4 hours','alta',$3) on conflict do nothing`,
      [i.application_id, a.recruiter_id, `noshow:${interviewId}`],
    );
    await messageCandidate(c, a.candidate_id, 'entrevista_no_asistio', 'Te esperábamos',
      'No pudimos verte en tu entrevista. Si sigues interesado, puedes elegir un nuevo horario desde tu portal.', `noshow:${interviewId}`);
  }
  await audit(c, actor, 'interview.attendance', 'interview', interviewId, { status, result });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool, tx, one, many } from '../db.js';
import { parse, requireStaff } from '../app.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { can } from '../lib/permissions.js';
import { applicationScope, type StaffUser } from '../lib/scope.js';
import { availableSlots, book, cancelInterview, recordAttendance, reschedule } from '../modules/scheduling.js';
import { scopedApplication, scopedVacancy } from './admin.js';

const uuid = z.string().uuid();
const actorOf = (u: StaffUser, req: FastifyRequest) => ({ type: 'user' as const, id: u.id, ip: req.ip });

async function scopedInterview(u: StaffUser, id: string) {
  if (!uuid.safeParse(id).success) throw notFound('Cita no encontrada');
  const params: unknown[] = [id];
  const cond = applicationScope(u, params);
  const i = await one(pool, `select i.*, s.interviewer_id from interviews i join interview_slots s on s.id = i.slot_id join applications a on a.id = i.application_id where i.id = $1 and ${cond}`, params);
  if (!i) throw notFound('Cita no encontrada');
  return i;
}

export async function scheduleRoutes(app: FastifyInstance) {
  /** Agenda: horarios + citas en un rango. Entrevistadores solo ven lo suyo. */
  app.get('/agenda', async (req) => {
    const u = requireStaff(req);
    const f = parse(z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }), interviewerId: uuid.optional() }), req.query);
    if (new Date(f.to).getTime() - new Date(f.from).getTime() > 45 * 86400_000) throw badRequest('El rango máximo es de 45 días');
    const params: unknown[] = [f.from, f.to];
    const where = ['s.starts_at >= $1', 's.starts_at < $2', `s.status <> 'cancelado'`];
    if (u.role === 'entrevistador') { params.push(u.id); where.push(`s.interviewer_id = $${params.length}`); }
    else if (f.interviewerId) { params.push(f.interviewerId); where.push(`s.interviewer_id = $${params.length}`); }
    const slots = await many(pool,
      `select s.id, s.starts_at, s.ends_at, s.mode, s.location, s.meeting_url, s.interviewer_id, u.full_name interviewer_name, s.vacancy_id, v.title vacancy_title,
              i.id interview_id, i.status interview_status, i.application_id, i.result
         from interview_slots s join users u on u.id = s.interviewer_id left join vacancies v on v.id = s.vacancy_id
         left join interviews i on i.slot_id = s.id and i.status in ('agendada','confirmada','realizada','no_asistio')
        where ${where.join(' and ')} order by s.starts_at`, params);
    // Nombre del candidato solo si la postulación está en el alcance del usuario
    const appIds = [...new Set(slots.map((s) => s.application_id).filter(Boolean))];
    let names = new Map<string, any>();
    if (appIds.length) {
      const p: unknown[] = [appIds];
      const cond = applicationScope(u, p);
      names = new Map((await many(pool, `select a.id, c.first_name || ' ' || c.last_name name, v.title from applications a join candidates c on c.id = a.candidate_id join vacancies v on v.id = a.vacancy_id where a.id = any($1) and ${cond}`, p)).map((r) => [r.id, r]));
    }
    return { slots: slots.map((s) => ({ ...s, candidate_name: s.application_id ? names.get(s.application_id)?.name ?? 'Candidato (fuera de tu alcance)' : null, application_vacancy: s.application_id ? names.get(s.application_id)?.title ?? null : null, application_id: names.has(s.application_id) ? s.application_id : null })) };
  });

  /** Genera horarios disponibles en bloque (p. ej. lunes a viernes de 9 a 13 h cada 30 min). */
  app.post('/slots', async (req) => {
    const u = requireStaff(req, 'schedule.manage');
    const b = parse(z.object({
      interviewerId: uuid, vacancyId: uuid.nullable().optional(),
      mode: z.enum(['presencial', 'virtual']), location: z.string().trim().max(300).nullable().optional(), meetingUrl: z.string().trim().url().max(500).nullable().optional(),
      // Inicios en ISO (el frontend convierte la hora local a UTC)
      starts: z.array(z.string().datetime({ offset: true })).min(1).max(200),
      durationMin: z.number().int().min(10).max(240),
    }), req.body);
    if (b.mode === 'presencial' && !b.location) throw badRequest('Indica la dirección para entrevistas presenciales');
    if (b.mode === 'virtual' && !b.meetingUrl) throw badRequest('Indica el enlace de videollamada');
    if (b.meetingUrl && !/^https:\/\//.test(b.meetingUrl)) throw badRequest('El enlace debe usar https');
    const interviewer = await one(pool, `select id, role from users where id = $1 and is_active`, [b.interviewerId]);
    if (!interviewer) throw badRequest('Entrevistador no válido');
    if (b.vacancyId) await scopedVacancy(pool, u, b.vacancyId);
    const created = await tx(async (c) => {
      const out = [];
      for (const s of b.starts) {
        const start = new Date(s);
        if (start.getTime() < Date.now()) throw badRequest('No se pueden crear horarios en el pasado');
        const end = new Date(start.getTime() + b.durationMin * 60_000);
        try {
          await c.query('savepoint s');
          out.push((await c.query(
            `insert into interview_slots(interviewer_id, vacancy_id, starts_at, ends_at, mode, location, meeting_url, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
            [b.interviewerId, b.vacancyId ?? null, start, end, b.mode, b.location ?? null, b.meetingUrl ?? null, u.id])).rows[0]);
          await c.query('release savepoint s');
        } catch (e: any) {
          await c.query('rollback to savepoint s');
          if (e.code === '23P01') throw conflict(`El horario ${start.toISOString()} se traslapa con otro del mismo entrevistador`);
          throw e;
        }
      }
      await audit(c, actorOf(u, req), 'slots.create', 'user', b.interviewerId, { count: out.length });
      return out;
    });
    return { created: created.length, slots: created };
  });

  app.delete('/slots/:id', async (req) => {
    const u = requireStaff(req, 'schedule.manage');
    const s = await one(pool, 'select * from interview_slots where id = $1', [(req.params as any).id]);
    if (!s) throw notFound();
    const busy = await one(pool, `select 1 from interviews where slot_id = $1 and status in ('agendada','confirmada','realizada')`, [s.id]);
    if (busy) throw conflict('El horario tiene una cita. Cancela o reprograma la cita primero.');
    await pool.query(`update interview_slots set status = 'cancelado' where id = $1`, [s.id]);
    await audit(pool, actorOf(u, req), 'slots.cancel', 'user', s.interviewer_id, { slotId: s.id });
    return { ok: true };
  });

  app.get('/applications/:id/slots', async (req) => {
    const u = requireStaff(req, 'schedule.manage');
    const a = await scopedApplication(pool, u, (req.params as any).id);
    return { slots: await availableSlots(pool, a.id) };
  });

  app.post('/applications/:id/interviews', async (req) => {
    const u = requireStaff(req, 'schedule.manage');
    const b = parse(z.object({ slotId: uuid }), req.body);
    const i = await tx(async (c) => {
      const a = await scopedApplication(c, u, (req.params as any).id);
      return book(c, a.id, b.slotId, 'reclutador', actorOf(u, req));
    });
    return i;
  });

  app.post('/interviews/:id/reschedule', async (req) => {
    const u = requireStaff(req, 'schedule.manage');
    const b = parse(z.object({ slotId: uuid }), req.body);
    const i = await scopedInterview(u, (req.params as any).id);
    return tx((c) => reschedule(c, i.id, b.slotId, actorOf(u, req), false));
  });

  app.post('/interviews/:id/cancel', async (req) => {
    const u = requireStaff(req, 'schedule.manage');
    const b = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    const i = await scopedInterview(u, (req.params as any).id);
    await tx((c) => cancelInterview(c, i.id, b.reason, actorOf(u, req)));
    return { ok: true };
  });

  app.post('/interviews/:id/attendance', async (req) => {
    const u = requireStaff(req, 'interview.evaluate');
    const b = parse(z.object({ status: z.enum(['realizada', 'no_asistio']), notes: z.string().trim().max(4000).optional(), result: z.enum(['avanza', 'no_avanza', 'pendiente']).optional() }), req.body);
    const i = await scopedInterview(u, (req.params as any).id);
    // El entrevistador solo registra sus propias entrevistas
    if (u.role === 'entrevistador' && i.interviewer_id !== u.id) throw forbidden();
    if (!can(u.role, 'interview.evaluate')) throw forbidden();
    await tx((c) => recordAttendance(c, i.id, b.status, b.notes, b.result, actorOf(u, req)));
    return { ok: true };
  });
}

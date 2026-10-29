import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx, one } from '../db.js';
import { CANDIDATE_COOKIE, cookieOpts, parse } from '../app.js';
import { badRequest, conflict, notFound, tooMany } from '../lib/errors.js';
import { generateOtp, hashOtp, randomToken, safeEqualHex, sha256 } from '../lib/crypto.js';
import { maskEmail, maskPhone, normalizeEmail, normalizePhone } from '../lib/contact.js';
import { audit } from '../lib/audit.js';
import { queueMessage, notifyUser, type Channel } from '../modules/messaging.js';
import { autoAssign, moveStage } from '../modules/pipeline.js';
import { config } from '../config.js';

const OTP_TTL_MIN = 10;
const SESSION_DAYS = 30;

export const PUBLIC_VACANCY_FIELDS = `v.id, v.slug, v.title, v.modality, v.summary, v.activities, v.requirements, v.education, v.experience,
  v.salary_text, v.schedule_text, v.benefits, v.process_steps, v.response_time_text, v.status,
  s.name as site_name, s.address as site_address, s.city as site_city, c.name as client_name`;

async function loadPublicVacancy(where: string, param: string) {
  return one(pool,
    `select ${PUBLIC_VACANCY_FIELDS} from vacancies v
       left join sites s on s.id = v.site_id left join clients c on c.id = v.client_id
      where ${where}`, [param]);
}

async function enforceOtpRateLimit(destination: string, ip: string) {
  const r = await one<{ m15: number; d1: number; ip1h: number }>(pool,
    `select count(*) filter (where destination = $1 and created_at > now() - interval '15 minutes')::int m15,
            count(*) filter (where destination = $1 and created_at > now() - interval '1 day')::int d1,
            count(*) filter (where ip = $2 and created_at > now() - interval '1 hour')::int ip1h
       from otp_challenges where (destination = $1 or ip = $2) and created_at > now() - interval '1 day'`,
    [destination, ip]);
  if (r!.m15 >= 3 || r!.d1 >= 10) throw tooMany('Solicitaste demasiados códigos. Espera unos minutos e inténtalo de nuevo.');
  if (r!.ip1h >= 30) throw tooMany('Demasiadas solicitudes desde esta conexión. Intenta más tarde.');
}

async function issueOtp(params: {
  purpose: 'apply' | 'login'; channel: Channel; destination: string; candidateId?: string | null; context?: object; ip: string;
}) {
  await enforceOtpRateLimit(params.destination, params.ip);
  const code = generateOtp();
  return tx(async (c) => {
    const ch = (await c.query(
      `insert into otp_challenges(purpose, channel, destination, candidate_id, code_hash, context, expires_at, ip)
       values ($1,$2,$3,$4,'pending',$5, now() + interval '${OTP_TTL_MIN} minutes', $6) returning id`,
      [params.purpose, params.channel, params.destination, params.candidateId ?? null, params.context ?? {}, params.ip],
    )).rows[0];
    await c.query('update otp_challenges set code_hash = $2 where id = $1', [ch.id, hashOtp(ch.id, code)]);
    await queueMessage(c, {
      candidateId: params.candidateId ?? null, channel: params.channel, destination: params.destination,
      template: 'otp', subject: 'Tu código de verificación',
      body: `Tu código para continuar tu postulación es ${code}. Vence en ${OTP_TTL_MIN} minutos. No lo compartas.`,
      idempotencyKey: `otp:${ch.id}`, transactional: true,
    });
    return { challengeId: ch.id as string, code };
  });
}

function otpResponse(challengeId: string, channel: Channel, destination: string, code: string) {
  return {
    challengeId,
    channel,
    sentTo: channel === 'email' ? maskEmail(destination) : maskPhone(destination),
    expiresInMinutes: OTP_TTL_MIN,
    deliveryMode: config.deliveryMode,
    // Solo en modo sandbox de desarrollo: no hay proveedor de mensajes configurado.
    ...(config.exposeDevOtp ? { devCode: code } : {}),
  };
}

const applyStartSchema = z.object({
  linkCode: z.string().max(40).optional(),
  vacancySlug: z.string().max(80).optional(),
  firstName: z.string().trim().min(2, 'Escribe tu nombre').max(80),
  lastName: z.string().trim().min(2, 'Escribe tus apellidos').max(120),
  phone: z.string().max(25).optional().nullable(),
  email: z.string().max(254).optional().nullable(),
  channel: z.enum(['sms', 'whatsapp', 'email']),
});

export async function publicRoutes(app: FastifyInstance) {
  app.get('/links/:code', async (req) => {
    const { code } = req.params as { code: string };
    const link = await one(pool, `select id, vacancy_id, is_active from tracking_links where code = $1`, [code]);
    if (!link) throw notFound('La liga no existe o fue desactivada');
    const v = await loadPublicVacancy('v.id = $1', link.vacancy_id);
    if (!v || v.status === 'borrador') throw notFound('La vacante no está disponible');
    await pool.query(`insert into tracking_events(link_id, vacancy_id, event) values ($1,$2,'visit')`, [link.id, v.id]);
    return { vacancy: { ...v, accepting: v.status === 'publicada' && link.is_active }, linkCode: code };
  });

  app.get('/vacancies/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    const v = await loadPublicVacancy('v.slug = $1', slug);
    if (!v || v.status === 'borrador') throw notFound('La vacante no está disponible');
    await pool.query(`insert into tracking_events(vacancy_id, event) values ($1,'visit')`, [v.id]);
    return { vacancy: { ...v, accepting: v.status === 'publicada' } };
  });

  app.get('/vacancies', async () => {
    const rows = (await pool.query(
      `select ${PUBLIC_VACANCY_FIELDS} from vacancies v left join sites s on s.id = v.site_id left join clients c on c.id = v.client_id
        where v.status = 'publicada' order by v.priority = 'alta' desc, v.created_at desc`)).rows;
    return { vacancies: rows };
  });

  app.get('/privacy-notice', async () => {
    const n = await one(pool, 'select id, version, title, body, published_at from privacy_notices where is_current');
    if (!n) throw notFound('No hay aviso de privacidad publicado');
    return n;
  });

  /** Paso 1 del registro: datos mínimos + envío de OTP. Aún no se crea el candidato. */
  app.post('/apply/start', async (req) => {
    const b = parse(applyStartSchema, req.body);
    const phone = normalizePhone(b.phone);
    const email = normalizeEmail(b.email);
    if (b.channel === 'email' && !email) throw badRequest('Para recibir el código por correo, escribe tu correo electrónico');
    if (b.channel !== 'email' && !phone) throw badRequest('Escribe tu número de celular para recibir el código');

    let vacancyId: string, linkId: string | null = null;
    if (b.linkCode) {
      const l = await one(pool, 'select l.id, l.vacancy_id, l.is_active, v.status from tracking_links l join vacancies v on v.id = l.vacancy_id where l.code = $1', [b.linkCode]);
      if (!l) throw notFound('La liga no existe');
      if (!l.is_active || l.status !== 'publicada') throw conflict('Esta vacante ya no está recibiendo postulaciones');
      vacancyId = l.vacancy_id; linkId = l.id;
    } else if (b.vacancySlug) {
      const v = await one(pool, 'select id, status from vacancies where slug = $1', [b.vacancySlug]);
      if (!v) throw notFound('La vacante no existe');
      if (v.status !== 'publicada') throw conflict('Esta vacante ya no está recibiendo postulaciones');
      vacancyId = v.id;
    } else throw badRequest('Falta la vacante');

    const destination = b.channel === 'email' ? email! : phone!;
    await pool.query(`insert into tracking_events(link_id, vacancy_id, event) values ($1,$2,'apply_start')`, [linkId, vacancyId]);
    const { challengeId, code } = await issueOtp({
      purpose: 'apply', channel: b.channel, destination, ip: req.ip,
      context: { firstName: b.firstName, lastName: b.lastName, phone, email, vacancyId, linkId },
    });
    return otpResponse(challengeId, b.channel, destination, code);
  });

  /** "Continuar más tarde": acceso para candidatos existentes. Respuesta idéntica exista o no la persona. */
  app.post('/login/start', async (req) => {
    const b = parse(z.object({ identifier: z.string().trim().min(5).max(254), channel: z.enum(['sms', 'whatsapp', 'email']).optional() }), req.body);
    const isEmail = b.identifier.includes('@');
    const value = isEmail ? normalizeEmail(b.identifier)! : normalizePhone(b.identifier)!;
    const channel: Channel = isEmail ? 'email' : b.channel === 'sms' ? 'sms' : 'whatsapp';
    const cand = await one(pool, `select id from candidates where ${isEmail ? 'email' : 'phone_e164'} = $1 and anonymized_at is null`, [value]);
    if (!cand) {
      // No revelamos si existe: se devuelve un reto ficticio que nunca podrá verificarse.
      await enforceOtpRateLimit(value, req.ip);
      await pool.query(`insert into otp_challenges(purpose, channel, destination, code_hash, expires_at, ip, consumed_at) values ('login',$1,$2,'none', now(), $3, now())`, [channel, value, req.ip]);
      return { challengeId: crypto.randomUUID(), channel, sentTo: isEmail ? maskEmail(value) : maskPhone(value), expiresInMinutes: OTP_TTL_MIN, deliveryMode: config.deliveryMode };
    }
    const { challengeId, code } = await issueOtp({ purpose: 'login', channel, destination: value, candidateId: cand.id, ip: req.ip });
    return otpResponse(challengeId, channel, value, code);
  });

  app.post('/otp/resend', async (req) => {
    const b = parse(z.object({ challengeId: z.string().uuid() }), req.body);
    const ch = await one(pool, 'select * from otp_challenges where id = $1', [b.challengeId]);
    if (!ch || ch.consumed_at) throw badRequest('Solicita un nuevo código desde el inicio');
    await pool.query('update otp_challenges set consumed_at = now() where id = $1', [ch.id]);
    const { challengeId, code } = await issueOtp({ purpose: ch.purpose, channel: ch.channel, destination: ch.destination, candidateId: ch.candidate_id, context: ch.context, ip: req.ip });
    return otpResponse(challengeId, ch.channel, ch.destination, code);
  });

  /** Verificación real del código en el backend. Crea o recupera candidato y postulación. */
  app.post('/otp/verify', async (req, reply) => {
    const b = parse(z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/, 'El código tiene 6 dígitos') }), req.body);
    const result = await tx(async (c) => {
      const ch = (await c.query('select * from otp_challenges where id = $1 for update', [b.challengeId])).rows[0];
      if (!ch || ch.consumed_at) return { error: badRequest('El código ya no es válido. Solicita uno nuevo.') };
      if (new Date(ch.expires_at) < new Date()) return { error: badRequest('El código venció. Solicita uno nuevo.') };
      if (ch.attempts >= ch.max_attempts) return { error: tooMany('Demasiados intentos. Solicita un nuevo código.') };
      if (!safeEqualHex(ch.code_hash, hashOtp(ch.id, b.code))) {
        await c.query('update otp_challenges set attempts = attempts + 1 where id = $1', [ch.id]);
        const left = ch.max_attempts - ch.attempts - 1;
        return { error: badRequest(left > 0 ? `Código incorrecto. Te quedan ${left} intentos.` : 'Código incorrecto. Solicita un nuevo código.') };
      }
      await c.query('update otp_challenges set consumed_at = now() where id = $1', [ch.id]);
      const verifiedField = ch.channel === 'email' ? 'email_verified_at' : 'phone_verified_at';

      let candidateId: string;
      let applicationId: string | null = null;
      let resumed = false;
      if (ch.purpose === 'login') {
        candidateId = ch.candidate_id;
        await c.query(`update candidates set ${verifiedField} = coalesce(${verifiedField}, now()) where id = $1`, [candidateId]);
      } else {
        const ctx = ch.context as { firstName: string; lastName: string; phone: string | null; email: string | null; vacancyId: string; linkId: string | null };
        const byPhone = ctx.phone ? (await c.query('select * from candidates where phone_e164 = $1 and anonymized_at is null for update', [ctx.phone])).rows[0] : null;
        const byEmail = ctx.email ? (await c.query('select * from candidates where email = $1 and anonymized_at is null for update', [ctx.email])).rows[0] : null;
        const verifiedMatch = ch.channel === 'email' ? byEmail : byPhone;
        const otherMatch = ch.channel === 'email' ? byPhone : byEmail;
        if (verifiedMatch) {
          // Misma persona (controla el medio verificado): recuperamos su expediente.
          candidateId = verifiedMatch.id;
          await c.query(`update candidates set ${verifiedField} = coalesce(${verifiedField}, now()), updated_at = now() where id = $1`, [candidateId]);
          // Completa el dato faltante si nadie más lo usa
          if (ch.channel !== 'email' && ctx.email && !verifiedMatch.email && !byEmail) await c.query('update candidates set email = $2 where id = $1', [candidateId, ctx.email]);
          if (ch.channel === 'email' && ctx.phone && !verifiedMatch.phone_e164 && !byPhone) await c.query('update candidates set phone_e164 = $2 where id = $1', [candidateId, ctx.phone]);
        } else {
          const ins = (await c.query(
            `insert into candidates(first_name, last_name, phone_e164, email, ${verifiedField}, preferred_channel)
             values ($1,$2,$3,$4, now(), $5) returning id`,
            [ctx.firstName, ctx.lastName,
              ch.channel === 'email' && byPhone ? null : ctx.phone,
              ch.channel !== 'email' && byEmail ? null : ctx.email,
              ch.channel === 'email' ? 'email' : ch.channel],
          )).rows[0];
          candidateId = ins.id;
        }
        if (otherMatch && otherMatch.id !== candidateId) {
          // Coincidencia dudosa: no bloqueamos, se envía a revisión.
          await c.query(
            `insert into duplicate_reviews(candidate_id, matched_candidate_id, match_on, details) values ($1,$2,$3,$4)`,
            [candidateId, otherMatch.id, ch.channel === 'email' ? 'telefono' : 'correo', { nombreCapturado: `${ctx.firstName} ${ctx.lastName}` }],
          );
        }
        // Postulación: una por persona y vacante
        const existing = (await c.query('select id from applications where candidate_id = $1 and vacancy_id = $2', [candidateId, ctx.vacancyId])).rows[0];
        if (existing) {
          applicationId = existing.id;
          resumed = true;
          if (ctx.linkId) await c.query('update applications set last_source_id = (select source_id from tracking_links where id = $2), updated_at = now() where id = $1', [existing.id, ctx.linkId]);
        } else {
          const vac = (await c.query('select status from vacancies where id = $1', [ctx.vacancyId])).rows[0];
          if (vac.status !== 'publicada') return { error: conflict('Esta vacante ya no está recibiendo postulaciones') };
          const link = ctx.linkId ? (await c.query('select source_id, recruiter_id from tracking_links where id = $1', [ctx.linkId])).rows[0] : null;
          const sourceId = link?.source_id ?? (await c.query(`select id from sources where code = 'portal'`)).rows[0]?.id ?? null;
          const app = (await c.query(
            `insert into applications(candidate_id, vacancy_id, link_id, first_source_id, last_source_id, stage_code)
             values ($1,$2,$3,$4,$4,'nuevo_prospecto') returning id`,
            [candidateId, ctx.vacancyId, ctx.linkId, sourceId],
          )).rows[0];
          applicationId = app.id;
          await c.query(`insert into stage_history(application_id, from_code, to_code, actor_type, reason) values ($1,null,'nuevo_prospecto','system','Llegada por liga de reclutamiento')`, [app.id]);
          await moveStage(c, app.id, 'registro_iniciado', { actor: { type: 'candidate', id: candidateId }, reason: 'Identidad verificada por código' });
          const rid = await autoAssign(c, app.id, ctx.vacancyId, link?.recruiter_id);
          await notifyUser(c, rid, 'Nuevo candidato asignado', `${ctx.firstName} ${ctx.lastName}`, `/admin/postulaciones/${app.id}`);
          await c.query(`insert into tracking_events(link_id, vacancy_id, event) values ($1,$2,'otp_verified')`, [ctx.linkId, ctx.vacancyId]);
        }
      }
      const token = randomToken();
      await c.query(`insert into candidate_sessions(token_hash, candidate_id, expires_at) values ($1,$2, now() + interval '${SESSION_DAYS} days')`, [sha256(token), candidateId]);
      await audit(c, { type: 'candidate', id: candidateId, ip: req.ip }, ch.purpose === 'login' ? 'candidate.login' : 'candidate.apply_verified', 'candidate', candidateId, { applicationId, resumed });
      return { token, applicationId, resumed };
    });
    if ('error' in result) throw result.error;
    reply.setCookie(CANDIDATE_COOKIE, result.token, cookieOpts(SESSION_DAYS * 86400, 'lax'));
    return { applicationId: result.applicationId, resumed: result.resumed };
  });
}

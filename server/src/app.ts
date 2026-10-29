import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { MAX_PDF_BYTES } from './modules/documents.js';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError, forbidden, unauthorized } from './lib/errors.js';
import { pool } from './db.js';
import { sha256 } from './lib/crypto.js';
import { can, type Permission, type Role } from './lib/permissions.js';
import type { StaffUser } from './lib/scope.js';
import { config } from './config.js';
import { publicRoutes } from './routes/public.js';
import { portalRoutes } from './routes/portal.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { scheduleRoutes } from './routes/schedule.js';
import { reportRoutes } from './routes/reports.js';

declare module 'fastify' {
  interface FastifyRequest {
    staff?: StaffUser & { csrf: string; sessionId: string };
    candidateId?: string;
  }
}

export const STAFF_COOKIE = 'staff_sid';
export const CANDIDATE_COOKIE = 'cand_sid';

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export async function loadStaff(req: FastifyRequest) {
  const token = req.cookies[STAFF_COOKIE];
  if (!token) return;
  const r = await pool.query(
    `select s.id as session_id, s.csrf_token, u.id, u.role, u.team_id, u.full_name, u.email
       from staff_sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.is_active`,
    [sha256(token)],
  );
  const u = r.rows[0];
  if (u) req.staff = { id: u.id, role: u.role as Role, teamId: u.team_id, fullName: u.full_name, email: u.email, csrf: u.csrf_token, sessionId: u.session_id };
}

export async function loadCandidate(req: FastifyRequest) {
  const token = req.cookies[CANDIDATE_COOKIE];
  if (!token) return;
  const r = await pool.query(
    `select s.candidate_id from candidate_sessions s join candidates c on c.id = s.candidate_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and c.anonymized_at is null`,
    [sha256(token)],
  );
  if (r.rows[0]) req.candidateId = r.rows[0].candidate_id;
}

/** Exige sesión de staff y, opcionalmente, un permiso. */
export function requireStaff(req: FastifyRequest, perm?: Permission): StaffUser {
  if (!req.staff) throw unauthorized();
  if (perm && !can(req.staff.role, perm)) throw forbidden();
  return req.staff;
}

export function requireCandidate(req: FastifyRequest): string {
  if (!req.candidateId) throw unauthorized('Tu sesión expiró. Ingresa de nuevo con tu teléfono o correo.');
  return req.candidateId;
}

export function cookieOpts(maxAgeSec: number, sameSite: 'strict' | 'lax') {
  return { path: '/', httpOnly: true, secure: config.isProduction, sameSite, maxAge: maxAgeSec } as const;
}

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ? { redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]'] } : false, trustProxy: true, bodyLimit: 1_000_000 });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 5, parts: 6 } });

  // Cabeceras de seguridad básicas
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    // En producción no se permite incrustar la app; en desarrollo sí (vistas previas como la de Replit)
    if (config.isProduction) reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
  });

  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    // Protección CSRF 1: toda petición que modifica datos exige una cabecera personalizada
    // (los formularios de otros sitios no pueden enviarla sin una petición CORS, que no permitimos).
    if (mutating && req.headers['x-requested-with'] !== 'crm') throw forbidden('Petición no permitida');
    if (req.url.startsWith('/api/admin/')) {
      await loadStaff(req);
      // Protección CSRF 2: token por sesión para el panel administrativo
      if (mutating && req.staff && req.headers['x-csrf-token'] !== req.staff.csrf) throw forbidden('Token CSRF inválido');
    }
    if (req.url.startsWith('/api/portal/')) await loadCandidate(req);
  });

  app.setErrorHandler((err: any, req, reply: FastifyReply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'validacion', message: 'Revisa los datos capturados', fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
    if (err.code === '23505') return reply.status(409).send({ error: 'conflicto', message: 'El registro ya existe o entra en conflicto con otro' });
    if (err.code === '23P01') return reply.status(409).send({ error: 'conflicto', message: 'El horario se traslapa con otro del mismo entrevistador' });
    if (err.code === '23514' || err.code === '22P02' || err.code === '23503') return reply.status(400).send({ error: 'solicitud_invalida', message: 'Datos no válidos' });
    if (err.statusCode === 413 || err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.status(413).send({ error: 'archivo_grande', message: 'El archivo pesa más de 5 MB. Reduce su tamaño e inténtalo de nuevo.' });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: 'solicitud_invalida', message: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'error_interno', message: 'Ocurrió un error inesperado. Intenta de nuevo.' });
  });

  app.get('/api/health', async () => {
    await pool.query('select 1');
    return { ok: true, deliveryMode: config.deliveryMode };
  });

  await app.register(publicRoutes, { prefix: '/api/public' });
  await app.register(portalRoutes, { prefix: '/api/portal' });
  await app.register(authRoutes, { prefix: '/api/admin/auth' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(scheduleRoutes, { prefix: '/api/admin' });
  await app.register(reportRoutes, { prefix: '/api/admin' });

  // Sirve el frontend compilado (producción)
  const webDist = path.resolve(config.rootDir, '..', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: true });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/assets/')) return reply.status(404).send({ error: 'no_encontrado', message: 'Ruta no encontrada' });
      return reply.type('text/html').sendFile('index.html');
    });
  }
  return app;
}

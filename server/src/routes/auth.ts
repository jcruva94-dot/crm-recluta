import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, one } from '../db.js';
import { STAFF_COOKIE, cookieOpts, parse, requireStaff } from '../app.js';
import { randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { AppError, unauthorized } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { rolePermissions, roleLabels } from '../lib/permissions.js';
import { config } from '../config.js';

const SESSION_HOURS = 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (req, reply) => {
    const b = parse(z.object({ email: z.string().trim().toLowerCase().email('Correo no válido'), password: z.string().min(1).max(200) }), req.body);
    const u = await one(pool, 'select * from users where email = $1', [b.email]);
    const generic = unauthorized('Correo o contraseña incorrectos');
    if (!u || !u.is_active) {
      await verifyPassword(b.password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==').catch(() => false); // tiempo constante aproximado
      throw generic;
    }
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      throw new AppError(423, 'cuenta_bloqueada', `Cuenta bloqueada temporalmente por intentos fallidos. Intenta en ${LOCK_MINUTES} minutos.`);
    }
    if (!(await verifyPassword(b.password, u.password_hash))) {
      const failed = u.failed_logins + 1;
      const lock = failed >= MAX_FAILED;
      await pool.query(`update users set failed_logins = $2, locked_until = case when $3 then now() + interval '${LOCK_MINUTES} minutes' else null end where id = $1`, [u.id, lock ? 0 : failed, lock]);
      await audit(pool, { type: 'user', id: u.id, ip: req.ip }, 'auth.login_failed', 'user', u.id);
      throw generic;
    }
    const token = randomToken();
    const csrf = randomToken(24);
    await pool.query(`insert into staff_sessions(token_hash, csrf_token, user_id, expires_at, ip) values ($1,$2,$3, now() + interval '${SESSION_HOURS} hours', $4)`, [sha256(token), csrf, u.id, req.ip]);
    await pool.query('update users set failed_logins = 0, locked_until = null, last_login_at = now() where id = $1', [u.id]);
    await audit(pool, { type: 'user', id: u.id, ip: req.ip }, 'auth.login', 'user', u.id);
    reply.setCookie(STAFF_COOKIE, token, cookieOpts(SESSION_HOURS * 3600, 'strict'));
    return { csrfToken: csrf };
  });

  app.post('/logout', async (req, reply) => {
    if (req.staff) await pool.query('update staff_sessions set revoked_at = now() where id = $1', [req.staff.sessionId]);
    reply.clearCookie(STAFF_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const u = requireStaff(req);
    return {
      user: { id: u.id, fullName: u.fullName, email: u.email, role: u.role, roleLabel: roleLabels[u.role], teamId: u.teamId },
      permissions: rolePermissions[u.role],
      csrfToken: req.staff!.csrf,
      deliveryMode: config.deliveryMode,
      publicBaseUrl: config.publicBaseUrl,
    };
  });
}

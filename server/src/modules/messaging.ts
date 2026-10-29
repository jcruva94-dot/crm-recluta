import type { Db } from '../db.js';
import { config } from '../config.js';

/**
 * Bandeja de salida. En modo sandbox NO se envía nada: el mensaje queda con estado "simulado"
 * y así se muestra en el panel. Un proveedor real (WhatsApp Business, SMS, SMTP) debe implementar
 * `DeliveryProvider` y procesar los mensajes "pendiente" (ver docs/PENDIENTES.md).
 */
export interface DeliveryProvider {
  name: string;
  send(msg: { channel: string; destination: string; subject?: string | null; body: string }): Promise<void>;
}

export type Channel = 'sms' | 'whatsapp' | 'email';

export interface OutgoingMessage {
  candidateId?: string | null;
  channel: Channel;
  destination: string;
  template: string;
  subject?: string;
  body: string;
  idempotencyKey?: string;
  transactional?: boolean; // OTP y confirmaciones de citas solicitadas por el candidato
}

export async function queueMessage(db: Db, m: OutgoingMessage): Promise<{ id: string; status: string } | null> {
  if (m.candidateId && !m.transactional) {
    const c = await db.query('select do_not_contact from candidates where id = $1', [m.candidateId]);
    if (c.rows[0]?.do_not_contact) return null; // respeta solicitud de no contacto
  }
  const sandbox = config.deliveryMode === 'sandbox';
  const r = await db.query(
    `insert into outbox_messages(candidate_id, channel, destination, template_code, subject, body, status, provider, idempotency_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (idempotency_key) do nothing
     returning id, status`,
    [m.candidateId ?? null, m.channel, m.destination, m.template, m.subject ?? null, m.body, sandbox ? 'simulado' : 'pendiente', sandbox ? 'sandbox' : config.deliveryMode, m.idempotencyKey ?? null],
  );
  return r.rows[0] ?? null;
}

export async function notifyUser(db: Db, userId: string | null | undefined, title: string, body: string, link?: string) {
  if (!userId) return;
  await db.query('insert into notifications(user_id, title, body, link) values ($1,$2,$3,$4)', [userId, title, body, link ?? null]);
}

export function preferredDestination(c: { phone_e164: string | null; email: string | null; preferred_channel: string }): { channel: Channel; destination: string } | null {
  if (c.preferred_channel === 'email' && c.email) return { channel: 'email', destination: c.email };
  if (c.phone_e164) return { channel: c.preferred_channel === 'sms' ? 'sms' : 'whatsapp', destination: c.phone_e164 };
  if (c.email) return { channel: 'email', destination: c.email };
  return null;
}

export async function messageCandidate(db: Db, candidateId: string, template: string, subject: string, body: string, idempotencyKey: string, transactional = false) {
  const c = await db.query('select phone_e164, email, preferred_channel from candidates where id = $1', [candidateId]);
  const dest = c.rows[0] && preferredDestination(c.rows[0]);
  if (!dest) return null;
  return queueMessage(db, { candidateId, ...dest, template, subject, body, idempotencyKey, transactional });
}

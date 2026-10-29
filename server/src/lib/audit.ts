import type { Db } from '../db.js';

export interface Actor {
  type: 'user' | 'candidate' | 'system';
  id?: string | null;
  ip?: string | null;
}

export async function audit(db: Db, actor: Actor, action: string, entityType: string | null, entityId: string | null, details: Record<string, unknown> = {}) {
  await db.query(
    'insert into audit_log(actor_type, actor_id, action, entity_type, entity_id, details, ip) values ($1,$2,$3,$4,$5,$6,$7)',
    [actor.type, actor.id ?? null, action, entityType, entityId, details, actor.ip ?? null],
  );
}

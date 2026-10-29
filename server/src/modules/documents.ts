import type { PoolClient } from 'pg';
import crypto from 'node:crypto';
import type { Db } from '../db.js';
import { audit, type Actor } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { messageCandidate, notifyUser } from './messaging.js';

export const MAX_PDF_BYTES = 5 * 1024 * 1024;

export const DOC_STATUS_LABEL: Record<string, string> = {
  no_solicitado: 'No solicitado', solicitado: 'Pendiente de subir', recibido: 'Recibido, en revisión', en_revision: 'En revisión',
  aprobado: 'Aprobado', requiere_correccion: 'Requiere corrección', rechazado: 'Rechazado', vencido: 'Vencido',
};

/** Estados en los que el candidato puede (re)subir el archivo. */
export const CANDIDATE_CAN_UPLOAD = ['solicitado', 'requiere_correccion', 'vencido'];

/** Marca como vencidos los documentos aprobados cuya vigencia ya pasó. */
export async function expireDocuments(db: Db, applicationId: string) {
  await db.query(`update application_documents set status = 'vencido' where application_id = $1 and status = 'aprobado' and expires_at is not null and expires_at < current_date`, [applicationId]);
}

export async function requestDocuments(c: PoolClient, applicationId: string, typeIds: string[], actor: Actor) {
  if (!typeIds.length) return 0;
  const r = await c.query(
    `insert into application_documents(application_id, document_type_id, status, requested_by)
     select $1, d.id, 'solicitado', $3 from document_types d where d.id = any($2) and d.is_active
     on conflict (application_id, document_type_id) do update
       set status = 'solicitado', requested_at = now(), requested_by = excluded.requested_by, rejection_reason = null
       where application_documents.status in ('no_solicitado','rechazado','vencido')
     returning id`,
    [applicationId, typeIds, actor.type === 'user' ? actor.id : null],
  );
  if (r.rowCount) {
    const a = (await c.query('select candidate_id from applications where id = $1', [applicationId])).rows[0];
    await messageCandidate(c, a.candidate_id, 'documentos_solicitados', 'Documentos para tu proceso',
      `Para continuar tu proceso necesitamos ${r.rowCount} documento(s) en PDF. Súbelos desde tu portal, sección "Mis documentos".`,
      `docs:${applicationId}:${Date.now()}`);
    await audit(c, actor, 'documents.request', 'application', applicationId, { count: r.rowCount });
  }
  return r.rowCount ?? 0;
}

/** Valida que el archivo sea realmente un PDF (firma %PDF-), no solo por extensión. */
export function validatePdf(buf: Buffer, filename: string) {
  if (!buf.length) throw badRequest('El archivo está vacío');
  if (buf.length > MAX_PDF_BYTES) throw badRequest('El archivo pesa más de 5 MB. Reduce su tamaño e inténtalo de nuevo.');
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw badRequest('El archivo no es un PDF válido. Si tomaste una foto, conviértela a PDF (por ejemplo con la cámara de tu celular en modo "escanear documento").');
  const safe = filename.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(0, 120) || 'documento.pdf';
  return safe.toLowerCase().endsWith('.pdf') ? safe : safe + '.pdf';
}

export async function storeUpload(c: PoolClient, documentId: string, buf: Buffer, filename: string, candidateId: string) {
  const d = (await c.query('select d.*, t.name type_name, a.recruiter_id, a.candidate_id from application_documents d join document_types t on t.id = d.document_type_id join applications a on a.id = d.application_id where d.id = $1 for update of d', [documentId])).rows[0];
  if (!CANDIDATE_CAN_UPLOAD.includes(d.status)) throw badRequest(d.status === 'aprobado' ? 'Este documento ya fue aprobado.' : 'Este documento ya está en revisión.');
  const safe = validatePdf(buf, filename);
  const version = d.current_version + 1;
  await c.query(
    `insert into document_files(document_id, version, filename, mime, size_bytes, sha256, content) values ($1,$2,$3,'application/pdf',$4,$5,$6)`,
    [documentId, version, safe, buf.length, crypto.createHash('sha256').update(buf).digest('hex'), buf],
  );
  await c.query(`update application_documents set status = 'recibido', received_at = now(), current_version = $2, rejection_reason = null where id = $1`, [documentId, version]);
  await c.query(
    `insert into tasks(application_id, type, title, assignee_id, due_at, priority, auto_key) values ($1,'validar_documentos',$2,$3, now() + interval '24 hours','media',$4) on conflict do nothing`,
    [d.application_id, `Validar documento: ${d.type_name}`, d.recruiter_id, `doc:${documentId}:v${version}`],
  );
  await notifyUser(c, d.recruiter_id, 'Documento recibido', d.type_name, `/admin/postulaciones/${d.application_id}`);
  await audit(c, { type: 'candidate', id: candidateId }, 'document.upload', 'application', d.application_id, { documentId, version, bytes: buf.length });
  return { version };
}

export async function reviewDocument(c: PoolClient, documentId: string, status: 'aprobado' | 'requiere_correccion' | 'rechazado', reason: string | undefined, expiresAt: string | undefined, actor: Actor) {
  const d = (await c.query('select d.*, t.name type_name, t.has_expiry, a.candidate_id, a.recruiter_id from application_documents d join document_types t on t.id = d.document_type_id join applications a on a.id = d.application_id where d.id = $1 for update of d', [documentId])).rows[0];
  if (!['recibido', 'en_revision'].includes(d.status)) throw badRequest('Solo se pueden revisar documentos recibidos');
  if (status !== 'aprobado' && (!reason || reason.trim().length < 5)) throw badRequest('Explica al candidato qué debe corregir (mínimo 5 caracteres)');
  await c.query(
    `update application_documents set status = $2, rejection_reason = $3, reviewed_at = now(), reviewed_by = $4, expires_at = $5 where id = $1`,
    [documentId, status, status === 'aprobado' ? null : reason, actor.id, status === 'aprobado' ? expiresAt ?? null : null],
  );
  await c.query(`update tasks set status = 'completada', completed_at = now() where application_id = $1 and auto_key like $2 and status in ('pendiente','en_proceso')`, [d.application_id, `doc:${documentId}:%`]);
  if (status !== 'aprobado') {
    await messageCandidate(c, d.candidate_id, 'documento_correccion', 'Revisa tu documento',
      `Tu documento "${d.type_name}" necesita atención: ${reason}. Súbelo de nuevo desde tu portal.`, `docrev:${documentId}:v${d.current_version}`);
  }
  // ¿Quedó completa la documentación solicitada?
  const pending = (await c.query(`select count(*)::int n from application_documents where application_id = $1 and status not in ('aprobado','no_solicitado')`, [d.application_id])).rows[0].n;
  if (pending === 0) await notifyUser(c, d.recruiter_id, 'Documentación completa', 'Todos los documentos solicitados están aprobados', `/admin/postulaciones/${d.application_id}`);
  await audit(c, actor, 'document.review', 'application', d.application_id, { documentId, status, version: d.current_version });
  return { allApproved: pending === 0 };
}

export async function listDocuments(db: Db, applicationId: string) {
  await expireDocuments(db, applicationId);
  return (await db.query(
    `select d.id, d.status, d.requested_at, d.received_at, d.reviewed_at, d.rejection_reason, d.expires_at, d.current_version,
            t.id type_id, t.code, t.name, t.instructions, t.has_expiry, u.full_name reviewed_by_name,
            (select json_agg(json_build_object('version', f.version, 'filename', f.filename, 'size', f.size_bytes, 'uploadedAt', f.uploaded_at) order by f.version desc)
               from document_files f where f.document_id = d.id) files
       from application_documents d join document_types t on t.id = d.document_type_id left join users u on u.id = d.reviewed_by
      where d.application_id = $1 and d.status <> 'no_solicitado' order by t.position`, [applicationId])).rows;
}

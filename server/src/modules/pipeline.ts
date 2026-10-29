import type { PoolClient } from 'pg';
import { audit, type Actor } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';

export interface MoveOptions {
  actor: Actor;
  expectedStage?: string;
  reason?: string;
  closureReasonId?: string;
  comment?: string;
  nextAction?: string;
  override?: boolean;
  canOverride?: boolean;
}

const TASK_ON_ENTER: Record<string, { type: string; title: string; hours: number; priority: 'alta' | 'media' | 'baja' }> = {
  contacto_pendiente: { type: 'contactar', title: 'Contactar al candidato y confirmar interés', hours: 24, priority: 'alta' },
  revision_compatibilidad: { type: 'revisar_perfil', title: 'Revisar resultado de precalificación', hours: 24, priority: 'media' },
  entrevista_realizada: { type: 'entrevistar', title: 'Registrar decisión posterior a la entrevista', hours: 24, priority: 'media' },
  documentacion_pendiente: { type: 'validar_documentos', title: 'Solicitar y validar documentación', hours: 72, priority: 'media' },
  oferta: { type: 'emitir_oferta', title: 'Emitir y dar seguimiento a la oferta', hours: 48, priority: 'alta' },
};

/** Cambia la etapa de una postulación dentro de una transacción ya abierta. */
export async function moveStage(c: PoolClient, applicationId: string, toCode: string, o: MoveOptions) {
  const app = (await c.query('select * from applications where id = $1 for update', [applicationId])).rows[0];
  if (!app) throw notFound('Postulación no encontrada');
  if (o.expectedStage && app.stage_code !== o.expectedStage) {
    throw conflict('La postulación cambió de etapa mientras la consultabas. Actualiza la vista.', { currentStage: app.stage_code });
  }
  if (app.stage_code === toCode) throw badRequest('La postulación ya está en esa etapa');
  const to = (await c.query('select * from pipeline_stages where code = $1 and is_active', [toCode])).rows[0];
  if (!to) throw badRequest('Etapa destino no válida');

  const allowed = (await c.query('select 1 from stage_transitions where from_code = $1 and to_code = $2', [app.stage_code, toCode])).rowCount;
  let isOverride = false;
  if (!allowed) {
    if (!o.override) throw badRequest(`Transición no permitida: ${app.stage_code} → ${toCode}`, { code: 'transicion_invalida' });
    if (!o.canOverride) throw forbidden('Solo un gerente o administrador puede autorizar esta excepción');
    if (!o.reason || o.reason.trim().length < 5) throw badRequest('Una excepción requiere un motivo de al menos 5 caracteres');
    isOverride = true;
  }
  if (to.requires_reason) {
    if (!o.closureReasonId) throw badRequest('Esta etapa requiere seleccionar un motivo');
    const ok = (await c.query('select 1 from closure_reasons where id = $1 and stage_code = $2', [o.closureReasonId, toCode])).rowCount;
    if (!ok) throw badRequest('El motivo no corresponde a la etapa');
  }

  // Cierra tareas automáticas de la etapa que se abandona
  const closing = ['cerrado', 'reserva'].includes(to.category);
  await c.query(
    `update tasks set status = $3, completed_at = now()
     where application_id = $1 and status in ('pendiente','en_proceso') and ($4::boolean or auto_key like $2)`,
    [applicationId, `${applicationId}:${app.stage_code}:%`, closing ? 'cancelada' : 'completada', closing],
  );

  await c.query(
    `update applications set stage_code = $2, stage_entered_at = now(), version = version + 1, updated_at = now(),
       closure_reason_id = $3, next_action = coalesce($4, next_action)
     where id = $1`,
    [applicationId, toCode, to.requires_reason ? o.closureReasonId : null, o.nextAction ?? null],
  );
  const h = (await c.query(
    `insert into stage_history(application_id, from_code, to_code, actor_type, user_id, reason, closure_reason_id, comment, next_action, is_override)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [applicationId, app.stage_code, toCode, o.actor.type, o.actor.type === 'user' ? o.actor.id : null, o.reason ?? null, o.closureReasonId ?? null, o.comment ?? null, o.nextAction ?? null, isOverride],
  )).rows[0];

  const t = TASK_ON_ENTER[toCode];
  if (t) {
    await c.query(
      `insert into tasks(application_id, type, title, assignee_id, due_at, priority, auto_key)
       values ($1,$2,$3,$4, now() + ($5 || ' hours')::interval, $6, $7) on conflict (auto_key) do nothing`,
      [applicationId, t.type, t.title, app.recruiter_id, String(t.hours), t.priority, `${applicationId}:${toCode}:${t.type}:${h.id}`],
    );
  }
  await audit(c, o.actor, isOverride ? 'pipeline.override' : 'pipeline.move', 'application', applicationId, { from: app.stage_code, to: toCode, reason: o.reason ?? null });
  return { from: app.stage_code, to: toCode, isOverride };
}

/** Asigna reclutador según la estrategia de la vacante. Devuelve el id asignado o null. */
export async function autoAssign(c: PoolClient, applicationId: string, vacancyId: string, preferredRecruiterId?: string | null) {
  const v = (await c.query('select assignment_strategy from vacancies where id = $1', [vacancyId])).rows[0];
  let recruiterId: string | null = null;
  if (preferredRecruiterId) {
    const ok = await c.query(`select 1 from vacancy_recruiters vr join users u on u.id = vr.user_id where vr.vacancy_id = $1 and vr.user_id = $2 and u.is_active`, [vacancyId, preferredRecruiterId]);
    if (ok.rowCount) recruiterId = preferredRecruiterId; // liga personal del reclutador
  }
  if (!recruiterId) {
    const order = v?.assignment_strategy === 'rotativa'
      ? `(select max(a2.created_at) from applications a2 where a2.recruiter_id = u.id and a2.vacancy_id = $1) asc nulls first, u.id`
      : `(select count(*) from applications a2 join pipeline_stages ps on ps.code = a2.stage_code where a2.recruiter_id = u.id and ps.category = 'activo') asc, u.id`;
    const r = await c.query(
      `select u.id from vacancy_recruiters vr join users u on u.id = vr.user_id
       where vr.vacancy_id = $1 and u.is_active and u.role in ('reclutador','coordinador','gerente')
       order by ${order} limit 1`,
      [vacancyId],
    );
    recruiterId = r.rows[0]?.id ?? null;
  }
  if (recruiterId) await c.query('update applications set recruiter_id = $2 where id = $1', [applicationId, recruiterId]);
  return recruiterId;
}

export const CANDIDATE_STEPS = ['Registro', 'Precalificación', 'Entrevista', 'Validación y documentos', 'Oferta', 'Ingreso'];

export const CANDIDATE_STATUS: Record<string, { title: string; message: string }> = {
  nuevo_prospecto: { title: 'Registro en curso', message: 'Completa tu registro para continuar.' },
  registro_iniciado: { title: 'Registro en curso', message: 'Acepta el aviso de privacidad y completa tus datos para continuar.' },
  registro_completado: { title: 'Registro completo', message: 'Tu registro está completo.' },
  precalificacion_pendiente: { title: 'Responde unas preguntas', message: 'Contesta las preguntas de la vacante. Toma de 2 a 4 minutos y puedes guardar y continuar después.' },
  precalificacion_completada: { title: 'Respuestas recibidas', message: 'Recibimos tus respuestas.' },
  revision_compatibilidad: { title: 'Tu perfil está en revisión', message: 'Un reclutador revisará tus respuestas y te contactará por tu medio preferido.' },
  contacto_pendiente: { title: 'Agenda tu entrevista', message: 'Elige un horario disponible para tu entrevista. Si prefieres, un reclutador te contactará.' },
  entrevista_agendada: { title: 'Entrevista agendada', message: 'Revisa los detalles de tu cita. Puedes confirmarla, reprogramarla o cancelarla.' },
  entrevista_realizada: { title: 'Entrevista realizada', message: 'Gracias por asistir. Te informaremos el siguiente paso.' },
  evaluacion: { title: 'Evaluación', message: 'Tu proceso continúa con una evaluación. Te enviaremos instrucciones.' },
  entrevista_supervisor: { title: 'Entrevista adicional', message: 'Tendrás una entrevista con el área operativa. Te contactaremos para agendarla.' },
  validacion_requisitos: { title: 'Validación de requisitos', message: 'Estamos validando la información de tu proceso.' },
  documentacion_pendiente: { title: 'Documentación', message: 'Te pediremos algunos documentos para continuar.' },
  oferta: { title: 'Oferta laboral', message: 'Tienes una propuesta en revisión. Tu reclutador te dará los detalles.' },
  oferta_aceptada: { title: 'Oferta aceptada', message: 'Estamos preparando tu ingreso.' },
  contratacion_confirmada: { title: 'Contratación confirmada', message: 'Bienvenido. Te enviaremos los detalles de tu inducción.' },
  onboarding: { title: 'Inducción', message: 'Estás en etapa de inducción y capacitación.' },
  ingreso_efectivo: { title: 'Ingreso confirmado', message: 'Tu ingreso está confirmado. ¡Éxito!' },
  rechazado: { title: 'Proceso concluido', message: 'Gracias por tu interés. En esta ocasión no continuaremos con tu proceso para esta vacante. Puedes postularte a otras vacantes.' },
  retirado: { title: 'Proceso cerrado', message: 'Cerraste tu proceso para esta vacante. Si cambias de opinión, contáctanos desde Ayuda.' },
  no_localizado: { title: 'No pudimos contactarte', message: 'Intentamos comunicarnos contigo sin éxito. Si sigues interesado, solicita ayuda para retomar tu proceso.' },
  abandono: { title: 'Proceso en pausa', message: 'Tu proceso se pausó. Si sigues interesado, solicita ayuda para retomarlo.' },
  reserva: { title: 'En reserva de talento', message: 'Tu perfil queda en nuestra reserva de talento para futuras vacantes.' },
};

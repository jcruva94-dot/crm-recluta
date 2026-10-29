import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, many, one } from '../db.js';
import { parse, requireStaff } from '../app.js';
import { applicationScope, vacancyScope } from '../lib/scope.js';
import { config } from '../config.js';

const uuid = z.string().uuid();

/** Definiciones explícitas de cada KPI (se devuelven con los datos). */
export const KPI_DEFINITIONS = {
  postulaciones: { tipo: 'volumen', formula: 'count(postulaciones creadas en el periodo)', fuente: 'applications.created_at' },
  candidatos_unicos: { tipo: 'volumen', formula: 'count(distinct candidate_id) de las postulaciones del periodo', fuente: 'applications' },
  registros_completados: { tipo: 'volumen', formula: 'postulaciones del periodo con registration_completed_at', fuente: 'applications' },
  precalificados: { tipo: 'volumen', formula: 'postulaciones del periodo con precalificación enviada', fuente: 'applications.prequal_completed_at' },
  entrevistas_agendadas: { tipo: 'volumen', formula: 'postulaciones del periodo con al menos una cita creada', fuente: 'interviews' },
  entrevistas_realizadas: { tipo: 'volumen', formula: 'postulaciones del periodo con una cita en estado realizada', fuente: 'interviews' },
  contrataciones: { tipo: 'volumen', formula: 'postulaciones del periodo que alcanzaron "Contratación confirmada" (historial)', fuente: 'stage_history' },
  ingresos_efectivos: { tipo: 'volumen', formula: 'postulaciones del periodo que alcanzaron "Ingreso efectivo" (historial). Una oferta aceptada NO cuenta como ingreso.', fuente: 'stage_history' },
  conv_registro: { tipo: 'calidad', formula: 'registros_completados / postulaciones', fuente: 'cohorte del periodo' },
  conv_precalificacion: { tipo: 'calidad', formula: 'precalificados / registros_completados', fuente: 'cohorte del periodo' },
  tasa_compatibles: { tipo: 'calidad', formula: '(compatible + compatible_con_observaciones) / precalificados', fuente: 'cohorte del periodo' },
  conv_agenda: { tipo: 'calidad', formula: 'entrevistas_agendadas / postulaciones que llegaron a "Contacto pendiente"', fuente: 'cohorte del periodo' },
  tasa_asistencia: { tipo: 'calidad', formula: 'citas realizadas / (citas realizadas + citas no asistidas), citas de la cohorte', fuente: 'interviews' },
  tasa_inasistencia: { tipo: 'calidad', formula: 'citas no asistidas / (citas realizadas + citas no asistidas)', fuente: 'interviews' },
  horas_a_precalificacion: { tipo: 'velocidad', formula: 'mediana(prequal_completed_at − created_at) en horas', fuente: 'applications' },
  horas_a_primera_cita: { tipo: 'velocidad', formula: 'mediana(primera cita creada − created_at) en horas', fuente: 'interviews' },
  horas_a_primer_contacto: { tipo: 'velocidad', formula: 'mediana(primer contacto registrado por reclutador − created_at) en horas', fuente: 'notes (tipo contacto)' },
  costo_por_contratacion: { tipo: 'costo', formula: 'gasto de captación / contrataciones — PENDIENTE: requiere registro de gasto por campaña (fase 4)', fuente: 'no disponible' },
} as const;

const filters = z.object({
  from: z.string().date(), to: z.string().date(),
  vacancyId: uuid.optional(), sourceId: uuid.optional(), recruiterId: uuid.optional(), campaignId: uuid.optional(),
});

export async function reportRoutes(app: FastifyInstance) {
  app.get('/dashboard', async (req) => {
    const u = requireStaff(req, 'dashboard.read');
    const f = parse(filters, req.query);
    const params: unknown[] = [f.from, f.to];
    const where = [
      `a.created_at >= ($1::date)::timestamp at time zone '${config.timezone}'`,
      `a.created_at < ($2::date + 1)::timestamp at time zone '${config.timezone}'`,
      applicationScope(u, params),
    ];
    if (f.vacancyId) { params.push(f.vacancyId); where.push(`a.vacancy_id = $${params.length}`); }
    if (f.sourceId) { params.push(f.sourceId); where.push(`a.first_source_id = $${params.length}`); }
    if (f.recruiterId) { params.push(f.recruiterId); where.push(`a.recruiter_id = $${params.length}`); }
    if (f.campaignId) { params.push(f.campaignId); where.push(`a.vacancy_id in (select id from vacancies where campaign_id = $${params.length})`); }

    const cohort = `with cohort as (
      select a.*,
        exists(select 1 from stage_history h where h.application_id = a.id and h.to_code = 'contacto_pendiente') reached_contact,
        exists(select 1 from interviews i where i.application_id = a.id) booked,
        exists(select 1 from interviews i where i.application_id = a.id and i.status = 'realizada') attended,
        (select count(*) from interviews i where i.application_id = a.id and i.status = 'realizada') n_attended,
        (select count(*) from interviews i where i.application_id = a.id and i.status = 'no_asistio') n_noshow,
        (select min(i.created_at) from interviews i where i.application_id = a.id) first_booking,
        (select min(n.created_at) from notes n where n.application_id = a.id and n.kind = 'contacto') first_contact,
        exists(select 1 from stage_history h where h.application_id = a.id and h.to_code = 'oferta') offered,
        exists(select 1 from stage_history h where h.application_id = a.id and h.to_code = 'oferta_aceptada') accepted,
        exists(select 1 from stage_history h where h.application_id = a.id and h.to_code = 'contratacion_confirmada') hired,
        exists(select 1 from stage_history h where h.application_id = a.id and h.to_code = 'ingreso_efectivo') started
      from applications a where ${where.join(' and ')})`;

    const totals = await one(pool, `${cohort}
      select count(*)::int postulaciones, count(distinct candidate_id)::int candidatos_unicos,
        count(*) filter (where registration_completed_at is not null)::int registros_completados,
        count(*) filter (where prequal_completed_at is not null)::int precalificados,
        count(*) filter (where prequal_result = 'compatible')::int compatible,
        count(*) filter (where prequal_result = 'compatible_con_observaciones')::int compatible_con_observaciones,
        count(*) filter (where prequal_result = 'requiere_revision')::int requiere_revision,
        count(*) filter (where prequal_result = 'no_cumple')::int no_cumple,
        count(*) filter (where reached_contact)::int llegaron_contacto,
        count(*) filter (where booked)::int entrevistas_agendadas,
        count(*) filter (where attended)::int entrevistas_realizadas,
        coalesce(sum(n_attended),0)::int citas_realizadas, coalesce(sum(n_noshow),0)::int citas_no_asistidas,
        count(*) filter (where offered)::int ofertas, count(*) filter (where accepted)::int ofertas_aceptadas,
        count(*) filter (where hired)::int contrataciones, count(*) filter (where started)::int ingresos_efectivos,
        percentile_cont(0.5) within group (order by extract(epoch from prequal_completed_at - created_at)/3600) filter (where prequal_completed_at is not null) horas_a_precalificacion,
        percentile_cont(0.5) within group (order by extract(epoch from first_booking - created_at)/3600) filter (where first_booking is not null) horas_a_primera_cita,
        percentile_cont(0.5) within group (order by extract(epoch from first_contact - created_at)/3600) filter (where first_contact is not null) horas_a_primer_contacto
      from cohort`, params);

    const ratio = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
    const t = totals!;
    const conversions = {
      conv_registro: { value: ratio(t.registros_completados, t.postulaciones), num: t.registros_completados, den: t.postulaciones },
      conv_precalificacion: { value: ratio(t.precalificados, t.registros_completados), num: t.precalificados, den: t.registros_completados },
      tasa_compatibles: { value: ratio(t.compatible + t.compatible_con_observaciones, t.precalificados), num: t.compatible + t.compatible_con_observaciones, den: t.precalificados },
      conv_agenda: { value: ratio(t.entrevistas_agendadas, t.llegaron_contacto), num: t.entrevistas_agendadas, den: t.llegaron_contacto },
      tasa_asistencia: { value: ratio(t.citas_realizadas, t.citas_realizadas + t.citas_no_asistidas), num: t.citas_realizadas, den: t.citas_realizadas + t.citas_no_asistidas },
      tasa_inasistencia: { value: ratio(t.citas_no_asistidas, t.citas_realizadas + t.citas_no_asistidas), num: t.citas_no_asistidas, den: t.citas_realizadas + t.citas_no_asistidas },
    };

    const bySource = await many(pool, `${cohort}
      select coalesce(s.name, 'Sin fuente') fuente, count(*)::int postulaciones, count(*) filter (where registration_completed_at is not null)::int completados,
        count(*) filter (where prequal_result in ('compatible','compatible_con_observaciones'))::int elegibles,
        count(*) filter (where attended)::int entrevistas_realizadas, count(*) filter (where hired)::int contrataciones
      from cohort left join sources s on s.id = cohort.first_source_id group by 1 order by 2 desc`, params);

    const byRecruiter = await many(pool, `${cohort}
      select coalesce(u.full_name, 'Sin asignar') reclutador, cohort.recruiter_id, count(*)::int postulaciones,
        count(*) filter (where first_contact is not null)::int contactados,
        count(*) filter (where attended)::int entrevistas_realizadas, count(*) filter (where hired)::int contrataciones
      from cohort left join users u on u.id = cohort.recruiter_id group by 1,2 order by 3 desc`, params);

    // Fotografía actual (no depende del periodo): carga activa por etapa
    const sp: unknown[] = [];
    const scond = applicationScope(u, sp);
    const vf: string[] = [];
    if (f.vacancyId) { sp.push(f.vacancyId); vf.push(`a.vacancy_id = $${sp.length}`); }
    const byStage = await many(pool,
      `select ps.code, ps.name, ps.category, ps.position, count(a.id)::int total,
              count(a.id) filter (where ps.sla_hours is not null and a.stage_entered_at < now() - (ps.sla_hours || ' hours')::interval)::int estancados
         from pipeline_stages ps left join applications a on a.stage_code = ps.code and ${scond} ${vf.length ? 'and ' + vf.join(' and ') : ''}
        where ps.is_active group by ps.code order by ps.position`, sp);

    const vp: unknown[] = [];
    const vcond = vacancyScope(u, vp);
    const goals = await many(pool,
      `select v.id, v.title, v.status, v.hire_goal, v.target_fill_date,
              (select count(distinct h.application_id)::int from stage_history h join applications a on a.id = h.application_id where a.vacancy_id = v.id and h.to_code = 'contratacion_confirmada') contrataciones,
              (select count(distinct h.application_id)::int from stage_history h join applications a on a.id = h.application_id where a.vacancy_id = v.id and h.to_code = 'ingreso_efectivo') ingresos
         from vacancies v where ${vcond} and v.status in ('publicada','pausada') order by v.target_fill_date nulls last`, vp);

    const visits = await one(pool,
      `select count(*) filter (where event = 'visit')::int visitas, count(*) filter (where event = 'apply_start')::int inicios
         from tracking_events e where e.created_at >= ($1::date)::timestamp at time zone '${config.timezone}' and e.created_at < ($2::date + 1)::timestamp at time zone '${config.timezone}'
         ${f.vacancyId ? 'and e.vacancy_id = $3' : ''}`, f.vacancyId ? [f.from, f.to, f.vacancyId] : [f.from, f.to]);

    return { period: { from: f.from, to: f.to, timezone: config.timezone }, totals: t, conversions, visits, bySource, byRecruiter, byStage, goals, definitions: KPI_DEFINITIONS };
  });

  /** Alertas operativas con evidencia y acción sugerida. */
  app.get('/alerts', async (req) => {
    const u = requireStaff(req, 'application.read');
    const p: unknown[] = [];
    const cond = applicationScope(u, p);
    const stalled = await many(pool,
      `select a.id, c.first_name || ' ' || c.last_name name, ps.name stage, a.stage_entered_at, ps.sla_hours, r.full_name recruiter
         from applications a join candidates c on c.id = a.candidate_id join pipeline_stages ps on ps.code = a.stage_code left join users r on r.id = a.recruiter_id
        where ${cond} and ps.category = 'activo' and ps.sla_hours is not null and a.stage_entered_at < now() - (ps.sla_hours || ' hours')::interval
        order by a.stage_entered_at limit 50`, p);
    const p2: unknown[] = [];
    const cond2 = applicationScope(u, p2);
    const pendingResults = await many(pool,
      `select i.id, a.id application_id, c.first_name || ' ' || c.last_name name, s.starts_at, uu.full_name interviewer
         from interviews i join interview_slots s on s.id = i.slot_id join applications a on a.id = i.application_id join candidates c on c.id = a.candidate_id join users uu on uu.id = s.interviewer_id
        where ${cond2} and i.status in ('agendada','confirmada') and s.ends_at < now() order by s.starts_at limit 50`, p2);
    const p3: unknown[] = [];
    const cond3 = applicationScope(u, p3);
    const unassigned = (await one(pool, `select count(*)::int n from applications a join pipeline_stages ps on ps.code = a.stage_code where ${cond3} and a.recruiter_id is null and ps.category = 'activo'`, p3))!.n;
    const p4: unknown[] = [];
    const cond4 = applicationScope(u, p4);
    const overdue = await one(pool, `select count(*)::int n from tasks t join applications a on a.id = t.application_id where ${cond4} and t.status in ('pendiente','en_proceso') and t.due_at < now()`, p4);
    const vp: unknown[] = [];
    const vcond = vacancyScope(u, vp);
    const atRisk = await many(pool,
      `select v.id, v.title, v.hire_goal, v.target_fill_date,
              (select count(distinct h.application_id)::int from stage_history h join applications a on a.id = h.application_id where a.vacancy_id = v.id and h.to_code = 'contratacion_confirmada') hired,
              (select count(*)::int from applications a join pipeline_stages ps on ps.code = a.stage_code where a.vacancy_id = v.id and ps.category = 'activo' and ps.position >= 7) advanced
         from vacancies v where ${vcond} and v.status = 'publicada' and v.target_fill_date is not null and v.target_fill_date <= current_date + 14`, vp);
    const alerts = [];
    if (stalled.length) alerts.push({ severity: 'alta', type: 'estancados', title: `${stalled.length} candidatos superaron el tiempo objetivo de su etapa`, evidence: stalled.slice(0, 10), suggestion: 'Revisa la bandeja de tareas y contacta primero a los más antiguos; considera reasignar si un reclutador está saturado.' });
    if (pendingResults.length) alerts.push({ severity: 'media', type: 'entrevistas_sin_resultado', title: `${pendingResults.length} entrevistas pasadas sin registrar asistencia`, evidence: pendingResults.slice(0, 10), suggestion: 'Registra asistencia o inasistencia para activar el seguimiento correspondiente.' });
    if (unassigned) alerts.push({ severity: 'media', type: 'sin_asignar', title: `${unassigned} postulaciones activas sin reclutador`, evidence: [], suggestion: 'Asigna reclutadores a la vacante o asigna manualmente desde el pipeline.' });
    if (overdue!.n) alerts.push({ severity: 'media', type: 'tareas_vencidas', title: `${overdue!.n} tareas vencidas`, evidence: [], suggestion: 'Atiende la bandeja de tareas ordenada por urgencia.' });
    for (const v of atRisk) {
      const remaining = v.hire_goal - v.hired;
      if (remaining > 0 && v.advanced < remaining * 3) {
        alerts.push({ severity: 'alta', type: 'vacante_en_riesgo', title: `Vacante en riesgo: ${v.title}`, evidence: [{ meta: v.hire_goal, contratados: v.hired, candidatos_avanzados: v.advanced, fecha_objetivo: v.target_fill_date }], suggestion: `Faltan ${remaining} contrataciones y solo hay ${v.advanced} candidatos en etapas de contacto o posteriores (referencia: 3 por posición). Aumenta captación o revisa conversión.` });
      }
    }
    return { alerts };
  });
}

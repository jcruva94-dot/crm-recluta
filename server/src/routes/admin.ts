import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool, tx, one, many, type Db } from '../db.js';
import { parse, requireStaff } from '../app.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { can } from '../lib/permissions.js';
import { applicationScope, vacancyScope, type StaffUser } from '../lib/scope.js';
import { maskEmail, maskPhone } from '../lib/contact.js';
import { shortCode } from '../lib/crypto.js';
import { moveStage } from '../modules/pipeline.js';
import { protectedTopic } from '../modules/prequal-engine.js';
import { notifyUser } from '../modules/messaging.js';
import { config } from '../config.js';
import { listDocuments, requestDocuments, reviewDocument } from '../modules/documents.js';

const uuid = z.string().uuid();
const actorOf = (u: StaffUser, req: FastifyRequest) => ({ type: 'user' as const, id: u.id, ip: req.ip });

export async function scopedApplication(db: Db, u: StaffUser, id: string, lock = false) {
  if (!uuid.safeParse(id).success) throw notFound('Postulación no encontrada');
  const params: unknown[] = [id];
  const cond = applicationScope(u, params);
  const a = await one(db, `select a.* from applications a where a.id = $1 and ${cond} ${lock ? 'for update of a' : ''}`, params);
  if (!a) throw notFound('Postulación no encontrada'); // 404 en lugar de 403 para no revelar existencia
  return a;
}

export async function scopedVacancy(db: Db, u: StaffUser, id: string) {
  if (!uuid.safeParse(id).success) throw notFound('Vacante no encontrada');
  const params: unknown[] = [id];
  const cond = vacancyScope(u, params);
  const v = await one(db, `select v.* from vacancies v where v.id = $1 and ${cond}`, params);
  if (!v) throw notFound('Vacante no encontrada');
  return v;
}

/** Gerentes solo administran vacantes de su equipo; admin todas. */
function assertCanManageVacancy(u: StaffUser, v: { team_id: string | null }) {
  if (!can(u.role, 'vacancy.manage')) throw forbidden();
  if (u.role !== 'admin' && v.team_id !== u.teamId) throw forbidden('La vacante pertenece a otro equipo');
}

const optionSchema = z.object({
  value: z.string().trim().min(1).max(60), label: z.string().trim().min(1).max(200),
  score: z.number().min(0).max(100).optional(), knockout: z.boolean().optional(), review: z.boolean().optional(),
});
const questionSchema = z.object({
  text: z.string().trim().min(5).max(300),
  helpText: z.string().trim().max(300).nullable().optional(),
  type: z.enum(['yes_no', 'single_choice', 'multi_choice', 'number', 'date', 'text']),
  required: z.boolean().default(true),
  weight: z.number().int().min(0).max(100).default(0),
  isKnockout: z.boolean().default(false),
  knockoutMessage: z.string().trim().max(200).nullable().optional(),
  justification: z.string().trim().max(500).nullable().optional(),
  options: z.array(optionSchema).max(20).default([]),
  numberRules: z.object({
    min: z.number().optional(), max: z.number().optional(), knockout_below: z.number().optional(), knockout_above: z.number().optional(),
    review_below: z.number().optional(), review_above: z.number().optional(), review_after_days: z.number().int().optional(), knockout_after_days: z.number().int().optional(),
    score_ranges: z.array(z.object({ min: z.number().optional(), max: z.number().optional(), score: z.number().min(0).max(100) })).optional(),
  }).default({}),
  position: z.number().int().min(0).max(1000).optional(),
}).superRefine((q, ctx) => {
  if (protectedTopic(q.text)) ctx.addIssue({ code: 'custom', path: ['text'], message: 'La pregunta trata un dato protegido (edad, género, estado civil, religión, salud, apariencia, etc.) y no puede usarse en la precalificación' });
  if ((q.isKnockout || q.weight > 0) && (!q.justification || q.justification.length < 10)) ctx.addIssue({ code: 'custom', path: ['justification'], message: 'Explica por qué es un requisito legítimo del puesto (mín. 10 caracteres)' });
  if (['single_choice', 'multi_choice'].includes(q.type) && q.options.length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Agrega al menos 2 opciones' });
  if (q.type === 'yes_no' && q.options.length && q.options.some((o) => !['si', 'no'].includes(o.value))) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Las opciones de Sí/No deben usar los valores "si" y "no"' });
  if (new Set(q.options.map((o) => o.value)).size !== q.options.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Los valores de las opciones deben ser únicos' });
  if (q.isKnockout && !q.options.some((o) => o.knockout) && q.numberRules.knockout_below === undefined && q.numberRules.knockout_above === undefined && q.numberRules.knockout_after_days === undefined) {
    ctx.addIssue({ code: 'custom', path: ['isKnockout'], message: 'Indica qué respuesta no cumple el requisito indispensable' });
  }
});

const vacancySchema = z.object({
  title: z.string().trim().min(3).max(150),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,80}$/, 'Usa minúsculas, números y guiones').optional(),
  clientId: uuid.nullable().optional(), campaignId: uuid.nullable().optional(), siteId: uuid.nullable().optional(), teamId: uuid.nullable().optional(),
  modality: z.enum(['presencial', 'remoto', 'hibrido']),
  positions: z.number().int().min(1).max(5000), hireGoal: z.number().int().min(1).max(5000),
  openedAt: z.string().date().nullable().optional(), targetFillDate: z.string().date().nullable().optional(),
  summary: z.string().trim().max(2000).default(''),
  activities: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  requirements: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  education: z.string().trim().max(300).nullable().optional(), experience: z.string().trim().max(300).nullable().optional(),
  salaryText: z.string().trim().max(300).nullable().optional(), scheduleText: z.string().trim().max(300).nullable().optional(),
  benefits: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  processSteps: z.array(z.string().trim().min(1).max(300)).max(15).default([]),
  responseTimeText: z.string().trim().max(200).nullable().optional(),
  priority: z.enum(['alta', 'media', 'baja']).default('media'),
  thresholdCompatible: z.number().int().min(0).max(100).default(70),
  thresholdObservations: z.number().int().min(0).max(100).default(50),
  assignmentStrategy: z.enum(['menor_carga', 'rotativa']).default('menor_carga'),
  interviewDurationMin: z.number().int().min(10).max(240).default(30),
  recruiterIds: z.array(uuid).max(50).default([]),
  documentTypeIds: z.array(uuid).max(30).default([]),
}).refine((v) => v.thresholdObservations <= v.thresholdCompatible, { path: ['thresholdObservations'], message: 'Debe ser menor o igual al umbral compatible' });

function slugify(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

async function saveVacancy(c: Db, data: z.infer<typeof vacancySchema>, id: string | null, userId: string) {
  const cols = {
    title: data.title, client_id: data.clientId ?? null, campaign_id: data.campaignId ?? null, site_id: data.siteId ?? null, team_id: data.teamId ?? null,
    modality: data.modality, positions: data.positions, hire_goal: data.hireGoal, opened_at: data.openedAt ?? null, target_fill_date: data.targetFillDate ?? null,
    summary: data.summary, activities: data.activities, requirements: data.requirements, education: data.education ?? null, experience: data.experience ?? null,
    salary_text: data.salaryText ?? null, schedule_text: data.scheduleText ?? null, benefits: data.benefits, process_steps: data.processSteps,
    response_time_text: data.responseTimeText ?? null, priority: data.priority, threshold_compatible: data.thresholdCompatible,
    threshold_observations: data.thresholdObservations, assignment_strategy: data.assignmentStrategy, interview_duration_min: data.interviewDurationMin,
  };
  if (data.campaignId && data.clientId) {
    const ok = await one(c, 'select 1 from campaigns where id = $1 and client_id = $2', [data.campaignId, data.clientId]);
    if (!ok) throw badRequest('La campaña no pertenece al cliente seleccionado');
  }
  const keys = Object.keys(cols);
  const vals = Object.values(cols);
  let vid = id;
  if (!id) {
    const slug = data.slug ?? `${slugify(data.title)}-${shortCode(4)}`;
    const r = await c.query(`insert into vacancies(${keys.join(',')}, slug, created_by) values (${keys.map((_, i) => '$' + (i + 1)).join(',')}, $${keys.length + 1}, $${keys.length + 2}) returning id`, [...vals, slug, userId]);
    vid = r.rows[0].id;
  } else {
    await c.query(`update vacancies set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [id, ...vals]);
  }
  await c.query('delete from vacancy_recruiters where vacancy_id = $1', [vid]);
  for (const r of data.recruiterIds) await c.query('insert into vacancy_recruiters(vacancy_id, user_id) values ($1,$2) on conflict do nothing', [vid, r]);
  await c.query('delete from vacancy_document_types where vacancy_id = $1', [vid]);
  for (const d of data.documentTypeIds) await c.query('insert into vacancy_document_types(vacancy_id, document_type_id) values ($1,$2) on conflict do nothing', [vid, d]);
  return vid!;
}

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  vacancyId: uuid.optional(), sourceId: uuid.optional(), recruiterId: z.union([uuid, z.literal('none')]).optional(),
  stage: z.string().max(60).optional(), stageCategory: z.enum(['activo', 'contratado', 'cerrado', 'reserva']).optional(),
  prequalResult: z.enum(['compatible', 'compatible_con_observaciones', 'requiere_revision', 'no_cumple']).optional(),
  campaignId: uuid.optional(), from: z.string().date().optional(), to: z.string().date().optional(),
  stalled: z.enum(['1']).optional(),
  sort: z.enum(['created_at', 'stage_entered_at', 'name', 'prequal_score', 'last_contact_at']).default('created_at'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

function buildListSql(u: StaffUser, f: z.infer<typeof listQuery>) {
  const params: unknown[] = [];
  const where: string[] = [applicationScope(u, params)];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll('?', '$' + params.length)); };
  if (f.q) {
    const digits = f.q.replace(/\D/g, '');
    params.push(`%${f.q.toLowerCase()}%`);
    const p = '$' + params.length;
    let cond = `(lower(c.first_name || ' ' || c.last_name) like ${p} or c.email like ${p}`;
    if (digits.length >= 4) { params.push(`%${digits}%`); cond += ` or c.phone_e164 like $${params.length}`; }
    where.push(cond + ')');
  }
  if (f.vacancyId) add('a.vacancy_id = ?', f.vacancyId);
  if (f.sourceId) add('a.first_source_id = ?', f.sourceId);
  if (f.recruiterId === 'none') where.push('a.recruiter_id is null'); else if (f.recruiterId) add('a.recruiter_id = ?', f.recruiterId);
  if (f.stage) add('a.stage_code = ?', f.stage);
  if (f.stageCategory) add('ps.category = ?', f.stageCategory);
  if (f.prequalResult) add('a.prequal_result = ?', f.prequalResult);
  if (f.campaignId) add('v.campaign_id = ?', f.campaignId);
  if (f.from) add(`a.created_at >= (?::date)::timestamp at time zone '${config.timezone}'`, f.from);
  if (f.to) add(`a.created_at < ((?::date + 1))::timestamp at time zone '${config.timezone}'`, f.to);
  if (f.stalled) where.push(`ps.sla_hours is not null and a.stage_entered_at < now() - (ps.sla_hours || ' hours')::interval`);
  const sortCol = { created_at: 'a.created_at', stage_entered_at: 'a.stage_entered_at', name: "lower(c.first_name || ' ' || c.last_name)", prequal_score: 'a.prequal_score', last_contact_at: 'a.last_contact_at' }[f.sort];
  const from = `from applications a join candidates c on c.id = a.candidate_id join vacancies v on v.id = a.vacancy_id
    join pipeline_stages ps on ps.code = a.stage_code left join sources src on src.id = a.first_source_id left join users r on r.id = a.recruiter_id
    where ${where.join(' and ')}`;
  return { params, from, order: `order by ${sortCol} ${f.dir} nulls last, a.id` };
}

function presentContact(u: StaffUser, row: { phone_e164: string | null; email: string | null }) {
  if (can(u.role, 'application.contact.read')) return { phone: row.phone_e164, email: row.email };
  if (u.role === 'auditor') return { phone: maskPhone(row.phone_e164), email: maskEmail(row.email) };
  return { phone: null, email: null };
}

export async function adminRoutes(app: FastifyInstance) {
  // ---------- Catálogos ----------
  app.get('/catalogs', async (req) => {
    requireStaff(req);
    const [clients, campaigns, sites, sources, stages, users, teams, reasons, transitions] = await Promise.all([
      many(pool, 'select id, name from clients order by name'),
      many(pool, 'select id, client_id, name, is_active from campaigns order by name'),
      many(pool, 'select id, name, address, city from sites order by name'),
      many(pool, 'select id, code, name, kind, is_active from sources order by name'),
      many(pool, 'select code, name, position, category, requires_reason, sla_hours from pipeline_stages where is_active order by position'),
      many(pool, `select id, full_name, role, team_id from users where is_active order by full_name`),
      many(pool, 'select id, name from teams order by name'),
      many(pool, 'select id, stage_code, name from closure_reasons where is_active order by name'),
      many(pool, 'select from_code, to_code from stage_transitions'),
    ]);
    const documentTypes = await many(pool, 'select id, code, name, instructions, has_expiry from document_types where is_active order by position');
    return { clients, campaigns, sites, sources, stages, users, teams, closureReasons: reasons, transitions, documentTypes };
  });

  const simpleCatalog = (path: string, table: string, schema: z.ZodTypeAny, cols: string[]) => {
    app.post(path, async (req) => {
      const u = requireStaff(req, 'config.manage');
      const b = parse(schema, req.body) as Record<string, unknown>;
      const r = await one(pool, `insert into ${table}(${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, cols.map((k) => b[k] ?? null));
      await audit(pool, actorOf(u, req), `catalog.create`, table, r.id ?? null, { name: b.name });
      return r;
    });
  };
  simpleCatalog('/clients', 'clients', z.object({ name: z.string().trim().min(2).max(120) }), ['name']);
  simpleCatalog('/campaigns', 'campaigns', z.object({ client_id: uuid, name: z.string().trim().min(2).max(120) }), ['client_id', 'name']);
  simpleCatalog('/sites', 'sites', z.object({ name: z.string().trim().min(2).max(120), address: z.string().trim().max(300).optional(), city: z.string().trim().max(80).optional() }), ['name', 'address', 'city']);
  simpleCatalog('/sources', 'sources', z.object({ code: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,40}$/), name: z.string().trim().min(2).max(80), kind: z.enum(['redes_sociales', 'referido', 'bolsa_trabajo', 'feria', 'base_propia', 'campo', 'web', 'publicidad', 'mensajeria', 'otra']) }), ['code', 'name', 'kind']);

  // ---------- Vacantes ----------
  app.get('/vacancies', async (req) => {
    const u = requireStaff(req, 'vacancy.read');
    const params: unknown[] = [];
    const cond = vacancyScope(u, params);
    const rows = await many(pool,
      `select v.id, v.slug, v.title, v.status, v.priority, v.modality, v.positions, v.hire_goal, v.target_fill_date, v.created_at, v.is_demo,
              cl.name client_name, cp.name campaign_name, s.name site_name,
              (select count(*)::int from applications a where a.vacancy_id = v.id) applications,
              (select count(*)::int from applications a join pipeline_stages ps on ps.code = a.stage_code where a.vacancy_id = v.id and ps.category = 'activo') active,
              (select count(distinct sh.application_id)::int from stage_history sh join applications a on a.id = sh.application_id where a.vacancy_id = v.id and sh.to_code = 'contratacion_confirmada') hired,
              (select count(*)::int from prequal_questions q where q.vacancy_id = v.id and q.is_active) questions
         from vacancies v left join clients cl on cl.id = v.client_id left join campaigns cp on cp.id = v.campaign_id left join sites s on s.id = v.site_id
        where ${cond} order by (v.status = 'publicada') desc, v.created_at desc`, params);
    return { vacancies: rows };
  });

  app.get('/vacancies/:id', async (req) => {
    const u = requireStaff(req, 'vacancy.read');
    const v = await scopedVacancy(pool, u, (req.params as any).id);
    const docTypes = await many(pool, 'select document_type_id from vacancy_document_types where vacancy_id = $1', [(req.params as any).id]);
    const [questions, links, recruiters] = await Promise.all([
      many(pool, 'select * from prequal_questions where vacancy_id = $1 order by is_active desc, position, created_at', [v.id]),
      many(pool, `select l.*, s.name source_name, r.full_name recruiter_name,
                    (select count(*)::int from tracking_events e where e.link_id = l.id and e.event = 'visit') visits,
                    (select count(*)::int from applications a where a.link_id = l.id) applications
                  from tracking_links l join sources s on s.id = l.source_id left join users r on r.id = l.recruiter_id where l.vacancy_id = $1 order by l.created_at desc`, [v.id]),
      many(pool, 'select user_id from vacancy_recruiters where vacancy_id = $1', [v.id]),
    ]);
    return { vacancy: { ...v, recruiter_ids: recruiters.map((r) => r.user_id), document_type_ids: docTypes.map((d) => d.document_type_id) }, questions, links: links.map((l) => ({ ...l, url: `${config.publicBaseUrl}/empleo/l/${l.code}` })) };
  });

  app.post('/vacancies', async (req) => {
    const u = requireStaff(req, 'vacancy.manage');
    const b = parse(vacancySchema, req.body);
    if (u.role !== 'admin') b.teamId = u.teamId; // un gerente solo crea vacantes para su equipo
    const id = await tx(async (c) => {
      const id = await saveVacancy(c, b, null, u.id);
      await audit(c, actorOf(u, req), 'vacancy.create', 'vacancy', id, { title: b.title });
      return id;
    });
    return { id };
  });

  app.put('/vacancies/:id', async (req) => {
    const u = requireStaff(req, 'vacancy.manage');
    const v = await scopedVacancy(pool, u, (req.params as any).id);
    assertCanManageVacancy(u, v);
    const b = parse(vacancySchema, req.body);
    if (u.role !== 'admin') b.teamId = u.teamId;
    await tx(async (c) => {
      await saveVacancy(c, b, v.id, u.id);
      await audit(c, actorOf(u, req), 'vacancy.update', 'vacancy', v.id, {});
    });
    return { id: v.id };
  });

  app.post('/vacancies/:id/status', async (req) => {
    const u = requireStaff(req, 'vacancy.manage');
    const v = await scopedVacancy(pool, u, (req.params as any).id);
    assertCanManageVacancy(u, v);
    const b = parse(z.object({ status: z.enum(['borrador', 'publicada', 'pausada', 'cerrada']) }), req.body);
    if (v.status === 'cerrada' && b.status !== 'cerrada') throw badRequest('Una vacante cerrada no puede reabrirse; duplícala para un nuevo proceso');
    if (b.status === 'publicada') {
      const missing = [];
      if (!v.summary) missing.push('descripción');
      if (!v.requirements.length) missing.push('requisitos');
      if (!(await one(pool, 'select 1 from vacancy_recruiters where vacancy_id = $1', [v.id]))) missing.push('al menos un reclutador asignado');
      if (missing.length) throw badRequest(`Para publicar falta: ${missing.join(', ')}`);
    }
    await pool.query(`update vacancies set status = $2, updated_at = now(), closed_at = case when $2 = 'cerrada' then now() else closed_at end where id = $1`, [v.id, b.status]);
    await audit(pool, actorOf(u, req), 'vacancy.status', 'vacancy', v.id, { from: v.status, to: b.status });
    return { ok: true };
  });

  app.post('/vacancies/:id/questions', async (req) => {
    const u = requireStaff(req, 'vacancy.manage');
    const v = await scopedVacancy(pool, u, (req.params as any).id);
    assertCanManageVacancy(u, v);
    const q = parse(questionSchema, req.body);
    const pos = q.position ?? ((await one(pool, 'select coalesce(max(position),0)+1 p from prequal_questions where vacancy_id = $1', [v.id]))!.p);
    const opts = q.type === 'yes_no' && !q.options.length ? [{ value: 'si', label: 'Sí', score: 100 }, { value: 'no', label: 'No', score: 0 }] : q.options;
    const r = await one(pool,
      `insert into prequal_questions(vacancy_id, position, text, help_text, type, required, weight, is_knockout, knockout_message, justification, options, number_rules)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [v.id, pos, q.text, q.helpText ?? null, q.type, q.required, q.weight, q.isKnockout, q.knockoutMessage ?? null, q.justification ?? null, JSON.stringify(opts), q.numberRules]);
    await audit(pool, actorOf(u, req), 'question.create', 'vacancy', v.id, { questionId: r.id });
    return r;
  });

  /**
   * Las preguntas no se editan "en sitio" si ya tienen respuestas: se desactivan y se crea una nueva versión,
   * para no alterar evaluaciones históricas (cada evaluación además guarda una fotografía de las reglas).
   */
  app.put('/questions/:qid', async (req) => {
    const u = requireStaff(req, 'vacancy.manage');
    const old = await one(pool, 'select * from prequal_questions where id = $1', [(req.params as any).qid]);
    if (!old) throw notFound();
    const v = await scopedVacancy(pool, u, old.vacancy_id);
    assertCanManageVacancy(u, v);
    const q = parse(questionSchema, req.body);
    const answered = (await one(pool, 'select count(*)::int n from prequal_answers where question_id = $1', [old.id]))!.n;
    const result = await tx(async (c) => {
      const vals = [q.text, q.helpText ?? null, q.type, q.required, q.weight, q.isKnockout, q.knockoutMessage ?? null, q.justification ?? null, JSON.stringify(q.options), q.numberRules];
      if (answered > 0) {
        await c.query('update prequal_questions set is_active = false where id = $1', [old.id]);
        const r = (await c.query(`insert into prequal_questions(vacancy_id, position, text, help_text, type, required, weight, is_knockout, knockout_message, justification, options, number_rules)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`, [v.id, old.position, ...vals])).rows[0];
        await audit(c, actorOf(u, req), 'question.version', 'vacancy', v.id, { previous: old.id, questionId: r.id, answered });
        return { ...r, versioned: true };
      }
      const r = (await c.query(`update prequal_questions set text=$2, help_text=$3, type=$4, required=$5, weight=$6, is_knockout=$7, knockout_message=$8, justification=$9, options=$10, number_rules=$11 where id = $1 returning *`, [old.id, ...vals])).rows[0];
      await audit(c, actorOf(u, req), 'question.update', 'vacancy', v.id, { questionId: old.id });
      return { ...r, versioned: false };
    });
    return result;
  });

  app.post('/questions/:qid/active', async (req) => {
    const u = requireStaff(req, 'vacancy.manage');
    const b = parse(z.object({ active: z.boolean() }), req.body);
    const old = await one(pool, 'select * from prequal_questions where id = $1', [(req.params as any).qid]);
    if (!old) throw notFound();
    const v = await scopedVacancy(pool, u, old.vacancy_id);
    assertCanManageVacancy(u, v);
    await pool.query('update prequal_questions set is_active = $2 where id = $1', [old.id, b.active]);
    await audit(pool, actorOf(u, req), b.active ? 'question.activate' : 'question.deactivate', 'vacancy', v.id, { questionId: old.id });
    return { ok: true };
  });

  app.post('/vacancies/:id/links', async (req) => {
    const u = requireStaff(req, 'vacancy.read');
    if (!can(u.role, 'vacancy.manage') && u.role !== 'reclutador' && u.role !== 'coordinador') throw forbidden();
    const v = await scopedVacancy(pool, u, (req.params as any).id);
    const b = parse(z.object({
      sourceId: uuid, campaignId: uuid.nullable().optional(), recruiterId: uuid.nullable().optional(),
      eventName: z.string().trim().max(120).nullable().optional(), label: z.string().trim().max(120).nullable().optional(),
      code: z.string().trim().regex(/^[A-Za-z0-9_-]{4,40}$/, 'De 4 a 40 caracteres: letras, números, guion o guion bajo').optional(),
    }), req.body);
    // Un reclutador solo puede generar ligas a su nombre
    const recruiterId = u.role === 'reclutador' ? u.id : b.recruiterId ?? null;
    const code = b.code ?? shortCode(8);
    const r = await one(pool,
      `insert into tracking_links(code, vacancy_id, source_id, campaign_id, recruiter_id, event_name, label, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [code, v.id, b.sourceId, b.campaignId ?? v.campaign_id, recruiterId, b.eventName ?? null, b.label ?? null, u.id]);
    await audit(pool, actorOf(u, req), 'link.create', 'vacancy', v.id, { code });
    return { ...r, url: `${config.publicBaseUrl}/empleo/l/${code}` };
  });

  app.post('/links/:id/active', async (req) => {
    const u = requireStaff(req, 'vacancy.read');
    const b = parse(z.object({ active: z.boolean() }), req.body);
    const l = await one(pool, 'select * from tracking_links where id = $1', [(req.params as any).id]);
    if (!l) throw notFound();
    await scopedVacancy(pool, u, l.vacancy_id);
    if (!can(u.role, 'vacancy.manage') && l.recruiter_id !== u.id) throw forbidden();
    await pool.query('update tracking_links set is_active = $2 where id = $1', [l.id, b.active]);
    await audit(pool, actorOf(u, req), 'link.active', 'vacancy', l.vacancy_id, { code: l.code, active: b.active });
    return { ok: true };
  });

  // ---------- Postulaciones (tabla, Kanban, ficha) ----------
  app.get('/applications', async (req) => {
    const u = requireStaff(req, 'application.read');
    const f = parse(listQuery, req.query);
    const { params, from, order } = buildListSql(u, f);
    const total = (await one(pool, `select count(*)::int n ${from}`, params))!.n;
    const rows = await many(pool,
      `select a.id, a.candidate_id, a.stage_code, ps.name stage_name, ps.category, a.stage_entered_at, a.prequal_result, a.prequal_score, a.created_at, a.last_contact_at,
              a.next_action, a.next_action_at, a.no_show_count, a.is_demo,
              c.first_name, c.last_name, c.phone_e164, c.email, v.title vacancy_title, v.id vacancy_id, src.name source_name, r.full_name recruiter_name, a.recruiter_id,
              (ps.sla_hours is not null and a.stage_entered_at < now() - (ps.sla_hours || ' hours')::interval) as stalled,
              (select count(*)::int from tasks t where t.application_id = a.id and t.status in ('pendiente','en_proceso') and t.due_at < now()) overdue_tasks
         ${from} ${order} limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}`, params);
    return {
      total, page: f.page, pageSize: f.pageSize,
      rows: rows.map(({ phone_e164, email, ...r }) => ({ ...r, ...presentContact(u, { phone_e164, email }) })),
    };
  });

  app.get('/applications/export.csv', async (req, reply) => {
    const u = requireStaff(req, 'export');
    const f = parse(listQuery, req.query);
    const { params, from, order } = buildListSql(u, f);
    const rows = await many(pool,
      `select a.id, c.first_name, c.last_name, c.phone_e164, c.email, v.title, ps.name stage, a.prequal_result, a.prequal_score, src.name source, r.full_name recruiter, a.created_at, a.stage_entered_at
         ${from} ${order} limit 10000`, params);
    await audit(pool, actorOf(u, req), 'export.applications', null, null, { filters: f, rows: rows.length });
    const esc = (v: unknown) => {
      const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // evita inyección de fórmulas en Excel
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const header = ['id', 'nombre', 'apellidos', 'telefono', 'correo', 'vacante', 'etapa', 'precalificacion', 'puntuacion', 'fuente', 'reclutador', 'creado', 'en_etapa_desde'];
    const csv = '﻿' + [header.join(','), ...rows.map((r) => Object.values(r).map(esc).join(','))].join('\n');
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="postulaciones.csv"');
    return csv;
  });

  app.get('/applications/:id', async (req) => {
    const u = requireStaff(req, 'application.read');
    const a = await scopedApplication(pool, u, (req.params as any).id);
    const [cand, vacancy, history, answers, notes, tasks, interviews, otherApps, consents, duplicates, source] = await Promise.all([
      one(pool, 'select id, first_name, last_name, phone_e164, email, phone_verified_at, email_verified_at, preferred_channel, do_not_contact, city, is_demo, created_at from candidates where id = $1', [a.candidate_id]),
      one(pool, 'select id, title, status, threshold_compatible, threshold_observations from vacancies where id = $1', [a.vacancy_id]),
      many(pool, `select h.*, u.full_name user_name, cr.name closure_reason from stage_history h left join users u on u.id = h.user_id left join closure_reasons cr on cr.id = h.closure_reason_id where h.application_id = $1 order by h.created_at desc, h.id desc`, [a.id]),
      many(pool, `select q.id, q.text, q.type, q.options, q.is_active, pa.value, pa.answered_at from prequal_answers pa join prequal_questions q on q.id = pa.question_id where pa.application_id = $1 order by q.position`, [a.id]),
      many(pool, `select n.*, u.full_name author_name from notes n join users u on u.id = n.author_id where n.application_id = $1 order by n.created_at desc`, [a.id]),
      many(pool, `select t.*, u.full_name assignee_name from tasks t left join users u on u.id = t.assignee_id where t.application_id = $1 order by (t.status in ('pendiente','en_proceso')) desc, t.due_at`, [a.id]),
      many(pool, `select i.*, s.starts_at, s.ends_at, s.mode, s.location, s.meeting_url, s.interviewer_id, u.full_name interviewer_name from interviews i join interview_slots s on s.id = i.slot_id join users u on u.id = s.interviewer_id where i.application_id = $1 order by s.starts_at desc`, [a.id]),
      many(pool, `select a.id, v.title, a.stage_code, a.created_at from applications a join vacancies v on v.id = a.vacancy_id where a.candidate_id = $1 and a.id <> $2 order by a.created_at desc`, [a.candidate_id, a.id]),
      many(pool, `select k.purpose, k.granted, k.created_at, n.version from consents k left join privacy_notices n on n.id = k.notice_id where k.candidate_id = $1 order by k.created_at desc`, [a.candidate_id]),
      many(pool, `select d.*, c2.first_name || ' ' || c2.last_name as other_name from duplicate_reviews d join candidates c2 on c2.id = case when d.candidate_id = $1 then d.matched_candidate_id else d.candidate_id end where (d.candidate_id = $1 or d.matched_candidate_id = $1)`, [a.candidate_id]),
      one(pool, `select s1.name first_source, s2.name last_source, l.code link_code, l.event_name from applications a left join sources s1 on s1.id = a.first_source_id left join sources s2 on s2.id = a.last_source_id left join tracking_links l on l.id = a.link_id where a.id = $1`, [a.id]),
    ]);
    const recruiter = a.recruiter_id ? await one(pool, 'select id, full_name from users where id = $1', [a.recruiter_id]) : null;
    const documents = u.role === 'entrevistador' ? [] : await listDocuments(pool, a.id);
    await audit(pool, actorOf(u, req), 'application.view', 'application', a.id);
    const isInterviewer = u.role === 'entrevistador';
    return {
      application: { ...a, recruiter },
      candidate: (({ phone_e164, email, ...rest }) => ({ ...rest, ...presentContact(u, { phone_e164, email }) }))(cand),
      vacancy, source,
      history,
      answers,
      notes,
      tasks: isInterviewer ? [] : tasks,
      interviews: isInterviewer ? interviews.filter((i) => i.interviewer_id === u.id) : interviews,
      otherApplications: isInterviewer ? [] : otherApps,
      consents: isInterviewer ? [] : consents,
      duplicates: isInterviewer ? [] : duplicates,
      documents,
    };
  });

  app.post('/applications/:id/move', async (req) => {
    const u = requireStaff(req, 'application.move');
    const b = parse(z.object({
      toStage: z.string().max(60), expectedStage: z.string().max(60),
      reason: z.string().trim().max(500).optional(), closureReasonId: uuid.optional(), comment: z.string().trim().max(2000).optional(),
      nextAction: z.string().trim().max(200).optional(), override: z.boolean().optional(),
    }), req.body);
    if (u.role === 'auditor' || u.role === 'director') throw forbidden();
    const r = await tx(async (c) => {
      const a = await scopedApplication(c, u, (req.params as any).id, true);
      if (b.toStage === 'entrevista_agendada') throw badRequest('Para agendar una entrevista usa la agenda: así se reserva un horario real');
      return moveStage(c, a.id, b.toStage, { actor: actorOf(u, req), expectedStage: b.expectedStage, reason: b.reason, closureReasonId: b.closureReasonId, comment: b.comment, nextAction: b.nextAction, override: b.override, canOverride: can(u.role, 'pipeline.override') });
    });
    return r;
  });

  app.post('/applications/bulk-move', async (req) => {
    const u = requireStaff(req, 'application.move');
    const b = parse(z.object({ ids: z.array(uuid).min(1).max(100), toStage: z.string().max(60), closureReasonId: uuid.optional(), reason: z.string().trim().max(500).optional() }), req.body);
    if (b.toStage === 'entrevista_agendada') throw badRequest('Para agendar una entrevista usa la agenda');
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of b.ids) {
      try {
        await tx(async (c) => {
          const a = await scopedApplication(c, u, id, true);
          await moveStage(c, a.id, b.toStage, { actor: actorOf(u, req), reason: b.reason, closureReasonId: b.closureReasonId });
        });
        results.push({ id, ok: true });
      } catch (e: any) {
        results.push({ id, ok: false, error: e.message });
      }
    }
    return { results, moved: results.filter((r) => r.ok).length };
  });

  app.post('/applications/:id/assign', async (req) => {
    const u = requireStaff(req, 'application.assign');
    const b = parse(z.object({ recruiterId: uuid }), req.body);
    await tx(async (c) => {
      const a = await scopedApplication(c, u, (req.params as any).id, true);
      const r = (await c.query(`select id, full_name from users where id = $1 and is_active and role in ('reclutador','coordinador','gerente')`, [b.recruiterId])).rows[0];
      if (!r) throw badRequest('El usuario no puede recibir asignaciones');
      await c.query('update applications set recruiter_id = $2, updated_at = now() where id = $1', [a.id, r.id]);
      await c.query(`update tasks set assignee_id = $2 where application_id = $1 and status in ('pendiente','en_proceso') and (assignee_id is null or assignee_id = $3)`, [a.id, r.id, a.recruiter_id]);
      await notifyUser(c, r.id, 'Candidato asignado', 'Se te asignó una postulación', `/admin/postulaciones/${a.id}`);
      await audit(c, actorOf(u, req), 'application.assign', 'application', a.id, { from: a.recruiter_id, to: r.id });
    });
    return { ok: true };
  });

  app.post('/applications/:id/notes', async (req) => {
    const u = requireStaff(req, 'note.write');
    const b = parse(z.object({
      body: z.string().trim().min(2).max(4000), kind: z.enum(['nota', 'contacto']).default('nota'),
      contactOutcome: z.enum(['contactado', 'no_contesta', 'numero_invalido', 'reagendar', 'no_interesado']).optional(),
    }), req.body);
    if (b.kind === 'contacto' && !b.contactOutcome) throw badRequest('Indica el resultado del contacto');
    const n = await tx(async (c) => {
      const a = await scopedApplication(c, u, (req.params as any).id, true);
      const n = (await c.query(`insert into notes(application_id, author_id, body, kind, contact_outcome) values ($1,$2,$3,$4,$5) returning *`, [a.id, u.id, b.body, b.kind, b.contactOutcome ?? null])).rows[0];
      if (b.kind === 'contacto') {
        await c.query(`update applications set last_contact_at = now(), updated_at = now() where id = $1`, [a.id]);
        if (b.contactOutcome === 'contactado') await c.query(`update tasks set status = 'completada', completed_at = now() where application_id = $1 and type = 'contactar' and status in ('pendiente','en_proceso')`, [a.id]);
        if (b.contactOutcome === 'no_contesta') {
          await c.query(`insert into tasks(application_id, type, title, assignee_id, due_at, priority) values ($1,'contactar','Reintentar contacto (no contestó)',$2, now() + interval '24 hours','media')`, [a.id, a.recruiter_id ?? u.id]);
        }
      }
      await audit(c, actorOf(u, req), b.kind === 'contacto' ? 'application.contact' : 'application.note', 'application', a.id, { outcome: b.contactOutcome });
      return n;
    });
    return n;
  });

  // ---------- Documentos ----------
  app.post('/applications/:id/documents', async (req) => {
    const u = requireStaff(req, 'documents.review');
    const b = parse(z.object({ documentTypeIds: z.array(uuid).min(1).max(30) }), req.body);
    const n = await tx(async (c) => {
      const a = await scopedApplication(c, u, (req.params as any).id, true);
      return requestDocuments(c, a.id, b.documentTypeIds, actorOf(u, req));
    });
    return { requested: n };
  });

  async function scopedDocument(u: StaffUser, id: string) {
    if (!uuid.safeParse(id).success) throw notFound('Documento no encontrado');
    const d = await one(pool, 'select * from application_documents where id = $1', [id]);
    if (!d) throw notFound('Documento no encontrado');
    await scopedApplication(pool, u, d.application_id);
    return d;
  }

  /** Descarga protegida: requiere permiso, alcance sobre la postulación y queda en auditoría. */
  app.get('/documents/:id/file', async (req, reply) => {
    const u = requireStaff(req, 'documents.read');
    const d = await scopedDocument(u, (req.params as any).id);
    const { version } = parse(z.object({ version: z.coerce.number().int().min(1).optional() }), req.query);
    const f = await one(pool, 'select filename, content, version from document_files where document_id = $1 and version = $2', [d.id, version ?? d.current_version]);
    if (!f) throw notFound('Archivo no encontrado');
    await audit(pool, actorOf(u, req), 'document.download', 'application', d.application_id, { documentId: d.id, version: f.version });
    reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${f.filename}"`).header('cache-control', 'private, no-store');
    return reply.send(f.content);
  });

  app.post('/documents/:id/review', async (req) => {
    const u = requireStaff(req, 'documents.review');
    const b = parse(z.object({ status: z.enum(['aprobado', 'requiere_correccion', 'rechazado']), reason: z.string().trim().max(500).optional(), expiresAt: z.string().date().optional() }), req.body);
    const d = await scopedDocument(u, (req.params as any).id);
    return tx((c) => reviewDocument(c, d.id, b.status, b.reason, b.expiresAt, actorOf(u, req)));
  });

  // ---------- Tareas ----------
  app.get('/tasks', async (req) => {
    const u = requireStaff(req, 'application.read');
    const f = parse(z.object({ scope: z.enum(['mine', 'team']).default('mine'), status: z.enum(['abiertas', 'completada', 'cancelada']).default('abiertas') }), req.query);
    const params: unknown[] = [];
    const where = [`(t.application_id is null or ${applicationScope(u, params)})`];
    if (f.scope === 'mine' || !can(u.role, 'application.assign')) { params.push(u.id); where.push(`t.assignee_id = $${params.length}`); }
    where.push(f.status === 'abiertas' ? `t.status in ('pendiente','en_proceso')` : `t.status = '${f.status}'`);
    const rows = await many(pool,
      `select t.*, u.full_name assignee_name, c.first_name || ' ' || c.last_name candidate_name, v.title vacancy_title, a.stage_code,
              (t.due_at < now() and t.status in ('pendiente','en_proceso')) overdue
         from tasks t left join users u on u.id = t.assignee_id left join applications a on a.id = t.application_id
         left join candidates c on c.id = a.candidate_id left join vacancies v on v.id = a.vacancy_id
        where ${where.join(' and ')}
        order by (t.due_at < now()) desc, case t.priority when 'alta' then 0 when 'media' then 1 else 2 end, t.due_at limit 300`, params);
    return { tasks: rows };
  });

  app.post('/tasks', async (req) => {
    const u = requireStaff(req, 'task.manage');
    const b = parse(z.object({
      applicationId: uuid, type: z.enum(['contactar', 'agendar', 'confirmar', 'entrevistar', 'revisar_perfil', 'validar_documentos', 'solicitar_info', 'emitir_oferta', 'incidencia', 'recuperar']),
      title: z.string().trim().min(3).max(200), assigneeId: uuid.optional(), dueAt: z.string().datetime({ offset: true }), priority: z.enum(['alta', 'media', 'baja']).default('media'),
    }), req.body);
    const a = await scopedApplication(pool, u, b.applicationId);
    const assignee = b.assigneeId && can(u.role, 'application.assign') ? b.assigneeId : u.id;
    const t = await one(pool, `insert into tasks(application_id, type, title, assignee_id, due_at, priority, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *`, [a.id, b.type, b.title, assignee, b.dueAt, b.priority, u.id]);
    await audit(pool, actorOf(u, req), 'task.create', 'application', a.id, { taskId: t.id });
    return t;
  });

  app.patch('/tasks/:id', async (req) => {
    const u = requireStaff(req, 'task.manage');
    const b = parse(z.object({ status: z.enum(['pendiente', 'en_proceso', 'completada', 'cancelada']).optional(), dueAt: z.string().datetime({ offset: true }).optional() }), req.body);
    const t = await one(pool, 'select * from tasks where id = $1', [(req.params as any).id]);
    if (!t) throw notFound();
    if (t.application_id) await scopedApplication(pool, u, t.application_id);
    if (t.assignee_id !== u.id && !can(u.role, 'application.assign')) throw forbidden('Solo el responsable o un coordinador puede modificar la tarea');
    await pool.query(`update tasks set status = coalesce($2, status), due_at = coalesce($3, due_at), completed_at = case when $2 in ('completada','cancelada') then now() else completed_at end where id = $1`, [t.id, b.status ?? null, b.dueAt ?? null]);
    await audit(pool, actorOf(u, req), 'task.update', 'task', t.id, b);
    return { ok: true };
  });

  // ---------- Duplicados ----------
  app.get('/duplicates', async (req) => {
    requireStaff(req, 'duplicates.resolve');
    const rows = await many(pool,
      `select d.*, c1.first_name || ' ' || c1.last_name name1, c1.phone_e164 phone1, c1.email email1, c1.created_at created1,
              c2.first_name || ' ' || c2.last_name name2, c2.phone_e164 phone2, c2.email email2, c2.created_at created2
         from duplicate_reviews d join candidates c1 on c1.id = d.candidate_id join candidates c2 on c2.id = d.matched_candidate_id
        where d.status = 'pendiente' order by d.created_at desc limit 200`);
    return { duplicates: rows };
  });

  app.post('/duplicates/:id/resolve', async (req) => {
    const u = requireStaff(req, 'duplicates.resolve');
    const b = parse(z.object({ resolution: z.enum(['misma_persona', 'personas_distintas']) }), req.body);
    const d = await one(pool, 'select * from duplicate_reviews where id = $1 and status = $2', [(req.params as any).id, 'pendiente']);
    if (!d) throw notFound();
    // La fusión física de expedientes se deja como acción manual documentada: se marca la relación y queda en auditoría.
    await pool.query('update duplicate_reviews set status = $2, resolved_by = $3, resolved_at = now() where id = $1', [d.id, b.resolution, u.id]);
    await audit(pool, actorOf(u, req), 'duplicate.resolve', 'candidate', d.candidate_id, { matched: d.matched_candidate_id, resolution: b.resolution });
    return { ok: true };
  });

  // ---------- Mensajes, notificaciones, auditoría ----------
  app.get('/messages', async (req) => {
    requireStaff(req, 'messages.read');
    const rows = await many(pool,
      `select m.id, m.channel, m.destination, m.template_code, m.subject, m.status, m.provider, m.created_at, m.sent_at, m.candidate_id,
              case when m.template_code = 'otp' then regexp_replace(m.body, '\\d{6}', '••••••') else m.body end as body
         from outbox_messages m order by m.created_at desc limit 200`);
    return { messages: rows.map((m) => ({ ...m, destination: m.channel === 'email' ? maskEmail(m.destination) : maskPhone(m.destination) })), deliveryMode: config.deliveryMode };
  });

  app.get('/notifications', async (req) => {
    const u = requireStaff(req);
    const rows = await many(pool, 'select * from notifications where user_id = $1 order by created_at desc limit 50', [u.id]);
    const unread = (await one(pool, 'select count(*)::int n from notifications where user_id = $1 and read_at is null', [u.id]))!.n;
    return { notifications: rows, unread };
  });

  app.post('/notifications/read', async (req) => {
    const u = requireStaff(req);
    await pool.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [u.id]);
    return { ok: true };
  });

  app.get('/audit', async (req) => {
    requireStaff(req, 'audit.read');
    const f = parse(z.object({ entityId: uuid.optional(), action: z.string().max(60).optional() }), req.query);
    const params: unknown[] = [];
    const where = ['true'];
    if (f.entityId) { params.push(f.entityId); where.push(`l.entity_id = $${params.length}`); }
    if (f.action) { params.push(f.action + '%'); where.push(`l.action like $${params.length}`); }
    const rows = await many(pool,
      `select l.*, u.full_name user_name from audit_log l left join users u on u.id = l.actor_id and l.actor_type = 'user'
        where ${where.join(' and ')} order by l.created_at desc, l.id desc limit 300`, params);
    return { entries: rows };
  });

  app.get('/search', async (req) => {
    const u = requireStaff(req, 'application.read');
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query);
    const { params, from } = buildListSql(u, { q, sort: 'created_at', dir: 'desc', page: 1, pageSize: 10 });
    const rows = await many(pool, `select a.id, c.first_name, c.last_name, v.title vacancy_title, ps.name stage_name ${from} order by a.created_at desc limit 10`, params);
    return { results: rows };
  });
}

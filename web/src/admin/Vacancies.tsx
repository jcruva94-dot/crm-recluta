import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../shared/api';
import { fmtDate } from '../shared/format';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Notice, Select, Textarea, useLoad } from '../shared/ui';
import { useAdmin } from './context';

const STATUS_TONE: Record<string, string> = { borrador: 'gray', publicada: 'green', pausada: 'amber', cerrada: 'red' };

export function Vacancies() {
  const { can } = useAdmin();
  const { data, error, loading, reload } = useLoad(() => api('/api/admin/vacancies'), []);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold">Vacantes</h1>{can('vacancy.manage') && <Link to="/admin/vacantes/nueva"><Button>Nueva vacante</Button></Link>}</div>
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Loading /> : !data.vacancies.length ? <Empty title="Aún no hay vacantes">Crea la primera vacante para generar ligas de registro.</Empty> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Vacante</th><th className="p-2">Cliente / campaña</th><th className="p-2">Estado</th><th className="p-2">Postulaciones</th><th className="p-2">Activas</th><th className="p-2">Contratados / meta</th><th className="p-2">Fecha objetivo</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.vacancies.map((v: any) => (
              <tr key={v.id} className="hover:bg-slate-50">
                <td className="p-2"><Link className="font-medium text-brand-700 hover:underline" to={`/admin/vacantes/${v.id}`}>{v.title}</Link> {v.priority === 'alta' && <Badge tone="red">Alta prioridad</Badge>} {v.questions === 0 && <Badge tone="amber">Sin precalificación</Badge>}</td>
                <td className="p-2">{v.client_name ?? '—'}{v.campaign_name ? ` / ${v.campaign_name}` : ''}</td>
                <td className="p-2"><Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge></td>
                <td className="p-2">{v.applications}</td><td className="p-2">{v.active}</td><td className="p-2">{v.hired} / {v.hire_goal}</td><td className="p-2">{fmtDate(v.target_fill_date)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function VacancyEdit() {
  const { id } = useParams();
  const isNew = id === 'nueva';
  const nav = useNavigate();
  const { catalogs, can, me, reloadCatalogs } = useAdmin();
  const { data, error, loading, reload } = useLoad(() => (isNew ? Promise.resolve(null) : api(`/api/admin/vacancies/${id}`)), [id]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const v = data?.vacancy;
  const editable = can('vacancy.manage') && (me.user.role === 'admin' || !v || v.team_id === me.user.teamId) && v?.status !== 'cerrada';
  return (
    <div className="space-y-4">
      <Link to="/admin/vacantes" className="text-sm text-slate-500 hover:underline">← Vacantes</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{isNew ? 'Nueva vacante' : v.title} {v && <Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge>}</h1>
        {v && editable && <StatusActions v={v} onDone={reload} />}
      </div>
      <VacancyForm key={v?.id ?? 'new'} v={v} editable={editable} onSaved={(newId) => { reloadCatalogs(); if (isNew) nav(`/admin/vacantes/${newId}`); else reload(); }} recruiters={catalogs.users.filter((u) => ['reclutador', 'coordinador', 'gerente'].includes(u.role))} />
      {v && <Questions vacancyId={v.id} questions={data.questions} editable={editable} onChange={reload} />}
      {v && <Links vacancy={v} links={data.links} onChange={reload} />}
    </div>
  );
}

function StatusActions({ v, onDone }: { v: any; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const set = async (status: string) => {
    if (status === 'cerrada' && !confirm('Al cerrar la vacante dejará de recibir postulaciones y no podrá reabrirse. ¿Continuar?')) return;
    setErr(null);
    try { await api(`/api/admin/vacancies/${v.id}/status`, { body: { status } }); onDone(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {v.status !== 'publicada' && <Button onClick={() => set('publicada')}>Publicar</Button>}
      {v.status === 'publicada' && <Button variant="secondary" onClick={() => set('pausada')}>Pausar</Button>}
      <Button variant="danger" onClick={() => set('cerrada')}>Cerrar</Button>
      {err && <span className="w-full text-sm text-red-700">{err}</span>}
    </div>
  );
}

function VacancyForm({ v, editable, onSaved, recruiters }: { v: any; editable: boolean; onSaved: (id: string) => void; recruiters: any[] }) {
  const { catalogs, me } = useAdmin();
  const [f, setF] = useState(() => ({
    title: v?.title ?? '', clientId: v?.client_id ?? '', campaignId: v?.campaign_id ?? '', siteId: v?.site_id ?? '', teamId: v?.team_id ?? me.user.teamId ?? '',
    modality: v?.modality ?? 'presencial', positions: v?.positions ?? 1, hireGoal: v?.hire_goal ?? 1, openedAt: v?.opened_at?.slice(0, 10) ?? '', targetFillDate: v?.target_fill_date?.slice(0, 10) ?? '',
    summary: v?.summary ?? '', activities: (v?.activities ?? []).join('\n'), requirements: (v?.requirements ?? []).join('\n'), education: v?.education ?? '', experience: v?.experience ?? '',
    salaryText: v?.salary_text ?? '', scheduleText: v?.schedule_text ?? '', benefits: (v?.benefits ?? []).join('\n'), processSteps: (v?.process_steps ?? []).join('\n'), responseTimeText: v?.response_time_text ?? '',
    priority: v?.priority ?? 'media', thresholdCompatible: v?.threshold_compatible ?? 70, thresholdObservations: v?.threshold_observations ?? 50, assignmentStrategy: v?.assignment_strategy ?? 'menor_carga',
    interviewDurationMin: v?.interview_duration_min ?? 30, recruiterIds: (v?.recruiter_ids ?? []) as string[],
  }));
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setOk(false);
    const body = { ...f, clientId: f.clientId || null, campaignId: f.campaignId || null, siteId: f.siteId || null, teamId: f.teamId || null, openedAt: f.openedAt || null, targetFillDate: f.targetFillDate || null,
      activities: lines(f.activities), requirements: lines(f.requirements), benefits: lines(f.benefits), processSteps: lines(f.processSteps),
      education: f.education || null, experience: f.experience || null, salaryText: f.salaryText || null, scheduleText: f.scheduleText || null, responseTimeText: f.responseTimeText || null };
    try { const r = v ? await api(`/api/admin/vacancies/${v.id}`, { method: 'PUT', body }) : await api('/api/admin/vacancies', { body }); setOk(true); onSaved(r.id); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save}>
      <fieldset disabled={!editable} className="grid gap-4 lg:grid-cols-2">
        <Card title="Datos generales">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Nombre del puesto" required><Input value={f.title} onChange={set('title')} /></Field></div>
            <Field label="Cliente"><Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, campaignId: '' })}><option value="">—</option>{catalogs.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Campaña"><Select value={f.campaignId} onChange={set('campaignId')}><option value="">—</option>{catalogs.campaigns.filter((c) => c.client_id === f.clientId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Centro de trabajo"><Select value={f.siteId} onChange={set('siteId')}><option value="">—</option>{catalogs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Modalidad"><Select value={f.modality} onChange={set('modality')}><option value="presencial">Presencial</option><option value="remoto">Remoto</option><option value="hibrido">Híbrido</option></Select></Field>
            {me.user.role === 'admin' && <Field label="Equipo responsable"><Select value={f.teamId} onChange={set('teamId')}><option value="">—</option>{catalogs.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>}
            <Field label="Prioridad"><Select value={f.priority} onChange={set('priority')}><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></Select></Field>
            <Field label="Posiciones"><Input type="number" min={1} value={f.positions} onChange={set('positions')} /></Field>
            <Field label="Meta de ingresos"><Input type="number" min={1} value={f.hireGoal} onChange={set('hireGoal')} /></Field>
            <Field label="Fecha de apertura"><Input type="date" value={f.openedAt} onChange={set('openedAt')} /></Field>
            <Field label="Fecha objetivo de cobertura"><Input type="date" value={f.targetFillDate} onChange={set('targetFillDate')} /></Field>
          </div>
        </Card>
        <Card title="Lo que verá el candidato">
          <div className="space-y-3">
            <Field label="Descripción breve"><Textarea rows={2} value={f.summary} onChange={set('summary')} /></Field>
            <Field label="Sueldo y esquema de compensación"><Input value={f.salaryText} onChange={set('salaryText')} /></Field>
            <Field label="Horarios y turnos"><Input value={f.scheduleText} onChange={set('scheduleText')} /></Field>
            <Field label="Actividades (una por línea)"><Textarea rows={3} value={f.activities} onChange={set('activities')} /></Field>
            <Field label="Requisitos (uno por línea)"><Textarea rows={3} value={f.requirements} onChange={set('requirements')} /></Field>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Escolaridad"><Input value={f.education} onChange={set('education')} /></Field><Field label="Experiencia"><Input value={f.experience} onChange={set('experience')} /></Field></div>
            <Field label="Prestaciones (una por línea)"><Textarea rows={3} value={f.benefits} onChange={set('benefits')} /></Field>
            <Field label="Pasos del proceso (uno por línea)"><Textarea rows={3} value={f.processSteps} onChange={set('processSteps')} /></Field>
            <Field label="Tiempo de respuesta comprometido" hint="Solo escribe un plazo que el equipo pueda cumplir."><Input value={f.responseTimeText} onChange={set('responseTimeText')} /></Field>
          </div>
        </Card>
        <Card title="Reglas de operación">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Umbral compatible (0-100)"><Input type="number" min={0} max={100} value={f.thresholdCompatible} onChange={set('thresholdCompatible')} /></Field>
            <Field label="Umbral con observaciones"><Input type="number" min={0} max={100} value={f.thresholdObservations} onChange={set('thresholdObservations')} /></Field>
            <Field label="Asignación automática"><Select value={f.assignmentStrategy} onChange={set('assignmentStrategy')}><option value="menor_carga">Menor carga activa</option><option value="rotativa">Rotativa</option></Select></Field>
            <Field label="Duración de entrevista (min)"><Input type="number" min={10} max={240} value={f.interviewDurationMin} onChange={set('interviewDurationMin')} /></Field>
          </div>
          <fieldset className="mt-3"><legend className="text-sm font-medium text-slate-700">Reclutadores asignados</legend>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">{recruiters.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.recruiterIds.includes(u.id)} onChange={(e) => setF({ ...f, recruiterIds: e.target.checked ? [...f.recruiterIds, u.id] : f.recruiterIds.filter((x) => x !== u.id) })} />{u.full_name}</label>
            ))}</div>
          </fieldset>
        </Card>
      </fieldset>
      {editable && <div className="mt-3 flex items-center gap-3"><Button type="submit" loading={busy}>{v ? 'Guardar cambios' : 'Crear vacante'}</Button>{ok && <span className="text-sm text-emerald-700">Guardado</span>}<ErrorBox error={err} /></div>}
    </form>
  );
}

const TYPE_LABEL: Record<string, string> = { yes_no: 'Sí / No', single_choice: 'Opción única', multi_choice: 'Opción múltiple', number: 'Número', date: 'Fecha', text: 'Texto libre' };

function Questions({ vacancyId, questions, editable, onChange }: { vacancyId: string; questions: any[]; editable: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState<any>(null);
  const active = questions.filter((q) => q.is_active);
  const totalWeight = active.reduce((s, q) => s + q.weight, 0);
  return (
    <Card title={`Precalificación (${active.length} preguntas activas · peso total ${totalWeight})`} actions={editable && <Button size="sm" onClick={() => setEditing({})}>Agregar pregunta</Button>}>
      <Notice>Las preguntas indispensables solo marcan "No cumple" y siempre pasan a revisión humana. Los temas protegidos (edad, género, estado civil, salud, religión, apariencia…) se bloquean automáticamente.</Notice>
      {!questions.length ? <p className="mt-3 text-sm text-slate-500">Sin preguntas. Los candidatos pasarán directo a contacto.</p> : (
        <ol className="mt-3 divide-y divide-slate-100">{questions.map((q) => (
          <li key={q.id} className={`flex items-start justify-between gap-3 py-2 text-sm ${q.is_active ? '' : 'opacity-50'}`}>
            <div>
              <p className="font-medium">{q.text}</p>
              <p className="text-xs text-slate-500">{TYPE_LABEL[q.type]} · peso {q.weight} {q.is_knockout && <Badge tone="red">Indispensable</Badge>} {q.required ? '' : '· opcional'} {!q.is_active && '· inactiva'}</p>
              {q.options?.length > 0 && <p className="text-xs text-slate-500">{q.options.map((o: any) => `${o.label}${o.score != null ? ` (${o.score})` : ''}${o.knockout ? ' ✗' : ''}${o.review ? ' ⚑' : ''}`).join(' · ')}</p>}
              {q.justification && <p className="text-xs italic text-slate-500">Justificación: {q.justification}</p>}
            </div>
            {editable && <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(q)}>Editar</Button>
              <Button size="sm" variant="ghost" onClick={async () => { await api(`/api/admin/questions/${q.id}/active`, { body: { active: !q.is_active } }); onChange(); }}>{q.is_active ? 'Desactivar' : 'Activar'}</Button>
            </div>}
          </li>
        ))}</ol>
      )}
      {editing && <QuestionDialog vacancyId={vacancyId} q={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} />}
    </Card>
  );
}

function QuestionDialog({ vacancyId, q, onClose, onSaved }: { vacancyId: string; q: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    text: q.text ?? '', helpText: q.help_text ?? '', type: q.type ?? 'yes_no', required: q.required ?? true, weight: q.weight ?? 0, isKnockout: q.is_knockout ?? false,
    knockoutMessage: q.knockout_message ?? '', justification: q.justification ?? '',
    options: (q.options?.length ? q.options : [{ value: 'si', label: 'Sí', score: 100 }, { value: 'no', label: 'No', score: 0 }]) as any[],
    numberRules: q.number_rules ?? {},
  });
  const [err, setErr] = useState<string | null>(null);
  const isChoice = ['yes_no', 'single_choice', 'multi_choice'].includes(f.type);
  const setOpt = (i: number, k: string, val: any) => setF({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, [k]: val } : o)) });
  const setRule = (k: string, val: string) => setF({ ...f, numberRules: { ...f.numberRules, [k]: val === '' ? undefined : Number(val) } });
  const save = async () => {
    setErr(null);
    const body = { ...f, helpText: f.helpText || null, knockoutMessage: f.knockoutMessage || null, justification: f.justification || null,
      options: isChoice ? f.options.map((o) => ({ ...o, value: o.value || o.label.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').slice(0, 40), score: o.score === '' ? undefined : Number(o.score ?? 0) })) : [],
      numberRules: Object.fromEntries(Object.entries(f.numberRules).filter(([, v]) => v !== undefined && v !== null)) };
    try { const r = q.id ? await api(`/api/admin/questions/${q.id}`, { method: 'PUT', body }) : await api(`/api/admin/vacancies/${vacancyId}/questions`, { body }); if (r.versioned) alert('La pregunta ya tenía respuestas: se creó una nueva versión y la anterior quedó inactiva para conservar el historial.'); onSaved(); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal open title={q.id ? 'Editar pregunta' : 'Nueva pregunta'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Pregunta" required><Input value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
        <Field label="Ayuda para el candidato"><Input value={f.helpText} onChange={(e) => setF({ ...f, helpText: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tipo de respuesta"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, options: e.target.value === 'yes_no' ? [{ value: 'si', label: 'Sí', score: 100 }, { value: 'no', label: 'No', score: 0 }] : ['single_choice', 'multi_choice'].includes(e.target.value) ? [{ value: '', label: '', score: 100 }, { value: '', label: '', score: 0 }] : [] })}>{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Peso (0-100)"><Input type="number" min={0} max={100} value={f.weight} onChange={(e) => setF({ ...f, weight: Number(e.target.value) })} /></Field>
        </div>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} /> Obligatoria</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.isKnockout} onChange={(e) => setF({ ...f, isKnockout: e.target.checked })} /> Requisito indispensable</label>
        </div>
        {isChoice && (
          <div>
            <p className="mb-1 text-sm font-medium">Opciones <span className="font-normal text-slate-500">(puntos 0-100 · ✗ = no cumple indispensable · ⚑ = revisión humana)</span></p>
            <div className="space-y-1.5">{f.options.map((o, i) => (
              <div key={i} className="grid grid-cols-[1fr_4.5rem_auto_auto_auto] items-center gap-1.5">
                <Input placeholder="Texto de la opción" value={o.label} disabled={f.type === 'yes_no'} onChange={(e) => setOpt(i, 'label', e.target.value)} />
                <Input type="number" min={0} max={100} aria-label="Puntos" value={o.score ?? ''} onChange={(e) => setOpt(i, 'score', e.target.value)} />
                <label className="text-sm" title="No cumple indispensable"><input type="checkbox" checked={!!o.knockout} onChange={(e) => setOpt(i, 'knockout', e.target.checked)} /> ✗</label>
                <label className="text-sm" title="Requiere revisión humana"><input type="checkbox" checked={!!o.review} onChange={(e) => setOpt(i, 'review', e.target.checked)} /> ⚑</label>
                {f.type !== 'yes_no' ? <button type="button" aria-label="Quitar opción" className="px-1 text-slate-400" onClick={() => setF({ ...f, options: f.options.filter((_, j) => j !== i) })}>✕</button> : <span />}
              </div>
            ))}</div>
            {f.type !== 'yes_no' && <Button size="sm" variant="ghost" onClick={() => setF({ ...f, options: [...f.options, { value: '', label: '', score: 0 }] })}>+ Opción</Button>}
          </div>
        )}
        {f.type === 'number' && (
          <div className="grid grid-cols-3 gap-2">
            {[['min', 'Mínimo'], ['max', 'Máximo'], ['review_below', 'Revisión si <'], ['review_above', 'Revisión si >'], ['knockout_below', 'No cumple si <'], ['knockout_above', 'No cumple si >']].map(([k, l]) => <Field key={k} label={l}><Input type="number" value={f.numberRules[k] ?? ''} onChange={(e) => setRule(k, e.target.value)} /></Field>)}
          </div>
        )}
        {f.type === 'date' && <div className="grid grid-cols-2 gap-2"><Field label="Revisión si es después de (días)"><Input type="number" value={f.numberRules.review_after_days ?? ''} onChange={(e) => setRule('review_after_days', e.target.value)} /></Field><Field label="No cumple si es después de (días)"><Input type="number" value={f.numberRules.knockout_after_days ?? ''} onChange={(e) => setRule('knockout_after_days', e.target.value)} /></Field></div>}
        {f.isKnockout && <Field label="Mensaje para el candidato si no cumple"><Input value={f.knockoutMessage} onChange={(e) => setF({ ...f, knockoutMessage: e.target.value })} placeholder="p. ej. La vacante es 100% presencial en CDMX" /></Field>}
        {(f.isKnockout || f.weight > 0) && <Field label="Justificación: ¿por qué es un requisito legítimo del puesto?" required><Textarea rows={2} value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} /></Field>}
        <ErrorBox error={err} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save}>Guardar</Button></div>
      </div>
    </Modal>
  );
}

function Links({ vacancy, links, onChange }: { vacancy: any; links: any[]; onChange: () => void }) {
  const { catalogs, me, can } = useAdmin();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ sourceId: '', recruiterId: '', eventName: '', label: '', code: '' });
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <Card title="Ligas de registro" actions={vacancy.status !== 'cerrada' && <Button size="sm" onClick={() => setOpen(true)}>Generar liga</Button>}>
      {!links.length ? <p className="text-sm text-slate-500">Sin ligas. Genera una por fuente, reclutador o evento para medir de dónde llegan los candidatos.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Liga</th><th>Fuente</th><th>Reclutador / evento</th><th>Visitas</th><th>Postulaciones</th><th></th></tr></thead>
          <tbody className="divide-y divide-slate-100">{links.map((l) => (
            <tr key={l.id} className={l.is_active ? '' : 'opacity-50'}>
              <td className="py-1.5 pr-2"><p className="font-medium">{l.label ?? l.code}</p><button className="break-all text-left text-xs text-brand-700" onClick={() => { navigator.clipboard?.writeText(l.url); setCopied(l.id); }}>{l.url} {copied === l.id ? '✓ copiada' : '⧉'}</button></td>
              <td>{l.source_name}</td><td>{l.recruiter_name ?? l.event_name ?? '—'}</td><td>{l.visits}</td><td>{l.applications}</td>
              <td>{(can('vacancy.manage') || l.recruiter_id === me.user.id) && <Button size="sm" variant="ghost" onClick={async () => { await api(`/api/admin/links/${l.id}/active`, { body: { active: !l.is_active } }); onChange(); }}>{l.is_active ? 'Desactivar' : 'Activar'}</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Modal open={open} title="Generar liga de registro" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <Field label="Fuente" required><Select value={f.sourceId} onChange={(e) => setF({ ...f, sourceId: e.target.value })}><option value="">Selecciona…</option>{catalogs.sources.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          {me.user.role !== 'reclutador' && <Field label="Reclutador (liga personal, opcional)" hint="Los candidatos de esta liga se asignan a esta persona."><Select value={f.recruiterId} onChange={(e) => setF({ ...f, recruiterId: e.target.value })}><option value="">—</option>{catalogs.users.filter((u) => ['reclutador', 'coordinador', 'gerente'].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select></Field>}
          <Field label="Evento o jornada (opcional)"><Input value={f.eventName} onChange={(e) => setF({ ...f, eventName: e.target.value })} /></Field>
          <Field label="Etiqueta interna"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
          <Field label="Código personalizado (opcional)" hint="Aparece en la URL. Si lo dejas vacío se genera uno."><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          <ErrorBox error={err} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={!f.sourceId} onClick={async () => {
            try { await api(`/api/admin/vacancies/${vacancy.id}/links`, { body: { sourceId: f.sourceId, recruiterId: f.recruiterId || null, eventName: f.eventName || null, label: f.label || null, code: f.code || undefined } }); setOpen(false); setF({ sourceId: '', recruiterId: '', eventName: '', label: '', code: '' }); onChange(); } catch (e: any) { setErr(e.message); }
          }}>Generar</Button></div>
        </div>
      </Modal>
    </Card>
  );
}

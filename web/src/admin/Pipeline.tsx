import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../shared/api';
import { ago, fmtDateTime, RESULT_LABEL, RESULT_TONE } from '../shared/format';
import { Badge, Button, ErrorBox, Field, Input, Loading, Modal, Select, Textarea, useLoad, Empty } from '../shared/ui';
import { useAdmin } from './context';

/** Diálogo para mover de etapa: solo ofrece transiciones permitidas; las excepciones requieren permiso y motivo. */
export function MoveDialog({ app, open, onClose, onMoved, presetTo }: { app: { id: string; stage_code: string } | null; open: boolean; onClose: () => void; onMoved: () => void; presetTo?: string }) {
  const { catalogs, can } = useAdmin();
  const [to, setTo] = useState(presetTo ?? '');
  const [reasonId, setReasonId] = useState('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [override, setOverride] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!app) return null;
  const allowed = new Set(catalogs.transitions.filter((t) => t.from_code === app.stage_code).map((t) => t.to_code));
  allowed.delete('entrevista_agendada'); // se agenda desde la agenda
  const options = catalogs.stages.filter((s) => s.code !== app.stage_code && s.code !== 'entrevista_agendada' && (override || allowed.has(s.code)));
  const target = catalogs.stages.find((s) => s.code === to);
  const reasons = catalogs.closureReasons.filter((r) => r.stage_code === to);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api(`/api/admin/applications/${app.id}/move`, { body: { toStage: to, expectedStage: app.stage_code, closureReasonId: reasonId || undefined, reason: reason || undefined, comment: comment || undefined, nextAction: nextAction || undefined, override: override || undefined } });
      onMoved(); onClose(); setTo(''); setReasonId(''); setReason(''); setComment(''); setNextAction(''); setOverride(false);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="Cambiar etapa" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Etapa actual: <strong>{catalogs.stages.find((s) => s.code === app.stage_code)?.name}</strong></p>
        <Field label="Nueva etapa"><Select value={to} onChange={(e) => { setTo(e.target.value); setReasonId(''); }}><option value="">Selecciona…</option>{options.map((s) => <option key={s.code} value={s.code}>{s.name}{!allowed.has(s.code) ? ' (excepción)' : ''}</option>)}</Select></Field>
        {target?.requires_reason && <Field label="Motivo" required><Select value={reasonId} onChange={(e) => setReasonId(e.target.value)}><option value="">Selecciona…</option>{reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>}
        {can('pipeline.override') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Autorizar excepción fuera del flujo estándar</label>}
        {(override || !target?.requires_reason) && <Field label={override ? 'Justificación de la excepción (obligatoria)' : 'Motivo (opcional)'}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
        <Field label="Comentario"><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        <Field label="Siguiente acción"><Input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="p. ej. Llamar para agendar evaluación" /></Field>
        <ErrorBox error={err} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={busy} disabled={!to}>Mover</Button></div>
      </div>
    </Modal>
  );
}

const KANBAN_STAGES = ['registro_iniciado', 'precalificacion_pendiente', 'revision_compatibilidad', 'contacto_pendiente', 'entrevista_agendada', 'entrevista_realizada', 'evaluacion', 'entrevista_supervisor', 'validacion_requisitos', 'documentacion_pendiente', 'oferta', 'oferta_aceptada', 'contratacion_confirmada', 'onboarding'];

export function Pipeline() {
  const { catalogs, can } = useAdmin();
  const [sp, setSp] = useSearchParams();
  const view = sp.get('vista') ?? 'kanban';
  const filters = Object.fromEntries(['q', 'vacancyId', 'sourceId', 'recruiterId', 'stage', 'stageCategory', 'prequalResult', 'stalled', 'sort', 'dir', 'page'].map((k) => [k, sp.get(k) ?? '']));
  const setFilters = (o: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(o)) { v ? n.set(k, v) : n.delete(k); } if (!('page' in o)) n.delete('page'); setSp(n); };
  const setFilter = (k: string, v: string) => setFilters({ [k]: v });
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v && k !== 'page') p.set(k, v);
    if (view === 'kanban') { p.set('pageSize', '500'); if (!filters.stageCategory) p.set('stageCategory', 'activo'); }
    else { p.set('pageSize', '50'); p.set('page', filters.page || '1'); }
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString(), view]);
  const { data, error, loading, reload } = useLoad(() => api(`/api/admin/applications?${qs}`), [qs]);
  const [moving, setMoving] = useState<any>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ to: string; reasonId: string } | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const recruiters = catalogs.users.filter((u) => ['reclutador', 'coordinador', 'gerente'].includes(u.role));

  const onDrop = (stage: string, appId: string) => {
    const app = data?.rows.find((r: any) => r.id === appId);
    if (!app || app.stage_code === stage) return;
    setMoving({ ...app, presetTo: stage });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Pipeline</h1>
        <div className="flex gap-2">
          <div role="tablist" className="flex rounded-lg border border-slate-300 bg-white p-0.5">
            {[['kanban', 'Kanban'], ['tabla', 'Tabla']].map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} className={`rounded-md px-3 py-1 text-sm ${view === k ? 'bg-brand-700 text-white' : ''}`} onClick={() => setFilter('vista', k)}>{l}</button>)}
          </div>
          {can('export') && <a className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold" href={`/api/admin/applications/export.csv?${qs.replace(/pageSize=\d+&?|page=\d+&?/g, '')}`}>Exportar CSV</a>}
        </div>
      </div>
      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3 lg:grid-cols-7">
        <Input placeholder="Nombre, teléfono, correo" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} aria-label="Buscar" />
        <Select value={filters.vacancyId} onChange={(e) => setFilter('vacancyId', e.target.value)} aria-label="Vacante"><option value="">Todas las vacantes</option><VacancyOptions /></Select>
        <Select value={filters.sourceId} onChange={(e) => setFilter('sourceId', e.target.value)} aria-label="Fuente"><option value="">Todas las fuentes</option>{catalogs.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select value={filters.recruiterId} onChange={(e) => setFilter('recruiterId', e.target.value)} aria-label="Reclutador"><option value="">Todos los reclutadores</option><option value="none">Sin asignar</option>{recruiters.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select>
        <Select value={filters.prequalResult} onChange={(e) => setFilter('prequalResult', e.target.value)} aria-label="Precalificación"><option value="">Cualquier resultado</option>{Object.entries(RESULT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        {view === 'tabla' ? (
          <Select value={filters.stage} onChange={(e) => setFilter('stage', e.target.value)} aria-label="Etapa"><option value="">Todas las etapas</option>{catalogs.stages.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</Select>
        ) : (
          <Select value={filters.stageCategory} onChange={(e) => setFilter('stageCategory', e.target.value)} aria-label="Categoría"><option value="">Activos</option><option value="contratado">Contratados</option></Select>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={filters.stalled === '1'} onChange={(e) => setFilter('stalled', e.target.checked ? '1' : '')} /> Solo estancados</label>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (view === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {catalogs.stages.filter((s) => KANBAN_STAGES.includes(s.code) && (filters.stageCategory === 'contratado' ? s.category === 'contratado' : s.category === 'activo')).map((s) => {
            const cards = data.rows.filter((r: any) => r.stage_code === s.code);
            return (
              <section key={s.code} className={`${cards.length ? "w-64" : "w-44"} shrink-0 rounded-xl bg-slate-100 p-2`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(s.code, e.dataTransfer.getData('text/plain'))} aria-label={s.name}>
                <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{s.name}<span className="rounded-full bg-white px-2 py-0.5">{cards.length}</span></h2>
                <div className="space-y-2">
                  {cards.map((r: any) => (
                    <article key={r.id} draggable={can('application.move')} onDragStart={(e) => e.dataTransfer.setData('text/plain', r.id)} className={`rounded-lg border bg-white p-2.5 text-sm shadow-sm ${r.stalled ? 'border-amber-400' : 'border-slate-200'}`}>
                      <Link to={`/admin/postulaciones/${r.id}`} className="font-semibold text-slate-900 hover:underline">{r.first_name} {r.last_name}</Link>
                      <p className="truncate text-xs text-slate-500">{r.vacancy_title}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {r.prequal_result && <Badge tone={RESULT_TONE[r.prequal_result]}>{RESULT_LABEL[r.prequal_result]}</Badge>}
                        {r.stalled && <Badge tone="amber">Estancado</Badge>}
                        {r.overdue_tasks > 0 && <Badge tone="red">{r.overdue_tasks} vencida(s)</Badge>}
                        {r.is_demo && <Badge>DEMO</Badge>}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
                        <span>{r.recruiter_name ?? 'Sin asignar'} · {ago(r.stage_entered_at)}</span>
                        {can('application.move') && <button className="font-semibold text-brand-700" onClick={() => setMoving(r)} aria-label={`Mover a ${r.first_name}`}>Mover</button>}
                      </div>
                    </article>
                  ))}
                  {!cards.length && <p className="px-1 py-4 text-center text-xs text-slate-400">Sin candidatos</p>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white">
          {can('application.move') && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-brand-50 p-2 text-sm">
              <span>{selected.size} seleccionados</span>
              <Select className="w-auto" value={bulk?.to ?? ''} onChange={(e) => setBulk({ to: e.target.value, reasonId: '' })}><option value="">Mover a…</option>{catalogs.stages.filter((s) => ['rechazado', 'no_localizado', 'abandono', 'reserva', 'retirado', 'contacto_pendiente'].includes(s.code)).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</Select>
              {bulk?.to && catalogs.stages.find((s) => s.code === bulk.to)?.requires_reason && <Select className="w-auto" value={bulk.reasonId} onChange={(e) => setBulk({ ...bulk, reasonId: e.target.value })}><option value="">Motivo…</option>{catalogs.closureReasons.filter((r) => r.stage_code === bulk.to).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}
              <Button size="sm" disabled={!bulk?.to} onClick={async () => {
                const r = await api('/api/admin/applications/bulk-move', { body: { ids: [...selected], toStage: bulk!.to, closureReasonId: bulk!.reasonId || undefined } }).catch((e) => ({ error: e.message }));
                setBulkMsg(r.error ?? `${r.moved} movidos; ${r.results.length - r.moved} no permitidos por las reglas del flujo`); setSelected(new Set()); reload();
              }}>Aplicar</Button>
            </div>
          )}
          {bulkMsg && <p className="border-b border-slate-200 p-2 text-sm text-slate-700">{bulkMsg}</p>}
          {!data.rows.length ? <div className="p-4"><Empty title="Sin resultados">Ajusta los filtros para ver candidatos.</Empty></div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-2"><input type="checkbox" aria-label="Seleccionar todos" onChange={(e) => setSelected(e.target.checked ? new Set(data.rows.map((r: any) => r.id)) : new Set())} /></th>
                    {[['name', 'Candidato'], ['', 'Vacante'], ['stage_entered_at', 'Etapa'], ['prequal_score', 'Precalificación'], ['', 'Fuente'], ['', 'Reclutador'], ['last_contact_at', 'Último contacto'], ['created_at', 'Registro']].map(([k, l]) => (
                      <th key={l} className="p-2">{k ? <button className="uppercase" onClick={() => setFilters({ sort: k, dir: filters.sort === k && filters.dir !== 'asc' ? 'asc' : 'desc' })}>{l}{filters.sort === k ? (filters.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button> : l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((r: any) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="p-2"><input type="checkbox" aria-label={`Seleccionar ${r.first_name}`} checked={selected.has(r.id)} onChange={(e) => { const n = new Set(selected); e.target.checked ? n.add(r.id) : n.delete(r.id); setSelected(n); }} /></td>
                      <td className="p-2"><Link className="font-medium text-brand-700 hover:underline" to={`/admin/postulaciones/${r.id}`}>{r.first_name} {r.last_name}</Link><div className="text-xs text-slate-500">{r.phone ?? ''}</div></td>
                      <td className="p-2">{r.vacancy_title}</td>
                      <td className="p-2">{r.stage_name} {r.stalled && <Badge tone="amber">Estancado</Badge>}<div className="text-xs text-slate-500">{ago(r.stage_entered_at)}</div></td>
                      <td className="p-2">{r.prequal_result ? <Badge tone={RESULT_TONE[r.prequal_result]}>{RESULT_LABEL[r.prequal_result]}{r.prequal_score != null ? ` · ${r.prequal_score}` : ''}</Badge> : '—'}</td>
                      <td className="p-2">{r.source_name ?? '—'}</td>
                      <td className="p-2">{r.recruiter_name ?? <span className="text-amber-700">Sin asignar</span>}</td>
                      <td className="p-2">{r.last_contact_at ? ago(r.last_contact_at) : '—'}</td>
                      <td className="p-2 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-slate-200 p-2 text-sm">
            <span>{data.total} postulaciones</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={data.page <= 1} onClick={() => setFilter('page', String(data.page - 1))}>Anterior</Button>
              <span className="py-1">Página {data.page} de {Math.max(1, Math.ceil(data.total / data.pageSize))}</span>
              <Button size="sm" variant="secondary" disabled={data.page * data.pageSize >= data.total} onClick={() => setFilter('page', String(data.page + 1))}>Siguiente</Button>
            </div>
          </div>
        </div>
      ))}
      {moving && <MoveDialogWrapper app={moving} onClose={() => setMoving(null)} onMoved={reload} />}
    </div>
  );
}

function MoveDialogWrapper({ app, onClose, onMoved }: { app: any; onClose: () => void; onMoved: () => void }) {
  return <MoveDialog app={app} open presetTo={app.presetTo} onClose={onClose} onMoved={onMoved} />;
}

function VacancyOptions() {
  const { data } = useLoad(() => api('/api/admin/vacancies'), []);
  return <>{data?.vacancies.map((v: any) => <option key={v.id} value={v.id}>{v.title}</option>)}</>;
}

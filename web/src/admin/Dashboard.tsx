import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../shared/api';
import { addDays, fmtDate, todayYmd } from '../shared/format';
import { Badge, Card, ErrorBox, Input, Loading, Select, Stat, useLoad } from '../shared/ui';
import { useAdmin } from './context';

const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
const hrs = (v: number | null) => (v == null ? '—' : v < 48 ? `${Math.round(v)} h` : `${(v / 24).toFixed(1)} días`);

export function Dashboard() {
  const { catalogs, can } = useAdmin();
  const [f, setF] = useState({ from: addDays(todayYmd(), -29), to: todayYmd(), vacancyId: '', sourceId: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, error, loading, reload } = useLoad(() => api(`/api/admin/dashboard?${qs}`), [qs]);
  const alerts = useLoad(() => api('/api/admin/alerts'), []);
  const vacancies = useLoad(() => api('/api/admin/vacancies'), []);
  if (!can('dashboard.read')) return <p>Sin acceso al dashboard.</p>;
  const t = data?.totals; const c = data?.conversions; const d = data?.definitions;
  const maxStage = Math.max(1, ...(data?.byStage ?? []).map((s: any) => s.total));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-xl font-bold">Dashboard de reclutamiento</h1><p className="text-sm text-slate-500">Calculado en tiempo real desde los registros del sistema. Cohorte: postulaciones creadas en el periodo.</p></div>
        <div className="flex flex-wrap gap-2">
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="Desde" className="w-auto" />
          <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Hasta" className="w-auto" />
          <Select className="w-auto" value={f.vacancyId} onChange={(e) => setF({ ...f, vacancyId: e.target.value })} aria-label="Vacante"><option value="">Todas las vacantes</option>{vacancies.data?.vacancies.map((v: any) => <option key={v.id} value={v.id}>{v.title}</option>)}</Select>
          <Select className="w-auto" value={f.sourceId} onChange={(e) => setF({ ...f, sourceId: e.target.value })} aria-label="Fuente"><option value="">Todas las fuentes</option>{catalogs.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </div>
      </div>

      {alerts.data?.alerts.length > 0 && (
        <Card title="Alertas operativas">
          <ul className="space-y-3">{alerts.data.alerts.map((a: any, i: number) => (
            <li key={i} className="rounded-lg border border-slate-200 p-3">
              <p className="font-semibold"><Badge tone={a.severity === 'alta' ? 'red' : 'amber'}>{a.severity}</Badge> {a.title}</p>
              <p className="mt-1 text-sm text-slate-600">{a.suggestion}</p>
              {a.type === 'estancados' && <p className="mt-1 text-sm">{a.evidence.slice(0, 5).map((e: any) => <Link key={e.id} to={`/admin/postulaciones/${e.id}`} className="mr-3 text-brand-700 hover:underline">{e.name} ({e.stage})</Link>)} <Link to="/admin/pipeline?vista=tabla&stalled=1" className="font-semibold text-brand-700">Ver todos →</Link></p>}
              {a.type === 'entrevistas_sin_resultado' && <p className="mt-1 text-sm">{a.evidence.slice(0, 5).map((e: any) => <Link key={e.id} to={`/admin/postulaciones/${e.application_id}`} className="mr-3 text-brand-700 hover:underline">{e.name}</Link>)}</p>}
              {a.type === 'vacante_en_riesgo' && <p className="mt-1 text-xs text-slate-500">Evidencia: meta {a.evidence[0].meta}, contratados {a.evidence[0].contratados}, en etapas avanzadas {a.evidence[0].candidatos_avanzados}, fecha objetivo {fmtDate(a.evidence[0].fecha_objetivo)}</p>}
            </li>
          ))}</ul>
        </Card>
      )}

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <section aria-label="Volumen">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Volumen</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <Stat label="Visitas a ligas" value={data.visits.visitas} hint="Aperturas de ligas o páginas de vacante" />
              <Stat label="Postulaciones" value={t.postulaciones} hint={d.postulaciones.formula} />
              <Stat label="Candidatos únicos" value={t.candidatos_unicos} hint={d.candidatos_unicos.formula} />
              <Stat label="Registro completo" value={t.registros_completados} hint={d.registros_completados.formula} />
              <Stat label="Precalificados" value={t.precalificados} hint={d.precalificados.formula} />
              <Stat label="Entrevistas agendadas" value={t.entrevistas_agendadas} hint={d.entrevistas_agendadas.formula} />
              <Stat label="Entrevistas realizadas" value={t.entrevistas_realizadas} hint={d.entrevistas_realizadas.formula} />
              <Stat label="Contrataciones" value={t.contrataciones} hint={d.contrataciones.formula} />
            </div>
          </section>
          <section aria-label="Calidad y velocidad">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Conversión, calidad y velocidad</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {([['conv_registro', 'Registro completo'], ['conv_precalificacion', 'Precalificación'], ['tasa_compatibles', 'Compatibles'], ['conv_agenda', 'Agendan entrevista'], ['tasa_asistencia', 'Asistencia'], ['tasa_inasistencia', 'Inasistencia']] as const).map(([k, l]) => (
                <Stat key={k} label={l} value={pct(c[k].value)} hint={`${c[k].num} / ${c[k].den} · ${d[k].formula}`} tone={k === 'tasa_inasistencia' && (c[k].value ?? 0) > 30 ? 'red' : undefined} />
              ))}
              <Stat label="A precalificación (mediana)" value={hrs(t.horas_a_precalificacion)} hint={d.horas_a_precalificacion.formula} />
              <Stat label="A primer contacto (mediana)" value={hrs(t.horas_a_primer_contacto)} hint={d.horas_a_primer_contacto.formula} />
              <Stat label="A primera cita (mediana)" value={hrs(t.horas_a_primera_cita)} hint={d.horas_a_primera_cita.formula} />
              <Stat label="Ofertas aceptadas" value={t.ofertas_aceptadas} hint="No equivale a ingreso efectivo" />
              <Stat label="Ingresos efectivos" value={t.ingresos_efectivos} hint={d.ingresos_efectivos.formula} />
              <Stat label="Costo por contratación" value="—" hint={d.costo_por_contratacion.formula} />
            </div>
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Embudo actual por etapa (activos hoy)">
              <ul className="space-y-1.5">{data.byStage.filter((s: any) => s.category !== 'cerrado' || s.total > 0).map((s: any) => (
                <li key={s.code} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-2 text-sm">
                  <Link to={`/admin/pipeline?vista=tabla&stage=${s.code}`} className="truncate hover:underline">{s.name}</Link>
                  <div className="h-4 rounded bg-slate-100"><div className={`h-4 rounded ${s.category === 'cerrado' ? 'bg-slate-400' : 'bg-brand-500'}`} style={{ width: `${(s.total / maxStage) * 100}%` }} /></div>
                  <span className="text-right">{s.total}{s.estancados > 0 && <span className="ml-1 text-xs text-amber-700" title="Superan el tiempo objetivo">({s.estancados})</span>}</span>
                </li>
              ))}</ul>
            </Card>
            <Card title="Avance contra meta por vacante">
              {!data.goals.length ? <p className="text-sm text-slate-500">Sin vacantes publicadas.</p> : (
                <ul className="space-y-3">{data.goals.map((g: any) => (
                  <li key={g.id} className="text-sm">
                    <div className="flex justify-between"><Link to={`/admin/vacantes/${g.id}`} className="font-medium hover:underline">{g.title}</Link><span>{g.contrataciones} / {g.hire_goal}</span></div>
                    <div className="mt-1 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-emerald-500" style={{ width: `${Math.min(100, (g.contrataciones / g.hire_goal) * 100)}%` }} /></div>
                    <p className="text-xs text-slate-500">Ingresos efectivos: {g.ingresos} · Fecha objetivo: {fmtDate(g.target_fill_date)}</p>
                  </li>
                ))}</ul>
              )}
            </Card>
            <Card title="Efectividad por fuente (cohorte del periodo)">
              <Table rows={data.bySource} cols={[['fuente', 'Fuente'], ['postulaciones', 'Postul.'], ['completados', 'Completos'], ['elegibles', 'Elegibles'], ['entrevistas_realizadas', 'Entrevistas'], ['contrataciones', 'Contrat.']]} />
              <p className="mt-2 text-xs text-slate-500">Atribución por fuente original (primer contacto). Costo por fuente pendiente de registrar gasto por campaña.</p>
            </Card>
            <Card title="Productividad por reclutador (cohorte del periodo)">
              <Table rows={data.byRecruiter} cols={[['reclutador', 'Reclutador'], ['postulaciones', 'Asignadas'], ['contactados', 'Contactados'], ['entrevistas_realizadas', 'Entrevistas'], ['contrataciones', 'Contrat.']]} />
              <p className="mt-2 text-xs text-slate-500">El volumen no mide por sí solo la calidad: compara también conversión y, cuando haya datos, permanencia.</p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Table({ rows, cols }: { rows: any[]; cols: [string, string][] }) {
  if (!rows.length) return <p className="text-sm text-slate-500">Sin datos en el periodo.</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-slate-500"><tr>{cols.map(([, l]) => <th key={l} className="py-1 pr-2">{l}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{rows.map((r, i) => <tr key={i}>{cols.map(([k]) => <td key={k} className="py-1.5 pr-2">{r[k]}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

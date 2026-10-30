import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../shared/api';
import { addDays, fmtDate, todayYmd } from '../shared/format';
import { Badge, Card, ErrorBox, Input, Loading, Select, Stat, useLoad } from '../shared/ui';
import { BarList, Funnel, Legend, PREQUAL_COLORS, SegmentedBar, SERIES, Sparkline, TrendChart } from '../shared/charts';
import { Icon } from '../shared/icons';
import { useAdmin } from './context';

const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
const hrs = (v: number | null) => (v == null ? '—' : v < 48 ? `${Math.round(v)} h` : `${(v / 24).toFixed(1)} días`);
const shortDay = (ymd: string) => new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z'));
const RANGES = [[7, '7 días'], [30, '30 días'], [90, '90 días']] as const;

function Kpi({ label, value, sub, icon, spark, hero, hint }: { label: string; value: ReactNode; sub?: ReactNode; icon: string; spark?: number[]; hero?: boolean; hint?: string }) {
  return (
    <div title={hint} className={`group relative overflow-hidden rounded-2xl p-5 transition hover:-translate-y-0.5 ${hero ? 'bg-hero text-white shadow-lg shadow-brand-700/25' : 'border border-slate-200/70 bg-white shadow-sm hover:shadow-md'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${hero ? 'bg-white/15' : 'bg-brand-50 text-brand-700'}`}><Icon name={icon} className="h-5 w-5" /></span>
        {spark && <Sparkline values={spark} color={hero ? '#fff' : SERIES.primary} />}
      </div>
      <p className={`mt-4 text-sm font-medium ${hero ? 'text-white/80' : 'text-slate-500'}`}>{label}</p>
      <p className="mt-0.5 text-3xl font-extrabold tracking-tight tabular-nums">{value}</p>
      {sub && <p className={`mt-1 text-xs ${hero ? 'text-white/75' : 'text-slate-500'}`}>{sub}</p>}
    </div>
  );
}

export function Dashboard() {
  const { catalogs, can, me } = useAdmin();
  const [f, setF] = useState({ from: addDays(todayYmd(), -29), to: todayYmd(), vacancyId: '', sourceId: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, error, loading, reload } = useLoad(() => api(`/api/admin/dashboard?${qs}`), [qs]);
  const alerts = useLoad(() => api('/api/admin/alerts'), []);
  const vacancies = useLoad(() => api('/api/admin/vacancies'), []);
  if (!can('dashboard.read')) return <p>Sin acceso al dashboard.</p>;
  const t = data?.totals; const c = data?.conversions; const d = data?.definitions;
  const daily: any[] = data?.daily ?? [];
  const activeStages = (data?.byStage ?? []).filter((s: any) => s.category !== 'cerrado' && s.total > 0);
  const closedTotal = (data?.byStage ?? []).filter((s: any) => s.category === 'cerrado').reduce((a: number, s: any) => a + s.total, 0);
  const rangeDays = Math.round((new Date(f.to).getTime() - new Date(f.from).getTime()) / 86400000) + 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">Hola, {me.user.fullName.split(' ')[0]} 👋</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Dashboard de reclutamiento</h1>
          <p className="text-sm text-slate-500">Calculado en vivo desde los registros. Cohorte: postulaciones creadas entre {shortDay(f.from)} y {shortDay(f.to)}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="group" aria-label="Periodo rápido">
            {RANGES.map(([n, l]) => (
              <button key={n} onClick={() => setF({ ...f, from: addDays(todayYmd(), -(n - 1)), to: todayYmd() })}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${rangeDays === n && f.to === todayYmd() ? 'bg-brand-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>{l}</button>
            ))}
          </div>
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="Desde" className="w-auto" />
          <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Hasta" className="w-auto" />
          <Select className="w-auto" value={f.vacancyId} onChange={(e) => setF({ ...f, vacancyId: e.target.value })} aria-label="Vacante"><option value="">Todas las vacantes</option>{vacancies.data?.vacancies.map((v: any) => <option key={v.id} value={v.id}>{v.title}</option>)}</Select>
          <Select className="w-auto" value={f.sourceId} onChange={(e) => setF({ ...f, sourceId: e.target.value })} aria-label="Fuente"><option value="">Todas las fuentes</option>{catalogs.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </div>
      </div>

      {t?.demo > 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Icon name="flag" className="h-4 w-4 shrink-0" /> Este periodo incluye <strong>{t.demo}</strong> postulaciones de demostración (marcadas como DEMO). Las cifras se calculan igual que con datos reales.
        </p>
      )}

      {alerts.data?.alerts.length > 0 && (
        <section aria-label="Alertas operativas" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {alerts.data.alerts.map((a: any, i: number) => (
            <div key={i} className={`animate-rise rounded-2xl border-l-4 bg-white p-4 shadow-sm ${a.severity === 'alta' ? 'border-l-red-500' : 'border-l-amber-400'}`} style={{ animationDelay: `${i * 60}ms` }}>
              <p className="flex items-center gap-2 font-semibold text-slate-900"><Badge tone={a.severity === 'alta' ? 'red' : 'amber'}>{a.severity}</Badge>{a.title}</p>
              <p className="mt-1 text-sm text-slate-600">{a.suggestion}</p>
              {a.type === 'estancados' && <p className="mt-2 text-sm">{a.evidence.slice(0, 3).map((e: any) => <Link key={e.id} to={`/admin/postulaciones/${e.id}`} className="mr-3 text-brand-700 hover:underline">{e.name}</Link>)} <Link to="/admin/pipeline?vista=tabla&stalled=1" className="font-semibold text-brand-700">Ver todos →</Link></p>}
              {a.type === 'entrevistas_sin_resultado' && <p className="mt-2 text-sm">{a.evidence.slice(0, 4).map((e: any) => <Link key={e.id} to={`/admin/postulaciones/${e.application_id}`} className="mr-3 text-brand-700 hover:underline">{e.name}</Link>)}</p>}
              {a.type === 'vacante_en_riesgo' && <p className="mt-2 text-xs text-slate-500">Meta {a.evidence[0].meta} · contratados {a.evidence[0].contratados} · en etapas avanzadas {a.evidence[0].candidatos_avanzados} · objetivo {fmtDate(a.evidence[0].fecha_objetivo)}</p>}
            </div>
          ))}
        </section>
      )}

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <section aria-label="Indicadores principales" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi hero icon="users" label="Postulaciones" value={t.postulaciones} spark={daily.map((x) => x.postulaciones)} hint={d.postulaciones.formula}
              sub={<>{data.visits.visitas} visitas a ligas · {pct(c.conv_registro.value)} completa registro</>} />
            <Kpi icon="star" label="Perfiles compatibles" value={pct(c.tasa_compatibles.value)} hint={d.tasa_compatibles.formula}
              sub={`${c.tasa_compatibles.num} de ${c.tasa_compatibles.den} precalificados`} spark={daily.map((x) => x.precalificados)} />
            <Kpi icon="calendar" label="Entrevistas realizadas" value={t.entrevistas_realizadas} hint={d.entrevistas_realizadas.formula}
              sub={<>Asistencia {pct(c.tasa_asistencia.value)} · {t.entrevistas_agendadas} agendadas</>} />
            <Kpi icon="briefcase" label="Contrataciones" value={t.contrataciones} hint={d.contrataciones.formula}
              sub={<>{t.ingresos_efectivos} con ingreso efectivo · {t.ofertas_aceptadas} ofertas aceptadas</>} />
          </section>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Ritmo de captación" actions={<Legend items={[{ label: 'Postulaciones', color: SERIES.primary }, { label: 'Precalificaciones', color: SERIES.secondary }]} />}>
              <TrendChart data={daily.map((x) => ({ label: shortDay(x.dia), values: x }))} series={[{ key: 'postulaciones', label: 'Postulaciones', color: SERIES.primary }, { key: 'precalificados', label: 'Precalificaciones', color: SERIES.secondary }]} />
            </Card>
            <Card title="Resultado de precalificación">
              <p className="-mt-1 mb-4 text-xs text-slate-500">Motor explicable. Ningún resultado rechaza automáticamente: "No cumple" pasa a revisión humana.</p>
              <SegmentedBar items={[
                { label: 'Compatible', value: t.compatible, color: PREQUAL_COLORS.compatible },
                { label: 'Con observaciones', value: t.compatible_con_observaciones, color: PREQUAL_COLORS.compatible_con_observaciones },
                { label: 'Requiere revisión', value: t.requiere_revision, color: PREQUAL_COLORS.requiere_revision },
                { label: 'No cumple', value: t.no_cumple, color: PREQUAL_COLORS.no_cumple },
              ]} />
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
                <div><p className="text-xs text-slate-500">Mediana a precalificar</p><p className="text-lg font-bold">{hrs(t.horas_a_precalificacion)}</p></div>
                <div><p className="text-xs text-slate-500">Mediana a 1er contacto</p><p className="text-lg font-bold">{hrs(t.horas_a_primer_contacto)}</p></div>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Embudo del periodo" actions={<span className="text-xs text-slate-500">% sobre postulaciones</span>}>
              <Funnel steps={[
                { label: 'Postulaciones', value: t.postulaciones, hint: d.postulaciones.formula },
                { label: 'Registro completo', value: t.registros_completados, hint: d.registros_completados.formula },
                { label: 'Precalificados', value: t.precalificados, hint: d.precalificados.formula },
                { label: 'Entrevista agendada', value: t.entrevistas_agendadas, hint: d.entrevistas_agendadas.formula },
                { label: 'Entrevista realizada', value: t.entrevistas_realizadas, hint: d.entrevistas_realizadas.formula },
                { label: 'Oferta aceptada', value: t.ofertas_aceptadas, hint: 'Postulaciones de la cohorte que llegaron a oferta aceptada' },
                { label: 'Contratación', value: t.contrataciones, hint: d.contrataciones.formula },
              ]} />
            </Card>
            <Card title="Fuentes que mejor convierten" actions={<span className="text-xs text-slate-500">por fuente original</span>}>
              <BarList rows={data.bySource.map((s: any) => ({
                key: s.fuente, label: s.fuente, value: s.postulaciones,
                sub: <>{s.completados} completos · {s.elegibles} elegibles · {s.entrevistas_realizadas} entrevistas · <strong className="text-slate-700">{s.contrataciones} contrat.</strong>{s.postulaciones > 0 && <> · {Math.round((s.elegibles / s.postulaciones) * 100)}% elegibles</>}</>,
              }))} />
              <p className="mt-3 text-xs text-slate-500">Costo por fuente pendiente de registrar gasto por campaña.</p>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2" title="Pipeline hoy" actions={<Link to="/admin/pipeline" className="text-sm font-semibold text-brand-700 hover:underline">Ver tablero completo →</Link>}>
              <p className="-mt-1 mb-3 text-xs text-slate-500">Fotografía actual de candidatos activos por etapa (no depende del periodo). Ámbar: superan el tiempo objetivo de la etapa. Cerrados: {closedTotal}.</p>
              {!activeStages.length ? <p className="text-sm text-slate-500">Sin candidatos activos.</p> : (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {activeStages.map((s: any) => {
                    const max = Math.max(...activeStages.map((x: any) => x.total));
                    return (
                      <Link key={s.code} to={`/admin/pipeline?vista=tabla&stage=${s.code}`} className="group flex min-w-[4rem] flex-1 flex-col items-center gap-1 rounded-xl p-1.5 hover:bg-slate-50" title={`${s.name}: ${s.total}${s.estancados ? ` (${s.estancados} estancados)` : ''}`}>
                        <span className="text-sm font-bold tabular-nums text-slate-900">{s.total}</span>
                        <div className="flex h-28 w-full items-end justify-center">
                          <div className="relative w-7 overflow-hidden rounded-t-md bg-brand-500 transition group-hover:bg-brand-600" style={{ height: `${Math.max(6, (s.total / max) * 100)}%` }}>
                            {s.estancados > 0 && <div className="absolute inset-x-0 top-0 bg-amber-400" style={{ height: `${(s.estancados / s.total) * 100}%` }} />}
                          </div>
                        </div>
                        <span className="line-clamp-2 text-center text-[11px] leading-tight text-slate-600">{s.name}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Card>
            <Card title="Avance contra meta">
              {!data.goals.length ? <p className="text-sm text-slate-500">Sin vacantes publicadas.</p> : (
                <ul className="space-y-4">{data.goals.map((g: any) => {
                  const p = Math.min(100, (g.contrataciones / Math.max(1, g.hire_goal)) * 100);
                  return (
                    <li key={g.id} className="text-sm">
                      <div className="flex justify-between gap-2"><Link to={`/admin/vacantes/${g.id}`} className="truncate font-semibold hover:underline">{g.title}</Link><span className="tabular-nums"><strong>{g.contrataciones}</strong> / {g.hire_goal}</span></div>
                      <div className="mt-1.5 h-2.5 rounded-full bg-slate-100"><div className="h-2.5 origin-left animate-grow rounded-full bg-linear-to-r from-emerald-500 to-teal-400" style={{ width: `${Math.max(2, p)}%` }} /></div>
                      <p className="mt-1 text-xs text-slate-500">{Math.round(p)}% de la meta · ingresos efectivos {g.ingresos} · objetivo {fmtDate(g.target_fill_date)}</p>
                    </li>
                  );
                })}</ul>
              )}
            </Card>
          </div>

          <section aria-label="Calidad y velocidad">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Detalle de indicadores · pasa el cursor para ver la fórmula</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <Stat label="Candidatos únicos" value={t.candidatos_unicos} hint={d.candidatos_unicos.formula} />
              <Stat label="Registro completo" value={pct(c.conv_registro.value)} hint={`${c.conv_registro.num} / ${c.conv_registro.den} · ${d.conv_registro.formula}`} />
              <Stat label="Precalificación" value={pct(c.conv_precalificacion.value)} hint={`${c.conv_precalificacion.num} / ${c.conv_precalificacion.den} · ${d.conv_precalificacion.formula}`} />
              <Stat label="Agendan entrevista" value={pct(c.conv_agenda.value)} hint={`${c.conv_agenda.num} / ${c.conv_agenda.den} · ${d.conv_agenda.formula}`} />
              <Stat label="Inasistencia" value={pct(c.tasa_inasistencia.value)} hint={`${c.tasa_inasistencia.num} / ${c.tasa_inasistencia.den} · ${d.tasa_inasistencia.formula}`} tone={(c.tasa_inasistencia.value ?? 0) > 30 ? 'red' : undefined} />
              <Stat label="A primera cita (mediana)" value={hrs(t.horas_a_primera_cita)} hint={d.horas_a_primera_cita.formula} />
            </div>
          </section>

          <Card title="Productividad por reclutador (cohorte del periodo)">
            <Table rows={data.byRecruiter} cols={[['reclutador', 'Reclutador'], ['postulaciones', 'Asignadas'], ['contactados', 'Contactados'], ['entrevistas_realizadas', 'Entrevistas'], ['contrataciones', 'Contrat.']]} />
            <p className="mt-2 text-xs text-slate-500">El volumen no mide por sí solo la calidad: compara también conversión y, cuando haya datos, permanencia.</p>
          </Card>
        </>
      )}
    </div>
  );
}

function Table({ rows, cols }: { rows: any[]; cols: [string, string][] }) {
  if (!rows.length) return <p className="text-sm text-slate-500">Sin datos en el periodo.</p>;
  const max = Math.max(1, ...rows.map((r) => r[cols[1][0]]));
  return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr>{cols.map(([, l]) => <th key={l} className="py-2 pr-3 font-semibold">{l}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{rows.map((r, i) => (
        <tr key={i} className="hover:bg-slate-50/60">{cols.map(([k], j) => (
          <td key={k} className="py-2.5 pr-3 tabular-nums">
            {j === 0 ? <span className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{String(r[k]).slice(0, 1)}</span>{r[k]}</span>
              : j === 1 ? <span className="flex items-center gap-2"><span className="h-1.5 w-16 rounded-full bg-slate-100"><span className="block h-1.5 rounded-full bg-brand-500" style={{ width: `${(r[k] / max) * 100}%` }} /></span>{r[k]}</span>
              : r[k]}
          </td>
        ))}</tr>
      ))}</tbody>
    </table></div>
  );
}

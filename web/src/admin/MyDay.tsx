import { Link } from 'react-router-dom';
import { api } from '../shared/api';
import { ago, fmtTime, RESULT_LABEL, RESULT_TONE } from '../shared/format';
import { Badge, Card, ErrorBox, Loading, useLoad } from '../shared/ui';
import { BarList } from '../shared/charts';
import { Icon } from '../shared/icons';
import { useAdmin } from './context';

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('es-MX', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Mexico_City' }).format(new Date()));
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
};
const longToday = () => new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' }).format(new Date());
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const IV_STATUS: Record<string, [string, string]> = { agendada: ['Por confirmar', 'amber'], confirmada: ['Confirmada', 'green'], realizada: ['Realizada', 'blue'], no_asistio: ['No asistió', 'red'] };

function Delta({ now, prev }: { now: number; prev: number }) {
  const d = now - prev;
  if (!d) return <span className="text-xs text-slate-500">igual que la semana anterior</span>;
  return <span className={`text-xs font-semibold ${d > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(d)} vs. semana anterior</span>;
}

export function MyDay() {
  const { me } = useAdmin();
  const { data, error, loading, reload } = useLoad(() => api('/api/admin/my-day'), []);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const first = me.user.fullName.split(' ')[0];
  const nextIv = data.interviews.find((i: any) => new Date(i.ends_at) > new Date() && ['agendada', 'confirmada'].includes(i.status));
  const w = data.week;

  return (
    <div className="space-y-6">
      <section className="bg-hero relative animate-rise overflow-hidden rounded-3xl p-6 text-white shadow-xl shadow-brand-900/20 lg:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <p className="text-sm font-medium text-white/75">{longToday().replace(/^./, (c) => c.toUpperCase())}</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{greeting()}, {first}</h1>
            <p className="mt-2 text-white/85">
              Hoy tienes <strong>{plural(data.toContact.length, 'persona', 'personas')} por contactar</strong>, <strong>{plural(data.interviews.length, 'entrevista', 'entrevistas')}</strong> y{' '}
              <strong>{plural(data.tasks.overdue, 'tarea vencida', 'tareas vencidas')}</strong>.
              {nextIv && <> Tu próxima cita es a las <strong>{fmtTime(nextIv.starts_at)}</strong> con {nextIv.name.replace(' (DEMO)', '')}.</>}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[['Por contactar', data.toContact.length, 'phone'], ['Entrevistas hoy', data.interviews.length, 'calendar'], ['Tareas vencidas', data.tasks.overdue, 'flag']].map(([l, n, i]) => (
              <div key={l as string} className="min-w-[6.5rem] rounded-2xl bg-white/12 p-3 ring-1 ring-white/20 backdrop-blur">
                <Icon name={i as string} className="h-4 w-4 text-white/80" />
                <p className="mt-2 text-3xl font-extrabold tabular-nums leading-none">{n}</p>
                <p className="mt-1 text-xs text-white/75">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Por contactar" actions={<Link to="/admin/pipeline?vista=tabla&stage=contacto_pendiente" className="text-sm font-semibold text-brand-700 hover:underline">Ver todos →</Link>}>
          <p className="-mt-1 mb-3 text-xs text-slate-500">{data.definitions.toContact}.</p>
          {!data.toContact.length ? <EmptyNice icon="check" text="No tienes a nadie esperando contacto. ¡Bien!" /> : (
            <ul className="divide-y divide-slate-100">
              {data.toContact.map((c: any, i: number) => (
                <li key={c.id} className="flex animate-rise flex-wrap items-center gap-3 py-3" style={{ animationDelay: `${i * 40}ms` }}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-brand-100 to-violet-100 font-bold text-brand-700">{c.name.slice(0, 1)}</span>
                  <div className="min-w-0 flex-1">
                    <Link to={`/admin/postulaciones/${c.id}`} className="font-semibold text-slate-900 hover:underline">{c.name}</Link>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span>{c.vacancy}</span>·<span>{c.stage}</span>
                      {c.prequal_result && <Badge tone={RESULT_TONE[c.prequal_result]}>{RESULT_LABEL[c.prequal_result]}</Badge>}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p className={c.overdue ? 'font-semibold text-red-700' : 'text-slate-500'}>{c.overdue && '⚠ '}Espera {ago(c.stage_entered_at).replace('hace ', '')}</p>
                    <p className="text-slate-400">{c.last_contact_at ? `Último contacto ${ago(c.last_contact_at)}` : 'Sin contacto aún'}</p>
                  </div>
                  <div className="flex gap-2">
                    {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"><Icon name="phone" className="h-4 w-4" />Llamar</a>}
                    <Link to={`/admin/postulaciones/${c.id}`} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Ficha</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Entrevistas de hoy" actions={<Link to="/admin/agenda" className="text-sm font-semibold text-brand-700 hover:underline">Agenda →</Link>}>
          {!data.interviews.length ? <EmptyNice icon="calendar" text="Sin entrevistas para hoy." /> : (
            <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5">
              {data.interviews.map((iv: any) => {
                const [label, tone] = IV_STATUS[iv.status] ?? [iv.status, 'gray'];
                const isNext = nextIv?.id === iv.id;
                return (
                  <li key={iv.id} className="relative">
                    <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${isNext ? 'animate-pulse-ring bg-brand-600' : iv.status === 'realizada' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <p className="text-sm font-bold tabular-nums text-slate-900">{fmtTime(iv.starts_at)} {isNext && <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">Siguiente</span>}</p>
                    <Link to={`/admin/postulaciones/${iv.application_id}`} className="font-medium text-slate-800 hover:underline">{iv.name}</Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500"><Badge tone={tone}>{label}</Badge>{iv.mode === 'virtual' ? 'Virtual' : iv.location}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Mis tareas" actions={<Link to="/admin/tareas" className="text-sm font-semibold text-brand-700 hover:underline">Bandeja →</Link>}>
          <div className="mb-3 flex gap-2 text-xs">
            <span className="rounded-full bg-red-50 px-2.5 py-1 font-semibold text-red-700">{data.tasks.overdue} vencidas</span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">{data.tasks.dueToday} vencen hoy</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">{data.tasks.open} abiertas</span>
          </div>
          {!data.tasks.top.length ? <EmptyNice icon="check" text="Bandeja vacía." /> : (
            <ul className="space-y-2">{data.tasks.top.map((t: any) => (
              <li key={t.id}>
                <Link to={t.application_id ? `/admin/postulaciones/${t.application_id}` : '/admin/tareas'} className="flex items-start gap-3 rounded-xl p-2 hover:bg-slate-50">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${t.overdue ? 'bg-red-500' : t.priority === 'alta' ? 'bg-amber-400' : 'bg-slate-300'}`} />
                  <span className="min-w-0 text-sm"><span className="font-medium text-slate-800">{t.title}</span><span className="block truncate text-xs text-slate-500">{t.candidate_name ?? 'General'} · {t.overdue ? `venció ${ago(t.due_at)}` : `vence ${fmtTime(t.due_at)}`}</span></span>
                </Link>
              </li>
            ))}</ul>
          )}
        </Card>

        <Card title="Mi semana">
          <p className="-mt-1 mb-3 text-xs text-slate-500">{data.definitions.week}.</p>
          <ul className="space-y-3">
            {[['Contactos registrados', w.contactos, w.contactos_prev, 'phone'], ['Entrevistas realizadas', w.entrevistas, w.entrevistas_prev, 'users'], ['Contrataciones', w.contrataciones, w.contrataciones_prev, 'briefcase']].map(([l, n, p, i]) => (
              <li key={l as string} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm"><Icon name={i as string} /></span>
                <div className="flex-1"><p className="text-xs text-slate-500">{l}</p><Delta now={n as number} prev={p as number} /></div>
                <p className="text-2xl font-extrabold tabular-nums text-slate-900">{n}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Mis candidatos activos" className="lg:col-span-2 xl:col-span-1">
          <BarList rows={data.pipeline.map((s: any) => ({ key: s.code, label: <Link to={`/admin/pipeline?vista=tabla&stage=${s.code}`} className="hover:underline">{s.name}</Link>, value: s.total }))} empty="Sin candidatos activos asignados." />
          {data.wins.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Avances recientes</p>
              <ul className="space-y-1.5 text-sm">{data.wins.map((x: any, i: number) => (
                <li key={i} className="flex items-center gap-2"><Icon name={x.to_code === 'entrevista_realizada' ? 'check' : 'star'} className={`h-4 w-4 ${x.to_code === 'entrevista_realizada' ? 'text-emerald-600' : 'text-amber-500'}`} />
                  <Link to={`/admin/postulaciones/${x.application_id}`} className="truncate font-medium hover:underline">{x.name}</Link><span className="ml-auto shrink-0 text-xs text-slate-500">{x.stage} · {ago(x.created_at)}</span></li>
              ))}</ul>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function EmptyNice({ icon, text }: { icon: string; text: string }) {
  return <div className="flex flex-col items-center gap-2 py-8 text-sm text-slate-500"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><Icon name={icon} /></span>{text}</div>;
}

/** Inicio del panel según el rol: el reclutador aterriza en "Mi día"; los demás en el dashboard. */
export function AdminHome({ dashboard }: { dashboard: React.ReactNode }) {
  const { me } = useAdmin();
  return me.user.role === 'reclutador' ? <MyDay /> : <>{dashboard}</>;
}

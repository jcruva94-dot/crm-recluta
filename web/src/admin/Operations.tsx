import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../shared/api';
import { addDays, cdmxToIso, dayKey, fmtDateTime, fmtDayHeader, fmtTime, todayYmd } from '../shared/format';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Notice, Select, useLoad } from '../shared/ui';
import { useAdmin } from './context';

// ---------- Agenda ----------
export function Agenda() {
  const { catalogs, can, me } = useAdmin();
  const [start, setStart] = useState(todayYmd());
  const [days, setDays] = useState(7);
  const [interviewerId, setInterviewerId] = useState('');
  const [creating, setCreating] = useState(false);
  const from = cdmxToIso(start, '00:00');
  const to = cdmxToIso(addDays(start, days), '00:00');
  const { data, error, loading, reload } = useLoad(() => api(`/api/admin/agenda?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${interviewerId ? `&interviewerId=${interviewerId}` : ''}`), [from, to, interviewerId]);
  const byDay = new Map<string, any[]>();
  for (const s of data?.slots ?? []) byDay.set(dayKey(s.starts_at), [...(byDay.get(dayKey(s.starts_at)) ?? []), s]);
  const STATUS: Record<string, [string, string]> = { agendada: ['Agendada', 'blue'], confirmada: ['Confirmada', 'green'], realizada: ['Realizada', 'green'], no_asistio: ['No asistió', 'red'] };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Agenda de entrevistas</h1>
        {can('schedule.manage') && <Button onClick={() => setCreating(true)}>Abrir horarios</Button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setStart(addDays(start, -days))}>← Anterior</Button>
        <Input type="date" className="w-auto" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Desde" />
        <Button variant="secondary" size="sm" onClick={() => setStart(addDays(start, days))}>Siguiente →</Button>
        <Select className="w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Vista"><option value={1}>Día</option><option value={7}>Semana</option><option value={31}>Mes</option></Select>
        {me.user.role !== 'entrevistador' && <Select className="w-auto" value={interviewerId} onChange={(e) => setInterviewerId(e.target.value)} aria-label="Entrevistador"><option value="">Todos los entrevistadores</option>{catalogs.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select>}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : !byDay.size ? <Empty title="No hay horarios en este periodo">{can('schedule.manage') ? 'Abre horarios para que los candidatos puedan agendar.' : ''}</Empty> : (
        <div className="space-y-4">
          {[...byDay.entries()].map(([k, slots]) => (
            <Card key={k} title={<span className="inline-block first-letter:uppercase">{fmtDayHeader(slots[0].starts_at)}</span>} actions={<span className="text-xs text-slate-500">{slots.filter((s) => s.interview_id).length} de {slots.length} ocupados</span>}>
              <ul className="divide-y divide-slate-100">{slots.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="w-24 font-mono">{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</span>
                    <div>
                      {s.interview_id ? (s.application_id ? <Link className="font-medium text-brand-700 hover:underline" to={`/admin/postulaciones/${s.application_id}`}>{s.candidate_name}</Link> : <span>{s.candidate_name}</span>) : <span className="text-slate-400">Disponible</span>}
                      <p className="text-xs text-slate-500">{s.interviewer_name} · {s.mode === 'presencial' ? s.location : 'Virtual'}{s.vacancy_title ? ` · ${s.vacancy_title}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.interview_status && <Badge tone={STATUS[s.interview_status]?.[1]}>{STATUS[s.interview_status]?.[0]}</Badge>}
                    {!s.interview_id && can('schedule.manage') && <Button size="sm" variant="ghost" onClick={async () => { try { await api(`/api/admin/slots/${s.id}`, { method: 'DELETE' }); reload(); } catch (e: any) { alert(e.message); } }}>Quitar</Button>}
                  </div>
                </li>
              ))}</ul>
            </Card>
          ))}
        </div>
      )}
      {creating && <SlotCreator onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
    </div>
  );
}

function SlotCreator({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { catalogs, me } = useAdmin();
  const vacancies = useLoad(() => api('/api/admin/vacancies'), []);
  const [f, setF] = useState({ interviewerId: me.user.id, vacancyId: '', from: addDays(todayYmd(), 1), to: addDays(todayYmd(), 5), weekdays: [1, 2, 3, 4, 5], startTime: '10:00', endTime: '13:00', duration: 30, mode: 'presencial', location: '', meetingUrl: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const starts: string[] = [];
  for (let d = f.from; d <= f.to && starts.length <= 200; d = addDays(d, 1)) {
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    if (!f.weekdays.includes(dow)) continue;
    const [sh, sm] = f.startTime.split(':').map(Number); const [eh, em] = f.endTime.split(':').map(Number);
    for (let m = sh * 60 + sm; m + f.duration <= eh * 60 + em; m += f.duration) {
      const iso = cdmxToIso(d, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
      if (new Date(iso).getTime() > Date.now()) starts.push(iso);
    }
  }
  const WD = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  return (
    <Modal open title="Abrir horarios de entrevista" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Entrevistador"><Select value={f.interviewerId} onChange={(e) => setF({ ...f, interviewerId: e.target.value })}>{catalogs.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select></Field>
        <Field label="Vacante (opcional)" hint="Si no eliges, el horario sirve para cualquier vacante."><Select value={f.vacancyId} onChange={(e) => setF({ ...f, vacancyId: e.target.value })}><option value="">Cualquier vacante</option>{vacancies.data?.vacancies.filter((v: any) => v.status !== 'cerrada').map((v: any) => <option key={v.id} value={v.id}>{v.title}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Desde"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="Hasta"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></div>
        <div className="flex flex-wrap gap-2">{WD.map((l, i) => <label key={l} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.weekdays.includes(i)} onChange={(e) => setF({ ...f, weekdays: e.target.checked ? [...f.weekdays, i] : f.weekdays.filter((x) => x !== i) })} />{l}</label>)}</div>
        <div className="grid grid-cols-3 gap-2"><Field label="Inicio"><Input type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></Field><Field label="Fin"><Input type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></Field><Field label="Duración"><Select value={f.duration} onChange={(e) => setF({ ...f, duration: Number(e.target.value) })}>{[15, 20, 30, 45, 60].map((n) => <option key={n} value={n}>{n} min</option>)}</Select></Field></div>
        <Field label="Modalidad"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="presencial">Presencial</option><option value="virtual">Virtual</option></Select></Field>
        {f.mode === 'presencial' ? <Field label="Dirección / sala" required><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field> : <Field label="Enlace de videollamada (https)" required hint="Pega el enlace de tu sala. No hay integración con calendarios configurada."><Input value={f.meetingUrl} onChange={(e) => setF({ ...f, meetingUrl: e.target.value })} /></Field>}
        <Notice>Se crearán <strong>{starts.length}</strong> horarios (hora del centro de México). Si alguno choca con otro horario del mismo entrevistador, no se creará ninguno.</Notice>
        <ErrorBox error={err} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={!starts.length || starts.length > 200} onClick={async () => {
          setBusy(true); setErr(null);
          try { await api('/api/admin/slots', { body: { interviewerId: f.interviewerId, vacancyId: f.vacancyId || null, mode: f.mode, location: f.location || null, meetingUrl: f.meetingUrl || null, starts, durationMin: f.duration } }); onDone(); }
          catch (e: any) { setErr(e.message); } finally { setBusy(false); }
        }}>Crear horarios</Button></div>
      </div>
    </Modal>
  );
}

// ---------- Bandeja de trabajo ----------
export function Tasks() {
  const { can } = useAdmin();
  const [scope, setScope] = useState('mine');
  const { data, error, loading, reload } = useLoad(() => api(`/api/admin/tasks?scope=${scope}`), [scope]);
  const PRI: Record<string, string> = { alta: 'red', media: 'amber', baja: 'gray' };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-xl font-bold">Bandeja de trabajo</h1><p className="text-sm text-slate-500">Ordenada por vencimiento y prioridad: atiende primero lo rojo.</p></div>
        {can('application.assign') && <Select className="w-auto" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Alcance"><option value="mine">Mis tareas</option><option value="team">Todo mi alcance</option></Select>}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : !data.tasks.length ? <Empty title="¡Sin pendientes!">No tienes tareas abiertas.</Empty> : (
        <ul className="space-y-2">{data.tasks.map((t: any) => (
          <li key={t.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3 ${t.overdue ? 'border-red-300' : 'border-slate-200'}`}>
            <div>
              <p className="font-medium">{t.title}</p>
              <p className="text-sm text-slate-600">{t.application_id ? <Link to={`/admin/postulaciones/${t.application_id}`} className="text-brand-700 hover:underline">{t.candidate_name}</Link> : '—'} · {t.vacancy_title}</p>
              <p className="text-xs text-slate-500"><Badge tone={PRI[t.priority]}>{t.priority}</Badge> {t.overdue ? <span className="font-semibold text-red-700">Vencida · </span> : 'Vence '}{fmtDateTime(t.due_at)} {scope === 'team' && `· ${t.assignee_name ?? 'sin responsable'}`}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={async () => { try { await api(`/api/admin/tasks/${t.id}`, { method: 'PATCH', body: { status: 'completada' } }); reload(); } catch (e: any) { alert(e.message); } }}>Completar</Button>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

// ---------- Mensajes (bandeja de salida) ----------
export function Messages() {
  const { data, error, loading, reload } = useLoad(() => api('/api/admin/messages'), []);
  const TONE: Record<string, string> = { simulado: 'amber', pendiente: 'blue', enviado: 'green', fallido: 'red' };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Bandeja de mensajes</h1>
      {data?.deliveryMode === 'sandbox' && <Notice tone="amber"><strong>Modo de pruebas.</strong> No hay proveedor de WhatsApp, SMS ni correo configurado. Los mensajes se registran como <em>simulados</em> y <strong>no se entregaron</strong> a nadie. Ver docs/PENDIENTES.md para conectar un proveedor.</Notice>}
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Loading /> : !data.messages.length ? <Empty title="Sin mensajes" /> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Fecha</th><th className="p-2">Canal</th><th className="p-2">Destino</th><th className="p-2">Plantilla</th><th className="p-2">Contenido</th><th className="p-2">Estado</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data.messages.map((m: any) => (
            <tr key={m.id}><td className="p-2 whitespace-nowrap">{fmtDateTime(m.created_at)}</td><td className="p-2">{m.channel}</td><td className="p-2">{m.destination}</td><td className="p-2">{m.template_code}</td><td className="p-2 max-w-md">{m.body}</td><td className="p-2"><Badge tone={TONE[m.status]}>{m.status === 'simulado' ? 'SIMULADO · no enviado' : m.status}</Badge></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

// ---------- Duplicados ----------
export function Duplicates() {
  const { data, error, loading, reload } = useLoad(() => api('/api/admin/duplicates'), []);
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold">Revisión de posibles duplicados</h1><p className="text-sm text-slate-500">El sistema no bloquea a nadie por coincidencias dudosas: una persona decide.</p></div>
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Loading /> : !data.duplicates.length ? <Empty title="Sin coincidencias pendientes" /> : data.duplicates.map((d: any) => (
        <Card key={d.id} title={`Coincidencia por ${d.match_on}`}>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            {[1, 2].map((n) => <div key={n} className="rounded-lg bg-slate-50 p-3"><p className="font-semibold">{d[`name${n}`]}</p><p>{d[`phone${n}`] ?? '—'}</p><p>{d[`email${n}`] ?? '—'}</p><p className="text-xs text-slate-500">Registrado {fmtDateTime(d[`created${n}`])}</p></div>)}
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={async () => { await api(`/api/admin/duplicates/${d.id}/resolve`, { body: { resolution: 'misma_persona' } }); reload(); }}>Es la misma persona</Button>
            <Button size="sm" variant="secondary" onClick={async () => { await api(`/api/admin/duplicates/${d.id}/resolve`, { body: { resolution: 'personas_distintas' } }); reload(); }}>Son personas distintas</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------- Auditoría ----------
export function Audit() {
  const [action, setAction] = useState('');
  const { data, error, loading, reload } = useLoad(() => api(`/api/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ''}`), [action]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-bold">Bitácora de auditoría</h1>
        <Select className="w-auto" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Acción"><option value="">Todas las acciones</option>{['auth', 'pipeline', 'application.view', 'export', 'interview', 'vacancy', 'question', 'candidate', 'duplicate'].map((a) => <option key={a} value={a}>{a}</option>)}</Select>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Loading /> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Fecha</th><th className="p-2">Actor</th><th className="p-2">Acción</th><th className="p-2">Entidad</th><th className="p-2">Detalle</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data.entries.map((e: any) => (
            <tr key={e.id}><td className="p-2 whitespace-nowrap">{fmtDateTime(e.created_at)}</td><td className="p-2">{e.user_name ?? e.actor_type}</td><td className="p-2 font-mono text-xs">{e.action}</td><td className="p-2 text-xs">{e.entity_type} {e.entity_type === 'application' ? <Link className="text-brand-700" to={`/admin/postulaciones/${e.entity_id}`}>ver</Link> : ''}</td><td className="p-2 font-mono text-xs text-slate-500">{JSON.stringify(e.details).slice(0, 140)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

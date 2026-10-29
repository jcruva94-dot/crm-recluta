import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../shared/api';
import { ago, fmtDateTime, fmtLongSlot, RESULT_LABEL, RESULT_TONE } from '../shared/format';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, Notice, Select, Textarea, useLoad } from '../shared/ui';
import { useAdmin } from './context';
import { MoveDialog } from './Pipeline';

const OUTCOME: Record<string, string> = { cumple: 'Cumple', parcial: 'Parcial', no_cumple_indispensable: 'No cumple indispensable', revision: 'Revisión', sin_respuesta: 'Sin respuesta', informativo: 'Informativo' };
const OUTCOME_TONE: Record<string, string> = { cumple: 'green', parcial: 'teal', no_cumple_indispensable: 'red', revision: 'amber', sin_respuesta: 'gray', informativo: 'gray' };
const INT_STATUS: Record<string, [string, string]> = { agendada: ['Agendada', 'blue'], confirmada: ['Confirmada', 'green'], realizada: ['Realizada', 'green'], no_asistio: ['No asistió', 'red'], cancelada: ['Cancelada', 'gray'], reprogramada: ['Reprogramada', 'gray'] };

export function ApplicationDetail() {
  const { id } = useParams();
  const { catalogs, can, me } = useAdmin();
  const { data, error, loading, reload } = useLoad(() => api(`/api/admin/applications/${id}`), [id]);
  const [dialog, setDialog] = useState<'move' | 'contact' | 'note' | 'schedule' | 'task' | 'assign' | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const { application: a, candidate: c, vacancy: v } = data;
  const stage = catalogs.stages.find((s) => s.code === a.stage_code);
  const exp = a.prequal_explanation;
  const openTasks = data.tasks.filter((t: any) => ['pendiente', 'en_proceso'].includes(t.status));
  const isInterviewer = me.user.role === 'entrevistador';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/admin/pipeline" className="text-sm text-slate-500 hover:underline">← Pipeline</Link>
          <h1 className="text-2xl font-bold">{c.first_name} {c.last_name} {c.is_demo && <Badge>DEMO</Badge>}</h1>
          <p className="text-slate-600">{v.title} · <Badge tone={stage?.category === 'cerrado' ? 'gray' : 'blue'}>{stage?.name}</Badge> <span className="text-sm text-slate-500">desde {ago(a.stage_entered_at)}</span></p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('note.write') && !isInterviewer && <Button variant="secondary" onClick={() => setDialog('contact')}>Registrar contacto</Button>}
          {can('note.write') && <Button variant="secondary" onClick={() => setDialog('note')}>Nota</Button>}
          {can('schedule.manage') && a.stage_code === 'contacto_pendiente' && <Button variant="secondary" onClick={() => setDialog('schedule')}>Agendar entrevista</Button>}
          {can('task.manage') && <Button variant="secondary" onClick={() => setDialog('task')}>Tarea</Button>}
          {can('application.move') && <Button onClick={() => setDialog('move')}>Cambiar etapa</Button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Precalificación" actions={a.prequal_result && <Badge tone={RESULT_TONE[a.prequal_result]}>{RESULT_LABEL[a.prequal_result]}</Badge>}>
            {!exp ? <p className="text-sm text-slate-500">El candidato aún no envía la precalificación.</p> : (
              <>
                <p className="text-sm text-slate-700">Puntuación: <strong>{a.prequal_score ?? 'sin criterios ponderados'}</strong> · Umbrales: compatible ≥ {exp.thresholds.compatible}, observaciones ≥ {exp.thresholds.observations} · Evaluado {fmtDateTime(exp.evaluatedAt)}</p>
                <Notice tone="amber">La puntuación orienta, no decide. Un resultado automático nunca rechaza: la decisión final es de una persona.</Notice>
                <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">{exp.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1 pr-2">Criterio</th><th className="pr-2">Respuesta</th><th className="pr-2">Peso</th><th className="pr-2">Logro</th><th>Resultado</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">{exp.criteria.map((cr: any) => (
                      <tr key={cr.questionId}><td className="py-1.5 pr-2">{cr.question}</td><td className="pr-2">{cr.answer}</td><td>{cr.weight || '—'}</td><td>{cr.earned ?? '—'}</td><td><Badge tone={OUTCOME_TONE[cr.outcome]}>{OUTCOME[cr.outcome]}</Badge></td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </>
            )}
          </Card>

          <Card title="Entrevistas">
            {!data.interviews.length ? <p className="text-sm text-slate-500">Sin citas.</p> : (
              <ul className="divide-y divide-slate-100">{data.interviews.map((i: any) => <InterviewRow key={i.id} i={i} onChange={reload} />)}</ul>
            )}
          </Card>

          <Card title="Historial del proceso">
            <ol className="space-y-2 text-sm">{data.history.map((h: any) => (
              <li key={h.id} className="border-l-2 border-slate-200 pl-3">
                <p><strong>{catalogs.stages.find((s) => s.code === h.to_code)?.name}</strong> {h.from_code && <span className="text-slate-500">← {catalogs.stages.find((s) => s.code === h.from_code)?.name}</span>} {h.is_override && <Badge tone="purple">Excepción autorizada</Badge>}</p>
                <p className="text-xs text-slate-500">{fmtDateTime(h.created_at)} · {h.user_name ?? (h.actor_type === 'candidate' ? 'Candidato' : 'Sistema')}{h.closure_reason ? ` · Motivo: ${h.closure_reason}` : ''}{h.reason ? ` · ${h.reason}` : ''}</p>
                {h.comment && <p className="text-slate-700">{h.comment}</p>}
                {h.next_action && <p className="text-xs text-brand-700">Siguiente acción: {h.next_action}</p>}
              </li>
            ))}</ol>
          </Card>

          <Card title="Notas y contactos">
            {!data.notes.length ? <p className="text-sm text-slate-500">Sin notas.</p> : (
              <ul className="space-y-3 text-sm">{data.notes.map((n: any) => (
                <li key={n.id}><p className="text-xs text-slate-500">{n.author_name} · {fmtDateTime(n.created_at)} {n.kind === 'contacto' && <Badge tone="blue">Contacto: {n.contact_outcome?.replaceAll('_', ' ')}</Badge>}</p><p className="whitespace-pre-line">{n.body}</p></li>
              ))}</ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Datos del candidato">
            <dl className="grid grid-cols-3 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Celular</dt><dd className="col-span-2">{c.phone ?? <span className="text-slate-400">No disponible para tu rol</span>} {c.phone_verified_at && <Badge tone="green">verificado</Badge>}</dd>
              <dt className="text-slate-500">Correo</dt><dd className="col-span-2 break-all">{c.email ?? '—'}</dd>
              <dt className="text-slate-500">Ciudad</dt><dd className="col-span-2">{c.city ?? '—'}</dd>
              <dt className="text-slate-500">Prefiere</dt><dd className="col-span-2">{c.preferred_channel}</dd>
              {c.do_not_contact && <dd className="col-span-3"><Badge tone="red">Solicitó no recibir mensajes no esenciales</Badge></dd>}
              <dt className="text-slate-500">Fuente</dt><dd className="col-span-2">{data.source?.first_source ?? '—'}{data.source?.last_source && data.source.last_source !== data.source.first_source ? ` → último: ${data.source.last_source}` : ''}</dd>
              {data.source?.event_name && <><dt className="text-slate-500">Evento</dt><dd className="col-span-2">{data.source.event_name}</dd></>}
              <dt className="text-slate-500">Registro</dt><dd className="col-span-2">{fmtDateTime(a.created_at)}</dd>
              <dt className="text-slate-500">Últ. contacto</dt><dd className="col-span-2">{a.last_contact_at ? ago(a.last_contact_at) : 'Sin contacto registrado'}</dd>
              {a.no_show_count > 0 && <><dt className="text-slate-500">Inasistencias</dt><dd className="col-span-2 text-red-700">{a.no_show_count}</dd></>}
            </dl>
          </Card>
          <Card title="Responsable" actions={can('application.assign') && <Button size="sm" variant="ghost" onClick={() => setDialog('assign')}>Reasignar</Button>}>
            <p className="text-sm">{a.recruiter?.full_name ?? <span className="text-amber-700">Sin asignar</span>}</p>
            {a.next_action && <p className="mt-1 text-sm text-brand-700">Próxima acción: {a.next_action}{a.next_action_at ? ` · ${fmtDateTime(a.next_action_at)}` : ''}</p>}
          </Card>
          {!isInterviewer && (
            <Card title={`Tareas (${openTasks.length} abiertas)`}>
              {!data.tasks.length ? <p className="text-sm text-slate-500">Sin tareas.</p> : (
                <ul className="space-y-2 text-sm">{data.tasks.map((t: any) => <TaskRow key={t.id} t={t} onChange={reload} />)}</ul>
              )}
            </Card>
          )}
          {data.duplicates.length > 0 && (
            <Card title="Posibles duplicados">
              {data.duplicates.map((d: any) => <p key={d.id} className="text-sm">Coincide por {d.match_on} con <strong>{d.other_name}</strong> · <Badge tone={d.status === 'pendiente' ? 'amber' : 'gray'}>{d.status.replaceAll('_', ' ')}</Badge></p>)}
            </Card>
          )}
          {data.otherApplications.length > 0 && (
            <Card title="Otras postulaciones">
              <ul className="text-sm">{data.otherApplications.map((o: any) => <li key={o.id}><Link className="text-brand-700 hover:underline" to={`/admin/postulaciones/${o.id}`}>{o.title}</Link> <span className="text-slate-500">· {catalogs.stages.find((s) => s.code === o.stage_code)?.name}</span></li>)}</ul>
            </Card>
          )}
          {data.consents.length > 0 && (
            <Card title="Consentimientos">
              <ul className="text-xs text-slate-600">{data.consents.map((k: any, i: number) => <li key={i}>{k.purpose.replaceAll('_', ' ')}: {k.granted ? 'otorgado' : 'negado'} · v{k.version} · {fmtDateTime(k.created_at)}</li>)}</ul>
            </Card>
          )}
        </div>
      </div>

      <MoveDialog app={a} open={dialog === 'move'} onClose={() => setDialog(null)} onMoved={reload} />
      <NoteDialog appId={a.id} kind={dialog === 'contact' ? 'contacto' : 'nota'} open={dialog === 'contact' || dialog === 'note'} onClose={() => setDialog(null)} onDone={reload} />
      <ScheduleDialog appId={a.id} open={dialog === 'schedule'} onClose={() => setDialog(null)} onDone={reload} />
      <TaskDialog appId={a.id} open={dialog === 'task'} onClose={() => setDialog(null)} onDone={reload} />
      <AssignDialog appId={a.id} open={dialog === 'assign'} onClose={() => setDialog(null)} onDone={reload} />
    </div>
  );
}

function InterviewRow({ i, onChange }: { i: any; onChange: () => void }) {
  const { can, me } = useAdmin();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ status: 'realizada', result: 'avanza', notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const past = new Date(i.starts_at).getTime() <= Date.now();
  const pending = ['agendada', 'confirmada'].includes(i.status);
  const mayEvaluate = can('interview.evaluate') && (me.user.role !== 'entrevistador' || i.interviewer_id === me.user.id);
  const [label, tone] = INT_STATUS[i.status] ?? [i.status, 'gray'];
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-medium first-letter:uppercase">{fmtLongSlot(i.starts_at)}</p><p className="text-slate-500">{i.interviewer_name} · {i.mode === 'presencial' ? i.location : i.meeting_url} · reservó: {i.booked_by}</p></div>
        <div className="flex items-center gap-2"><Badge tone={tone}>{label}</Badge>{i.result && <Badge tone={i.result === 'avanza' ? 'green' : 'gray'}>{i.result.replace('_', ' ')}</Badge>}
          {pending && mayEvaluate && <Button size="sm" variant="secondary" disabled={!past} title={past ? '' : 'Disponible a partir de la hora de la cita'} onClick={() => setOpen(true)}>Registrar asistencia</Button>}
        </div>
      </div>
      {i.interviewer_notes && <p className="mt-1 whitespace-pre-line text-slate-700">{i.interviewer_notes}</p>}
      <Modal open={open} title="Resultado de la entrevista" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <Field label="Asistencia"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="realizada">Asistió</option><option value="no_asistio">No asistió</option></Select></Field>
          {f.status === 'realizada' && <Field label="Recomendación del entrevistador"><Select value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}><option value="avanza">Avanza</option><option value="pendiente">Pendiente de decidir</option><option value="no_avanza">No avanza</option></Select></Field>}
          <Field label="Notas" hint="Separa hechos observados de opiniones. No registres datos personales sensibles."><Textarea rows={4} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          {f.status === 'no_asistio' && <Notice>Se creará una tarea de recuperación y se invitará al candidato a reagendar.</Notice>}
          <ErrorBox error={err} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={async () => {
            try { await api(`/api/admin/interviews/${i.id}/attendance`, { body: { status: f.status, result: f.status === 'realizada' ? f.result : undefined, notes: f.notes || undefined } }); setOpen(false); onChange(); } catch (e: any) { setErr(e.message); }
          }}>Guardar</Button></div>
        </div>
      </Modal>
    </li>
  );
}

function TaskRow({ t, onChange }: { t: any; onChange: () => void }) {
  const open = ['pendiente', 'en_proceso'].includes(t.status);
  const overdue = open && new Date(t.due_at) < new Date();
  return (
    <li className={`flex items-start justify-between gap-2 ${open ? '' : 'text-slate-400 line-through'}`}>
      <div><p>{t.title}</p><p className={`text-xs ${overdue ? 'font-semibold text-red-700' : 'text-slate-500'}`}>{overdue ? 'Vencida · ' : ''}{fmtDateTime(t.due_at)} · {t.assignee_name ?? 'sin responsable'}</p></div>
      {open && <button className="text-xs font-semibold text-brand-700" onClick={async () => { await api(`/api/admin/tasks/${t.id}`, { method: 'PATCH', body: { status: 'completada' } }).catch((e) => alert(e.message)); onChange(); }}>Completar</button>}
    </li>
  );
}

function NoteDialog({ appId, kind, open, onClose, onDone }: { appId: string; kind: 'nota' | 'contacto'; open: boolean; onClose: () => void; onDone: () => void }) {
  const [body, setBody] = useState('');
  const [outcome, setOutcome] = useState('contactado');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} title={kind === 'contacto' ? 'Registrar contacto' : 'Nueva nota interna'} onClose={onClose}>
      <div className="space-y-3">
        {kind === 'contacto' && <Field label="Resultado"><Select value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="contactado">Contactado</option><option value="no_contesta">No contesta</option><option value="numero_invalido">Número inválido</option><option value="reagendar">Pidió llamar después</option><option value="no_interesado">No interesado</option></Select></Field>}
        <Field label={kind === 'contacto' ? 'Detalle' : 'Nota (visible solo para el equipo)'}><Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <ErrorBox error={err} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={body.trim().length < 2} onClick={async () => {
          try { await api(`/api/admin/applications/${appId}/notes`, { body: { body, kind, contactOutcome: kind === 'contacto' ? outcome : undefined } }); setBody(''); onClose(); onDone(); } catch (e: any) { setErr(e.message); }
        }}>Guardar</Button></div>
      </div>
    </Modal>
  );
}

function ScheduleDialog({ appId, open, onClose, onDone }: { appId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const { data, error, loading } = useLoad(() => (open ? api(`/api/admin/applications/${appId}/slots`) : Promise.resolve(null)), [open, appId]);
  const [slot, setSlot] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} title="Agendar entrevista" onClose={onClose}>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !data?.slots.length ? <Notice tone="amber">No hay horarios disponibles. Crea horarios en la Agenda.</Notice> : (
        <div className="space-y-3">
          <Field label="Horario disponible"><Select value={slot} onChange={(e) => setSlot(e.target.value)}><option value="">Selecciona…</option>{data.slots.map((s: any) => <option key={s.id} value={s.id}>{fmtLongSlot(s.starts_at)} · {s.interviewer_name} · {s.mode}</option>)}</Select></Field>
          <p className="text-xs text-slate-500">Se registrará en la bandeja de mensajes una confirmación para el candidato.</p>
          <ErrorBox error={err} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={!slot} onClick={async () => {
            try { await api(`/api/admin/applications/${appId}/interviews`, { body: { slotId: slot } }); onClose(); onDone(); } catch (e: any) { setErr(e.message); }
          }}>Agendar</Button></div>
        </div>
      )}
    </Modal>
  );
}

function TaskDialog({ appId, open, onClose, onDone }: { appId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 16);
  const [f, setF] = useState({ type: 'contactar', title: '', dueAt: tomorrow, priority: 'media' });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} title="Nueva tarea" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Tipo"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['contactar', 'agendar', 'confirmar', 'entrevistar', 'revisar_perfil', 'validar_documentos', 'solicitar_info', 'emitir_oferta', 'incidencia'].map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}</Select></Field>
        <Field label="Descripción"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Fecha límite"><Input type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} /></Field>
          <Field label="Prioridad"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></Select></Field>
        </div>
        <ErrorBox error={err} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={f.title.trim().length < 3} onClick={async () => {
          try { await api('/api/admin/tasks', { body: { applicationId: appId, type: f.type, title: f.title, dueAt: new Date(f.dueAt).toISOString(), priority: f.priority } }); onClose(); onDone(); } catch (e: any) { setErr(e.message); }
        }}>Crear</Button></div>
      </div>
    </Modal>
  );
}

function AssignDialog({ appId, open, onClose, onDone }: { appId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const { catalogs } = useAdmin();
  const [rid, setRid] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} title="Reasignar responsable" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Reclutador"><Select value={rid} onChange={(e) => setRid(e.target.value)}><option value="">Selecciona…</option>{catalogs.users.filter((u) => ['reclutador', 'coordinador', 'gerente'].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select></Field>
        <ErrorBox error={err} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={!rid} onClick={async () => {
          try { await api(`/api/admin/applications/${appId}/assign`, { body: { recruiterId: rid } }); onClose(); onDone(); } catch (e: any) { setErr(e.message); }
        }}>Asignar</Button></div>
      </div>
    </Modal>
  );
}

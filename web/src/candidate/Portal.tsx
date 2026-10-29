import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../shared/api';
import { fmtLongSlot, fmtDayHeader, dayKey, fmtTime } from '../shared/format';
import { Button, Card, ErrorBox, Field, Input, Loading, Modal, Notice, Select, Textarea, useLoad } from '../shared/ui';
import { CandidateShell, Progress } from './Shell';
import { OtpStep } from './Landing';

function PortalNav() {
  const nav = useNavigate();
  return (
    <nav className="flex items-center gap-3 text-sm">
      <Link to="/portal" className="font-medium text-slate-700">Mi portal</Link>
      <button className="text-slate-500 underline" onClick={async () => { await api('/api/portal/logout', { body: {} }).catch(() => {}); nav('/portal/ingresar'); }}>Salir</button>
    </nav>
  );
}

function useSessionGuard(error: string | null, status?: number) {
  const nav = useNavigate();
  useEffect(() => { if (status === 401) nav('/portal/ingresar', { replace: true }); }, [status, nav]);
  return error;
}

// ---------- Página principal de una postulación ----------
export function ApplicationPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const [status, setStatus] = useState<number>();
  const { data: app, error, loading, reload, setData } = useLoad(async () => {
    try { return await api(`/api/portal/applications/${id}`); }
    catch (e) { if (e instanceof ApiError) setStatus(e.status); throw e; }
  }, [id]);
  useSessionGuard(error, status);

  if (loading && !app) return <CandidateShell nav={<PortalNav />}><Loading /></CandidateShell>;
  if (error || !app) return <CandidateShell nav={<PortalNav />}><ErrorBox error={error} onRetry={reload} /></CandidateShell>;

  return (
    <CandidateShell nav={<PortalNav />}>
      <div className="space-y-4">
        <div>
          <p className="text-sm text-slate-500">Tu postulación</p>
          <h1 className="text-xl font-bold leading-tight">{app.vacancy.title}</h1>
        </div>
        <Progress steps={app.steps} current={app.stage.step} />
        {search.get('recuperado') && <Notice tone="green">Encontramos tu registro anterior y lo recuperamos. Continúa donde te quedaste.</Notice>}

        {app.nextStep === 'registro' && <RegistrationStep app={app} onDone={setData} />}
        {app.nextStep === 'precalificacion' && <QuestionsStep app={app} onDone={setData} />}
        {app.nextStep !== 'registro' && app.nextStep !== 'precalificacion' && (
          <Card>
            {(() => {
              const useResult = app.resultMessage && (app.nextStep === 'agendar' || app.stage.title === 'Tu perfil está en revisión');
              return (<>
                <h2 className="text-lg font-semibold" data-testid="status-title">{useResult && app.nextStep === 'agendar' ? app.resultMessage.title : app.stage.title}</h2>
                <p className="mt-1 text-slate-700">{useResult ? app.resultMessage.text : app.stage.message}</p>
              </>);
            })()}
            {app.vacancy.response_time_text && !app.stage.closed && <p className="mt-2 text-sm text-slate-500">⏱ {app.vacancy.response_time_text}</p>}
          </Card>
        )}
        {app.nextStep === 'agendar' && <SlotPicker app={app} onDone={setData} />}
        {app.interviews.filter((i: any) => ['agendada', 'confirmada'].includes(i.status)).map((i: any) => <InterviewCard key={i.id} app={app} interview={i} onChange={setData} />)}

        {app.interviews.some((i: any) => !['agendada', 'confirmada'].includes(i.status)) && (
          <Card title="Historial de citas">
            <ul className="space-y-1 text-sm">{app.interviews.filter((i: any) => !['agendada', 'confirmada'].includes(i.status)).map((i: any) => (
              <li key={i.id} className="flex justify-between"><span>{fmtLongSlot(i.starts_at)}</span><span className="text-slate-500">{{ realizada: 'Realizada', no_asistio: 'No asististe', cancelada: 'Cancelada' }[i.status as string] ?? i.status}</span></li>
            ))}</ul>
          </Card>
        )}

        <div className="flex flex-wrap justify-between gap-2 pt-2 text-sm">
          <Link to="/portal?tab=ayuda" className="font-semibold text-brand-700 underline">¿Necesitas ayuda?</Link>
          {!app.stage.closed && <WithdrawLink app={app} onDone={setData} />}
        </div>
      </div>
    </CandidateShell>
  );
}

function RegistrationStep({ app, onDone }: { app: any; onDone: (a: any) => void }) {
  const { data: notice, error: nErr } = useLoad(() => api('/api/public/privacy-notice'), []);
  const [f, setF] = useState({ city: '', preferredChannel: 'whatsapp', accept: false, whatsapp: true, sms: false, email: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.city.trim().length < 2) return setError('Indica tu ciudad o municipio');
    if (!f.accept) return setError('Para continuar necesitas aceptar el aviso de privacidad');
    setBusy(true); setError(null);
    try {
      onDone(await api(`/api/portal/applications/${app.id}/registration`, { body: { noticeId: notice.id, acceptPrivacy: true, city: f.city, preferredChannel: f.preferredChannel, consents: { whatsapp: f.whatsapp, sms: f.sms, email: f.email } } }));
      window.scrollTo(0, 0);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Card title="Paso 2 de 3 · Completa tu registro">
        <div className="space-y-4">
          <Field label="Ciudad o municipio donde vives" required><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} autoComplete="address-level2" /></Field>
          <Field label="¿Por dónde prefieres que te contactemos?">
            <Select value={f.preferredChannel} onChange={(e) => setF({ ...f, preferredChannel: e.target.value })}>
              <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="llamada">Llamada</option><option value="email">Correo</option>
            </Select>
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">Acepto recibir mensajes sobre mi proceso por:</legend>
            {(['whatsapp', 'sms', 'email'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{{ whatsapp: 'WhatsApp', sms: 'SMS', email: 'Correo' }[k]}</label>
            ))}
          </fieldset>
        </div>
      </Card>
      <Card title="Aviso de privacidad">
        <ErrorBox error={nErr} />
        {notice && (
          <>
            <p className="text-sm text-slate-600">Versión {notice.version}. Explica qué datos usamos, para qué y cómo ejercer tus derechos ARCO.</p>
            <button type="button" className="mt-2 text-sm font-semibold text-brand-700 underline" onClick={() => setShowNotice(true)}>Leer aviso completo</button>
            <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5" checked={f.accept} onChange={(e) => setF({ ...f, accept: e.target.checked })} data-testid="accept-privacy" /> He leído y acepto el aviso de privacidad para participar en este proceso de selección.</label>
            <Modal open={showNotice} title={notice.title} onClose={() => setShowNotice(false)}><p className="whitespace-pre-line text-sm text-slate-700">{notice.body}</p></Modal>
          </>
        )}
      </Card>
      <ErrorBox error={error} />
      <Button size="lg" type="submit" loading={busy} disabled={!notice}>Continuar</Button>
    </form>
  );
}

function QuestionsStep({ app, onDone }: { app: any; onDone: (a: any) => void }) {
  const qs = app.questions as any[];
  const firstUnanswered = Math.max(0, qs.findIndex((q) => app.answers[q.id] === undefined));
  const [idx, setIdx] = useState(firstUnanswered === -1 ? 0 : firstUnanswered);
  const [answers, setAnswers] = useState<Record<string, any>>(app.answers ?? {});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const q = qs[idx];
  const val = answers[q.id];
  const setVal = (v: any) => setAnswers({ ...answers, [q.id]: v });
  const topRef = useRef<HTMLDivElement>(null);

  const isEmpty = (v: any) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  const next = async () => {
    if (q.required && isEmpty(val)) return setError('Esta pregunta es obligatoria');
    if (q.type === 'number' && !isEmpty(val)) {
      const n = Number(val);
      if (!Number.isFinite(n)) return setError('Escribe un número');
      if (q.min !== undefined && n < q.min) return setError(`El valor mínimo es ${q.min}`);
      if (q.max !== undefined && n > q.max) return setError(`El valor máximo es ${q.max}`);
    }
    setBusy(true); setError(null);
    try {
      const value = q.type === 'number' && !isEmpty(val) ? Number(val) : val ?? null;
      await api(`/api/portal/applications/${app.id}/answers`, { method: 'PUT', body: { answers: { [q.id]: value } } });
      setSaved('Respuesta guardada');
      if (idx < qs.length - 1) { setIdx(idx + 1); topRef.current?.scrollIntoView(); }
      else onDone(await api(`/api/portal/applications/${app.id}/prequal/submit`, { body: {} }));
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div ref={topRef}>
      <Card>
        <div className="mb-3 flex items-center justify-between text-sm text-slate-500">
          <span>Pregunta {idx + 1} de {qs.length}</span>
          {saved && <span aria-live="polite" className="text-emerald-700">✓ {saved}</span>}
        </div>
        <div className="mb-4 h-1 rounded bg-slate-100"><div className="h-1 rounded bg-brand-500 transition-all" style={{ width: `${((idx) / qs.length) * 100}%` }} /></div>
        <fieldset>
          <legend className="text-lg font-semibold leading-snug" data-testid="question-text">{q.text}{q.required && <span className="sr-only"> (obligatoria)</span>}</legend>
          {q.helpText && <p className="mt-1 text-sm text-slate-500">{q.helpText}</p>}
          <div className="mt-4 space-y-2">
            {(q.type === 'yes_no' || q.type === 'single_choice') && (q.type === 'yes_no' && !q.options.length ? [{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }] : q.options).map((o: any) => (
              <label key={o.value} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 ${val === o.value ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white'}`}>
                <input type="radio" name={q.id} className="h-5 w-5" checked={val === o.value} onChange={() => setVal(o.value)} />{o.label}
              </label>
            ))}
            {q.type === 'multi_choice' && q.options.map((o: any) => {
              const arr: string[] = Array.isArray(val) ? val : [];
              return (
                <label key={o.value} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 ${arr.includes(o.value) ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white'}`}>
                  <input type="checkbox" className="h-5 w-5" checked={arr.includes(o.value)} onChange={(e) => setVal(e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))} />{o.label}
                </label>
              );
            })}
            {q.type === 'number' && <Input type="number" inputMode="numeric" value={val ?? ''} min={q.min} max={q.max} onChange={(e) => setVal(e.target.value)} aria-label={q.text} />}
            {q.type === 'date' && <Input type="date" value={val ?? ''} onChange={(e) => setVal(e.target.value)} aria-label={q.text} />}
            {q.type === 'text' && <Textarea rows={3} maxLength={1000} value={val ?? ''} onChange={(e) => setVal(e.target.value)} aria-label={q.text} />}
          </div>
        </fieldset>
        <div className="mt-4"><ErrorBox error={error} /></div>
        <div className="mt-4 flex gap-2">
          {idx > 0 && <Button variant="secondary" onClick={() => { setError(null); setIdx(idx - 1); }}>Anterior</Button>}
          <Button className="flex-1" size="lg" onClick={next} loading={busy}>{idx === qs.length - 1 ? 'Enviar respuestas' : 'Siguiente'}</Button>
        </div>
      </Card>
      <p className="mt-3 text-center text-xs text-slate-500">Tus respuestas se guardan automáticamente. Puedes salir y continuar más tarde.</p>
    </div>
  );
}

function SlotGrid({ slots, selected, onSelect }: { slots: any[]; selected: string | null; onSelect: (id: string) => void }) {
  const byDay = new Map<string, any[]>();
  for (const s of slots) { const k = dayKey(s.startsAt); byDay.set(k, [...(byDay.get(k) ?? []), s]); }
  return (
    <div className="space-y-4">
      {[...byDay.entries()].map(([k, list]) => (
        <div key={k}>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 first-letter:uppercase">{fmtDayHeader(list[0].startsAt)}</h3>
          <div className="grid grid-cols-3 gap-2">
            {list.map((s) => (
              <button key={s.id} type="button" onClick={() => onSelect(s.id)} aria-pressed={selected === s.id} data-testid="slot"
                className={`rounded-lg border px-2 py-2.5 text-sm font-medium ${selected === s.id ? 'border-brand-600 bg-brand-700 text-white' : 'border-slate-300 bg-white hover:border-brand-500'}`}>
                {fmtTime(s.startsAt)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SlotPicker({ app, onDone, interviewId, onCancel }: { app: any; onDone: (a: any) => void; interviewId?: string; onCancel?: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api(`/api/portal/applications/${app.id}/slots`), [app.id]);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slot = data?.slots.find((s: any) => s.id === sel);
  const confirm = async () => {
    setBusy(true); setErr(null);
    try {
      onDone(interviewId
        ? await api(`/api/portal/interviews/${interviewId}/reschedule`, { body: { slotId: sel } })
        : await api(`/api/portal/applications/${app.id}/interviews`, { body: { slotId: sel } }));
    } catch (e: any) { setErr(e.message); setSel(null); reload(); } finally { setBusy(false); }
  };
  return (
    <Card title={interviewId ? 'Elige un nuevo horario' : 'Agenda tu entrevista'}>
      {loading ? <Loading label="Buscando horarios…" /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.slots.length ? (
        <Notice tone="amber">Por ahora no hay horarios disponibles. Tu reclutador te contactará para agendar, o vuelve a revisar más tarde.</Notice>
      ) : (
        <>
          <SlotGrid slots={data.slots} selected={sel} onSelect={setSel} />
          {slot && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-semibold first-letter:uppercase">{fmtLongSlot(slot.startsAt)}</p>
              <p className="text-slate-600">{slot.mode === 'presencial' ? `Presencial · ${slot.location}` : 'Videollamada (recibirás el enlace al confirmar)'}</p>
            </div>
          )}
          <div className="mt-3"><ErrorBox error={err} /></div>
          <div className="sticky bottom-0 -mx-4 mt-4 flex gap-2 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
            {onCancel && <Button variant="secondary" onClick={onCancel}>Volver</Button>}
            <Button className="flex-1" size="lg" disabled={!sel} loading={busy} onClick={confirm}>{interviewId ? 'Cambiar a este horario' : 'Confirmar horario'}</Button>
          </div>
        </>
      )}
    </Card>
  );
}

function InterviewCard({ app, interview, onChange }: { app: any; interview: any; onChange: (a: any) => void }) {
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel'>('view');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (path: string, body: any = {}) => {
    setBusy(true); setErr(null);
    try { onChange(await api(path, { body })); setMode('view'); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  if (mode === 'reschedule') return <SlotPicker app={app} interviewId={interview.id} onDone={(a) => { onChange(a); setMode('view'); }} onCancel={() => setMode('view')} />;
  return (
    <Card title="Tu entrevista">
      <div className="space-y-1" data-testid="interview-card">
        <p className="text-lg font-semibold first-letter:uppercase">{fmtLongSlot(interview.starts_at)}</p>
        <p className="text-slate-700">{interview.mode === 'presencial' ? `📍 ${interview.location}` : <>💻 <a className="text-brand-700 underline" href={interview.meeting_url} target="_blank" rel="noreferrer">Entrar a la videollamada</a></>}</p>
        <p className="text-sm text-slate-500">Con {interview.interviewer_name}</p>
        <p className="pt-1 text-sm">{interview.status === 'confirmada' ? <span className="font-semibold text-emerald-700">✓ Asistencia confirmada</span> : <span className="text-amber-700">Pendiente de confirmar</span>}</p>
      </div>
      {interview.mode === 'presencial' && <Notice>Llega 10 minutos antes con una identificación oficial. Si te retrasas, avisa desde Ayuda.</Notice>}
      <div className="mt-3"><ErrorBox error={err} /></div>
      {mode === 'cancel' ? (
        <div className="mt-3 space-y-2">
          <Field label="¿Por qué necesitas cancelar?"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex gap-2"><Button variant="secondary" onClick={() => setMode('view')}>Volver</Button><Button variant="danger" className="flex-1" loading={busy} disabled={reason.trim().length < 3} onClick={() => act(`/api/portal/interviews/${interview.id}/cancel`, { reason })}>Cancelar cita</Button></div>
        </div>
      ) : (
        <div className="mt-4 grid gap-2">
          {interview.status === 'agendada' && <Button size="lg" loading={busy} onClick={() => act(`/api/portal/interviews/${interview.id}/confirm`)}>Confirmar asistencia</Button>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={!app.canReschedule} onClick={() => setMode('reschedule')}>Reprogramar</Button>
            <Button variant="secondary" onClick={() => setMode('cancel')}>Cancelar</Button>
          </div>
          {!app.canReschedule && <p className="text-xs text-slate-500">Alcanzaste el límite de reprogramaciones. Solicita ayuda si necesitas otro cambio.</p>}
        </div>
      )}
    </Card>
  );
}

function WithdrawLink({ app, onDone }: { app: any; onDone: (a: any) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button className="text-slate-500 underline" onClick={() => setOpen(true)}>Ya no me interesa esta vacante</button>
      <Modal open={open} title="Retirarme del proceso" onClose={() => setOpen(false)}>
        <p className="text-sm text-slate-600">Cerraremos tu proceso para esta vacante y cancelaremos tus citas pendientes. Puedes contarnos el motivo (opcional).</p>
        <Textarea className="mt-3" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-2"><ErrorBox error={err} /></div>
        <div className="mt-4 flex gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Volver</Button><Button variant="danger" className="flex-1" onClick={async () => {
          try { onDone(await api(`/api/portal/applications/${app.id}/withdraw`, { body: { reason: reason || undefined } })); setOpen(false); } catch (e: any) { setErr(e.message); }
        }}>Confirmar retiro</Button></div>
      </Modal>
    </>
  );
}

// ---------- Inicio, perfil y ayuda ----------
export function PortalHome() {
  const [search, setSearch] = useSearchParams();
  const tab = search.get('tab') ?? 'inicio';
  const [status, setStatus] = useState<number>();
  const { data, error, loading, reload } = useLoad(async () => {
    try { return await api('/api/portal/me'); } catch (e) { if (e instanceof ApiError) setStatus(e.status); throw e; }
  }, []);
  useSessionGuard(error, status);
  const tabs = [['inicio', 'Inicio'], ['perfil', 'Mi perfil'], ['ayuda', 'Ayuda']];
  return (
    <CandidateShell nav={<PortalNav />}>
      <div role="tablist" className="mb-4 flex gap-1 rounded-xl bg-white p-1 shadow-sm">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setSearch({ tab: k })} className={`flex-1 rounded-lg py-2 text-sm font-medium ${tab === k ? 'bg-brand-700 text-white' : 'text-slate-600'}`}>{l}</button>)}
      </div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <>
          {tab === 'inicio' && (
            <div className="space-y-3">
              <h1 className="text-xl font-bold">Hola, {data.candidate.first_name}</h1>
              {!data.applications.length ? <p className="text-slate-600">Aún no tienes postulaciones. <Link className="text-brand-700 underline" to="/empleo">Ver vacantes</Link></p> : data.applications.map((a: any) => (
                <Link key={a.id} to={`/portal/postulacion/${a.id}`} className="block rounded-xl bg-white p-4 shadow-sm hover:ring-2 hover:ring-brand-100">
                  <p className="font-semibold">{a.title}</p>
                  <p className={`text-sm ${a.closed ? 'text-slate-500' : 'text-brand-700'}`}>{a.status}</p>
                </Link>
              ))}
              <p className="pt-2 text-center text-sm"><Link to="/empleo" className="text-brand-700 underline">Ver más vacantes</Link></p>
            </div>
          )}
          {tab === 'perfil' && <Profile candidate={data.candidate} onSaved={reload} />}
          {tab === 'ayuda' && <Help applications={data.applications} />}
        </>
      )}
    </CandidateShell>
  );
}

function Profile({ candidate, onSaved }: { candidate: any; onSaved: () => void }) {
  const [f, setF] = useState({ email: candidate.email ?? '', city: candidate.city ?? '', preferredChannel: candidate.preferred_channel, doNotContact: candidate.do_not_contact });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setMsg(null);
    try { await api('/api/portal/me', { method: 'PATCH', body: { email: f.email || null, city: f.city || null, preferredChannel: f.preferredChannel, doNotContact: f.doNotContact } }); setMsg('Datos actualizados'); onSaved(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="space-y-4">
      <Card title="Mis datos">
        <dl className="mb-4 grid grid-cols-3 gap-2 text-sm">
          <dt className="text-slate-500">Nombre</dt><dd className="col-span-2">{candidate.first_name} {candidate.last_name}</dd>
          <dt className="text-slate-500">Celular</dt><dd className="col-span-2">{candidate.phone_e164 ?? '—'} {candidate.phone_verified_at && <span className="text-emerald-700">✓ verificado</span>}</dd>
        </dl>
        <div className="space-y-3">
          <Field label="Correo electrónico" hint={candidate.email_verified_at ? 'Verificado' : 'Opcional'}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Ciudad o municipio"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="Medio de contacto preferido"><Select value={f.preferredChannel} onChange={(e) => setF({ ...f, preferredChannel: e.target.value })}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="llamada">Llamada</option><option value="email">Correo</option></Select></Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5" checked={f.doNotContact} onChange={(e) => setF({ ...f, doNotContact: e.target.checked })} /> No deseo recibir mensajes promocionales ni de otras vacantes (seguirás recibiendo avisos de tus citas).</label>
        </div>
      </Card>
      <ErrorBox error={err} />{msg && <Notice tone="green">{msg}</Notice>}
      <Button size="lg" type="submit" loading={busy}>Guardar cambios</Button>
      <p className="text-xs text-slate-500">Para corregir tu nombre o celular, o para ejercer tus derechos ARCO, usa la sección Ayuda.</p>
    </form>
  );
}

function Help({ applications }: { applications: any[] }) {
  const [f, setF] = useState({ applicationId: applications[0]?.id ?? '', topic: 'continuar', message: '' });
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const faqs = [
    ['¿Cuánto tarda el proceso?', 'Depende de la vacante. En cada postulación verás el tiempo de respuesta que el equipo definió.'],
    ['No me llegó el código', 'Revisa que tu número tenga 10 dígitos y usa "Reenviar código". Si sigue sin llegar, elige otro medio (SMS, WhatsApp o correo).'],
    ['¿Puedo cambiar mi cita?', 'Sí, desde tu postulación puedes reprogramar o cancelar hasta 1 hora antes.'],
    ['¿Qué hacen con mis datos?', 'Solo se usan para tu proceso de selección, conforme al aviso de privacidad que aceptaste.'],
  ];
  return (
    <div className="space-y-4">
      <Card title="Preguntas frecuentes">
        <div className="divide-y divide-slate-100">{faqs.map(([q, a]) => <details key={q} className="py-2"><summary className="cursor-pointer font-medium">{q}</summary><p className="mt-1 text-sm text-slate-600">{a}</p></details>)}</div>
      </Card>
      <Card title="Solicitar ayuda">
        {sent ? <Notice tone="green">Recibimos tu solicitud. Tu reclutador te contactará por tu medio preferido.</Notice> : (
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); setErr(null);
            try { await api('/api/portal/help', { body: { applicationId: f.applicationId || undefined, topic: f.topic, message: f.message } }); setSent(true); } catch (e: any) { setErr(e.message); }
          }}>
            {applications.length > 1 && <Field label="Postulación"><Select value={f.applicationId} onChange={(e) => setF({ ...f, applicationId: e.target.value })}>{applications.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field>}
            <Field label="Tema"><Select value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}><option value="continuar">Quiero continuar mi proceso</option><option value="cita">Mi cita</option><option value="datos">Corregir mis datos / derechos ARCO</option><option value="problema_tecnico">Problema técnico</option><option value="otro">Otro</option></Select></Field>
            <Field label="Cuéntanos qué necesitas"><Textarea rows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
            <ErrorBox error={err} />
            <Button size="lg" type="submit" disabled={f.message.trim().length < 5}>Enviar</Button>
          </form>
        )}
      </Card>
    </div>
  );
}

export function PortalLogin() {
  const nav = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const [challenge, setChallenge] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <CandidateShell>
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        {challenge ? <OtpStep challenge={challenge} onBack={() => setChallenge(null)} onResent={setChallenge} onVerified={() => nav('/portal')} /> : (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true); setErr(null);
            try { setChallenge(await api('/api/public/login/start', { body: { identifier, channel } })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
          }}>
            <div><h1 className="text-xl font-bold">Continúa tu proceso</h1><p className="mt-1 text-slate-600">Escribe el celular o correo con el que te registraste. Te enviaremos un código; no necesitas contraseña.</p></div>
            <Field label="Celular o correo"><Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" /></Field>
            {!identifier.includes('@') && (
              <Field label="Recibir código por"><Select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></Select></Field>
            )}
            <ErrorBox error={err} />
            <Button size="lg" type="submit" loading={busy} disabled={identifier.trim().length < 5}>Enviar código</Button>
          </form>
        )}
      </div>
    </CandidateShell>
  );
}

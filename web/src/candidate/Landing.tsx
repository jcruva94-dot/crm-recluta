import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../shared/api';
import { Button, ErrorBox, Field, Input, Loading, Notice, useLoad } from '../shared/ui';
import { CandidateShell } from './Shell';
import { Icon } from '../shared/icons';

const MODALITY: Record<string, string> = { presencial: 'Presencial', remoto: 'Desde casa', hibrido: 'Híbrido' };

function Section({ title, items, icon }: { title: string; items?: string[] | null; icon: string }) {
  if (!items?.length) return null;
  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon name={icon} className="h-4 w-4" /></span>{title}</h3>
      <ul className="space-y-2">{items.map((i) => <li key={i} className="flex gap-2.5 text-slate-700"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{i}</li>)}</ul>
    </section>
  );
}

function Fact({ icon, label, value }: { icon: string; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-3.5 shadow-sm">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon name={icon} className="h-4 w-4" /></span>
      <p className="mt-2 text-xs font-medium text-slate-500">{label}</p>
      <p className="text-sm font-semibold leading-snug text-slate-900">{value}</p>
    </div>
  );
}

export function VacancyLanding() {
  const { code, slug } = useParams();
  const { data, error, loading, reload } = useLoad(() => api(code ? `/api/public/links/${code}` : `/api/public/vacancies/${slug}`), [code, slug]);
  const [applying, setApplying] = useState(false);
  // Si el candidato ya tiene sesión y se postuló a esta vacante, mostramos su estatus en lugar del registro
  const me = useLoad(() => api('/api/portal/me').catch(() => null), []);
  const existing = data && me.data?.applications?.find((a: any) => a.vacancyId === data.vacancy.id);
  if (loading) return <CandidateShell><Loading /></CandidateShell>;
  if (error || !data) return <CandidateShell><ErrorBox error={error} onRetry={reload} /><p className="mt-4 text-center"><Link className="text-brand-700 underline" to="/empleo">Ver otras vacantes</Link></p></CandidateShell>;
  const v = data.vacancy;
  if (applying) return <CandidateShell><ApplyForm vacancyTitle={v.title} linkCode={code} vacancySlug={code ? undefined : slug} onBack={() => setApplying(false)} /></CandidateShell>;
  const requirements = [...(v.requirements ?? []), ...(v.education ? [`Escolaridad: ${v.education}`] : []), ...(v.experience ? [`Experiencia: ${v.experience}`] : [])];
  return (
    <CandidateShell bleed={
      <div className="bg-hero relative overflow-hidden px-4 pb-16 pt-8 text-white">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative mx-auto max-w-xl animate-rise">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1 text-emerald-100 ring-1 ring-emerald-300/30"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />{v.accepting ? 'Contratando ahora' : 'Vacante cerrada'}</span>
            {v.client_name && <span className="rounded-full bg-white/15 px-3 py-1">{v.client_name}</span>}
          </div>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{v.title}</h1>
          {v.summary && <p className="mt-2 text-white/85">{v.summary}</p>}
          {v.salary_text && (
            <div className="mt-5 inline-flex items-center gap-3 rounded-2xl bg-white/15 px-4 py-3 ring-1 ring-white/20 backdrop-blur">
              <Icon name="money" className="h-6 w-6 text-amber-200" />
              <div><p className="text-xs text-white/75">Sueldo</p><p className="text-lg font-bold leading-tight">{v.salary_text}</p></div>
            </div>
          )}
        </div>
      </div>
    }>
      <article className="-mt-14 space-y-4">
        <div className="grid grid-cols-2 gap-3 animate-rise" style={{ animationDelay: '80ms' }}>
          <Fact icon="briefcase" label="Modalidad" value={MODALITY[v.modality]} />
          <Fact icon="pin" label="Ubicación" value={v.site_city ?? (v.modality === 'remoto' ? 'Desde casa' : null)} />
          <Fact icon="clock" label="Horario" value={v.schedule_text} />
          <Fact icon="chat" label="Respuesta" value={v.response_time_text} />
        </div>

        {existing && (
          <div className="overflow-hidden rounded-3xl border border-brand-100 bg-white shadow-lg shadow-brand-900/5" data-testid="existing-status">
            <div className="bg-brand-50 px-5 py-3 text-sm text-brand-800">Hola {me.data.candidate.first_name}, ya te postulaste a esta vacante</div>
            <div className="p-5">
              <p className="text-lg font-bold text-slate-900">Estatus: {existing.status}</p>
              <Link to={`/portal/postulacion/${existing.id}`} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-linear-to-r from-brand-600 to-violet-600 px-5 py-3.5 font-semibold text-white shadow-md shadow-brand-600/25">Ver mi proceso <Icon name="arrow" className="h-4 w-4" /></Link>
            </div>
          </div>
        )}
        {!existing && (
          <Link to="/portal/ingresar" className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-white p-4 text-sm shadow-sm transition hover:border-brand-200">
            <span>¿Ya te postulaste? <strong className="text-brand-700">Consulta tu estatus</strong></span><Icon name="arrow" className="h-4 w-4 text-brand-700" />
          </Link>
        )}
        {!v.accepting && <Notice tone="amber">Esta vacante ya no está recibiendo postulaciones. <Link to="/empleo" className="font-semibold underline">Ver vacantes abiertas</Link></Notice>}

        {v.process_steps?.length > 0 && (
          <section className="rounded-3xl bg-slate-900 p-5 text-white shadow-lg">
            <h3 className="flex items-center gap-2 text-base font-bold"><Icon name="spark" className="h-5 w-5 text-amber-300" />Así es tu camino</h3>
            <p className="mt-1 text-sm text-white/70">Sabrás en todo momento en qué paso vas.</p>
            <ol className="mt-4 grid gap-3">
              {v.process_steps.map((s: string, i: number) => (
                <li key={s} className="flex items-center gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${i === 0 ? 'bg-linear-to-br from-amber-300 to-orange-400 text-slate-900' : 'bg-white/10 text-white ring-1 ring-white/20'}`}>{i + 1}</span>
                  <span className={i === 0 ? 'font-semibold' : 'text-white/85'}>{s}</span>
                  {i === 0 && <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200">~5 min</span>}
                </li>
              ))}
            </ol>
          </section>
        )}

        <Section title="Qué harás" icon="laptop" items={v.activities} />
        <Section title="Prestaciones" icon="gift" items={v.benefits} />
        <Section title="Requisitos" icon="user" items={requirements} />
        {v.site_address && v.modality !== 'remoto' && (
          <section className="flex items-start gap-3 rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon name="pin" className="h-4 w-4" /></span>
            <div><h3 className="font-bold text-slate-900">Dónde</h3><p className="text-slate-700">{v.site_address}</p></div>
          </section>
        )}
        <p className="flex items-center justify-center gap-2 py-2 text-xs text-slate-500"><Icon name="lock" className="h-3.5 w-3.5" />Sin contraseñas · tus datos protegidos con aviso de privacidad</p>

        {v.accepting && !existing && (
          <div className="sticky bottom-0 z-20 -mx-4 bg-linear-to-t from-white via-white/95 to-white/0 px-4 pb-4 pt-6">
            <Button size="lg" onClick={() => setApplying(true)}>Postularme</Button>
            <p className="mt-2 text-center text-xs text-slate-500">Solo nombre y celular. Toma menos de 5 minutos.</p>
          </div>
        )}
      </article>
    </CandidateShell>
  );
}

export function OtpStep({ challenge, onVerified, onBack, onResent }: { challenge: any; onVerified: (r: any) => void; onBack: () => void; onResent: (c: any) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError('Escribe los 6 dígitos del código');
    setBusy(true); setError(null);
    try { onVerified(await api('/api/public/otp/verify', { body: { challengeId: challenge.challengeId, code } })); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  const resend = async () => {
    setError(null);
    try { onResent(await api('/api/public/otp/resend', { body: { challengeId: challenge.challengeId } })); setCode(''); }
    catch (err: any) { setError(err.message); }
  };
  const via = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'correo' }[challenge.channel as string];
  return (
    <form onSubmit={verify} className="space-y-4" noValidate>
      <div>
        <h2 className="text-xl font-bold">Verifica tu {challenge.channel === 'email' ? 'correo' : 'celular'}</h2>
        <p className="mt-1 text-slate-600">Enviamos un código de 6 dígitos por {via} a <strong>{challenge.sentTo}</strong>. Vence en {challenge.expiresInMinutes} minutos.</p>
      </div>
      {challenge.deliveryMode === 'sandbox' && (
        <Notice tone="amber">
          <strong>Modo de pruebas:</strong> no hay un proveedor de {via} conectado, así que el mensaje no se envió realmente.
          {challenge.devCode ? <> Código de prueba: <code data-testid="dev-otp" className="rounded bg-white px-1.5 py-0.5 font-mono text-base font-bold">{challenge.devCode}</code></> : ' Consulta la bandeja de mensajes simulados del panel.'}
        </Notice>
      )}
      <Field label="Código de verificación" error={error}>
        <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="text-center font-mono text-2xl tracking-[0.5em]" aria-label="Código de verificación" autoFocus />
      </Field>
      <Button size="lg" type="submit" loading={busy}>Verificar y continuar</Button>
      <div className="flex justify-between text-sm">
        <button type="button" className="text-slate-600 underline" onClick={onBack}>Cambiar mis datos</button>
        <button type="button" className="font-semibold text-brand-700 underline" onClick={resend}>Reenviar código</button>
      </div>
    </form>
  );
}

function ApplyForm({ vacancyTitle, linkCode, vacancySlug, onBack }: { vacancyTitle: string; linkCode?: string; vacancySlug?: string; onBack: () => void }) {
  const nav = useNavigate();
  const [f, setF] = useState({ firstName: '', lastName: '', phone: '', email: '', channel: 'whatsapp' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<any>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const validate = () => {
    const e: Record<string, string> = {};
    if (f.firstName.trim().length < 2) e.firstName = 'Escribe tu nombre';
    if (f.lastName.trim().length < 2) e.lastName = 'Escribe tus apellidos';
    const digits = f.phone.replace(/\D/g, '');
    if (f.channel !== 'email' && digits.length !== 10) e.phone = 'Tu celular debe tener 10 dígitos';
    if (f.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = 'Escribe un correo válido para recibir el código';
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = 'El correo no es válido';
    setErrors(e);
    return !Object.keys(e).length;
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true); setError(null);
    try {
      setChallenge(await api('/api/public/apply/start', { body: { linkCode, vacancySlug, firstName: f.firstName, lastName: f.lastName, phone: f.phone || null, email: f.email || null, channel: f.channel } }));
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  if (challenge) {
    return <div className="animate-rise space-y-4 rounded-3xl border border-slate-200/70 bg-white p-5 shadow-lg shadow-brand-900/5"><StepDots current={1} /><OtpStep challenge={challenge} onBack={() => setChallenge(null)} onResent={setChallenge} onVerified={(r) => nav(`/portal/postulacion/${r.applicationId}${r.resumed ? '?recuperado=1' : ''}`)} /></div>;
  }
  return (
    <form onSubmit={submit} className="animate-rise space-y-4 rounded-3xl border border-slate-200/70 bg-white p-5 shadow-lg shadow-brand-900/5" noValidate>
      <div>
        <StepDots current={0} />
        <p className="mt-4 text-sm text-slate-500">Postulación a</p>
        <h2 className="text-xl font-extrabold tracking-tight">{vacancyTitle}</h2>
        <p className="mt-1 text-sm text-slate-600">Paso 1 de 3 · Tus datos de contacto</p>
      </div>
      <Field label="Nombre(s)" error={errors.firstName} required><Input autoComplete="given-name" value={f.firstName} onChange={set('firstName')} /></Field>
      <Field label="Apellidos" error={errors.lastName} required><Input autoComplete="family-name" value={f.lastName} onChange={set('lastName')} /></Field>
      <Field label="Celular (10 dígitos)" error={errors.phone} required={f.channel !== 'email'}><Input type="tel" inputMode="tel" autoComplete="tel-national" value={f.phone} onChange={set('phone')} placeholder="55 1234 5678" /></Field>
      <Field label="Correo electrónico" hint="Opcional. Si no tienes correo, no pasa nada." error={errors.email}><Input type="email" autoComplete="email" value={f.email} onChange={set('email')} /></Field>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">¿Cómo quieres recibir tu código?</legend>
        <div className="grid grid-cols-3 gap-2">
          {[['whatsapp', 'WhatsApp'], ['sms', 'SMS'], ['email', 'Correo']].map(([v, l]) => (
            <label key={v} className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border p-2.5 text-center text-sm font-semibold transition ${f.channel === v ? 'border-brand-500 bg-brand-50 text-brand-700 ring-4 ring-brand-100' : 'border-slate-200 text-slate-600 hover:border-brand-200'}`}>
              <input type="radio" name="channel" value={v} checked={f.channel === v} onChange={set('channel')} className="sr-only" /><Icon name={v === 'email' ? 'mail' : v === 'sms' ? 'phone' : 'chat'} className="h-5 w-5" />{l}
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorBox error={error} />
      <Button size="lg" type="submit" loading={busy}>Enviar código</Button>
      <button type="button" className="w-full text-sm text-slate-600 underline" onClick={onBack}>Volver a la vacante</button>
      <p className="text-xs text-slate-500">Usaremos tus datos solo para tu proceso de selección. Leerás el aviso de privacidad completo en el siguiente paso.</p>
    </form>
  );
}

/** Indicador de los 3 pasos del registro (datos → código → perfil). */
function StepDots({ current }: { current: number }) {
  const labels = ['Tus datos', 'Código', 'Perfil'];
  return (
    <ol className="flex items-center gap-2" aria-label="Pasos del registro">
      {labels.map((l, i) => (
        <li key={l} className="flex flex-1 items-center gap-2" aria-current={i === current ? 'step' : undefined}>
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${i < current ? 'bg-brand-600 text-white' : i === current ? 'bg-brand-50 text-brand-700 ring-2 ring-brand-500' : 'bg-slate-100 text-slate-400'}`}>{i < current ? <Icon name="check" className="h-3.5 w-3.5" /> : i + 1}</span>
          <span className={`text-xs ${i === current ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{l}</span>
          {i < labels.length - 1 && <span className={`h-0.5 flex-1 rounded ${i < current ? 'bg-brand-500' : 'bg-slate-200'}`} />}
        </li>
      ))}
    </ol>
  );
}

export function VacancyList() {
  const { data, error, loading, reload } = useLoad(() => api('/api/public/vacancies'), []);
  return (
    <CandidateShell bleed={
      <div className="bg-hero px-4 pb-14 pt-8 text-white">
        <div className="mx-auto max-w-xl animate-rise">
          <p className="text-sm font-semibold text-white/75">Bolsa de trabajo</p>
          <h1 className="mt-1 text-3xl font-extrabold leading-tight tracking-tight">Encuentra tu próximo trabajo hoy</h1>
          <p className="mt-2 text-white/80">Postúlate desde tu celular en minutos, sin contraseñas, y sigue tu proceso en tiempo real.</p>
        </div>
      </div>
    }>
      <div className="-mt-10">
      {loading ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.vacancies.length ? <p className="rounded-3xl bg-white p-6 text-slate-600 shadow-sm">Por ahora no hay vacantes abiertas.</p> : (
        <ul className="space-y-3">
          {data.vacancies.map((v: any, i: number) => (
            <li key={v.id} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}><Link to={`/empleo/v/${v.slug}`} className="group flex items-center gap-4 rounded-3xl border border-slate-200/70 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-brand-500 to-violet-600 text-white shadow-md shadow-brand-600/25"><Icon name="briefcase" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-900">{v.title}</p>
                <p className="text-sm text-slate-600">{MODALITY[v.modality]}{v.site_city ? ` · ${v.site_city}` : ''}</p>
                {v.salary_text && <p className="mt-1 text-sm font-semibold text-emerald-700">{v.salary_text}</p>}
              </div>
              <Icon name="arrow" className="h-5 w-5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
            </Link></li>
          ))}
        </ul>
      )}
      </div>
    </CandidateShell>
  );
}

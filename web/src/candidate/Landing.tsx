import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../shared/api';
import { Button, ErrorBox, Field, Input, Loading, Notice, useLoad } from '../shared/ui';
import { CandidateShell } from './Shell';

const MODALITY: Record<string, string> = { presencial: 'Presencial', remoto: 'Desde casa', hibrido: 'Híbrido' };

function Section({ title, items }: { title: string; items?: string[] | null }) {
  if (!items?.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <ul className="space-y-1.5">{items.map((i) => <li key={i} className="flex gap-2 text-slate-700"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />{i}</li>)}</ul>
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
  return (
    <CandidateShell>
      {!applying ? (
        <article className="space-y-5">
          <header className="rounded-2xl bg-brand-700 p-5 text-white shadow">
            {v.client_name && <p className="text-sm text-brand-100">{v.client_name}</p>}
            <h1 className="mt-1 text-2xl font-bold leading-tight">{v.title}</h1>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-white/15 px-3 py-1">{MODALITY[v.modality]}</span>
              {v.site_city && <span className="rounded-full bg-white/15 px-3 py-1">{v.site_city}</span>}
            </div>
            {v.salary_text && <p className="mt-4 text-lg font-semibold">{v.salary_text}</p>}
          </header>
          {existing && (
            <div className="rounded-2xl border border-brand-100 bg-white p-4 shadow-sm" data-testid="existing-status">
              <p className="text-sm text-slate-500">Hola {me.data.candidate.first_name}, ya te postulaste a esta vacante</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">Estatus: {existing.status}</p>
              <Link to={`/portal/postulacion/${existing.id}`} className="mt-3 inline-flex w-full justify-center rounded-lg bg-brand-700 px-5 py-3 font-semibold text-white">Ver mi proceso</Link>
            </div>
          )}
          {!existing && (
            <Link to="/portal/ingresar" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
              <span>¿Ya te postulaste? <strong>Consulta tu estatus</strong></span><span aria-hidden className="text-brand-700">→</span>
            </Link>
          )}
          {!v.accepting && <Notice tone="amber">Esta vacante ya no está recibiendo postulaciones. <Link to="/empleo" className="font-semibold underline">Ver vacantes abiertas</Link></Notice>}
          <div className="space-y-5 rounded-2xl bg-white p-5 shadow-sm">
            {v.summary && <p className="text-slate-700">{v.summary}</p>}
            {v.schedule_text && <div><h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Horario</h3><p className="text-slate-700">{v.schedule_text}</p></div>}
            {v.site_address && v.modality !== 'remoto' && <div><h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Ubicación</h3><p className="text-slate-700">{v.site_address}</p></div>}
            <Section title="Qué harás" items={v.activities} />
            <Section title="Requisitos" items={[...(v.requirements ?? []), ...(v.education ? [`Escolaridad: ${v.education}`] : []), ...(v.experience ? [`Experiencia: ${v.experience}`] : [])]} />
            <Section title="Prestaciones" items={v.benefits} />
            {v.process_steps?.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Cómo es el proceso</h3>
                <ol className="space-y-2">{v.process_steps.map((s: string, i: number) => <li key={s} className="flex items-center gap-3 text-slate-700"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>{s}</li>)}</ol>
              </div>
            )}
            {v.response_time_text && <p className="text-sm text-slate-500">⏱ {v.response_time_text}</p>}
          </div>
          {v.accepting && !existing && (
            <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
              <Button size="lg" onClick={() => setApplying(true)}>Postularme</Button>
              <p className="mt-2 text-center text-xs text-slate-500">Solo nombre y celular. Toma menos de 5 minutos.</p>
            </div>
          )}
        </article>
      ) : (
        <ApplyForm vacancyTitle={v.title} linkCode={code} vacancySlug={code ? undefined : slug} onBack={() => setApplying(false)} />
      )}
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
    return <div className="rounded-2xl bg-white p-5 shadow-sm"><OtpStep challenge={challenge} onBack={() => setChallenge(null)} onResent={setChallenge} onVerified={(r) => nav(`/portal/postulacion/${r.applicationId}${r.resumed ? '?recuperado=1' : ''}`)} /></div>;
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm" noValidate>
      <div>
        <p className="text-sm text-slate-500">Postulación a</p>
        <h2 className="text-xl font-bold">{vacancyTitle}</h2>
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
            <label key={v} className={`cursor-pointer rounded-lg border p-2.5 text-center text-sm font-medium ${f.channel === v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300'}`}>
              <input type="radio" name="channel" value={v} checked={f.channel === v} onChange={set('channel')} className="sr-only" />{l}
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

export function VacancyList() {
  const { data, error, loading, reload } = useLoad(() => api('/api/public/vacancies'), []);
  return (
    <CandidateShell>
      <h1 className="mb-4 text-2xl font-bold">Vacantes disponibles</h1>
      {loading ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.vacancies.length ? <p className="text-slate-600">Por ahora no hay vacantes abiertas.</p> : (
        <ul className="space-y-3">
          {data.vacancies.map((v: any) => (
            <li key={v.id}><Link to={`/empleo/v/${v.slug}`} className="block rounded-xl bg-white p-4 shadow-sm hover:ring-2 hover:ring-brand-100">
              <p className="font-semibold text-slate-900">{v.title}</p>
              <p className="text-sm text-slate-600">{MODALITY[v.modality]} · {v.site_city ?? ''} {v.salary_text ? `· ${v.salary_text}` : ''}</p>
            </Link></li>
          ))}
        </ul>
      )}
    </CandidateShell>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setCsrf } from '../shared/api';
import { Button, ErrorBox, Field, Input } from '../shared/ui';
import { Icon } from '../shared/icons';

export function AdminLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="bg-hero relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5 text-xl font-extrabold"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-brand-700"><Icon name="bolt" /></span>Recluta CRM</div>
        <div className="max-w-md">
          <h2 className="text-4xl font-extrabold leading-tight tracking-tight">Del clic a la contratación, sin perder a nadie en el camino.</h2>
          <p className="mt-4 text-white/80">Ligas con atribución, precalificación explicable, agenda sin choques y KPIs con su fórmula a la vista.</p>
          <ul className="mt-8 space-y-3 text-sm">
            {[['chart', 'Embudo y fuentes en tiempo real'], ['shield', 'Roles, alcance por equipo y auditoría'], ['phone', 'Portal móvil para el candidato, sin contraseñas']].map(([i, t]) => (
              <li key={t} className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15"><Icon name={i} className="h-4 w-4" /></span>{t}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/60">Ambiente de demostración · datos ficticios</p>
      </div>
      <div className="bg-mesh flex items-center justify-center p-4">
      <form className="w-full max-w-sm animate-rise space-y-4 rounded-3xl border border-slate-200/70 bg-white p-7 shadow-xl shadow-brand-900/5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try { const r = await api('/api/admin/auth/login', { body: { email, password } }); setCsrf(r.csrfToken); nav('/admin'); }
        catch (e: any) { setErr(e.message); } finally { setBusy(false); }
      }}>
        <div><span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-linear-to-br from-brand-600 to-violet-600 text-white shadow-lg shadow-brand-600/30 lg:hidden"><Icon name="bolt" /></span><h1 className="text-2xl font-extrabold tracking-tight">Bienvenido de vuelta</h1><p className="text-sm text-slate-500">Acceso para el equipo de reclutamiento</p></div>
        <Field label="Correo"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Contraseña"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorBox error={err} />
        <Button type="submit" className="w-full" loading={busy}>Entrar</Button>
      </form>
      </div>
    </div>
  );
}

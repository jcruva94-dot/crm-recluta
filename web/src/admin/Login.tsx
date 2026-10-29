import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setCsrf } from '../shared/api';
import { Button, ErrorBox, Field, Input } from '../shared/ui';

export function AdminLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-900 p-4">
      <form className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try { const r = await api('/api/admin/auth/login', { body: { email, password } }); setCsrf(r.csrfToken); nav('/admin'); }
        catch (e: any) { setErr(e.message); } finally { setBusy(false); }
      }}>
        <div><h1 className="text-xl font-bold">Recluta CRM</h1><p className="text-sm text-slate-500">Acceso para el equipo de reclutamiento</p></div>
        <Field label="Correo"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Contraseña"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorBox error={err} />
        <Button type="submit" className="w-full" loading={busy}>Entrar</Button>
      </form>
    </div>
  );
}

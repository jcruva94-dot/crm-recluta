import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, ApiError, setCsrf } from '../shared/api';
import { fmtDateTime } from '../shared/format';
import { Loading, ErrorBox } from '../shared/ui';
import { AdminCtx, type Catalogs, type Me } from './context';

const NAV: [string, string, string?][] = [
  ['/admin', 'Dashboard', 'dashboard.read'],
  ['/admin/tareas', 'Bandeja de trabajo', 'task.manage'],
  ['/admin/pipeline', 'Pipeline', 'application.read'],
  ['/admin/agenda', 'Agenda'],
  ['/admin/vacantes', 'Vacantes', 'vacancy.read'],
  ['/admin/mensajes', 'Mensajes', 'messages.read'],
  ['/admin/duplicados', 'Duplicados', 'duplicates.resolve'],
  ['/admin/auditoria', 'Auditoría', 'audit.read'],
];

export function AdminLayout() {
  const nav = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

  const loadCatalogs = useCallback(() => api('/api/admin/catalogs').then(setCatalogs).catch((e) => setError(e.message)), []);
  useEffect(() => {
    api('/api/admin/auth/me').then((m) => { setCsrf(m.csrfToken); setMe(m); return loadCatalogs(); })
      .catch((e) => { if (e instanceof ApiError && e.status === 401) nav('/admin/login', { replace: true }); else setError(e.message); });
  }, [nav, loadCatalogs]);

  if (error) return <div className="p-6"><ErrorBox error={error} /></div>;
  if (!me || !catalogs) return <Loading />;
  const can = (p: string) => me.permissions.includes(p);
  const logout = async () => { await api('/api/admin/auth/logout', { body: {} }).catch(() => {}); nav('/admin/login'); };

  return (
    <AdminCtx.Provider value={{ me, catalogs, can, reloadCatalogs: loadCatalogs }}>
      <div className="min-h-screen lg:flex">
        <aside className={`${menu ? 'block' : 'hidden'} fixed inset-y-0 left-0 z-40 w-60 bg-brand-900 text-white lg:static lg:block`}>
          <div className="flex items-center gap-2 px-5 py-4 text-lg font-bold"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm text-brand-900">R</span> Recluta CRM</div>
          <nav className="space-y-0.5 px-3" aria-label="Principal">
            {NAV.filter(([, , p]) => !p || can(p)).map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/admin'} onClick={() => setMenu(false)} className={({ isActive }) => `block rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-white/15 font-semibold' : 'text-brand-100 hover:bg-white/10'}`}>{label}</NavLink>
            ))}
          </nav>
          <div className="absolute bottom-0 w-60 border-t border-white/10 p-4 text-xs text-brand-100">
            <p className="font-semibold text-white">{me.user.fullName}</p><p>{me.user.roleLabel}</p>
            <button onClick={logout} className="mt-2 underline">Cerrar sesión</button>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
            <button className="rounded p-1.5 lg:hidden" aria-label="Menú" onClick={() => setMenu(!menu)}>☰</button>
            <GlobalSearch />
            {me.deliveryMode === 'sandbox' && <Link to="/admin/mensajes" className="hidden rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 sm:block" title="Sin proveedor de mensajería configurado">Mensajería en modo de pruebas</Link>}
            <Notifications />
          </header>
          <main className="p-4 lg:p-6"><Outlet /></main>
        </div>
      </div>
    </AdminCtx.Provider>
  );
}

function GlobalSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(() => api(`/api/admin/search?q=${encodeURIComponent(q)}`).then((r) => setRes(r.results)).catch(() => setRes([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative flex-1 max-w-md">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar candidato por nombre, teléfono o correo…" aria-label="Búsqueda global"
        className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100" />
      {res.length > 0 && (
        <ul className="absolute mt-1 w-full rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {res.map((r) => <li key={r.id}><button className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setQ(''); nav(`/admin/postulaciones/${r.id}`); }}>
            <span className="font-medium">{r.first_name} {r.last_name}</span> <span className="text-slate-500">· {r.vacancy_title} · {r.stage_name}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

function Notifications() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any>({ notifications: [], unread: 0 });
  const load = () => api('/api/admin/notifications').then(setData).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  return (
    <div className="relative">
      <button aria-label={`Notificaciones (${data.unread} sin leer)`} className="relative rounded-lg p-2 hover:bg-slate-100" onClick={async () => { setOpen(!open); if (!open && data.unread) { await api('/api/admin/notifications/read', { body: {} }); } }}>
        🔔{data.unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-80 rounded-lg border border-slate-200 bg-white shadow-lg">
          {!data.notifications.length ? <p className="p-4 text-sm text-slate-500">Sin notificaciones.</p> : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">{data.notifications.map((n: any) => (
              <li key={n.id}><button className="block w-full p-3 text-left hover:bg-slate-50" onClick={() => { setOpen(false); load(); if (n.link) nav(n.link); }}>
                <p className={`text-sm ${n.read_at ? '' : 'font-semibold'}`}>{n.title}</p><p className="text-xs text-slate-500">{n.body} · {fmtDateTime(n.created_at)}</p></button></li>
            ))}</ul>
          )}
        </div>
      )}
    </div>
  );
}

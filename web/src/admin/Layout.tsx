import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, ApiError, setCsrf } from '../shared/api';
import { fmtDateTime } from '../shared/format';
import { Loading, ErrorBox } from '../shared/ui';
import { Icon } from '../shared/icons';
import { AdminCtx, type Catalogs, type Me } from './context';

const NAV: [string, string, string, string?][] = [
  ['/admin', 'Dashboard', 'chart', 'dashboard.read'],
  ['/admin/tareas', 'Bandeja de trabajo', 'inbox', 'task.manage'],
  ['/admin/pipeline', 'Pipeline', 'columns', 'application.read'],
  ['/admin/agenda', 'Agenda', 'calendar'],
  ['/admin/vacantes', 'Vacantes', 'briefcase', 'vacancy.read'],
  ['/admin/mensajes', 'Mensajes', 'chat', 'messages.read'],
  ['/admin/duplicados', 'Duplicados', 'copy', 'duplicates.resolve'],
  ['/admin/auditoria', 'Auditoría', 'shield', 'audit.read'],
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
      <div className="min-h-screen bg-mesh lg:flex">
        {menu && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMenu(false)} />}
        <aside className={`${menu ? 'flex' : 'hidden'} bg-hero fixed inset-y-0 left-0 z-40 w-64 flex-col text-white lg:sticky lg:top-0 lg:flex lg:h-screen`}>
          <div className="flex items-center gap-2.5 px-5 py-5 text-lg font-extrabold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand-700 shadow-lg"><Icon name="bolt" className="h-5 w-5" /></span> Recluta<span className="font-medium text-white/60">CRM</span>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="Principal">
            {NAV.filter(([, , , p]) => !p || can(p)).map(([to, label, icon]) => (
              <NavLink key={to} to={to} end={to === '/admin'} onClick={() => setMenu(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${isActive ? 'bg-white font-semibold text-brand-800 shadow-lg shadow-brand-900/20' : 'text-white/80 hover:bg-white/10 hover:text-white'}`}>
                <Icon name={icon} className="h-[18px] w-[18px]" />{label}
              </NavLink>
            ))}
          </nav>
          <div className="m-3 rounded-2xl bg-white/10 p-3 text-xs backdrop-blur">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold">{me.user.fullName.slice(0, 1)}</span>
              <div className="min-w-0"><p className="truncate font-semibold text-white">{me.user.fullName}</p><p className="text-white/70">{me.user.roleLabel}</p></div>
            </div>
            <button onClick={logout} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 py-1.5 font-semibold hover:bg-white/20"><Icon name="logout" className="h-4 w-4" />Cerrar sesión</button>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200/70 bg-white/80 px-4 py-3 backdrop-blur-md lg:px-6">
            <button className="rounded-lg p-1.5 hover:bg-slate-100 lg:hidden" aria-label="Menú" onClick={() => setMenu(!menu)}><Icon name="menu" /></button>
            <GlobalSearch />
            {me.deliveryMode === 'sandbox' && <Link to="/admin/mensajes" className="hidden items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 sm:flex" title="Sin proveedor de mensajería configurado"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Mensajería en modo de pruebas</Link>}
            <Notifications />
          </header>
          <main className="mx-auto max-w-[1400px] p-4 lg:p-6"><Outlet /></main>
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
    <div className="relative max-w-md flex-1">
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar candidato por nombre, teléfono o correo…" aria-label="Búsqueda global"
        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm transition focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100" />
      {res.length > 0 && (
        <ul className="absolute mt-1 w-full rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
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
    <div className="relative ml-auto">
      <button aria-label={`Notificaciones (${data.unread} sin leer)`} className="relative rounded-xl p-2 text-slate-600 hover:bg-slate-100" onClick={async () => { setOpen(!open); if (!open && data.unread) { await api('/api/admin/notifications/read', { body: {} }); } }}>
        <Icon name="bell" />{data.unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-slate-200 bg-white shadow-xl">
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

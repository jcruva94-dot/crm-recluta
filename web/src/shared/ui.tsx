import { useEffect, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', size = 'md', loading, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const v = {
    primary: 'bg-linear-to-r from-brand-600 to-violet-600 text-white shadow-md shadow-brand-600/25 hover:shadow-lg hover:shadow-brand-600/30 hover:brightness-110 active:scale-[0.99] disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none',
    secondary: 'bg-white text-slate-800 border border-slate-200 shadow-sm hover:border-brand-200 hover:bg-brand-50/40 disabled:text-slate-400',
    ghost: 'text-brand-700 hover:bg-brand-50 disabled:text-slate-400',
    danger: 'bg-white text-red-700 border border-red-300 hover:bg-red-50',
  }[variant];
  const s = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5 text-sm', lg: 'px-5 py-4 text-base w-full rounded-2xl' }[size];
  return (
    <button {...p} disabled={p.disabled || loading} className={cx('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition duration-150 disabled:cursor-not-allowed', v, s, className)}>
      {loading && <Spinner small />}{children}
    </button>
  );
}

export function Field({ label, hint, error, children, required }: { label: string; hint?: string; error?: string | null; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}{required && <span className="text-red-600"> *</span>}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-700" role="alert">{error}</span>}
    </label>
  );
}

const withWidth = (c?: string) => (c && /(^|\s)w-/.test(c) ? '' : 'w-full ');
const inputCls = 'rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-base sm:text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 transition';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(withWidth(p.className) + inputCls, p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(withWidth(p.className) + inputCls, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(withWidth(p.className) + inputCls, p.className)} />;

export const Card = ({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) => (
  <section className={cx('rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_8px_24px_-12px_rgb(15_23_42/0.10)]', className)}>
    {(title || actions) && <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-base font-bold text-slate-900">{title}</h2>{actions}</div>}
    {children}
  </section>
);

const tones: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-700', blue: 'bg-brand-50 text-brand-700', green: 'bg-emerald-50 text-emerald-700', teal: 'bg-teal-50 text-teal-700',
  amber: 'bg-amber-50 text-amber-800', red: 'bg-red-50 text-red-700', purple: 'bg-violet-50 text-violet-700',
};
export const Badge = ({ children, tone = 'gray' }: { children: ReactNode; tone?: string }) => (
  <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone] ?? tones.gray)}>{children}</span>
);

export const Spinner = ({ small }: { small?: boolean }) => (
  <span role="status" aria-label="Cargando" className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'h-4 w-4' : 'h-6 w-6 text-brand-600')} />
);

export const Loading = ({ label = 'Cargando…' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-3 py-12 text-slate-500"><Spinner /> {label}</div>
);

export const ErrorBox = ({ error, onRetry }: { error: string | null | undefined; onRetry?: () => void }) =>
  error ? (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {error} {onRetry && <button className="ml-2 font-semibold underline" onClick={onRetry}>Reintentar</button>}
    </div>
  ) : null;

export const Notice = ({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'amber' | 'green' }) => (
  <div className={cx('rounded-lg border p-3 text-sm', tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : tone === 'green' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-brand-100 bg-brand-50 text-brand-900')}>{children}</div>
);

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center">
    <p className="font-medium text-slate-700">{title}</p>
    {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
  </div>
);

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button aria-label="Cerrar" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

/** Hook de carga con estados de carga/error/reintento. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn().then((d) => { if (alive) { setData(d); setError(null); } }).catch((e) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1), setData };
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" title={hint}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-bold tabular-nums', tone === 'red' ? 'text-red-700' : 'text-slate-900')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500 line-clamp-2">{hint}</div>}
    </div>
  );
}

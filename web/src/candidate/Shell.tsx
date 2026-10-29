import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function CandidateShell({ children, nav }: { children: ReactNode; nav?: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <Link to="/empleo" className="flex items-center gap-2 font-bold text-brand-700">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-sm text-white">R</span> Recluta
          </Link>
          {nav}
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-5">{children}</main>
    </div>
  );
}

export function Progress({ steps, current }: { steps: string[]; current: number | null }) {
  if (current === null) return null;
  return (
    <ol className="flex gap-1" aria-label="Avance de tu proceso">
      {steps.map((s, i) => (
        <li key={s} className="flex-1" aria-current={i === current ? 'step' : undefined}>
          <div className={`h-1.5 rounded-full ${i < current ? 'bg-brand-600' : i === current ? 'bg-brand-400' : 'bg-slate-200'}`} />
          <span className={`mt-1 hidden text-[11px] sm:block ${i === current ? 'font-semibold text-brand-700' : 'text-slate-500'}`}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

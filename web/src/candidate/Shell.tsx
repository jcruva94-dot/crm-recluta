import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../shared/icons';

export function CandidateShell({ children, nav, bleed }: { children: ReactNode; nav?: ReactNode; bleed?: ReactNode }) {
  return (
    <div className="bg-mesh min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/60 bg-white/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <Link to="/empleo" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-linear-to-br from-brand-600 to-violet-600 text-white shadow-md shadow-brand-600/30"><Icon name="bolt" className="h-4 w-4" /></span> Recluta
          </Link>
          {nav}
        </div>
      </header>
      {bleed}
      <main className="mx-auto max-w-xl px-4 py-5">{children}</main>
    </div>
  );
}

/** Pasos del proceso en horizontal (se usa en formularios cortos). */
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

/**
 * Línea de tiempo vertical del proceso del candidato: pasos completados, el actual (con pulso) y los que siguen.
 * `current` null = proceso cerrado.
 */
export function Journey({ steps, current, currentDetail, closed }: { steps: string[]; current: number | null; currentDetail?: ReactNode; closed?: boolean }) {
  return (
    <ol className="relative" aria-label="Tu camino en el proceso">
      {steps.map((s, i) => {
        const state = closed ? 'closed' : current == null ? 'todo' : i < current ? 'done' : i === current ? 'now' : 'todo';
        const last = i === steps.length - 1;
        return (
          <li key={s} className="relative flex gap-3 pb-5 last:pb-0" aria-current={state === 'now' ? 'step' : undefined}>
            {!last && <span className={`absolute left-[15px] top-8 h-[calc(100%-2rem)] w-0.5 rounded ${state === 'done' ? 'bg-brand-500' : 'bg-slate-200'}`} aria-hidden />}
            <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              state === 'done' ? 'bg-brand-600 text-white' : state === 'now' ? 'animate-pulse-ring bg-white text-brand-700 ring-2 ring-brand-500' : 'bg-white text-slate-400 ring-1 ring-slate-200'}`}>
              {state === 'done' ? <Icon name="check" className="h-4 w-4" /> : i + 1}
            </span>
            <div className="min-w-0 pt-1">
              <p className={`text-sm ${state === 'now' ? 'font-bold text-slate-900' : state === 'done' ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>
                {s}{state === 'done' && <span className="sr-only"> (completado)</span>}
                {state === 'now' && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">Estás aquí</span>}
              </p>
              {state === 'now' && currentDetail && <div className="mt-1 text-sm text-slate-600">{currentDetail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

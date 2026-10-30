/**
 * Gráficas ligeras en SVG/HTML, sin dependencias. Reglas:
 * - Una sola escala por gráfica, marcas delgadas con extremos redondeados y 2 px de separación.
 * - Leyenda siempre visible con ≥ 2 series; el texto usa tinta neutra, nunca el color de la serie.
 * - Tooltip al pasar el cursor (o tocar) en cada marca; los valores también están en texto.
 * Paleta validada (CVD y contraste) con el validador del skill de visualización.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export const SERIES = { primary: '#4f46e5', secondary: '#eb6834' };
/** Resultado de precalificación: escala de "mejor" a "peor"; siempre acompañada de etiqueta y valor. */
export const PREQUAL_COLORS = { compatible: '#047857', compatible_con_observaciones: '#1baf7a', requiere_revision: '#eda100', no_cumple: '#e34948' };
/** Escala ordinal de un solo tono para embudos (de oscuro a claro, el más claro conserva contraste ≥ 2:1). */
const FUNNEL_RAMP = ['#312e81', '#3730a3', '#4338ca', '#4f46e5', '#6366f1', '#818cf8', '#93a0f5'];

const fmt = (n: number) => n.toLocaleString('es-MX');

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function Legend({ items }: { items: { label: string; color: string; value?: ReactNode }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />{i.label}{i.value !== undefined && <strong className="tabular-nums text-slate-900">{i.value}</strong>}
        </li>
      ))}
    </ul>
  );
}

// ---------- Embudo de conversión ----------
export function Funnel({ steps }: { steps: { label: string; value: number; hint?: string }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="space-y-1" aria-label="Embudo de conversión">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const step = prev ? Math.round((s.value / prev) * 100) : null;
        const w = Math.max(2, (s.value / top) * 100);
        return (
          <li key={s.label}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-0.5 pl-3 text-[11px] text-slate-500">
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M5 1v8M2 6l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.4" /></svg>
                {step == null ? 'sin base' : <span><strong className="text-slate-700">{step}%</strong> pasa a la siguiente etapa</span>}
              </div>
            )}
            <div className="group grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-3" title={s.hint}>
              <span className="truncate text-sm font-medium text-slate-700">{s.label}</span>
              <div className="relative h-7 rounded-md bg-slate-100">
                <div className="h-7 origin-left animate-grow rounded-md transition-[filter] group-hover:brightness-110" style={{ width: `${w}%`, background: FUNNEL_RAMP[Math.min(i, FUNNEL_RAMP.length - 1)], animationDelay: `${i * 70}ms` }} />
              </div>
              <span className="w-20 text-right text-sm tabular-nums"><strong className="text-slate-900">{fmt(s.value)}</strong> <span className="text-xs text-slate-500">{Math.round((s.value / top) * 100)}%</span></span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Tendencia diaria (área + línea, con cruz y tooltip) ----------
export function TrendChart({ data, series, height = 220 }: { data: { label: string; values: Record<string, number> }[]; series: { key: string; label: string; color: string }[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const iw = width - pad.l - pad.r; const ih = height - pad.t - pad.b;
  const max = Math.max(4, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0)));
  const niceMax = Math.ceil(max / 4) * 4;
  const x = (i: number) => pad.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / niceMax) * ih;
  const path = (k: string) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.values[k] ?? 0).toFixed(1)}`).join('');
  const area = (k: string) => `${path(k)}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const ticks = [0, 1, 2, 3, 4].map((t) => (niceMax / 4) * t);
  const every = Math.max(1, Math.ceil(data.length / Math.floor(iw / 56)));
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - pad.l;
    setHover(Math.max(0, Math.min(data.length - 1, Math.round((px / iw) * (data.length - 1)))));
  };
  const h = hover != null ? data[hover] : null;
  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} className="block touch-none select-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Tendencia diaria: ${series.map((s) => s.label).join(' y ')}`}>
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={series[0].color} stopOpacity="0.22" /><stop offset="100%" stopColor={series[0].color} stopOpacity="0" /></linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray={t ? '3 4' : undefined} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{Math.round(t)}</text>
          </g>
        ))}
        {data.map((d, i) => i % every === 0 && <text key={d.label} x={x(i)} y={height - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">{d.label}</text>)}
        <path d={area(series[0].key)} fill="url(#trend-fill)" />
        {series.map((s, si) => <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={si ? '5 4' : undefined} />)}
        {h && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="#94a3b8" />
            {series.map((s) => <circle key={s.key} cx={x(hover)} cy={y(h.values[s.key] ?? 0)} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {h && hover != null && (
        <div className="pointer-events-none absolute top-1 z-10 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur" style={{ left: Math.min(width - 150, Math.max(0, x(hover) + 10)) }}>
          <p className="mb-1 font-semibold text-slate-900">{h.label}</p>
          {series.map((s) => <p key={s.key} className="flex items-center gap-1.5 text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}: <strong className="tabular-nums text-slate-900">{h.values[s.key] ?? 0}</strong></p>)}
        </div>
      )}
    </div>
  );
}

// ---------- Barra segmentada (composición de un total) ----------
export function SegmentedBar({ items }: { items: { label: string; value: number; color: string }[] }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  const [hover, setHover] = useState<string | null>(null);
  if (!total) return <p className="text-sm text-slate-500">Sin evaluaciones en el periodo.</p>;
  return (
    <div className="space-y-3">
      <div className="flex h-4 gap-[2px] overflow-hidden rounded-full bg-slate-100" role="img" aria-label={items.map((i) => `${i.label}: ${i.value}`).join(', ')}>
        {items.filter((i) => i.value > 0).map((i) => (
          <div key={i.label} className="h-full origin-left animate-grow transition-opacity first:rounded-l-full last:rounded-r-full" onPointerEnter={() => setHover(i.label)} onPointerLeave={() => setHover(null)}
            style={{ width: `${(i.value / total) * 100}%`, background: i.color, opacity: hover && hover !== i.label ? 0.45 : 1 }} title={`${i.label}: ${i.value} (${Math.round((i.value / total) * 100)}%)`} />
        ))}
      </div>
      <ul className="space-y-1 text-sm">
        {items.map((i) => (
          <li key={i.label} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${hover === i.label ? 'bg-slate-50' : ''}`} onPointerEnter={() => setHover(i.label)} onPointerLeave={() => setHover(null)}>
            <span className="flex items-center gap-2 text-slate-600"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i.color }} />{i.label}</span>
            <span className="tabular-nums"><strong className="text-slate-900">{i.value}</strong> <span className="text-xs text-slate-500">{Math.round((i.value / total) * 100)}%</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Barras horizontales con valor y contexto ----------
export function BarList({ rows, color = SERIES.primary, empty = 'Sin datos en el periodo.' }: { rows: { label: ReactNode; key: string; value: number; sub?: ReactNode }[]; color?: string; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.key} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-medium text-slate-700">{r.label}</span><strong className="tabular-nums text-slate-900">{fmt(r.value)}</strong></div>
          <div className="h-2 rounded-full bg-slate-100"><div className="h-2 origin-left animate-grow rounded-full group-hover:brightness-110" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color, animationDelay: `${i * 60}ms` }} /></div>
          {r.sub && <div className="mt-1 text-xs text-slate-500">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

// ---------- Anillo de avance ----------
export function Ring({ value, size = 96, stroke = 9, children, track = 'rgb(255 255 255 / 0.2)', color = '#fff' }: { value: number; size?: number; stroke?: number; children?: ReactNode; track?: string; color?: string }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.2,.7,.2,1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

/** Mini serie para tarjetas KPI (sin ejes; el número grande es el dato principal). */
export function Sparkline({ values, color = SERIES.primary, width = 96, height = 28 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`);
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <polyline points={`2,${height - 2} ${pts.join(' ')} ${width - 2},${height - 2}`} fill={color} opacity={0.12} stroke="none" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

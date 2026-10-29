const TZ = 'America/Mexico_City';
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('es-MX', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '—';
export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('es-MX', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d)) : '—';
export const fmtLongSlot = (d: string | Date) =>
  new Intl.DateTimeFormat('es-MX', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(d));
export const fmtTime = (d: string | Date) => new Intl.DateTimeFormat('es-MX', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(d));
export const dayKey = (d: string | Date) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
export const fmtDayHeader = (d: string | Date) => new Intl.DateTimeFormat('es-MX', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d));
export const todayYmd = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function ago(d: string | null | undefined) {
  if (!d) return '—';
  const h = (Date.now() - new Date(d).getTime()) / 3600_000;
  if (h < 1) return `hace ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `hace ${Math.round(h)} h`;
  return `hace ${Math.round(h / 24)} días`;
}
/** Convierte fecha y hora local de CDMX (YYYY-MM-DD, HH:MM) a ISO UTC. CDMX no usa horario de verano desde 2022 (UTC−6). */
export function cdmxToIso(ymd: string, hm: string) {
  return new Date(`${ymd}T${hm}:00-06:00`).toISOString();
}
export const RESULT_LABEL: Record<string, string> = {
  compatible: 'Compatible', compatible_con_observaciones: 'Compatible con observaciones', requiere_revision: 'Requiere revisión', no_cumple: 'No cumple indispensable',
};
export const RESULT_TONE: Record<string, string> = {
  compatible: 'green', compatible_con_observaciones: 'teal', requiere_revision: 'amber', no_cumple: 'red',
};

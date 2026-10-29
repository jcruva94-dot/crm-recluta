import { badRequest } from './errors.js';

/** Normaliza teléfonos mexicanos a E.164 (+52XXXXXXXXXX). Acepta otros países si vienen con +. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[^\d]/g, '');
  if (trimmed.startsWith('+')) {
    if (digits.startsWith('521') && digits.length === 13) digits = '52' + digits.slice(3); // formato antiguo móvil
    if (digits.length < 10 || digits.length > 15) throw badRequest('El teléfono no es válido');
    return '+' + digits;
  }
  if (digits.length === 12 && digits.startsWith('52')) return '+' + digits;
  if (digits.length === 13 && digits.startsWith('521')) return '+52' + digits.slice(3);
  if (digits.length === 10) return '+52' + digits;
  throw badRequest('El teléfono debe tener 10 dígitos');
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (!e) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 254) throw badRequest('El correo electrónico no es válido');
  return e;
}

export function maskPhone(p: string | null) {
  if (!p) return null;
  return p.slice(0, 3) + ' ••• ••' + p.slice(-4);
}
export function maskEmail(e: string | null) {
  if (!e) return null;
  const [u, d] = e.split('@');
  return (u.length <= 2 ? u[0] + '•' : u.slice(0, 2) + '•••') + '@' + d;
}

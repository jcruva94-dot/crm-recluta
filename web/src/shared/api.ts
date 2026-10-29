export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) { super(message); }
}

let csrfToken = '';
export const setCsrf = (t: string) => { csrfToken = t; };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { 'x-requested-with': 'crm' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (csrfToken && path.startsWith('/api/admin')) headers['x-csrf-token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Sin conexión. Revisa tu internet e intenta de nuevo.', null);
  }
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    let msg = (body && body.message) || 'Ocurrió un error';
    if (body?.fields?.length) msg += ': ' + body.fields.map((f: any) => f.message).join('; ');
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { DEMO_PASSWORD } from '../src/seed.js';

let appP: Promise<FastifyInstance> | null = null;
export function getApp() {
  appP ??= buildApp();
  return appP;
}

export class Agent {
  cookies = new Map<string, string>();
  csrf = '';
  constructor(public app: FastifyInstance, public ip = '10.0.0.' + Math.floor(Math.random() * 250 + 1)) {}
  async req(method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { 'x-requested-with': 'crm', ...extraHeaders };
    if (this.csrf) headers['x-csrf-token'] = this.csrf;
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    Object.assign(headers, extraHeaders);
    const res = await this.app.inject({ method: method as any, url, payload: body as any, headers, remoteAddress: this.ip });
    for (const c of res.cookies as any[]) {
      if (c.value === '' || c.maxAge === 0) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    let json: any = null;
    try { json = res.json(); } catch { /* no json */ }
    return { status: res.statusCode, body: json, raw: res };
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body: unknown = {}) => this.req('POST', url, body);
  put = (url: string, body: unknown = {}) => this.req('PUT', url, body);
  patch = (url: string, body: unknown = {}) => this.req('PATCH', url, body);
  del = (url: string) => this.req('DELETE', url);
}

export async function staff(email: string) {
  const a = new Agent(await getApp());
  const r = await a.post('/api/admin/auth/login', { email, password: DEMO_PASSWORD });
  if (r.status !== 200) throw new Error('login failed ' + JSON.stringify(r.body));
  a.csrf = r.body.csrfToken;
  return a;
}

let phoneSeq = 1000 + Math.floor(Math.random() * 8000);
export const uniquePhone = () => `55${String(Date.now()).slice(-4)}${String(phoneSeq++).padStart(4, '0')}`;

/** Registro completo con OTP real (código expuesto solo en sandbox de pruebas). */
export async function applyCandidate(opts: { link?: string; phone?: string; email?: string | null; channel?: 'sms' | 'whatsapp' | 'email'; firstName?: string } = {}) {
  const a = new Agent(await getApp());
  const phone = opts.phone ?? uniquePhone();
  const start = await a.post('/api/public/apply/start', { linkCode: opts.link ?? 'ventas-fb', firstName: opts.firstName ?? 'Prueba', lastName: 'Candidato Test', phone, email: opts.email ?? null, channel: opts.channel ?? 'whatsapp' });
  if (start.status !== 200) throw new Error('apply/start ' + JSON.stringify(start.body));
  const ver = await a.post('/api/public/otp/verify', { challengeId: start.body.challengeId, code: start.body.devCode });
  if (ver.status !== 200) throw new Error('verify ' + JSON.stringify(ver.body));
  return { agent: a, phone, applicationId: ver.body.applicationId as string, resumed: ver.body.resumed as boolean };
}

export async function completeRegistration(a: Agent, appId: string) {
  const notice = await a.get('/api/public/privacy-notice');
  const r = await a.post(`/api/portal/applications/${appId}/registration`, { noticeId: notice.body.id, acceptPrivacy: true, city: 'CDMX', preferredChannel: 'whatsapp', consents: { whatsapp: true } });
  if (r.status !== 200) throw new Error('registration ' + JSON.stringify(r.body));
  return r.body;
}

export async function answersFor(appView: any, choose: Record<string, any> = {}) {
  const out: Record<string, any> = {};
  for (const q of appView.questions) {
    if (choose[q.text] !== undefined) { out[q.id] = choose[q.text]; continue; }
    if (q.type === 'yes_no') out[q.id] = 'si';
    else if (q.type === 'single_choice') out[q.id] = q.options[0].value;
    else if (q.type === 'number') out[q.id] = 12;
    else if (q.type === 'date') out[q.id] = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    else out[q.id] = 'texto';
  }
  return out;
}

export async function compatibleCandidate(link = 'ventas-fb') {
  const c = await applyCandidate({ link });
  const view = await completeRegistration(c.agent, c.applicationId);
  await c.agent.put(`/api/portal/applications/${c.applicationId}/answers`, { answers: await answersFor(view) });
  const sub = await c.agent.post(`/api/portal/applications/${c.applicationId}/prequal/submit`);
  if (sub.status !== 200) throw new Error('submit ' + JSON.stringify(sub.body));
  return { ...c, view: sub.body };
}

export { pool };

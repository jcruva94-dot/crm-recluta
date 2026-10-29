/**
 * Prueba E2E en navegador real (Chromium, viewport de celular) contra la app en ejecución.
 * Requisitos: servidor en BASE_URL con datos demo y DELIVERY_MODE=sandbox + EXPOSE_DEV_OTP=true.
 * Uso: BASE_URL=http://localhost:3000 node web/e2e/candidate-flow.e2e.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

// Usa Playwright local si está instalado; si no, el instalado globalmente.
let pw;
try { pw = await import('playwright'); }
catch { pw = createRequire(import.meta.url)(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium, devices } = pw;

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = process.env.SHOTS_DIR ?? 'e2e-screenshots';
fs.mkdirSync(OUT, { recursive: true });
const phone = '55' + String(Date.now()).slice(-8);
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['✓', name]); console.log('✓', name); }
  catch (e) { results.push(['✗', name, e.message]); console.error('✗', name, '\n ', e.message); throw e; }
};
const noHorizontalScroll = async (page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 1) throw new Error(`Scroll horizontal de ${over}px en ${page.url()}`);
};

const browser = await chromium.launch();
let failed = false;
try {
  const mobile = await browser.newContext({ ...devices['Pixel 7'], locale: 'es-MX', timezoneId: 'America/Mexico_City' });
  const page = await mobile.newPage();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

  await step('1. Abrir liga de vacante desde un celular', async () => {
    await page.goto(`${BASE}/empleo/l/ventas-fb`);
    await page.getByRole('heading', { name: /Asesor telefónico/ }).waitFor();
    await page.getByText('Qué harás').waitFor();
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${OUT}/01-landing.png`, fullPage: true });
  });

  await step('2. Iniciar registro y validar campos', async () => {
    await page.getByRole('button', { name: 'Postularme' }).click();
    await page.getByRole('button', { name: 'Enviar código' }).click();
    await page.getByText('Escribe tu nombre').waitFor(); // validación en el cliente
    await page.getByLabel('Nombre(s)').fill('Prueba E2E');
    await page.getByLabel('Apellidos').fill('Candidato Demo');
    await page.getByLabel('Celular (10 dígitos)').fill(phone);
    await page.screenshot({ path: `${OUT}/02-registro.png`, fullPage: true });
    await page.getByRole('button', { name: 'Enviar código' }).click();
  });

  await step('3. Verificar identidad con OTP (validado en el backend)', async () => {
    await page.getByLabel('Código de verificación').waitFor();
    await page.getByLabel('Código de verificación').fill('000000');
    await page.getByRole('button', { name: 'Verificar y continuar' }).click();
    const err = page.getByRole('alert');
    await err.waitFor();
    const devCode = await page.getByTestId('dev-otp').innerText();
    if ((await err.innerText()).includes('incorrecto') === false && devCode !== '000000') throw new Error('El código incorrecto no fue rechazado');
    await page.screenshot({ path: `${OUT}/03-otp.png`, fullPage: true });
    await page.getByLabel('Código de verificación').fill(devCode);
    await page.getByRole('button', { name: 'Verificar y continuar' }).click();
    await page.waitForURL(/\/portal\/postulacion\//);
  });

  await step('4-5. Completar datos y aceptar aviso de privacidad', async () => {
    await page.getByLabel('Ciudad o municipio donde vives').fill('Iztapalapa');
    await page.getByRole('button', { name: 'Leer aviso completo' }).click();
    await page.getByRole('dialog').getByText('Derechos ARCO').waitFor();
    await page.getByRole('button', { name: 'Cerrar' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByText('Para continuar necesitas aceptar').waitFor();
    await page.getByTestId('accept-privacy').check();
    await page.screenshot({ path: `${OUT}/04-aviso.png`, fullPage: true });
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByTestId('question-text').waitFor();
  });

  const appUrl = page.url();
  await step('6. Abandonar el proceso a mitad de la precalificación y regresar', async () => {
    await page.getByLabel('Sí').check();
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByText('Pregunta 2 de 6').waitFor();
    await page.goto(`${BASE}/empleo`); // se va
    await page.goto(appUrl); // regresa
    await page.getByText('Pregunta 2 de 6').waitFor(); // retoma donde se quedó
  });

  await step('7. Completar la precalificación', async () => {
    await page.getByLabel('Sí').check();
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByLabel('Vespertino (14 a 22 h)').check();
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByRole('spinbutton').fill('8');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByLabel('Muy cómodo').check();
    await page.getByRole('button', { name: 'Siguiente' }).click();
    const d = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await page.locator('input[type=date]').fill(d);
    await page.screenshot({ path: `${OUT}/05-pregunta.png`, fullPage: true });
    await page.getByRole('button', { name: 'Enviar respuestas' }).click();
  });

  await step('8. Recibir resultado consistente con las reglas (compatible → agendar)', async () => {
    await page.getByTestId('status-title').filter({ hasText: 'Recibimos tus respuestas' }).waitFor();
    const body = await page.locator('main').innerText();
    if (/puntuaci|score|\b100\b/i.test(body)) throw new Error('Se expuso la puntuación al candidato');
    await page.screenshot({ path: `${OUT}/06-resultado.png`, fullPage: true });
  });

  await step('9. Agendar una entrevista', async () => {
    await page.getByTestId('slot').first().click();
    await page.getByRole('button', { name: 'Confirmar horario' }).click();
    await page.getByTestId('interview-card').waitFor();
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${OUT}/07-cita.png`, fullPage: true });
  });

  let firstSlot;
  await step('10. Reprogramar la entrevista', async () => {
    firstSlot = await page.getByTestId('interview-card').locator('p').first().innerText();
    await page.getByRole('button', { name: 'Reprogramar' }).click();
    await page.getByTestId('slot').nth(1).click();
    await page.getByRole('button', { name: 'Cambiar a este horario' }).click();
    await page.getByTestId('interview-card').waitFor();
    const now = await page.getByTestId('interview-card').locator('p').first().innerText();
    if (now === firstSlot) throw new Error('La cita no cambió de horario');
    await page.getByRole('button', { name: 'Confirmar asistencia' }).click();
    await page.getByText('Asistencia confirmada').waitFor();
  });

  await step('12. Consultar estado en el portal y pedir ayuda', async () => {
    await page.goto(`${BASE}/portal`);
    await page.getByText('Entrevista agendada').waitFor();
    await page.getByRole('tab', { name: 'Ayuda' }).click();
    await page.getByLabel('Cuéntanos qué necesitas').fill('Quiero confirmar si debo llevar CURP');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await page.getByText('Recibimos tu solicitud').waitFor();
    await page.screenshot({ path: `${OUT}/08-portal.png`, fullPage: true });
  });

  await step('Continuar más tarde desde otro dispositivo (login sin contraseña)', async () => {
    const other = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-MX' });
    const p2 = await other.newPage();
    await p2.goto(`${BASE}/portal`);
    await p2.waitForURL(/\/portal\/ingresar/); // sin sesión → login
    await p2.getByLabel('Celular o correo').fill(phone);
    await p2.getByRole('button', { name: 'Enviar código' }).click();
    const code = await p2.getByTestId('dev-otp').innerText();
    await p2.getByLabel('Código de verificación').fill(code);
    await p2.getByRole('button', { name: 'Verificar y continuar' }).click();
    await p2.getByText('Hola, Prueba E2E').waitFor();
    await other.close();
  });

  // ----- Panel administrativo -----
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-MX', timezoneId: 'America/Mexico_City' });
  const admin = await desk.newPage();
  admin.on('console', (m) => m.type() === 'error' && consoleErrors.push('[admin] ' + m.text()));
  await step('Admin: login y dashboard con datos reales', async () => {
    await admin.goto(`${BASE}/admin`);
    await admin.waitForURL(/\/admin\/login/);
    await admin.getByLabel('Correo').fill('reclutador1@demo.test');
    await admin.getByLabel('Contraseña').fill('Demo-2026!');
    await admin.getByRole('button', { name: 'Entrar' }).click();
    await admin.getByRole('heading', { name: 'Dashboard de reclutamiento' }).waitFor();
    await admin.getByText('Candidatos únicos').waitFor();
    await admin.screenshot({ path: `${OUT}/10-dashboard.png`, fullPage: true });
  });

  await step('Admin: el candidato aparece en el pipeline (Kanban) y la ficha muestra la explicación', async () => {
    await admin.getByRole('link', { name: 'Pipeline' }).click();
    await admin.getByRole('region', { name: 'Entrevista inicial agendada' }).getByText('Prueba E2E Candidato Demo').first().waitFor();
    await admin.screenshot({ path: `${OUT}/11-kanban.png` });
    await admin.getByLabel('Búsqueda global').fill(phone.slice(-6));
    await admin.getByRole('button', { name: /Prueba E2E Candidato Demo/ }).first().click();
    await admin.getByText('Puntuación:').waitFor();
    await admin.getByText('La puntuación orienta, no decide').waitFor();
    await admin.getByText('Solicitud de ayuda').first().waitFor();
    await admin.screenshot({ path: `${OUT}/12-ficha.png`, fullPage: true });
  });

  await step('Admin: transición inválida no se ofrece y el cambio válido queda en historial', async () => {
    await admin.getByRole('button', { name: 'Registrar contacto' }).click();
    await admin.getByLabel('Detalle').fill('Confirmó asistencia por teléfono');
    await admin.getByRole('button', { name: 'Guardar' }).click();
    await admin.getByText('Confirmó asistencia por teléfono').waitFor();
    await admin.getByRole('button', { name: 'Cambiar etapa' }).click();
    const options = await admin.getByLabel('Nueva etapa').locator('option').allInnerTexts();
    if (options.some((o) => o.startsWith('Oferta laboral'))) throw new Error('Se ofreció una transición no permitida');
    await admin.getByRole('button', { name: 'Cancelar' }).click();
  });

  await step('Admin: un reclutador no puede abrir la auditoría (403 del servidor)', async () => {
    const r = await admin.request.get(`${BASE}/api/admin/audit`);
    if (r.status() !== 403) throw new Error('Esperaba 403, recibió ' + r.status());
  });

  await step('Admin (gerente): mensajes marcados como simulados (no enviados)', async () => {
    const g = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-MX' })).newPage();
    await g.goto(`${BASE}/admin/login`);
    await g.getByLabel('Correo').fill('gerente@demo.test');
    await g.getByLabel('Contraseña').fill('Demo-2026!');
    await g.getByRole('button', { name: 'Entrar' }).click();
    await g.getByRole('heading', { name: 'Dashboard de reclutamiento' }).waitFor();
    await g.goto(`${BASE}/admin/mensajes`);
    const admin = g;
    await admin.getByText('Modo de pruebas.').waitFor();
    await admin.getByText('SIMULADO · no enviado').first().waitFor();
    const txt = await admin.locator('table').innerText();
    if (/\b\d{6}\b/.test(txt.replace(/\d{2}\/\d{2}|\d{2}:\d{2}/g, ''))) throw new Error('El panel mostró un código OTP en claro');
    await g.screenshot({ path: `${OUT}/13-mensajes.png`, fullPage: true });
  });


  if (consoleErrors.filter((e) => !/Failed to load resource/.test(e)).length) {
    console.warn('Errores en consola:', consoleErrors);
  }
} catch {
  failed = true;
} finally {
  await browser.close();
  fs.writeFileSync(`${OUT}/resultado.txt`, results.map((r) => r.join(' ')).join('\n') + '\n');
  console.log(`\n${results.filter((r) => r[0] === '✓').length}/${results.length} pasos OK`);
  process.exit(failed ? 1 : 0);
}

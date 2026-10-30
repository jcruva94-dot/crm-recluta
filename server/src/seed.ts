/**
 * Datos de DEMOSTRACIÓN. Todo lo creado aquí está marcado con is_demo = true o con "(DEMO)" en el nombre.
 * Nombres, teléfonos (+52 55 0000 XXXX) y correos (@ejemplo.test) son ficticios.
 * NO ejecutar en una base de datos productiva.
 */
import path from 'node:path';
import { pool, one } from './db.js';
import { hashPassword } from './lib/crypto.js';
import { migrate } from './migrate.js';
import { config } from './config.js';

export const DEMO_PASSWORD = 'Demo-2026!';

export const DEMO_USERS = [
  { email: 'admin@demo.test', full_name: 'Ana Admin (DEMO)', role: 'admin', team: null },
  { email: 'director@demo.test', full_name: 'Diego Director (DEMO)', role: 'director', team: null },
  { email: 'gerente@demo.test', full_name: 'Gabriela Gerente (DEMO)', role: 'gerente', team: 'Equipo Ventas' },
  { email: 'coordinador@demo.test', full_name: 'Carlos Coordinador (DEMO)', role: 'coordinador', team: 'Equipo Ventas' },
  { email: 'reclutador1@demo.test', full_name: 'Rocío Reclutadora (DEMO)', role: 'reclutador', team: 'Equipo Ventas' },
  { email: 'reclutador2@demo.test', full_name: 'Raúl Reclutador (DEMO)', role: 'reclutador', team: 'Equipo Ventas' },
  { email: 'reclutador3@demo.test', full_name: 'Rebeca Reclutadora (DEMO)', role: 'reclutador', team: 'Equipo Cobranza' },
  { email: 'entrevistador@demo.test', full_name: 'Ernesto Entrevistador (DEMO)', role: 'entrevistador', team: 'Equipo Ventas' },
  { email: 'auditor@demo.test', full_name: 'Aurora Auditora (DEMO)', role: 'auditor', team: null },
] as const;

const PRIVACY_DRAFT = `BORRADOR TÉCNICO — DEBE SER REVISADO Y APROBADO POR EL ÁREA LEGAL ANTES DE USARSE EN PRODUCCIÓN.

Responsable: [Razón social de la empresa], con domicilio en [domicilio].

Datos que recabamos: nombre, teléfono, correo electrónico (opcional), ciudad de residencia, respuestas a preguntas relacionadas con los requisitos de la vacante y, en etapas posteriores, la documentación necesaria para la contratación.

Finalidades primarias: evaluar tu postulación, contactarte sobre tu proceso de selección, agendar entrevistas y, en su caso, gestionar tu contratación.

Finalidades secundarias (puedes negarte): conservar tu perfil en nuestra reserva de talento para futuras vacantes.

No recabamos datos personales sensibles en esta etapa. Las decisiones de selección son revisadas por personas; ningún resultado automático rechaza tu postulación.

Derechos ARCO: puedes solicitar el acceso, rectificación, cancelación u oposición al tratamiento de tus datos en [correo de privacidad]. También puedes revocar tu consentimiento.

Conservación: tus datos se conservarán durante el proceso y hasta [plazo] después de su conclusión, salvo obligación legal distinta.`;

export async function seedBase() {
  await migrate(false);
  const exists = await one(pool, `select 1 from users where email = 'admin@demo.test'`);
  if (exists) return false;
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = async (sql: string, p: unknown[] = []) => (await client.query(sql, p)).rows[0];
    const teams: Record<string, string> = {};
    for (const t of ['Equipo Ventas', 'Equipo Cobranza']) teams[t] = (await q('insert into teams(name) values ($1) returning id', [t])).id;
    const pw = await hashPassword(DEMO_PASSWORD);
    const users: Record<string, string> = {};
    for (const u of DEMO_USERS) {
      users[u.email] = (await q('insert into users(email, full_name, role, team_id, password_hash, is_demo) values ($1,$2,$3,$4,$5,true) returning id', [u.email, u.full_name, u.role, u.team ? teams[u.team] : null, pw])).id;
    }
    const clientId = (await q(`insert into clients(name) values ('Telecom Ejemplo (DEMO)') returning id`)).id;
    const client2 = (await q(`insert into clients(name) values ('Financiera Ejemplo (DEMO)') returning id`)).id;
    const campVentas = (await q(`insert into campaigns(client_id, name) values ($1,'Ventas Portabilidad') returning id`, [clientId])).id;
    await q(`insert into campaigns(client_id, name) values ($1,'Cobranza Temprana') returning id`, [client2]);
    const site = (await q(`insert into sites(name, address, city) values ('Centro Insurgentes (DEMO)','Av. Ejemplo 123, Col. Demo, CDMX','Ciudad de México') returning id`)).id;
    await q(`insert into sites(name, address, city) values ('Centro Monterrey (DEMO)','Calle Ficticia 45, Monterrey, NL','Monterrey') returning id`);
    const sources = [
      ['facebook', 'Facebook', 'redes_sociales'], ['instagram', 'Instagram', 'redes_sociales'], ['tiktok', 'TikTok', 'redes_sociales'],
      ['whatsapp', 'WhatsApp', 'mensajeria'], ['referidos', 'Referidos', 'referido'], ['bolsa', 'Bolsas de trabajo', 'bolsa_trabajo'],
      ['feria', 'Ferias de empleo', 'feria'], ['base_propia', 'Base de datos propia', 'base_propia'], ['campo', 'Reclutamiento en campo', 'campo'],
      ['portal', 'Página corporativa', 'web'], ['publicidad', 'Campañas publicitarias', 'publicidad'],
    ];
    const src: Record<string, string> = {};
    for (const [code, name, kind] of sources) src[code] = (await q('insert into sources(code, name, kind) values ($1,$2,$3) returning id', [code, name, kind])).id;
    await q(`insert into privacy_notices(version, title, body, is_current) values ('2026-10-v1','Aviso de privacidad para candidatos',$1,true)`, [PRIVACY_DRAFT]);

    const v = (await q(
      `insert into vacancies(slug, title, client_id, campaign_id, site_id, team_id, modality, positions, hire_goal, opened_at, target_fill_date, summary, activities, requirements,
         education, experience, salary_text, schedule_text, benefits, process_steps, response_time_text, status, priority, is_demo, created_by)
       values ('asesor-ventas-telefonicas','Asesor telefónico de ventas (DEMO)',$1,$2,$3,$4,'presencial',20,20,current_date, current_date + 30,
        'Únete al equipo de ventas de portabilidad. Capacitación pagada desde el primer día.',
        $5,$6,'Secundaria terminada (preparatoria deseable)','No indispensable; deseable 6 meses en ventas o atención a clientes',
        '$9,500 base mensual + comisiones sin tope','Lunes a viernes 9:00 a 18:00 o 14:00 a 22:00; sábados alternados medio día',
        $7,$8,'Te respondemos en un máximo de 2 días hábiles','publicada','alta',true,$9) returning id`,
      [clientId, campVentas, site, teams['Equipo Ventas'],
        ['Llamadas de salida a clientes interesados en cambiar de compañía', 'Explicar planes y cerrar ventas', 'Registrar cada venta en el sistema'],
        ['Mayor de edad', 'Disponibilidad para trabajar presencialmente en CDMX', 'Manejo básico de computadora'],
        ['Prestaciones de ley desde el primer día', 'Capacitación pagada', 'Bonos por productividad', 'Comedor subsidiado'],
        ['Registro en línea (5 min)', 'Preguntas rápidas', 'Entrevista con reclutamiento', 'Evaluación de habilidades', 'Documentación', 'Capacitación e ingreso'],
        users['gerente@demo.test']])).id;
    for (const r of ['reclutador1@demo.test', 'reclutador2@demo.test']) await q('insert into vacancy_recruiters values ($1,$2)', [v, users[r]]);
    await q(`insert into vacancy_document_types(vacancy_id, document_type_id) select $1, id from document_types
             where code in ('ine','curp','comprobante_domicilio','nss','comprobante_estudios') on conflict do nothing`, [v]);

    const questions = [
      { text: '¿Eres mayor de edad?', type: 'yes_no', weight: 0, ko: true, msg: 'La vacante requiere ser mayor de edad por disposición legal', just: 'Requisito legal para contratación laboral en este puesto (LFT).', options: [{ value: 'si', label: 'Sí', score: 100 }, { value: 'no', label: 'No', score: 0, knockout: true }] },
      { text: '¿Puedes trabajar de forma presencial en Av. Insurgentes, CDMX?', type: 'yes_no', weight: 20, ko: true, msg: 'La vacante es 100% presencial en CDMX', just: 'La operación del cliente se realiza en sitio por requisitos de seguridad de la información.', options: [{ value: 'si', label: 'Sí', score: 100 }, { value: 'no', label: 'No', score: 0, knockout: true }] },
      { text: '¿Qué turno prefieres?', type: 'single_choice', weight: 15, ko: false, just: 'La campaña necesita cubrir ambos turnos; el vespertino tiene mayor demanda.', options: [{ value: 'matutino', label: 'Matutino (9 a 18 h)', score: 100 }, { value: 'vespertino', label: 'Vespertino (14 a 22 h)', score: 100 }, { value: 'cualquiera', label: 'Cualquiera', score: 100 }, { value: 'ninguno', label: 'Ninguno de estos horarios', score: 0, review: true }] },
      { text: '¿Cuántos meses de experiencia tienes en ventas, atención a clientes o call center?', type: 'number', weight: 35, ko: false, just: 'La experiencia previa reduce el tiempo de curva de aprendizaje; no es indispensable.', rules: { min: 0, max: 600, score_ranges: [{ max: 2, score: 40 }, { min: 3, max: 5, score: 70 }, { min: 6, score: 100 }] } },
      { text: '¿Qué tan cómodo te sientes usando la computadora (navegador, correo, teclear rápido)?', type: 'single_choice', weight: 30, ko: false, just: 'El puesto requiere operar CRM y sistemas de captura durante las llamadas.', options: [{ value: 'alto', label: 'Muy cómodo', score: 100 }, { value: 'medio', label: 'Me defiendo', score: 70 }, { value: 'bajo', label: 'Casi no la uso', score: 20, review: true }] },
      { text: '¿Desde qué fecha podrías empezar?', type: 'date', weight: 0, ko: false, just: 'Planeación de grupos de capacitación.', rules: { review_after_days: 30 } },
    ];
    let pos = 1;
    for (const qq of questions) {
      await q(`insert into prequal_questions(vacancy_id, position, text, type, required, weight, is_knockout, knockout_message, justification, options, number_rules) values ($1,$2,$3,$4,true,$5,$6,$7,$8,$9,$10)`,
        [v, pos++, qq.text, qq.type, qq.weight, qq.ko, (qq as any).msg ?? null, qq.just, JSON.stringify((qq as any).options ?? []), (qq as any).rules ?? {}]);
    }
    await q(`insert into tracking_links(code, vacancy_id, source_id, campaign_id, label, created_by) values ('ventas-fb',$1,$2,$3,'Facebook Ads octubre',$4)`, [v, src.facebook, campVentas, users['gerente@demo.test']]);
    await q(`insert into tracking_links(code, vacancy_id, source_id, campaign_id, recruiter_id, label, created_by) values ('ventas-rocio',$1,$2,$3,$4,'Liga personal de Rocío (WhatsApp)',$4)`, [v, src.whatsapp, campVentas, users['reclutador1@demo.test']]);
    await q(`insert into tracking_links(code, vacancy_id, source_id, campaign_id, event_name, label, created_by) values ('feria-oct',$1,$2,$3,'Feria del empleo Iztapalapa','Feria octubre',$4)`, [v, src.feria, campVentas, users['gerente@demo.test']]);

    // Horarios de entrevista: próximos 7 días hábiles, 10:00–13:00 hora de CDMX, cada 30 min
    const interviewer = users['entrevistador@demo.test'];
    const recruiter = users['reclutador1@demo.test'];
    let added = 0;
    for (let d = 1; added < 7 && d < 14; d++) {
      const day = new Date(Date.now() + d * 86400_000);
      const dow = new Date(day.toLocaleString('en-US', { timeZone: config.timezone })).getDay();
      if (dow === 0 || dow === 6) continue;
      added++;
      const ymd = day.toLocaleDateString('en-CA', { timeZone: config.timezone });
      for (const hm of ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30']) {
        await q(`insert into interview_slots(interviewer_id, vacancy_id, starts_at, ends_at, mode, location, created_by)
                 values ($1,$2, ($3::timestamp at time zone $5), ($3::timestamp at time zone $5) + interval '30 minutes','presencial','Centro Insurgentes (DEMO), piso 3', $4)`,
          [interviewer, v, `${ymd} ${hm}`, recruiter, config.timezone]);
      }
    }
    await client.query('commit');
    return true;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

if (process.argv[1] && path.basename(process.argv[1]).startsWith('seed')) {
  seedBase()
    .then(async (created) => {
      console.log(created ? 'Datos de demostración creados.' : 'Los datos de demostración ya existían.');
      if (process.env.SEED_DEMO_ACTIVITY === 'true' || process.argv.includes('--actividad')) {
        const { seedDemoActivity } = await import('./demo-activity.js');
        console.log((await seedDemoActivity()) ? 'Actividad de demostración creada (candidatos marcados como DEMO).' : 'La actividad de demostración ya existía.');
      }
      console.log(`Usuarios de prueba (contraseña: ${DEMO_PASSWORD}):`);
      for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(14)} ${u.email}`);
      console.log(`Liga de prueba: ${config.publicBaseUrl}/empleo/l/ventas-fb`);
    })
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}

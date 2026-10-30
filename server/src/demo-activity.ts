/**
 * Actividad de DEMOSTRACIÓN para que el dashboard y el pipeline tengan movimiento en una demo.
 * - Todo queda marcado con is_demo = true; los nombres llevan "(DEMO)", los correos son @ejemplo.test
 *   y los teléfonos +52 55 0000 XXXX (ficticios).
 * - La precalificación se calcula con el motor real (evaluate) sobre respuestas generadas.
 * - Es determinista (semilla fija) y solo se crea una vez.
 * NO ejecutar en una base de datos productiva.
 */
import { pool, one, many } from './db.js';
import { config } from './config.js';
import { evaluate } from './modules/prequal-engine.js';
import { activeQuestions } from './routes/portal.js';

const FIRST = ['Mariana', 'José', 'Fernanda', 'Luis', 'Daniela', 'Miguel', 'Valeria', 'Jorge', 'Ximena', 'Ricardo', 'Andrea', 'Alejandro', 'Paola', 'Eduardo', 'Karla', 'Iván', 'Lucía', 'Óscar', 'Brenda', 'Arturo'];
const LAST = ['Hernández', 'García', 'Martínez', 'López', 'González', 'Pérez', 'Rodríguez', 'Sánchez', 'Ramírez', 'Cruz', 'Flores', 'Morales', 'Vázquez', 'Jiménez', 'Reyes', 'Díaz'];
const CITIES = ['Iztapalapa', 'Gustavo A. Madero', 'Coyoacán', 'Benito Juárez', 'Nezahualcóyotl', 'Ecatepec', 'Tlalpan', 'Cuauhtémoc'];
const H = 3600_000;

/** Generador pseudoaleatorio con semilla (mulberry32) para que la demo sea reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDemoActivity(total = 84) {
  if (await one(pool, 'select 1 from applications where is_demo limit 1')) return false;
  const v = await one(pool, `select id, threshold_compatible, threshold_observations from vacancies where slug = 'asesor-ventas-telefonicas'`);
  if (!v) return false;
  const users = Object.fromEntries((await many(pool, `select email, id from users where is_demo`)).map((u: any) => [u.email, u.id]));
  const src = Object.fromEntries((await many(pool, 'select code, id from sources')).map((s: any) => [s.code, s.id]));
  const links = Object.fromEntries((await many(pool, 'select code, id, source_id from tracking_links where vacancy_id = $1', [v.id])).map((l: any) => [l.code, l]));
  const reasons = Object.fromEntries((await many(pool, 'select stage_code, name, id from closure_reasons')).map((r: any) => [`${r.stage_code}:${r.name}`, r.id]));
  const questions = await activeQuestions(pool, v.id);
  const interviewer = users['coordinador@demo.test'];
  const recruiters = [users['reclutador1@demo.test'], users['reclutador2@demo.test']];
  const rand = rng(20261030);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const now = Date.now();
  const slotCount: Record<string, number> = {};

  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = async (sql: string, p: unknown[] = []) => (await client.query(sql, p)).rows[0];

    // Visitas a ligas: más visitas que postulaciones, como en una campaña real
    for (let i = 0; i < total * 3; i++) {
      const code = pick(['ventas-fb', 'ventas-fb', 'ventas-fb', 'ventas-rocio', 'feria-oct']);
      await q(`insert into tracking_events(link_id, vacancy_id, event, created_at) values ($1,$2,'visit',$3)`, [links[code].id, v.id, new Date(now - rand() * 29 * 24 * H)]);
    }

    for (let i = 0; i < total; i++) {
      // Más postulaciones en días recientes para que la tendencia tenga forma
      const ageDays = Math.pow(rand(), 1.3) * 29;
      let t = now - ageDays * 24 * H;
      const channel = pick(['ventas-fb', 'ventas-fb', 'ventas-fb', 'ventas-fb', 'ventas-rocio', 'ventas-rocio', 'feria-oct', 'referidos', 'tiktok', 'bolsa']);
      const link = links[channel];
      const sourceId = link ? link.source_id : src[channel];
      const recruiter = channel === 'ventas-rocio' ? users['reclutador1@demo.test'] : recruiters[i % 2];
      const first = pick(FIRST); const last = `${pick(LAST)} ${pick(LAST)}`;
      const cand = await q(`insert into candidates(first_name, last_name, phone_e164, email, phone_verified_at, city, is_demo, created_at)
        values ($1,$2,$3,$4,$5,$6,true,$5) returning id`,
        [first, `${last} (DEMO)`, `+52550000${String(1000 + i).slice(-4)}`, `candidato${i + 1}@ejemplo.test`, new Date(t), pick(CITIES)]);
      const app = await q(`insert into applications(candidate_id, vacancy_id, link_id, first_source_id, last_source_id, recruiter_id, stage_code, stage_entered_at, is_demo, created_at)
        values ($1,$2,$3,$4,$4,$5,'nuevo_prospecto',$6,true,$6) returning id`, [cand.id, v.id, link?.id ?? null, sourceId, recruiter, new Date(t)]);
      await q(`insert into tracking_events(link_id, vacancy_id, event, created_at) values ($1,$2,'apply_start',$3),($1,$2,'otp_verified',$3)`, [link?.id ?? null, v.id, new Date(t)]);

      let stage = 'nuevo_prospecto';
      const set: Record<string, unknown> = {};
      const history: [string, string, Date, string | null, string | null][] = [['', 'nuevo_prospecto', new Date(t), 'candidate', null]];
      /** Avanza a la etapa si el tiempo simulado no rebasa "ahora"; devuelve false si se detiene. */
      const go = (to: string, afterHours: number, actor = 'system', closure: string | null = null) => {
        const next = t + afterHours * H * (0.6 + rand() * 0.8);
        if (next > now) return false;
        t = next; history.push([stage, to, new Date(t), actor, closure]); stage = to; return true;
      };
      const close = (to: string, reason: string, afterHours: number) => go(to, afterHours, 'user', reasons[`${to}:${reason}`] ?? null);

      run: {
        if (!go('registro_iniciado', 0.05, 'candidate')) break run;
        if (rand() < 0.12) { close('abandono', 'No concluyó registro', 72); break run; }
        if (!go('registro_completado', 0.2, 'candidate')) break run;
        set.registration_completed_at = new Date(t);
        if (!go('precalificacion_pendiente', 0.01)) break run;
        if (rand() < 0.1) break run; // se quedó a medias
        // Respuestas generadas y evaluadas con el motor real
        const answers: Record<string, any> = {};
        for (const qq of questions) {
          if (qq.type === 'yes_no') answers[qq.id] = rand() < (qq.is_knockout ? 0.93 : 0.8) ? 'si' : 'no';
          else if (qq.type === 'single_choice') answers[qq.id] = qq.options[Math.min(qq.options.length - 1, Math.floor(Math.pow(rand(), 1.8) * qq.options.length))].value;
          else if (qq.type === 'number') answers[qq.id] = Math.floor(Math.pow(rand(), 1.5) * 36);
          else if (qq.type === 'date') answers[qq.id] = new Date(t + (rand() < 0.88 ? 3 : 45) * 24 * H).toISOString().slice(0, 10);
          else answers[qq.id] = 'Respuesta de demostración';
        }
        if (!go('precalificacion_completada', 0.15, 'candidate')) break run;
        const ev = evaluate(questions, answers, { compatible: v.threshold_compatible, observations: v.threshold_observations }, new Date(t));
        Object.assign(set, { prequal_result: ev.result, prequal_score: ev.score, prequal_completed_at: new Date(t),
          prequal_explanation: { ...ev, evaluatedAt: new Date(t).toISOString(), demo: true, questionsSnapshot: questions.map((x) => ({ id: x.id, text: x.text, weight: x.weight, is_knockout: x.is_knockout })) } });
        for (const [qid, val] of Object.entries(answers)) await q('insert into prequal_answers(application_id, question_id, value, answered_at) values ($1,$2,$3,$4)', [app.id, qid, JSON.stringify(val), new Date(t)]);
        const eligible = ev.result === 'compatible' || ev.result === 'compatible_con_observaciones';
        if (!eligible) {
          if (!go('revision_compatibilidad', 0.01)) break run;
          if (ev.result === 'no_cumple') { close('rechazado', 'No cumple requisito indispensable validado', 20); break run; }
          if (rand() < 0.5) break run;
        }
        if (!go('contacto_pendiente', eligible ? 0.01 : 18, eligible ? 'system' : 'user')) break run;
        // Primer contacto del reclutador
        const contactAt = t + (2 + rand() * 20) * H;
        if (contactAt < now && rand() < 0.88) {
          const outcome = rand() < 0.8 ? 'contactado' : 'no_contesta';
          await q(`insert into notes(application_id, author_id, body, kind, contact_outcome, created_at) values ($1,$2,$3,'contacto',$4,$5)`,
            [app.id, recruiter, outcome === 'contactado' ? 'Llamada de seguimiento (DEMO)' : 'Sin respuesta (DEMO)', outcome, new Date(contactAt)]);
          set.last_contact_at = new Date(contactAt);
          if (outcome === 'no_contesta' && rand() < 0.5) { t = contactAt; close('no_localizado', 'No contesta tras 3 intentos', 72); break run; }
        }
        if (rand() < 0.15) { close('retirado', pick(['Aceptó otra oferta', 'Sueldo no le convence', 'Horario no le conviene']), 30); break run; }
        if (!go('entrevista_agendada', 10, 'candidate')) break run;
        // Cita: día hábil siguiente a las 16:00+ (horario exclusivo de la demo, sin traslapes)
        const day = new Date(t + 24 * H).toLocaleDateString('en-CA', { timeZone: config.timezone });
        const k = (slotCount[day] = (slotCount[day] ?? 0) + 1) - 1;
        if (k >= 10) break run;
        const hm = `${16 + Math.floor(k / 2)}:${k % 2 ? '30' : '00'}`;
        const slot = await q(`insert into interview_slots(interviewer_id, vacancy_id, starts_at, ends_at, mode, location, created_by)
          values ($1,$2, ($3::timestamp at time zone $4), ($3::timestamp at time zone $4) + interval '30 minutes','presencial','Centro Insurgentes (DEMO), piso 3',$1) returning id, starts_at`,
          [interviewer, v.id, `${day} ${hm}`, config.timezone]);
        const startsAt = new Date(slot.starts_at).getTime();
        const iv = await q(`insert into interviews(application_id, slot_id, status, booked_by, created_at) values ($1,$2,'agendada','candidato',$3) returning id`, [app.id, slot.id, new Date(t)]);
        if (startsAt > now) break run; // cita futura: queda agendada
        t = startsAt;
        if (rand() < 0.22) {
          await q(`update interviews set status = 'no_asistio', updated_at = $2 where id = $1`, [iv.id, new Date(t)]);
          await client.query('update applications set no_show_count = 1 where id = $1', [app.id]);
          go('contacto_pendiente', 1);
          if (rand() < 0.6) close('abandono', 'No asistió y no respondió', 72);
          break run;
        }
        const advances = rand() < 0.72;
        await q(`update interviews set status = 'realizada', result = $2, updated_at = $3 where id = $1`, [iv.id, advances ? 'avanza' : 'no_avanza', new Date(t + 0.5 * H)]);
        if (!go('entrevista_realizada', 0.5, 'user')) break run;
        if (!advances) { close('rechazado', 'Resultado de entrevista no favorable', 6); break run; }
        if (!go('evaluacion', 8, 'user')) break run;
        if (!go('validacion_requisitos', 24, 'user')) break run;
        if (!go('documentacion_pendiente', 6, 'user')) break run;
        if (!go('oferta', 36, 'user')) break run;
        if (rand() < 0.15) { close('retirado', 'Aceptó otra oferta', 24); break run; }
        if (!go('oferta_aceptada', 12, 'candidate')) break run;
        if (!go('contratacion_confirmada', 24, 'user')) break run;
        if (!go('onboarding', 48, 'user')) break run;
        go('ingreso_efectivo', 72, 'user');
      }

      for (const [from, to, at, actor, closure] of history) {
        await q(`insert into stage_history(application_id, from_code, to_code, actor_type, user_id, reason, closure_reason_id, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [app.id, from || null, to, actor ?? 'system', actor === 'user' ? recruiter : null, 'Actividad de demostración', closure, at]);
      }
      const end = history[history.length - 1];
      const cols = Object.keys(set);
      await client.query(`update applications set stage_code = $2, stage_entered_at = $3, closure_reason_id = $4, updated_at = $3
        ${cols.map((c, j) => `, ${c} = $${j + 5}`).join('')} where id = $1`,
        [app.id, stage, end[2], end[4], ...cols.map((c) => set[c])]);
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

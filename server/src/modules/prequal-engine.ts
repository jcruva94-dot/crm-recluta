/**
 * Motor de precalificación. Función pura: mismas respuestas + misma configuración = mismo resultado.
 * Reglas:
 *  - Solo un requisito indispensable (is_knockout) no cumplido produce `no_cumple`.
 *  - Respuestas marcadas para revisión o puntuación baja producen `requiere_revision`.
 *  - La puntuación nunca rechaza por sí sola.
 */
export type QuestionType = 'yes_no' | 'single_choice' | 'multi_choice' | 'number' | 'date' | 'text';

export interface QuestionOption {
  value: string;
  label: string;
  score?: number; // 0-100
  knockout?: boolean; // solo aplica si la pregunta es indispensable
  review?: boolean;
}

export interface NumberRules {
  min?: number;
  max?: number;
  knockout_below?: number;
  knockout_above?: number;
  review_below?: number;
  review_above?: number;
  score_ranges?: { min?: number; max?: number; score: number }[];
  // Para fechas: días a partir de hoy
  review_after_days?: number;
  knockout_after_days?: number;
}

export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  required: boolean;
  weight: number;
  is_knockout: boolean;
  knockout_message?: string | null;
  options: QuestionOption[];
  number_rules: NumberRules;
}

export type AnswerValue = string | number | string[] | boolean | null;

export type Result = 'compatible' | 'compatible_con_observaciones' | 'requiere_revision' | 'no_cumple';

export interface Criterion {
  questionId: string;
  question: string;
  answer: string;
  weight: number;
  earned: number | null; // 0-100
  outcome: 'cumple' | 'parcial' | 'no_cumple_indispensable' | 'revision' | 'sin_respuesta' | 'informativo';
  note?: string;
}

export interface Evaluation {
  result: Result;
  score: number | null;
  criteria: Criterion[];
  reasons: string[];
  knockoutMessages: string[];
  thresholds: { compatible: number; observations: number };
}

export function validateAnswer(q: Question, v: AnswerValue): string | null {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
    return q.required ? 'Esta pregunta es obligatoria' : null;
  }
  switch (q.type) {
    case 'yes_no':
      return v === 'si' || v === 'no' ? null : 'Respuesta no válida';
    case 'single_choice':
      return typeof v === 'string' && q.options.some((o) => o.value === v) ? null : 'Selecciona una opción válida';
    case 'multi_choice':
      return Array.isArray(v) && v.every((x) => q.options.some((o) => o.value === x)) ? null : 'Selecciona opciones válidas';
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return 'Debe ser un número';
      if (q.number_rules.min !== undefined && n < q.number_rules.min) return `El valor mínimo es ${q.number_rules.min}`;
      if (q.number_rules.max !== undefined && n > q.number_rules.max) return `El valor máximo es ${q.number_rules.max}`;
      return null;
    }
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? null : 'Fecha no válida';
    case 'text':
      return typeof v === 'string' && v.length <= 1000 ? null : 'Texto demasiado largo (máx. 1000)';
  }
}

const isEmpty = (v: AnswerValue) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

function labelFor(q: Question, v: AnswerValue): string {
  if (isEmpty(v)) return '—';
  if (q.type === 'yes_no') return v === 'si' ? 'Sí' : 'No';
  if (q.type === 'single_choice') return q.options.find((o) => o.value === v)?.label ?? String(v);
  if (q.type === 'multi_choice') return (v as string[]).map((x) => q.options.find((o) => o.value === x)?.label ?? x).join(', ');
  return String(v);
}

function choiceOptions(q: Question, v: AnswerValue): QuestionOption[] {
  if (q.type === 'yes_no') {
    const opt = q.options.find((o) => o.value === v);
    return [opt ?? { value: String(v), label: String(v), score: v === 'si' ? 100 : 0 }];
  }
  if (q.type === 'single_choice') return q.options.filter((o) => o.value === v);
  if (q.type === 'multi_choice') return q.options.filter((o) => (v as string[]).includes(o.value));
  return [];
}

export function evaluate(
  questions: Question[],
  answers: Record<string, AnswerValue>,
  thresholds: { compatible: number; observations: number },
  today: Date = new Date(),
): Evaluation {
  const criteria: Criterion[] = [];
  const reasons: string[] = [];
  const knockoutMessages: string[] = [];
  let weightSum = 0;
  let earnedSum = 0;
  let knockout = false;
  let review = false;

  for (const q of questions) {
    const v = answers[q.id] ?? null;
    const c: Criterion = { questionId: q.id, question: q.text, answer: labelFor(q, v), weight: q.weight, earned: null, outcome: 'informativo' };
    if (isEmpty(v)) {
      c.outcome = 'sin_respuesta';
      if (q.required || q.is_knockout) {
        review = true;
        c.outcome = 'revision';
        c.note = 'Información insuficiente';
        reasons.push(`Falta respuesta: "${q.text}"`);
      }
      criteria.push(c);
      continue;
    }

    let fraction: number | null = null;
    let qKnock = false;
    let qReview = false;

    if (q.type === 'yes_no' || q.type === 'single_choice' || q.type === 'multi_choice') {
      const opts = choiceOptions(q, v);
      if (opts.length) fraction = Math.max(...opts.map((o) => (o.score ?? 0))) / 100;
      if (q.is_knockout && opts.length && opts.every((o) => o.knockout)) qKnock = true;
      if (opts.some((o) => o.review)) qReview = true;
    } else if (q.type === 'number') {
      const n = Number(v);
      const r = q.number_rules;
      if (q.is_knockout && ((r.knockout_below !== undefined && n < r.knockout_below) || (r.knockout_above !== undefined && n > r.knockout_above))) qKnock = true;
      if ((r.review_below !== undefined && n < r.review_below) || (r.review_above !== undefined && n > r.review_above)) qReview = true;
      if (r.score_ranges?.length) {
        const range = r.score_ranges.find((s) => (s.min === undefined || n >= s.min) && (s.max === undefined || n <= s.max));
        fraction = (range?.score ?? 0) / 100;
      }
    } else if (q.type === 'date') {
      const days = Math.round((Date.parse(String(v)) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000);
      const r = q.number_rules;
      if (q.is_knockout && r.knockout_after_days !== undefined && days > r.knockout_after_days) qKnock = true;
      if (r.review_after_days !== undefined && days > r.review_after_days) qReview = true;
      fraction = q.weight > 0 ? (qReview || qKnock ? 0 : 1) : null;
    }

    if (q.weight > 0 && fraction !== null) {
      weightSum += q.weight;
      earnedSum += q.weight * fraction;
      c.earned = Math.round(fraction * 100);
      c.outcome = fraction >= 0.999 ? 'cumple' : 'parcial';
    } else if (q.weight === 0 && !qKnock && !qReview) {
      c.outcome = q.is_knockout ? 'cumple' : 'informativo';
    }
    if (qReview) {
      review = true;
      c.outcome = 'revision';
      c.note = 'Respuesta configurada para revisión humana';
      reasons.push(`Requiere revisión: "${q.text}" → ${c.answer}`);
    }
    if (qKnock) {
      knockout = true;
      c.outcome = 'no_cumple_indispensable';
      c.note = 'Requisito indispensable no cumplido';
      reasons.push(`Indispensable no cumplido: "${q.text}" → ${c.answer}`);
      if (q.knockout_message) knockoutMessages.push(q.knockout_message);
    }
    criteria.push(c);
  }

  const score = weightSum > 0 ? Math.round((earnedSum / weightSum) * 10000) / 100 : null;
  let result: Result;
  if (knockout) result = 'no_cumple';
  else if (review) result = 'requiere_revision';
  else if (score === null || score >= thresholds.compatible) result = 'compatible';
  else if (score >= thresholds.observations) {
    result = 'compatible_con_observaciones';
    reasons.push(`Puntuación ${score} entre umbral de observaciones (${thresholds.observations}) y compatible (${thresholds.compatible})`);
  } else {
    result = 'requiere_revision';
    reasons.push(`Puntuación ${score} menor al umbral de observaciones (${thresholds.observations}); no se rechaza automáticamente`);
  }
  if (result === 'compatible') reasons.push(score === null ? 'Sin criterios ponderados; cumple indispensables' : `Puntuación ${score} ≥ umbral compatible (${thresholds.compatible})`);
  return { result, score, criteria, reasons, knockoutMessages, thresholds };
}

// Temas que no pueden usarse como criterio de selección.
const PROTECTED = [
  /\bedad\b/, /cuantos anos tienes/, /fecha de nacimiento/, /\bgenero\b/, /\bsexo\b/, /estado civil/, /\bcasad[oa]\b/, /\bsolter[oa]\b/,
  /religi/, /embaraz/, /\bhijos\b/, /discapacidad/, /\betnia|etnico|indigena|\braza\b|color de piel/, /apariencia/, /estatura/,
  /\bpeso\b/, /tatuaje/, /orientacion sexual/, /afiliacion politica|partido politico/, /sindica/, /vih|enfermedad/,
];

export function protectedTopic(text: string): boolean {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/mayor de edad/.test(t) && !/(cuantos|que edad)/.test(t)) return false; // requisito legal de edad mínima permitido
  return PROTECTED.some((re) => re.test(t));
}

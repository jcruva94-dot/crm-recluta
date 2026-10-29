import { describe, it, expect } from 'vitest';
import { evaluate, protectedTopic, validateAnswer, type Question } from '../src/modules/prequal-engine.js';

const q = (over: Partial<Question>): Question => ({ id: Math.random().toString(36).slice(2), text: 'P', type: 'yes_no', required: true, weight: 0, is_knockout: false, options: [], number_rules: {}, ...over });
const T = { compatible: 70, observations: 50 };

describe('motor de precalificación', () => {
  const ko = q({ text: '¿Puedes trabajar presencial?', is_knockout: true, weight: 20, knockout_message: 'Es presencial', options: [{ value: 'si', label: 'Sí', score: 100 }, { value: 'no', label: 'No', score: 0, knockout: true }] });
  const exp = q({ text: 'Meses de experiencia', type: 'number', weight: 80, number_rules: { score_ranges: [{ max: 2, score: 40 }, { min: 3, max: 5, score: 70 }, { min: 6, score: 100 }] } });

  it('compatible cuando cumple indispensables y supera el umbral', () => {
    const r = evaluate([ko, exp], { [ko.id]: 'si', [exp.id]: 12 }, T);
    expect(r.result).toBe('compatible');
    expect(r.score).toBe(100);
    expect(r.criteria).toHaveLength(2);
  });

  it('no_cumple solo por indispensable, aunque la puntuación sea alta', () => {
    const r = evaluate([ko, exp], { [ko.id]: 'no', [exp.id]: 24 }, T);
    expect(r.result).toBe('no_cumple');
    expect(r.knockoutMessages).toEqual(['Es presencial']);
    expect(r.criteria.find((c) => c.questionId === ko.id)!.outcome).toBe('no_cumple_indispensable');
  });

  it('compatible_con_observaciones entre umbrales', () => {
    // 20*1 + 80*0.7 = 76 -> compatible; con 40% -> 20 + 32 = 52 -> observaciones
    const r = evaluate([ko, exp], { [ko.id]: 'si', [exp.id]: 1 }, T);
    expect(r.score).toBe(52);
    expect(r.result).toBe('compatible_con_observaciones');
  });

  it('puntuación baja va a revisión humana, nunca a rechazo', () => {
    const r = evaluate([ko, exp], { [ko.id]: 'si', [exp.id]: 0 }, { compatible: 90, observations: 80 });
    expect(r.result).toBe('requiere_revision');
  });

  it('respuesta marcada para revisión produce requiere_revision', () => {
    const turno = q({ type: 'single_choice', weight: 10, options: [{ value: 'a', label: 'A', score: 100 }, { value: 'x', label: 'Ninguno', score: 0, review: true }] });
    expect(evaluate([turno], { [turno.id]: 'x' }, T).result).toBe('requiere_revision');
  });

  it('información insuficiente en obligatoria produce revisión', () => {
    expect(evaluate([ko], {}, T).result).toBe('requiere_revision');
  });

  it('fecha de ingreso lejana pide revisión', () => {
    const d = q({ type: 'date', number_rules: { review_after_days: 30 } });
    const far = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
    const near = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    expect(evaluate([d], { [d.id]: far }, T).result).toBe('requiere_revision');
    expect(evaluate([d], { [d.id]: near }, T).result).toBe('compatible');
  });

  it('es determinista (explicable y auditable)', () => {
    const a = evaluate([ko, exp], { [ko.id]: 'si', [exp.id]: 4 }, T);
    const b = evaluate([ko, exp], { [ko.id]: 'si', [exp.id]: 4 }, T);
    expect(a).toEqual(b);
    expect(a.reasons.length).toBeGreaterThan(0);
  });

  it('valida respuestas', () => {
    expect(validateAnswer(exp, 'abc')).toBeTruthy();
    expect(validateAnswer(ko, 'tal vez')).toBeTruthy();
    expect(validateAnswer(ko, null)).toBe('Esta pregunta es obligatoria');
    expect(validateAnswer(ko, 'si')).toBeNull();
  });

  it('detecta temas protegidos y permite "mayor de edad"', () => {
    expect(protectedTopic('¿Cuál es tu estado civil?')).toBe(true);
    expect(protectedTopic('¿Qué edad tienes?')).toBe(true);
    expect(protectedTopic('¿Tienes hijos?')).toBe(true);
    expect(protectedTopic('¿Cuál es tu género?')).toBe(true);
    expect(protectedTopic('¿Eres mayor de edad?')).toBe(false);
    expect(protectedTopic('¿Tienes experiencia en cobranza?')).toBe(false);
  });
});

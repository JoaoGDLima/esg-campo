// Tipos de resposta e cálculo do índice de conformidade.
import { fmtDay } from './util.js';

export const ANSWER_TYPES = {
  conform: { label: 'Conformidade (Conforme / Parcial / Não conforme / N.A.)', short: 'Conformidade', scored: true },
  yesno:   { label: 'Sim / Não / N.A.', short: 'Sim/Não', scored: true },
  single:  { label: 'Escolha única', short: 'Escolha única', scored: true },
  multi:   { label: 'Múltipla escolha', short: 'Múltipla', scored: false },
  text:    { label: 'Texto livre', short: 'Texto', scored: false },
  number:  { label: 'Número', short: 'Número', scored: false },
  date:    { label: 'Data', short: 'Data', scored: false },
};

export const CONFORM_OPTIONS = [
  { value: 'C',  label: 'Conforme',      score: 1 },
  { value: 'P',  label: 'Parcial',       score: 0.5 },
  { value: 'NC', label: 'Não conforme',  score: 0 },
  { value: 'NA', label: 'Não se aplica', score: null },
];

export const YESNO_OPTIONS = [
  { value: 'sim', label: 'Sim' },
  { value: 'nao', label: 'Não' },
  { value: 'NA',  label: 'N.A.' },
];

export const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

// Retorna 0..1, ou null quando a pergunta não pontua / não se aplica / sem resposta.
export function questionScore(q, value) {
  if (isEmpty(value)) return null;
  switch (q.type) {
    case 'conform': return CONFORM_OPTIONS.find(o => o.value === value)?.score ?? null;
    case 'yesno':   return value === 'NA' ? null : (value === (q.expected || 'sim') ? 1 : 0);
    case 'single': {
      const o = (q.options || []).find(o => o.label === value);
      return o && o.score != null && o.score !== '' ? Math.max(0, Math.min(1, Number(o.score))) : null;
    }
    default: return null;
  }
}

export const isNonConform = (q, value) => {
  const s = questionScore(q, value);
  return s !== null && s < 1;
};

export function computeScores(questionnaire, answers = {}) {
  const pillars = { E: blank(), S: blank(), G: blank() };
  const nonConform = [];
  const critical = [];
  let earned = 0, total = 0;
  for (const s of questionnaire.sections) {
    for (const q of s.questions) {
      const value = answers[q.id]?.value;
      const sc = questionScore(q, value);
      if (sc === null) continue;
      const w = Number(q.weight) > 0 ? Number(q.weight) : 1;
      const p = pillars[s.pillar] || (pillars[s.pillar] = blank());
      p.earned += w * sc; p.total += w; p.count++;
      earned += w * sc; total += w;
      if (sc < 1) {
        const item = { q, s, value, score: sc };
        nonConform.push(item);
        if (q.critical) critical.push(item);
      }
    }
  }
  for (const p of Object.values(pillars)) p.pct = p.total ? p.earned / p.total : null;
  return { pillars, overall: total ? earned / total : null, nonConform, critical };
}

function blank() { return { earned: 0, total: 0, count: 0, pct: null }; }

export function summarizeScores(sc) {
  return {
    overall: sc.overall, E: sc.pillars.E.pct, S: sc.pillars.S.pct, G: sc.pillars.G.pct,
    nonConform: sc.nonConform.length, critical: sc.critical.length,
  };
}

export function progress(questionnaire, answers = {}) {
  let total = 0, answered = 0;
  const reqMissing = [];
  for (const s of questionnaire.sections) {
    for (const q of s.questions) {
      total++;
      if (!isEmpty(answers[q.id]?.value)) answered++;
      else if (q.required) reqMissing.push(q);
    }
  }
  return { total, answered, reqMissing };
}

export function classify(p, criticalCount = 0) {
  if (criticalCount > 0) return 'Pendência crítica';
  if (p == null) return 'Sem itens avaliados';
  if (p >= 0.85) return 'Alta conformidade';
  if (p >= 0.6) return 'Conformidade parcial';
  return 'Baixa conformidade';
}

export const scoreClass = (p, criticalCount = 0) => (criticalCount > 0 ? 'bad' : p == null ? 'na' : p >= 0.85 ? 'good' : p >= 0.6 ? 'mid' : 'bad');

export function formatAnswer(q, value) {
  if (isEmpty(value)) return '—';
  switch (q.type) {
    case 'conform': return CONFORM_OPTIONS.find(o => o.value === value)?.label ?? value;
    case 'yesno':   return value === 'NA' ? 'Não se aplica' : value === 'sim' ? 'Sim' : 'Não';
    case 'multi':   return [].concat(value).join(', ');
    case 'date':    return fmtDay(value);
    default:        return String(value);
  }
}

export function optionsToText(options = []) {
  return options.map(o => (o.score != null && o.score !== '' ? `${o.label} = ${o.score}` : o.label)).join('\n');
}

export function parseOptions(text) {
  return String(text).split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const m = line.match(/^(.*?)\s*=\s*([\d.,]+)\s*$/);
    return m ? { label: m[1], score: Number(m[2].replace(',', '.')) } : { label: line, score: null };
  });
}

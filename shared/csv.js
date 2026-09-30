// Planilhas CSV de visitas (usadas pelo app de campo e pelo painel admin).
import { computeScores, formatAnswer, questionScore } from './scoring.js';
import { PILLARS, fmtDate, fmtDay } from './util.js';

const cell = (v) => {
  const s = String(v ?? '');
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// Separador ";" e BOM para abrir corretamente no Excel em português.
export const toCSV = (rows) => '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');

const num = (x, digits = 1) => (x == null || x === '' ? '' : Number(x).toFixed(digits).replace('.', ','));
const pctNum = (x) => (x == null ? '' : num(x * 100));
const STATUS = { andamento: 'Em andamento', finalizada: 'Finalizada' };

function visitCols(v) {
  const p = v.property || {};
  return [v.id, STATUS[v.status] || v.status, fmtDate(v.startedAt), fmtDate(v.finishedAt), v.orientadorName || v.orientador,
    p.producer, p.document, p.name, p.municipality, p.uf, p.car,
    v.gps?.lat ?? '', v.gps?.lng ?? '', v.questionnaire.title, v.questionnaire.version];
}
const VISIT_HEAD = ['visita_id', 'status', 'inicio', 'fim', 'orientador', 'produtor', 'documento', 'propriedade',
  'municipio', 'uf', 'car', 'latitude', 'longitude', 'questionario', 'versao'];

export function csvAnswers(visits) {
  const rows = [[...VISIT_HEAD, 'pilar', 'secao', 'numero', 'pergunta', 'critica', 'resposta', 'pontuacao',
    'observacao', 'fotos', 'acao_corretiva', 'responsavel', 'prazo']];
  for (const v of visits) {
    const base = visitCols(v);
    v.questionnaire.sections.forEach((s, si) => s.questions.forEach((q, qi) => {
      const a = v.answers?.[q.id] || {};
      const plan = v.actionPlan?.[q.id] || {};
      const sc = questionScore(q, a.value);
      rows.push([...base, PILLARS[s.pillar] || s.pillar, s.title, `${si + 1}.${qi + 1}`, q.text, q.critical ? 'sim' : 'não',
        formatAnswer(q, a.value).replace(/^—$/, ''), sc == null ? '' : num(sc, 2), a.note || '', (a.photos || []).length,
        plan.action || '', plan.responsible || '', fmtDay(plan.deadline)]);
    }));
  }
  return toCSV(rows);
}

export function csvSummary(visits) {
  const rows = [[...VISIT_HEAD, 'indice_geral_%', 'ambiental_%', 'social_%', 'governanca_%',
    'nao_conformidades', 'criticas', 'assinado_por']];
  for (const v of visits) {
    const sc = computeScores(v.questionnaire, v.answers);
    rows.push([...visitCols(v), pctNum(sc.overall), pctNum(sc.pillars.E.pct), pctNum(sc.pillars.S.pct),
      pctNum(sc.pillars.G.pct), sc.nonConform.length, sc.critical.length, v.signature ? (v.signerName || 'sim') : '']);
  }
  return toCSV(rows);
}

// Exportação (CSV, backup JSON) e importação de backup.
import { db, getSettings, saveSettings } from './db.js';
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
  return [v.id, STATUS[v.status] || v.status, fmtDate(v.startedAt), fmtDate(v.finishedAt), v.orientador,
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

const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result); r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

export async function exportBackup() {
  const [questionnaires, properties, visits, photos, settings] = await Promise.all([
    db.all('questionnaires'), db.all('properties'), db.all('visits'), db.all('photos'), getSettings()]);
  const ph = await Promise.all(photos.map(async p => ({
    id: p.id, visitId: p.visitId, qid: p.qid, createdAt: p.createdAt, dataUrl: await blobToDataURL(p.blob),
  })));
  return JSON.stringify({ format: 'esg-backup', formatVersion: 1, exportedAt: new Date().toISOString(),
    settings, questionnaires, properties, visits, photos: ph });
}

export async function importBackup(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('Arquivo inválido (não é JSON).'); }
  if (d.format !== 'esg-backup') throw new Error('Este arquivo não é um backup do ESG Campo.');
  for (const q of d.questionnaires || []) await db.put('questionnaires', q);
  for (const p of d.properties || []) await db.put('properties', p);
  for (const v of d.visits || []) await db.put('visits', v);
  for (const p of d.photos || []) {
    const blob = await (await fetch(p.dataUrl)).blob();
    await db.put('photos', { id: p.id, visitId: p.visitId, qid: p.qid, createdAt: p.createdAt, blob });
  }
  const cur = await getSettings();
  if (!cur.orientador && d.settings) await saveSettings({ ...d.settings });
  return { visits: (d.visits || []).length, properties: (d.properties || []).length,
    questionnaires: (d.questionnaires || []).length, photos: (d.photos || []).length };
}

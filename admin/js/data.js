// Visitas em tempo real (uma única assinatura do Firestore para o painel todo) e filtros comuns.
import * as fb from '../../shared/firebase.js';
import { esc } from '../../shared/util.js';

let cache = null, error = null, unsub = null;
const listeners = new Set();

export function watchVisits(fn) {
  listeners.add(fn);
  if (cache || error) fn(cache, error);
  if (!unsub) {
    unsub = fb.onSnapshot(fb.collection(fb.fs, 'visits'), snap => {
      cache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      error = null;
      listeners.forEach(l => l(cache, null));
    }, err => {
      error = err;
      listeners.forEach(l => l(cache, err));
    });
  }
  return () => listeners.delete(fn);
}

export const tsDate = (t) => (t?.toDate ? t.toDate() : t ? new Date(t) : null);

export const REVIEW = {
  pendente: { label: 'Aguardando revisão', cls: '' },
  aprovada: { label: 'Aprovada', cls: 'ok' },
  ajustes: { label: 'Requer ajustes', cls: 'warn' },
};

/* ---------------- Filtros ---------------- */

const KEY = 'esg-admin-filters';
const DEFAULTS = { period: '90', questionnaire: '', orientador: '', municipio: '', status: '' };
export function getFilters() {
  try { return { ...DEFAULTS, ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveFilters(f) { try { sessionStorage.setItem(KEY, JSON.stringify(f)); } catch { /* sem armazenamento */ } }

export const PERIODS = [['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['365', 'Últimos 12 meses'], ['all', 'Todo o período']];

export function applyFilters(visits, f) {
  const since = f.period === 'all' ? 0 : Date.now() - Number(f.period) * 86400000;
  return visits.filter(v =>
    (!since || new Date(v.startedAt).getTime() >= since) &&
    (!f.questionnaire || v.questionnaireId === f.questionnaire) &&
    (!f.orientador || v.orientadorUid === f.orientador) &&
    (!f.municipio || `${v.municipality}/${v.uf}` === f.municipio) &&
    (!f.status || v.status === f.status));
}

// Linha única de filtros, acima de tudo o que ela filtra.
export function filterBarHTML(visits, f, { showStatus = true } = {}) {
  const uniq = (arr) => [...new Map(arr.filter(([k]) => k).map(x => [x[0], x])).values()].sort((a, b) => a[1].localeCompare(b[1]));
  const qs = uniq(visits.map(v => [v.questionnaireId, v.questionnaire?.title || '']));
  const os = uniq(visits.map(v => [v.orientadorUid, v.orientadorName || '']));
  const ms = uniq(visits.filter(v => v.municipality).map(v => [`${v.municipality}/${v.uf}`, `${v.municipality}/${v.uf}`]));
  const sel = (name, label, opts, all) => `
    <label>${label}<select name="${name}">
      ${all ? `<option value="">${all}</option>` : ''}
      ${opts.map(([v, l]) => `<option value="${esc(v)}" ${f[name] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
    </select></label>`;
  return `
    <form class="filters" id="filters">
      ${sel('period', 'Período', PERIODS)}
      ${sel('questionnaire', 'Questionário', qs, 'Todos')}
      ${sel('orientador', 'Orientador', os, 'Todos')}
      ${sel('municipio', 'Município', ms, 'Todos')}
      ${showStatus ? sel('status', 'Situação', [['andamento', 'Em andamento'], ['finalizada', 'Finalizadas']], 'Todas') : ''}
    </form>`;
}

export function bindFilters(root, f, onChange) {
  root.querySelector('#filters').onchange = e => {
    f[e.target.name] = e.target.value;
    saveFilters(f);
    onChange();
  };
}

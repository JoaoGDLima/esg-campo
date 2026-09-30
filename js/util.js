export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

export const nowIso = () => new Date().toISOString();

export function fmtDate(iso, withTime = true) {
  if (!iso) return '';
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : d.toLocaleDateString('pt-BR');
}

export function fmtDay(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const [y, m, d] = yyyyMmDd.split('-');
  return `${d}/${m}/${y}`;
}

export const pct = (n) => (n == null ? '—' : Math.round(n * 100) + '%');

export const PILLARS = { E: 'Ambiental', S: 'Social', G: 'Governança' };

export const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

let toastTimer;
export function toast(msg, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3200);
}

export function debounce(fn, ms = 400) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function download(filename, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function slug(text) {
  return String(text || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'arquivo';
}

export const today = () => new Date().toISOString().slice(0, 10);

// Limpeza ao sair de uma tela (listeners globais, etc.).
let leaveFn = null, flushFn = null;
export function onLeave(fn) { leaveFn = fn; }
// Grava dados pendentes (ao trocar de tela ou quando o app vai para segundo plano).
export function onFlush(fn) { flushFn = fn; }
export function flush() { try { flushFn?.(); } catch (e) { console.error(e); } }
export function runLeave() {
  flush();
  flushFn = null;
  try { leaveFn?.(); } finally { leaveFn = null; }
}

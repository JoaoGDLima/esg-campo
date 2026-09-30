import { db, getSettings, saveSettings, STORES } from './db.js';
import { $, $$, esc, fmtDate, toast, download, pct, runLeave, flush, today } from './util.js';
import { computeScores, progress, scoreClass } from './scoring.js';
import { revokeObjectUrls } from './media.js';
import { newVisit, fillVisit, closeVisit, report } from './field.js';
import { propertiesList, propertyForm } from './properties.js';
import { adminHome, adminEditor, importQuestionnaireFile } from './admin.js';
import { csvAnswers, csvSummary, exportBackup, importBackup } from './export.js';

/* ---------------- Início: lista de visitas ---------------- */

async function home(app) {
  const visits = (await db.all('visits')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const open = visits.filter(v => v.status !== 'finalizada');
  const done = visits.filter(v => v.status === 'finalizada');
  const scores = done.map(v => computeScores(v.questionnaire, v.answers).overall).filter(s => s != null);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const card = (v) => {
    const p = v.property || {};
    let right;
    if (v.status === 'finalizada') {
      const s = computeScores(v.questionnaire, v.answers);
      right = `<span class="score-chip ${scoreClass(s.overall, s.critical.length)}" title="${s.critical.length ? 'Possui pendência crítica' : ''}">${s.critical.length ? '⚠ ' : ''}${pct(s.overall)}</span>`;
    } else {
      const pr = progress(v.questionnaire, v.answers);
      right = `<span class="muted small">${pr.answered}/${pr.total}</span>`;
    }
    return `<a class="item" href="#/visita/${v.id}" data-search="${esc([p.name, p.producer, p.municipality, v.questionnaire.title].join(' ').toLowerCase())}">
      <div><b>${esc(p.name)}</b><small>${esc(p.producer)} · ${fmtDate(v.startedAt)}</small><small class="muted">${esc(v.questionnaire.title)}</small></div>
      ${right}</a>`;
  };

  app.innerHTML = `
    <div class="row between"><h1>Visitas</h1><a class="btn primary" href="#/visita/nova">+ Nova visita</a></div>
    <div class="stats">
      <div><span>${visits.length}</span><small>visitas</small></div>
      <div><span>${done.length}</span><small>finalizadas</small></div>
      <div><span>${pct(avg)}</span><small>conformidade média</small></div>
    </div>
    ${visits.length > 4 ? '<input type="search" id="q" class="search" placeholder="Buscar visita por produtor, propriedade…">' : ''}
    ${open.length ? `<h2>Em andamento</h2><div class="list">${open.map(card).join('')}</div>` : ''}
    <h2>Finalizadas</h2>
    <div class="list">${done.length ? done.map(card).join('') : '<div class="card empty">Nenhuma visita finalizada ainda.</div>'}</div>`;

  app.oninput = e => {
    if (e.target.id !== 'q') return;
    const t = e.target.value.toLowerCase();
    $$('[data-search]', app).forEach(el => { el.hidden = t && !el.dataset.search.includes(t); });
  };
}

/* ---------------- Ajustes ---------------- */

async function config(app) {
  const settings = await getSettings();
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);

  app.innerHTML = `
    <h1>Ajustes</h1>
    <form id="f" class="card stack">
      <h2>Identificação</h2>
      <label>Nome do orientador<input name="orientador" value="${esc(settings.orientador)}"></label>
      <label>Instituição / programa <small class="muted">(aparece no relatório)</small><input name="org" value="${esc(settings.org)}"></label>
      <button class="btn primary">Salvar</button>
    </form>

    <div class="card stack">
      <h2>Questionários</h2>
      <p class="small muted">Recebeu um arquivo de questionário do administrador? Importe aqui.</p>
      <label class="btn">Importar questionário (.json)<input type="file" accept=".json,application/json" data-file="questionnaire" hidden></label>
    </div>

    <div class="card stack">
      <h2>Exportar dados</h2>
      <p class="small muted">Planilhas CSV (abrem no Excel) com todas as visitas deste aparelho.</p>
      <div class="row wrap gap">
        <button type="button" class="btn" data-act="csv-summary">CSV – resumo por visita</button>
        <button type="button" class="btn" data-act="csv-answers">CSV – todas as respostas</button>
      </div>
    </div>

    <div class="card stack">
      <h2>Backup</h2>
      <p class="small muted">Os dados ficam só neste aparelho. Faça backup com frequência — o arquivo inclui fotos e assinaturas
      e pode ser restaurado aqui ou em outro aparelho.</p>
      <div class="row wrap gap">
        <button type="button" class="btn primary" data-act="backup">Baixar backup completo</button>
        <label class="btn ghost">Restaurar backup…<input type="file" accept=".json,application/json" data-file="backup" hidden></label>
      </div>
      <p class="small muted">${est ? `Espaço usado: ${(est.usage / 1048576).toFixed(1)} MB. ` : ''}
        ${persisted ? 'Armazenamento persistente ativo.' : 'O navegador pode liberar espaço automaticamente — instale o app na tela inicial e faça backups.'}</p>
    </div>

    <div class="card stack">
      <h2>Zona de perigo</h2>
      <button type="button" class="btn danger" data-act="wipe">Apagar todos os dados deste aparelho</button>
    </div>
    <p class="center small muted">ESG Campo · funciona offline</p>`;

  $('#f').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await saveSettings({ ...settings, orientador: fd.get('orientador').trim(), org: fd.get('org').trim() });
    toast('Ajustes salvos');
  };

  app.onchange = async e => {
    const kind = e.target.dataset.file;
    if (!kind) return;
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      if (kind === 'questionnaire') {
        toast(`Questionário “${await importQuestionnaireFile(text)}” disponível para novas visitas`);
      } else {
        const r = await importBackup(text);
        toast(`Backup restaurado: ${r.visits} visita(s), ${r.properties} propriedade(s), ${r.photos} foto(s)`);
      }
    } catch (err) { toast(err.message, 'bad'); }
  };

  app.onclick = async e => {
    const act = e.target.closest('button[data-act]')?.dataset.act;
    if (!act) return;
    const visits = await db.all('visits');
    if (act === 'csv-summary' || act === 'csv-answers') {
      if (!visits.length) return toast('Nenhuma visita para exportar.', 'bad');
      const csv = act === 'csv-summary' ? csvSummary(visits) : csvAnswers(visits);
      download(`esg-${act === 'csv-summary' ? 'resumo' : 'respostas'}-${today()}.csv`, csv, 'text/csv;charset=utf-8');
    }
    if (act === 'backup') {
      toast('Gerando backup…');
      download(`esg-backup-${today()}.json`, await exportBackup(), 'application/json');
    }
    if (act === 'wipe') {
      if (!confirm('Apagar TODAS as visitas, propriedades, fotos e questionários deste aparelho?')) return;
      if (prompt('Esta ação não pode ser desfeita. Digite APAGAR para confirmar.') !== 'APAGAR') return;
      for (const s of STORES) await db.clear(s);
      sessionStorage.clear();
      toast('Dados apagados');
      location.hash = '#/';
    }
  };
}

/* ---------------- Roteamento ---------------- */

const routes = [
  [/^#?\/?$/, home, 'home'],
  [/^#\/visita\/nova$/, newVisit, 'home'],
  [/^#\/visita\/([\w-]+)\/fechar$/, closeVisit, 'home'],
  [/^#\/visita\/([\w-]+)\/relatorio$/, report, 'home'],
  [/^#\/visita\/([\w-]+)$/, fillVisit, 'home'],
  [/^#\/propriedades$/, propertiesList, 'propriedades'],
  [/^#\/propriedades\/([\w-]+)$/, propertyForm, 'propriedades'],
  [/^#\/admin$/, adminHome, 'admin'],
  [/^#\/admin\/q\/([\w-]+)$/, adminEditor, 'admin'],
  [/^#\/config$/, config, 'config'],
];

async function render() {
  const hash = location.hash || '#/';
  const route = routes.find(([re]) => re.test(hash));
  if (!route) { location.replace('#/'); return; }
  const [re, view, nav] = route;
  const app = $('#app');
  runLeave();
  revokeObjectUrls();
  app.onclick = app.oninput = app.onchange = null;
  $$('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
  window.scrollTo(0, 0);
  try {
    await view(app, ...hash.match(re).slice(1));
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="card alert bad"><b>Erro:</b> ${esc(err.message)}</div><a class="btn" href="#/">Voltar ao início</a>`;
  }
}

window.addEventListener('hashchange', render);

// Salva o que estiver pendente se o app for fechado ou ir para segundo plano.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

// Ampliar fotos ao tocar.
document.addEventListener('click', e => {
  const img = e.target.closest('img[data-zoom]');
  if (img) {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `<img src="${img.src}" alt="Foto ampliada">`;
    box.onclick = () => box.remove();
    document.body.append(box);
  }
});

function updateNet() {
  const el = $('#net');
  el.textContent = navigator.onLine ? 'online' : 'offline';
  el.className = 'net ' + (navigator.onLine ? 'on' : 'off');
}
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);
updateNet();

// Pede ao navegador para não apagar os dados locais.
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW não registrado', err));
}

render();

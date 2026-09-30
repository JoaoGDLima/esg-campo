// Painel de acompanhamento: atualiza em tempo real conforme os orientadores sincronizam.
import * as fb from '../../shared/firebase.js';
import { $, esc, fmtDate, pct, PILLARS, onLeave } from '../../shared/util.js';
import { classify, questionScore } from '../../shared/scoring.js';
import { watchVisits, getFilters, applyFilters, filterBarHTML, bindFilters, tsDate } from './data.js';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nf = new Intl.NumberFormat('pt-BR');

// Classificação = estado (status), sempre com rótulo + ícone, nunca só a cor.
const CLASSES = [
  { key: 'Alta conformidade', color: 'var(--status-good)', icon: '●' },
  { key: 'Conformidade parcial', color: 'var(--status-warning)', icon: '◐' },
  { key: 'Baixa conformidade', color: 'var(--status-serious)', icon: '○' },
  { key: 'Pendência crítica', color: 'var(--status-critical)', icon: '⚠' },
];
const classOf = (v) => classify(v.scores?.overall ?? null, v.scores?.critical || 0);

/* ---------------- Cálculos ---------------- */

function summarize(visits) {
  const done = visits.filter(v => v.status === 'finalizada');
  const scored = done.filter(v => v.scores?.overall != null);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const pillars = Object.keys(PILLARS).map(p => {
    const vals = done.map(v => v.scores?.[p]).filter(x => x != null);
    return { key: p, label: PILLARS[p], value: avg(vals), n: vals.length };
  });

  const byClass = CLASSES.map(c => ({ ...c, value: done.filter(v => classOf(v) === c.key).length }));

  // Não conformidades mais frequentes (entre visitas finalizadas).
  const nc = new Map();
  for (const v of done) {
    for (const s of v.questionnaire?.sections || []) for (const q of s.questions) {
      const sc = questionScore(q, v.answers?.[q.id]?.value);
      if (sc === null) continue; // sem resposta, N.A. ou pergunta sem pontuação
      const row = nc.get(q.text) || { label: q.text, pillar: s.pillar, critical: q.critical, evaluated: 0, value: 0 };
      row.evaluated++;
      if (sc < 1) row.value++;
      nc.set(q.text, row);
    }
  }
  const topNc = [...nc.values()].filter(r => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 10);

  // Visitas por mês (últimos meses do filtro, máx. 12).
  const months = new Map();
  for (const v of visits) {
    const d = new Date(v.startedAt);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m = months.get(k) || { key: k, label: `${MONTHS[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, done: 0, open: 0 };
    v.status === 'finalizada' ? m.done++ : m.open++;
    months.set(k, m);
  }
  const monthly = [...months.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-12);

  // Por orientador.
  const people = new Map();
  for (const v of visits) {
    const p = people.get(v.orientadorUid) || { name: v.orientadorName, total: 0, done: 0, scores: [], last: null };
    p.total++;
    if (v.status === 'finalizada') { p.done++; if (v.scores?.overall != null) p.scores.push(v.scores.overall); }
    const t = tsDate(v.syncedAt);
    if (t && (!p.last || t > p.last)) p.last = t;
    people.set(v.orientadorUid, p);
  }

  return {
    total: visits.length, done: done.length, open: visits.length - done.length,
    properties: new Set(visits.map(v => v.propertyId)).size,
    avg: avg(scored.map(v => v.scores.overall)),
    criticalShare: done.length ? done.filter(v => v.scores?.critical > 0).length / done.length : null,
    toReview: done.filter(v => !v.review || v.review.status === 'pendente').length,
    pillars, byClass, topNc, monthly,
    people: [...people.values()].map(p => ({ ...p, avg: avg(p.scores) })).sort((a, b) => b.total - a.total),
  };
}

/* ---------------- Componentes de gráfico ---------------- */

const tipAttr = (title, rows) => `data-tip="${esc(JSON.stringify({ title, rows }))}" tabindex="0"`;

// Barras horizontais (uma série). Valor na ponta da barra; rótulos em cor de texto.
function hbars(rows, { format = (v) => nf.format(v), max, color = 'var(--series-1)', swatch = false } = {}) {
  const top = max ?? Math.max(1, ...rows.map(r => r.value || 0));
  return `<div class="hbars">${rows.map(r => {
    const w = r.value == null ? 0 : Math.max(0, Math.min(100, (r.value / top) * 100));
    const fill = r.color || color;
    return `<div class="hbar" ${tipAttr(r.label, [[r.tipLabel || 'Valor', r.value == null ? '—' : format(r.value), fill]])}>
      <span class="hbar-label">${swatch ? `<i class="swatch" style="background:${fill}"></i>` : ''}${r.prefix || ''}${esc(r.label)}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${w}%;${w > 0 ? 'min-width:2px;' : ''}background:${fill}"></span>
        <span class="hbar-val">${r.value == null ? '—' : format(r.value)}</span></span>
    </div>`;
  }).join('')}</div>`;
}

const niceMax = (n) => {
  if (n <= 5) return Math.max(1, Math.ceil(n));
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(x => x >= n);
};

// Colunas empilhadas: finalizadas + em andamento por mês.
function stackedColumns(months) {
  if (!months.length) return '<p class="muted small">Sem visitas no período.</p>';
  const top = niceMax(Math.max(...months.map(m => m.done + m.open)));
  const ticks = [0, top / 2, top].filter(Number.isInteger); // contagens: só marcas inteiras
  return `
    <div class="legend">
      <span><i class="swatch" style="background:var(--series-1)"></i>Finalizadas</span>
      <span><i class="swatch" style="background:var(--series-2)"></i>Em andamento</span>
    </div>
    <div class="cols">
      <div class="cols-grid">${ticks.map(t => `<div class="gridline" style="bottom:${(t / top) * 100}%"><span>${nf.format(t)}</span></div>`).join('')}</div>
      <div class="cols-plot">${months.map(m => {
        const total = m.done + m.open;
        return `<div class="col" ${tipAttr(m.label, [['Finalizadas', nf.format(m.done), 'var(--series-1)'], ['Em andamento', nf.format(m.open), 'var(--series-2)'], ['Total', nf.format(total), '']])}>
          <div class="col-bar" style="height:${(total / top) * 100}%">
            ${m.open ? `<span class="seg" style="flex:${m.open};background:var(--series-2)"></span>` : ''}
            ${m.done ? `<span class="seg" style="flex:${m.done};background:var(--series-1)"></span>` : ''}
          </div>
          <span class="col-label">${esc(m.label)}</span>
        </div>`;
      }).join('')}</div>
    </div>`;
}

function dataTable(head, rows) {
  return `<details class="table-view"><summary>Ver dados em tabela</summary>
    <table class="data compact"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
}

/* ---------------- Tooltip ---------------- */

function bindTooltip(root) {
  const tip = $('#tip');
  const show = (el, x, y) => {
    const d = JSON.parse(el.dataset.tip);
    tip.replaceChildren();
    const t = document.createElement('div'); t.className = 'tip-title'; t.textContent = d.title; tip.append(t);
    for (const [label, value, color] of d.rows) {
      const row = document.createElement('div'); row.className = 'tip-row';
      const key = document.createElement('i'); key.className = 'tip-key'; if (color) key.style.background = color;
      const v = document.createElement('b'); v.textContent = value;
      const l = document.createElement('span'); l.textContent = label;
      row.append(key, v, l); tip.append(row);
    }
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - r.width - 8, x + 14) + 'px';
    tip.style.top = Math.max(8, y - r.height - 10) + 'px';
  };
  const onFocusIn = e => {
    const el = e.target.closest?.('[data-tip]');
    if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); }
  };
  const hide = () => { tip.hidden = true; };
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', hide);
  root.onpointermove = e => {
    const el = e.target.closest('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else tip.hidden = true;
  };
  root.onpointerleave = hide;
  return () => {
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', hide);
    root.onpointermove = root.onpointerleave = null;
    hide();
  };
}

/* ---------------- Mapa ---------------- */

let leafletPromise;
const loadLeaflet = () => (leafletPromise ||= new Promise((res, rej) => {
  if (window.L) return res(window.L);
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  s.crossOrigin = '';
  s.onload = () => res(window.L); s.onerror = () => { leafletPromise = null; rej(new Error('Mapa indisponível')); };
  document.head.append(s);
}));

async function drawMap(el, visits) {
  const pts = visits.filter(v => v.gps?.lat != null);
  if (!pts.length) { el.innerHTML = '<p class="muted small center pad">Nenhuma visita com GPS no período.</p>'; return null; }
  const L = await loadLeaflet();
  const map = L.map(el, { scrollWheelZoom: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '© OpenStreetMap',
  }).addTo(map);
  // Marcador = cor + ícone da classificação (a cor nunca carrega o significado sozinha).
  const iconOf = (v) => {
    const c = v.status === 'finalizada' ? CLASSES.find(c => c.key === classOf(v)) : null;
    const color = c ? c.color : 'var(--ink-muted)';
    return L.divIcon({
      className: '', iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -10],
      html: `<span class="mk" style="--c:${color}">${c ? c.icon : '…'}</span>`,
    });
  };
  const layer = L.featureGroup(pts.map(v => L.marker([v.gps.lat, v.gps.lng], {
    icon: iconOf(v), keyboard: true, title: `${v.propertyName} – ${v.status === 'finalizada' ? classOf(v) : 'Em andamento'}`,
  }).bindPopup(() => {
    const div = document.createElement('div');
    const b = document.createElement('b'); b.textContent = v.propertyName;
    const p = document.createElement('div');
    p.textContent = `${v.producer} · ${v.status === 'finalizada' ? `${pct(v.scores?.overall)} – ${classOf(v)}` : 'Em andamento'}`;
    const a = document.createElement('a'); a.href = `#/visitas/${v.id}`; a.textContent = 'Abrir visita';
    div.append(b, p, a);
    return div;
  }))).addTo(map);
  map.fitBounds(layer.getBounds().pad(0.2), { maxZoom: 12 });
  return map;
}

/* ---------------- Tela ---------------- */

export async function dashboard(app) {
  const f = getFilters();
  let all = null, map = null;
  app.innerHTML = '<p class="muted">Carregando painel…</p>';

  const draw = async () => {
    const visits = applyFilters(all, { ...f, status: '' });
    const s = summarize(visits);
    if (map) { map.remove(); map = null; }
    app.innerHTML = `
      <div class="row between wrap"><h1>Painel de acompanhamento</h1>
        <span class="muted small live">● Ao vivo</span></div>
      ${filterBarHTML(all, f, { showStatus: false })}

      <section class="tiles">
        <div class="tile hero">
          <span class="tile-label">Índice médio de conformidade</span>
          <span class="tile-value">${pct(s.avg)}</span>
          <span class="tile-sub">${s.done} visita(s) finalizada(s)</span>
        </div>
        <div class="tile"><span class="tile-label">Visitas</span><span class="tile-value">${nf.format(s.total)}</span>
          <span class="tile-sub">${nf.format(s.properties)} propriedade(s)</span></div>
        <div class="tile"><span class="tile-label">Em andamento</span><span class="tile-value">${nf.format(s.open)}</span>
          <span class="tile-sub">sendo preenchidas em campo</span></div>
        <div class="tile"><span class="tile-label">Com pendência crítica</span><span class="tile-value">${pct(s.criticalShare)}</span>
          <span class="tile-sub">das finalizadas</span></div>
        <a class="tile link" href="#/visitas"><span class="tile-label">Aguardando revisão</span><span class="tile-value">${nf.format(s.toReview)}</span>
          <span class="tile-sub">ver visitas →</span></a>
      </section>

      <section class="dash-grid">
        <div class="card">
          <h2>Visitas por mês</h2>
          ${stackedColumns(s.monthly)}
          ${dataTable(['Mês', 'Finalizadas', 'Em andamento'], s.monthly.map(m => [m.label, m.done, m.open]))}
        </div>
        <div class="card">
          <h2>Conformidade média por pilar</h2>
          ${hbars(s.pillars.map(p => ({ ...p, tipLabel: `Média (${p.n} visitas)` })), { max: 1, format: pct })}
          ${dataTable(['Pilar', 'Média', 'Visitas avaliadas'], s.pillars.map(p => [p.label, pct(p.value), p.n]))}
        </div>
        <div class="card">
          <h2>Classificação das visitas finalizadas</h2>
          ${hbars(s.byClass.map(c => ({ label: c.key, value: c.value, color: c.color, prefix: `<span class="status-icon" style="color:${c.color}" aria-hidden="true">${c.icon}</span> `, tipLabel: 'Visitas' })))}
          ${dataTable(['Classificação', 'Visitas'], s.byClass.map(c => [c.key, c.value]))}
        </div>
        <div class="card">
          <h2>Mapa das visitas</h2>
          <div id="map" class="map"></div>
          <div class="legend small">
            ${CLASSES.map(c => `<span><span class="mk" style="--c:${c.color}">${c.icon}</span>${c.key}</span>`).join('')}
            <span><span class="mk" style="--c:var(--ink-muted)">…</span>Em andamento</span>
          </div>
        </div>
        <div class="card span2">
          <h2>Não conformidades mais frequentes</h2>
          ${s.topNc.length ? hbars(s.topNc.map(r => ({
            label: r.label, value: r.value, tipLabel: `de ${r.evaluated} visitas avaliadas`,
            prefix: `<span class="pillar-tag pillar-${r.pillar}">${r.pillar}</span> ${r.critical ? '<span class="badge crit">Crítica</span> ' : ''}`,
          }))) : '<p class="muted small">Nenhuma não conformidade registrada no período.</p>'}
          ${dataTable(['Item', 'Pilar', 'Não conformes', 'Avaliadas'], s.topNc.map(r => [r.label, r.pillar, r.value, r.evaluated]))}
        </div>
        <div class="card span2 flush">
          <h2 class="pad-h">Orientadores</h2>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Orientador</th><th class="num">Visitas</th><th class="num">Finalizadas</th><th class="num">Em andamento</th><th class="num">Índice médio</th><th>Última sincronização</th></tr></thead>
            <tbody>${s.people.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${p.total}</td><td class="num">${p.done}</td>
              <td class="num">${p.total - p.done}</td><td class="num">${pct(p.avg)}</td><td>${p.last ? fmtDate(p.last) : '—'}</td></tr>`).join('')
              || '<tr><td colspan="6" class="center muted">Sem visitas no período.</td></tr>'}</tbody>
          </table></div>
        </div>
      </section>`;
    bindFilters(app, f, draw);
    map = await drawMap($('#map'), visits).catch(err => { $('#map').innerHTML = `<p class="muted small pad">${esc(err.message)}</p>`; return null; });
  };

  const unbindTip = bindTooltip(app);
  const stop = watchVisits((visits, err) => {
    if (err) { app.innerHTML = `<div class="card alert bad">${esc(fb.errorMessage(err))}</div>`; return; }
    all = visits;
    // Mantém a tela enquanto o usuário interage com filtros.
    if (!document.activeElement?.closest?.('#filters')) draw();
  });
  onLeave(() => { stop(); if (map) map.remove(); unbindTip(); });
}

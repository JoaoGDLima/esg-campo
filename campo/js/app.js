import { db, STORES, getSession, setSession, getMeta, isPending, myVisits } from './db.js';
import { $, $$, esc, fmtDate, toast, download, pct, runLeave, flush, today, debounce } from '../../shared/util.js';
import { computeScores, progress, scoreClass } from '../../shared/scoring.js';
import { csvAnswers, csvSummary } from '../../shared/csv.js';
import { revokeObjectUrls } from './media.js';
import { newVisit, fillVisit, closeVisit, report } from './field.js';
import { propertiesList, propertyForm } from './properties.js';
import { syncNow, syncState, refreshPending, countPending, loadFirebase, restoreFromServer } from './sync.js';

/* ---------------- Login ---------------- */

async function loginView(app) {
  document.body.classList.add('logged-out');
  app.innerHTML = `
    <div class="narrow center-block">
      <h1>Entrar</h1>
      <p class="muted">Use o e-mail e a senha fornecidos pelo administrador. O primeiro acesso precisa de internet;
      depois o app funciona offline.</p>
      <form id="f" class="card stack">
        <label>E-mail<input type="email" name="email" required autocomplete="username"></label>
        <label>Senha<input type="password" name="pw" required autocomplete="current-password"></label>
        <button class="btn primary block">Entrar</button>
        <button type="button" class="linklike small" data-act="reset">Esqueci minha senha</button>
      </form>
    </div>`;

  const form = $('#f');
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('button.primary');
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      if (!navigator.onLine) throw new Error('Conecte-se à internet para o primeiro acesso.');
      const fb = await loadFirebase();
      fb.assertConfigured();
      const cred = await fb.signInWithEmailAndPassword(fb.auth, form.email.value.trim(), form.pw.value);
      const profile = await fb.getProfile(cred.user.uid);
      const problem = fb.profileProblem(profile, 'orientador');
      if (problem) {
        await fb.signOut(fb.auth);
        throw new Error(problem);
      }
      await setSession({ uid: profile.uid, email: cred.user.email, name: profile.name, role: profile.role });
      document.body.classList.remove('logged-out');
      toast(`Bem-vindo(a), ${profile.name}!`);
      location.hash = '#/';
      render();
      const r = await syncNow();
      if (r.ok && !(await myVisits()).length) {
        const got = await restoreFromServer().catch(() => ({ visits: 0 }));
        if (got.visits) { toast(`${got.visits} visita(s) recuperada(s) do servidor`); render(); }
      }
    } catch (err) {
      const fb = await loadFirebase().catch(() => null);
      toast(fb ? fb.errorMessage(err) : err.message, 'bad');
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  };

  app.onclick = async e => {
    if (!e.target.closest('[data-act=reset]')) return;
    const email = form.email.value.trim();
    if (!email) return toast('Digite seu e-mail primeiro.', 'bad');
    try {
      const fb = await loadFirebase();
      await fb.sendPasswordResetEmail(fb.auth, email);
      toast('Enviamos um e-mail para redefinir a senha.');
    } catch (err) { toast(err.message, 'bad'); }
  };
}

/* ---------------- Início: lista de visitas ---------------- */

async function home(app) {
  const visits = (await myVisits()).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
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
    const sync = isPending(v)
      ? '<span class="sync-dot pending" title="Aguardando envio">↑</span>'
      : '<span class="sync-dot ok" title="Enviada ao servidor">✓</span>';
    return `<a class="item" href="#/visita/${v.id}" data-search="${esc([p.name, p.producer, p.municipality, v.questionnaire.title].join(' ').toLowerCase())}">
      <div><b>${esc(p.name)}</b><small>${esc(p.producer)} · ${fmtDate(v.startedAt)}</small><small class="muted">${esc(v.questionnaire.title)}</small></div>
      <div class="row">${right}${sync}</div></a>`;
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

/* ---------------- Sincronização e conta ---------------- */

async function account(app) {
  const session = await getSession();
  const [pending, lastSync] = await Promise.all([countPending(), getMeta('lastSync')]);
  const est = await navigator.storage?.estimate?.().catch(() => null);

  app.innerHTML = `
    <h1>Sincronização</h1>
    <div class="card stack">
      <div class="sync-summary ${pending ? 'pending' : 'ok'}">
        <span class="big">${pending ? '↑ ' + pending : '✓'}</span>
        <span>${pending ? 'item(ns) aguardando envio' : 'Tudo enviado ao servidor'}</span>
      </div>
      <p class="small muted">Última sincronização: ${lastSync ? fmtDate(lastSync) : 'nunca'}
        ${syncState.error ? `<br><span class="warn-text">Último erro: ${esc(syncState.error)}</span>` : ''}</p>
      ${syncState.needLogin ? '<button type="button" class="btn" data-act="relogin">Entrar novamente</button>' : ''}
      <button type="button" class="btn primary block" data-act="sync" ${navigator.onLine ? '' : 'disabled'}>
        ${navigator.onLine ? 'Sincronizar agora' : 'Sem internet — os dados ficam guardados no aparelho'}</button>
      <p class="small muted">A sincronização acontece sozinha sempre que há internet: ao abrir o app, ao finalizar uma visita
      e a cada poucos minutos. Visitas em andamento também são enviadas, para a coordenação acompanhar o progresso.</p>
    </div>

    <div class="card stack">
      <h2>Conta</h2>
      <p><b>${esc(session.name)}</b><br><span class="muted small">${esc(session.email)}</span></p>
      <button type="button" class="btn ghost" data-act="restore">Baixar minhas visitas do servidor</button>
      <button type="button" class="btn danger ghost" data-act="logout">Sair da conta</button>
    </div>

    <div class="card stack">
      <h2>Exportar (deste aparelho)</h2>
      <div class="row wrap gap">
        <button type="button" class="btn" data-act="csv-summary">CSV – resumo</button>
        <button type="button" class="btn" data-act="csv-answers">CSV – respostas</button>
      </div>
      ${est ? `<p class="small muted">Espaço usado no aparelho: ${(est.usage / 1048576).toFixed(1)} MB.</p>` : ''}
    </div>
    <p class="center small muted">ESG Campo · funciona offline</p>`;

  app.onclick = async e => {
    const act = e.target.closest('button[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'sync') {
      e.target.disabled = true; e.target.textContent = 'Sincronizando…';
      const r = await syncNow();
      toast(r.ok ? 'Sincronização concluída' : r.error, r.ok ? 'ok' : 'bad');
      account(app);
    }
    if (act === 'relogin') {
      if (!confirm('Entrar novamente? Os dados deste aparelho são mantidos.')) return;
      await db.del('meta', 'session');
      render();
    }
    if (act === 'restore') {
      try {
        toast('Buscando visitas no servidor…');
        const r = await restoreFromServer();
        toast(r.visits ? `${r.visits} visita(s) e ${r.photos} foto(s) recuperadas` : 'Nenhuma visita nova no servidor.');
      } catch (err) { toast(err.message, 'bad'); }
    }
    if (act === 'logout') await logout();
    if (act === 'csv-summary' || act === 'csv-answers') {
      const visits = await myVisits();
      if (!visits.length) return toast('Nenhuma visita para exportar.', 'bad');
      const csv = act === 'csv-summary' ? csvSummary(visits) : csvAnswers(visits);
      download(`esg-${act === 'csv-summary' ? 'resumo' : 'respostas'}-${today()}.csv`, csv, 'text/csv;charset=utf-8');
    }
  };
}

async function logout() {
  const pending = await countPending();
  if (pending) {
    if (!navigator.onLine) return toast(`Há ${pending} item(ns) não enviados. Conecte-se à internet e sincronize antes de sair.`, 'bad');
    toast('Enviando dados pendentes…');
    const r = await syncNow();
    if (!r.ok || await countPending()) {
      const left = await countPending();
      if (prompt(`${left} item(ns) NÃO foram enviados e serão PERDIDOS se você sair.\nDigite SAIR para sair mesmo assim.`) !== 'SAIR') return;
    }
  } else if (!confirm('Sair da conta? Os dados deste aparelho serão removidos (já estão salvos no servidor).')) return;

  for (const s of STORES) await db.clear(s);
  const fb = await loadFirebase().catch(() => null);
  if (fb?.auth) await fb.signOut(fb.auth).catch(() => {});
  location.hash = '#/';
  render();
}

/* ---------------- Status de sincronização no topo ---------------- */

function paintSyncBadge() {
  const el = $('#sync');
  if (!el) return;
  const { running, pending, error } = syncState;
  let text, cls;
  if (running) { text = '⟳ Sincronizando'; cls = 'run'; }
  else if (!navigator.onLine) { text = pending ? `offline · ${pending} pendente(s)` : 'offline'; cls = 'off'; }
  else if (pending) { text = `↑ ${pending} pendente(s)`; cls = error ? 'err' : 'pend'; }
  else { text = '✓ Sincronizado'; cls = 'ok'; }
  el.textContent = text;
  el.className = 'net ' + cls;
}
document.addEventListener('esg:sync', paintSyncBadge);
window.addEventListener('online', () => { paintSyncBadge(); autoSync(); });
window.addEventListener('offline', paintSyncBadge);

async function autoSync() {
  if (!navigator.onLine || !(await getSession())) return;
  const before = syncState.pending;
  const r = await syncNow();
  if (r.ok && before && !syncState.pending) toast('Dados enviados ao servidor');
}
// Toda alteração local agenda uma sincronização alguns segundos depois.
const scheduleSync = debounce(autoSync, 8000);
document.addEventListener('esg:changed', () => { refreshPending(); scheduleSync(); });
setInterval(autoSync, 5 * 60 * 1000);

/* ---------------- Roteamento ---------------- */

const routes = [
  [/^#?\/?$/, home, 'home'],
  [/^#\/visita\/nova$/, newVisit, 'home'],
  [/^#\/visita\/([\w-]+)\/fechar$/, closeVisit, 'home'],
  [/^#\/visita\/([\w-]+)\/relatorio$/, report, 'home'],
  [/^#\/visita\/([\w-]+)$/, fillVisit, 'home'],
  [/^#\/propriedades$/, propertiesList, 'propriedades'],
  [/^#\/propriedades\/([\w-]+)$/, propertyForm, 'propriedades'],
  [/^#\/sync$/, account, 'sync'],
];

async function render() {
  const hash = location.hash || '#/';
  const app = $('#app');
  runLeave();
  revokeObjectUrls();
  app.onclick = app.oninput = app.onchange = null;
  window.scrollTo(0, 0);

  if (!(await getSession())) return loginView(app);
  document.body.classList.remove('logged-out');

  const route = routes.find(([re]) => re.test(hash));
  if (!route) { location.replace('#/'); return; }
  const [re, view, nav] = route;
  $$('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
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

// Pede ao navegador para não apagar os dados locais.
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW não registrado', err));
}

await render();
await refreshPending();
autoSync();

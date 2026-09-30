// Painel administrativo (online). Consulta e altera o Firestore diretamente.
import * as fb from '../../shared/firebase.js';
import { $, $$, esc, toast, runLeave } from '../../shared/util.js';
import { dashboard } from './dashboard.js';
import { visitsList, visitDetail } from './visits.js';
import { questionnairesList, questionnaireEditor } from './questionnaires.js';
import { usersView } from './users.js';

export let profile = null;

function setupNeeded(app) {
  app.innerHTML = `
    <div class="card narrow center-block stack">
      <h1>Firebase não configurado</h1>
      <p>Preencha o arquivo <code>shared/firebase-config.js</code> com os dados do seu projeto Firebase.
      O passo a passo está em <code>FIREBASE.md</code>.</p>
    </div>`;
}

function loginView(app, message = '') {
  document.body.classList.add('logged-out');
  app.innerHTML = `
    <div class="narrow center-block">
      <h1>Painel administrativo</h1>
      ${message ? `<div class="card alert bad">${esc(message)}</div>` : ''}
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
    const btn = form.querySelector('.primary');
    btn.disabled = true;
    try {
      await fb.signInWithEmailAndPassword(fb.auth, form.email.value.trim(), form.pw.value);
      // onAuthStateChanged continua o fluxo
    } catch (err) {
      toast(fb.errorMessage(err), 'bad');
      btn.disabled = false;
    }
  };
  app.onclick = async e => {
    if (!e.target.closest('[data-act=reset]')) return;
    if (!form.email.value) return toast('Digite seu e-mail primeiro.', 'bad');
    try { await fb.sendPasswordResetEmail(fb.auth, form.email.value.trim()); toast('E-mail de redefinição enviado.'); }
    catch (err) { toast(fb.errorMessage(err), 'bad'); }
  };
}

async function configView(app) {
  const ref = fb.doc(fb.fs, 'settings', 'app');
  const snap = await fb.getDoc(ref);
  const cfg = snap.exists() ? snap.data() : {};
  app.innerHTML = `
    <h1>Configurações</h1>
    <form id="f" class="card stack narrow">
      <label>Instituição / programa <small class="muted">(aparece no topo dos relatórios)</small>
        <input name="org" value="${esc(cfg.org)}"></label>
      <button class="btn primary">Salvar</button>
    </form>
    <div class="card small muted narrow">Os orientadores recebem esta configuração na próxima sincronização.</div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    await fb.setDoc(ref, { org: e.target.org.value.trim() }, { merge: true });
    toast('Configurações salvas');
  };
}

const routes = [
  [/^#?\/?$/, dashboard, 'dash'],
  [/^#\/visitas$/, visitsList, 'visitas'],
  [/^#\/visitas\/([\w-]+)$/, visitDetail, 'visitas'],
  [/^#\/questionarios$/, questionnairesList, 'questionarios'],
  [/^#\/questionarios\/([\w-]+)$/, questionnaireEditor, 'questionarios'],
  [/^#\/usuarios$/, usersView, 'usuarios'],
  [/^#\/config$/, configView, 'config'],
];

async function render() {
  const app = $('#app');
  runLeave();
  app.onclick = app.oninput = app.onchange = null;
  if (!profile) return;
  const hash = location.hash || '#/';
  const route = routes.find(([re]) => re.test(hash));
  if (!route) { location.replace('#/'); return; }
  const [re, view, nav] = route;
  $$('.adminnav a').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
  window.scrollTo(0, 0);
  try {
    await view(app, ...hash.match(re).slice(1));
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="card alert bad"><b>Erro:</b> ${esc(fb.errorMessage(err))}</div>`;
  }
}

window.addEventListener('hashchange', render);

if (!fb.configured) {
  setupNeeded($('#app'));
} else {
  fb.onAuthStateChanged(fb.auth, async user => {
    const app = $('#app');
    if (!user) { profile = null; $('#who').innerHTML = ''; return loginView(app); }
    try {
      const p = await fb.getProfile(user.uid);
      const problem = fb.profileProblem(p, 'admin');
      if (problem) {
        await fb.signOut(fb.auth);
        return loginView(app, problem);
      }
      profile = p;
      document.body.classList.remove('logged-out');
      $('#who').innerHTML = `<span>${esc(p.name)}</span> <button type="button" class="btn small ghost" id="logout">Sair</button>`;
      $('#logout').onclick = () => { runLeave(); fb.signOut(fb.auth); };
      render();
    } catch (err) {
      loginView(app, fb.errorMessage(err));
    }
  });
}

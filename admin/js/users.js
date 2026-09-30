// Usuários: o admin cadastra orientadores (e outros admins), ativa/desativa e envia redefinição de senha.
import * as fb from '../../shared/firebase.js';
import { $, esc, toast, fmtDate, nowIso } from '../../shared/util.js';
import { watchVisits, tsDate } from './data.js';

const ROLES = { orientador: 'Orientador', admin: 'Administrador' };

export async function usersView(app) {
  const [snap, visits] = await Promise.all([
    fb.getDocs(fb.collection(fb.fs, 'users')),
    new Promise(res => { const stop = watchVisits((v, err) => { if (v || err) { res(v || []); queueMicrotask(stop); } }); }),
  ]);
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const stats = {};
  for (const v of visits) {
    const s = (stats[v.orientadorUid] ||= { total: 0, done: 0, last: null });
    s.total++; if (v.status === 'finalizada') s.done++;
    const t = tsDate(v.syncedAt);
    if (t && (!s.last || t > s.last)) s.last = t;
  }
  const me = fb.auth.currentUser.uid;

  app.innerHTML = `
    <h1>Usuários</h1>
    <div class="users-grid">
      <div class="table-wrap card flush">
        <table class="data">
          <thead><tr><th>Nome</th><th>Perfil</th><th class="num">Visitas</th><th class="num">Finalizadas</th><th>Última sincronização</th><th>Situação</th><th></th></tr></thead>
          <tbody>${users.map(u => {
            const s = stats[u.uid] || { total: 0, done: 0 };
            return `<tr>
              <td><b>${esc(u.name)}</b><br><small class="muted">${esc(u.email)}</small></td>
              <td>${ROLES[u.role] || esc(u.role)}</td>
              <td class="num">${s.total}</td><td class="num">${s.done}</td>
              <td><small>${s.last ? fmtDate(s.last) : '—'}</small></td>
              <td>${u.active ? '<span class="badge ok">Ativo</span>' : '<span class="badge">Desativado</span>'}</td>
              <td class="row gap">
                <button type="button" class="btn small ghost" data-act="reset" data-uid="${u.uid}">Redefinir senha</button>
                ${u.uid === me ? '' : `<button type="button" class="btn small ghost ${u.active ? 'danger' : ''}" data-act="toggle" data-uid="${u.uid}">${u.active ? 'Desativar' : 'Ativar'}</button>`}
              </td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <form id="f" class="card stack">
        <h2>Novo usuário</h2>
        <label>Nome completo<input name="name" required></label>
        <label>E-mail<input type="email" name="email" required autocomplete="off"></label>
        <label>Senha inicial<input name="pw" required minlength="6" autocomplete="new-password"
          value="${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}"></label>
        <label>Perfil<select name="role"><option value="orientador">Orientador</option><option value="admin">Administrador</option></select></label>
        <button class="btn primary">Cadastrar</button>
        <p class="small muted">Informe a senha inicial ao usuário. Ele pode trocá-la pelo link “Esqueci minha senha”.
        Desativar bloqueia o acesso aos dados imediatamente; as visitas já enviadas são mantidas.</p>
      </form>
    </div>`;

  $('#f').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('.primary');
    btn.disabled = true;
    try {
      const email = f.email.value.trim();
      const newUid = await fb.createAccount(email, f.pw.value);
      await fb.setDoc(fb.doc(fb.fs, 'users', newUid), {
        name: f.name.value.trim(), email, role: f.role.value, active: true, createdAt: nowIso(),
      });
      toast(`${ROLES[f.role.value]} cadastrado. Senha inicial: ${f.pw.value}`);
      usersView(app);
    } catch (err) {
      toast(fb.errorMessage(err), 'bad');
      btn.disabled = false;
    }
  };

  app.onclick = async e => {
    const t = e.target.closest('button[data-act]');
    if (!t) return;
    const u = users.find(x => x.uid === t.dataset.uid);
    try {
      if (t.dataset.act === 'reset') {
        await fb.sendPasswordResetEmail(fb.auth, u.email);
        toast(`E-mail de redefinição enviado para ${u.email}`);
      }
      if (t.dataset.act === 'toggle') {
        if (u.active && !confirm(`Desativar ${u.name}? O acesso aos dados será bloqueado.`)) return;
        await fb.updateDoc(fb.doc(fb.fs, 'users', u.uid), { active: !u.active });
        usersView(app);
      }
    } catch (err) { toast(fb.errorMessage(err), 'bad'); }
  };
}

// Área do administrador: montar, publicar e distribuir questionários.
import { db, uid } from './db.js';
import { $, $$, esc, toast, download, debounce, fmtDate, nowIso, slug, PILLARS } from './util.js';
import { ANSWER_TYPES, optionsToText, parseOptions } from './scoring.js';
import { defaultQuestionnaire } from './seed.js';

const SESSION_KEY = 'esg-admin';
const isAuthed = () => sessionStorage.getItem(SESSION_KEY) === '1';

async function hash(password, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + password));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------- Login ---------------- */

async function loginView(app) {
  const cred = await db.get('meta', 'admin');
  const first = !cred;
  app.innerHTML = `
    <h1>Administração</h1>
    <form id="f" class="card stack narrow">
      <p class="muted">${first
        ? 'Primeiro acesso: defina a senha do administrador deste aparelho.'
        : 'Entre com a senha do administrador para montar e publicar questionários.'}</p>
      <label>Senha<input type="password" name="pw" required minlength="6" autocomplete="${first ? 'new-password' : 'current-password'}"></label>
      ${first ? '<label>Confirmar senha<input type="password" name="pw2" required minlength="6" autocomplete="new-password"></label>' : ''}
      <button class="btn primary block">${first ? 'Criar senha e entrar' : 'Entrar'}</button>
    </form>`;

  $('#f').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pw = fd.get('pw');
    if (first) {
      if (pw !== fd.get('pw2')) return toast('As senhas não conferem.', 'bad');
      const salt = uid();
      await db.put('meta', { id: 'admin', salt, hash: await hash(pw, salt) });
    } else if (await hash(pw, cred.salt) !== cred.hash) {
      return toast('Senha incorreta.', 'bad');
    }
    sessionStorage.setItem(SESSION_KEY, '1');
    adminHome(app);
  };
}

/* ---------------- Lista de questionários ---------------- */

function statusBadge(rec) {
  if (!rec.published) return '<span class="badge">Rascunho</span>';
  return `<span class="badge ok">Publicado v${rec.published.version}</span>` +
    (rec.dirty ? ' <span class="badge warn">Alterações não publicadas</span>' : '');
}

export async function adminHome(app) {
  if (!isAuthed()) return loginView(app);
  const list = (await db.all('questionnaires')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  app.innerHTML = `
    <div class="row between"><h1>Questionários</h1>
      <button type="button" class="btn ghost small" data-act="logout">Sair do admin</button></div>
    <div class="row wrap gap">
      <button type="button" class="btn primary" data-act="new">+ Novo questionário</button>
      <button type="button" class="btn" data-act="seed">Criar a partir do modelo ESG</button>
      <label class="btn ghost">Importar arquivo…<input type="file" accept=".json,application/json" data-act="import" hidden></label>
    </div>
    <div class="list">
      ${list.length ? list.map(q => `
        <div class="item col">
          <div><b>${esc(q.draft.title)}</b>
            <small>${q.draft.sections.reduce((n, s) => n + s.questions.length, 0)} perguntas · atualizado ${fmtDate(q.updatedAt)}</small>
            <div>${statusBadge(q)}</div></div>
          <div class="row wrap gap">
            <a class="btn small" href="#/admin/q/${q.id}">Editar</a>
            <button type="button" class="btn small ghost" data-act="export" data-id="${q.id}" ${q.published ? '' : 'disabled title="Publique antes de exportar"'}>Exportar p/ orientadores</button>
            <button type="button" class="btn small ghost" data-act="dup" data-id="${q.id}">Duplicar</button>
            <button type="button" class="btn small danger ghost" data-act="del" data-id="${q.id}">Excluir</button>
          </div>
        </div>`).join('') : '<div class="card empty">Nenhum questionário ainda. Comece pelo modelo ESG ou crie um do zero.</div>'}
    </div>
    <div class="card muted small">
      <b>Como distribuir:</b> depois de <b>publicar</b>, use “Exportar p/ orientadores” para gerar um arquivo <code>.json</code>.
      Envie o arquivo (WhatsApp, e-mail, pendrive) e cada orientador importa em <b>Ajustes → Importar questionário</b>.
      Questionários publicados neste aparelho já ficam disponíveis para novas visitas aqui.
    </div>`;

  const create = async (draft) => {
    const rec = { id: uid(), draft, published: null, dirty: true, createdAt: nowIso(), updatedAt: nowIso() };
    await db.put('questionnaires', rec);
    location.hash = '#/admin/q/' + rec.id;
  };

  app.onchange = async e => {
    if (e.target.dataset.act !== 'import') return;
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { const t = await importQuestionnaireFile(await file.text()); toast(`Questionário “${t}” importado`); adminHome(app); }
    catch (err) { toast(err.message, 'bad'); }
  };

  app.onclick = async e => {
    const t = e.target.closest('button[data-act]');
    if (!t) return;
    const rec = t.dataset.id && list.find(q => q.id === t.dataset.id);
    switch (t.dataset.act) {
      case 'logout': sessionStorage.removeItem(SESSION_KEY); location.hash = '#/'; break;
      case 'new': await create({ title: 'Novo questionário', description: '',
        sections: [{ id: uid(), pillar: 'E', title: 'Nova seção', questions: [] }] }); break;
      case 'seed': await create(defaultQuestionnaire()); break;
      case 'dup': {
        const d = structuredClone(rec.draft);
        d.title += ' (cópia)';
        d.sections.forEach(s => { s.id = uid(); s.questions.forEach(q => { q.id = uid(); }); });
        await create(d); break;
      }
      case 'export': {
        const P = rec.published;
        const payload = { format: 'esg-questionario', formatVersion: 1, id: rec.id, ...P };
        download(`questionario-${slug(P.title)}-v${P.version}.json`, JSON.stringify(payload, null, 2), 'application/json');
        break;
      }
      case 'del':
        if (!confirm(`Excluir o questionário “${rec.draft.title}”? Visitas já realizadas não são afetadas.`)) return;
        await db.del('questionnaires', rec.id);
        adminHome(app);
        break;
    }
  };
}

// Também usado pelo orientador em Ajustes.
export async function importQuestionnaireFile(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('Arquivo inválido (não é JSON).'); }
  if (d.format !== 'esg-questionario' || !Array.isArray(d.sections)) throw new Error('Este arquivo não é um questionário do ESG Campo.');
  const content = { title: d.title, description: d.description || '', sections: d.sections, version: d.version || 1, publishedAt: d.publishedAt || nowIso() };
  const id = d.id || uid();
  const existing = await db.get('questionnaires', id);
  if (existing?.published && existing.published.version > content.version &&
      !confirm(`Este aparelho já tem a versão ${existing.published.version}, mais nova que a do arquivo (v${content.version}). Substituir mesmo assim?`)) {
    throw new Error('Importação cancelada.');
  }
  const { version, publishedAt, ...draft } = content;
  await db.put('questionnaires', {
    id, published: content, draft: structuredClone(draft), dirty: false,
    createdAt: existing?.createdAt || nowIso(), updatedAt: nowIso(),
  });
  return content.title;
}

/* ---------------- Editor ---------------- */

function questionEditorHTML(q, si, qi, open) {
  const at = `data-s="${si}" data-q="${qi}"`;
  const scored = ANSWER_TYPES[q.type]?.scored;
  return `
  <details class="qe" data-qid="${q.id}" ${open ? 'open' : ''}>
    <summary><span class="q-num">${si + 1}.${qi + 1}</span>
      <span class="qe-title">${q.text ? esc(q.text) : '<i class="muted">(sem texto)</i>'}</span>
      <span class="badge">${ANSWER_TYPES[q.type]?.short || q.type}</span>
      ${q.critical && scored ? '<span class="badge crit">Crítica</span>' : ''}</summary>
    <div class="stack qe-body">
      <label>Pergunta<textarea rows="2" ${at} data-f="text">${esc(q.text)}</textarea></label>
      <label>Orientação para o orientador <small class="muted">(opcional)</small><input ${at} data-f="help" value="${esc(q.help)}"></label>
      <div class="grid2">
        <label>Tipo de resposta<select ${at} data-f="type" data-redraw>
          ${Object.entries(ANSWER_TYPES).map(([k, t]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select></label>
        ${scored ? `<label>Peso na pontuação<input type="number" min="0.5" step="0.5" ${at} data-f="weight" value="${esc(q.weight ?? 1)}"></label>` : '<span></span>'}
      </div>
      ${q.type === 'yesno' ? `<label>Qual resposta é “conforme”?<select ${at} data-f="expected">
          <option value="sim" ${q.expected !== 'nao' ? 'selected' : ''}>Sim</option>
          <option value="nao" ${q.expected === 'nao' ? 'selected' : ''}>Não</option></select></label>` : ''}
      ${q.type === 'single' || q.type === 'multi' ? `<label>Opções — uma por linha
          ${q.type === 'single' ? '<small class="muted">(para pontuar, escreva “Opção = nota”, com nota de 0 a 1)</small>' : ''}
          <textarea rows="4" ${at} data-f="options">${esc(optionsToText(q.options))}</textarea></label>` : ''}
      <div class="checks">
        <label class="check"><input type="checkbox" ${at} data-f="required" ${q.required ? 'checked' : ''}> Obrigatória</label>
        ${scored ? `
        <label class="check"><input type="checkbox" ${at} data-f="critical" data-redraw ${q.critical ? 'checked' : ''}> Item crítico</label>
        <label class="check"><input type="checkbox" ${at} data-f="photoOnNC" ${q.photoOnNC ? 'checked' : ''}> Exigir foto se não conforme</label>` : ''}
      </div>
      <div class="row wrap gap">
        <button type="button" class="btn small ghost" data-act="q-up" ${at} aria-label="Mover para cima">↑</button>
        <button type="button" class="btn small ghost" data-act="q-down" ${at} aria-label="Mover para baixo">↓</button>
        <button type="button" class="btn small ghost" data-act="q-dup" ${at}>Duplicar</button>
        <button type="button" class="btn small danger ghost" data-act="q-del" ${at}>Excluir pergunta</button>
      </div>
    </div>
  </details>`;
}

export async function adminEditor(app, id) {
  if (!isAuthed()) { location.hash = '#/admin'; return; }
  const rec = await db.get('questionnaires', id);
  if (!rec) throw new Error('Questionário não encontrado.');
  const d = rec.draft;
  const openIds = new Set();

  const saveNow = async () => {
    rec.dirty = true; rec.updatedAt = nowIso();
    await db.put('questionnaires', rec);
    const st = $('#savestate'); if (st) st.textContent = 'Salvo automaticamente';
  };
  const saveSoon = debounce(saveNow, 400);

  function draw() {
    app.innerHTML = `
      <a href="#/admin" class="back">← Questionários</a>
      <div class="row between wrap"><h1>Editar questionário</h1><span id="savestate" class="muted small"></span></div>
      <div class="card stack">
        <div>${statusBadge(rec)}</div>
        <label>Título<input data-f="title" value="${esc(d.title)}"></label>
        <label>Descrição<textarea rows="2" data-f="description">${esc(d.description)}</textarea></label>
      </div>
      ${d.sections.map((s, si) => `
        <section class="card stack sec-edit">
          <div class="grid-sec">
            <label>Pilar<select data-s="${si}" data-f="pillar">
              ${Object.entries(PILLARS).map(([k, l]) => `<option value="${k}" ${s.pillar === k ? 'selected' : ''}>${k} – ${l}</option>`).join('')}
            </select></label>
            <label>Seção<input data-s="${si}" data-f="title" value="${esc(s.title)}"></label>
          </div>
          <div class="qe-list">${s.questions.map((q, qi) => questionEditorHTML(q, si, qi, openIds.has(q.id))).join('') || '<p class="muted small">Seção sem perguntas.</p>'}</div>
          <div class="row wrap gap">
            <button type="button" class="btn small" data-act="q-add" data-s="${si}">+ Pergunta</button>
            <span class="spacer"></span>
            <button type="button" class="btn small ghost" data-act="s-up" data-s="${si}" aria-label="Mover seção para cima">↑</button>
            <button type="button" class="btn small ghost" data-act="s-down" data-s="${si}" aria-label="Mover seção para baixo">↓</button>
            <button type="button" class="btn small danger ghost" data-act="s-del" data-s="${si}">Excluir seção</button>
          </div>
        </section>`).join('')}
      <button type="button" class="btn block" data-act="s-add">+ Nova seção</button>
      <div class="card stack">
        <p class="small muted">As alterações são salvas automaticamente como rascunho. Os orientadores só recebem
        a nova versão depois de <b>Publicar</b> e exportar o arquivo novamente. Visitas já iniciadas mantêm a versão com que começaram.</p>
        <button type="button" class="btn primary block" data-act="publish">Publicar ${rec.published ? 'nova versão (v' + (rec.published.version + 1) + ')' : 'versão 1'}</button>
      </div>`;
    $$('details.qe', app).forEach(el => {
      el.ontoggle = () => { el.open ? openIds.add(el.dataset.qid) : openIds.delete(el.dataset.qid); };
    });
  }

  const target = (el) => {
    if (el.dataset.s == null) return d;
    const s = d.sections[+el.dataset.s];
    return el.dataset.q == null ? s : s.questions[+el.dataset.q];
  };

  app.oninput = e => {
    const el = e.target, f = el.dataset.f;
    if (!f) return;
    const obj = target(el);
    let val = el.type === 'checkbox' ? el.checked : el.value;
    if (f === 'weight') val = Number(val) > 0 ? Number(val) : 1;
    if (f === 'options') val = parseOptions(val);
    obj[f] = val;
    if (f === 'type' && (val === 'single' || val === 'multi') && !obj.options?.length) obj.options = [{ label: 'Opção 1', score: null }, { label: 'Opção 2', score: null }];
    if (f === 'text' && el.dataset.q != null) {
      const t = el.closest('details')?.querySelector('.qe-title');
      if (t) t.textContent = val || '(sem texto)';
    }
    if (el.dataset.redraw != null) { saveNow(); draw(); } else saveSoon();
  };

  const move = (arr, i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  };

  app.onclick = async e => {
    const t = e.target.closest('button[data-act]');
    if (!t) return;
    const si = +t.dataset.s, qi = +t.dataset.q;
    const qs = d.sections[si]?.questions;
    switch (t.dataset.act) {
      case 'q-add': {
        const q = { id: uid(), type: 'conform', text: '', help: '', weight: 1, required: true, critical: false, photoOnNC: false };
        qs.push(q); openIds.add(q.id); break;
      }
      case 'q-up': move(qs, qi, -1); break;
      case 'q-down': move(qs, qi, 1); break;
      case 'q-dup': { const q = { ...structuredClone(qs[qi]), id: uid() }; qs.splice(qi + 1, 0, q); openIds.add(q.id); break; }
      case 'q-del': if (!confirm('Excluir esta pergunta?')) return; qs.splice(qi, 1); break;
      case 's-add': d.sections.push({ id: uid(), pillar: 'E', title: 'Nova seção', questions: [] }); break;
      case 's-up': move(d.sections, si, -1); break;
      case 's-down': move(d.sections, si, 1); break;
      case 's-del':
        if (!confirm(`Excluir a seção “${d.sections[si].title}” e suas ${qs.length} pergunta(s)?`)) return;
        d.sections.splice(si, 1); break;
      case 'publish': return publish();
      default: return;
    }
    await saveNow();
    draw();
  };

  async function publish() {
    const problems = [];
    if (!d.title.trim()) problems.push('O questionário precisa de um título.');
    if (!d.sections.some(s => s.questions.length)) problems.push('Adicione ao menos uma pergunta.');
    d.sections.forEach((s, si) => {
      if (!s.title.trim()) problems.push(`Seção ${si + 1} sem título.`);
      s.questions.forEach((q, qi) => {
        if (!q.text.trim()) problems.push(`Pergunta ${si + 1}.${qi + 1} sem texto.`);
        if ((q.type === 'single' || q.type === 'multi') && (q.options || []).length < 2) problems.push(`Pergunta ${si + 1}.${qi + 1} precisa de ao menos 2 opções.`);
      });
    });
    if (problems.length) { alert('Corrija antes de publicar:\n\n• ' + problems.join('\n• ')); return; }
    const version = (rec.published?.version || 0) + 1;
    if (!confirm(`Publicar a versão ${version} de “${d.title}”?`)) return;
    rec.published = { ...structuredClone(d), version, publishedAt: nowIso() };
    rec.dirty = false; rec.updatedAt = nowIso();
    await db.put('questionnaires', rec);
    toast(`Versão ${version} publicada`);
    draw();
  }

  draw();
}

// Questionários: montar, publicar versões e arquivar.
import * as fb from '../../shared/firebase.js';
import { $, $$, esc, toast, debounce, fmtDate, nowIso, uid, PILLARS, onLeave, onFlush } from '../../shared/util.js';
import { ANSWER_TYPES, optionsToText, parseOptions } from '../../shared/scoring.js';
import { defaultQuestionnaire } from '../../shared/seed.js';

const col = () => fb.collection(fb.fs, 'questionnaires');
const countQ = (d) => d.sections.reduce((n, s) => n + s.questions.length, 0);

function statusBadge(rec) {
  if (!rec.published) return '<span class="badge">Rascunho</span>';
  const base = rec.isPublished
    ? `<span class="badge ok">✓ Publicado v${rec.published.version}</span>`
    : `<span class="badge">Arquivado (v${rec.published.version})</span>`;
  return base + (rec.dirty ? ' <span class="badge warn">Alterações não publicadas</span>' : '');
}

export async function questionnairesList(app) {
  const snap = await fb.getDocs(col());
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  app.innerHTML = `
    <div class="row between wrap"><h1>Questionários</h1>
      <div class="row wrap gap">
        <button type="button" class="btn" data-act="seed">Criar a partir do modelo ESG</button>
        <button type="button" class="btn primary" data-act="new">+ Novo questionário</button>
      </div></div>
    <div class="list">
      ${list.length ? list.map(q => `
        <div class="item">
          <div><b>${esc(q.draft.title)}</b>
            <small>${countQ(q.draft)} perguntas · atualizado ${fmtDate(q.updatedAt)}</small>
            <div>${statusBadge(q)}</div></div>
          <div class="row wrap gap">
            <a class="btn small" href="#/questionarios/${q.id}">Editar</a>
            ${q.published ? `<button type="button" class="btn small ghost" data-act="toggle" data-id="${q.id}">${q.isPublished ? 'Arquivar' : 'Reativar'}</button>` : ''}
            <button type="button" class="btn small ghost" data-act="dup" data-id="${q.id}">Duplicar</button>
            ${q.published ? '' : `<button type="button" class="btn small danger ghost" data-act="del" data-id="${q.id}">Excluir</button>`}
          </div>
        </div>`).join('') : '<div class="card empty">Nenhum questionário ainda. Comece pelo modelo ESG ou crie um do zero.</div>'}
    </div>
    <div class="card small muted">
      Os orientadores recebem os questionários <b>publicados</b> na próxima sincronização do aplicativo de campo.
      <b>Arquivar</b> tira o questionário das novas visitas sem afetar as já realizadas.
      Questionários já publicados não podem ser excluídos, para preservar o histórico.
    </div>`;

  const create = async (draft) => {
    const ref = fb.doc(col());
    await fb.setDoc(ref, { draft, published: null, isPublished: false, dirty: true, createdAt: nowIso(), updatedAt: nowIso() });
    location.hash = '#/questionarios/' + ref.id;
  };

  app.onclick = async e => {
    const t = e.target.closest('button[data-act]');
    if (!t) return;
    const rec = t.dataset.id && list.find(q => q.id === t.dataset.id);
    switch (t.dataset.act) {
      case 'new': return create({ title: 'Novo questionário', description: '',
        sections: [{ id: uid(), pillar: 'E', title: 'Nova seção', questions: [] }] });
      case 'seed': return create(defaultQuestionnaire());
      case 'dup': {
        const d = structuredClone(rec.draft);
        d.title += ' (cópia)';
        d.sections.forEach(s => { s.id = uid(); s.questions.forEach(q => { q.id = uid(); }); });
        return create(d);
      }
      case 'toggle':
        await fb.updateDoc(fb.doc(col(), rec.id), { isPublished: !rec.isPublished, updatedAt: nowIso() });
        toast(rec.isPublished ? 'Questionário arquivado' : 'Questionário reativado');
        return questionnairesList(app);
      case 'del':
        if (!confirm(`Excluir o rascunho “${rec.draft.title}”?`)) return;
        await fb.deleteDoc(fb.doc(col(), rec.id));
        return questionnairesList(app);
    }
  };
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

export async function questionnaireEditor(app, id) {
  const ref = fb.doc(col(), id);
  const snap = await fb.getDoc(ref);
  if (!snap.exists()) throw new Error('Questionário não encontrado.');
  const rec = snap.data();
  const d = rec.draft;
  const openIds = new Set();
  let pending = false;

  const saveNow = async () => {
    pending = false;
    const st = $('#savestate');
    if (st) st.textContent = 'Salvando…';
    rec.dirty = true; rec.updatedAt = nowIso();
    try {
      await fb.updateDoc(ref, { draft: d, dirty: true, updatedAt: rec.updatedAt });
      if ($('#savestate')) $('#savestate').textContent = 'Rascunho salvo';
    } catch (err) {
      if ($('#savestate')) $('#savestate').textContent = 'Erro ao salvar';
      toast(fb.errorMessage(err), 'bad');
    }
  };
  const saveDebounced = debounce(saveNow, 700);
  const saveSoon = () => { pending = true; saveDebounced(); };
  onFlush(() => { if (pending) saveNow(); });
  const beforeUnload = e => { if (pending) { saveNow(); e.preventDefault(); } };
  window.addEventListener('beforeunload', beforeUnload);
  onLeave(() => window.removeEventListener('beforeunload', beforeUnload));

  function draw() {
    app.innerHTML = `
      <a href="#/questionarios" class="back">← Questionários</a>
      <div class="row between wrap"><h1>Editar questionário</h1><span id="savestate" class="muted small"></span></div>
      <div class="editor-grid">
        <div>
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
        </div>
        <aside class="card stack sticky-side">
          <h2>Publicação</h2>
          <p class="small muted">As alterações são salvas automaticamente como rascunho. Os orientadores só recebem a nova
          versão depois de <b>Publicar</b>. Visitas já iniciadas mantêm a versão com que começaram.</p>
          <p class="small">${countQ(d)} perguntas em ${d.sections.length} seção(ões)</p>
          <button type="button" class="btn primary block" data-act="publish">Publicar ${rec.published ? 'versão ' + (rec.published.version + 1) : 'versão 1'}</button>
          ${rec.published ? `<p class="small muted">Versão atual: v${rec.published.version}, publicada em ${fmtDate(rec.published.publishedAt)}</p>` : ''}
        </aside>
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
    draw();
    await saveNow();
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
    if (!confirm(`Publicar a versão ${version} de “${d.title}”? Os orientadores receberão na próxima sincronização.`)) return;
    rec.published = { ...structuredClone(d), version, publishedAt: nowIso() };
    rec.isPublished = true; rec.dirty = false; rec.updatedAt = nowIso();
    await fb.updateDoc(ref, { draft: d, published: rec.published, isPublished: true, dirty: false, updatedAt: rec.updatedAt });
    pending = false;
    toast(`Versão ${version} publicada`);
    draw();
  }

  draw();
}

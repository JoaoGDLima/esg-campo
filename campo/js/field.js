// Fluxo do orientador em campo: iniciar visita, responder, finalizar e relatório.
import { db, uid, saveLocal, getSession, getMeta, wasSynced, isPending } from './db.js';
import { $, $$, esc, fmtDate, toast, debounce, nowIso, download, slug, onLeave, onFlush } from '../../shared/util.js';
import {
  CONFORM_OPTIONS, YESNO_OPTIONS, computeScores, summarizeScores, progress, isNonConform, isEmpty, formatAnswer,
} from '../../shared/scoring.js';
import { pillarTag, scoreSummaryHTML, reportHTML, fmtGps } from '../../shared/report.js';
import { csvAnswers, csvSummary } from '../../shared/csv.js';
import { compressImage, getPosition, renderThumbs } from './media.js';
import { signaturePad } from './signature.js';
import { propertyFields, readPropertyForm, propertySnapshot } from './properties.js';
import { syncNow } from './sync.js';

const countQuestions = (q) => q.sections.reduce((n, s) => n + s.questions.length, 0);

async function loadVisit(id) {
  const [v, session] = await Promise.all([db.get('visits', id), getSession()]);
  if (!v || v.orientadorUid !== session?.uid) throw new Error('Visita não encontrada.');
  return v;
}

/* ---------------- Nova visita ---------------- */

export async function newVisit(app) {
  const [qs, props, session] = await Promise.all([db.all('questionnaires'), db.all('properties'), getSession()]);
  const pub = qs.filter(q => q.published).sort((a, b) => a.published.title.localeCompare(b.published.title));
  props.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (!pub.length) {
    app.innerHTML = `
      <a href="#/" class="back">← Visitas</a>
      <h1>Nova visita</h1>
      <div class="card empty stack">
        <p><b>Nenhum questionário disponível neste aparelho.</b></p>
        <p>Conecte-se à internet e sincronize para baixar os questionários publicados pelo administrador.</p>
        <button type="button" class="btn primary" data-act="sync">Sincronizar agora</button>
      </div>`;
    app.onclick = async e => {
      if (e.target.closest('[data-act=sync]')) {
        toast('Sincronizando…');
        const r = await syncNow();
        if (r.ok) newVisit(app); else toast(r.error, 'bad');
      }
    };
    return;
  }

  app.innerHTML = `
    <a href="#/" class="back">← Visitas</a>
    <h1>Nova visita</h1>
    <form id="f" class="stack">
      <fieldset class="card stack"><legend>Questionário</legend>
        ${pub.map((q, i) => `
          <label class="radio-card"><input type="radio" name="q" value="${q.id}" ${i === 0 ? 'checked' : ''} required>
            <span><b>${esc(q.published.title)}</b><small>Versão ${q.published.version} · ${countQuestions(q.published)} perguntas</small></span></label>`).join('')}
      </fieldset>
      <fieldset class="card stack"><legend>Propriedade</legend>
        <label>Propriedade visitada
          <select name="prop" id="prop">
            ${props.map(p => `<option value="${p.id}">${esc(p.name)} — ${esc(p.producer)}</option>`).join('')}
            <option value="__new" ${props.length ? '' : 'selected'}>+ Cadastrar nova propriedade</option>
          </select></label>
        <fieldset id="newprop" class="stack plain" ${props.length ? 'disabled hidden' : ''}>${propertyFields()}</fieldset>
      </fieldset>
      <p class="muted small">Orientador: <b>${esc(session.name)}</b></p>
      <button class="btn primary block">Iniciar visita</button>
    </form>`;

  $('#prop').onchange = e => {
    const np = $('#newprop');
    const on = e.target.value === '__new';
    np.disabled = !on; np.hidden = !on;
  };

  $('#f').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    let prop;
    if (fd.get('prop') === '__new') {
      prop = await saveLocal('properties', { ...readPropertyForm(fd), id: uid(), gps: null, createdBy: session.uid, createdAt: nowIso() });
    } else {
      prop = await db.get('properties', fd.get('prop'));
    }
    const rec = pub.find(q => q.id === fd.get('q'));
    const P = rec.published;
    const visit = {
      id: uid(), status: 'andamento',
      questionnaire: { id: rec.id, version: P.version, title: P.title, description: P.description || '', sections: structuredClone(P.sections) },
      propertyId: prop.id, property: propertySnapshot(prop),
      orientadorUid: session.uid, orientadorName: session.name,
      startedAt: nowIso(), finishedAt: null,
      gps: null, answers: {}, actionPlan: {}, signature: null, signerName: '',
    };
    await saveLocal('visits', visit);
    location.hash = '#/visita/' + visit.id;
  };
}

/* ---------------- Preenchimento ---------------- */

function inputHTML(q, val) {
  const name = `a-${q.id}`;
  const radio = (value, label, cls = '') => `
    <label class="opt ${cls}"><input type="radio" name="${name}" value="${esc(value)}" data-ans="${q.id}" ${val === value ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  switch (q.type) {
    case 'conform': return `<div class="seg seg4">${CONFORM_OPTIONS.map(o => radio(o.value, o.label, 'opt-' + o.value)).join('')}</div>`;
    case 'yesno':   return `<div class="seg seg3">${YESNO_OPTIONS.map(o => radio(o.value, o.label,
      o.value === 'NA' ? 'opt-NA' : (o.value === (q.expected || 'sim') ? 'opt-C' : 'opt-NC'))).join('')}</div>`;
    case 'single':  return `<div class="opts">${(q.options || []).map(o => radio(o.label, o.label)).join('')}</div>`;
    case 'multi': {
      const arr = [].concat(val || []);
      return `<div class="opts">${(q.options || []).map(o => `
        <label class="opt"><input type="checkbox" value="${esc(o.label)}" data-multi="${q.id}" ${arr.includes(o.label) ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div>`;
    }
    case 'number': return `<input type="number" step="any" inputmode="decimal" data-ans="${q.id}" value="${esc(val)}">`;
    case 'date':   return `<input type="date" data-ans="${q.id}" value="${esc(val)}">`;
    default:       return `<textarea rows="3" data-ans="${q.id}">${esc(val)}</textarea>`;
  }
}

function questionHTML(q, num, a = {}) {
  const val = a.value;
  const nc = isNonConform(q, val);
  const needPhoto = q.photoOnNC && nc && !(a.photos || []).length;
  return `
  <article class="q ${nc ? 'is-nc' : ''} ${isEmpty(val) ? '' : 'is-done'}" id="q-${q.id}" data-qid="${q.id}">
    <div class="q-head">
      <span class="q-num">${num}</span>
      <h3>${esc(q.text)}${q.required ? ' <span class="req" title="Obrigatória">*</span>' : ''}</h3>
      ${q.critical ? '<span class="badge crit">Crítica</span>' : ''}
    </div>
    ${q.help ? `<p class="q-help">${esc(q.help)}</p>` : ''}
    <div class="q-input">${inputHTML(q, val)}</div>
    ${needPhoto ? '<p class="warn-text">Foto de evidência obrigatória para não conformidade.</p>' : ''}
    <div class="q-tools">
      <label class="btn small ghost">📷 Foto<input type="file" accept="image/*" multiple data-photo="${q.id}" hidden></label>
      <details class="note" ${a.note ? 'open' : ''}><summary>Observação</summary>
        <textarea data-note="${q.id}" rows="2" placeholder="Anotações, evidências verificadas…">${esc(a.note)}</textarea></details>
      ${isEmpty(val) ? '' : `<button type="button" class="linklike small" data-clear="${q.id}">Limpar resposta</button>`}
    </div>
    <div class="thumbs" data-thumbs="${q.id}"></div>
  </article>`;
}

export async function fillVisit(app, id) {
  const v = await loadVisit(id);
  if (v.status === 'finalizada') { location.replace(`#/visita/${id}/relatorio`); return; }

  const Q = v.questionnaire;
  const index = new Map();
  Q.sections.forEach((s, si) => s.questions.forEach((q, qi) => index.set(q.id, { q, num: `${si + 1}.${qi + 1}` })));
  const ans = (qid) => (v.answers[qid] ||= { value: null, note: '', photos: [] });
  let dirty = false;
  const persist = async () => { dirty = false; await saveLocal('visits', v); };
  const persistSoon = debounce(persist, 500);
  const touch = () => { dirty = true; persistSoon(); };
  onFlush(() => { if (dirty) persist(); });

  app.innerHTML = `
    <div class="card visit-head">
      <p class="eyebrow">${esc(Q.title)} · v${Q.version}</p>
      <h1>${esc(v.property.name)}</h1>
      <p class="muted">${esc(v.property.producer)}${v.property.municipality ? ' · ' + esc(v.property.municipality) + (v.property.uf ? '/' + esc(v.property.uf) : '') : ''}</p>
      <div class="gps-row"><span id="gps">${v.gps ? '📍 ' + esc(fmtGps(v.gps)) : '<span class="muted">Localização não registrada</span>'}</span>
        <button type="button" class="btn small" data-act="gps">${v.gps ? 'Atualizar' : 'Registrar'} GPS</button></div>
    </div>
    <div class="sticky-progress">
      <div class="row between small"><span id="ptext"></span></div>
      <div class="progress"><div id="pbar"></div></div>
      <div class="chips">${Q.sections.map((s, si) => `<button type="button" class="chip" data-jump="sec-${si}">${pillarTag(s.pillar)} ${esc(s.title)}</button>`).join('')}</div>
    </div>
    ${Q.sections.map((s, si) => `
      <section class="q-section" id="sec-${si}">
        <h2>${pillarTag(s.pillar)} ${esc(s.title)}</h2>
        ${s.questions.map((q, qi) => questionHTML(q, `${si + 1}.${qi + 1}`, v.answers[q.id])).join('')}
      </section>`).join('')}
    <div class="stack bottom-actions">
      <a class="btn primary block" href="#/visita/${v.id}/fechar">Revisar e finalizar →</a>
      ${wasSynced(v) ? '' : '<button type="button" class="btn danger ghost" data-act="del">Excluir visita</button>'}
    </div>`;

  const updateProgress = () => {
    const p = progress(Q, v.answers);
    $('#pbar').style.width = (p.total ? (p.answered / p.total) * 100 : 0) + '%';
    $('#ptext').textContent = `${p.answered} de ${p.total} respondidas` +
      (p.reqMissing.length ? ` · ${p.reqMissing.length} obrigatória(s) pendente(s)` : '');
  };
  const refreshCard = (qid) => {
    const { q, num } = index.get(qid);
    document.getElementById('q-' + qid).outerHTML = questionHTML(q, num, v.answers[qid]);
    renderThumbs($(`[data-thumbs="${qid}"]`), v.answers[qid]?.photos, { removable: true, qid });
    updateProgress();
  };

  updateProgress();
  for (const [qid, a] of Object.entries(v.answers)) {
    if (a.photos?.length) renderThumbs($(`[data-thumbs="${qid}"]`), a.photos, { removable: true, qid });
  }
  const jump = sessionStorage.getItem('esg-jump');
  if (jump) {
    sessionStorage.removeItem('esg-jump');
    document.getElementById('q-' + jump)?.scrollIntoView({ block: 'center' });
  }

  app.onchange = async e => {
    const el = e.target;
    if (el.dataset.photo) {
      const qid = el.dataset.photo;
      const files = [...el.files];
      el.value = '';
      if (!files.length) return;
      toast('Processando foto…');
      try {
        for (const f of files) {
          const blob = await compressImage(f);
          const pid = uid();
          await db.put('photos', { id: pid, visitId: v.id, qid, blob, createdAt: nowIso(), synced: false });
          ans(qid).photos.push(pid);
        }
        await persist();
        refreshCard(qid);
        toast(files.length > 1 ? `${files.length} fotos adicionadas` : 'Foto adicionada');
      } catch (err) { toast('Erro ao salvar foto: ' + err.message, 'bad'); }
      return;
    }
    if (el.dataset.multi) {
      const qid = el.dataset.multi;
      ans(qid).value = $$(`input[data-multi="${qid}"]:checked`).map(i => i.value);
      await persist(); refreshCard(qid);
      return;
    }
    if (el.dataset.ans && (el.type === 'radio' || el.type === 'date')) {
      ans(el.dataset.ans).value = el.value || null;
      await persist(); refreshCard(el.dataset.ans);
    }
  };

  app.oninput = e => {
    const el = e.target;
    if (el.dataset.note) { ans(el.dataset.note).note = el.value; touch(); return; }
    if (el.dataset.ans && (el.tagName === 'TEXTAREA' || el.type === 'number')) {
      ans(el.dataset.ans).value = el.value.trim() === '' ? null : el.value;
      el.closest('.q').classList.toggle('is-done', el.value.trim() !== '');
      touch(); updateProgress();
    }
  };

  app.onclick = async e => {
    const t = e.target.closest('button, [data-act]');
    if (!t) return;
    if (t.dataset.jump) { document.getElementById(t.dataset.jump)?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (t.dataset.clear) { ans(t.dataset.clear).value = null; await persist(); refreshCard(t.dataset.clear); return; }
    if (t.dataset.delPhoto) {
      if (!confirm('Remover esta foto?')) return;
      const qid = t.dataset.qid, pid = t.dataset.delPhoto;
      const photo = await db.get('photos', pid);
      if (photo?.synced) await db.put('outbox', { id: 'photos/' + pid, coll: 'photos', docId: pid });
      await db.del('photos', pid);
      ans(qid).photos = ans(qid).photos.filter(p => p !== pid);
      await persist(); refreshCard(qid);
      return;
    }
    if (t.dataset.act === 'gps') await captureGps(v, $('#gps'), t);
    if (t.dataset.act === 'del') {
      if (!confirm('Excluir esta visita e todas as fotos dela? Esta ação não pode ser desfeita.')) return;
      onFlush(null);
      await deleteVisit(v);
      toast('Visita excluída');
      location.hash = '#/';
    }
  };
}

async function captureGps(v, out, btn) {
  out.textContent = 'Obtendo localização…';
  if (btn) btn.disabled = true;
  try {
    v.gps = await getPosition();
    await saveLocal('visits', v);
    const prop = await db.get('properties', v.propertyId);
    if (prop && !prop.gps) { prop.gps = v.gps; await saveLocal('properties', prop); }
    out.textContent = '📍 ' + fmtGps(v.gps);
    toast('Localização registrada');
  } catch (err) {
    out.textContent = err.message;
    toast(err.message, 'bad');
  } finally { if (btn) btn.disabled = false; }
}

// Só visitas que nunca foram enviadas podem ser excluídas no aparelho.
async function deleteVisit(v) {
  for (const a of Object.values(v.answers || {})) for (const pid of a.photos || []) await db.del('photos', pid);
  await db.del('visits', v.id);
  document.dispatchEvent(new CustomEvent('esg:changed'));
}

/* ---------------- Revisão e finalização ---------------- */

export async function closeVisit(app, id) {
  const v = await loadVisit(id);
  if (v.status === 'finalizada') { location.replace(`#/visita/${id}/relatorio`); return; }
  v.actionPlan ||= {};

  const Q = v.questionnaire;
  const sc = computeScores(Q, v.answers);
  const pr = progress(Q, v.answers);
  const blockers = pr.reqMissing.map(q => ({ q, msg: 'resposta obrigatória' }));
  for (const s of Q.sections) for (const q of s.questions) {
    const a = v.answers[q.id];
    if (q.photoOnNC && a && isNonConform(q, a.value) && !(a.photos || []).length) blockers.push({ q, msg: 'foto de evidência obrigatória' });
  }
  let dirty = false;
  const persist = async () => { dirty = false; await saveLocal('visits', v); };
  const persistSoon = debounce(persist, 500);
  const touch = () => { dirty = true; persistSoon(); };

  app.innerHTML = `
    <a href="#/visita/${id}" class="back">← Voltar ao questionário</a>
    <h1>Revisar e finalizar</h1>
    <p class="muted">${esc(v.property.name)} · ${esc(v.property.producer)}</p>
    ${scoreSummaryHTML(sc)}
    ${blockers.length ? `<div class="card alert bad"><h2>Pendências (${blockers.length})</h2>
      <ul>${blockers.map(b => `<li><button type="button" class="linklike" data-goto="${b.q.id}">${esc(b.q.text)}</button> <small>— ${b.msg}</small></li>`).join('')}</ul></div>` : ''}
    ${v.gps ? '' : `<div class="card alert warn row between"><span id="gps">Localização GPS não registrada.</span>
      <button type="button" class="btn small" data-act="gps">Registrar agora</button></div>`}
    <div class="card stack">
      <h2>Plano de ação</h2>
      ${sc.nonConform.length ? sc.nonConform.map(({ q, s, value }) => {
        const p = v.actionPlan[q.id] || {};
        return `<div class="plan-item">
          <p>${pillarTag(s.pillar)} <b>${esc(q.text)}</b> ${q.critical ? '<span class="badge crit">Crítica</span>' : ''}<br>
            <small class="muted">Resposta: ${esc(formatAnswer(q, value))}</small></p>
          <label>Ação corretiva<textarea rows="2" data-plan="${q.id}" data-f="action">${esc(p.action)}</textarea></label>
          <div class="grid2">
            <label>Responsável<input data-plan="${q.id}" data-f="responsible" value="${esc(p.responsible)}"></label>
            <label>Prazo<input type="date" data-plan="${q.id}" data-f="deadline" value="${esc(p.deadline)}"></label>
          </div></div>`;
      }).join('') : '<p class="muted">Nenhuma não conformidade registrada.</p>'}
    </div>
    <div class="card stack">
      <h2>Assinatura do produtor</h2>
      <label>Nome de quem assina<input id="signer" value="${esc(v.signerName || v.property.producer || '')}"></label>
      <div class="sig-wrap"><canvas id="sig" aria-label="Área de assinatura"></canvas></div>
      <div class="row between"><small class="muted">Assine com o dedo dentro do quadro.</small>
        <button type="button" class="btn small ghost" data-act="sig-clear">Limpar assinatura</button></div>
    </div>
    <button type="button" class="btn primary block" data-act="finish" ${blockers.length ? 'disabled' : ''}>Finalizar visita</button>
    ${blockers.length ? '<p class="muted center">Resolva as pendências para finalizar.</p>' : ''}`;

  const pad = signaturePad($('#sig'), { onEnd: () => { v.signature = pad.toDataURL(); touch(); } });
  pad.load(v.signature);
  onFlush(() => { if (dirty) persist(); });
  onLeave(() => pad.destroy());

  app.oninput = e => {
    const el = e.target;
    if (el.dataset.plan) { (v.actionPlan[el.dataset.plan] ||= {})[el.dataset.f] = el.value; touch(); }
    if (el.id === 'signer') { v.signerName = el.value; touch(); }
  };

  app.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.goto) { sessionStorage.setItem('esg-jump', t.dataset.goto); location.hash = `#/visita/${id}`; return; }
    if (t.dataset.act === 'gps') { await captureGps(v, $('#gps'), t); return; }
    if (t.dataset.act === 'sig-clear') { pad.clear(); v.signature = null; touch(); return; }
    if (t.dataset.act === 'finish') {
      if (pad.isEmpty() && !confirm('A visita está sem a assinatura do produtor. Finalizar mesmo assim?')) return;
      v.signature = pad.isEmpty() ? null : pad.toDataURL();
      v.signerName = $('#signer').value.trim();
      const prop = await db.get('properties', v.propertyId);
      if (prop) v.property = propertySnapshot(prop);
      v.scores = summarizeScores(computeScores(Q, v.answers));
      v.status = 'finalizada';
      v.finishedAt = nowIso();
      await persist();
      toast('Visita finalizada');
      syncNow(); // envia assim que possível; se estiver offline, fica na fila
      location.hash = `#/visita/${id}/relatorio`;
    }
  };
}

/* ---------------- Relatório ---------------- */

export async function report(app, id) {
  const [v, org] = await Promise.all([loadVisit(id), getMeta('org', '')]);
  const done = v.status === 'finalizada';
  const syncInfo = isPending(v)
    ? '<span class="badge warn">↑ Aguardando envio</span>'
    : `<span class="badge ok">✓ Enviada ao servidor</span>`;

  app.innerHTML = `
    <div class="no-print row wrap gap">
      <a href="#/" class="btn ghost">← Visitas</a>
      <button type="button" class="btn primary" data-act="print">Imprimir / PDF</button>
      <button type="button" class="btn" data-act="csv">Exportar CSV</button>
      ${done ? '<button type="button" class="btn ghost" data-act="reopen">Reabrir visita</button>'
             : `<a class="btn ghost" href="#/visita/${id}">Continuar preenchimento</a>`}
    </div>
    <p class="no-print">${syncInfo}</p>
    ${done ? '' : '<div class="card alert warn no-print">Visita ainda em andamento — relatório parcial.</div>'}
    ${reportHTML(v, { org })}`;

  for (const [qid, a] of Object.entries(v.answers || {})) {
    if (a.photos?.length) renderThumbs($(`[data-rphotos="${qid}"]`), a.photos);
  }

  app.onclick = async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'print') window.print();
    if (act === 'csv') {
      const base = `visita-${slug(v.property?.name)}-${(v.startedAt || '').slice(0, 10)}`;
      download(base + '-respostas.csv', csvAnswers([v]), 'text/csv;charset=utf-8');
      setTimeout(() => download(base + '-resumo.csv', csvSummary([v]), 'text/csv;charset=utf-8'), 400);
    }
    if (act === 'reopen') {
      if (!confirm('Reabrir a visita para edição? A assinatura será removida e precisará ser coletada novamente.')) return;
      Object.assign(v, { status: 'andamento', finishedAt: null, signature: null, scores: null });
      await saveLocal('visits', v);
      location.hash = `#/visita/${id}`;
    }
  };
}

// Fluxo do orientador em campo: iniciar visita, responder, finalizar e relatório.
import { db, uid, getSettings, saveSettings } from './db.js';
import { $, $$, esc, fmtDate, fmtDay, toast, debounce, pct, nowIso, PILLARS, download, slug, onLeave, onFlush } from './util.js';
import {
  CONFORM_OPTIONS, YESNO_OPTIONS, computeScores, summarizeScores, progress, isNonConform, isEmpty,
  classify, scoreClass, formatAnswer,
} from './scoring.js';
import { compressImage, getPosition, fmtGps, mapsLink, renderThumbs } from './media.js';
import { signaturePad } from './signature.js';
import { propertyFields, readPropertyForm } from './properties.js';
import { csvAnswers, csvSummary } from './export.js';

const countQuestions = (q) => q.sections.reduce((n, s) => n + s.questions.length, 0);
const pillarTag = (p) => `<span class="pillar-tag pillar-${esc(p)}" title="${esc(PILLARS[p] || p)}">${esc(p)}</span>`;

/* ---------------- Nova visita ---------------- */

export async function newVisit(app) {
  const [qs, props, settings] = await Promise.all([db.all('questionnaires'), db.all('properties'), getSettings()]);
  const pub = qs.filter(q => q.published).sort((a, b) => a.published.title.localeCompare(b.published.title));
  props.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (!pub.length) {
    app.innerHTML = `
      <h1>Nova visita</h1>
      <div class="card empty">
        <p><b>Nenhum questionário disponível neste aparelho.</b></p>
        <p>O administrador precisa publicar um questionário (menu <a href="#/admin">Admin</a>) ou enviar o arquivo
        do questionário para você importar em <a href="#/config">Ajustes</a>.</p>
      </div>`;
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
      <fieldset class="card stack"><legend>Orientador</legend>
        <label>Seu nome *<input name="orientador" required value="${esc(settings.orientador)}"></label>
      </fieldset>
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
      prop = { ...readPropertyForm(fd), id: uid(), gps: null, createdAt: nowIso(), updatedAt: nowIso() };
      await db.put('properties', prop);
    } else {
      prop = await db.get('properties', fd.get('prop'));
    }
    const rec = pub.find(q => q.id === fd.get('q'));
    const P = rec.published;
    const orientador = fd.get('orientador').trim();
    if (orientador !== settings.orientador) await saveSettings({ ...settings, orientador });

    const visit = {
      id: uid(), status: 'andamento',
      questionnaire: { id: rec.id, version: P.version, title: P.title, description: P.description || '', sections: structuredClone(P.sections) },
      propertyId: prop.id, property: { ...prop }, orientador,
      startedAt: nowIso(), updatedAt: nowIso(), finishedAt: null,
      gps: null, answers: {}, actionPlan: {}, signature: null, signerName: '',
    };
    await db.put('visits', visit);
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
  const v = await db.get('visits', id);
  if (!v) throw new Error('Visita não encontrada.');
  if (v.status === 'finalizada') { location.replace(`#/visita/${id}/relatorio`); return; }

  const Q = v.questionnaire;
  const index = new Map();
  Q.sections.forEach((s, si) => s.questions.forEach((q, qi) => index.set(q.id, { q, num: `${si + 1}.${qi + 1}` })));
  const ans = (qid) => (v.answers[qid] ||= { value: null, note: '', photos: [] });
  const persist = async () => { v.updatedAt = nowIso(); await db.put('visits', v); };
  const persistSoon = debounce(persist, 500);
  onFlush(persist);

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
      <button type="button" class="btn danger ghost" data-act="del">Excluir visita</button>
    </div>`;

  const updateProgress = () => {
    const p = progress(Q, v.answers);
    $('#pbar').style.width = (p.total ? (p.answered / p.total) * 100 : 0) + '%';
    $('#ptext').textContent = `${p.answered} de ${p.total} respondidas` +
      (p.reqMissing.length ? ` · ${p.reqMissing.length} obrigatória(s) pendente(s)` : '');
  };
  const refreshCard = (qid) => {
    const { q, num } = index.get(qid);
    const el = document.getElementById('q-' + qid);
    el.outerHTML = questionHTML(q, num, v.answers[qid]);
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
          await db.put('photos', { id: pid, visitId: v.id, qid, blob, createdAt: nowIso() });
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
    if (el.dataset.note) { ans(el.dataset.note).note = el.value; persistSoon(); return; }
    if (el.dataset.ans && (el.tagName === 'TEXTAREA' || el.type === 'number')) {
      ans(el.dataset.ans).value = el.value.trim() === '' ? null : el.value;
      el.closest('.q').classList.toggle('is-done', el.value.trim() !== '');
      persistSoon(); updateProgress();
    }
  };

  app.onclick = async e => {
    const t = e.target.closest('button, [data-act]');
    if (!t) return;
    if (t.dataset.jump) { document.getElementById(t.dataset.jump)?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (t.dataset.clear) { ans(t.dataset.clear).value = null; await persist(); refreshCard(t.dataset.clear); return; }
    if (t.dataset.delPhoto) {
      if (!confirm('Remover esta foto?')) return;
      const qid = t.dataset.qid;
      await db.del('photos', t.dataset.delPhoto);
      ans(qid).photos = ans(qid).photos.filter(p => p !== t.dataset.delPhoto);
      await persist(); refreshCard(qid);
      return;
    }
    if (t.dataset.act === 'gps') await captureGps(v, $('#gps'), t);
    if (t.dataset.act === 'del') {
      if (!confirm('Excluir esta visita e todas as fotos dela? Esta ação não pode ser desfeita.')) return;
      await deleteVisit(v);
      onFlush(null);
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
    v.updatedAt = nowIso();
    await db.put('visits', v);
    const prop = await db.get('properties', v.propertyId);
    if (prop && !prop.gps) { prop.gps = v.gps; await db.put('properties', prop); }
    out.textContent = '📍 ' + fmtGps(v.gps);
    toast('Localização registrada');
  } catch (err) {
    out.textContent = err.message;
    toast(err.message, 'bad');
  } finally { if (btn) btn.disabled = false; }
}

export async function deleteVisit(v) {
  for (const a of Object.values(v.answers || {})) for (const pid of a.photos || []) await db.del('photos', pid);
  await db.del('visits', v.id);
}

/* ---------------- Revisão e finalização ---------------- */

export function scoreSummaryHTML(sc) {
  return `
  <div class="scores">
    <div class="score-main ${scoreClass(sc.overall, sc.critical.length)}">
      <span class="big">${pct(sc.overall)}</span>
      <span>Índice geral de conformidade</span>
      <b>${classify(sc.overall, sc.critical.length)}</b>
    </div>
    ${['E', 'S', 'G'].map(p => {
      const d = sc.pillars[p];
      return `<div class="score-p ${scoreClass(d.pct)}">
        <span class="lbl">${pillarTag(p)} ${PILLARS[p]}</span>
        <span class="val">${pct(d.pct)}</span>
        <div class="progress"><div style="width:${(d.pct ?? 0) * 100}%"></div></div>
        <small class="muted">${d.count} item(ns) avaliado(s)</small>
      </div>`;
    }).join('')}
  </div>
  ${sc.critical.length ? `<div class="card alert bad"><b>⚠ ${sc.critical.length} não conformidade(s) crítica(s)</b>
    <ul>${sc.critical.map(c => `<li>${esc(c.q.text)}</li>`).join('')}</ul></div>` : ''}`;
}

export async function closeVisit(app, id) {
  const v = await db.get('visits', id);
  if (!v) throw new Error('Visita não encontrada.');
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
  const persist = async () => { v.updatedAt = nowIso(); await db.put('visits', v); };
  const persistSoon = debounce(persist, 500);

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

  const pad = signaturePad($('#sig'), { onEnd: () => { v.signature = pad.toDataURL(); persistSoon(); } });
  pad.load(v.signature);
  onFlush(persist);
  onLeave(() => pad.destroy());

  app.oninput = e => {
    const el = e.target;
    if (el.dataset.plan) { (v.actionPlan[el.dataset.plan] ||= {})[el.dataset.f] = el.value; persistSoon(); }
    if (el.id === 'signer') { v.signerName = el.value; persistSoon(); }
  };

  app.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.goto) { sessionStorage.setItem('esg-jump', t.dataset.goto); location.hash = `#/visita/${id}`; return; }
    if (t.dataset.act === 'gps') { await captureGps(v, $('#gps'), t); return; }
    if (t.dataset.act === 'sig-clear') { pad.clear(); v.signature = null; persistSoon(); return; }
    if (t.dataset.act === 'finish') {
      if (pad.isEmpty() && !confirm('A visita está sem a assinatura do produtor. Finalizar mesmo assim?')) return;
      v.signature = pad.isEmpty() ? null : pad.toDataURL();
      v.signerName = $('#signer').value.trim();
      const prop = await db.get('properties', v.propertyId);
      if (prop) v.property = { ...prop };
      v.scores = summarizeScores(computeScores(Q, v.answers));
      v.status = 'finalizada';
      v.finishedAt = nowIso();
      await persist();
      toast('Visita finalizada');
      location.hash = `#/visita/${id}/relatorio`;
    }
  };
}

/* ---------------- Relatório ---------------- */

export async function report(app, id) {
  const [v, settings] = await Promise.all([db.get('visits', id), getSettings()]);
  if (!v) throw new Error('Visita não encontrada.');
  const Q = v.questionnaire;
  const sc = computeScores(Q, v.answers);
  const p = v.property || {};
  const plans = sc.nonConform.filter(n => Object.values(v.actionPlan?.[n.q.id] || {}).some(Boolean));
  const done = v.status === 'finalizada';

  app.innerHTML = `
    <div class="no-print row wrap gap">
      <a href="#/" class="btn ghost">← Visitas</a>
      <button type="button" class="btn primary" data-act="print">Imprimir / PDF</button>
      <button type="button" class="btn" data-act="csv">Exportar CSV</button>
      ${done ? '<button type="button" class="btn ghost" data-act="reopen">Reabrir visita</button>'
             : `<a class="btn ghost" href="#/visita/${id}">Continuar preenchimento</a>`}
    </div>
    ${done ? '' : '<div class="card alert warn no-print">Visita ainda em andamento — relatório parcial.</div>'}
    <section class="report">
      <header class="report-head">
        ${settings.org ? `<p class="eyebrow">${esc(settings.org)}</p>` : ''}
        <h1>Relatório de visita — ${esc(Q.title)}</h1>
        <p class="muted">Versão ${Q.version} do questionário · ${done ? 'Finalizada em ' + fmtDate(v.finishedAt) : 'Em andamento'}</p>
      </header>

      <div class="card">
        <dl class="facts">
          <div><dt>Produtor</dt><dd>${esc(p.producer)}${p.document ? ' · ' + esc(p.document) : ''}</dd></div>
          <div><dt>Propriedade</dt><dd>${esc(p.name)}</dd></div>
          <div><dt>Município/UF</dt><dd>${esc(p.municipality) || '—'}${p.uf ? '/' + esc(p.uf) : ''}</dd></div>
          <div><dt>CAR</dt><dd>${esc(p.car) || '—'}</dd></div>
          <div><dt>Área</dt><dd>${p.area ? esc(p.area) + ' ha' : '—'}</dd></div>
          <div><dt>Orientador</dt><dd>${esc(v.orientador)}</dd></div>
          <div><dt>Início da visita</dt><dd>${fmtDate(v.startedAt)}</dd></div>
          <div><dt>Localização</dt><dd>${v.gps ? `<a href="${mapsLink(v.gps)}" target="_blank" rel="noopener">${esc(fmtGps(v.gps))}</a>` : '—'}</dd></div>
        </dl>
      </div>

      <h2>Resultado</h2>
      ${scoreSummaryHTML(sc)}

      <h2>Respostas</h2>
      ${Q.sections.map((s, si) => `
        <div class="card report-sec">
          <h3>${pillarTag(s.pillar)} ${esc(s.title)}</h3>
          <table class="answers">
            <thead><tr><th>Nº</th><th>Pergunta</th><th>Resposta</th></tr></thead>
            <tbody>${s.questions.map((q, qi) => {
              const a = v.answers[q.id] || {};
              const nc = isNonConform(q, a.value);
              return `<tr class="${nc ? 'nc' : ''}">
                <td>${si + 1}.${qi + 1}</td>
                <td>${esc(q.text)}${q.critical ? ' <span class="badge crit">Crítica</span>' : ''}
                  ${a.note ? `<div class="note-text">Obs.: ${esc(a.note)}</div>` : ''}
                  ${(a.photos || []).length ? `<div class="thumbs" data-rphotos="${q.id}"></div>` : ''}</td>
                <td class="ans">${esc(formatAnswer(q, a.value))}</td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>`).join('')}

      <h2>Plano de ação</h2>
      <div class="card">${plans.length ? `
        <table class="answers">
          <thead><tr><th>Item</th><th>Ação corretiva</th><th>Responsável</th><th>Prazo</th></tr></thead>
          <tbody>${plans.map(({ q }) => {
            const pl = v.actionPlan[q.id];
            return `<tr><td>${esc(q.text)}</td><td>${esc(pl.action)}</td><td>${esc(pl.responsible)}</td><td>${fmtDay(pl.deadline)}</td></tr>`;
          }).join('')}</tbody></table>` : '<p class="muted">Nenhuma ação registrada.</p>'}
      </div>

      <div class="card signature">
        ${v.signature ? `<img src="${v.signature}" alt="Assinatura do produtor">` : '<p class="muted">Sem assinatura.</p>'}
        <p>${esc(v.signerName || p.producer)}<br><small class="muted">Produtor / responsável pela propriedade</small></p>
      </div>
    </section>`;

  for (const [qid, a] of Object.entries(v.answers)) {
    if (a.photos?.length) renderThumbs($(`[data-rphotos="${qid}"]`), a.photos);
  }

  app.onclick = async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'print') window.print();
    if (act === 'csv') {
      const base = `visita-${slug(p.name)}-${(v.startedAt || '').slice(0, 10)}`;
      download(base + '-respostas.csv', csvAnswers([v]), 'text/csv;charset=utf-8');
      setTimeout(() => download(base + '-resumo.csv', csvSummary([v]), 'text/csv;charset=utf-8'), 400);
    }
    if (act === 'reopen') {
      if (!confirm('Reabrir a visita para edição? A assinatura será removida e precisará ser coletada novamente.')) return;
      Object.assign(v, { status: 'andamento', finishedAt: null, signature: null, scores: null, updatedAt: nowIso() });
      await db.put('visits', v);
      location.hash = `#/visita/${id}`;
    }
  };
}

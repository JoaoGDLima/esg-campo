// Acompanhamento das visitas enviadas pelos orientadores.
import * as fb from '../../shared/firebase.js';
import { $, esc, fmtDate, toast, pct, download, today, slug, nowIso, onLeave } from '../../shared/util.js';
import { scoreClass } from '../../shared/scoring.js';
import { reportHTML } from '../../shared/report.js';
import { csvAnswers, csvSummary } from '../../shared/csv.js';
import { watchVisits, getFilters, applyFilters, filterBarHTML, bindFilters, tsDate, REVIEW } from './data.js';

const scoreChip = (v) => v.status !== 'finalizada' ? '<span class="muted small">—</span>'
  : `<span class="score-chip ${scoreClass(v.scores?.overall, v.scores?.critical)}">${v.scores?.critical ? '⚠ ' : ''}${pct(v.scores?.overall)}</span>`;

export async function visitsList(app) {
  const f = getFilters();
  let all = [];
  app.innerHTML = '<p class="muted">Carregando visitas…</p>';

  const draw = () => {
    const rows = applyFilters(all, f).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    app.innerHTML = `
      <div class="row between wrap"><h1>Visitas</h1>
        <div class="row wrap gap">
          <button type="button" class="btn small" data-act="csv-summary" ${rows.length ? '' : 'disabled'}>CSV resumo</button>
          <button type="button" class="btn small" data-act="csv-answers" ${rows.length ? '' : 'disabled'}>CSV respostas</button>
        </div></div>
      ${filterBarHTML(all, f)}
      <p class="muted small">${rows.length} visita(s) · atualiza automaticamente quando os orientadores sincronizam</p>
      <div class="table-wrap card flush">
        <table class="data">
          <thead><tr><th>Propriedade</th><th>Município</th><th>Orientador</th><th>Início</th><th>Situação</th><th class="num">Índice</th><th>Revisão</th><th>Recebida</th></tr></thead>
          <tbody>${rows.map(v => {
            const rv = REVIEW[v.review?.status || 'pendente'];
            const prog = v.progress ? `${v.progress.answered}/${v.progress.total}` : '';
            return `<tr data-href="#/visitas/${v.id}" tabindex="0">
              <td><b>${esc(v.propertyName)}</b><br><small class="muted">${esc(v.producer)}</small></td>
              <td>${esc(v.municipality)}${v.uf ? '/' + esc(v.uf) : ''}</td>
              <td>${esc(v.orientadorName)}</td>
              <td>${fmtDate(v.startedAt)}</td>
              <td>${v.status === 'finalizada' ? '<span class="badge ok">Finalizada</span>' : `<span class="badge">Em andamento · ${prog}</span>`}</td>
              <td class="num">${scoreChip(v)}</td>
              <td>${v.status === 'finalizada' ? `<span class="badge ${rv.cls}">${rv.label}</span>` : ''}</td>
              <td><small>${fmtDate(tsDate(v.syncedAt))}</small></td></tr>`;
          }).join('') || '<tr><td colspan="8" class="center muted">Nenhuma visita com estes filtros.</td></tr>'}</tbody>
        </table>
      </div>`;
    bindFilters(app, f, draw);
  };

  const stop = watchVisits((visits, err) => {
    if (err) { app.innerHTML = `<div class="card alert bad">${esc(fb.errorMessage(err))}</div>`; return; }
    all = visits;
    draw();
  });

  app.onclick = e => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) { location.hash = tr.dataset.href; return; }
    const act = e.target.closest('button[data-act]')?.dataset.act;
    if (!act) return;
    const rows = applyFilters(all, f);
    const csv = act === 'csv-summary' ? csvSummary(rows) : csvAnswers(rows);
    download(`esg-${act === 'csv-summary' ? 'resumo' : 'respostas'}-${today()}.csv`, csv, 'text/csv;charset=utf-8');
  };
  app.onkeydown = e => { if (e.key === 'Enter' && e.target.dataset.href) location.hash = e.target.dataset.href; };
  onLeave(() => { stop(); app.onkeydown = null; });
}

export async function visitDetail(app, id) {
  const ref = fb.doc(fb.fs, 'visits', id);
  const cfg = await fb.getDoc(fb.doc(fb.fs, 'settings', 'app'));
  const org = cfg.exists() ? cfg.data().org || '' : '';
  let v = null;
  let photosKey = '';
  let photos = {};

  const loadPhotos = async () => {
    const key = Object.values(v.answers || {}).flatMap(a => a.photos || []).join(',');
    if (key === photosKey) return;
    photosKey = key;
    const snap = await fb.getDocs(fb.query(fb.collection(fb.fs, 'photos'), fb.where('visitId', '==', id)));
    photos = Object.fromEntries(snap.docs.map(d => [d.id, d.data().data]));
  };

  const draw = async () => {
    await loadPhotos();
    const rv = v.review || { status: 'pendente', note: '' };
    const done = v.status === 'finalizada';
    app.innerHTML = `
      <div class="no-print row wrap gap">
        <a href="#/visitas" class="btn ghost">← Visitas</a>
        <button type="button" class="btn primary" data-act="print">Imprimir / PDF</button>
        <button type="button" class="btn" data-act="csv">CSV</button>
        <span class="spacer"></span>
        <button type="button" class="btn danger ghost small" data-act="del">Excluir visita</button>
      </div>
      <div class="card no-print stack">
        <div class="row wrap gap small">
          ${done ? '<span class="badge ok">Finalizada</span>' : `<span class="badge">Em andamento · ${v.progress?.answered ?? 0}/${v.progress?.total ?? 0} respondidas</span>`}
          <span class="muted">Última sincronização: ${fmtDate(tsDate(v.syncedAt))}</span>
        </div>
        ${done ? `
        <form id="review" class="review-form">
          <label>Revisão<select name="status">
            ${Object.entries(REVIEW).map(([k, r]) => `<option value="${k}" ${rv.status === k ? 'selected' : ''}>${r.label}</option>`).join('')}
          </select></label>
          <label class="grow">Comentário interno<input name="note" value="${esc(rv.note)}" placeholder="Observações da coordenação"></label>
          <button class="btn small">Salvar revisão</button>
        </form>
        ${rv.by ? `<p class="small muted">Revisado por ${esc(rv.by)} em ${fmtDate(rv.at)}</p>` : ''}` : '<p class="small muted">A revisão fica disponível quando o orientador finalizar a visita.</p>'}
      </div>
      ${reportHTML(v, { org })}`;

    for (const [qid, a] of Object.entries(v.answers || {})) {
      const box = app.querySelector(`[data-rphotos="${qid}"]`);
      if (box) box.innerHTML = (a.photos || []).filter(p => photos[p]).map(p =>
        `<figure class="thumb"><img src="${photos[p]}" alt="Foto de evidência" data-zoom loading="lazy"></figure>`).join('')
        || '<small class="muted">Foto ainda não recebida.</small>';
    }
    const form = $('#review');
    if (form) form.onsubmit = async e => {
      e.preventDefault();
      const me = fb.auth.currentUser;
      const snap = await fb.getDoc(fb.doc(fb.fs, 'users', me.uid));
      await fb.updateDoc(ref, { review: {
        status: form.status.value, note: form.note.value.trim(),
        by: snap.data()?.name || me.email, byUid: me.uid, at: nowIso(),
      } });
      toast('Revisão salva');
    };
  };

  const stop = fb.onSnapshot(ref, async snap => {
    if (!snap.exists()) { app.innerHTML = '<div class="card alert bad">Visita não encontrada (pode ter sido excluída).</div>'; return; }
    const first = !v;
    v = { id: snap.id, ...snap.data() };
    // Evita redesenhar enquanto o admin digita na revisão.
    if (first || !document.activeElement?.closest('#review')) await draw();
  }, err => { app.innerHTML = `<div class="card alert bad">${esc(fb.errorMessage(err))}</div>`; });
  onLeave(stop);

  app.onclick = async e => {
    const img = e.target.closest('img[data-zoom]');
    if (img) {
      const box = document.createElement('div');
      box.className = 'lightbox';
      box.innerHTML = `<img src="${img.src}" alt="Foto ampliada">`;
      box.onclick = () => box.remove();
      document.body.append(box);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'print') window.print();
    if (act === 'csv') {
      const base = `visita-${slug(v.propertyName)}-${(v.startedAt || '').slice(0, 10)}`;
      download(base + '-respostas.csv', csvAnswers([v]), 'text/csv;charset=utf-8');
    }
    if (act === 'del') {
      if (!confirm('Excluir esta visita e suas fotos do servidor? Se ainda estiver no aparelho do orientador, ela pode ser reenviada.')) return;
      const batch = fb.writeBatch(fb.fs);
      const ps = await fb.getDocs(fb.query(fb.collection(fb.fs, 'photos'), fb.where('visitId', '==', id)));
      ps.docs.forEach(d => batch.delete(d.ref));
      batch.delete(ref);
      await batch.commit();
      toast('Visita excluída');
      location.hash = '#/visitas';
    }
  };
}

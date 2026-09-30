// Relatório da visita (mesmo layout no app de campo e no painel admin).
import { esc, fmtDate, fmtDay, pct, PILLARS } from './util.js';
import { computeScores, classify, scoreClass, formatAnswer, isNonConform } from './scoring.js';

export const pillarTag = (p) => `<span class="pillar-tag pillar-${esc(p)}" title="${esc(PILLARS[p] || p)}">${esc(p)}</span>`;

export const fmtGps = (g) => (g ? `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)} (±${g.accuracy} m)` : '');
export const mapsLink = (g) => `https://www.google.com/maps?q=${g.lat},${g.lng}`;

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

// As fotos entram em <div data-rphotos="ID_DA_PERGUNTA">, preenchidas por quem chama.
export function reportHTML(v, { org = '' } = {}) {
  const Q = v.questionnaire;
  const sc = computeScores(Q, v.answers || {});
  const p = v.property || {};
  const done = v.status === 'finalizada';
  const plans = sc.nonConform.filter(n => Object.values(v.actionPlan?.[n.q.id] || {}).some(Boolean));
  return `
    <section class="report">
      <header class="report-head">
        ${org ? `<p class="eyebrow">${esc(org)}</p>` : ''}
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
          <div><dt>Orientador</dt><dd>${esc(v.orientadorName || v.orientador)}</dd></div>
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
              const a = v.answers?.[q.id] || {};
              return `<tr class="${isNonConform(q, a.value) ? 'nc' : ''}">
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
}

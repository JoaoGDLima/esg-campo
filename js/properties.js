// Cadastro de produtores / propriedades.
import { db, uid } from './db.js';
import { $, esc, toast, nowIso, UFS } from './util.js';
import { getPosition, fmtGps } from './media.js';

const FIELDS = ['producer', 'document', 'name', 'municipality', 'uf', 'car', 'area', 'phone', 'notes'];

export function propertyFields(p = {}) {
  return `
    <label>Nome do produtor *<input name="producer" required autocomplete="off" value="${esc(p.producer)}"></label>
    <label>CPF / CNPJ<input name="document" inputmode="numeric" autocomplete="off" value="${esc(p.document)}"></label>
    <label>Nome da propriedade *<input name="name" required autocomplete="off" value="${esc(p.name)}"></label>
    <div class="grid2">
      <label>Município<input name="municipality" value="${esc(p.municipality)}"></label>
      <label>UF<select name="uf"><option value=""></option>${UFS.map(u => `<option ${p.uf === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
    </div>
    <div class="grid2">
      <label>Nº do CAR<input name="car" value="${esc(p.car)}"></label>
      <label>Área total (ha)<input name="area" type="number" step="any" min="0" inputmode="decimal" value="${esc(p.area)}"></label>
    </div>
    <label>Telefone<input name="phone" type="tel" value="${esc(p.phone)}"></label>`;
}

export function readPropertyForm(fd) {
  const o = {};
  for (const k of FIELDS) o[k] = (fd.get(k) ?? '').toString().trim();
  return o;
}

export async function propertiesList(app) {
  const [props, visits] = await Promise.all([db.all('properties'), db.all('visits')]);
  props.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const count = {};
  visits.forEach(v => { count[v.propertyId] = (count[v.propertyId] || 0) + 1; });

  app.innerHTML = `
    <div class="row between"><h1>Propriedades</h1><a class="btn primary" href="#/propriedades/nova">+ Nova</a></div>
    ${props.length ? `<input type="search" id="q" placeholder="Buscar por produtor, propriedade ou município" class="search">` : ''}
    <div id="list" class="list">${props.length ? '' : '<div class="card empty">Nenhuma propriedade cadastrada ainda.</div>'}</div>`;

  const draw = (term = '') => {
    const t = term.toLowerCase();
    const rows = props.filter(p => !t || [p.name, p.producer, p.municipality].join(' ').toLowerCase().includes(t));
    if (!props.length) return;
    $('#list').innerHTML = rows.map(p => `
      <a class="item" href="#/propriedades/${p.id}">
        <div><b>${esc(p.name)}</b><small>${esc(p.producer)}${p.municipality ? ' · ' + esc(p.municipality) + (p.uf ? '/' + esc(p.uf) : '') : ''}</small></div>
        <span class="muted small">${count[p.id] || 0} visita(s)</span>
      </a>`).join('') || '<p class="muted">Nada encontrado.</p>';
  };
  draw();
  app.oninput = e => { if (e.target.id === 'q') draw(e.target.value); };
}

export async function propertyForm(app, id) {
  const isNew = id === 'nova';
  const p = isNew ? {} : await db.get('properties', id);
  if (!p) throw new Error('Propriedade não encontrada.');
  let gps = p.gps || null;

  app.innerHTML = `
    <a href="#/propriedades" class="back">← Propriedades</a>
    <h1>${isNew ? 'Nova propriedade' : esc(p.name)}</h1>
    <form id="f" class="card stack">
      ${propertyFields(p)}
      <div class="gps-row"><span id="gps">${gps ? '📍 ' + esc(fmtGps(gps)) : '<span class="muted">Localização não registrada</span>'}</span>
        <button type="button" class="btn small" data-act="gps">Registrar GPS</button></div>
      <label>Observações<textarea name="notes" rows="3">${esc(p.notes)}</textarea></label>
      <button class="btn primary block">Salvar</button>
    </form>
    ${isNew ? '' : '<button class="btn danger ghost" data-act="del">Excluir propriedade</button>'}`;

  $('#f').onsubmit = async e => {
    e.preventDefault();
    const data = readPropertyForm(new FormData(e.target));
    const rec = { ...p, ...data, gps, id: p.id || uid(), createdAt: p.createdAt || nowIso(), updatedAt: nowIso() };
    await db.put('properties', rec);
    toast('Propriedade salva');
    location.hash = '#/propriedades';
  };

  app.onclick = async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'gps') {
      const out = $('#gps');
      out.textContent = 'Obtendo localização…';
      try { gps = await getPosition(); out.textContent = '📍 ' + fmtGps(gps); }
      catch (err) { out.textContent = err.message; toast(err.message, 'bad'); }
    }
    if (act === 'del') {
      if (!confirm('Excluir esta propriedade? As visitas já feitas continuam guardadas com os dados da época.')) return;
      await db.del('properties', p.id);
      toast('Propriedade excluída');
      location.hash = '#/propriedades';
    }
  };
}

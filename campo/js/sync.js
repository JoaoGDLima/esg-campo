// Sincronização com o Firestore.
//
// O app de campo sempre lê e grava no IndexedDB do aparelho (funciona sem internet).
// Quando há conexão, syncNow():
//   1. baixa configurações, questionários publicados e propriedades alteradas;
//   2. envia propriedades, fotos, exclusões pendentes e visitas (em andamento e finalizadas).
// Cada registro local tem "rev" (alterações locais) e "syncedRev" (última revisão enviada);
// se o usuário editar durante o envio, o registro continua pendente e vai na próxima rodada.
// O Firebase só é carregado quando há sincronização/login, então o app abre offline normalmente.
import { db, getSession, setSession, getMeta, setMeta, isPending } from './db.js';
import { computeScores, summarizeScores, progress } from '../../shared/scoring.js';
import { nowIso } from '../../shared/util.js';

let fbPromise;
export function loadFirebase() {
  fbPromise ||= import('../../shared/firebase.js').catch(err => { fbPromise = null; throw err; });
  return fbPromise;
}

function withTimeout(promise, ms, what) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(Object.assign(new Error(`Tempo esgotado ao ${what}. Sinal fraco?`), { code: 'timeout' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

export const syncState = { running: false, lastSync: null, error: null, pending: 0, needLogin: false };
const emit = () => document.dispatchEvent(new CustomEvent('esg:sync', { detail: { ...syncState } }));

export async function countPending() {
  const s = await getSession();
  if (!s) return 0;
  const [visits, props, photos, outbox] = await Promise.all([
    db.all('visits'), db.all('properties'), db.all('photos'), db.all('outbox')]);
  return visits.filter(v => v.orientadorUid === s.uid && isPending(v)).length
    + props.filter(isPending).length + photos.filter(p => !p.synced).length + outbox.length;
}

export async function refreshPending() {
  syncState.pending = await countPending();
  syncState.lastSync = await getMeta('lastSync');
  emit();
  return syncState.pending;
}

let running = null;
// Nunca lança erro: retorna { ok, error }. Chamadas simultâneas reaproveitam a mesma execução.
export function syncNow() {
  running ||= run().finally(() => { running = null; });
  return running;
}

async function run() {
  syncState.running = true; syncState.error = null; emit();
  try {
    if (!navigator.onLine) throw new Error('Sem internet no momento.');
    const session = await getSession();
    if (!session) throw new Error('Faça login para sincronizar.');
    const fb = await withTimeout(loadFirebase(), 20000, 'carregar o Firebase');
    fb.assertConfigured();
    const user = await withTimeout(fb.currentUser(), 15000, 'verificar a sessão');
    if (!user || user.uid !== session.uid) {
      syncState.needLogin = true;
      throw new Error('Sessão expirada. Entre novamente para sincronizar.');
    }
    syncState.needLogin = false;
    const ctx = { fb, fs: fb.fs, session };
    await pullProfileAndConfig(ctx);
    await pullQuestionnaires(ctx);
    await pushProperties(ctx);
    await pullProperties(ctx);
    await pushPhotos(ctx);
    await pushOutbox(ctx);
    await pushVisits(ctx);
    await setMeta('lastSync', nowIso());
    return { ok: true };
  } catch (err) {
    console.warn('Sincronização falhou', err);
    const fb = await loadFirebase().catch(() => null);
    syncState.error = fb ? fb.errorMessage(err) : err.message;
    return { ok: false, error: syncState.error };
  } finally {
    syncState.running = false;
    await refreshPending();
  }
}

async function markSynced(store, id, rev) {
  const cur = await db.get(store, id);
  if (cur) { cur.syncedRev = rev; await db.put(store, cur); }
}

const stripLocal = ({ rev, syncedRev, ...rest }) => rest;

async function pullProfileAndConfig({ fb, fs, session }) {
  const profile = await withTimeout(fb.getProfile(session.uid), 20000, 'ler o perfil');
  const problem = fb.profileProblem(profile, 'orientador');
  if (problem) throw new Error(problem);
  if (profile.name !== session.name) await setSession({ ...session, name: profile.name });
  const cfg = await withTimeout(fb.getDoc(fb.doc(fs, 'settings', 'app')), 20000, 'ler as configurações');
  await setMeta('org', cfg.exists() ? (cfg.data().org || '') : '');
}

async function pullQuestionnaires({ fb, fs }) {
  const snap = await withTimeout(
    fb.getDocs(fb.query(fb.collection(fs, 'questionnaires'), fb.where('isPublished', '==', true))),
    30000, 'baixar questionários');
  const ids = new Set();
  for (const d of snap.docs) {
    const { published } = d.data();
    if (!published) continue;
    ids.add(d.id);
    await db.put('questionnaires', { id: d.id, published });
  }
  // Questionários arquivados pelo admin somem para novas visitas (visitas em andamento guardam a sua cópia).
  for (const q of await db.all('questionnaires')) if (!ids.has(q.id)) await db.del('questionnaires', q.id);
}

async function pushProperties({ fb, fs, session }) {
  for (const p of (await db.all('properties')).filter(isPending)) {
    const rev = p.rev;
    await withTimeout(fb.setDoc(fb.doc(fs, 'properties', p.id), {
      ...stripLocal(p), createdBy: p.createdBy || session.uid, updatedBy: session.uid,
      serverUpdatedAt: fb.serverTimestamp(),
    }, { merge: true }), 30000, 'enviar propriedade');
    await markSynced('properties', p.id, rev);
  }
}

async function pullProperties({ fb, fs }) {
  const last = await getMeta('propsPulledAt', 0);
  let q = fb.collection(fs, 'properties');
  if (last) q = fb.query(q, fb.where('serverUpdatedAt', '>', fb.Timestamp.fromMillis(last)));
  const snap = await withTimeout(fb.getDocs(q), 30000, 'baixar propriedades');
  let max = last;
  for (const d of snap.docs) {
    const { serverUpdatedAt, ...data } = d.data();
    max = Math.max(max, serverUpdatedAt?.toMillis?.() || 0);
    const local = await db.get('properties', d.id);
    if (local && isPending(local)) continue; // alteração local ainda não enviada tem prioridade
    const rev = local?.rev || 1;
    await db.put('properties', { ...data, id: d.id, rev, syncedRev: rev });
  }
  await setMeta('propsPulledAt', max);
}

const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result); r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

// Documento do Firestore tem limite de 1 MiB: reduz a foto se necessário.
async function photoDataUrl(blob) {
  let data = await blobToDataURL(blob);
  for (const [max, q] of [[1024, 0.65], [800, 0.55]]) {
    if (data.length < 900_000) break;
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    data = c.toDataURL('image/jpeg', q);
  }
  return data;
}

async function pushPhotos({ fb, fs, session }) {
  for (const p of (await db.all('photos')).filter(p => !p.synced)) {
    const v = await db.get('visits', p.visitId);
    if (!v) { await db.del('photos', p.id); continue; }
    if (v.orientadorUid !== session.uid) continue;
    await withTimeout(fb.setDoc(fb.doc(fs, 'photos', p.id), {
      visitId: p.visitId, qid: p.qid, orientadorUid: session.uid,
      data: await photoDataUrl(p.blob), createdAt: p.createdAt,
    }), 90000, 'enviar foto');
    const cur = await db.get('photos', p.id);
    if (cur) { cur.synced = true; await db.put('photos', cur); }
  }
}

async function pushOutbox({ fb, fs }) {
  for (const item of await db.all('outbox')) {
    try {
      await withTimeout(fb.deleteDoc(fb.doc(fs, item.coll, item.docId)), 30000, 'enviar exclusão');
    } catch (err) {
      if (err.code !== 'permission-denied' && err.code !== 'not-found') throw err;
    }
    await db.del('outbox', item.id);
  }
}

async function pushVisits({ fb, fs, session }) {
  const visits = (await db.all('visits')).filter(v => v.orientadorUid === session.uid && isPending(v));
  for (const v of visits) {
    const rev = v.rev;
    const answers = v.answers || {};
    const pr = progress(v.questionnaire, answers);
    const p = v.property || {};
    await withTimeout(fb.setDoc(fb.doc(fs, 'visits', v.id), {
      ...stripLocal(v),
      orientadorUid: session.uid,
      orientadorName: v.orientadorName || session.name,
      // Campos resumidos para listagens e painel do admin.
      questionnaireId: v.questionnaire.id,
      propertyName: p.name || '', producer: p.producer || '', municipality: p.municipality || '', uf: p.uf || '',
      scores: summarizeScores(computeScores(v.questionnaire, answers)),
      progress: { answered: pr.answered, total: pr.total },
      syncedAt: fb.serverTimestamp(),
    }, { merge: true }), 45000, 'enviar visita');
    await markSynced('visits', v.id, rev);
  }
}

// Recupera as visitas do orientador que estão no servidor e não neste aparelho (ex.: celular novo).
export async function restoreFromServer() {
  const session = await getSession();
  const fb = await loadFirebase();
  const { fs } = fb;
  const snap = await withTimeout(fb.getDocs(fb.query(fb.collection(fs, 'visits'),
    fb.where('orientadorUid', '==', session.uid))), 60000, 'baixar visitas');
  let visits = 0, photos = 0;
  for (const d of snap.docs) {
    if (await db.get('visits', d.id)) continue;
    const { syncedAt, ...data } = d.data();
    await db.put('visits', { ...data, id: d.id, rev: 1, syncedRev: 1 });
    visits++;
    const ps = await withTimeout(fb.getDocs(fb.query(fb.collection(fs, 'photos'),
      fb.where('orientadorUid', '==', session.uid), fb.where('visitId', '==', d.id))), 60000, 'baixar fotos');
    for (const pd of ps.docs) {
      const ph = pd.data();
      const blob = await (await fetch(ph.data)).blob();
      await db.put('photos', { id: pd.id, visitId: ph.visitId, qid: ph.qid, blob, createdAt: ph.createdAt, synced: true });
      photos++;
    }
  }
  await refreshPending();
  return { visits, photos };
}

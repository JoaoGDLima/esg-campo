// Armazenamento local (IndexedDB). O app de campo trabalha sempre aqui;
// a sincronização (sync.js) envia e recebe dados do Firestore quando há internet.
import { nowIso } from '../../shared/util.js';

const DB_NAME = 'esg-campo';
const DB_VERSION = 2;
// outbox: exclusões que ainda precisam ser enviadas ao servidor.
export const STORES = ['questionnaires', 'properties', 'visits', 'photos', 'meta', 'outbox'];

let dbPromise;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    let out;
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transação abortada'));
  });
}

export const db = {
  get: (store, id) => tx(store, 'readonly', s => s.get(id)),
  all: (store) => tx(store, 'readonly', s => s.getAll()),
  put: (store, value) => tx(store, 'readwrite', s => s.put(value)),
  del: (store, id) => tx(store, 'readwrite', s => s.delete(id)),
  clear: (store) => tx(store, 'readwrite', s => s.clear()),
};

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Toda alteração local incrementa "rev"; a sincronização marca "syncedRev" com a revisão enviada.
// Pendente de envio = rev !== syncedRev.
export async function saveLocal(store, rec) {
  rec.rev = (rec.rev || 0) + 1;
  rec.updatedAt = nowIso();
  await db.put(store, rec);
  document.dispatchEvent(new CustomEvent('esg:changed'));
  return rec;
}
export const isPending = (rec) => (rec.rev || 0) !== (rec.syncedRev || 0);
export const wasSynced = (rec) => (rec.syncedRev || 0) > 0;

export async function getSession() { return (await db.get('meta', 'session')) || null; }
export async function setSession(s) { await db.put('meta', { ...s, id: 'session' }); }

export async function getMeta(key, fallback = null) { return (await db.get('meta', key))?.value ?? fallback; }
export async function setMeta(key, value) { await db.put('meta', { id: key, value }); }

export async function myVisits() {
  const s = await getSession();
  return (await db.all('visits')).filter(v => v.orientadorUid === s?.uid);
}

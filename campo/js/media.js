// Fotos (compressão + miniaturas) e GPS.
import { db } from './db.js';
import { esc } from '../../shared/util.js';

const objectUrls = new Set();

export function revokeObjectUrls() {
  objectUrls.forEach(u => URL.revokeObjectURL(u));
  objectUrls.clear();
}

export async function photoUrl(photoId) {
  const p = await db.get('photos', photoId);
  if (!p) return null;
  const url = URL.createObjectURL(p.blob);
  objectUrls.add(url);
  return url;
}

// Reduz a foto para economizar espaço e dados móveis (máx. 1280 px, JPEG 72%).
export async function compressImage(file, max = 1280, quality = 0.72) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await createImageBitmap(file); }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem'))), 'image/jpeg', quality));
}

export async function renderThumbs(container, photoIds = [], { removable = false, qid = '' } = {}) {
  if (!container) return;
  const items = await Promise.all(photoIds.map(async id => ({ id, url: await photoUrl(id) })));
  container.innerHTML = items.filter(i => i.url).map(i => `
    <figure class="thumb">
      <img src="${i.url}" alt="Foto de evidência" data-zoom loading="lazy">
      ${removable ? `<button type="button" class="thumb-del" data-del-photo="${esc(i.id)}" data-qid="${esc(qid)}" aria-label="Remover foto">×</button>` : ''}
    </figure>`).join('');
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('GPS indisponível neste aparelho.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({
        lat: p.coords.latitude, lng: p.coords.longitude,
        accuracy: Math.round(p.coords.accuracy), at: new Date().toISOString(),
      }),
      e => reject(new Error(
        e.code === 1 ? 'Permissão de localização negada.' :
        e.code === 3 ? 'Tempo esgotado ao obter a localização. Tente em área aberta.' :
        'Não foi possível obter a localização.')),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
  });
}


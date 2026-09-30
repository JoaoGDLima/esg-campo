// Campo de assinatura em canvas (dedo, caneta ou mouse).
export function signaturePad(canvas, { onEnd } = {}) {
  const ctx = canvas.getContext('2d');
  let empty = true, drawing = false, last = null, snapshot = null;

  function setup() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, r.width, r.height);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    if (snapshot) drawImage(snapshot);
  }

  function drawImage(dataUrl) {
    const img = new Image();
    img.onload = () => {
      const r = canvas.getBoundingClientRect();
      ctx.drawImage(img, 0, 0, r.width, r.height);
    };
    img.src = dataUrl;
  }

  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  canvas.addEventListener('pointerdown', e => {
    drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId);
    ctx.beginPath(); ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; empty = false;
  });
  const end = () => {
    if (!drawing) return;
    drawing = false; empty = false;
    snapshot = canvas.toDataURL('image/png');
    onEnd?.();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  window.addEventListener('resize', setup);

  setup();

  return {
    isEmpty: () => empty,
    toDataURL: () => canvas.toDataURL('image/png'),
    clear() { empty = true; snapshot = null; setup(); },
    load(dataUrl) { if (!dataUrl) return; snapshot = dataUrl; empty = false; drawImage(dataUrl); },
    destroy() { window.removeEventListener('resize', setup); },
  };
}

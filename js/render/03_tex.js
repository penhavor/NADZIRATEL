let AW = 768,
  AH = 512,
  AQ = 256;
/* ==== ТЕКСТУРЫ: атлас и процедурные карты ==== */
function rrect(x, px, py, w, h, r) {
  x.beginPath();
  if (x.roundRect) {
    x.roundRect(px, py, w, h, r);
    return;
  }
  x.rect(px, py, w, h);
}
function makeTex(fn, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  fn(x, w, h);
  return x.getImageData(0, 0, w, h);
}

function heightToNormal(id, w, h, strength) {
  const src = id.data;
  const n = w * h;
  const hh = new Float32Array(n);
  for (let i = 0, q = 0; q < n; i += 4, q++) hh[q] = src[i] * 0.0039215686;
  const out = new Uint8Array(n * 4);
  const o32 = new Uint32Array(out.buffer);
  const wm = w - 1,
    hm = h - 1;
  let q = 0;
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : hm) * w,
      yp = (y < hm ? y + 1 : 0) * w,
      yr = y * w;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : wm,
        xp = x < wm ? x + 1 : 0;
      const dx = (hh[yr + xp] - hh[yr + xm]) * strength;
      const dy = (hh[yp + x] - hh[ym + x]) * strength;
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const r = (-dx * il * 0.5 + 0.5) * 255;
      const g = (-dy * il * 0.5 + 0.5) * 255;
      const b = (il * 0.5 + 0.5) * 255;
      o32[q++] = r | ((g << 8) | (b << 16) | (255 << 24));
    }
  }
  return out;
}

function mirrorSquare(x, sx, sy, dx, dy, size) {
  const src = x.getImageData(sx, sy, size, size);
  const out = x.createImageData(size, size);
  const s = new Uint32Array(src.data.buffer, src.data.byteOffset, size * size);
  const o = new Uint32Array(out.data.buffer, out.data.byteOffset, size * size);
  for (let y = 0; y < size; y++) {
    const sr = y * size;
    for (let q2 = 0; q2 < size; q2++) o[sr + (size - 1 - q2)] = s[sr + q2];
  }
  x.putImageData(out, dx, dy);
}
function noiseInto(x, w, h, amp, rnd) {
  const id = x.getImageData(0, 0, w, h);
  const d = id.data;
  const half = amp * 0.5;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() * amp - half) | 0;
    let r = d[i] + n,
      g = d[i + 1] + n,
      b = d[i + 2] + n;
    d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  x.putImageData(id, 0, 0);
}
function quadUV(col, row) {
  const p = 2 * (AQ / 256);
  return {
    u0: (col * AQ + p) / AW,
    u1: ((col + 1) * AQ - p) / AW,
    v0: (row * AQ + p) / AH,
    v1: ((row + 1) * AQ - p) / AH
  };
}
let UV_WALL, UV_FLOOR, UV_WOOD, UV_CEIL, UV_IRON, UV_IRON2, UV_CAB, UV_CABIN, UV_CAB2;
let UV_TBL_TOP, UV_TBL_EDGE, UV_TBL_LEG, UV_TBL_STRAP;
let EDGE_IRON, EDGE_WOOD;
function applyAtlasQ(aq) {
  AQ = aq | 0;
  AW = AQ * 4;
  AH = AQ * 4;
  UV_WALL = quadUV(0, 0);
  UV_FLOOR = quadUV(1, 0);
  UV_WOOD = quadUV(2, 0);
  UV_CEIL = quadUV(0, 1);
  UV_IRON = quadUV(1, 1);
  UV_IRON2 = quadUV(2, 1);
  /* строка 2 — мебель: шпон шкафа, тёмная внутренность, зеркальный вариант шпона */
  UV_CAB = quadUV(0, 2);
  UV_CABIN = quadUV(1, 2);
  UV_CAB2 = quadUV(2, 2);
  /* строка 3 — стол: пласть верхней доски, кромка, ножка, стальная стяжка. Тайлы
   стола отдельные: в дверном дереве (UV_WOOD) пояса и кронштейны рисуются в
   рельефе; на столе они давали слои и кольца на ножках. */
  UV_TBL_TOP = quadUV(0, 3);
  UV_TBL_EDGE = quadUV(1, 3);
  UV_TBL_LEG = quadUV(2, 3);
  UV_TBL_STRAP = quadUV(3, 3);
  EDGE_IRON = [0.875, 0.125]; /* торец: матовая зона (3,0), без скользящего блика на кромке */
  EDGE_WOOD = [UV_WOOD.u0 + 0.01, UV_WOOD.v1 - 0.014];
}
applyAtlasQ(256);

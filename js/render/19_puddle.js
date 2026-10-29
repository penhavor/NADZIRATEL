/* ==== ОКРУЖЕНИЕ: лужи, список ламп ==== */
/* карта луж (R8, 4 тексела на клетку). Лужи генерируются от сида карты:
   случайные продолговатые пятна с шумным краем, только на полу. Вне луж маска
   строго 0 — пол не зеркало. */
function pudHash(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffff) / 65535;
}
function pudVnoise(x, y, seed) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const a = pudHash(ix, iy, seed),
    b = pudHash(ix + 1, iy, seed),
    c = pudHash(ix, iy + 1, seed),
    d = pudHash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function genPuddleMap(S) {
  const res = 4,
    w = S.W * res,
    h = S.H * res; /* маска мельче (4 текс/клетку) — край резче */
  const data = new Uint8Array(w * h);
  const rnd = xsStream(S.seedState, XS_PUD).rnd;
  const puds = [];
  const addP = (cx, cy, rx, ry, ang) => {
    puds.push({
      cx: cx,
      cy: cy,
      ca: Math.cos(ang),
      sa: Math.sin(ang),
      rx: rx,
      ry: ry,
      ph: rnd() * 7.0
    });
  };
  const openAt = (x, y) => x >= 0 && y >= 0 && x < S.W && y < S.H && S.grid[y * S.W + x] === 0;
  /* ЛОГИКА ВОДЫ вместо шума: лужа = конденсат из подтекающего крепежа — центр под
   лампой, и она растекается ВДОЛЬ коридора (вода сквозь стены не ходит). Число
   луж пропорционально числу ламп и площади пола — жёсткого потолка нет. */
  const corrAng = (x, y) => {
    const hh = openAt(x + 1, y) && openAt(x - 1, y),
      vv = openAt(x, y + 1) && openAt(x, y - 1);
    if (vv && !hh) return Math.PI / 2; /* коридор идёт вдоль Y */
    if (hh && !vv) return 0.0; /* коридор идёт вдоль X */
    return rnd() * Math.PI;
  }; /* комната или пересечение: ориентация свободная */
  for (const L of S.lamps) {
    if (rnd() >= 0.3) continue; /* подтекает не каждый крепеж */
    const cx = L.x + 0.5 + (rnd() - 0.5) * 0.7,
      cy = L.y + 0.5 + (rnd() - 0.5) * 0.7;
    const ang = corrAng(L.x | 0, L.y | 0);
    const along = 0.45 + rnd() * 0.45,
      across = along * (0.45 + rnd() * 0.25);
    addP(cx, cy, along, across, ang);
    if (rnd() < 0.45) {
      /* сток ручейком вдоль коридора */
      const dir = ang + (rnd() < 0.5 ? 0 : Math.PI);
      const dd = along * (1.1 + rnd() * 1.6);
      addP(
        cx + Math.cos(dir) * dd,
        cy + Math.sin(dir) * dd,
        along * (0.5 + rnd() * 0.5),
        across * 0.7,
        ang
      );
    }
    const ns = rnd() < 0.5 ? 1 + ((rnd() * 2) | 0) : 0; /* капли вдоль края */
    for (let s2 = 0; s2 < ns; s2++) {
      const da = rnd() * Math.PI * 2,
        dd = along * (0.8 + rnd() * 0.8);
      addP(
        cx + Math.cos(da) * dd,
        cy + Math.sin(da) * dd,
        0.18 + rnd() * 0.26,
        0.15 + rnd() * 0.22,
        rnd() * Math.PI
      );
    }
  }
  /* фоновые «низменности»: пропорционально площади пола, без потолка */
  const nb = Math.round(S.floors.length * 0.012);
  for (let k = 0; k < nb; k++) {
    const f = S.floors[(rnd() * S.floors.length) | 0];
    const cx = (f % S.W) + 0.5 + (rnd() - 0.5) * 0.6,
      cy = ((f / S.W) | 0) + 0.5 + (rnd() - 0.5) * 0.6;
    const ang = corrAng(f % S.W, (f / S.W) | 0);
    const rx = 0.4 + rnd() * 0.65,
      ry = rx * (0.5 + rnd() * 0.3);
    addP(cx, cy, rx, ry, ang);
    if (rnd() < 0.35) {
      const da = ang + (rnd() < 0.5 ? 0 : Math.PI),
        dd = rx * (1.0 + rnd() * 1.2);
      addP(cx + Math.cos(da) * dd, cy + Math.sin(da) * dd, rx * 0.55, ry * 0.55, ang);
    }
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const wx = (x + 0.5) / res,
        wy = (y + 0.5) / res;
      const gx = Math.floor(wx),
        gy = Math.floor(wy);
      if (gx < 0 || gy < 0 || gx >= S.W || gy >= S.H) continue;
      if (S.grid[gy * S.W + gx] !== 0) continue;
      let v = 0;
      for (const p of puds) {
        const dx = wx - p.cx,
          dy = wy - p.cy;
        const u = (dx * p.ca + dy * p.sa) / p.rx,
          t = (-dx * p.sa + dy * p.ca) / p.ry;
        const d = Math.sqrt(u * u + t * t);
        const n =
          pudVnoise(wx * 2.3 + p.ph, wy * 2.3 - p.ph, 1234) * 0.62 +
          pudVnoise(wx * 5.1, wy * 5.1, 5678) * 0.38;
        const dd = d + (n - 0.45) * 0.62;
        const s = 1 - Math.min(1, Math.max(0, (dd - 0.7) / 0.3));
        if (s > v) v = s;
      }
      if (v > 0) {
        const ss = v * v * (3 - 2 * v);
        data[y * w + x] = (ss * 255) | 0;
      }
    }
  return { w: w, h: h, data: data };
}

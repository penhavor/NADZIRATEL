function doorRig(S) {
  const mk = (cx, cy, ax, ay) => {
    const l = Math.hypot(ax, ay) || 1;
    ax /= l;
    ay /= l;
    return {
      x: cx,
      y: cy,
      hx: cx + 0.5 + 0.5 * ax + 0.5 * ay,
      hz: cy + 0.5 + 0.5 * ay - 0.5 * ax,
      yaw: Math.atan2(-ax, -ay),
      aOpen: -1.6
    };
  };
  let df = S.doorFace;
  if (!df) {
    const nb = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]
      .map(([dx, dy]) => [S.door.x + dx, S.door.y + dy])
      .find(
        q => q[0] >= 0 && q[1] >= 0 && q[0] < S.W && q[1] < S.H && S.grid[q[1] * S.W + q[0]] === 0
      );
    df = nb ? { x: nb[0] - S.door.x, y: nb[1] - S.door.y } : { x: 1, y: 0 };
  }
  const exit = mk(S.door.x, S.door.y, df.x, df.y);

  exit.inX = S.door.x - df.x;
  exit.inY = S.door.y - df.y;
  exit.outX = S.door.x + df.x;
  exit.outY = S.door.y + df.y;
  exit.ax = df.x;
  exit.ay = df.y;
  const safe = (S.safeDoors || []).map(d => {
    const o = mk(d.x, d.y, S.start.x - d.x, S.start.y - d.y);
    o.inX = S.start.x;
    o.inY = S.start.y;
    o.outX = 2 * d.x - S.start.x;
    o.outY = 2 * d.y - S.start.y;
    o.ax = d.x - S.start.x;
    o.ay = d.y - S.start.y;
    return o;
  });
  for (const D of [exit].concat(safe)) {
    const l = Math.hypot(D.ax, D.ay) || 1;
    D.ax /= l;
    D.ay /= l;
    D.inL = 0;
    D.inG = 0;
    D.outL = 0;
    D.outG = 0;
  }
  return { exit: exit, safe: safe };
}

function doorSides(S, D) {
  const W = S.W,
    H = S.H;
  /* створка в темноте получает тот же SC_FLOOR, что и карта света открытых клеток,
   умноженный на DOOR_BG_K (= 1: albedo двери совпадает с кирпичом, фоновая
   компенсация не нужна); освещённые клетки берут свой (максимум). */
  const li = (x, y) =>
    x < 0 || y < 0 || x >= W || y >= H
      ? SC_FLOOR * DOOR_BG_K
      : Math.max(SC_FLOOR * DOOR_BG_K, S.light[y * W + x] || 0);
  const gi = (x, y) =>
    x < 0 || y < 0 || x >= W || y >= H ? 0 : (S.gate ? S.gate[y * W + x] : 0) || 0;
  D.inL = li(D.inX, D.inY);
  D.inG = gi(D.inX, D.inY);
  D.outL = li(D.outX, D.outY);
  D.outG = gi(D.outX, D.outY);
  return D;
}
const sstep = (a, b, x) => {
  const t2 = (x - a) / (b - a);
  const u = t2 < 0 ? 0 : t2 > 1 ? 1 : t2;
  return u * u * (3 - 2 * u);
};

function doorMix(t) {
  return 1 - sstep(0.12, 0.85, t);
}
function doorModel(D, open01) {
  const e = open01 < 0 ? 0 : open01 > 1 ? 1 : open01;
  const ee = e * e * (3 - 2 * e);
  return m4mul(m4t(D.hx, 0, D.hz), m4mul(m4rotY(D.yaw + D.aOpen * ee), m4t(0.5, 0, 0)));
}

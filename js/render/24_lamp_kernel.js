/* настоящий потолочный светильник: тело вращения (профиль отражателя), кольцевой
   обод, труба к потолку и монтажная чашка. ~700 треугольников, нормали сглажены
   вдоль профиля и вокруг. Локальный 0 — плоскость рассеивателя. */
function lampFixtureData(R) {
  const V = [];
  const SEG = 20;
  const push = (px, py, pz, u, v, nx, ny, nz) => {
    V.push(px, py, pz, u, v, nx, ny, nz, 1);
  };
  const lathe = (prof, uv) => {
    const pn = []; /* сглаженные нормали профиля: среднее от нормалей соседних отрезков */
    for (let i = 0; i < prof.length; i++) {
      let nx = 0,
        ny = 0;
      if (i > 0) {
        const dr = prof[i][0] - prof[i - 1][0],
          dy = prof[i][1] - prof[i - 1][1];
        const l = Math.hypot(dr, dy) || 1;
        nx += -dy / l;
        ny += dr / l;
      }
      if (i < prof.length - 1) {
        const dr = prof[i + 1][0] - prof[i][0],
          dy = prof[i + 1][1] - prof[i][1];
        const l = Math.hypot(dr, dy) || 1;
        nx += -dy / l;
        ny += dr / l;
      }
      const l = Math.hypot(nx, ny) || 1;
      pn.push([nx / l, ny / l]);
    }
    for (let s = 0; s < SEG; s++) {
      const a0 = (s / SEG) * Math.PI * 2,
        a1 = ((s + 1) / SEG) * Math.PI * 2;
      const c0 = Math.cos(a0),
        s0 = Math.sin(a0),
        c1 = Math.cos(a1),
        s1 = Math.sin(a1);
      const u0 = uv.u0 + (uv.u1 - uv.u0) * (s / SEG),
        u1 = uv.u0 + (uv.u1 - uv.u0) * ((s + 1) / SEG);
      for (let i = 0; i < prof.length - 1; i++) {
        const r0 = prof[i][0],
          y0 = prof[i][1],
          r1 = prof[i + 1][0],
          y1 = prof[i + 1][1];
        const v0 = uv.v0 + (uv.v1 - uv.v0) * (i / (prof.length - 1)),
          v1 = uv.v0 + (uv.v1 - uv.v0) * ((i + 1) / (prof.length - 1));
        const nA = pn[i],
          nB = pn[i + 1];
        const A = [r0 * c0, y0, r0 * s0, u0, v0, nA[0] * c0, nA[1], nA[0] * s0];
        const B = [r1 * c0, y1, r1 * s0, u0, v1, nB[0] * c0, nB[1], nB[0] * s0];
        const C = [r1 * c1, y1, r1 * s1, u1, v1, nB[0] * c1, nB[1], nB[0] * s1];
        const D = [r0 * c1, y0, r0 * s1, u1, v0, nA[0] * c1, nA[1], nA[0] * s1];
        for (const t of [
          [A, C, B],
          [A, D, C]
        ])
          for (const p of t) push(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]);
      }
    }
  };
  /* внешний купол (от верха к ободу) */
  lathe(
    [
      [0.024, 0.075],
      [0.052, 0.072],
      [0.082, 0.064],
      [0.112, 0.05],
      [0.142, 0.033],
      [0.17, 0.016],
      [0.192, 0.004],
      [0.203, -0.004],
      [0.205, -0.012],
      [0.198, -0.016]
    ],
    R.iron
  );
  /* внутренний отражатель (от обода вверх): нормаль вниз-внутрь, материал —
   светлая краска */
  lathe(
    [
      [0.19, -0.004],
      [0.164, 0.01],
      [0.134, 0.026],
      [0.104, 0.04],
      [0.074, 0.052],
      [0.048, 0.06],
      [0.028, 0.065]
    ],
    R.inner
  );
  /* труба к потолку */
  lathe(
    [
      [0.016, 0.1],
      [0.016, 0.068]
    ],
    R.iron
  );
  /* монтажная чашка у потолка */
  lathe(
    [
      [0.042, 0.1],
      [0.042, 0.09],
      [0.03, 0.084],
      [0.016, 0.081]
    ],
    R.iron
  );
  return { arr: new Float32Array(V), n: V.length / 9 };
}
function lampPaneData(o, p) {
  const V = [];
  const uv = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  ];
  const pts = [
    [-o, p, -o],
    [o, p, -o],
    [o, p, o],
    [-o, p, o]
  ];
  for (const tri of [
    [0, 1, 2],
    [0, 2, 3]
  ])
    for (const i of tri) {
      const q2 = pts[i],
        t = uv[i];
      V.push(q2[0], q2[1], q2[2], t[0], t[1], 0, -1, 0, 1);
    }
  return { arr: new Float32Array(V), n: V.length / 9 };
}

function ssaoKernel(n) {
  n = Math.max(4, n | 0);
  const rnd = xsFromU32(
    0x55aa00 + n
  ).rnd; /* фиксированный ассет рендера — одинаков в каждом раунде */
  const k = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2,
      r = Math.sqrt(rnd());
    let x = Math.cos(a) * r,
      y = Math.sin(a) * r,
      z = 0.15 + 0.85 * rnd();
    const l = Math.hypot(x, y, z) || 1;
    x /= l;
    y /= l;
    z /= l;
    const sc = 0.3 + 0.7 * Math.pow((i + 1) / n, 1.7);
    k[i * 3] = x * sc;
    k[i * 3 + 1] = y * sc;
    k[i * 3 + 2] = z * sc;
  }
  return k;
}

function m4invView(v) {
  const m = new Float32Array(16);
  const t0 = v[12],
    t1 = v[13],
    t2 = v[14];
  m[0] = v[0];
  m[1] = v[4];
  m[2] = v[8];
  m[3] = 0;
  m[4] = v[1];
  m[5] = v[5];
  m[6] = v[9];
  m[7] = 0;
  m[8] = v[2];
  m[9] = v[6];
  m[10] = v[10];
  m[11] = 0;
  m[12] = -(v[0] * t0 + v[1] * t1 + v[2] * t2);
  m[13] = -(v[4] * t0 + v[5] * t1 + v[6] * t2);
  m[14] = -(v[8] * t0 + v[9] * t1 + v[10] * t2);
  m[15] = 1;
  return m;
}

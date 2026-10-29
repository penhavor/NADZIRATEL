function boxMeshData(w, h, d) {
  const V = [];
  const q = (a, b, c, d2, n) => {
    for (const tri of [
      [0, 1, 2],
      [0, 2, 3]
    ])
      for (const i of tri) {
        const p = [a, b, c, d2][i];
        V.push(p[0], p[1], p[2], 0.5, 0.5, n[0], n[1], n[2], p[1] <= 0.001 ? 0.85 : 1);
      }
  };
  q([-w, 0, -d], [w, 0, -d], [w, h, -d], [-w, h, -d], [0, 0, -1]);
  q([w, 0, d], [-w, 0, d], [-w, h, d], [w, h, d], [0, 0, 1]);
  q([w, 0, -d], [w, 0, d], [w, h, d], [w, h, -d], [1, 0, 0]);
  q([-w, 0, d], [-w, 0, -d], [-w, h, -d], [-w, h, d], [-1, 0, 0]);
  q([-w, h, d], [w, h, d], [w, h, -d], [-w, h, -d], [0, 1, 0]);
  return { arr: new Float32Array(V), n: V.length / 9 };
}
function discMeshData(r, seg) {
  const V = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2,
      a1 = ((i + 1) / seg) * Math.PI * 2;
    V.push(0, 0, 0, 0.5, 0.5, 0, 1, 0, 1);
    V.push(
      Math.cos(a0) * r,
      0,
      Math.sin(a0) * r,
      0.5 + Math.cos(a0) * 0.5,
      0.5 + Math.sin(a0) * 0.5,
      0,
      1,
      0,
      0.9
    );
    V.push(
      Math.cos(a1) * r,
      0,
      Math.sin(a1) * r,
      0.5 + Math.cos(a1) * 0.5,
      0.5 + Math.sin(a1) * 0.5,
      0,
      1,
      0,
      0.9
    );
  }
  return { arr: new Float32Array(V), n: V.length / 9 };
}

function leafMeshData(w, h, d, rect, edgeUV, rectBack) {
  const V = [];
  const q = (a, b, c, d2, n, uvA, uvB, uvC, uvD, ao) => {
    const uvs = [uvA, uvB, uvC, uvD];
    const pts = [a, b, c, d2];
    for (const tri of [
      [0, 1, 2],
      [0, 2, 3]
    ])
      for (const i of tri) {
        const p = pts[i],
          uv = uvs[i];
        V.push(p[0], p[1], p[2], uv[0], uv[1], n[0], n[1], n[2], ao === undefined ? 1 : ao);
      }
  };
  const u0 = rect.u0,
    v0 = rect.v0,
    u1 = rect.u1,
    v1 = rect.v1;
  const rb = rectBack || rect,
    b0 = rb.u0,
    bv0 = rb.v0,
    b1 = rb.u1,
    bv1 = rb.v1;
  q(
    [-w, 0, -d],
    [w, 0, -d],
    [w, h, -d],
    [-w, h, -d],
    [0, 0, -1],
    [b0, bv1],
    [b1, bv1],
    [b1, bv0],
    [b0, bv0]
  );
  q(
    [w, 0, d],
    [-w, 0, d],
    [-w, h, d],
    [w, h, d],
    [0, 0, 1],
    [u1, v1],
    [u0, v1],
    [u0, v0],
    [u1, v0]
  );
  const E = [edgeUV[0], edgeUV[1]];
  q([w, 0, -d], [w, 0, d], [w, h, d], [w, h, -d], [1, 0, 0], E, E, E, E, 0.55);
  q([-w, 0, d], [-w, 0, -d], [-w, h, -d], [-w, h, d], [-1, 0, 0], E, E, E, E, 0.55);
  q([-w, h, d], [w, h, d], [w, h, -d], [-w, h, -d], [0, 1, 0], E, E, E, E, 0.55);
  q([-w, 0, -d], [w, 0, -d], [w, 0, d], [-w, 0, d], [0, -1, 0], E, E, E, E, 0.55);
  return { arr: new Float32Array(V), n: V.length / 9 };
}

function buildKeyMeshData() {
  const V = [];
  const push = (p, n) => {
    V.push(p[0], p[1], p[2], 0.5, 0.5, n[0], n[1], n[2], 1);
  };
  const quad = (a, b, c, d, n) => {
    for (const tri of [
      [0, 1, 2],
      [0, 2, 3]
    ])
      for (const i of tri) push([a, b, c, d][i], n);
  };
  const box = (cx, cy, cz, w, h, d) => {
    quad(
      [cx - w, cy - h, cz - d],
      [cx + w, cy - h, cz - d],
      [cx + w, cy + h, cz - d],
      [cx - w, cy + h, cz - d],
      [0, 0, -1]
    );
    quad(
      [cx + w, cy - h, cz + d],
      [cx - w, cy - h, cz + d],
      [cx - w, cy + h, cz + d],
      [cx + w, cy + h, cz + d],
      [0, 0, 1]
    );
    quad(
      [cx + w, cy - h, cz - d],
      [cx + w, cy - h, cz + d],
      [cx + w, cy + h, cz + d],
      [cx + w, cy + h, cz - d],
      [1, 0, 0]
    );
    quad(
      [cx - w, cy - h, cz + d],
      [cx - w, cy - h, cz - d],
      [cx - w, cy + h, cz - d],
      [cx - w, cy + h, cz + d],
      [-1, 0, 0]
    );
    quad(
      [cx - w, cy + h, cz + d],
      [cx + w, cy + h, cz + d],
      [cx + w, cy + h, cz - d],
      [cx - w, cy + h, cz - d],
      [0, 1, 0]
    );
    quad(
      [cx - w, cy - h, cz - d],
      [cx + w, cy - h, cz - d],
      [cx + w, cy - h, cz + d],
      [cx - w, cy - h, cz + d],
      [0, -1, 0]
    );
  };
  const R = 0.075,
    r = 0.02,
    seg = 16,
    ring = 8,
    cy = 0.315;
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < ring; j++) {
      const u0 = (i / seg) * Math.PI * 2,
        u1 = ((i + 1) / seg) * Math.PI * 2;
      const v0 = (j / ring) * Math.PI * 2,
        v1 = ((j + 1) / ring) * Math.PI * 2;
      const P = (u, v) => [
        (R + r * Math.cos(v)) * Math.cos(u),
        cy + (R + r * Math.cos(v)) * Math.sin(u),
        r * Math.sin(v)
      ];
      const N = (u, v) => [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)];
      const ps = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)],
        ns = [N(u0, v0), N(u1, v0), N(u1, v1), N(u0, v1)];
      for (const tri of [
        [0, 1, 2],
        [0, 2, 3]
      ])
        for (const k of tri) push(ps[k], ns[k]);
    }
  const hr = 0.015,
    hs = 6;
  for (let i = 0; i < hs; i++) {
    const a0 = (i / hs) * Math.PI * 2,
      a1 = ((i + 1) / hs) * Math.PI * 2;
    const x0 = Math.cos(a0) * hr,
      z0 = Math.sin(a0) * hr,
      x1 = Math.cos(a1) * hr,
      z1 = Math.sin(a1) * hr;
    const nx = Math.cos((a0 + a1) / 2),
      nz = Math.sin((a0 + a1) / 2);
    quad([x0, 0.0, z0], [x1, 0.0, z1], [x1, 0.255, z1], [x0, 0.255, z0], [nx, 0, nz]);
  }
  box(0.03, 0.045, 0, 0.03, 0.013, 0.013);
  box(0.024, 0.088, 0, 0.024, 0.011, 0.013);
  box(0.0, 0.245, 0, 0.024, 0.01, 0.024);
  /* Ключ ~13 см — входит в ящик шкафа и в кулак; бородка идёт вдоль +X — та же
   конвенция осей, что у фонаря и батарейки (один захват и одна правка). */
  const KS = 0.135 / 0.33; /* итоговая длина ключа ~= 0.135 единиц рига ~= 13.7 см */
  for (let i = 0; i < V.length; i += 9) {
    const x = V[i] * KS,
      y = V[i + 1] * KS,
      nx = V[i + 5],
      ny = V[i + 6];
    V[i] = y;
    V[i + 1] = -x;
    V[i + 2] = V[i + 2] * KS;
    V[i + 5] = ny;
    V[i + 6] = -nx;
  }
  return { arr: new Float32Array(V), n: V.length / 9 };
}

/* ВЕНТИЛЬ ДВЕРИ ВЫХОДА: торовый обод, четыре спицы, ступица. Ось = локальная Z;
   креится к створке изнутри, проворачивается, пока его крутит ключ (doorT). */
function buildValveData() {
  const V = [];
  const push = (p, n) => {
    V.push(p[0], p[1], p[2], 0.875, 0.625, n[0], n[1], n[2], 1);
  }; /* uv: зона крашеного чугуна (3,2) в matOf */
  const quad = (a, b, c, d, n) => {
    for (const tri of [
      [0, 1, 2],
      [0, 2, 3]
    ])
      for (const i of tri) push([a, b, c, d][i], n);
  };
  const box = (cx, cy, cz, w, h, d) => {
    quad(
      [cx - w, cy - h, cz - d],
      [cx + w, cy - h, cz - d],
      [cx + w, cy + h, cz - d],
      [cx - w, cy + h, cz - d],
      [0, 0, -1]
    );
    quad(
      [cx + w, cy - h, cz + d],
      [cx - w, cy - h, cz + d],
      [cx - w, cy + h, cz + d],
      [cx + w, cy + h, cz + d],
      [0, 0, 1]
    );
    quad(
      [cx + w, cy - h, cz - d],
      [cx + w, cy - h, cz + d],
      [cx + w, cy + h, cz + d],
      [cx + w, cy + h, cz - d],
      [1, 0, 0]
    );
    quad(
      [cx - w, cy - h, cz + d],
      [cx - w, cy - h, cz - d],
      [cx - w, cy + h, cz - d],
      [cx - w, cy + h, cz + d],
      [-1, 0, 0]
    );
    quad(
      [cx - w, cy + h, cz + d],
      [cx + w, cy + h, cz + d],
      [cx + w, cy + h, cz - d],
      [cx - w, cy + h, cz - d],
      [0, 1, 0]
    );
    quad(
      [cx - w, cy - h, cz - d],
      [cx + w, cy - h, cz - d],
      [cx + w, cy - h, cz + d],
      [cx - w, cy - h, cz + d],
      [0, -1, 0]
    );
  };
  const R = 0.068,
    r = 0.0075,
    seg = 18,
    ring = 6;
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < ring; j++) {
      const u0 = (i / seg) * Math.PI * 2,
        u1 = ((i + 1) / seg) * Math.PI * 2;
      const v0 = (j / ring) * Math.PI * 2,
        v1 = ((j + 1) / ring) * Math.PI * 2;
      const P = (u, v) => [
        (R + r * Math.cos(v)) * Math.cos(u),
        (R + r * Math.cos(v)) * Math.sin(u),
        r * Math.sin(v)
      ];
      const N = (u, v) => [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)];
      const ps = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)],
        ns = [N(u0, v0), N(u1, v0), N(u1, v1), N(u0, v1)];
      for (const tri of [
        [0, 1, 2],
        [0, 2, 3]
      ])
        for (const k of tri) push(ps[k], ns[k]);
    }
  box(0.036, 0, 0, 0.036, 0.006, 0.006);
  box(-0.036, 0, 0, 0.036, 0.006, 0.006);
  box(0, 0.036, 0, 0.006, 0.036, 0.006);
  box(0, -0.036, 0, 0.006, 0.036, 0.006);
  const hr = 0.016,
    hs = 8;
  for (let i = 0; i < hs; i++) {
    const a0 = (i / hs) * Math.PI * 2,
      a1 = ((i + 1) / hs) * Math.PI * 2;
    const x0 = Math.cos(a0) * hr,
      y0 = Math.sin(a0) * hr,
      x1 = Math.cos(a1) * hr,
      y1 = Math.sin(a1) * hr;
    const nx = Math.cos((a0 + a1) / 2),
      ny = Math.sin((a0 + a1) / 2);
    quad([x0, y0, -0.014], [x1, y1, -0.014], [x1, y1, 0.018], [x0, y0, 0.018], [nx, ny, 0]);
  }
  return { arr: new Float32Array(V), n: V.length / 9 };
}

/* ФУРНИТУРА ДЕРЕВЯННОЙ ДВЕРИ: локальное пространство совпадает с leafMeshData
   (x = ширина, y = вверх, z = толщина створки). Пояса охватывают створку
   насквозь, заклёпки — купола на гранях, ручка — бобышка + кольцо на шаровом
   шарнире. UV — константы в стальном квадрате matOf (metal/rough). */
function buildSafeHwData(w, h, d) {
  const V = [];
  const push = (p, n) => {
    V.push(p[0], p[1], p[2], 0.875, 0.375, n[0], n[1], n[2], 1);
  }; /* uv в зоне matOf (3,1) */
  const pushS = (p, n) => push(p, n); /* сглаженный квад: своя нормаль на вершину */
  const quadS = (a, na, b, nb, c, nc, d2, nd) => {
    for (const tri of [
      [0, 1, 2],
      [0, 2, 3]
    ])
      for (const i of tri) {
        const P = [a, b, c, d2][i],
          Nn = [na, nb, nc, nd][i];
        pushS(P, Nn);
      }
  };
  const quad = (a, b, c, dd, n) => {
    for (const tri of [
      [0, 1, 2],
      [0, 2, 3]
    ])
      for (const i of tri) push([a, b, c, dd][i], n);
  };
  const box = (cx, cy, cz, sx, sy, sz) => {
    quad(
      [cx - sx, cy - sy, cz - sz],
      [cx + sx, cy - sy, cz - sz],
      [cx + sx, cy + sy, cz - sz],
      [cx - sx, cy + sy, cz - sz],
      [0, 0, -1]
    );
    quad(
      [cx + sx, cy - sy, cz + sz],
      [cx - sx, cy - sy, cz + sz],
      [cx - sx, cy + sy, cz + sz],
      [cx + sx, cy + sy, cz + sz],
      [0, 0, 1]
    );
    quad(
      [cx + sx, cy - sy, cz - sz],
      [cx + sx, cy - sy, cz + sz],
      [cx + sx, cy + sy, cz + sz],
      [cx + sx, cy + sy, cz - sz],
      [1, 0, 0]
    );
    quad(
      [cx - sx, cy - sy, cz + sz],
      [cx - sx, cy - sy, cz - sz],
      [cx - sx, cy + sy, cz - sz],
      [cx - sx, cy + sy, cz + sz],
      [-1, 0, 0]
    );
    quad(
      [cx - sx, cy + sy, cz + sz],
      [cx + sx, cy + sy, cz + sz],
      [cx + sx, cy + sy, cz - sz],
      [cx - sx, cy + sy, cz - sz],
      [0, 1, 0]
    );
    quad(
      [cx - sx, cy - sy, cz - sz],
      [cx + sx, cy - sy, cz - sz],
      [cx + sx, cy - sy, cz + sz],
      [cx - sx, cy - sy, cz + sz],
      [0, -1, 0]
    );
  };
  /* купол заклёпки: основание утоплено в пояс — компланарности с гранью нет */
  const dome = (cx, cy, cz, r, sq, side, SEG, RG) => {
    for (let j = 0; j < RG; j++) {
      const v0 = (j / RG) * Math.PI * 0.5,
        v1 = ((j + 1) / RG) * Math.PI * 0.5;
      for (let i = 0; i < SEG; i++) {
        const u0 = (i / SEG) * Math.PI * 2,
          u1 = ((i + 1) / SEG) * Math.PI * 2;
        const P = (u, v) => [
          cx + r * Math.sin(v) * Math.cos(u),
          cy + r * Math.sin(v) * Math.sin(u),
          cz + side * r * sq * Math.cos(v)
        ];
        const N = (u, v) => [
          Math.sin(v) * Math.cos(u),
          Math.sin(v) * Math.sin(u),
          side * Math.cos(v)
        ];
        const a = P(u0, v1),
          b = P(u1, v1),
          c = P(u1, v0),
          e = P(u0, v0);
        if (j === RG - 1) {
          quadS(a, N(u0, v1), b, N(u1, v1), c, N(u1, v1), c, N(u1, v1));
        } else {
          quadS(a, N(u0, v1), b, N(u1, v1), c, N(u1, v0), e, N(u0, v0));
        }
      }
    }
  };
  const torus = (cx, cy, cz, R, r, seg, ring) => {
    for (let i = 0; i < seg; i++)
      for (let j = 0; j < ring; j++) {
        const u0 = (i / seg) * Math.PI * 2,
          u1 = ((i + 1) / seg) * Math.PI * 2;
        const v0 = (j / ring) * Math.PI * 2,
          v1 = ((j + 1) / ring) * Math.PI * 2;
        const P = (u, v) => [
          cx + (R + r * Math.cos(v)) * Math.cos(u),
          cy + (R + r * Math.cos(v)) * Math.sin(u),
          cz + r * Math.sin(v)
        ];
        const N = (u, v) => [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)];
        quadS(
          P(u0, v0),
          N(u0, v0),
          P(u1, v0),
          N(u1, v0),
          P(u1, v1),
          N(u1, v1),
          P(u0, v1),
          N(u0, v1)
        );
      }
  };
  const sphere = (cx, cy, cz, r, seg, ring) => {
    for (let i = 0; i < seg; i++)
      for (let j = 0; j < ring; j++) {
        const u0 = (i / seg) * Math.PI * 2,
          u1 = ((i + 1) / seg) * Math.PI * 2;
        const v0 = (j / ring) * Math.PI - Math.PI * 0.5,
          v1 = ((j + 1) / ring) * Math.PI - Math.PI * 0.5;
        const P = (u, v) => [
          cx + r * Math.cos(v) * Math.cos(u),
          cy + r * Math.cos(v) * Math.sin(u),
          cz + r * Math.sin(v)
        ];
        const N = (u, v) => [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)];
        const a = P(u0, v0),
          b = P(u1, v0),
          c = P(u1, v1),
          e = P(u0, v1);
        if (j === 0) {
          quadS(a, N(u0, v0), b, N(u1, v0), c, N(u1, v0), e, N(u0, v0));
        } else if (j === ring - 1) {
          quadS(a, N(u0, v0), b, N(u1, v0), c, N(u1, v1), e, N(u0, v1));
        } else {
          quadS(a, N(u0, v0), b, N(u1, v0), c, N(u1, v1), e, N(u0, v1));
        }
      }
  };
  const ZT = d + 0.016; /* пояс выступает из створки на 1.6 см */
  const SH = 0.055; /* полувысота пояса */
  for (const cy of [h * 0.2325, h * 0.7825]) {
    box(0, cy, 0, w - 0.002, SH, ZT);
    for (let rv = 0; rv < 6; rv++) {
      const rx = -0.44 + rv * 0.176;
      dome(rx, cy, ZT - 0.004, 0.017, 0.8, 1, 8, 2);
      dome(rx, cy, -ZT + 0.004, 0.017, 0.8, -1, 8, 2);
    }
  }
  const hx = 0.26,
    hy = h * 0.42; /* кольцо выше поясов: ~1.5 м от земли */
  for (const side of [1, -1]) {
    dome(
      hx,
      hy,
      side * 0.048,
      0.055,
      0.42,
      side,
      14,
      4
    ); /* купол вместо плоской шайбы: блик не диском */
    sphere(hx, hy + 0.045, side * 0.062, 0.014, 8, 4);
    torus(hx, hy - 0.017, side * 0.07, 0.062, 0.009, 16, 6);
  } /* кольцо висит на шарнире */
  return { arr: new Float32Array(V), n: V.length / 9 };
}

/* =============== РЕКВИЗИТ ================
   Мелкие предметы строятся В ЕДИНИЦАХ РИГА (~метры): в руке используются как
   есть, в мире — с множителем PL_SCALE. Ось предмета = +X («голова» фонаря),
   одна правка захвата. Мебель строится сразу В КЛЕТКАХ — только для мира. */
const FL_UV = () => {
  const q = UV_IRON;
  const w = q.u1 - q.u0,
    h = q.v1 - q.v0;
  return [q.u0 + w * 0.1, q.u0 + w * 0.34, q.v0 + h * 0.12, q.v0 + h * 0.36];
};
/* ФОНАРЬ (~20 см): латунный профиль вдоль Y → повёрнут в +X. Тёмный
   анодированный алюминий, накатные кольца, голова-отражатель, безель. */
function buildFlashlightData() {
  const uv = FL_UV();
  let V = loftPart(
    [
      pr(-0.106, 0, 0, 0.0095, 0.0095, 2.2),
      pr(-0.099, 0, 0, 0.0135, 0.0135, 2.2),
      pr(-0.089, 0, 0, 0.0165, 0.0165, 2.2),
      pr(-0.081, 0, 0, 0.0175, 0.0175, 2.2),
      pr(-0.058, 0, 0, 0.0175, 0.0175, 2.2),
      pr(-0.054, 0, 0, 0.0192, 0.0192, 2.2),
      pr(-0.048, 0, 0, 0.0192, 0.0192, 2.2),
      pr(-0.044, 0, 0, 0.0175, 0.0175, 2.2),
      pr(-0.016, 0, 0, 0.0175, 0.0175, 2.2),
      pr(-0.012, 0, 0, 0.0192, 0.0192, 2.2),
      pr(-0.006, 0, 0, 0.0192, 0.0192, 2.2),
      pr(-0.002, 0, 0, 0.0178, 0.0178, 2.2),
      pr(0.018, 0, 0, 0.0185, 0.0185, 2.3),
      pr(0.024, 0, 0, 0.0215, 0.0215, 2.3),
      pr(0.036, 0, 0, 0.0265, 0.0265, 2.4),
      pr(0.06, 0, 0, 0.0295, 0.0295, 2.4),
      pr(0.082, 0, 0, 0.03, 0.03, 2.4),
      pr(0.088, 0, 0, 0.0325, 0.0325, 2.3),
      pr(0.094, 0, 0, 0.0315, 0.0315, 2.3),
      pr(0.0975, 0, 0, 0.028, 0.028, 2.3)
    ],
    14,
    uv,
    true
  );
  /* кнопка на торце (её нажимает большой палец в анимации переключения) */
  V = partCat(
    V,
    partAO(
      loftPart(
        [pr(-0.112, 0, 0, 0.0055, 0.0055, 2.2), pr(-0.1055, 0, 0, 0.0075, 0.0075, 2.2)],
        10,
        uv,
        true
      ),
      0.8
    )
  );
  V = partXf(V, 0, 0, 0, 0, 0, -Math.PI / 2); /* ось Y → +X: голова смотрит вперёд */
  /* укрупнено: корпус и голова поперёк — целиком, голова вдоль X — от оси захвата
   (хвост кнопки стоит на месте — анимация большого пальца не съезжает). */
  for (let i = 0; i < V.length; i += 9) {
    V[i + 1] *= FL_MODEL_K;
    V[i + 2] *= FL_MODEL_K;
    if (V[i] > 0.005) V[i] *= FL_MODEL_K;
  }
  return { arr: new Float32Array(V), n: V.length / 9 };
}
/* линза фонаря (диск в плоскости головы; светится, когда включён) */
function buildFlashLensData() {
  const d = discMeshData(0.0268, 20);
  const a = d.arr,
    V = [];
  for (let i = 0; i < a.length; i += 9) {
    /* диск строится в XZ (нормаль +Y) — ставится в плоскость головы YZ, нормаль +X */
    V.push(
      FL_HEAD_X,
      a[i + 2] * FL_MODEL_K,
      -a[i] * FL_MODEL_K,
      a[i + 3],
      a[i + 4],
      1,
      0,
      0,
      a[i + 8]
    );
  }
  return { arr: new Float32Array(V), n: V.length / 9 };
}
/* БАТАРЕЙКА (типа AA, x1.6 от реального размера — иначе не читается): 8 см,
   тёмная стальная гильза + жёлтая этикетка (два прохода) + плюсовой контакт. */
function buildBatteryBodyData() {
  const uv = FL_UV();
  let V = loftPart(
    [
      pr(-0.04, 0, 0, 0.0112, 0.0112, 2.2),
      pr(-0.038, 0, 0, 0.0118, 0.0118, 2.2),
      pr(0.03, 0, 0, 0.0118, 0.0118, 2.2),
      pr(0.033, 0, 0, 0.0108, 0.0108, 2.2),
      pr(0.035, 0, 0, 0.01, 0.01, 2.2),
      pr(0.0395, 0, 0, 0.0048, 0.0048, 2.2),
      pr(0.0415, 0, 0, 0.0042, 0.0042, 2.2)
    ],
    12,
    uv,
    true
  );
  V = partXf(V, 0, 0, 0, 0, 0, -Math.PI / 2);
  return { arr: new Float32Array(V), n: V.length / 9 };
}
function buildBatteryBandData() {
  const uv = FL_UV();
  let V = loftPart(
    [pr(-0.028, 0, 0, 0.0122, 0.0122, 2.2), pr(0.02, 0, 0, 0.0122, 0.0122, 2.2)],
    12,
    uv,
    false
  );
  V = partXf(V, 0, 0, 0, 0, 0, -Math.PI / 2);
  return { arr: new Float32Array(V), n: V.length / 9 };
}
/* ШКАФ (в клетках; фасад смотрит в -Z, к стене ставится матрицей rotY). Корпус:
   бока, дно и верх с выступающей кромкой, тёмная полость ящика. Все стыки деталей
   либо перекрываются, либо держат зазор: компланарных пар нет, поэтому z-fighting
   исключён; цоколь утоплен под пол. Зазор ящика и полости 4 мм. */
/* UV мебели: внутренний вырез тайла при РАВНОМЕРНОЙ плотности (CAB_SPAN клеток
   на сторону тайла) — узкие кромки не растягивают текстуру; V идёт вдоль волокон:
   вертикально на гранях ±X, поперёк на остальных; off = смещение выреза на
   деталь, чтобы шпон не повторялся на соседних гранях. */
var CAB_SPAN = 0.42;
function cabPartX(x0, x1, y0, y1, z0, z1, uv, off, ao) {
  const V = [];
  const U0 = uv[0],
    U1 = uv[1],
    V0 = uv[2],
    V1 = uv[3],
    UW = U1 - U0,
    VH = V1 - V0;
  const su = s => (off[0] + s / CAB_SPAN) * UW,
    sv = t => (off[1] + t / CAB_SPAN) * VH;
  const q = (pts, n, co) => {
    for (const tri of [
      [0, 1, 2],
      [0, 2, 3]
    ])
      for (const i of tri) {
        const p = pts[i],
          c = co[i];
        V.push(
          p[0],
          p[1],
          p[2],
          U0 + su(c[0]),
          V0 + sv(c[1]),
          n[0],
          n[1],
          n[2],
          ao === undefined ? 1 : ao
        );
      }
  };
  const sx = x1 - x0,
    sy = y1 - y0,
    sz = z1 - z0;
  q(
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0]
    ],
    [0, 0, -1],
    [
      [0, 0],
      [0, sx],
      [sy, sx],
      [sy, 0]
    ]
  );
  q(
    [
      [x1, y0, z1],
      [x0, y0, z1],
      [x0, y1, z1],
      [x1, y1, z1]
    ],
    [0, 0, 1],
    [
      [0, sx],
      [0, 0],
      [sy, 0],
      [sy, sx]
    ]
  );
  q(
    [
      [x1, y0, z0],
      [x1, y0, z1],
      [x1, y1, z1],
      [x1, y1, z0]
    ],
    [1, 0, 0],
    [
      [0, 0],
      [sz, 0],
      [sz, sy],
      [0, sy]
    ]
  );
  q(
    [
      [x0, y0, z1],
      [x0, y0, z0],
      [x0, y1, z0],
      [x0, y1, z1]
    ],
    [-1, 0, 0],
    [
      [0, 0],
      [sz, 0],
      [sz, sy],
      [0, sy]
    ]
  );
  q(
    [
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
      [x0, y1, z0]
    ],
    [0, 1, 0],
    [
      [0, 0],
      [0, sx],
      [sz, sx],
      [sz, 0]
    ]
  );
  q(
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1]
    ],
    [0, -1, 0],
    [
      [0, 0],
      [0, sx],
      [sz, sx],
      [sz, 0]
    ]
  );
  return V;
}
function buildCabinetData() {
  const w = [UV_CAB.u0, UV_CAB.u1, UV_CAB.v0, UV_CAB.v1];
  const w2 = [UV_CAB2.u0, UV_CAB2.u1, UV_CAB2.v0, UV_CAB2.v1];
  const wi = [UV_CABIN.u0, UV_CABIN.u1, UV_CABIN.v0, UV_CABIN.v1];
  const V = partCat(
    cabPartX(-0.17, -0.152, 0.02, 0.285, -0.09, 0.09, w, [0.0, 0.02], 0.85),
    cabPartX(0.152, 0.17, 0.02, 0.285, -0.09, 0.09, w, [0.1, 0.0], 0.85),
    /* спинка и дно перекрывают бока (±0.156 внутри них): торцы не совпадают */
    cabPartX(-0.156, 0.156, 0.03, 0.285, 0.072, 0.086, w2, [0.02, 0.0], 0.8),
    cabPartX(-0.156, 0.156, 0.024, 0.044, -0.086, 0.076, wi, [0.0, 0.05], 0.9),
    cabPartX(-0.18, 0.18, 0.283, 0.302, -0.098, 0.098, w, [0.03, 0.1], 1.0),
    cabPartX(-0.145, 0.145, -0.02, 0.024, -0.07, 0.075, w2, [0.06, 0.04], 0.5),
    /* полость (видна при открытом ящике) — тёмная внутренность */
    cabPartX(-0.156, -0.144, 0.04, 0.242, -0.088, 0.076, wi, [0.08, 0.0], 0.35),
    cabPartX(0.144, 0.156, 0.04, 0.242, -0.088, 0.076, wi, [0.08, 0.06], 0.35),
    cabPartX(-0.148, 0.148, 0.238, 0.246, -0.084, 0.076, wi, [0.02, 0.08], 0.3),
    cabPartX(-0.148, 0.148, 0.042, 0.05, -0.084, 0.076, wi, [0.05, 0.02], 0.38)
  );
  return { arr: new Float32Array(V), n: V.length / 9 };
}
/* ящик шкафа: филёнчатый фасад, бока, дно, задняя стенка, ручка-кнопка */
function buildCabinetDrawerData() {
  const w = [UV_CAB.u0, UV_CAB.u1, UV_CAB.v0, UV_CAB.v1];
  const wi = [UV_CABIN.u0, UV_CABIN.u1, UV_CABIN.v0, UV_CABIN.v1];
  const q = UV_IRON,
    iw = q.u1 - q.u0,
    ih = q.v1 - q.v0;
  /* гладкая зона железной двери (между панелями) — без заклёпок и без накладки */
  const ir = [q.u0 + iw * 0.3, q.u0 + iw * 0.62, q.v0 + ih * 0.4, q.v0 + ih * 0.58];
  const V = partCat(
    cabPartX(-0.146, 0.146, 0.052, 0.234, -0.098, -0.082, w, [0.0, 0.06], 1.0),
    cabPartX(-0.126, 0.126, 0.072, 0.212, -0.1005, -0.094, w, [0.06, 0.0], 0.92),
    cabPartX(-0.14, -0.13, 0.058, 0.222, -0.086, 0.055, wi, [0.1, 0.02], 0.55),
    cabPartX(0.13, 0.14, 0.058, 0.222, -0.086, 0.055, wi, [0.1, 0.08], 0.55),
    cabPartX(-0.134, 0.134, 0.056, 0.062, -0.086, 0.05, wi, [0.02, 0.1], 0.5),
    cabPartX(-0.134, 0.134, 0.058, 0.218, 0.045, 0.053, wi, [0.06, 0.06], 0.5),
    /* кнопка: латунь, ось Y → -Z (выступает из фасада) */
    partXf(
      partAO(
        loftPart(
          [
            pr(0, 0, 0, 0.011, 0.011, 2.2),
            pr(0.013, 0, 0, 0.0135, 0.0135, 2.2),
            pr(0.02, 0, 0, 0.0085, 0.0085, 2.2)
          ],
          10,
          ir,
          true
        ),
        0.9
      ),
      0,
      0.143,
      -0.098,
      -Math.PI / 2,
      0,
      0
    )
  );
  return { arr: new Float32Array(V), n: V.length / 9 };
}
/* СТОЛ В БЕЗОПАСНОЙ КОМНАТЕ (в клетках): столешница 1.24x0.70 м на четырёх
   ножках. UV — вырезы тайлов равномерной плотности (TBL_SPAN клеток на сторону),
   у каждой грани свой тайл по направлению волокон: пласть, кромка, ножка,
   поэтому ничего не растягивается. Стыки деталей только перекрываются (ножки и
   царга утоплены в столешницу и друг в друга) — компланарных граней нет,
   мерцания нет. Стальные стяжки — объёмные пояса вокруг столешницы (не рисунок
   текстуры). */
var TBL_SPAN = 0.42;
function tblRect(uv, ou, ov, lu, lv) {
  const uw = uv.u1 - uv.u0,
    vh = uv.v1 - uv.v0;
  return [
    uv.u0 + (ou / TBL_SPAN) * uw,
    uv.u0 + ((ou + lu) / TBL_SPAN) * uw,
    uv.v0 + (ov / TBL_SPAN) * vh,
    uv.v0 + ((ov + lv) / TBL_SPAN) * vh
  ];
}
/* квад по 4 углам с произвольными st (доли тайла 0..1) */
function tblQuadST(a, b, c, d, n, uv, st, ao) {
  const V = [],
    pts = [a, b, c, d];
  for (const tri of [
    [0, 1, 2],
    [0, 2, 3]
  ])
    for (const i of tri) {
      const p = pts[i],
        s = st[i];
      V.push(
        p[0],
        p[1],
        p[2],
        uv.u0 + (uv.u1 - uv.u0) * s[0],
        uv.v0 + (uv.v1 - uv.v0) * s[1],
        n[0],
        n[1],
        n[2],
        ao
      );
    }
  return V;
}
/* то же по абсолютному прямоугольнику [u0,u1,v0,v1] */
function tblQuadRC(a, b, c, d, n, r, ao) {
  const V = [],
    pts = [a, b, c, d],
    st = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ];
  for (const tri of [
    [0, 1, 2],
    [0, 2, 3]
  ])
    for (const i of tri) {
      const p = pts[i],
        s = st[i];
      V.push(
        p[0],
        p[1],
        p[2],
        r[0] + (r[1] - r[0]) * s[0],
        r[2] + (r[3] - r[2]) * s[1],
        n[0],
        n[1],
        n[2],
        ao
      );
    }
  return V;
}
/* бокс: грани ±Y вырезаются из uvY (u вдоль X, v вдоль Z), бока — из uvS (u
   вдоль горизонтали грани, v вдоль Y); o* — смещения выреза на грань в клетках
   (никогда не покидают тайл: off+len <= TBL_SPAN) */
function tblBox(x0, x1, y0, y1, z0, z1, uvY, uvS, oY, oY2, oZ, oZ2, oX, oX2, ao) {
  const V = [],
    sx = x1 - x0,
    sy = y1 - y0,
    sz = z1 - z0;
  const q = (a, b, c, d, n, uv, o, l) => {
    V.push.apply(V, tblQuadRC(a, b, c, d, n, tblRect(uv, o[0], o[1], l[0], l[1]), ao));
  };
  q([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], uvS, oZ, [sx, sy]);
  q([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [0, 0, 1], uvS, oZ2, [sx, sy]);
  q([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], uvS, oX, [sz, sy]);
  q([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [-1, 0, 0], uvS, oX2, [sz, sy]);
  q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], uvY, oY, [sx, sz]);
  q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], uvY, oY2, [sx, sz]);
  return V;
}
/* стальная стяжка: пояс вокруг столешницы с отступом 1.5 мм (зазор вместо
   компланарности). Полосы тайла: A — пласть с заклёпками, B — юбка с винтами,
   C — спинка. */
function tblStrap(cz, ao) {
  const x0 = -0.2115,
    x1 = 0.2115,
    y0 = 0.2365,
    y1 = 0.2575,
    z0 = cz - 0.012,
    z1 = cz + 0.012;
  const uv = UV_TBL_STRAP,
    V = [];
  const sZ = z => 0.03 + (0.94 * (z - z0)) / (z1 - z0),
    sX = x => 0.02 + (0.2 * (x - x0)) / (x1 - x0);
  const sXe = x => 0.58 + (0.4 * (x - x0)) / (x1 - x0),
    sY = y => 0.3 + (0.2 * (y - y0)) / (y1 - y0);
  const sYe = y => 0.58 + (0.4 * (y - y0)) / (y1 - y0),
    sXc = x => 0.03 + (0.94 * (x - x0)) / (x1 - x0);
  V.push.apply(
    V,
    tblQuadST(
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
      [0, 1, 0],
      uv,
      [
        [sZ(z0), sX(x0)],
        [sZ(z0), sX(x1)],
        [sZ(z1), sX(x1)],
        [sZ(z1), sX(x0)]
      ],
      ao
    )
  );
  V.push.apply(
    V,
    tblQuadST(
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
      [0, -1, 0],
      uv,
      [
        [sZ(z0), sXe(x0)],
        [sZ(z0), sXe(x1)],
        [sZ(z1), sXe(x1)],
        [sZ(z1), sXe(x0)]
      ],
      ao
    )
  );
  V.push.apply(
    V,
    tblQuadST(
      [x1, y0, z0],
      [x1, y0, z1],
      [x1, y1, z1],
      [x1, y1, z0],
      [1, 0, 0],
      uv,
      [
        [sZ(z0), sY(y0)],
        [sZ(z1), sY(y0)],
        [sZ(z1), sY(y1)],
        [sZ(z0), sY(y1)]
      ],
      ao
    )
  );
  V.push.apply(
    V,
    tblQuadST(
      [x0, y0, z1],
      [x0, y0, z0],
      [x0, y1, z0],
      [x0, y1, z1],
      [-1, 0, 0],
      uv,
      [
        [sZ(z1), sY(y0)],
        [sZ(z0), sY(y0)],
        [sZ(z0), sY(y1)],
        [sZ(z1), sY(y1)]
      ],
      ao
    )
  );
  V.push.apply(
    V,
    tblQuadST(
      [x1, y0, z1],
      [x0, y0, z1],
      [x0, y1, z1],
      [x1, y1, z1],
      [0, 0, 1],
      uv,
      [
        [sXc(x1), sYe(y0)],
        [sXc(x0), sYe(y0)],
        [sXc(x0), sYe(y1)],
        [sXc(x1), sYe(y1)]
      ],
      ao
    )
  );
  V.push.apply(
    V,
    tblQuadST(
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
      [0, 0, -1],
      uv,
      [
        [sXc(x0), sYe(y0)],
        [sXc(x1), sYe(y0)],
        [sXc(x1), sYe(y1)],
        [sXc(x0), sYe(y1)]
      ],
      ao
    )
  );
  return V;
}
function buildTableData() {
  const T = UV_TBL_TOP,
    E = UV_TBL_EDGE,
    L = UV_TBL_LEG;
  const V = partCat(
    tblBox(
      -0.21,
      0.21,
      0.238,
      0.256,
      -0.12,
      0.12,
      T,
      E,
      [0, 0],
      [0, 0],
      [0, 0.3],
      [0, 0.36],
      [0.16, 0.3],
      [0.16, 0.34],
      1.0
    ),
    /* ножки утоплены в столешницу до y=0.246 (перекрытие, без компланарности) */
    tblBox(
      -0.195,
      -0.175,
      0.0,
      0.246,
      -0.105,
      -0.085,
      L,
      L,
      [0.1, 0.1],
      [0.1, 0.15],
      [0, 0],
      [0.06, 0.05],
      [0.05, 0],
      [0.09, 0.05],
      0.8
    ),
    tblBox(
      0.175,
      0.195,
      0.0,
      0.246,
      -0.105,
      -0.085,
      L,
      L,
      [0.1, 0.1],
      [0.1, 0.15],
      [0.12, 0],
      [0.18, 0.05],
      [0.14, 0],
      [0.18, 0.05],
      0.8
    ),
    tblBox(
      -0.195,
      -0.175,
      0.0,
      0.246,
      0.085,
      0.105,
      L,
      L,
      [0.16, 0.1],
      [0.16, 0.15],
      [0.24, 0],
      [0.3, 0.05],
      [0.23, 0],
      [0.27, 0.05],
      0.8
    ),
    tblBox(
      0.175,
      0.195,
      0.0,
      0.246,
      0.085,
      0.105,
      L,
      L,
      [0.16, 0.1],
      [0.16, 0.15],
      [0.36, 0],
      [0.02, 0.05],
      [0.32, 0],
      [0.36, 0.05],
      0.8
    ),
    /* царга утоплена в ножки вдоль X (перекрытие) */
    tblBox(
      -0.186,
      0.186,
      0.1,
      0.115,
      -0.098,
      -0.088,
      E,
      E,
      [0.02, 0.38],
      [0.02, 0.4],
      [0.02, 0.3],
      [0.02, 0.34],
      [0.3, 0.3],
      [0.34, 0.3],
      0.6
    ),
    tblStrap(-0.066, 0.95),
    tblStrap(0.066, 0.95)
  );
  return { arr: new Float32Array(V), n: V.length / 9 };
}

function tboxPart(y0, y1, w0, w1, d0, d1) {
  const V = [];
  const push = (p, n) => {
    V.push(p[0], p[1], p[2], 0.5, 0.5, n[0], n[1], n[2], 1);
  };
  const quad = (a, b, c, d, n) => {
    for (const tri of [
      [0, 1, 2],
      [0, 2, 3]
    ])
      for (const i of tri) push([a, b, c, d][i], n);
  };
  quad([-w0, y0, -d0], [w0, y0, -d0], [w1, y1, -d1], [-w1, y1, -d1], [0, 0, -1]);
  quad([w0, y0, d0], [-w0, y0, d0], [-w1, y1, d1], [w1, y1, d1], [0, 0, 1]);
  quad([w0, y0, -d0], [w0, y0, d0], [w1, y1, d1], [w1, y1, -d1], [1, 0, 0]);
  quad([-w0, y0, d0], [-w0, y0, -d0], [-w1, y1, -d1], [-w1, y1, d1], [-1, 0, 0]);
  quad([-w1, y1, d1], [w1, y1, d1], [w1, y1, -d1], [-w1, y1, -d1], [0, 1, 0]);
  quad([-w0, y0, -d0], [w0, y0, -d0], [w0, y0, d0], [-w0, y0, d0], [0, -1, 0]);
  return V;
}

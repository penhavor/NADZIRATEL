/* =============== ПЕРСОНАЖ ИГРОКА ================
   Один риг на четыре задачи: отражение в луже, третье лицо, вьюмодель от первого
   лица (root = invView*VM_FRAME, торс и голова скрыты) и манекен.
   Риг в МИРОВОМ пространстве: +Y вверх, лицо и носки в сторону локальной -Z.
   Материалы атласа живут в непересекающихся u-зонах с защитными колонками;
   alpha = высота для бампа. Позы — клипы ANIM_CLIPS: шаги решаются 2-костным IK
   по траектории стопы, высота корня — из опорной кинематики, в полёте —
   баллистическая дуга. Контракты: buildPlayerRig, genSkinTex(seed), PREG/PMAT,
   fkAll + csSkin.
   Клипы пишут наклоны в конвенции +Z, риг смотрит в -Z — знаки переворачиваются
   на границе «клип→поза» (PL_FLIP). */

/* ---- геометрия ---- */
function partAO(V, ao) {
  for (let i = 8; i < V.length; i += 9) V[i] = ao;
  return V;
}
function partCat() {
  const out = [];
  for (const a of arguments) for (let i = 0; i < a.length; i++) out.push(a[i]);
  return out;
}
function partXf(V, dx, dy, dz, rx, ry, rz) {
  const cX = Math.cos(rx || 0),
    sX = Math.sin(rx || 0),
    cY = Math.cos(ry || 0),
    sY = Math.sin(ry || 0),
    cZ = Math.cos(rz || 0),
    sZ = Math.sin(rz || 0);
  const m = [
    cY * cZ + sY * sX * sZ,
    -cY * sZ + sY * sX * cZ,
    sY * cX,
    cX * sZ,
    cX * cZ,
    -sX,
    -sY * cZ + cY * sX * sZ,
    sY * sZ + cY * sX * cZ,
    cY * cX
  ];
  const o = [];
  for (let k = 0; k < V.length; k += 9) {
    const x = V[k],
      y = V[k + 1],
      z = V[k + 2];
    o.push(
      m[0] * x + m[1] * y + m[2] * z + dx,
      m[3] * x + m[4] * y + m[5] * z + dy,
      m[6] * x + m[7] * y + m[8] * z + dz,
      V[k + 3],
      V[k + 4]
    );
    const nx = V[k + 5],
      ny = V[k + 6],
      nz = V[k + 7];
    const lx = m[0] * nx + m[1] * ny + m[2] * nz,
      ly = m[3] * nx + m[4] * ny + m[5] * nz,
      lz = m[6] * nx + m[7] * ny + m[8] * nz;
    const l = Math.hypot(lx, ly, lz) || 1;
    o.push(lx / l, ly / l, lz / l, V[k + 8]);
  }
  return o;
}
function partShift(V, dx, dy, dz) {
  for (let i = 0; i < V.length; i += 9) {
    V[i] += dx;
    V[i + 1] += dy;
    V[i + 2] += dz;
  }
  return V;
}
const pr = (y, cx, cz, w, d, e) => [y, cx || 0, cz || 0, w, d, e || 2.4];
/* плавный лофт: последовательность суперэллиптических сечений, соединённых
   квадами со сглаженными нормалями. ring=[y,cx,cz,w,d,exp]. */
function loftPart(rings, seg, uv, caps) {
  const NR = rings.length,
    V = [];
  const P = [];
  for (let ri = 0; ri < NR; ri++) {
    const R = rings[ri],
      row = [];
    for (let si = 0; si < seg; si++) {
      const a = (si / seg) * Math.PI * 2,
        c = Math.cos(a),
        s2 = Math.sin(a),
        ex = R[5] || 2.2;
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / ex) * R[3],
        z = Math.sign(s2) * Math.pow(Math.abs(s2), 2 / ex) * R[4];
      row.push([x + (R[1] || 0), R[0], z + (R[2] || 0)]);
    }
    P.push(row);
  }
  const NG = [];
  for (let ri = 0; ri < NR; ri++) {
    const row = [];
    for (let si = 0; si < seg; si++) {
      const pu = P[ri][(si + 1) % seg],
        pd = P[ri][(si - 1 + seg) % seg];
      const up = P[Math.min(NR - 1, ri + 1)][si],
        dn = P[Math.max(0, ri - 1)][si];
      const t1 = [pu[0] - pd[0], pu[1] - pd[1], pu[2] - pd[2]],
        t2 = [up[0] - dn[0], up[1] - dn[1], up[2] - dn[2]];
      let n = [
        t1[1] * t2[2] - t1[2] * t2[1],
        t1[2] * t2[0] - t1[0] * t2[2],
        t1[0] * t2[1] - t1[1] * t2[0]
      ];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      const cx2 = P[ri][si][0] - (rings[ri][1] || 0),
        cz2 = P[ri][si][2] - (rings[ri][2] || 0);
      if (n[0] * cx2 + n[2] * cz2 < 0) n = [-n[0], -n[1], -n[2]];
      row.push(n);
    }
    NG.push(row);
  }
  const push = (pt, n, u, v) => {
    V.push(pt[0], pt[1], pt[2], u, v, n[0], n[1], n[2], 1);
  };
  const U = x => uv[0] + (uv[1] - uv[0]) * x,
    W = x => uv[2] + (uv[3] - uv[2]) * x;
  for (let ri = 0; ri < NR - 1; ri++)
    for (let si = 0; si < seg; si++) {
      const sj = (si + 1) % seg;
      const uB = si === seg - 1 ? uv[1] : U((si + 1) / seg);
      const a = P[ri][si],
        b = P[ri][sj],
        c = P[ri + 1][sj],
        d = P[ri + 1][si];
      push(a, NG[ri][si], U(si / seg), W(ri / (NR - 1)));
      push(b, NG[ri][sj], uB, W(ri / (NR - 1)));
      push(c, NG[ri + 1][sj], uB, W((ri + 1) / (NR - 1)));
      push(a, NG[ri][si], U(si / seg), W(ri / (NR - 1)));
      push(c, NG[ri + 1][sj], uB, W((ri + 1) / (NR - 1)));
      push(d, NG[ri + 1][si], U(si / seg), W((ri + 1) / (NR - 1)));
    }
  if (caps) {
    for (let si = 0; si < seg; si++) {
      const sj = (si + 1) % seg;
      push([rings[0][1] || 0, rings[0][0], rings[0][2] || 0], [0, -1, 0], U(si / seg), W(0));
      push(P[0][sj], [0, -1, 0], U((si + 1) / seg), W(0));
      push(P[0][si], [0, -1, 0], U(si / seg), W(0));
      push(
        [rings[NR - 1][1] || 0, rings[NR - 1][0], rings[NR - 1][2] || 0],
        [0, 1, 0],
        U(si / seg),
        W(1)
      );
      push(P[NR - 1][si], [0, 1, 0], U(si / seg), W(1));
      push(P[NR - 1][sj], [0, 1, 0], U((si + 1) / seg), W(1));
    }
  }
  return V;
}
function clawPart(len, r0, seg, uvv) {
  return loftPart(
    [
      [0, 0, 0, r0, r0, 2.0],
      [-len * 0.45, 0, -len * 0.1, r0 * 0.62, r0 * 0.62, 2.0],
      [-len, 0, -len * 0.34, r0 * 0.1, r0 * 0.1, 2.0]
    ],
    seg,
    uvv || [0.02, 0.48, 0.02, 0.98],
    true
  );
}

/* сглаженные нормали сетки (nu x nv, шаг 9), wrapU — замкнута по i */
function smoothGridNormals(V, nu, nv, wrapU) {
  const N = new Float32Array((V.length / 9) * 3);
  const idx = (i, j) => j * nu + i;
  const P = k => [V[k * 9], V[k * 9 + 1], V[k * 9 + 2]];
  const addN = (k, n) => {
    N[k * 3] += n[0];
    N[k * 3 + 1] += n[1];
    N[k * 3 + 2] += n[2];
  };
  const imax = wrapU ? nu : nu - 1;
  for (let j = 0; j < nv - 1; j++)
    for (let i = 0; i < imax; i++) {
      const i2 = wrapU ? (i + 1) % nu : i + 1;
      const a = P(idx(i, j)),
        b = P(idx(i2, j)),
        c = P(idx(i2, j + 1)),
        d = P(idx(i, j + 1));
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      addN(idx(i, j), n);
      addN(idx(i2, j), n);
      addN(idx(i2, j + 1), n);
      addN(idx(i, j + 1), n);
    }
  for (let k = 0; k < V.length / 9; k++) {
    const l = Math.hypot(N[k * 3], N[k * 3 + 1], N[k * 3 + 2]) || 1;
    V[k * 9 + 5] = N[k * 3] / l;
    V[k * 9 + 6] = N[k * 3 + 1] / l;
    V[k * 9 + 7] = N[k * 3 + 2] / l;
  }
  return V;
}
function gridToTris(V, nu, nv, wrapU) {
  const out = [];
  const push = k => {
    for (let q = 0; q < 9; q++) out.push(V[k * 9 + q]);
  };
  const idx = (i, j) => j * nu + i;
  const imax = wrapU ? nu : nu - 1;
  for (let j = 0; j < nv - 1; j++)
    for (let i = 0; i < imax; i++) {
      const i2 = wrapU ? (i + 1) % nu : i + 1;
      const a = idx(i, j),
        b = idx(i2, j),
        c = idx(i2, j + 1),
        d = idx(i, j + 1);
      push(a);
      push(b);
      push(c);
      push(a);
      push(c);
      push(d);
    }
  return out;
}
/* разворачиваем нормали наружу от оси головы (0,y,cz(y)) */
function normalsOutward(V, centerFn) {
  for (let k = 0; k < V.length / 9; k++) {
    const x = V[k * 9],
      y = V[k * 9 + 1],
      z = V[k * 9 + 2],
      c = centerFn(y);
    const rx = x - c[0],
      rz = z - c[1];
    const nx = V[k * 9 + 5],
      nz = V[k * 9 + 7];
    if (nx * rx + nz * rz < 0) {
      V[k * 9 + 5] = -nx;
      V[k * 9 + 6] = -V[k * 9 + 6];
      V[k * 9 + 7] = -nz;
    }
  }
  return V;
}
const cl01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const clp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smk = k => k * k * (3 - 2 * k);

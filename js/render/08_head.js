/* ==== ГОЛОВА. phi=0 — лицо (локальная -Z), ±π — затылок. y — вверх от кости hd. ==== */
const HEAD_Y0 = -0.04,
  HEAD_Y1 = 0.203;
const HEAD_PROF = [
  [-0.04, 0.034, 0.038, -0.026, 2.1],
  [-0.022, 0.05, 0.056, -0.021, 2.2],
  [0.0, 0.06, 0.069, -0.014, 2.3],
  [0.024, 0.066, 0.077, -0.009, 2.4],
  [0.052, 0.07, 0.083, -0.005, 2.5],
  [0.086, 0.074, 0.087, -0.003, 2.6],
  [0.118, 0.078, 0.091, -0.001, 2.7],
  [0.152, 0.076, 0.089, 0.001, 2.7],
  [0.178, 0.066, 0.079, 0.004, 2.6],
  [0.203, 0.014, 0.02, 0.008, 2.4]
];
function hermite(t) {
  return t * t * (3 - 2 * t);
}
function profAt(y) {
  const P = HEAD_PROF;
  y = clp(y, P[0][0], P[P.length - 1][0]);
  let i = 0;
  while (i < P.length - 2 && y > P[i + 1][0]) i++;
  const t = hermite(cl01((y - P[i][0]) / (P[i + 1][0] - P[i][0])));
  const o = [y];
  for (let k = 1; k < 5; k++) o[k] = P[i][k] + (P[i + 1][k] - P[i][k]) * t;
  return o;
}
const HEAD_BUMPS = [
  [0.42, 0.088, -0.008, 0.26, 0.03],
  [-0.42, 0.088, -0.008, 0.26, 0.03] /* глазницы */,
  [0.36, 0.124, 0.0075, 0.3, 0.016],
  [-0.36, 0.124, 0.0075, 0.3, 0.016] /* надбровные дуги */,
  [0.82, 0.07, 0.006, 0.32, 0.028],
  [-0.82, 0.07, 0.006, 0.32, 0.028] /* скулы */,
  [1.25, 0.132, -0.0045, 0.3, 0.04],
  [-1.25, 0.132, -0.0045, 0.3, 0.04] /* виски */,
  [1.5, 0.012, 0.005, 0.32, 0.034],
  [-1.5, 0.012, 0.005, 0.32, 0.034] /* углы челюсти */,
  [0.0, -0.032, 0.009, 0.32, 0.024] /* подбородок */,
  [0.0, 0.006, -0.0055, 0.4, 0.018] /* ротовая впадина */,
  [Math.PI, 0.02, 0.007, 0.6, 0.05] /* затылок */,
  [0.0, 0.152, 0.0035, 0.5, 0.034] /* лоб */,
  [0.0, 0.064, -0.0035, 0.15, 0.018] /* переносица */,
  [0.55, 0.045, 0.004, 0.3, 0.03],
  [-0.55, 0.045, 0.004, 0.3, 0.03] /* щёки */,
  [0.55, -0.014, -0.0028, 0.28, 0.02],
  [-0.55, -0.014, -0.0028, 0.28, 0.02] /* под скулами */
];
function headSurf(phi, y) {
  const p = profAt(y);
  const c = Math.cos(phi),
    s = Math.sin(phi),
    e = p[4];
  const x = Math.sign(s) * Math.pow(Math.abs(s), 2 / e) * p[1];
  const z = -Math.sign(c) * Math.pow(Math.abs(c), 2 / e) * p[2] + p[3];
  let r = 0;
  for (const b of HEAD_BUMPS) {
    let d = phi - b[0];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    r +=
      b[2] * Math.exp(-(d * d) / (2 * b[3] * b[3]) - ((y - b[1]) * (y - b[1])) / (2 * b[4] * b[4]));
  }
  const rx = x,
    rz = z - p[3],
    rl = Math.hypot(rx, rz) || 1;
  return [x + (rx / rl) * r, y, z + (rz / rl) * r];
}
function headNorm(phi, y) {
  const e = 0.0035;
  const p = headSurf(phi, y),
    pu = headSurf(phi + e, y),
    pv = headSurf(phi, y + e);
  const u = [pu[0] - p[0], pu[1] - p[1], pu[2] - p[2]],
    v = [pv[0] - p[0], pv[1] - p[1], pv[2] - p[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  n = [n[0] / l, n[1] / l, n[2] / l];
  const c = profAt(y)[3];
  if (n[0] * p[0] + n[2] * (p[2] - c) < 0) n = [-n[0], -n[1], -n[2]];
  return n;
}
/* UV головы: лицо (|phi|<60°) получает ~62% ширины зоны кожи */
const HEAD_U0 = 0.5,
  HEAD_U1 = 0.7,
  HEAD_V0 = 0.5,
  HEAD_V1 = 0.985;
const HEAD_WP = 0.435;
function headU(phi) {
  const a = clp(phi / (2 * Math.PI), -0.5, 0.5);
  const d = Math.min(1, Math.abs(a) * 2);
  return HEAD_U0 + (HEAD_U1 - HEAD_U0) * (0.5 + Math.sign(a) * 0.5 * Math.pow(d, HEAD_WP));
}
function headV(y) {
  return HEAD_V0 + (HEAD_V1 - HEAD_V0) * cl01((y - HEAD_Y0) / (HEAD_Y1 - HEAD_Y0));
}
function headUV(phi, y) {
  return [headU(phi), headV(y)];
}
function invHeadU(u) {
  const q = cl01((u - HEAD_U0) / (HEAD_U1 - HEAD_U0));
  return Math.sign(q - 0.5) * Math.pow(Math.abs(q - 0.5) * 2, 1 / HEAD_WP) * Math.PI;
}
function invHeadV(v) {
  return HEAD_Y0 + (HEAD_Y1 - HEAD_Y0) * cl01((v - HEAD_V0) / (HEAD_V1 - HEAD_V0));
}
/* глаз: отдельное UV-окно в служебной полосе под подбородком */
const EYE_U0 = 0.502,
  EYE_U1 = 0.698,
  EYE_V0 = 0.482,
  EYE_V1 = 0.498;

/* =============== ЧЕРТЫ ЛИЦА ================
   Запекаются прямо в поверхность черепа (одна сетка, без швов). Размеры в метрах
   дуги: hx — по горизонтали лица, hy — высота. */
const EYE_HX = 0.0315,
  EYE_HY = 0.088; /* центры глаз (x,y) */
const EYE_R = 0.0135,
  EYE_ZC = -0.0602; /* радиус глазного яблока и глубина центра */
const EYE_AX = 0.0075,
  EYE_AY = 0.0052; /* полуоси глазной щели */
function faceFeat(hx, hy) {
  let h = 0;
  for (const sg of [1, -1]) {
    const dx = hx - sg * EYE_HX;
    /* бровь */
    const arc = 0.117 + 0.011 * (1 - cl01(Math.abs(dx) / 0.048) * (Math.abs(dx) / 0.048));
    const bt = smk(cl01(1 - Math.pow(Math.abs(dx) / 0.046, 2)));
    h += 0.0052 * Math.exp(-Math.pow((hy - arc) / 0.008, 2)) * bt;
  }
  /* нос */
  const bridge = 0.0075 * Math.exp(-Math.pow(hx / 0.0082, 2)) * smk(cl01((hy - 0.03) / 0.048));
  const tip =
    0.0165 * Math.exp(-Math.pow(hx / 0.0078, 2)) * Math.exp(-Math.pow((hy - 0.047) / 0.0128, 2));
  const ala =
    0.0062 *
    Math.exp(-Math.pow((Math.abs(hx) - 0.017) / 0.0062, 2)) *
    Math.exp(-Math.pow((hy - 0.037) / 0.0112, 2));
  const nostril =
    -0.005 *
    Math.exp(-Math.pow((Math.abs(hx) - 0.0108) / 0.004, 2)) *
    Math.exp(-Math.pow((hy - 0.0245) / 0.0048, 2));
  h += Math.max(0, bridge + tip + ala) + nostril;
  h -=
    0.0012 *
    Math.exp(-Math.pow(hx / 0.004, 2)) *
    Math.exp(-Math.pow((hy - 0.025) / 0.006, 2)); /* губной желобок */
  /* рот */
  const tm = smk(cl01(1 - Math.pow(Math.abs(hx) / 0.0265, 2)));
  const upper =
    0.006 *
    Math.exp(-Math.pow((hy - 0.0165) / 0.0088, 2)) *
    (0.8 + 0.2 * Math.exp(-Math.pow((Math.abs(hx) - 0.01) / 0.008, 2)));
  const lower =
    0.0072 *
    Math.exp(-Math.pow((hy - 0.0035) / 0.0098, 2)) *
    (0.85 + 0.15 * Math.exp(-Math.pow(hx / 0.01, 2)));
  const line = -0.0052 * Math.exp(-Math.pow((hy - 0.011) / 0.003, 2));
  const corner =
    -0.0028 *
    Math.exp(-Math.pow((Math.abs(hx) - 0.0245) / 0.004, 2)) *
    Math.exp(-Math.pow((hy - 0.011) / 0.008, 2));
  h += (upper + lower + line + corner) * tm;
  /* подбородок и носогубные складки */
  h -= 0.0018 * Math.exp(-Math.pow((hy + 0.014) / 0.006, 2)) * Math.exp(-Math.pow(hx / 0.012, 2));
  h -=
    0.0012 *
    Math.exp(-Math.pow((Math.abs(hx) - 0.02) / 0.005, 2)) *
    Math.exp(-Math.pow((hy - 0.03) / 0.012, 2));
  return h;
}
function headSurfF(phi, y) {
  const p = headSurf(phi, y);
  if (Math.abs(phi) > 1.85) return p; /* черты только на лице и скулах */
  const hx = phi * 0.075;
  const n = headNorm(phi, y);
  const h = faceFeat(hx, y);
  let q = [p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h];
  /* веки как оболочка вокруг глазного яблока + глазная щель */
  for (const sg of [1, -1]) {
    const dx = q[0] - sg * EYE_HX,
      dy = q[1] - EYE_HY;
    const off = Math.hypot(dx, dy);
    if (off > EYE_R * 1.25) continue;
    const zz = Math.sqrt(Math.max(EYE_R * EYE_R - off * off, 1e-8));
    const ex = dx / EYE_AX,
      ey = dy / EYE_AY;
    const rho = Math.hypot(ex, ey);
    let z;
    if (rho < 1.0) z = EYE_ZC - zz + 0.0012; /* щель: за роговицей */
    else if (rho < 1.45)
      z = EYE_ZC - zz - 0.0018 - 0.001 * smk(cl01((rho - 1.0) / 0.45)); /* кромка века */
    else z = EYE_ZC - zz - 0.0028; /* веко на глазном яблоке */
    /* смешивание с поверхностью лица */
    const k = smk(cl01((off - EYE_R * 0.95) / (EYE_R * 0.3)));
    q[2] = z + (q[2] - z) * k;
  }
  return q;
}
/* неравномерная выборка: больше рядов и колонок на лицо */
function phiAt(q) {
  const d = (q - 0.5) * 2;
  return Math.sign(d) * Math.pow(Math.abs(d), 1.3) * Math.PI;
}
function yAt(t) {
  return (
    HEAD_Y0 + (HEAD_Y1 - HEAD_Y0) * (t - (0.3 * Math.sin(2 * Math.PI * (t - 0.42))) / (2 * Math.PI))
  );
}

function headGrid(nu, nv) {
  const V = [];
  for (let j = 0; j < nv; j++) {
    /* yAt на последнем ряду «перескакивает» макушку (0.2096 вместо 0.203), поэтому
   y зажимается до HEAD_Y1 — иначе концевое кольцо черепа протыкало бы волосы
   ярким воротником. Колпак черепу не нужен. */
    const y = Math.min(HEAD_Y1, yAt(j / (nv - 1)));
    for (let i = 0; i < nu; i++) {
      const phi = phiAt(i / nu);
      const p = headSurfF(phi, y),
        uv = headUV(phi, y);
      V.push(p[0], p[1], p[2], uv[0], uv[1], 0, 0, 0, 1);
    }
  }
  smoothGridNormals(V, nu, nv, true);
  normalsOutward(V, y => [0, profAt(y)[3]]);
  const tris = gridToTris(V, nu, nv, true);
  const cz = profAt(HEAD_Y1)[3];
  const top = [0, HEAD_Y1 + 0.0006, cz];
  for (let i = 0; i < nu; i++) {
    const ka = ((nv - 1) * nu + i) * 9,
      kb = ((nv - 1) * nu + ((i + 1) % nu)) * 9;
    tris.push(top[0], top[1], top[2], 0.6, 0.98, 0, 0.97, 0.2, 1);
    for (const k of [ka, kb]) for (let q = 0; q < 9; q++) tris.push(V[k + q]);
  }
  return tris;
}
/* глазное яблоко: сфера, ось взгляда -Z; UV: u — меридиан, v — полярный угол */
function eyeball(cx, cy, cz, R) {
  const ns = 12,
    nt = 9,
    V = [];
  for (let j = 0; j < nt; j++) {
    const th = (j / (nt - 1)) * 1.35;
    for (let i = 0; i < ns; i++) {
      const ph = (i / ns) * 2 * Math.PI;
      const d = [Math.sin(th) * Math.sin(ph), Math.sin(th) * Math.cos(ph), -Math.cos(th)];
      const x = cx + R * d[0],
        y = cy + R * d[1] * 0.96,
        z = cz + R * d[2];
      const u = EYE_U0 + (EYE_U1 - EYE_U0) * (i / ns),
        v = EYE_V0 + (EYE_V1 - EYE_V0) * (th / 1.35);
      V.push(x, y, z, u, v, d[0], d[1], d[2], 1);
    }
  }
  return gridToTris(V, ns, nt, true);
}
/* ухо: сплюснутый эллипсоид с раковиной, корень утоплен в череп */
function earPart(sg) {
  const ns = 14,
    nt = 12,
    V = [];
  const CX = sg * 0.0705,
    CY = 0.07,
    CZ = 0.012; /* центр уха */
  const RX = 0.01,
    RY = 0.032,
    RZ = 0.021; /* полуоси: толщина, высота, глубина */
  const tilt = 0.16 * sg,
    yaw = 0.35 * sg; /* наклонено назад и наружу */
  for (let j = 0; j < nt; j++) {
    const th = (j / (nt - 1)) * Math.PI; /* 0..π сверху вниз */
    for (let i = 0; i < ns; i++) {
      const ph = (i / ns) * 2 * Math.PI; /* вокруг уха */
      let dx = Math.sin(th) * Math.sin(ph) * RX,
        dy = Math.cos(th) * RY,
        dz = Math.sin(th) * Math.cos(ph) * RZ;
      /* раковина: впадина с внешней стороны, спереди снизу */
      const conch = Math.exp(
        -Math.pow((ph - Math.PI * 0.5) / 1.1, 2) - Math.pow((th - Math.PI * 0.55) / 0.75, 2)
      );
      dx -= sg * conch * 0.0045;
      /* завиток: гребень вдоль края */
      const rim = Math.exp(
        -Math.pow((Math.hypot(Math.sin(ph) * 1.0, Math.cos(th) * 1.0) - 0.92) / 0.3, 2)
      );
      dx += sg * rim * 0.0022;
      /* наклон */
      const y2 = dy * Math.cos(tilt) - dz * Math.sin(tilt),
        z2 = dy * Math.sin(tilt) + dz * Math.cos(tilt);
      const x3 = dx * Math.cos(yaw) + z2 * Math.sin(yaw),
        z3 = -dx * Math.sin(yaw) + z2 * Math.cos(yaw);
      const u = 0.5 + 0.2 * (i / ns),
        v = 0.3 + 0.18 * (j / (nt - 1));
      V.push(CX + x3, CY + y2, CZ + z3, u, v, sg, 0, 0, 1);
    }
  }
  smoothGridNormals(V, ns, nt, true);
  return gridToTris(V, ns, nt, true);
}

/* ---- сборка частей головы ---- */
function buildHeadParts() {
  return partCat(
    partAO(headGrid(44, 38), 0.55),
    partAO(eyeball(EYE_HX, EYE_HY, EYE_ZC, EYE_R), 0.66),
    partAO(eyeball(-EYE_HX, EYE_HY, EYE_ZC, EYE_R), 0.66),
    partAO(earPart(1), 0.58),
    partAO(earPart(-1), 0.58)
  );
}

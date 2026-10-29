/* =============== ВЬЮМОДЕЛЬ ОТ ПЕРВОГО ЛИЦА ================
   Руки: плечо ниже кадра, локоть согнут на ~95°, предплечье вверх-вперёд-внутрь,
   кисти в ~0.35 м перед камерой, ладони друг к другу. Плюс «ограничение» стеной. */
function m4sc(s) {
  const m = new Float32Array(16);
  m[0] = s;
  m[5] = s;
  m[10] = s;
  m[15] = 1;
  return m;
}
const VM_YAW = 0.0;
const VM_DROP = -1.62,
  VM_FWD = -0.18; /* в единицах рига; в клетках — через PL_SCALE */
const PL_SCALE = 0.345;
/* Вьюмодель равномерно масштабируется вокруг камеры (VM_SCALE): проекция не
   меняется (точки остаются на тех же лучах), но руки, лампа и луч честно
   начинаются в ~0.58 м от глаз — луч не стартует за ближней стеной. */
const VM_SCALE = PL_SCALE;
/* высота глаз спокойной стойки в единицах рига (замер FK по idle: кость hd +
   центры глаз EYE_HY/EYE_ZC). Камера от первого лица = 0.55 клетки +
   (текущая − эта)·PL_SCALE. */
const EYE_REF_RIG = 1.7205;
const VM_FRAME = (function () {
  return m4mul(
    m4t(0, VM_DROP * PL_SCALE, VM_FWD * PL_SCALE),
    m4mul(m4rotY(VM_YAW), m4sc(VM_SCALE))
  );
})();

/* ПРЕДМЕТ В РУКЕ. Ось предмета — локальная +X; поправки крепления решаются
   ЧИСЛЕННО по FK рига, одна для первого и третьего лица (угол ошибки < 1.5°).
   Ключ и батарейка — GRIP_KEY/GRIP_BATT (щипок PINCH_POSE). Фонарь: кисть
   повёрнута так, что ось кулака идёт вдоль луча, поправка — ЧИСТЫЙ ПЕРЕНОС центра
   захвата (локальный x=-0.070) на ось кулака; фаланги смыкаются вокруг трубы
   (2.0–3.1 см при радиусе 1.9 см). */
function heldMat(dx, dy, dz, ry, rz) {
  return m4mul(m4t(dx, dy, dz), m4mul(m4rotZ(rz), m4rotY(ry)));
}
const GRIP_FLASH = m4t(0.07, -0.095, 0.026);
/* опора большого пальца на торцевую кнопку (t1,t2), решено по FK */
const GRIP_THUMB = [
  [-0.369, 0.146, -0.09],
  [-0.196, 0, 0]
];
/* ЩИПОК: указательный нависает над предметом, большой палец идёт ВОКРУГ кисти
   СНАРУЖИ (без проникновения в ладонь) и прижимает с другой стороны. Углы ha —
   стойка вьюмодели. */
const PINCH_POSE = {
  i1: [-1.13, 0, 0.008],
  i2: [-1.75, 0, 0],
  i3: [-0.26, 0, 0],
  m1: [-0.96, 0, 0.036],
  m2: [-1.4, 0, 0],
  m3: [-0.27, 0, 0],
  r1: [-0.932, 0, 0.064],
  r2: [-1.1392, 0, 0],
  r3: [-0.7767, 0, 0],
  p1: [-0.8567, 0, 0.092],
  p2: [-1.047, 0, 0],
  p3: [-0.7139, 0, 0],
  t1: [-0.66, -0.62, -0.02],
  t2: [-0.56, 0, 0]
};
const PINCH_HA = [-0.52, -1.28, 0.16];
/* Захват мелкого предмета: ось предмета лежит в плоскости кольца пальцев (торец
   смотрит на камеру), бородка ключа или плюс батарейки выступают ЗА кончики
   пальцев. Решено по FK всей цепочки руки, точка P — между подушечками. */
const GRIP_KEY = (() => {
  const m = new Float32Array([
    0.1744, 0.9845, 0.0182, 0, 0.1038, 0, -0.9946, 0, -0.9792, 0.1754, -0.1022, 0, -0.0568, -0.1579,
    0.0143, 1
  ]);
  return m;
})();
const GRIP_BATT = (() => {
  const m = new Float32Array([
    -0.1744, -0.9845, -0.0182, 0, -0.1038, 0, 0.9946, 0, -0.9792, 0.1754, -0.1022, 0, -0.0429,
    -0.0509, 0.0223, 1
  ]);
  return m;
})();
const GRIP_SMALL_L = heldMat(0.004, -0.085, 0.015, -1.316, -2.91);
/* прямой захват: кисть + пальцы (аналог fpHand, но ha задаётся явно) */
function gripHand(p, S, wr, cu, sp, thO, thK) {
  const s = S === 'L' ? 1 : -1;
  p['ha' + S] = [wr[0], wr[1], wr[2]];
  const F = { i: 0.94, m: 1.0, r: 0.95, p: 0.82 },
    ph = { i: 0.0, m: 0.34, r: 0.68, p: 1.02 };
  for (const f of ['i', 'm', 'r', 'p']) {
    const c = cu * F[f] + 0.1,
      spp = (sp + ph[f] * 0.5) * 0.16;
    p[f + '1' + S] = [-c * 0.36, 0, s * spp];
    p[f + '2' + S] = [-c * 0.44, 0, 0];
    p[f + '3' + S] = [-c * 0.3, 0, 0];
  }
  p['t1' + S] = [-0.3 - cu * 0.25, 0, -s * (0.42 + sp * 0.1)];
  p['t2' + S] = [-0.22 - cu * 0.3, 0, 0];
  /* большой палец НА ТОРЦЕВОЙ КНОПКЕ (решено численно по FK: подушечка у края
   кнопки, импульс F всегда её нажимает) */
  if (thO && thK > 0.001) {
    for (let i = 0; i < 3; i++) {
      p['t1' + S][i] = p['t1' + S][i] + (thO[0][i] - p['t1' + S][i]) * thK;
      p['t2' + S][i] = p['t2' + S][i] + (thO[1][i] - p['t2' + S][i]) * thK;
    }
  }
}
/* ЗАМЕНА БАТАРЕЙКИ — ключевые кадры обеих рук (первое лицо). Каналы: ua/fa, wr,
   cu/sp. u = t/RL_DUR, между кадрами smoothstep. Сюжет: поднести к груди →
   левая перехватывает корпус → правая отвинчивает крышку → левая уносит севшую →
   вставляет новую → завинчивает крышку до места. */
const RL_KEYS = [
  {
    u: 0.0,
    uaL: [1.0, -0.1, 0.5],
    faL: [2.2, 0.1, -0.1],
    wrL: [-0.42, -1.02, 0.2],
    cuL: 1.05,
    spL: 0.02,
    uaR: [1.0, 0.1, -0.5],
    faR: [2.2, -0.1, 0.1],
    wrR: [-0.42, 1.02, -0.2],
    cuR: 0.95,
    spR: 0.1
  },
  {
    u: 0.1,
    uaL: [0.98, -0.24, 0.3],
    faL: [1.98, 0.3, -0.38],
    wrL: [-0.34, -0.8, 0.48],
    cuL: 1.1,
    spL: 0.02,
    uaR: [1.14, 0.3, -0.28],
    faR: [2.42, -0.44, 0.24],
    wrR: [-0.36, 0.86, -0.3],
    cuR: 0.42,
    spR: 0.55
  },
  {
    u: 0.24,
    uaL: [0.9, -0.28, 0.22],
    faL: [1.85, 0.34, -0.5],
    wrL: [-0.25, -0.55, 0.85],
    cuL: 1.1,
    spL: 0.0,
    uaR: [1.05, 0.35, -0.22],
    faR: [2.2, -0.55, 0.22],
    wrR: [-0.34, 0.75, -0.26],
    cuR: 1.0,
    spR: 0.05
  },
  {
    u: 0.4,
    uaL: [0.9, -0.28, 0.22],
    faL: [1.85, 0.34, -0.5],
    wrL: [-0.18, -0.5, 0.95],
    cuL: 1.1,
    spL: 0.0,
    uaR: [0.92, 0.12, -0.48],
    faR: [1.98, -0.22, 0.44],
    wrR: [-0.5, 0.7, -0.55],
    cuR: 1.05,
    spR: 0.02
  },
  {
    u: 0.56,
    uaL: [0.9, -0.28, 0.22],
    faL: [1.85, 0.34, -0.5],
    wrL: [-0.18, -0.5, 0.95],
    cuL: 1.1,
    spL: 0.0,
    uaR: [0.8, 0.05, -0.6],
    faR: [1.75, -0.15, 0.5],
    wrR: [-0.58, 0.66, -0.62],
    cuR: 0.7,
    spR: 0.3
  },
  {
    u: 0.7,
    uaL: [0.9, -0.28, 0.22],
    faL: [1.85, 0.34, -0.5],
    wrL: [-0.25, -0.55, 0.85],
    cuL: 1.1,
    spL: 0.0,
    uaR: [1.05, 0.35, -0.22],
    faR: [2.2, -0.55, 0.22],
    wrR: [-0.34, 0.75, -0.26],
    cuR: 1.02,
    spR: 0.04
  },
  {
    u: 0.84,
    uaL: [0.95, -0.22, 0.3],
    faL: [2.0, 0.28, -0.36],
    wrL: [-0.32, -0.78, 0.5],
    cuL: 1.08,
    spL: 0.01,
    uaR: [1.08, 0.22, -0.32],
    faR: [2.32, -0.32, 0.2],
    wrR: [-0.38, 0.84, -0.26],
    cuR: 0.6,
    spR: 0.35
  },
  {
    u: 1.0,
    uaL: [1.0, -0.1, 0.5],
    faL: [2.2, 0.1, -0.1],
    wrL: [-0.42, -1.02, 0.2],
    cuL: 1.05,
    spL: 0.02,
    uaR: [1.0, 0.1, -0.5],
    faR: [2.2, -0.1, 0.1],
    wrR: [-0.42, 1.02, -0.2],
    cuR: 0.95,
    spR: 0.1
  }
];
function rlSample(u) {
  const K = RL_KEYS,
    n = K.length;
  u = Math.max(0, Math.min(1, u));
  let i = 0;
  while (i < n - 2 && u > K[i + 1].u) i++;
  const A = K[i],
    B = K[i + 1];
  const span = Math.max(1e-6, B.u - A.u);
  const f0 = Math.max(0, Math.min(1, (u - A.u) / span)),
    f = f0 * f0 * (3 - 2 * f0);
  const mix3 = (a, b) => [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f
  ];
  return {
    uaL: mix3(A.uaL, B.uaL),
    faL: mix3(A.faL, B.faL),
    wrL: mix3(A.wrL, B.wrL),
    cuL: A.cuL + (B.cuL - A.cuL) * f,
    spL: A.spL + (B.spL - A.spL) * f,
    uaR: mix3(A.uaR, B.uaR),
    faR: mix3(A.faR, B.faR),
    wrR: mix3(A.wrR, B.wrR),
    cuR: A.cuR + (B.cuR - A.cuR) * f,
    spR: A.spR + (B.spR - A.spR) * f
  };
}
/* окна видимости батарейки в ЛЕВОЙ руке во время замены (u):
   севшая — достали и уронили (0.26…0.50), новая — из кармана в корпус (0.54…0.75) */
function rlBattOld(u) {
  return u >= 0.26 && u <= 0.5;
}
function rlBattNew(u) {
  return u >= 0.54 && u <= 0.75;
}

/* поза кисти для вьюмодели: сгиб, растопырка, приведение */
function fpHand(p, S, curl, spread, palmYaw, palmRoll, wrist) {
  for (const n of ['L', 'R']) {
    const s = S === 'L' ? 1 : -1;
    p['ha' + S] = [wrist[0], palmYaw * s + wrist[1], palmRoll * s + wrist[2]];
    const F = { i: 0.94, m: 1.0, r: 0.95, p: 0.82 },
      ph = { i: 0.0, m: 0.34, r: 0.68, p: 1.02 };
    for (const f of ['i', 'm', 'r', 'p']) {
      const c = curl * F[f] + 0.1,
        sp = (spread + ph[f] * 0.5) * 0.16;
      p[f + '1' + S] = [-c * 0.36, 0, s * sp];
      p[f + '2' + S] = [-c * 0.44, 0, 0];
      p[f + '3' + S] = [-c * 0.3, 0, 0];
    }
    p['t1' + S] = [-0.3 - curl * 0.25, 0, -s * (0.42 + spread * 0.1)];
    p['t2' + S] = [-0.22 - curl * 0.3, 0, 0];
  }
  return p;
}
function playerPoseFP(st, t) {
  const r = playerPose(st, t, 'fp');
  const p = r.pose;
  t = t || 0;
  /* «спокойная» поза (st._calm) — для луча ограничения рук: дыхательное
   покачивание кистей не должно пульсировать целью прижима к стене. */
  const ib = (st._calm ? 0 : 1) * (Math.sin(t * 1.3) * 0.01 + Math.sin(t * 2.17) * 0.004);
  const mv = Math.min(1, st.bobA || 0);
  const sw = Math.sin(st.animPhase || 0) * mv;
  const ex = clp(1 - (st.stam === undefined ? 1 : st.stam), 0, 1);
  const runK = st.runK || 0;
  /* торс вьюмодели НЕ наследует наклон приседа и бега из клипов: плечевой сустав
   остаётся на месте относительно камеры — руки держатся у тела, а «обрубки» плеч
   по краям кадра исчезли. */
  const crT = clp(st.pCrouch || 0, 0, 1);
  p.pel = [0.1 * crT + 0.05 * runK, (p.pel ? p.pel[1] : 0) * 0.25, (p.pel ? p.pel[2] : 0) * 0.25];
  p.spn = [0.05 * crT + 0.04 * runK, 0, 0];
  p.ch = [0.07 * crT + 0.06 * runK, 0, 0];
  p.nk = [-0.06 * crT - 0.04 * runK, 0, 0];
  p.hd = [-0.04 * crT - 0.03 * runK, 0, 0];
  /* усталость в вьюмодели — ПЛАВНОЕ покачивание рук: сглаженная огибающая st._exS
   и непрерывная фаза st._exPh из playerPose (~0.3 Гц + дрейф ~0.16 Гц, амплитуда
   ~1°) — от такого покачивания глаза не устают. */
  const exS = clp(st._exS || 0, 0, 1),
    exPh = st._exPh || 0;
  const fb1 = Math.sin(exPh),
    fb2 = Math.sin(exPh * 0.53 + 1.7);
  const swExL = exS * (0.016 * fb1 + 0.009 * fb2),
    swExR = exS * (0.016 * fb1 - 0.009 * fb2);
  /* ограничение стеной: 0 — свободно, 1 — руки прижаты к телу */
  const tkL = clp(st.vmTuckL || 0, 0, 1),
    tkR = clp(st.vmTuckR || 0, 0, 1);
  const tk = Math.max(tkL, tkR);
  /* фонарь в правой руке (не во время замены) — особый захват */
  const rlNow0 = !!(st.fl && st.fl.rl > 0);
  const holdFl =
    !rlNow0 && !!(st.inv && st.sel >= 0 && st.inv[st.sel] && st.inv[st.sel].kind === 'flash');
  /* правая рука занята ЛЮБЫМ предметом — тогда взаимодействие тянет левую руку */
  const selIt0 = st.inv && st.sel >= 0 ? st.inv[st.sel] : null;
  const heldAny = !rlNow0 && !!selIt0;
  const pkAct = !!st.pk; /* подбор: правая тянется, предмет в верхней точке */
  const isKey = st.pActKind === 'key'; /* вентиль финальной двери проворачивает правая рука */
  const holdSm = heldAny && (selIt0.kind === 'key' || selIt0.kind === 'batt');
  /* базовые углы: плечо вперёд-вниз-наружу, локоть согнут */
  const uaX =
    1.0 +
    mv * 0.05 +
    runK * 0.02 -
    crT * 0.1 -
    tk * 0.5; /* бег и присед почти не толкают руки вперёд — кисти остаются у тела */
  const uaZ = 0.5 - mv * 0.03 - runK * 0.06 - crT * 0.06 - tk * 0.12; /* локти ближе к торсу */
  const faX = 2.2 - sw * 0.08 * mv - runK * 0.02 + crT * 0.1 + tk * 0.55;
  const faZ = -0.1 + tk * 0.06;
  p.uaL = [uaX + sw * 0.1 * mv + ib + swExL, -0.1 - tk * 0.1, uaZ];
  p.uaR = [uaX - sw * 0.1 * mv - ib + swExR, 0.1 + tk * 0.1, -uaZ];
  p.faL = [faX + swExL * 0.6, 0.1, faZ];
  p.faR = [faX + swExR * 0.6, -0.1, -faZ];
  p.shL = [0, 0, 0.06 + tk * 0.1];
  p.shR = [0, 0, -0.06 - tk * 0.1];
  /* кисти: ладони внутрь, чуть вниз; у стены — ладонь плоско вперёд */
  const palmY = -1.02 + tk * 0.85,
    palmR = 0.3 - tk * 0.25;
  const wrist = [-0.42 + tk * 0.75 + ib * 1.5, 0, -0.1 + sw * 0.06 * mv];
  fpHand(p, 'L', 0.95 + runK * 0.25 + tk * 0.1, 0.1 + tk * 1.6, palmY, palmR, wrist);
  fpHand(p, 'R', 0.95 + runK * 0.25 + tk * 0.1, 0.1 + tk * 1.6, palmY, palmR, [
    wrist[0],
    -wrist[1],
    -wrist[2]
  ]);
  /* действие E следует таймлайну клипа (pShotT0), а не импульсу:
   взаимодействие 0.75 с — ПРАВАЯ рука (кость 'L', риг зеркален) тянется ВПЕРЕД и
   хватает; толчок 0.9 с — обе ладони идут плоско вперёд и толкают. */
  const isPush = st.pActKind === 'door';
  const actLen = isPush ? 0.9 : 0.75;
  let cA = 1.5;
  if ((st.pShot === 'interact' || st.pShot === 'push') && st.pShotT0 !== undefined)
    cA = (t - st.pShotT0) / actLen;
  cA = clp(cA, 0, 1.5);
  let ext = 0,
    grb = 0;
  if (cA <= 1) {
    if (isPush) {
      ext = sm(clp(cA / 0.34, 0, 1)) * (1 - sm(clp((cA - 0.52) / 0.44, 0, 1)));
    } else {
      ext = sm(clp((cA - 0.05) / 0.32, 0, 1)) * (1 - sm(clp((cA - 0.58) / 0.4, 0, 1)));
      grb = sm(clp((cA - 0.38) / 0.14, 0, 1)) * (1 - sm(clp((cA - 0.62) / 0.3, 0, 1)));
    }
  }
  /* фильтр скорости против однокадровых стыков (смена клипов, пауза) */
  const dta = clp(t - (st._actT === undefined ? t : st._actT), 0, 0.1);
  st._actT = t;
  const act = (st._actS || 0) + clp(ext - (st._actS || 0), -dta * 6.0, dta * 6.0);
  st._actS = act;
  const grbS = (st._grbS || 0) + clp(grb - (st._grbS || 0), -dta * 6.0, dta * 6.0);
  st._grbS = grbS;
  if (act > 0.002 || grbS > 0.002) {
    const c0 = 0.95 + runK * 0.25 + tk * 0.1,
      s0 = 0.1 + tk * 1.6;
    if (isPush) {
      /* обе руки вперёд, ладони плоско к двери, пальцы расставлены */
      p.uaL = [p.uaL[0] + act * 0.45, p.uaL[1], p.uaL[2] - act * 0.1];
      p.uaR = [p.uaR[0] + act * 0.45, p.uaR[1], p.uaR[2] + act * 0.1];
      p.faL = [p.faL[0] - act * 1.6, p.faL[1], p.faL[2]];
      p.faR = [p.faR[0] - act * 1.6, p.faR[1], p.faR[2]];
      const wp = [wrist[0] + act * 0.16, wrist[1], wrist[2] - act * 0.06];
      fpHand(p, 'L', c0 - act * 0.62, s0 + act * 1.1, palmY + act * 0.78, palmR - act * 0.22, wp);
      fpHand(p, 'R', c0 - act * 0.62, s0 + act * 1.1, palmY + act * 0.78, palmR - act * 0.22, [
        wp[0],
        -wp[1],
        -wp[2]
      ]);
    } else if (heldAny && !isKey && !pkAct) {
      /* правая занята предметом — тянется ЛЕВАЯ (кость 'R'), правая сохраняет захват */
      p.uaR = [p.uaR[0] + act * 0.42 - 0.08 * grbS, p.uaR[1], p.uaR[2] + act * 0.06];
      p.faR = [p.faR[0] - act * 1.55 + grbS * 0.35, p.faR[1], p.faR[2]];
      fpHand(
        p,
        'R',
        c0 - act * 0.58 + grbS * 0.9,
        s0 + act * 0.95 - grbS * 0.55,
        palmY + act * 0.58 - grbS * 0.3,
        palmR,
        [wrist[0] + act * 0.12 - grbS * 0.06, -wrist[1], -(wrist[2] - act * 0.1 + grbS * 0.04)]
      );
      /* правая (видимая) чуть отводится назад — противовес */
      p.uaL = [p.uaL[0] - act * 0.05, p.uaL[1], p.uaL[2]];
    } else {
      /* правая: плечо вперёд-вверх, локоть выпрямляется, кисть идёт вперёд вдоль Z;
   на хвате пальцы сжимаются, локоть подтягивается (предмет поднят) */
      p.uaL = [p.uaL[0] + act * 0.42 - 0.08 * grbS, p.uaL[1], p.uaL[2] - act * 0.06];
      p.faL = [p.faL[0] - act * 1.55 + grbS * 0.35, p.faL[1], p.faL[2]];
      fpHand(
        p,
        'L',
        c0 - act * 0.58 + grbS * 0.9,
        s0 + act * 0.95 - grbS * 0.55,
        palmY + act * 0.58 - grbS * 0.3,
        palmR,
        [wrist[0] + act * 0.12 - grbS * 0.06, wrist[1], wrist[2] - act * 0.1 + grbS * 0.04]
      );
      /* левая (видимая) чуть отводится назад — противовес */
      p.uaR = [p.uaR[0] - act * 0.05, p.uaR[1], p.uaR[2]];
    }
  }
  /* ЗАХВАТ ФОНАРЯ: ось трубы = ось кулака = направление взгляда (по FK:
   (0,-0.09,-0.996) в пространстве взгляда), пальцы смыкаются вокруг трубы
   (curl 3.06), большой палец — на торцевой кнопке. Во время вытягивания руки (E)
   захват подмешивается частично — рука тянется, но не «бросает» предмет. */
  if (holdFl) {
    /* захват ломается только на толчке (обе руки); на ПРАВОМ вытягивании (подбор) он
   подмешивается обратно по мере возврата руки — иначе кисть телепортируется в
   стойку. */
    const gK = 1 - clp(act, 0, 1) * (pkAct || isKey ? 1 : isPush ? 0.85 : 0);
    const L3 = (a, b, k) => a + (b - a) * k;
    const HB = [
      'haL',
      'i1L',
      'i2L',
      'i3L',
      'm1L',
      'm2L',
      'm3L',
      'r1L',
      'r2L',
      'r3L',
      'p1L',
      'p2L',
      'p3L',
      't1L',
      't2L'
    ];
    const pre = {};
    for (const k of HB) pre[k] = p[k].slice();
    const preUA = p.uaL.slice(),
      preFA = p.faL.slice();
    p.uaL = [
      0.9432 + mv * 0.05 + runK * 0.02 - crT * 0.1 + sw * 0.1 * mv + ib + swExL - tk * 0.4,
      0.2111 - tk * 0.1,
      0.048 - tk * 0.06
    ];
    p.faL = [
      2.2753 - sw * 0.08 * mv - runK * 0.02 + crT * 0.1 + swExL * 0.6 + tk * 0.45,
      0.0102,
      0.2504 + tk * 0.06
    ];
    fpHand(p, 'L', 3.06, 0.12, -1.3043 + tk * 0.3, 0.1469 - tk * 0.08, [
      -0.0991 + tk * 0.28 + ib * 1.5,
      0,
      0
    ]);
    /* большой палец у кнопки — в том же смешивании (импульс F дожимает кнопку) */
    p.t1L = GRIP_THUMB[0].slice();
    p.t2L = GRIP_THUMB[1].slice();
    if (gK < 0.999) {
      for (const k of HB) {
        const a = pre[k],
          b2 = p[k];
        p[k] = [L3(a[0], b2[0], gK), L3(a[1], b2[1], gK), L3(a[2], b2[2], gK)];
      }
      p.uaL = [L3(preUA[0], p.uaL[0], gK), L3(preUA[1], p.uaL[1], gK), L3(preUA[2], p.uaL[2], gK)];
      p.faL = [L3(preFA[0], p.faL[0], gK), L3(preFA[1], p.faL[1], gK), L3(preFA[2], p.faL[2], gK)];
    }
  }
  /* ЩИПОК: ключ или батарейка между подушечками указательного и большого пальцев
   (PINCH_POSE решён по FK вместе с GRIP_KEY/GRIP_BATT). Включается фильтром
   st._pinchK; на толчке подмешивается частично. */
  if (holdSm) {
    const kF =
      clp(st._pinchK === undefined ? 1 : st._pinchK, 0, 1) *
      (1 - (isPush ? clp(act, 0, 1) * 0.85 : 0));
    /* пальцы сохраняют щипок даже при вытягивании, но РУКА следует за вытягиванием
   (иначе стойка щипка съедает E-анимацию правой руки: вентиль, подбор) */
    const kA = kF * (isKey || pkAct ? 1 - clp(act, 0, 1) : 1);
    if (kF > 0.001) {
      const L3 = (a, b, kk) => a + (b - a) * kk;
      const HB = [
        'haL',
        'i1L',
        'i2L',
        'i3L',
        'm1L',
        'm2L',
        'm3L',
        'r1L',
        'r2L',
        'r3L',
        'p1L',
        'p2L',
        'p3L',
        't1L',
        't2L'
      ];
      const pre = {};
      for (const q of HB) pre[q] = p[q].slice();
      const preUA = p.uaL.slice(),
        preFA = p.faL.slice();
      p.uaL = [
        0.9432 + mv * 0.05 + runK * 0.02 - crT * 0.1 + sw * 0.1 * mv + ib + swExL - tk * 0.4,
        0.2111 - tk * 0.1,
        0.048 - tk * 0.06
      ];
      p.faL = [
        2.2753 - sw * 0.08 * mv - runK * 0.02 + crT * 0.1 + swExL * 0.6 + tk * 0.45,
        0.0102,
        0.2504 + tk * 0.06
      ];
      p.haL = [PINCH_HA[0] + tk * 0.2, PINCH_HA[1] + tk * 0.2, PINCH_HA[2]];
      for (const q of HB.slice(1)) p[q] = PINCH_POSE[q.slice(0, 2)].slice();
      for (const q of HB) {
        const a = pre[q],
          b2 = p[q];
        p[q] = [L3(a[0], b2[0], kF), L3(a[1], b2[1], kF), L3(a[2], b2[2], kF)];
      }
      p.uaL = [L3(preUA[0], p.uaL[0], kA), L3(preUA[1], p.uaL[1], kA), L3(preUA[2], p.uaL[2], kA)];
      p.faL = [L3(preFA[0], p.faL[0], kA), L3(preFA[1], p.faL[1], kA), L3(preFA[2], p.faL[2], kA)];
    }
  }
  /* =============== ПРЕДМЕТ В РУКЕ / КНОПКА / ЗАМЕНА БАТАРЕЙКИ ================
   Приоритет: замена батарейки > нажатие кнопки > базовая стойка с захватом. */
  {
    const flS = st.fl;
    const reloading = !!(flS && flS.rl > 0);
    const selKind = st.inv && st.sel >= 0 && st.inv[st.sel] ? st.inv[st.sel].kind : null;
    const heldKind = reloading ? 'flash' : selKind;
    if (!reloading && heldKind && !holdSm) {
      /* пальцы сжимают предмет: фонарь — полный обхват, мелкие предметы — легче */
      const add = heldKind === 'flash' ? 0.0 : 0.07; /* захват уже закрыт (curl 3.06) */
      for (const f of ['i', 'm', 'r', 'p']) {
        if (p[f + '1L']) p[f + '1L'][0] -= add * 0.36;
        if (p[f + '2L']) p[f + '2L'][0] -= add * 0.44;
        if (p[f + '3L']) p[f + '3L'][0] -= add * 0.3;
      }
      if (p.t1L) p.t1L[0] -= add * 0.25;
    }
    if (reloading) {
      const u = clp((t - (flS.rlT0 || 0)) / RL_DUR, 0, 1);
      const K = rlSample(u);
      p.shL = [0, 0, 0.06];
      p.shR = [0, 0, -0.06];
      p.uaL = K.uaL.slice();
      p.faL = K.faL.slice();
      p.uaR = K.uaR.slice();
      p.faR = K.faR.slice();
      gripHand(p, 'L', K.wrL, K.cuL, K.spL);
      gripHand(p, 'R', K.wrR, K.cuR, K.spR);
      /* КРОССФЕЙД НА ГРАНИЦАХ: ключ u=1 не равен стойке захвата, поэтому на кадре
   окончания замены поза прыгала. Веса ключей 0 при u=0 и u=1, 1 в середине — поза
   непрерывна с захватом ДО и ПОСЛЕ замены; окна батарейки (0.26…0.75) не тронуты. */
      const w = sm(clp(u / 0.1, 0, 1)) * (1 - sm(clp((u - 0.9) / 0.1, 0, 1)));
      if (w < 0.999) {
        const q = {};
        fpHand(q, 'L', 3.06, 0.12, -1.3043 + tk * 0.3, 0.1469 - tk * 0.08, [
          -0.0991 + tk * 0.28 + ib * 1.5,
          0,
          0
        ]);
        q.t1L = GRIP_THUMB[0].slice();
        q.t2L = GRIP_THUMB[1].slice();
        fpHand(q, 'R', 0.95 + runK * 0.25 + tk * 0.1, 0.1 + tk * 1.6, palmY, palmR, [
          wrist[0],
          -wrist[1],
          -wrist[2]
        ]);
        q.shL = [0, 0, 0.06 + tk * 0.1];
        q.shR = [0, 0, -0.06 - tk * 0.1];
        q.uaL = [
          0.9432 + mv * 0.05 + runK * 0.02 - crT * 0.1 + sw * 0.1 * mv + ib + swExL - tk * 0.4,
          0.2111 - tk * 0.1,
          0.048 - tk * 0.06
        ];
        q.faL = [
          2.2753 - sw * 0.08 * mv - runK * 0.02 + crT * 0.1 + swExL * 0.6 + tk * 0.45,
          0.0102,
          0.2504 + tk * 0.06
        ];
        q.uaR = [uaX - sw * 0.1 * mv - ib + swExR, 0.1 + tk * 0.1, -uaZ];
        q.faR = [faX + swExR * 0.6, -0.1, -faZ];
        const LB = (a, b, k) => a + (b - a) * k;
        for (const b of [
          'shL',
          'shR',
          'uaL',
          'faL',
          'uaR',
          'faR',
          'haL',
          'i1L',
          'i2L',
          'i3L',
          'm1L',
          'm2L',
          'm3L',
          'r1L',
          'r2L',
          'r3L',
          'p1L',
          'p2L',
          'p3L',
          't1L',
          't2L',
          'haR',
          'i1R',
          'i2R',
          'i3R',
          'm1R',
          'm2R',
          'm3R',
          'r1R',
          'r2R',
          'r3R',
          'p1R',
          'p2R',
          'p3R',
          't1R',
          't2R'
        ]) {
          if (q[b] && p[b])
            p[b] = [LB(q[b][0], p[b][0], w), LB(q[b][1], p[b][1], w), LB(q[b][2], p[b][2], w)];
        }
      }
    } else if (flS && heldKind === 'flash' && flS.tgT !== undefined && flS.tgT >= 0) {
      /* F — большой палец жмёт торцевую кнопку: тычок предплечьем, кисть клюёт,
   палец продавливает кнопку и отпускает (импульс sin^0.8) */
      const tu = (t - flS.tgT) / TG_DUR;
      if (tu >= 0 && tu <= 1) {
        const pr2 = Math.pow(Math.sin(Math.PI * Math.min(1, tu / 0.9)), 0.8);
        p.uaL = [p.uaL[0] + 0.035 * pr2, p.uaL[1], p.uaL[2]];
        p.faL = [p.faL[0] + 0.06 * pr2, p.faL[1], p.faL[2] - 0.03 * pr2];
        p.haL = [p.haL[0] - 0.1 * pr2, p.haL[1], p.haL[2] + 0.05 * pr2];
        if (p.t1L) p.t1L = [p.t1L[0] - 0.34 * pr2, p.t1L[1], p.t1L[2]];
        if (p.t2L) p.t2L = [p.t2L[0] - 0.44 * pr2, p.t2L[1], p.t2L[2]];
      }
    }
  }
  /* смена предмета (1-4): правая рука уходит ниже кадра со старым предметом и
   поднимается с новым. Провал применяется ПОСЛЕ всех наложений (захваты, кнопка),
   чтобы они не переопределяли опускание. */
  if (st.sw) {
    const dip = Math.sin(Math.PI * clp((t - st.sw.t0) / st.sw.dur, 0, 1));
    if (dip > 0.001) {
      const L3 = (a, b, k) => a + (b - a) * k;
      p.uaL = [L3(p.uaL[0], 0.12, dip), L3(p.uaL[1], 0.1, dip), L3(p.uaL[2], 0.3, dip)];
      p.faL = [L3(p.faL[0], 1.05, dip), L3(p.faL[1], 0.05, dip), L3(p.faL[2], 0.1, dip)];
    }
  }
  return r;
}
/* дешёвый FK цепочки костей (для коллизий рук): возвращает мировые матрицы */
function fkChain(rig, pose, rootM, names) {
  const idx = rig.idx,
    B = rig.B;
  const have = names.filter(n => idx[n] !== undefined);
  const need = {};
  for (const n of have) {
    let i = idx[n];
    while (i !== undefined && i >= 0) {
      need[i] = 1;
      i = B[i].parent;
    }
  }
  for (let i = 0; i < B.length; i++) {
    if (!need[i]) continue;
    const b = B[i],
      rt = (pose && pose[rig.names[i]]) || [0, 0, 0];
    const local = m4mul(
      m4t(b.off[0], b.off[1], b.off[2]),
      m4mul(m4rotY(rt[1]), m4mul(m4rotX(rt[0]), m4rotZ(rt[2])))
    );
    b.m = b.parent < 0 ? m4mul(rootM, local) : m4mul(B[b.parent].m, local);
  }
  const o = {};
  for (const n of have) o[n] = B[idx[n]].m;
  return o;
}

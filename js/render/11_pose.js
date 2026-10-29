/* ==== АНИМАЦИЯ ==== */
/* ==== ПОЗЫ ==== */
const PZERO = {
  root: [0, 0, 0],
  pel: [0, 0, 0],
  spn: [0, 0, 0],
  ch: [0, 0, 0],
  nk: [0, 0, 0],
  hd: [0, 0, 0],
  jaw: [0, 0, 0],
  hr: [0, 0, 0],
  shL: [0, 0, 0],
  uaL: [0, 0, 0],
  faL: [0, 0, 0],
  haL: [0, 0, 0],
  i1L: [0, 0, 0],
  i2L: [0, 0, 0],
  i3L: [0, 0, 0],
  m1L: [0, 0, 0],
  m2L: [0, 0, 0],
  m3L: [0, 0, 0],
  r1L: [0, 0, 0],
  r2L: [0, 0, 0],
  r3L: [0, 0, 0],
  p1L: [0, 0, 0],
  p2L: [0, 0, 0],
  p3L: [0, 0, 0],
  t1L: [0, 0, 0],
  t2L: [0, 0, 0],
  shR: [0, 0, 0],
  uaR: [0, 0, 0],
  faR: [0, 0, 0],
  haR: [0, 0, 0],
  i1R: [0, 0, 0],
  i2R: [0, 0, 0],
  i3R: [0, 0, 0],
  m1R: [0, 0, 0],
  m2R: [0, 0, 0],
  m3R: [0, 0, 0],
  r1R: [0, 0, 0],
  r2R: [0, 0, 0],
  r3R: [0, 0, 0],
  p1R: [0, 0, 0],
  p2R: [0, 0, 0],
  p3R: [0, 0, 0],
  t1R: [0, 0, 0],
  t2R: [0, 0, 0],
  thL: [0, 0, 0],
  snL: [0, 0, 0],
  ftL: [0, 0, 0],
  thR: [0, 0, 0],
  snR: [0, 0, 0],
  ftR: [0, 0, 0]
};
const PKEYS = Object.keys(PZERO);
/* pcl копирует и виртуальные ключи кисти (fg/thb), чтобы клипы, наложенные на
   базовую позу (interact/push), сохраняли её пальцы — иначе кисть раскрывалась
   при подборе, а пальцы прыгали на границе смешивания. */
const VKEYS = ['fgL', 'fgR', 'thbL', 'thbR'];
const pcl = o => {
  const r = {};
  for (const k of PKEYS) {
    const a = o[k] || PZERO[k];
    r[k] = [a[0], a[1], a[2]];
  }
  for (const k of VKEYS) {
    const a = o[k];
    if (a) r[k] = [a[0], a[1], a[2]];
  }
  return r;
};
const sm = k => k * k * (3 - 2 * k);
/* =============== ШАГ: ЧЕСТНАЯ ОПОРА ================
   Ноги — 2-костный IK по траектории стопы:
   · ψ ∈ [0, duty·2π) — опора: точка контакта подошвы СТОИТ (корень проходит
   ровно столько, сколько стопа уходит назад); [duty·2π, 2π) — перенос;
   · вертикаль таза b(ψ) = +B·cos(2ψ) — π-периодична (минимум в середине опоры);
   · у бега duty < 0.5 — фаза полёта, корень идёт баллистически (h = g·Tf²/8);
   · фаза накапливается от ПРОЙДЕННОГО РАССТОЯНИЯ (GAIT_K рад/клетка) — без
   проскальзывания.
   Пространство клипа (до PL_FLIP): вперёд = −Z, «вперёд» бедра = отрицательный
   наклон, sn > 0 = сгиб колена, ft: + = носок вверх.
   ВАЖНО: имена L/R зеркальны для зрителя — кость 'L' видна СПРАВА. */
const HIPJ = PL_HIP - 0.055; /* тазобедренный сустав над корнем */
const SOLE_CAND = PL_SOLE_PTS.map(q => [q[2], q[1]]);
const SOLE_SX = [-0.053, 0.0, 0.053]; /* боковое отнесение — то же, что в footLowest */
/* Контакт подошвы: hA — высота лодыжки над полом, zrel — продольное смещение
   контакта (в системе zf «вперёд» = −Z). Модель стопы ПОЛНАЯ: точки
   поворачиваются тем же rotM3(phi,yaw,roll), что и риг, минимум по тем же 9×3
   позициям, что и footLowest — иначе IK целится в «плоскую» стопу.
   hA — ТОЧНЫЙ минимум (иначе стопа висит), zrel — softmin (иначе дёргается на
   перекате с пятки на носок). */
function soleContactGen(phi, roll, yaw, SX, PTS, EPS) {
  const R = rotM3(phi, yaw || 0, roll || 0); /* rotY(yaw)·rotX(phi)·rotZ(roll) — как в риге */
  const r3 = R[3],
    r4 = R[4],
    r5 = R[5],
    r6 = R[6],
    r7 = R[7],
    r8 = R[8];
  let ymin = 1e9;
  const ys = [],
    zr = [];
  for (let si = 0; si < SX.length; si++) {
    const sx = SX[si];
    for (let qi = 0; qi < PTS.length; qi++) {
      const q = PTS[qi];
      const y = r3 * sx + r4 * q[1] + r5 * q[0]; /* высота точки над лодыжкой */
      ys.push(y);
      zr.push(r6 * sx + r7 * q[1] + r8 * q[0]);
      if (y < ymin) ymin = y;
    }
  }
  let sw2 = 0;
  const ws = [];
  for (let i = 0; i < ys.length; i++) {
    const w = Math.exp(-(ys[i] - ymin) / EPS);
    ws.push(w);
    sw2 += w;
  }
  let hz = 0;
  for (let i = 0; i < ys.length; i++) hz += (ws[i] / sw2) * zr[i];
  return { hA: -ymin, zrel: hz };
}
function soleContact(phi, roll, yaw) {
  return soleContactGen(phi, roll, yaw, SOLE_SX, SOLE_CAND, 0.01);
}
/* 2-костный IK ноги (в сагиттальной плоскости). zf — стопа ВПЕРЕДИ сустава (+),
   yd — глубина ниже сустава (+), toeOff — абсолютный наклон стопы (+ = носок
   вверх). Возвращает АБСОЛЮТНЫЕ углы [бедро, колено, footAbs]; локальные = минус
   наклон таза. */
function legIKGen(zf, yd, L1, L2, dmax, dmin) {
  let d = Math.hypot(zf, yd),
    clamped = false;
  if (d > dmax) {
    const k = dmax / d;
    zf *= k;
    yd *= k;
    d = dmax;
    clamped = true;
  } else if (d < dmin) {
    const k = dmin / Math.max(d, 1e-6);
    zf *= k;
    yd *= k;
    d = dmin;
    clamped = true;
  }
  const gam = Math.atan2(zf, yd);
  const beta = Math.acos(clp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const a1 = -(gam + beta);
  const sn = Math.PI - Math.acos(clp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  return [a1, sn, clamped, d];
}
function legIK(zf, yd, toeOff) {
  const r = legIKGen(
    zf,
    yd,
    PL_THLEN,
    PL_SNLEN,
    PL_THLEN + PL_SNLEN - 0.008,
    Math.abs(PL_THLEN - PL_SNLEN) + 0.035
  );
  return [r[0], r[1], toeOff];
}
/* план стопы в пересчёте на локальную фазу ψ∈[0,2π): ψ=0 — постановка.
   sg = ±1 — сторона: знак крена стопы (kneeOut) и рыскания (toeOut). */
function footPlan(psi, G, sg) {
  if (sg === undefined) sg = 1;
  const TAU = Math.PI * 2,
    arc = G.duty * TAU;
  const C = HIPJ - G.hipBase; /* «просадка» таза у этого шага */
  /* π-периодичное покачивание таза: таз — «перевёрнутый маятник» — ниже всего в
   СЕРЕДИНЕ опоры (нога вертикальна), выше всего в двойной опоре (ψ=0 и ψ=π).
   Отсюда знак +B·cos(2ψ): противофаза дала бы «прыгающую» походку. */
  const b = G.bob * Math.cos(2 * psi);
  let zfC, phi, clearance, u;
  if (psi < arc) {
    u = psi / arc;
    zfC = G.S * (0.5 - u); /* контакт уходит назад ЛИНЕЙНО = стоит на месте */
    if (u < G.hsEnd) phi = G.hs * (1 - u / G.hsEnd); /* пятка: носок чуть поднят */
    else if (u < 0.62) phi = 0; /* плоская опора, перекат */
    else phi = -G.po * sm((u - 0.62) / 0.38); /* отталкивание носком */
    clearance = 0;
  } else {
    u = (psi - arc) / (TAU - arc);
    const e = u * u * (3 - 2 * u);
    zfC = -G.S * 0.5 + G.S * (0.22 * u + 0.78 * e); /* мах вперёд, опережающий постановку */
    if (u < 0.25) phi = -G.po + (G.po + G.hs * 0.85) * sm(u / 0.25);
    else if (u < 0.7) phi = G.hs * 0.85;
    else phi = G.hs * 0.85 + (G.hs - G.hs * 0.85) * sm((u - 0.7) / 0.3);
    clearance = G.lift * Math.sin(Math.PI * Math.pow(u, 0.8));
  }
  const c = soleContact(phi, G.kneeOut * sg, G.toeOut * sg);
  const soleRoot = C + b + clearance;
  /* Цель IK лодыжки: zfC (продольная) + zrel(φ) — куда ложится пятно контакта при
   этом наклоне. «Нулевая» компенсация zrel здесь НЕ нужна: замер показал, что она
   тянет лодыжку и увеличивает проскальзывание (−5 см → −10 см). */
  return { zf: zfC + c.zrel, zfC: zfC, phi: phi, stance: psi < arc, soleRoot: soleRoot, u: u };
}
/* Параметры шага. S — ход контакта относительно таза ЗА ОДНУ ОПОРУ (в единицах
   рига), duty — доля опоры в цикле, hipBase — высота таза.
   (а) «ОПОРА СТОИТ»: за опору корень проходит duty·2π/K клеток, стопа проходит
   S·PL_SCALE ⇒ K = duty·2π/(S·PL_SCALE) [рад/клетка]; отсюда
   f = V·duty/(S·RM), stride = S·RM/(2·duty), RM = PL_SCALE·CELL_M. Мировой
   масштаб, рост и каденс связаны. Подбирайте S: S ≈ ход корня за опору, иначе
   стопа ползёт.
   (б) Анатомия: колено в середине опоры сгибается на 2·asin((S/2)/(L1+L2)) —
   ВЕРХНЯЯ граница для S.
   Ориентиры: шаг 7 км/ч — 135–145/мин, длина шага 0.80–0.87 м, колено 35–45°;
   бег 20 км/ч — 240–320/мин; крадучись — 80–110/мин. */
const GAIT = {
  walk: {
    S: 0.854,
    duty: 0.52,
    hipBase: 0.88,
    bob: 0.03,
    hs: 0.07,
    hsEnd: 0.2,
    po: 0.26,
    lift: 0.1,
    kneeOut: 0.035,
    toeOut: 0.05,
    lean: 0.06,
    leanOsc: 0.015,
    pelRoll: 0.045,
    pelYaw: 0.1,
    chestBob: 0.022,
    armX: 0.42,
    armBack: 0.05,
    armZ: 0.13,
    elbowFix: 0.42,
    armBend: 0.34,
    curl: 0.32,
    headBob: 0.02,
    flightH: 0
  },
  run: {
    S: 0.821,
    duty: 0.35,
    hipBase: 0.85,
    bob: 0.04,
    hs: 0.04,
    hsEnd: 0.14,
    po: 0.45,
    lift: 0.25,
    kneeOut: 0.05,
    toeOut: 0.03,
    lean: 0.3,
    leanOsc: 0.03,
    pelRoll: 0.05,
    pelYaw: 0.13,
    chestBob: 0.03,
    armX: 0.78,
    armBack: 0.1,
    armZ: 0.2,
    elbowFix: 0.95,
    armBend: 0.5,
    curl: 0.55,
    headBob: 0.03,
    flightH: 0.063
  } /* подскок следует из непрерывности ВЕРТИКАЛЬНОЙ СКОРОСТИ на отрыве:
   v = 2·B·ω·|sin(2·arc)| ≈ 1.0 м/с, h = v²/(2g) = 5.1 см. Было 0.021 при duty
   0.18; при неверной H таз «щёлкает» на отрыве. */,
  sneak: {
    S: 0.52,
    duty: 0.7,
    hipBase: 0.6,
    bob: 0.018,
    hs: 0.02,
    hsEnd: 0.18,
    po: 0.16,
    lift: 0.07,
    kneeOut: 0.13,
    toeOut: 0.13,
    lean: 0.18,
    leanOsc: 0.01,
    pelRoll: 0.035,
    pelYaw: 0.07,
    chestBob: 0.014,
    armX: 0.16,
    armBack: 0.3,
    armZ: 0.24,
    elbowFix: 0.62,
    armBend: 0.18,
    curl: 0.4,
    headBob: 0.012,
    flightH: 0
  }
};
/* PL_SCALE объявлен ниже, у вьюмодели, но gaitK он нужен уже здесь — поэтому
   значение продублировано отдельной константой (менять обе вместе). */
const PL_SCALE_GAIT = 0.345;
/* GAIT_K вычисляется из геометрии шага, поэтому остаётся верным при изменении S,
   duty, PL_SCALE или CELL_M (через RM в GAIT_RATE). */
/* K = duty·2π/(S·PL_SCALE) [рад/клетка] — вывод в условии (а) выше.
   Отсюда f = V·duty/(S·RM) и stride = S·RM/(2·duty), RM = PL_SCALE·CELL_M. */
function gaitK(G) {
  return (G.duty * 2 * Math.PI) / (G.S * PL_SCALE_GAIT);
}
const GAIT_K = { walk: gaitK(GAIT.walk), run: gaitK(GAIT.run), sneak: gaitK(GAIT.sneak) };
/* GAIT_RATE — та же фаза, но в рад/с: нужна клипам и манекену, где фаза берётся
   из времени, а не из расстояния. Берётся на номинальной скорости шага. */
const GAIT_NOM = { walk: 7, sneak: 2, run: 20 }; /* км/ч */
function gaitRate(kmh, G) {
  return (kmh / 3.6 / CELL_M) * gaitK(G);
}
const GAIT_RATE = {
  walk: gaitRate(GAIT_NOM.walk, GAIT.walk),
  run: gaitRate(GAIT_NOM.run, GAIT.run),
  sneak: gaitRate(GAIT_NOM.sneak, GAIT.sneak)
};
/* поза шага + dy корня. Верх тела — процедурная биомеханика: противофаза рук и
   ног, контрротация таза и груди, стабилизация головы, перенос веса. */
function gaitPoseIK(p, ph, G) {
  const TAU = Math.PI * 2;
  const psiL = ((ph % TAU) + TAU) % TAU;
  const psiR = (((ph + Math.PI) % TAU) + TAU) % TAU;
  const arc = G.duty * TAU;
  /* кость 'L' находится СПРАВА у зрителя: её kneeOut/toeOut положительные,
   у 'R' — отрицательные */
  const fL = footPlan(psiL, G, 1),
    fR = footPlan(psiR, G, -1);
  const swEnv = fp => (fp.stance ? 0 : Math.sin(Math.PI * fp.u));
  const eL = swEnv(fL),
    eR = swEnv(fR);
  /* таз — ДО ног (цели IK в системе корня) */
  const rollA = G.pelRoll * (eR - eL);
  const yawA = G.pelYaw * Math.cos(psiL);
  const pitA = G.lean + G.leanOsc * Math.sin(psiL * 2 + 0.6);
  p.pel = [pitA, yawA, rollA];
  const Rp = rotM3(pitA, yawA, rollA);
  const hipY = sg => PL_HIP + Rp[1] * (0.086 * sg) + Rp[4] * -0.055;
  const hipZs = sg => Rp[2] * (0.086 * sg) + Rp[5] * -0.055;
  const solveLeg = (f, sg) => {
    /* Полный поворот стопы = наклон таза (rollA/yawA) + колено (kneeOut) + стопа
   (toeOut); таз даёт до 0.045 рад крена и 0.10 рад рыскания — модель контакта
   обязана это учитывать, иначе расходится с footLowest и опорная нога висит. */
    const roll = G.kneeOut * sg + rollA,
      yaw = G.toeOut * sg + yawA;
    const zfRel = f.zf - -hipZs(sg);
    /* РЕШЕНИЕ В ДВА ПРОХОДА: hA зависит от наклона стопы, наклон зажимается упором,
   упор зависит от решения IK, которое зависит от hA. Один проход даёт «щёлк» таза
   на границе опора→полёт; второй сходится (<1e-6 рад). */
    let phi = f.phi,
      a = null,
      shinAbs = 0,
      phi2 = f.phi;
    for (let it = 0; it < 2; it++) {
      const c = soleContact(phi, roll, yaw);
      const ankleY = f.soleRoot + c.hA;
      a = legIK(zfRel, hipY(sg) - ankleY, phi);
      /* упор лодыжки: относительно голени стопа живёт в [−54° подошвенного … +31°
   тыльного сгибания]. В глубоких позах «плоская» стопа вышла бы за предел —
   пятка честно поднимается. */
      shinAbs = a[0] + a[1];
      phi2 = clp(f.phi, shinAbs - 0.95, shinAbs + 0.55);
      if (Math.abs(phi2 - phi) < 1e-6) break;
      phi = phi2;
    }
    return [a[0] - pitA, a[1], phi2 - shinAbs];
  };
  const ikL = solveLeg(fL, 1),
    ikR = solveLeg(fR, -1);
  p.thL = [ikL[0], 0, G.kneeOut];
  p.snL = [ikL[1], 0, 0];
  p.ftL = [ikL[2], G.toeOut, 0];
  p.thR = [ikR[0], 0, -G.kneeOut];
  p.snR = [ikR[1], 0, 0];
  p.ftR = [ikR[2], -G.toeOut, 0];
  /* позвоночник: контрротация против таза, вертикальное покачивание груди 2ψ */
  p.spn = [G.lean * 0.55 - G.bob * 0.35 * Math.sin(psiL * 2), -yawA * 1.5, -rollA * 0.55];
  p.ch = [
    G.lean * 0.5 + G.chestBob * Math.sin(psiL * 2 + Math.PI * 0.5),
    -yawA * 1.1,
    -rollA * 0.85 + G.chestBob * Math.sin(psiL * 2) * 0.3
  ];
  /* руки — в противофазе к своим ногам; локоть доводится на махе вперёд */
  const swL = Math.sin(psiL),
    swR = Math.sin(psiR);
  const armF = sw => [sw * G.armX - G.armBack, -(G.elbowFix + G.armBend * Math.max(0, -sw))];
  const aL = armF(swL),
    aR = armF(swR);
  p.uaL = [aL[0], 0, G.armZ];
  p.faL = [aL[1], 0, 0.05];
  p.uaR = [aR[0], 0, -G.armZ];
  p.faR = [aR[1], 0, -0.05];
  p.shL = [-0.03 * Math.max(0, -swL), 0, 0.03 + 0.02 * Math.max(0, -swL)];
  p.shR = [-0.03 * Math.max(0, -swR), 0, -0.03 - 0.02 * Math.max(0, -swR)];
  p.haL = [-0.08 + 0.1 * Math.sin(psiL - 0.9), 0, 0];
  p.haR = [-0.08 + 0.1 * Math.sin(psiR - 0.9), 0, 0];
  /* пальцы: fg>0 = сгиб (см. expandHands); кисть чуть расслабляется на махе руки */
  p.fgL = [G.curl + 0.12 * Math.max(0, -swL), 0, 0.06 * Math.max(0, -swL)];
  p.fgR = [G.curl + 0.12 * Math.max(0, -swR), 0, 0.06 * Math.max(0, -swR)];
  p.thbL = [0, 0, 0.3];
  p.thbR = [0, 0, -0.3];
  /* голова стабилизирует взгляд против наклона и поворота торса */
  p.nk = [-G.lean * 0.45 + 0.02 * Math.sin(psiL * 2 + 2.0), -yawA * 0.5, rollA * 0.5];
  p.hd = [
    -G.lean * 0.35 + G.headBob * Math.sin(psiL * 2 + 1.2),
    -yawA * 0.35 + 0.02 * swL,
    rollA * 0.3
  ];
  p.jaw = [0, 0, 0];
  p.hr = [0, 0, 0];
  /* dy: опора — footLowest; полёт — баллистика (границы окна непрерывны:
   clearance(0)=clearance(1)=0, b π-периодичен) */
  let flight = 0,
    ftau = 0;
  if (G.duty < 0.5) {
    if (psiL >= arc && psiL < Math.PI) {
      flight = 1;
      ftau = (psiL - arc) / (Math.PI - arc);
    } else if (psiL >= arc + Math.PI) {
      flight = 1;
      ftau = (psiL - arc - Math.PI) / (Math.PI - arc);
    }
  }
  let dy = groundDY(p);
  if (flight) {
    const dyBase = -(
      HIPJ -
      G.hipBase +
      G.bob * Math.cos(2 * psiL)
    ); /* тот же знак покачивания, что в footPlan — иначе таз щёлкает на стыке опора→полёт */
    dy = dyBase + G.flightH * 4 * ftau * (1 - ftau);
  }
  return { pose: p, dy: dy };
}

/* E в приседании играется НА КОРТОЧКАХ: таз, позвоночник, голова и ноги
   подмешиваются из клипа 'crouch' по коэффициенту приседа (A.cr), вытягивание
   руки — из клипа действия. dy пересчитывается от итоговой позы: стопы стоят
   на полу. */
function crouchify(p, A, t) {
  if (A && A.fp) return; /* вьюмодель не наследует присед торса — руки не «отваливаются» */
  const crk = A && A.cr !== undefined ? A.cr : 0;
  if (crk <= 0.001) return;
  const k = sm(clp((crk - 0.3) / 0.3, 0, 1));
  if (k <= 0.001) return;
  const cp = ANIM_CLIPS[animIndex('crouch')].fn(t).pose;
  for (const key of ['pel', 'spn', 'ch', 'nk', 'hd', 'thL', 'thR', 'snL', 'snR', 'ftL', 'ftR']) {
    const a = p[key],
      b = cp[key];
    if (a && b) {
      a[0] += (b[0] - a[0]) * k;
      a[1] += (b[1] - a[1]) * k;
      a[2] += (b[2] - a[2]) * k;
    }
  }
}
/* Клипы: fn(t,A) -> {pose,dy}. len<0 — зацикленный клип (t не заворачивается).
   Кость 'L' СПРАВА у зрителя — «рабочая» правая рука это *L. */
const ANIM_CLIPS = [
  {
    name: 'idle',
    label: 'Покой',
    len: -1,
    fn(t, A) {
      /* осмотр гаснет с началом движения (A.mv) — голова не дёргается в первый шаг */
      const lk = 1 - clp((A && A.mv) || 0, 0, 1);
      /* ЖИВОЙ ПРОСТОЙ: дыхание на двух частотах, перенос веса между стопами,
   микросакады, редкое глотание, отстающие локти и волосы. Частоты несоизмеримы —
   поза никогда не повторяется заметно, но и не дрожит. */
      const br = Math.sin(t * 1.35),
        br2 = Math.sin(t * 0.61 + 0.7),
        sh = Math.sin(t * 0.43);
      const wf = Math.sin(t * 0.37),
        wf2 = Math.sin(t * 0.23 + 1.3);
      const sx =
        Math.sin(t * 0.53) * 0.55 +
        Math.sin(t * 1.31 + 2.1) * 0.3 +
        Math.sin(t * 2.77 + 0.6) * 0.12;
      const sy = Math.sin(t * 0.47 + 1.7) * 0.4 + Math.sin(t * 1.13) * 0.25;
      const swal = Math.pow(Math.max(0, Math.sin(t * 0.31)), 24);
      const wL = Math.max(0, wf),
        wR = Math.max(0, -wf);
      const p = pcl(PZERO);
      p.pel = [-0.02 + br * 0.01, 0.045 * wf2, 0.03 * wf];
      p.spn = [-0.016 + br2 * 0.01, -0.03 * wf2, -0.018 * wf];
      p.ch = [-0.01 + br * 0.018, -0.022 * wf2, -0.026 * wf + br2 * 0.008];
      p.nk = [br2 * 0.04 + sy * 0.1 * lk, sh * 0.06 + sx * 0.14 * lk, -br2 * 0.02];
      p.hd = [
        br * 0.026 + 0.02 + sy * 0.16 * lk,
        sh * 0.1 * lk + sx * 0.24 * lk,
        br2 * 0.03 - sx * 0.04 * lk
      ];
      p.jaw = [-0.012 - 0.05 * swal - Math.max(0, Math.sin(t * 0.7)) * 0.01, 0, 0];
      p.hr = [br * 0.02 + wf * 0.01, -sh * 0.03, 0];
      p.shL = [0.01 * br, 0, 0.02 + 0.015 * br + 0.01 * wf];
      p.shR = [0.01 * br, 0, -0.02 - 0.015 * br - 0.01 * wf];
      p.uaL = [-0.055 + br * 0.016 + 0.03 * sh, 0, 0.15 + 0.012 * wf];
      p.uaR = [-0.05 - br * 0.016 - 0.03 * sh, 0, -0.15 + 0.012 * wf];
      p.faL = [-0.3 - br * 0.05 - 0.04 * Math.sin(t * 0.9 - 0.6), 0, 0.07];
      p.faR = [-0.28 + br * 0.05 - 0.04 * Math.sin(t * 0.9 - 0.9), 0, -0.07];
      p.haL = [-0.1 + 0.05 * Math.sin(t * 0.8 - 1.2), 0, 0];
      p.haR = [-0.1 + 0.05 * Math.sin(t * 0.8 - 1.5), 0, 0];
      p.fgL = [0.28 + br * 0.05, 0, 0];
      p.fgR = [0.28 - br * 0.05, 0, 0];
      p.thbL = [0, 0, 0.24];
      p.thbR = [0, 0, -0.24];
      /* ноги: вес на одной стопе — опорная выпрямляется, свободная расслабляется, таз
   наклоняется в сторону опоры (контрапост) */
      p.thL = [-0.045 + sh * 0.03 - 0.035 * wL + 0.02 * wR, 0, 0.032];
      p.thR = [0.052 - sh * 0.03 - 0.035 * wR + 0.02 * wL, 0, 0.032];
      p.snL = [0.085 - sh * 0.02 - 0.035 * wL + 0.06 * wR, 0, 0];
      p.snR = [0.055 + sh * 0.02 - 0.035 * wR + 0.06 * wL, 0, 0];
      p.ftL = [-0.05 + 0.01 * wL + 0.045 * wR, 0, 0];
      p.ftR = [-0.05 + 0.01 * wR + 0.045 * wL, 0, 0];
      return { pose: p, dy: groundDY(p) };
    }
  },
  {
    name: 'walk',
    label: 'Шаг',
    len: -1,
    fn(t, A) {
      const ph = A && A.ph !== undefined ? A.ph : t * GAIT_RATE.walk;
      const r = gaitPoseIK(pcl(PZERO), ph, GAIT.walk);
      const p = r.pose;
      const psi = ((ph % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      p.nk = [p.nk[0] + 0.012, p.nk[1], p.nk[2]];
      p.hd = [p.hd[0] + 0.03 + Math.sin(psi * 2) * 0.012, p.hd[1] + Math.sin(psi) * 0.03, p.hd[2]];
      p.jaw = [-0.014, 0, 0];
      p.hr = [Math.sin(psi - 0.8) * 0.025, 0, 0];
      return r;
    }
  },
  {
    name: 'run',
    label: 'Бег',
    len: -1,
    fn(t, A) {
      const ph = A && A.ph !== undefined ? A.ph : t * GAIT_RATE.run;
      const r = gaitPoseIK(pcl(PZERO), ph, GAIT.run);
      const p = r.pose;
      const psi = ((ph % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      /* взгляд поверх наклона, дыхание ртом в ритме шага, волосы откинуты назад */
      p.nk = [p.nk[0] - 0.06, p.nk[1], p.nk[2]];
      p.hd = [p.hd[0] + 0.14 + Math.sin(psi * 2) * 0.02, p.hd[1] + Math.sin(psi) * 0.05, p.hd[2]];
      p.jaw = [-0.1 - Math.max(0, Math.sin(psi * 2)) * 0.1, 0, 0];
      p.hr = [0.05 + 0.04 * Math.sin(psi + 2.2), 0, 0];
      return r;
    }
  },
  {
    name: 'sneak',
    label: 'Крадущийся шаг',
    len: -1,
    fn(t, A) {
      const ph = A && A.ph !== undefined ? A.ph : t * GAIT_RATE.sneak;
      const r = gaitPoseIK(pcl(PZERO), ph, GAIT.sneak);
      const p = r.pose;
      /* голова поднята (трек поверх наклона), медленное настороженное сканирование */
      p.nk = [p.nk[0] + 0.05, p.nk[1], p.nk[2]];
      p.hd = [
        p.hd[0] + 0.06 + Math.sin(t * 0.9) * 0.02,
        p.hd[1] + Math.sin(t * 0.7) * 0.06,
        p.hd[2]
      ];
      p.jaw = [-0.02, 0, 0];
      p.hr = [0.03, 0, 0];
      return r;
    }
  },
  {
    name: 'crouch',
    label: 'Присед',
    len: -1,
    fn(t) {
      /* ГЛУБОКОЕ УДЕРЖАНИЕ НА КОРТОЧКАХ (переключатель C): ягодицы у пяток, колени
   врозь, стопы плоско, предплечья на бёдрах. Ноги — честный IK (бедро ~95°,
   колено ~135°, лодыжка сильно в тыльном сгибании). */
      const br = Math.sin(t * 1.15),
        br2 = Math.sin(t * 0.83 + 2.0);
      const sw = Math.sin(t * 0.31),
        sw2 = Math.sin(t * 0.19 + 0.8);
      const sx = Math.sin(t * 0.41) * 0.4 + Math.sin(t * 0.97 + 1.3) * 0.2;
      const sy = Math.sin(t * 0.33 + 0.5) * 0.3;
      const p = pcl(PZERO);
      const pelP = 0.34 + 0.015 * br,
        pelY = 0.03 * sw2,
        pelR = 0.02 * sw;
      p.pel = [pelP, pelY, pelR];
      p.spn = [0.1 + 0.012 * br, -pelY * 0.5, -pelR * 0.5];
      p.ch = [0.16 + 0.02 * br + 0.008 * br2, -pelY * 0.8, -pelR * 0.7];
      p.nk = [-0.24 - 0.012 * br + sy * 0.06, sx * 0.12 - pelY * 0.3, -pelR * 0.4];
      p.hd = [-0.18 - 0.01 * br + sy * 0.1, sx * 0.18, 0.02 * sw];
      p.jaw = [-0.02 - Math.max(0, Math.sin(t * 0.55)) * 0.012, 0, 0];
      p.hr = [0.02 * br, 0, 0];
      /* руки: предплечья на бёдрах, кисти висят расслабленно */
      p.shL = [0.05, 0, 0.03];
      p.shR = [0.05, 0, -0.03];
      p.uaL = [-0.52 + 0.02 * br, 0, 0.16];
      p.uaR = [-0.52 - 0.02 * br, 0, -0.16];
      p.faL = [-0.92 - 0.03 * br2, 0, 0.05];
      p.faR = [-0.92 + 0.03 * br2, 0, -0.05];
      p.haL = [-0.16 + 0.04 * br, 0, 0];
      p.haR = [-0.16 - 0.04 * br, 0, 0];
      p.fgL = [0.4 + 0.05 * br, 0, 0];
      p.fgR = [0.4 - 0.05 * br, 0, 0];
      p.thbL = [0, 0, 0.3];
      p.thbR = [0, 0, -0.3];
      /* ноги: IK глубокого приседа (таз в 0.36 над полом, лодыжка вперёд) */
      const Rp = rotM3(pelP, pelY, pelR);
      const ankleY = HIPJ - 0.36 + 0.116 + 0.004 * br;
      for (const sg of [1, -1]) {
        const hy = PL_HIP + Rp[1] * (0.086 * sg) + Rp[4] * -0.055;
        const hz = Rp[2] * (0.086 * sg) + Rp[5] * -0.055;
        const a = legIK(0.19 - -hz, hy - ankleY, 0);
        const th = a[0] - pelP,
          sn = a[1],
          ft = 0 - a[0] - a[1];
        if (sg > 0) {
          p.thL = [th, 0, 0.24];
          p.snL = [sn, 0, 0];
          p.ftL = [ft, 0.2, 0];
        } else {
          p.thR = [th, 0, -0.24];
          p.snR = [sn, 0, 0];
          p.ftR = [ft, -0.2, 0];
        }
      }
      return { pose: p, dy: groundDY(p) };
    }
  },
  {
    name: 'interact',
    label: 'Взять предмет',
    len: 0.75,
    fn(t, A) {
      /* Бытовое действие на 0.75 с: короткий замах → ПРАВАЯ рука (кости *L) тянется
   ВПЕРЕД вдоль Z → пальцы хватают → возврат. Торс доклоняется вслед, голова
   сопровождает руку, левая рука уравновешивает. */
      const c = clp(t / 0.75, 0, 1);
      const wind = sm(clp(c / 0.1, 0, 1)) * (1 - sm(clp((c - 0.1) / 0.14, 0, 1)));
      const reach = sm(clp((c - 0.06) / 0.3, 0, 1));
      const grab = sm(clp((c - 0.4) / 0.13, 0, 1));
      const back = sm(clp((c - 0.58) / 0.42, 0, 1));
      const ext = reach * (1 - back),
        gr = grab * (1 - back * 0.9);
      const p = pcl(ANIM_CLIPS[0].fn(t).pose);
      crouchify(
        p,
        A,
        t
      ); /* присед подмешивается ДО дельт действия: наклон торса читается даже на корточках */
      p.uaL = [-0.055 + 0.12 * wind - 0.8 * ext + 0.18 * gr, 0, 0.15 - 0.05 * ext];
      p.faL = [-0.3 - 0.3 * wind + 0.2 * ext - 0.16 * gr, 0, 0.07];
      p.haL = [-0.1 + 0.1 * wind + 0.18 * ext - 0.3 * gr, 0, 0];
      /* кисть: раскрывается к предмету (пальцы врозь), сжимается в момент касания
   (большой палец в оппозиции), уносит добычу */
      const open = ext * (1 - grab);
      p.fgL = [0.3 - 0.26 * open + 1.02 * gr * (1 - back * 0.55) - 0.0, 0, 0.42 * open - 0.3 * gr];
      p.thbL = [0, 0, 0.24 + 0.1 * open + 0.42 * gr];
      p.shL = [-0.04 * ext, 0, 0.02 - 0.05 * ext];
      p.spn = [p.spn[0] + 0.05 * ext - 0.03 * gr, p.spn[1] + 0.03 * ext, p.spn[2]];
      p.ch = [p.ch[0] + 0.1 * ext - 0.05 * gr, p.ch[1] - 0.05 * ext, p.ch[2]];
      p.nk = [p.nk[0] - 0.1 * ext + 0.06 * gr, p.nk[1], 0];
      p.hd = [p.hd[0] - 0.16 * ext + 0.1 * gr, p.hd[1] - 0.04 * ext, 0];
      p.pel = [p.pel[0] + 0.04 * ext, p.pel[1], p.pel[2]];
      p.uaR = [p.uaR[0] + 0.07 * ext, 0, p.uaR[2]];
      p.faR = [p.faR[0] - 0.05 * ext, 0, p.faR[2]];
      return { pose: p, dy: groundDY(p) };
    }
  },
  {
    name: 'push',
    label: 'Толкнуть дверь',
    len: 0.9,
    fn(t, A) {
      /* Толчок двери обеими ладонями, 0.9 с: стойка → ладони к груди → руки
   выпрямляются с наклоном торса → короткий тремор усилия → возврат. Стопы стоят
   на месте. */
      const c = clp(t / 0.9, 0, 1);
      const wind = sm(clp(c / 0.16, 0, 1)) * (1 - sm(clp((c - 0.16) / 0.16, 0, 1)));
      const thrust = sm(clp((c - 0.14) / 0.22, 0, 1));
      const settle = sm(clp((c - 0.5) / 0.5, 0, 1));
      const E = thrust * (1 - settle);
      const shake =
        Math.sin(c * 26) *
        0.007 *
        sm(clp((c - 0.34) / 0.06, 0, 1)) *
        (1 -
          sm(
            clp((c - 0.46) / 0.16, 0, 1)
          )); /* втрое тише и втрое реже — без тряски тела и камеры */
      const p = pcl(ANIM_CLIPS[0].fn(t).pose);
      crouchify(p, A, t); /* присед ДО дельт толчка */
      /* ноги: вес вперёд, колени мягче, пятки приподняты — шага нет (корень не едет) */
      p.thL = [p.thL[0] - 0.14 * E, p.thL[1], p.thL[2]];
      p.thR = [p.thR[0] - 0.14 * E, p.thR[1], p.thR[2]];
      p.snL = [p.snL[0] + 0.06 * E, 0, 0];
      p.snR = [p.snR[0] + 0.06 * E, 0, 0];
      p.ftL = [p.ftL[0] - 0.3 * E, p.ftL[1], 0];
      p.ftR = [p.ftR[0] - 0.3 * E, p.ftR[1], 0];
      p.pel = [p.pel[0] + 0.16 * E - 0.05 * wind + shake * 0.15, p.pel[1], p.pel[2]];
      p.spn = [p.spn[0] + 0.12 * E - 0.06 * wind + shake * 0.25, p.spn[1], p.spn[2]];
      p.ch = [p.ch[0] + 0.22 * E - 0.08 * wind + shake * 0.45, p.ch[1], p.ch[2]];
      p.nk = [p.nk[0] - 0.1 * E + 0.04 * wind, p.nk[1], 0];
      p.hd = [p.hd[0] - 0.14 * E + 0.06 * wind, p.hd[1], 0];
      p.shL = [-0.05 * E, 0, p.shL[2] + 0.04 * E];
      p.shR = [-0.05 * E, 0, p.shR[2] - 0.04 * E];
      p.uaL = [-0.055 + 0.28 * wind - 1.02 * E, 0, 0.15 - 0.13 * E];
      p.uaR = [-0.05 + 0.28 * wind - 1.02 * E, 0, -0.15 + 0.13 * E];
      p.faL = [-0.3 - 0.85 * wind + 0.3 * E, 0, 0.07 - 0.09 * E];
      p.faR = [-0.28 - 0.85 * wind + 0.3 * E, 0, -0.07 + 0.09 * E];
      p.haL = [-0.1 + 0.22 * E, 0, 0];
      p.haR = [-0.1 + 0.22 * E, 0, 0];
      /* ладони: пальцы расставлены и открыты к двери, напряжены на пике усилия */
      p.fgL = [0.3 - 0.28 * E - 0.06 * wind + 0.55 * Math.abs(shake), 0, 0.3 * E];
      p.fgR = [0.3 - 0.28 * E - 0.06 * wind + 0.55 * Math.abs(shake), 0, 0.3 * E];
      p.thbL = [0, 0, 0.24 + 0.16 * E];
      p.thbR = [0, 0, -0.24 - 0.16 * E];
      return { pose: p, dy: groundDY(p) };
    }
  }
];
/* =============== РАЗВОРОТ КИСТИ ================
   Клипы пишут «старые» ключи fgL/fgR (сгиб) и thbL/thbR (отведение); здесь они
   разворачиваются в настоящие пальцы. Плюс базовый поворот ладони. */
function expandHands(p, sg) {
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? 1 : -1;
    const fg = p['fg' + S] || [0, 0, 0],
      thb = p['thb' + S] || [0, 0, 0],
      ha = p['ha' + S] || [0, 0, 0];
    const curl = Math.max(-0.2, fg[0]); /* >0 — сгиб */
    const sprd = fg[2] || 0;
    /* ладонь: базовый поворот внутрь + дельты клипа */
    p['ha' + S] = [ha[0], -s * 1.18 + ha[1], ha[2] - s * 0.1];
    const F = { i: 0.92, m: 1.0, r: 0.94, p: 0.8 };
    const ph = { i: 0.0, m: 0.35, r: 0.7, p: 1.05 };
    for (const f of ['i', 'm', 'r', 'p']) {
      const c = curl * F[f],
        sp = sprd + ph[f] * 0.1;
      p[f + '1' + S] = [-c * 0.34, 0, s * sp * 0.5];
      p[f + '2' + S] = [-c * 0.42, 0, 0];
      p[f + '3' + S] = [-c * 0.28, 0, 0];
    }
    p['t1' + S] = [-0.25 - curl * 0.3, 0, -s * (0.55 + thb[2] * 0.8)];
    p['t2' + S] = [-0.18 - curl * 0.35, 0, 0];
  }
  return p;
}
const ANIM_MAP = (() => {
  const m = {};
  ANIM_CLIPS.forEach((c, i) => {
    m[c.name] = i;
  });
  return m;
})();
function animIndex(n) {
  const i = ANIM_MAP[n];
  return i === undefined ? 0 : i;
}
function animNames() {
  return ANIM_CLIPS.map(c => c.name);
}
function animLabels() {
  return ANIM_CLIPS.map(c => ({ name: c.name, label: c.label, len: c.len }));
}
function poseFromClip(name, t, A, t0, holdEnd) {
  const c = ANIM_CLIPS[animIndex(name)] || ANIM_CLIPS[0];
  /* конечные клипы стартуют с нуля собственной шкалы при включении (t0), а не со
   случайной фазы абсолютного времени */
  let lt;
  if (c.len > 0) {
    /* holdEnd: уходящий клип в смешивании НЕ заворачивается по len: остаток от
   деления на границе конца клипа давал скачок исходной позы ровно на кадре
   переключения */
    lt = holdEnd ? clp(t - (t0 || 0), 0, c.len) : (((t - (t0 || 0)) % c.len) + c.len) % c.len;
  } else lt = t;
  return c.fn(lt, A) || { pose: pcl(PZERO), dy: 0 };
}
/* сумма |дельт| углов между снимком позы тела и позой клипа: мера «расстояния»
   между позами */
function poseDistSnap(st, name, t) {
  const SB = st._snapB;
  if (!SB || !SB.pose) return 0;
  const wp = poseFromClip(name, t, { ph: st.animPhase || 0 }, st.pAnimT0).pose;
  for (const bn in PL_FLIP) {
    const a = wp[bn];
    if (a) a[0] = -a[0];
  }
  let d = 0;
  for (const k in wp) {
    const a = SB.pose[k],
      b = wp[k];
    if (a && b) d += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  }
  return d;
}
function playerAutoAnim(st) {
  if (st.pAnimForce) return st.pAnimForce;
  /* ОДНОРАЗОВЫЕ ДЕЙСТВИЯ ДОИГРЫВАЮТ: interact/push проходят весь свой len
   (0.75/0.9 с) от нажатия E, пока игрок стоит; движение (bobA) прерывает их со
   смешиванием — на ходу в вьюмодели работает только вытягивание руки. */
  if (st.pShot) {
    const c = ANIM_CLIPS[animIndex(st.pShot)];
    const tn = st.time === undefined ? st.pShotT0 || 0 : st.time;
    /* присед не блокирует одноразовое действие — crouchify держит ноги и таз из
   'crouch' */
    if (c && c.len > 0 && tn - (st.pShotT0 || 0) < c.len && (st.bobA || 0) < 0.28) return st.pShot;
  }
  const cr = (st.pCrouch || 0) > 0.42;
  const mv = Math.min(1, st.bobA || 0);
  if (cr) return mv > 0.3 ? 'sneak' : 'crouch';
  if (mv > 0.28) return (st.runK || 0) > 0.5 ? 'run' : 'walk';
  return 'idle';
}

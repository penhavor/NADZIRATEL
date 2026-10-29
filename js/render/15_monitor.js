/* =============== ШАГ МОНИТОРА ================
   Та же физика, что у игрока (см. GAIT), на его риге. Риг строится СРАЗУ В
   КЛЕТКАХ (без PL_SCALE): таз 0.46, сустав M_HIP = 0.41 клетки = 1.2063 м.
   Шаг 8.04 км/ч — из равных чисел Фруда; K = duty·2π/S: шаг duty 0.52,
   S 0.38904, K 8.3983; бег duty 0.35, S 0.37401, K 5.8798. Сутулый силуэт:
   +0.40 наклона груди и горб, макушка ≈2.9 м (лампа 3.21, потолок 3.5).
   Конвенции рига монстра: вперёд = +Z, «бедро вперёд» = ОТРИЦАТЕЛЬНЫЙ наклон,
   стопа ft: ПОЛОЖИТЕЛЬНЫЙ наклон = носок ВНИЗ (противоположно игроку). */
const M_PEL_Y = 0.52,
  M_HIP = 0.47; /* таз выше — ноги длиннее */
const M_THLEN = 0.26,
  M_SNLEN = 0.22;
const M_HIP_OFF = [0.06, -0.05, 0]; /* смещение th от pel (×sg по X) */
/* Точки подошвы [z,y] на кости ft — по геометрии лофта buildRig: пятка высокая и
   короткая, плюсна и пальцы низко — пальцеходящее. Когти в контакт НЕ входят
   (они визуально «режут» пол). */
const M_SOLE_PTS = [
  [-0.024, -0.03],
  [0.0, -0.042],
  [0.03, -0.046],
  [0.06, -0.049],
  [0.09, -0.05],
  [0.11, -0.047]
];
const M_SOLE_SX = [-0.026, 0, 0.026]; /* боковое отнесение — как в monFootLowest */
/* Контакт подошвы — та же схема, что и soleContact игрока: hA точный минимум,
   zrel — softmin против рывков на перекате. */
function monSoleContact(phi, roll, yaw) {
  return soleContactGen(phi, roll, yaw, M_SOLE_SX, M_SOLE_PTS, 0.006);
}
/* 2-костный IK ноги монстра — та же теорема косинусов, что и legIK игрока, но
   toeAbs — АБСОЛЮТНЫЙ наклон стопы (+ = носок вниз). Возвращает
   [th,sn,ftLocal,clamped,d]. */
function monLegIK(zf, yd, toeAbs) {
  const r = legIKGen(
    zf,
    yd,
    M_THLEN,
    M_SNLEN,
    M_THLEN + M_SNLEN - 0.004,
    Math.abs(M_THLEN - M_SNLEN) + 0.012
  );
  return [r[0], r[1], toeAbs, r[2], r[3]];
}
/* План стопы на ψ∈[0,2π): ψ=0 — постановка. bias=0.55 — стопа встаёт чуть
   впереди середины (пальцеходящее существо тянется носком). Знаки наклонов
   зеркальны к игроку: носок вверх = ОТРИЦАТЕЛЬНЫЙ phi. */
function monFootPlan(psi, G, sg) {
  const TAU = Math.PI * 2,
    arc = G.duty * TAU;
  const C = M_HIP - G.hipBase; /* «просадка» таза у этого шага */
  const b =
    G.bob * Math.cos(2 * psi); /* π-периодичное покачивание таза (тот же знак, что у игрока) */
  let zfC, phi, clearance, u;
  if (psi < arc) {
    u = psi / arc;
    zfC = G.S * (G.bias - u); /* контакт уходит назад ЛИНЕЙНО = стоит */
    if (u < G.hsEnd) phi = -G.hs * (1 - u / G.hsEnd); /* постановка: носок чуть поднят */
    else if (u < 0.62) phi = 0; /* плоская опора, перекат */
    else phi = G.po * sm((u - 0.62) / 0.38); /* отталкивание носком (носок вниз) */
    clearance = 0;
  } else {
    u = (psi - arc) / (TAU - arc);
    const e = u * u * (3 - 2 * u);
    zfC =
      -G.S * (1 - G.bias) + G.S * (0.22 * u + 0.78 * e); /* мах вперёд, опережающий постановку */
    if (u < 0.25) phi = G.po - (G.po + G.hs * 0.85) * sm(u / 0.25);
    else if (u < 0.7) phi = -G.hs * 0.85;
    else phi = -G.hs * 0.85 + (-G.hs + G.hs * 0.85) * sm((u - 0.7) / 0.3);
    clearance = G.lift * Math.sin(Math.PI * Math.pow(u, 0.8));
  }
  const c = monSoleContact(phi, G.kneeOut * sg, G.toeOut * sg);
  const soleRoot = C + b + clearance;
  /* цель IK лодыжки: контакт на zfC, пятно контакта на zrel ВПЕРЕДИ лодыжки ⇒
   лодыжка на zfC − zrel. */
  return { zf: zfC - c.zrel, zfC: zfC, phi: phi, stance: psi < arc, soleRoot: soleRoot, u: u };
}
/* FK ноги монстра (корень в начале, БЕЗ dy): матрицы костей ft. Смещения — из
   buildRig: pel [0,0.50,0], th [±0.060,−0.05,0], sn [0,−M_THLEN,0],
   ft [0,−M_SNLEN,0]. */
function monLegFK(pose) {
  const out = {};
  const zero = [0, 0, 0];
  const pel = (pose && pose.pel) || zero;
  const Mp = m4mul(
    m4t(0, M_PEL_Y, 0),
    m4mul(m4rotY(pel[1]), m4mul(m4rotX(pel[0]), m4rotZ(pel[2])))
  );
  for (const s of ['L', 'R']) {
    const sg = s === 'L' ? 1 : -1;
    const th = (pose && pose['th' + s]) || zero,
      sn = (pose && pose['sn' + s]) || zero,
      ft = (pose && pose['ft' + s]) || zero;
    const Mt = m4mul(
      Mp,
      m4mul(
        m4t(M_HIP_OFF[0] * sg, M_HIP_OFF[1], M_HIP_OFF[2]),
        m4mul(m4rotY(th[1]), m4mul(m4rotX(th[0]), m4rotZ(th[2])))
      )
    );
    const Ms = m4mul(
      Mt,
      m4mul(m4t(0, -M_THLEN, 0), m4mul(m4rotY(sn[1]), m4mul(m4rotX(sn[0]), m4rotZ(sn[2]))))
    );
    out[s] = m4mul(
      Ms,
      m4mul(m4t(0, -M_SNLEN, 0), m4mul(m4rotY(ft[1]), m4mul(m4rotX(ft[0]), m4rotZ(ft[2]))))
    );
  }
  return out;
}
/* нижняя точка подошв относительно корня (монстр) — аналог footLowest игрока */
function monFootLowest(pose) {
  const M = monLegFK(pose);
  let lo = 1e9;
  for (const s of ['L', 'R']) {
    const F = M[s];
    for (const q of M_SOLE_PTS)
      for (const sx of M_SOLE_SX) {
        const y = F[1] * sx + F[5] * q[1] + F[9] * q[0] + F[13];
        if (y < lo) lo = y;
      }
  }
  return lo;
}
/* Параметры шага монстра — вывод в заголовке блока. Числа НЕ свободные: S и K
   связаны уравнением отсутствия проскальзывания, длина шага и каденс — числом
   Фруда. */
const MON_GAIT = {
  walk: {
    S: 0.38904,
    duty: 0.52,
    bias: 0.55,
    hipBase: 0.46,
    bob: 0.0137,
    hs: 0.1,
    hsEnd: 0.2,
    po: 0.3,
    lift: 0.046,
    kneeOut: 0.025,
    toeOut: 0.035,
    lean: 0.1,
    leanOsc: 0.012,
    pelRoll: 0.025,
    pelYaw: 0.05,
    chestBob: 0.015,
    armX: 0.4,
    armBack: 0.04,
    armZ: 0.13,
    elbowFix: 0.44,
    armBend: 0.3
  },
  run: {
    S: 0.37401,
    duty: 0.35,
    bias: 0.55,
    hipBase: 0.44,
    bob: 0.0182,
    hs: 0.06,
    hsEnd: 0.14,
    po: 0.45,
    lift: 0.075,
    kneeOut: 0.035,
    toeOut: 0.03,
    lean: 0.26,
    leanOsc: 0.02,
    pelRoll: 0.03,
    pelYaw: 0.07,
    chestBob: 0.02,
    armX: 0.7,
    armBack: 0.08,
    armZ: 0.16,
    elbowFix: 0.85,
    armBend: 0.45,
    flightCap: 0.075
  }
};
function monGaitK(G) {
  return (G.duty * 2 * Math.PI) / G.S;
}
const MON_GAIT_K = { walk: monGaitK(MON_GAIT.walk), run: monGaitK(MON_GAIT.run) };
/* поза шага монстра + dy корня (клетки). Структура — копия gaitPoseIK игрока:
   таз → IK обеих ног → контрротация груди → руки в противофазе → dy.
   omega — угловая скорость фазы [рад/с], нужна для честной высоты полёта. */
function monGaitPose(ph, G, omega, extraLean) {
  const TAU = Math.PI * 2;
  const psiL = ((ph % TAU) + TAU) % TAU;
  const psiR = (((ph + Math.PI) % TAU) + TAU) % TAU;
  const arc = G.duty * TAU;
  const fL = monFootPlan(psiL, G, 1),
    fR = monFootPlan(psiR, G, -1);
  const swEnv = fp => (fp.stance ? 0 : Math.sin(Math.PI * fp.u));
  const eL = swEnv(fL),
    eR = swEnv(fR);
  const rollA = G.pelRoll * (eR - eL);
  const yawA = G.pelYaw * Math.cos(psiL);
  /* extraLean — охотничий наклон: ВНУТРИ IK (таз поворачивает ноги; если бы наклон
   добавлялся после решения, стопы уезжали бы в пол на сантиметры, особенно в
   полёте) */
  const xl = extraLean || 0;
  const pitA = G.lean * 0.6 + xl * 0.6 + G.leanOsc * Math.sin(psiL * 2 + 0.6);
  const r = {};
  r.pel = [pitA, yawA, rollA];
  const Rp = rotM3(pitA, yawA, rollA);
  const hipY = sg => M_PEL_Y + Rp[3] * (M_HIP_OFF[0] * sg) + Rp[4] * M_HIP_OFF[1];
  const hipZ = sg => Rp[6] * (M_HIP_OFF[0] * sg) + Rp[7] * M_HIP_OFF[1];
  const solveLeg = (f, sg) => {
    const roll = G.kneeOut * sg + rollA,
      yaw = G.toeOut * sg + yawA;
    const zfRel = f.zf - hipZ(sg);
    /* МНОГОПРОХОДНОЕ РЕШЕНИЕ (игрок использует 2 прохода): упор лодыжки жёстко
   зажимает наклон плана на отталкивании (0.45 → σ−0.55), а hA сильно зависит от
   наклона — сходимся до 1e-5 за ≤8 итераций, иначе опорная стопа на границе
   полёта проседает в пол на 15 мм. */
    let phi = f.phi,
      a = null,
      shinAbs = 0,
      phi2 = f.phi;
    for (let it = 0; it < 8; it++) {
      const c = monSoleContact(phi, roll, yaw);
      const ankleY = f.soleRoot + c.hA;
      a = monLegIK(zfRel, hipY(sg) - ankleY, phi);
      shinAbs = a[0] + a[1];
      /* анатомический упор лодыжки: относительно голени стопа живёт в
   [−0.55 тыльного … +0.95 подошвенного] (плюс монстра = носок вниз) */
      phi2 = clp(f.phi, shinAbs - 0.55, shinAbs + 0.95);
      if (Math.abs(phi2 - phi) < 1e-5) break;
      phi = phi2;
    }
    return [a[0] - pitA, a[1], phi2 - shinAbs];
  };
  const ikL = solveLeg(fL, 1),
    ikR = solveLeg(fR, -1);
  r.thL = [ikL[0], 0, G.kneeOut];
  r.snL = [ikL[1], 0, 0];
  r.ftL = [ikL[2], G.toeOut, 0];
  r.thR = [ikR[0], 0, -G.kneeOut];
  r.snR = [ikR[1], 0, 0];
  r.ftR = [ikR[2], -G.toeOut, 0];
  /* грудь: контрротация против таза + вертикальное покачивание (как spn/ch игрока) */
  r.ch = [
    G.lean * 0.4 +
      xl * 0.4 -
      G.bob * 0.35 * Math.sin(psiL * 2) +
      G.chestBob * Math.sin(psiL * 2 + Math.PI * 0.5),
    -yawA * 1.5,
    -rollA * 0.55
  ];
  /* руки — в противофазе к своим ногам, локоть доводится на махе вперёд */
  const swL = Math.sin(psiL),
    swR = Math.sin(psiR);
  const armF = sw => [sw * G.armX - G.armBack, -(G.elbowFix + G.armBend * Math.max(0, -sw))];
  const aL = armF(swL),
    aR = armF(swR);
  r.uaL = [aL[0], 0, G.armZ];
  r.faL = [aL[1], 0, 0.04];
  r.uaR = [aR[0], 0, -G.armZ];
  r.faR = [aR[1], 0, -0.04];
  /* dy: опора — footLowest; полёт (duty<0.5) — баллистика, границы непрерывны.
   Высота полёта — из непрерывности вертикальной скорости на отрыве, но не круче
   3·v на окно полёта, иначе на экстремальных скоростях (ω≈22 рад/с) парабола
   щёлкала. */
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
  let dy;
  if (flight) {
    const dyBase = -(M_HIP - G.hipBase + G.bob * Math.cos(2 * psiL));
    const vUp = 2 * (G.bob * CELL_M) * omega * Math.abs(Math.sin(2 * arc));
    const Tf = (Math.PI - arc) / Math.max(omega, 1e-6);
    const hM = Math.min((vUp * vUp) / (2 * 9.80665), 0.75 * vUp * Tf);
    dy = dyBase + (hM / CELL_M) * 4 * ftau * (1 - ftau);
  } else {
    dy = -monFootLowest(r);
  }
  r.root = [0, 0, 0];
  r.dy = dy;
  r._flight = flight; /* monPose: пересчитываем dy после охотничьего наклона, если мы в опоре */
  return r;
}

/* ==== МОНИТОР: РИГ ==== */
function buildRig() {
  const B = [];
  const idx = {};
  const names = [];
  const UV = [0.02, 0.48, 0.02, 0.98];
  const add = (name, parent, off, V) => {
    idx[name] = B.length;
    names.push(name);
    B.push({
      parent: typeof parent === 'string' ? idx[parent] : parent,
      off,
      v: new Float32Array(V),
      n: V.length / 9,
      m: new Float32Array(16)
    });
    return idx[name];
  };
  const AO = (V, a) => partAO(V, a);
  const teeth = (z0, y0, w0) =>
    partCat(
      partAO(partShift(tboxPart(y0 - 0.02, y0, 0.0055, 0.004, 0.005, 0.004), -0.03, 0, z0), 1.0),
      partAO(
        partShift(tboxPart(y0 - 0.016, y0, 0.005, 0.0035, 0.005, 0.0035), -0.01, 0, z0 + 0.004),
        1.0
      ),
      partAO(
        partShift(tboxPart(y0 - 0.016, y0, 0.005, 0.0035, 0.005, 0.0035), 0.01, 0, z0 + 0.004),
        1.0
      ),
      partAO(partShift(tboxPart(y0 - 0.02, y0, 0.0055, 0.004, 0.005, 0.004), 0.03, 0, z0), 1.0)
    );
  add('root', -1, [0, 0, 0], []);
  /* таз: подвздошные гребни */
  add(
    'pel',
    'root',
    [0, M_PEL_Y, 0],
    AO(
      partCat(
        loftPart(
          [
            [-0.085, 0, 0, 0.088, 0.068, 2.5],
            [-0.02, 0, 0, 0.104, 0.08, 2.5],
            [0.05, 0, 0, 0.098, 0.078, 2.5],
            [0.085, 0, 0, 0.08, 0.066, 2.5]
          ],
          12,
          UV,
          true
        ),
        loftPart(
          [
            [0.02, 0.075, -0.01, 0.03, 0.045, 2.2],
            [0.075, 0.088, -0.005, 0.024, 0.034, 2.2]
          ],
          8,
          UV,
          true
        ),
        loftPart(
          [
            [0.02, -0.075, -0.01, 0.03, 0.045, 2.2],
            [0.075, -0.088, -0.005, 0.024, 0.034, 2.2]
          ],
          8,
          UV,
          true
        )
      ),
      0.2
    )
  );
  /* грудь: рёберная клетка с ключицами и холкой */
  add(
    'ch',
    'pel',
    [0, 0.08, 0],
    AO(
      partCat(
        loftPart(
          [
            [0.0, 0, 0, 0.096, 0.072, 2.5],
            [0.07, 0, -0.004, 0.128, 0.092, 2.5],
            [0.15, 0, -0.008, 0.138, 0.098, 2.5],
            [0.22, 0, -0.004, 0.112, 0.084, 2.5],
            [0.26, 0, 0, 0.078, 0.064, 2.5]
          ],
          14,
          UV,
          true
        ),
        loftPart(
          [
            [0.2, 0.045, -0.055, 0.036, 0.03, 2.2],
            [0.245, 0.055, -0.045, 0.028, 0.024, 2.2]
          ],
          8,
          UV,
          true
        ),
        loftPart(
          [
            [0.2, -0.045, -0.055, 0.036, 0.03, 2.2],
            [0.245, -0.055, -0.045, 0.028, 0.024, 2.2]
          ],
          8,
          UV,
          true
        ),
        loftPart(
          [
            [0.22, 0, 0.075, 0.055, 0.03, 2.2],
            [0.26, 0, 0.085, 0.04, 0.024, 2.2]
          ],
          8,
          UV,
          true
        ),
        /* ГОРБ на спине (−Z): сутулое существо с холкой, а не «модель» */
        loftPart(
          [
            [0.15, 0, -0.055, 0.062, 0.048, 2.4],
            [0.21, 0, -0.088, 0.082, 0.062, 2.4],
            [0.265, 0, -0.078, 0.055, 0.042, 2.4]
          ],
          12,
          UV,
          true
        )
      ),
      0.2
    )
  );
  /* голова: череп с надбровными дугами, скулами и затылком */
  add(
    'hd',
    'ch',
    [0, 0.26, 0],
    AO(
      partCat(
        loftPart(
          [
            [0.02, 0, 0.01, 0.052, 0.052, 2.6],
            [0.07, 0, 0.005, 0.062, 0.066, 2.6],
            [0.12, 0, 0, 0.064, 0.072, 2.6],
            [0.16, 0, -0.005, 0.052, 0.06, 2.6],
            [0.185, 0, -0.01, 0.032, 0.04, 2.6]
          ],
          14,
          UV,
          true
        ),
        loftPart(
          [
            [0.095, 0, -0.058, 0.048, 0.014, 2.4],
            [0.115, 0, -0.062, 0.044, 0.012, 2.4]
          ],
          10,
          UV,
          true
        ),
        loftPart(
          [
            [0.06, 0.052, -0.03, 0.016, 0.022, 2.2],
            [0.09, 0.056, -0.034, 0.013, 0.018, 2.2]
          ],
          8,
          UV,
          true
        ),
        loftPart(
          [
            [0.06, -0.052, -0.03, 0.016, 0.022, 2.2],
            [0.09, -0.056, -0.034, 0.013, 0.018, 2.2]
          ],
          8,
          UV,
          true
        ),
        teeth(0.062, 0.048, 0)
      ),
      0.85
    )
  );
  /* челюсть: нижняя, с зубами */
  add(
    'jaw',
    'hd',
    [0, 0.028, -0.012],
    AO(
      partCat(
        loftPart(
          [
            [-0.048, 0, 0.01, 0.04, 0.048, 2.5],
            [-0.02, 0, 0.016, 0.046, 0.054, 2.5],
            [0.02, 0, 0.02, 0.042, 0.05, 2.5]
          ],
          12,
          UV,
          true
        ),
        partAO(
          partShift(tboxPart(-0.03, -0.006, 0.005, 0.004, 0.005, 0.004), -0.026, 0, 0.07),
          1.0
        ),
        partAO(
          partShift(tboxPart(-0.034, -0.006, 0.005, 0.0035, 0.005, 0.0035), -0.009, 0, 0.074),
          1.0
        ),
        partAO(
          partShift(tboxPart(-0.034, -0.006, 0.005, 0.0035, 0.005, 0.0035), 0.009, 0, 0.074),
          1.0
        ),
        partAO(partShift(tboxPart(-0.03, -0.006, 0.005, 0.004, 0.005, 0.004), 0.026, 0, 0.07), 1.0)
      ),
      0.8
    )
  );
  /* кость тряпки оставлена пустой для совместимости поз: плащ не привязан к тазу —
   ткань строится каждый кадр верле-сеткой (skirtSim/skirtBuild) и крепится к
   ГРУДИ (линия плеч). */
  add('sk', 'pel', [0, 0.03, 0], []);
  /* КИСТЬ: запястье, ладонь с пястной массой, четыре когтистых пальца (средние
   длиннее, изогнуты вниз-вперёд) и смещённый коготь большого пальца. AO
   назначается ОТДЕЛЬНО на каждую часть — общий partAO(partCat(...)) перезаписал
   бы бледнокостный материал когтей. */
  const arm = (sg, nm) => {
    add(
      'ua' + nm,
      'ch',
      [0.15 * sg, 0.205, 0],
      AO(
        partCat(
          loftPart(
            [
              [0.02, 0, 0, 0.048, 0.044, 2.3],
              [-0.06, 0.004 * sg, 0, 0.044, 0.04, 2.3],
              [-0.14, 0.002 * sg, 0, 0.036, 0.033, 2.3],
              [-0.22, 0, 0, 0.03, 0.028, 2.3]
            ],
            10,
            UV,
            true
          ),
          loftPart(
            [
              [-0.04, 0.01 * sg, -0.008, 0.03, 0.026, 2.2],
              [-0.09, 0.012 * sg, -0.01, 0.026, 0.023, 2.2]
            ],
            8,
            UV,
            true
          )
        ),
        0.2
      )
    );
    const claw = (len, r0, x, y, z, rx, ry, rz, ao) =>
      partAO(partXf(clawPart(len, r0, 7, UV), x, y, z, rx, ry, rz), ao);
    add(
      'fa' + nm,
      'ua' + nm,
      [0, -0.22, 0],
      partCat(
        /* предплечье с локтем */
        AO(
          loftPart(
            [
              [0.0, 0, 0, 0.032, 0.03, 2.3],
              [-0.05, 0, -0.006, 0.03, 0.028, 2.3],
              [-0.12, 0, -0.002, 0.024, 0.022, 2.3],
              [-0.17, 0, 0, 0.021, 0.02, 2.3]
            ],
            10,
            UV,
            true
          ),
          0.2
        ),
        /* запястье → ладонь → пясть */
        AO(
          loftPart(
            [
              [-0.17, 0, 0, 0.021, 0.02, 2.2],
              [-0.198, 0, 0.004, 0.038, 0.027, 2.2],
              [-0.23, 0, 0.01, 0.045, 0.031, 2.2],
              [-0.255, 0, 0.007, 0.034, 0.024, 2.2]
            ],
            10,
            UV,
            true
          ),
          0.3
        ),
        /* четыре когтистых пальца: средние длиннее, внешние короче и расставлены */
        claw(0.1, 0.015, -0.034, -0.247, 0.015, -0.5, -0.14, 0, 0.78),
        claw(0.122, 0.0165, -0.0115, -0.252, 0.018, -0.56, -0.045, 0, 0.8),
        claw(0.118, 0.0165, 0.0115, -0.252, 0.018, -0.56, 0.045, 0, 0.8),
        claw(0.096, 0.015, 0.034, -0.247, 0.015, -0.5, 0.14, 0, 0.78),
        /* коготь большого пальца — внутрь к ладони (сторона зависит от руки) */
        claw(0.082, 0.018, -0.041 * sg, -0.214, 0.012, -0.95, 0, -0.38 * sg, 0.72)
      )
    );
  };
  arm(1, 'L');
  arm(-1, 'R');
  /* ноги: бедро с коленом, голень с икрой, стопа с когтями */
  const leg = (sg, nm) => {
    add(
      'th' + nm,
      'pel',
      [0.06 * sg, -0.05, 0],
      AO(
        loftPart(
          [
            [0.025, 0, 0, 0.056, 0.052, 2.3],
            [-0.104, 0, 0.004, 0.05, 0.046, 2.3],
            [-0.208, 0, 0.006, 0.042, 0.04, 2.3],
            [-0.26, 0, 0.004, 0.038, 0.036, 2.3]
          ],
          10,
          UV,
          true
        ),
        0.2
      )
    ); /* бедро длиннее */
    add(
      'sn' + nm,
      'th' + nm,
      [0, -M_THLEN, 0],
      AO(
        partCat(
          loftPart(
            [
              [0.0, 0, 0, 0.036, 0.036, 2.3],
              [-0.068, 0, -0.01, 0.038, 0.042, 2.3],
              [-0.158, 0, -0.002, 0.028, 0.028, 2.3],
              [-0.22, 0, 0, 0.023, 0.024, 2.3]
            ],
            10,
            UV,
            true
          ),
          loftPart(
            [
              [-0.026, 0, 0.022, 0.02, 0.016, 2.2],
              [-0.092, 0, 0.028, 0.016, 0.014, 2.2]
            ],
            8,
            UV,
            true
          )
        ),
        0.2
      )
    ); /* голень длиннее */
    add(
      'ft' + nm,
      'sn' + nm,
      [0, -M_SNLEN, 0],
      AO(
        partCat(
          loftPart(
            [
              [-0.02, 0, 0.01, 0.026, 0.04, 2.4],
              [-0.045, 0, 0.045, 0.03, 0.062, 2.4],
              [-0.05, 0, 0.085, 0.026, 0.045, 2.4]
            ],
            10,
            UV,
            true
          ),
          partAO(partShift(clawPart(0.055, 0.011, 6, UV), -0.014, -0.048, 0.115), 0.3),
          partAO(partShift(clawPart(0.06, 0.011, 6, UV), 0.0, -0.05, 0.125), 0.3),
          partAO(partShift(clawPart(0.055, 0.011, 6, UV), 0.014, -0.048, 0.115), 0.3)
        ),
        0.2
      )
    );
  };
  leg(1, 'L');
  leg(-1, 'R');
  let total = 0;
  for (const b of B) total += b.n;
  return { B, idx, names, total };
}

/* Поза Монитора. Ноги, таз, грудь и противофаза рук — шаг MON_GAIT (тот же IK,
   что у игрока). Поверх — «характер»: взгляд на игрока в охоте, сканирование на
   месте, челюсть, лохмотья. Высота корня пишется в S.monDY (drawWorld строит по
   ней rootM). */
function monPose(S, t) {
  const chase = S.mMode === 'chase';
  const run = S.mGait === 'run';
  const stand = S.mGait === 'stand';
  const moving = (S.mSpeedNow || 0) > 0.05 && !stand;
  const p = S.mPhase || 0,
    sw = Math.sin(p),
    cw = Math.cos(p);
  /* плавный переход стойка↔шаг (~0.25 с): никакого «щёлка» таза на старте и стопе */
  const dtm = Math.max(0, Math.min(0.1, t - (S._mgT === undefined ? t : S._mgT)));
  S._mgT = t;
  const gkT = moving ? 1 : 0;
  S._mgK = S._mgK === undefined ? gkT : S._mgK + (gkT - S._mgK) * Math.min(1, dtm * 7);
  const gk = S._mgK;
  const L3 = (a, b, k) => [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k
  ];
  /* --- шаг: ноги, таз, грудь, противофаза рук, dy корня --- */
  const G = run ? MON_GAIT.run : MON_GAIT.walk;
  /* охотничий наклон передаётся в шаг (extraLean) — IK и dy его учитывают */
  const r = monGaitPose(
    p,
    G,
    (S.mSpeedNow || 0) * (run ? MON_GAIT_K.run : MON_GAIT_K.walk),
    chase ? 0.18 : 0
  );
  const gaitDY = r.dy;
  /* --- стойка: медленный перенос веса между стопами, опора через IK --- */
  const lag = stand ? S.mScanOff || 0 : 0;
  const sh = Math.sin(t * 0.65) * 0.5 + 0.5;
  const stPel = [
    0.05 + Math.sin(t * 1.6) * 0.012,
    Math.sin(t * 0.7) * 0.016,
    lag * 0.14 + Math.sin(t * 0.5) * 0.022
  ];
  /* Стойка стоит на той же высоте таза, что и шаг (hipBase шага): переход
   стойка↔шаг не меняет рост монстра. */
  const stHS = MON_GAIT.walk.hipBase;
  const stSolve = (sg, dyY) => {
    const roll = 0.03 * sg,
      yaw = 0.035 * sg;
    let phi = -0.02,
      a = null,
      shA = 0,
      phi2 = phi;
    for (let it = 0; it < 6; it++) {
      const c = monSoleContact(phi, roll, yaw);
      a = monLegIK(0.02, stHS + dyY - c.hA, phi);
      shA = a[0] + a[1];
      phi2 = clp(phi, shA - 0.55, shA + 0.95);
      if (Math.abs(phi2 - phi) < 1e-5) break;
      phi = phi2;
    }
    return [a[0] - stPel[0], a[1], phi2 - shA];
  };
  const ikSL = stSolve(1, 0.006 + 0.006 * sh),
    ikSR = stSolve(-1, 0.006 + 0.006 * (1 - sh));
  const stLegs = {
    thL: [ikSL[0], 0, 0.03],
    thR: [ikSR[0], 0, -0.03],
    snL: [ikSL[1], 0, 0],
    snR: [ikSR[1], 0, 0],
    ftL: [ikSL[2], 0.02, 0],
    ftR: [ikSR[2], -0.02, 0]
  };
  const stCh = [0.05 + Math.sin(t * 2.1) * 0.016, Math.sin(t * 1.05) * 0.014, lag * 0.4];
  const tr = Math.sin(t * 1.15) * 0.05;
  const stArm = {
    uaL: [-0.42 + tr, 0, 0.3],
    faL: [-0.95 + tr * 2, 0, 0.16],
    uaR: [-0.36 - tr, 0, -0.28],
    faR: [-0.85 - tr * 2, 0, -0.14]
  };
  let dy = gaitDY;
  if (gk < 1) {
    r.pel = L3(stPel, r.pel, gk);
    r.thL = L3(stLegs.thL, r.thL, gk);
    r.thR = L3(stLegs.thR, r.thR, gk);
    r.snL = L3(stLegs.snL, r.snL, gk);
    r.snR = L3(stLegs.snR, r.snR, gk);
    r.ftL = L3(stLegs.ftL, r.ftL, gk);
    r.ftR = L3(stLegs.ftR, r.ftR, gk);
    r.ch = L3(stCh, r.ch, gk);
    r.uaL = L3(stArm.uaL, r.uaL, gk);
    r.faL = L3(stArm.faL, r.faL, gk);
    r.uaR = L3(stArm.uaR, r.uaR, gk);
    r.faR = L3(stArm.faR, r.faR, gk);
  }
  /* высота корня ВСЕГДА из контакта итоговой позы с полом — и в опоре, и в
   смешивании стойка↔шаг (смешивание углов ног — не смешивание высот: стопы
   пробивали пол на 2–4 см). Баллистика полёта — только в чистом шаге при полном
   смешивании. */
  if (!(gk > 0.999 && r._flight)) dy = -monFootLowest(r);
  if (chase) {
    /* охота: руки вытянуты вперёд, качаются в ритме шага */
    r.uaL = L3(r.uaL, [-1.35 + sw * 0.2, 0, 0.18], gk);
    r.faL = L3(r.faL, [-0.5 + sw * 0.14, 0, 0.1], gk);
    r.uaR = L3(r.uaR, [-1.35 - cw * 0.2, 0, -0.18], gk);
    r.faR = L3(r.faR, [-0.5 - cw * 0.14, 0, -0.1], gk);
  }
  /* СУТУЛОСТЬ: постоянный наклон груди вперёд (горб добавляет геометрия на спине).
   Опускание взгляда компенсируется формулой головы (×0.45) — лицо смотрит
   вперёд-вниз, а силуэт остаётся сутулым при любом шаге. */
  r.ch[0] += 0.55; /* сутулость: горб читается в силуэте */
  S.monDY = dy;
  /* --- голова/челюсть/лохмотья: взгляд + стабилизация против наклона --- */
  let hdYaw,
    hdPitch,
    hdRoll = 0;
  if (chase) {
    let da = Math.atan2(S.px - S.mx, S.py - S.my) - (S.mYaw || 0);
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    hdYaw = Math.max(-0.55, Math.min(0.55, da));
    hdPitch = -0.05;
  } else if (stand) {
    const lc = Math.max(-0.95, Math.min(0.95, lag));
    hdYaw = lc * 1.05 + Math.sin(t * 1.3) * 0.045;
    hdPitch = 0.09 * Math.sin(t * 1.7) + (Math.abs(lag) > 1.5 ? -0.09 : 0.03);
    hdRoll = -lc * 0.1 + Math.sin(t * 0.9) * 0.028;
  } else {
    hdYaw = Math.sin(t * 0.6) * 0.42 * (moving ? 0.45 : 1);
    hdPitch = -0.02 + Math.sin(t * 1.4) * 0.05 + (run ? 0.1 : 0);
  }
  hdPitch -=
    (r.pel[0] + r.ch[0]) * 0.45; /* взгляд не ныряет вслед за торсом (как nk/hd у игрока) */
  r.hd = [
    hdPitch,
    hdYaw,
    0.1 * Math.sin(t * 0.9) * (stand ? 0.4 : 1) + (chase ? hdYaw * 0.18 : 0) + hdRoll
  ];
  r.jaw = [
    chase
      ? -0.42 - 0.1 * Math.sin(t * 9)
      : stand
        ? -0.04 - 0.06 * Math.pow(Math.max(0, Math.sin(t * 0.8)), 8)
        : -0.05 - 0.03 * Math.sin(t * 1.7),
    0,
    0
  ];
  /* быстрые хаотичные подёргивания головы (фон главного меню): биение
   несоизмеримых синусов даёт нерегулярные рывки; амплитуда рыскания ~90° — проба
   «сломанной шеи» (наклон и крен пропорционально меньше) */
  if (S.headJerk > 0) {
    const jt = t * 24,
      k = S.headJerk;
    r.hd = [
      r.hd[0] + (Math.sin(jt * 2.37) * 0.57 + Math.sin(jt * 5.91 + 1.3) * 0.26) * k,
      r.hd[1] + (Math.sin(jt * 3.11 + 0.7) * 1.18 + Math.sin(jt * 8.23 + 2.0) * 0.39) * k,
      r.hd[2] + (Math.sin(jt * 4.53 + 2.1) * 0.43 + Math.sin(jt * 9.7) * 0.17) * k
    ];
    r.jaw = [-0.32 - 0.14 * Math.sin(jt * 6.71), 0, 0];
  }
  r.sk = [
    0.08 + (moving ? cw * 0.04 : Math.sin(t * 0.9) * 0.015),
    0,
    Math.sin(t * 1.7) * (moving ? 0.05 : 0.02)
  ];
  r.root = [0, 0, 0];
  return r;
}

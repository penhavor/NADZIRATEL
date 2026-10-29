/* =============== ПЛАЩ МОНИТОРА ================
   Закреплён на ГРУДИ (линия плеч наследует сутулость и наклон холки), задняя
   панель доходит до середины голени, передняя короче на 48% (плащ открыт
   спереди — ноги читаются), подол имеет рваную детерминированную бахрому.
   Физика — верле-сетка из SKIRT_NU×SKIRT_NV узлов, 2 подшага на кадр:
   · связи: длины колонок, окружные кольца и ИЗГИБНЫЕ через два ряда — ткань
   держит форму панели и не сминается в гармошку;
   · коллизии: грудь, холка, таз, бёдра и голени, обе руки и пол (−monDY в
   локальной системе ткани); при контакте гасится тангенциальная скорость —
   плащ драпируется на холке и не сползает;
   · демпфирование в секунду (pow) — не зависит от частоты кадров;
   · инерция корня: плащ отстаёт на разгоне, раскачивается в поворотах.
   Симуляция в локальной системе корня (рыскание снято); вершины собираются в
   triangle-list каждый кадр, нормали — от соседних узлов, AO темнеет к подолу. */
const SKIRT_NU = 20,
  SKIRT_NV = 9;
const SKIRT_TOP = [0.215, -0.014]; /* линия кольца в координатах кости ch [y,z] */
const SKIRT_LEN = 0.75; /* свис задней панели от линии плеч */
const SKIRT_FRONT = 0.52; /* передняя панель короче — плащ открыт спереди */
/* полуширины чуть уже у кольца — кольцо САДИТСЯ на плечи (плечо 0.150 + радиус
   руки 0.05 = 0.20), а не висит в воздухе в 5 см. */
const SKIRT_RX = [0.195, 0.17, 0.156, 0.162, 0.182]; /* полуширины по доле ряда t (0..1) */
/* Покоящиеся глубины облегают тело: задняя панель — по холке, пояснице и бёдрам,
   передняя подведена к груди (воротник не торчит). */
const SKIRT_RZK = [0.8, 0.68, 0.56, 0.52, 0.45]; /* отношение глубины к ширине */
const SKIRT_JAG = (() => {
  const o = [];
  for (let j = 0; j < SKIRT_NU; j++) {
    const h = (((j * 2654435761) >>> 0) % 997) / 997;
    o.push(0.9 + 0.14 * h);
  }
  return o;
})();
/* МЯГКИЙ ВОЗВРАТ к пошитой позе (сопоставление формы), скорость в 1/с по рядам:
   плечи и холка держат посадку жёстко, подол почти свободен — ткань возвращается
   после порыва или шага вместо того, чтобы оставаться «тряпкой». */
const SKIRT_FIT = (() => {
  const o = new Float32Array(SKIRT_NV);
  for (let i = 1; i < SKIRT_NV; i++) {
    const r = 26 * Math.pow(0.62, i - 1);
    o[i] = i <= 3 ? r : Math.max(0.04, r * 0.08);
  }
  return o;
})();
const SKIRT_LENJ = new Float32Array(SKIRT_NU); /* длина панели по колонке */
const SKIRT_R0 = new Float32Array(
  SKIRT_NU * SKIRT_NV * 3
); /* покоящиеся позиции (координаты груди) */
const SKIRT_SEGY = new Float32Array(SKIRT_NU * (SKIRT_NV - 1)); /* длины отрезков колонок */
const SKIRT_SEGC = new Float32Array(SKIRT_NU * SKIRT_NV); /* длины отрезков колец */
const SKIRT_SEGB = new Float32Array(SKIRT_NU * (SKIRT_NV - 2)); /* изгибные (через два ряда) */
const SKIRT_VN = SKIRT_NU * (SKIRT_NV - 1) * 2 * 3; /* вершины triangle-list на каждый кадр */
(() => {
  const lerpA = (A, t) => {
    const x = t * (A.length - 1),
      i = Math.min(A.length - 2, x | 0),
      k = x - i;
    return A[i] + (A[i + 1] - A[i]) * k;
  };
  for (let j = 0; j < SKIRT_NU; j++) {
    const a = (j / SKIRT_NU) * Math.PI * 2,
      ca = Math.cos(a);
    const back = (1 - ca) * 0.5; /* 0 — перед (+Z), 1 — зад */
    SKIRT_LENJ[j] =
      SKIRT_LEN * (SKIRT_FRONT + (1 - SKIRT_FRONT) * Math.pow(back, 0.8)) * SKIRT_JAG[j];
    for (let i = 0; i < SKIRT_NV; i++) {
      const t = i / (SKIRT_NV - 1),
        o3 = (j * SKIRT_NV + i) * 3;
      SKIRT_R0[o3] = lerpA(SKIRT_RX, t) * Math.sin(a);
      SKIRT_R0[o3 + 1] = SKIRT_TOP[0] - SKIRT_LENJ[j] * t;
      /* задние панели отведены НАЗАД дугой (они обходят ягодицы и бёдра снаружи, а не
   трутся о них): постоянное смещение назад + дуговой горб в середине */
      /* дуга ПРИЖАТА к телу: плащ облегает холку и спину вместо того, чтобы стоять
   шатром; передний воротник подведён к груди (−0.055 вперёд на кольце). */
      SKIRT_R0[o3 + 2] =
        lerpA(SKIRT_RX, t) * lerpA(SKIRT_RZK, t) * ca +
        SKIRT_TOP[1] -
        0.016 * back -
        0.022 * back * Math.sin(Math.PI * t) -
        0.055 * (1 - back) * Math.max(0, 1 - 1.2 * t);
    }
  }
  const dR = (a, b) =>
    Math.hypot(
      SKIRT_R0[a] - SKIRT_R0[b],
      SKIRT_R0[a + 1] - SKIRT_R0[b + 1],
      SKIRT_R0[a + 2] - SKIRT_R0[b + 2]
    );
  for (let j = 0; j < SKIRT_NU; j++) {
    const j2 = (j + 1) % SKIRT_NU;
    for (let i = 0; i < SKIRT_NV - 1; i++)
      SKIRT_SEGY[j * (SKIRT_NV - 1) + i] = dR((j * SKIRT_NV + i) * 3, (j * SKIRT_NV + i + 1) * 3);
    for (let i = 0; i < SKIRT_NV; i++)
      SKIRT_SEGC[j * SKIRT_NV + i] = dR((j * SKIRT_NV + i) * 3, (j2 * SKIRT_NV + i) * 3);
    for (let i = 0; i < SKIRT_NV - 2; i++)
      SKIRT_SEGB[j * (SKIRT_NV - 2) + i] = dR((j * SKIRT_NV + i) * 3, (j * SKIRT_NV + i + 2) * 3);
  }
})();
function skirtSim(S, dt, pose, rig, yaw) {
  const K = GPU.skirt,
    P = K.p,
    Q = K.q;
  if (K.seed !== S.seed) {
    K.init = 0;
    K.seed = S.seed;
  } /* новая партия — чистая ткань */
  const dtc = Math.min(0.033, Math.max(0.004, dt));
  /* матрица ГРУДИ в локальной системе корня (рыскание снято): точки крепления
   плаща сидят на линии плеч и наследуют сутулость и наклон холки. */
  const pr = pose.pel || [0, 0, 0],
    cr = pose.ch || [0, 0, 0];
  const Mp = m4mul(m4t(0, M_PEL_Y, 0), m4mul(m4rotY(pr[1]), m4mul(m4rotX(pr[0]), m4rotZ(pr[2]))));
  const Mc = m4mul(
    Mp,
    m4mul(m4t(0, 0.08, 0), m4mul(m4rotY(cr[1]), m4mul(m4rotX(cr[0]), m4rotZ(cr[2]))))
  );
  const PIN = K.pin || (K.pin = new Float32Array(SKIRT_NU * 3));
  for (let j = 0; j < SKIRT_NU; j++) {
    const o3 = j * SKIRT_NV * 3,
      p3 = j * 3;
    const x = SKIRT_R0[o3],
      y = SKIRT_R0[o3 + 1],
      z = SKIRT_R0[o3 + 2];
    PIN[p3] = Mc[0] * x + Mc[4] * y + Mc[8] * z + Mc[12];
    PIN[p3 + 1] = Mc[1] * x + Mc[5] * y + Mc[9] * z + Mc[13];
    PIN[p3 + 2] = Mc[2] * x + Mc[6] * y + Mc[10] * z + Mc[14];
  }
  /* пошитая поза ВСЕХ узлов (цель мягкой подгонки): крепления наследуют грудь,
   панели висят от них ВЕРТИКАЛЬНО (по силе тяжести), сечение смешивается от
   кольца креплений к пошитому вокруг оси тела — панель облегает холку, спину,
   бёдра и икры. Покоящаяся поза, вращающаяся вместе с грудью, утягивала подол
   назад — плащ вставал коконом; вертикальный гравитационный срез не спорит. */
  const RST = K.rest || (K.rest = new Float32Array(SKIRT_NU * SKIRT_NV * 3));
  for (let j = 0; j < SKIRT_NU; j++) {
    const r00 = j * SKIRT_NV * 3,
      p3 = j * 3;
    const pinX = PIN[p3],
      pinY = PIN[p3 + 1],
      pinZ = PIN[p3 + 2];
    for (let i2 = 0; i2 < SKIRT_NV; i2++) {
      const o3 = (j * SKIRT_NV + i2) * 3,
        t = i2 / (SKIRT_NV - 1);
      /* w: верхние ряды лежат на кольце креплений (сидят на плечах и холке), нижние
   сходятся к пошитому сечению вокруг оси тела; + лёгкое смещение А-силуэта */
      const w = Math.pow(t, 0.85);
      const hx = pinX + (SKIRT_R0[o3] - SKIRT_R0[r00]),
        hz = pinZ + (SKIRT_R0[o3 + 2] - SKIRT_R0[r00 + 2]);
      RST[o3] = hx + (SKIRT_R0[o3] - hx) * w;
      RST[o3 + 1] = pinY - SKIRT_LENJ[j] * t * 0.985;
      RST[o3 + 2] = hz + (SKIRT_R0[o3 + 2] - hz) * w + 0.04 * t * t;
    }
  }
  /* инерция: мировое ускорение корня → локальное (поворот на -yaw). ТЯЖЁЛАЯ ТКАНЬ —
   ускорение проходит ФНЧ (τ=0.14 с): толчки каденса, резкие повороты головы и
   числовой шум конечных разностей до ткани не доходят. */
  const cy = Math.cos(-yaw),
    sy = Math.sin(-yaw);
  const vx = (S.mx - K.px) / dtc,
    vz = (S.my - K.pz) / dtc;
  if (!K.init) {
    K.px = S.mx;
    K.pz = S.my;
    K.vx = vx;
    K.vz = vz;
    K.sax = 0;
    K.saz = 0;
    K.wvx = 0;
    K.wvz = 0;
  }
  let ax = (vx - K.vx) / dtc,
    az = (vz - K.vz) / dtc;
  const am = Math.hypot(ax, az);
  if (am > 8) {
    ax *= 8 / am;
    az *= 8 / am;
  }
  const kA = 1 - Math.exp(-dtc / 0.14);
  K.sax += (ax - K.sax) * kA;
  K.saz += (az - K.saz) * kA;
  const lax = cy * K.sax - sy * K.saz,
    laz = sy * K.sax + cy * K.saz;
  K.px = S.mx;
  K.pz = S.my;
  K.vx = vx;
  K.vz = vz;
  /* Сопротивление воздуха: квадратичный по скорости поток СГЛАЖЕН (τ=0.18 с) и
   ослаблен (0.22) — шаг ≈2°, бег ≈15°, экстремум >40°: плащ развевается, но не
   хлопает. Ограничение 6 кл/с — телепорт монстра не «взрывает» ткань. */
  let lvx = cy * vx - sy * vz,
    lvz = sy * vx + cy * vz;
  const lm = Math.hypot(lvx, lvz);
  if (lm > 6) {
    lvx *= 6 / lm;
    lvz *= 6 / lm;
  }
  const kW = 1 - Math.exp(-dtc / 0.18);
  K.wvx += (lvx - K.wvx) * kW;
  K.wvz += (lvz - K.wvz) * kW;
  const wK = 0.22 * Math.hypot(K.wvx, K.wvz);
  const wndX = -K.wvx * wK,
    wndZ = -K.wvz * wK; /* имена wnd* — не путать с wx/wz из блока капсул ниже */
  /* коллизийные капсулы в локальной системе — торс, холка, таз, обе ноги ЦЕЛИКОМ и
   обе руки (плечо→локоть→предплечье). Матрицы костей мировые, после skinRig
   этого кадра. */
  const caps = [];
  const cY = Math.cos(yaw),
    sY = Math.sin(yaw);
  const toLp = (x, y, z, out3) => {
    const X = x - S.mx,
      Y = y - (S.monDY || 0),
      Z = z - S.my;
    out3[0] = cY * X - sY * Z;
    out3[1] = Y;
    out3[2] = sY * X + cY * Z;
  };
  const A = [0, 0, 0],
    Bb = [0, 0, 0],
    W0 = [0, 0, 0],
    W1 = [0, 0, 0];
  const BI = n => rig.B[rig.idx[n]].m;
  const off = (m, x, y, z, out3) => {
    out3[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out3[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out3[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  };
  const capP = (p0, p1, r) => {
    toLp(p0[0], p0[1], p0[2], A);
    toLp(p1[0], p1[1], p1[2], Bb);
    caps.push(A[0], A[1], A[2], Bb[0], Bb[1], Bb[2], r);
  };
  const capM = (ma, mb, r) => capP([ma[12], ma[13], ma[14]], [mb[12], mb[13], mb[14]], r);
  const mCh = BI('ch'),
    mHd = BI('hd'),
    mPel = BI('pel');
  capM(mCh, mHd, 0.13);
  off(mCh, 0, 0.15, -0.058, W0);
  off(mCh, 0, 0.245, -0.086, W1);
  capP(W0, W1, 0.078);
  off(mPel, 0, -0.075, 0, W0);
  capP([mPel[12], mPel[13], mPel[14]], W0, 0.095);
  for (const n of ['L', 'R']) {
    const mTh = BI('th' + n),
      mSn = BI('sn' + n),
      mFt = BI('ft' + n),
      mUa = BI('ua' + n),
      mFa = BI('fa' + n);
    capM(mTh, mSn, 0.064);
    capM(mSn, mFt, 0.056);
    capM(mUa, mFa, 0.052);
    off(mFa, 0, -0.19, 0, W0);
    capP([mFa[12], mFa[13], mFa[14]], W0, 0.042);
  }
  if (!K.init) {
    /* первый кадр: колонки ВИСЯТ от креплений в пошитой позе RST, и цель подгонки —
   тоже RST, поэтому старт без щелчка */
    for (let j = 0; j < SKIRT_NU; j++) {
      for (let i2 = 0; i2 < SKIRT_NV; i2++) {
        const o3 = (j * SKIRT_NV + i2) * 3;
        P[o3] = RST[o3];
        P[o3 + 1] = RST[o3 + 1];
        P[o3 + 2] = RST[o3 + 2];
        Q[o3] = P[o3];
        Q[o3 + 1] = P[o3 + 1];
        Q[o3 + 2] = P[o3 + 2];
      }
    }
    K.init = 1;
  }
  /* Верле-интегрирование, 2 подшага на кадр; демпфирование в секунду (не зависит
   от частоты кадров); гравитация честная: 9.81 м/с² = 3.34 клетки. ТЯЖЁЛАЯ ТКАНЬ
   + ВОЗДУХ: линейное демпфирование 0.055/с плюс квадратичное сопротивление — в
   верле-приращениях d·(damp − CDR·|d|), |d| = |v|·h (член устойчив). */
  const SUB = 2,
    h = dtc / SUB,
    h2 = h * h;
  const damp = Math.pow(0.055, h);
  const CDR = 1.5;
  /* коэффициент подгонки на подшаг (не зависит от частоты кадров) */
  const FITK = K.fk || (K.fk = new Float32Array(SKIRT_NV));
  for (let i2 = 0; i2 < SKIRT_NV; i2++) FITK[i2] = 1 - Math.exp(-SKIRT_FIT[i2] * h);
  const g = -3.34;
  const floorY = -(S.monDY || 0) + 0.01; /* настоящий пол в локальной системе ткани */
  for (let s2 = 0; s2 < SUB; s2++) {
    for (let j = 0; j < SKIRT_NU; j++)
      for (let i2 = 1; i2 < SKIRT_NV; i2++) {
        const o3 = (j * SKIRT_NV + i2) * 3;
        const px = P[o3],
          py = P[o3 + 1],
          pz = P[o3 + 2];
        /* верле-приращение с квадратичным сопротивлением воздуха */
        const dxv = px - Q[o3],
          dyv = py - Q[o3 + 1],
          dzv = pz - Q[o3 + 2];
        const sp = Math.sqrt(dxv * dxv + dyv * dyv + dzv * dzv);
        const kv = damp - CDR * sp > 0 ? damp - CDR * sp : 0;
        P[o3] = px + dxv * kv + (-lax * 0.85 + wndX) * h2;
        P[o3 + 1] = py + dyv * kv + g * h2;
        P[o3 + 2] = pz + dzv * kv + (-laz * 0.85 + wndZ) * h2;
        /* мягкая посадка на пошитую позу: гасит болтание и возвращает панель на фигуру
   после порыва или шага; последнее слово за коллизиями ниже. */
        const kF = FITK[i2];
        if (kF > 0) {
          P[o3] += (RST[o3] - P[o3]) * kF;
          P[o3 + 1] += (RST[o3 + 1] - P[o3 + 1]) * kF;
          P[o3 + 2] += (RST[o3 + 2] - P[o3 + 2]) * kF;
        }
        Q[o3] = px;
        Q[o3 + 1] = py;
        Q[o3 + 2] = pz;
      }
    for (let j = 0; j < SKIRT_NU; j++) {
      const o3 = j * SKIRT_NV * 3,
        p3 = j * 3;
      P[o3] = PIN[p3];
      P[o3 + 1] = PIN[p3 + 1];
      P[o3 + 2] = PIN[p3 + 2];
      Q[o3] = P[o3];
      Q[o3 + 1] = P[o3 + 1];
      Q[o3 + 2] = P[o3 + 2];
    }
    /* связи + коллизии, 4 итерации */
    for (let it = 0; it < 4; it++) {
      for (let j = 0; j < SKIRT_NU; j++) {
        /* колонки: структурные отрезки (крепление не двигается — вся фиксация идёт вниз) */
        for (let i2 = 0; i2 < SKIRT_NV - 1; i2++) {
          const a3 = (j * SKIRT_NV + i2) * 3,
            b3 = a3 + 3;
          const dx = P[b3] - P[a3],
            dy = P[b3 + 1] - P[a3 + 1],
            dz = P[b3 + 2] - P[a3 + 2];
          const d = Math.hypot(dx, dy, dz) || 1e-6,
            rest = SKIRT_SEGY[j * (SKIRT_NV - 1) + i2];
          const kf = (d - rest) / d;
          const wa = i2 === 0 ? 0 : 0.42,
            wb = i2 === 0 ? 1 : 0.58;
          P[a3] += dx * kf * wa;
          P[a3 + 1] += dy * kf * wa;
          P[a3 + 2] += dz * kf * wa;
          P[b3] -= dx * kf * wb;
          P[b3 + 1] -= dy * kf * wb;
          P[b3 + 2] -= dz * kf * wb;
        }
        /* ИЗГИБНЫЕ через два ряда — панель держит форму, не сминается в гармошку */
        /* жёстче: панель держит свою плоскость, меньше «тряпочности» */
        for (let i2 = 0; i2 < SKIRT_NV - 2; i2++) {
          const a3 = (j * SKIRT_NV + i2) * 3,
            b3 = a3 + 6;
          const dx = P[b3] - P[a3],
            dy = P[b3 + 1] - P[a3 + 1],
            dz = P[b3 + 2] - P[a3 + 2];
          const d = Math.hypot(dx, dy, dz) || 1e-6,
            rest = SKIRT_SEGB[j * (SKIRT_NV - 2) + i2];
          const kf = ((d - rest) / d) * 0.22;
          const wa = i2 === 0 ? 0 : 0.5,
            wb = i2 === 0 ? 1 : 0.5;
          P[a3] += dx * kf * wa;
          P[a3 + 1] += dy * kf * wa;
          P[a3 + 2] += dz * kf * wa;
          P[b3] -= dx * kf * wb;
          P[b3 + 1] -= dy * kf * wb;
          P[b3 + 2] -= dz * kf * wb;
        }
        /* окружные кольца (закреплённый ряд не участвует) */
        const j2 = (j + 1) % SKIRT_NU;
        for (let i2 = 1; i2 < SKIRT_NV; i2++) {
          const a3 = (j * SKIRT_NV + i2) * 3,
            b3 = (j2 * SKIRT_NV + i2) * 3;
          const dx = P[b3] - P[a3],
            dy = P[b3 + 1] - P[a3 + 1],
            dz = P[b3 + 2] - P[a3 + 2];
          const d = Math.hypot(dx, dy, dz) || 1e-6,
            rest = SKIRT_SEGC[j * SKIRT_NV + i2];
          const kf = ((d - rest) / d) * 0.3;
          P[a3] += dx * kf;
          P[a3 + 1] += dy * kf;
          P[a3 + 2] += dz * kf;
          P[b3] -= dx * kf;
          P[b3 + 1] -= dy * kf;
          P[b3 + 2] -= dz * kf;
        }
      }
      /* коллизии: капсулы фигуры и пол; С ТРЕНИЕМ (тангенциальная скорость гасится):
   плащ остаётся на плечах и холке, не сползает */
      for (let j = 0; j < SKIRT_NU; j++)
        for (let i2 = 1; i2 < SKIRT_NV; i2++) {
          const o3 = (j * SKIRT_NV + i2) * 3;
          for (let c2 = 0; c2 < caps.length; c2 += 7) {
            const ax = caps[c2],
              ay = caps[c2 + 1],
              az = caps[c2 + 2];
            const ex = caps[c2 + 3] - ax,
              ey = caps[c2 + 4] - ay,
              ez = caps[c2 + 5] - az;
            const wx = P[o3] - ax,
              wy = P[o3 + 1] - ay,
              wz = P[o3 + 2] - az;
            const cc = ex * ex + ey * ey + ez * ez || 1e-6;
            let tt = (wx * ex + wy * ey + wz * ez) / cc;
            tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
            const qx = wx - ex * tt,
              qy = wy - ey * tt,
              qz = wz - ez * tt;
            const dd = Math.hypot(qx, qy, qz),
              rr = caps[c2 + 6];
            if (dd < rr && dd > 1e-6) {
              const k = (rr - dd) / dd;
              P[o3] += qx * k;
              P[o3 + 1] += qy * k;
              P[o3 + 2] += qz * k;
              const nx = qx / dd,
                ny = qy / dd,
                nz = qz / dd;
              const vx2 = P[o3] - Q[o3],
                vy2 = P[o3 + 1] - Q[o3 + 1],
                vz2 = P[o3 + 2] - Q[o3 + 2];
              const vn = vx2 * nx + vy2 * ny + vz2 * nz;
              Q[o3] += (vx2 - nx * vn) * 0.05;
              Q[o3 + 1] += (vy2 - ny * vn) * 0.05;
              Q[o3 + 2] += (vz2 - nz * vn) * 0.05;
            }
          }
          if (P[o3 + 1] < floorY) {
            P[o3 + 1] = floorY;
            Q[o3] += (P[o3] - Q[o3]) * 0.3;
            Q[o3 + 2] += (P[o3 + 2] - Q[o3 + 2]) * 0.3;
          }
        }
    }
  }
  return 0;
}
function skirtBuild(rig) {
  /* вершины triangle-list из узлов; нормали — от соседних узлов по сетке. AO
   темнеет к подолу — складки нижней части панели читаются как глубина. */
  const K = GPU.skirt,
    P = K.p,
    out = GPU.skirtArr;
  let o = 0;
  const at = (j, i2) =>
    (((j % SKIRT_NU) + SKIRT_NU) % SKIRT_NU) * SKIRT_NV +
    (i2 < 0 ? 0 : i2 > SKIRT_NV - 1 ? SKIRT_NV - 1 : i2);
  const NRM = new Float32Array(SKIRT_NU * SKIRT_NV * 3);
  for (let j = 0; j < SKIRT_NU; j++)
    for (let i2 = 0; i2 < SKIRT_NV; i2++) {
      const a3 = at(j, i2) * 3,
        b3 = at(j + 1, i2) * 3,
        c3 = at(j - 1, i2) * 3,
        d3 = at(j, i2 + 1) * 3,
        e3 = at(j, i2 - 1) * 3;
      const ux = P[b3] - P[c3],
        uy = P[b3 + 1] - P[c3 + 1],
        uz = P[b3 + 2] - P[c3 + 2];
      const vx2 = P[d3] - P[e3],
        vy2 = P[d3 + 1] - P[e3 + 1],
        vz2 = P[d3 + 2] - P[e3 + 2];
      let nx = uy * vz2 - uz * vy2,
        ny = uz * vx2 - ux * vz2,
        nz = ux * vy2 - uy * vx2;
      const l = Math.hypot(nx, ny, nz) || 1;
      const o3 = at(j, i2) * 3;
      nx /= l;
      ny /= l;
      nz /= l;
      /* наружу от оси плаща (иначе ткань освещалась бы «изнутри») */
      const rx = P[o3],
        rz = P[o3 + 2];
      const rl = Math.hypot(rx, rz) || 1e-6;
      if (nx * (rx / rl) + nz * (rz / rl) < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      NRM[o3] = nx;
      NRM[o3 + 1] = ny;
      NRM[o3 + 2] = nz;
    }
  const push = (j, i2) => {
    const a3 = at(j, i2) * 3;
    out[o++] = P[a3];
    out[o++] = P[a3 + 1];
    out[o++] = P[a3 + 2];
    out[o++] = 0.02 + (0.48 - 0.02) * (j / SKIRT_NU);
    out[o++] = 0.02 + (0.98 - 0.02) * (i2 / (SKIRT_NV - 1));
    out[o++] = NRM[a3];
    out[o++] = NRM[a3 + 1];
    out[o++] = NRM[a3 + 2];
    out[o++] = 0.34 - 0.12 * (i2 / (SKIRT_NV - 1));
  };
  for (let j = 0; j < SKIRT_NU; j++)
    for (let i2 = 0; i2 < SKIRT_NV - 1; i2++) {
      push(j, i2);
      push(j + 1, i2);
      push(j + 1, i2 + 1);
      push(j, i2);
      push(j + 1, i2 + 1);
      push(j, i2 + 1);
    }
  return o / 9;
}

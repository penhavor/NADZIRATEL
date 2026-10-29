/* капсулы скелета для карты теней: игрок + Монитор. Радиусы — 0.85 от видимых,
   чтобы самозатенение не «съедало» освещённую сторону тела.
   offA — смещение начала отрезка от кости (кисть от запястья). Капсулы монстра
   стоят ПОСЛЕ капсул игрока — порядок фиксируют nMon/nPl: слот фонаря берёт
   монстра и реквизит, но не тело игрока. */
function collectShadowCaps(S, bodyP, mPose, rootM) {
  const out = [];
  const K = 0.85;
  const cap = (M, a, b, r, offB, offA) => {
    const A = M[a];
    if (!A) return;
    const ox = A[12],
      oy = A[13],
      oz = A[14];
    let Ax = ox,
      Ay = oy,
      Az = oz;
    if (offA) {
      Ax += A[0] * offA[0] + A[4] * offA[1] + A[8] * offA[2];
      Ay += A[1] * offA[0] + A[5] * offA[1] + A[9] * offA[2];
      Az += A[2] * offA[0] + A[6] * offA[1] + A[10] * offA[2];
    }
    let Bx, By, Bz;
    if (b) {
      const Bm = M[b];
      if (!Bm) return;
      Bx = Bm[12];
      By = Bm[13];
      Bz = Bm[14];
    } else if (offB) {
      Bx = ox + A[0] * offB[0] + A[4] * offB[1] + A[8] * offB[2];
      By = oy + A[1] * offB[0] + A[5] * offB[1] + A[9] * offB[2];
      Bz = oz + A[2] * offB[0] + A[6] * offB[1] + A[10] * offB[2];
    } else return;
    out.push([Ax, Ay, Az, Bx, By, Bz, r * K]);
  };
  if (mPose && GPU.rig) {
    const MN = [
      'pel',
      'ch',
      'hd',
      'uaL',
      'faL',
      'uaR',
      'faR',
      'thL',
      'snL',
      'ftL',
      'thR',
      'snR',
      'ftR'
    ];
    const M = fkChain(GPU.rig, mPose, rootM, MN);
    cap(M, 'pel', 'ch', 0.105);
    cap(M, 'ch', 'hd', 0.1);
    cap(M, 'hd', null, 0.062, [0, 0.1, 0.03]);
    for (const n of ['L', 'R']) {
      cap(M, 'ua' + n, 'fa' + n, 0.04);
      cap(M, 'fa' + n, null, 0.028, [0, -0.17, 0]); /* предплечье */
      cap(M, 'fa' + n, null, 0.036, [0, -0.33, 0.055], [0, -0.185, 0]); /* ладонь + когти */
      cap(M, 'th' + n, 'sn' + n, 0.05);
      cap(M, 'sn' + n, 'ft' + n, 0.038);
      cap(M, 'ft' + n, null, 0.034, [0, 0, 0.1]);
    }
    /* плащ отбрасывает тень — вертикальные капсулы вдоль боковых и спинной панелей
   (узлы ткани локальны к корню → в мир через rootM) */
    if (GPU.skirt && GPU.skirt.init && GPU.skirt.p && rootM) {
      const SP = GPU.skirt.p;
      for (const j of [4, 8, 10, 12, 16]) {
        const a3 = (j * SKIRT_NV + 1) * 3,
          b3 = (j * SKIRT_NV + SKIRT_NV - 2) * 3;
        const x0 = rootM[0] * SP[a3] + rootM[4] * SP[a3 + 1] + rootM[8] * SP[a3 + 2] + rootM[12];
        const y0 = rootM[1] * SP[a3] + rootM[5] * SP[a3 + 1] + rootM[9] * SP[a3 + 2] + rootM[13];
        const z0 = rootM[2] * SP[a3] + rootM[6] * SP[a3 + 1] + rootM[10] * SP[a3 + 2] + rootM[14];
        const x1 = rootM[0] * SP[b3] + rootM[4] * SP[b3 + 1] + rootM[8] * SP[b3 + 2] + rootM[12];
        const y1 = rootM[1] * SP[b3] + rootM[5] * SP[b3 + 1] + rootM[9] * SP[b3 + 2] + rootM[13];
        const z1 = rootM[2] * SP[b3] + rootM[6] * SP[b3 + 1] + rootM[10] * SP[b3 + 2] + rootM[14];
        out.push([x0, y0, z0, x1, y1, z1, 0.062 * K]);
      }
    }
  }
  out.nMon = out.length; /* капсулы монстра идут первыми — тени фонаря берут только их */
  if (bodyP && GPU.plRig) {
    const bYaw = -(S.pYawVis === undefined ? S.ang : S.pYawVis) - Math.PI / 2;
    const prm = m4mul(m4t(S.px, bodyP.dy * PL_SCALE, S.py), m4mul(m4rotY(bYaw), m4sc(PL_SCALE)));
    const PN = [
      'pel',
      'ch',
      'nk',
      'hd',
      'uaL',
      'faL',
      'haL',
      'uaR',
      'faR',
      'haR',
      'thL',
      'snL',
      'ftL',
      'thR',
      'snR',
      'ftR'
    ];
    const M = fkChain(GPU.plRig, bodyP.pose, prm, PN);
    const cp = (a, b, r, offB) => {
      const A = M[a];
      if (!A) return;
      let Bx, By, Bz;
      if (b) {
        const Bm = M[b];
        if (!Bm) return;
        Bx = Bm[12];
        By = Bm[13];
        Bz = Bm[14];
      } else if (offB) {
        Bx = A[12] + (A[0] * offB[0] + A[4] * offB[1] + A[8] * offB[2]) * PL_SCALE;
        By = A[13] + (A[1] * offB[0] + A[5] * offB[1] + A[9] * offB[2]) * PL_SCALE;
        Bz = A[14] + (A[2] * offB[0] + A[6] * offB[1] + A[10] * offB[2]) * PL_SCALE;
      } else return;
      out.push([A[12], A[13], A[14], Bx, By, Bz, r * PL_SCALE * K]);
    };
    cp('pel', 'ch', 0.15);
    cp('ch', 'nk', 0.13);
    cp('nk', 'hd', 0.085);
    cp('hd', null, 0.095, [0, 0.1, 0]);
    for (const n of ['L', 'R']) {
      cp('ua' + n, 'fa' + n, 0.058);
      cp('fa' + n, 'ha' + n, 0.046);
      cp('th' + n, 'sn' + n, 0.085);
      cp('sn' + n, 'ft' + n, 0.062);
      cp('ft' + n, null, 0.055, [0, 0, -0.09]);
    }
  }
  out.nPl = out.length - out.nMon;
  if (out.length < CAPS_MAX - 8) {
    /* Мебель отбрасывает тени: шкаф и стол аппроксимируются капсулами по габаритам
   модели (локальная +Z → (wx,wz) «к стене», +X → (wz,−wx)). */
    const cap = (cx, cz, wx, wz, lx0, ly0, lz0, lx1, ly1, lz1, r) => {
      if (out.length >= CAPS_MAX) return;
      out.push([
        cx + lx0 * wz + lz0 * wx,
        ly0,
        cz - lx0 * wx + lz0 * wz,
        cx + lx1 * wz + lz1 * wx,
        ly1,
        cz - lx1 * wx + lz1 * wz,
        r
      ]);
    };

    for (const c of S.cabs || []) {
      if (out.length >= CAPS_MAX - 8) break;
      const cx = c.x + 0.5 + c.wx * (0.5 - CAB_D / 2),
        cz = c.y + 0.5 + c.wy * (0.5 - CAB_D / 2);
      /* корпус шкафа — ТОНКОСТЕННАЯ оболочка, а не сплошной ящик: толстые капсулы
   перекрывали проём и затеняли открытый ящик изнутри. Фасад закрывается капсулами
   только пока ящик задвинут. Каждая капсула касается граней только ИЗНУТРИ:
   концевая сфера, высунувшаяся за плоскость грани, рисует чёрный дисковый след
   тени (точка «внутри окклюдера» → vis 0). У закрытого ядра ось укорочена до
   ±0.004 (сферы до ±0.144); у открытого — ядро касается граней полости, труба
   утоплена. */
      const op = c.open || 0;
      cap(cx, cz, c.wx, c.wy, -0.161, 0.032, 0, -0.161, 0.29, 0, 0.009);
      cap(cx, cz, c.wx, c.wy, 0.161, 0.032, 0, 0.161, 0.29, 0, 0.009);
      cap(cx, cz, c.wx, c.wy, -0.16, 0.2935, 0, 0.16, 0.2935, 0, 0.0085);
      cap(cx, cz, c.wx, c.wy, -0.145, 0.029, 0, 0.145, 0.029, 0, 0.009);
      if (op < 0.3) {
        /* ядро закрытого корпуса: полость скрыта ящиком, выступ наружу не виден */
        cap(cx, cz, c.wx, c.wy, -0.004, 0.16, 0.081, 0.004, 0.16, 0.081, 0.14);
        cap(cx, cz, c.wx, c.wy, -0.075, 0.06, -0.09, -0.075, 0.226, -0.09, 0.008);
        cap(cx, cz, c.wx, c.wy, 0.0, 0.06, -0.09, 0.0, 0.226, -0.09, 0.008);
        cap(cx, cz, c.wx, c.wy, 0.075, 0.06, -0.09, 0.075, 0.226, -0.09, 0.008);
      } else {
        /* ядро открытого ящика: труба касается граней полости и утоплена в заднюю или
   боковую стенку — воздух полости чист, свет входит честно. */
        cap(cx, cz, c.wx, c.wy, -0.046, 0.14, 0.17, 0.046, 0.14, 0.17, 0.098);
        cap(cx, cz, c.wx, c.wy, -0.135, 0.14, 0.081, 0.135, 0.14, 0.081, 0.009);
      }
    }
    if (S.table && out.length < CAPS_MAX - 16) {
      const t = S.table;
      const cx = t.x + 0.5 + t.wx * (0.5 - TBL_D / 2),
        cz = t.y + 0.5 + t.wy * (0.5 - TBL_D / 2);
      /* Стол НЕ сплошной ящик: толстые капсулы boxCaps заполняли проём под
   столешницей («точка внутри окклюдера» → vis 0): чёрная дыра в проёме и клякса
   тени вместо силуэта. Столешница — цепочка перекрывающихся сфер ВНУТРИ плиты
   (верхнюю грань не протыкают: сфера до y=0.247 при столешнице на 0.256),
   ножки — тонкие трубы внутри сечения (бока не протыкают). */
      for (let i = 0; i < 12; i++) {
        const lz = -0.11 + 0.22 * (i / 11);
        cap(cx, cz, t.wx, t.wy, -0.19, 0.236, lz, 0.19, 0.236, lz, 0.011);
      }
      for (const lx of [-0.185, 0.185])
        for (const lz of [-0.095, 0.095])
          cap(cx, cz, t.wx, t.wy, lx, 0.0095, lz, lx, 0.24, lz, 0.009);
    }
  }
  return out;
}

/* БИОМЕХАНИЧЕСКАЯ ИНВЕРСИЯ: клипы пишут наклоны в конвенции +Z, риг смотрит в
   −Z — знак переворачивается здесь, на границе «клип→поза». Вьюмодель уже пишет
   углы в новой конвенции; пальцы и челюсть соответствуют геометрии. */
const PL_FLIP = {
  pel: 1,
  spn: 1,
  ch: 1,
  nk: 1,
  hd: 1,
  shL: 1,
  shR: 1,
  uaL: 1,
  uaR: 1,
  faL: 1,
  faR: 1,
  haL: 1,
  haR: 1,
  thL: 1,
  thR: 1,
  snL: 1,
  snR: 1,
  ftL: 1,
  ftR: 1
};
const cpPose = q => {
  const o = {};
  for (const k in q) {
    const v = q[k];
    if (v && v.length === 3) o[k] = [v[0], v[1], v[2]];
  }
  return o;
};
function playerPose(st, t, slot) {
  st = st || {};
  const auto = playerAutoAnim(st);
  const want = st.pAnimWant || auto;
  const k = st.pAnimK === undefined ? 1 : st.pAnimK;
  const A = {
    ph: st.animPhase || 0,
    cr: st.crC !== undefined ? st.crC : st.pCrouch || 0,
    mv: Math.min(1, st.bobA || 0),
    fp: slot === 'fp' ? 1 : 0
  }; /* cr — crouchify; mv — затухание взгляда; fp — вьюмодель; cr сглажен (crC) */
  /* СМЕШИВАНИЕ ИЗ СНИМКА ПОЗЫ: источник = снимок на момент переключения ПЛЮС
   дельта движения предыдущего клипа в его собственном масштабе — поза и скорость
   остаются непрерывными. Снимки отдельные для тела и вьюмодели (слот), иначе
   стойка руки от первого лица смешалась бы с телом. */
  const SB =
    st[slot === 'fp' ? '_snapFP' : '_snapB'] || (st[slot === 'fp' ? '_snapFP' : '_snapB'] = {});
  const wres = poseFromClip(want, t, A, st.pAnimT0);
  const wp = wres.pose;
  for (const bn in PL_FLIP) {
    const a = wp[bn];
    if (a) a[0] = -a[0];
  } /* клип → новая конвенция */
  let p, dy;
  if (SB.pose && k < 1) {
    const e = sm(k);
    const bk = (st.pAnimPrev || '') + '@' + (st.pAnimPrevT0 || 0);
    const prNow = poseFromClip(st.pAnimPrev, t, A, st.pAnimPrevT0, true);
    if (SB.bsKey !== bk) {
      SB.bsKey = bk;
      SB.bsPose = prNow.pose;
      SB.bsDy = prNow.dy;
      SB.bsSnap = SB.pose;
      SB.bsSnapDy = SB.dy;
    }
    const d0 = prNow.pose,
      b0 = SB.bsPose,
      s0 = SB.bsSnap,
      keys = {};
    for (const q in d0) keys[q] = 1;
    for (const q in b0) keys[q] = 1;
    for (const q in s0) keys[q] = 1;
    const src = {};
    for (const key in keys) {
      const s = s0[key];
      if (!s || s.length !== 3) continue;
      const d = d0[key],
        b = b0[key];
      const dx = (d && d.length === 3 ? d[0] : 0) - (b && b.length === 3 ? b[0] : 0);
      const dyv = (d && d.length === 3 ? d[1] : 0) - (b && b.length === 3 ? b[1] : 0);
      const dz = (d && d.length === 3 ? d[2] : 0) - (b && b.length === 3 ? b[2] : 0);
      const fx = PL_FLIP[key] ? -1 : 1; /* дельта наклона — в конвенцию итоговой позы */
      src[key] = [s[0] + dx * fx, s[1] + dyv, s[2] + dz];
    }
    const srcDy = SB.bsSnapDy + (prNow.dy - SB.bsDy);
    p = {};
    for (const key in keys) {
      const a2 = src[key],
        b2 = wp[key];
      const av = a2 || b2,
        bv = b2 || a2;
      if (!av) continue; /* односторонний ключ — держим постоянным, не гасим в ноль */
      p[key] = [
        av[0] + (bv[0] - av[0]) * e,
        av[1] + (bv[1] - av[1]) * e,
        av[2] + (bv[2] - av[2]) * e
      ];
    }
    dy = srcDy + (wres.dy - srcDy) * e;
  } else {
    p = wp;
    dy = wres.dy;
  }
  const lp = clp(st.pitch || 0, -1.1, 1.1),
    ly = clp(st.pLookYaw || 0, -0.9, 0.9);
  /* знаки аддитивных наклонов согласованы с геометрией (взгляд вверх поднимает лицо) */
  p.nk = [p.nk[0] + lp * 0.3, p.nk[1] + ly * 0.3, p.nk[2]];
  p.hd = [p.hd[0] + lp * 0.55, p.hd[1] + ly * 0.55, p.hd[2] - ly * 0.12];
  /* ГАРАНТИЯ ЛИЦА: суммарный поворот головы и шеи относительно груди ограничен
   человеческим диапазоном (рыскание ≤ ±46°, наклон −29°…+46°) — сторона, куда
   сгибаются руки, никогда не окажется затылком, ни в одном клипе и ни в одном
   смешивании. */
  {
    const yawNet = p.ch[1] + p.nk[1] + p.hd[1],
      YL = 0.8;
    if (yawNet > YL || yawNet < -YL) {
      const d = yawNet - clp(yawNet, -YL, YL);
      p.nk[1] -= d * 0.35;
      p.hd[1] -= d * 0.65;
    }
    const pitNet = p.spn[0] + p.ch[0] + p.nk[0] + p.hd[0],
      PD = -0.8,
      PU = 0.5;
    if (pitNet < PD || pitNet > PU) {
      const d = pitNet - clp(pitNet, PD, PU);
      p.nk[0] -= d * 0.35;
      p.hd[0] -= d * 0.65;
    }
  }
  /* УСТАЛОСТЬ БЕЗ ТРЯСКИ: плавная огибающая, тяжёлое дыхание ~0.3 Гц малой
   амплитуды, стук челюсти и амплитуда ×2 при изнеможении, сутулость. */
  const exT = clp(1 - (st.stam === undefined ? 1 : st.stam), 0, 1) * (st.exhausted ? 1 : 0.5);
  const dte = clp(t - (st._exT === undefined ? t : st._exT), 0, 0.1);
  st._exT = t;
  const ex =
    (st._exS === undefined ? 0 : st._exS) + (exT - (st._exS || 0)) * Math.min(1, dte * 1.6);
  st._exS = ex;
  /* ФАЗА ДЫХАНИЯ НАКАПЛИВАЕТСЯ (∫ω·dt): частота 0.27…0.4 Гц меняется плавно, фаза
   непрерывна — при скачке показателя (границы выносливости, изнеможение) дыхание
   не вырождается в высокочастотный тремор. */
  st._exPh = (st._exPh || 0) + dte * (1.7 + 0.8 * ex);
  if (ex > 0.02) {
    const br = Math.sin(st._exPh);
    const exh = Math.max(0, br) * Math.max(0, br);
    p.ch = [p.ch[0] + 0.02 * ex * br, p.ch[1], p.ch[2]];
    p.spn = [p.spn[0] + 0.01 * ex * br - 0.055 * ex, p.spn[1], p.spn[2]];
    p.hd = [p.hd[0] - 0.01 * ex * br - 0.045 * ex, p.hd[1], p.hd[2]];
    p.jaw = [p.jaw[0] - 0.045 * ex * exh, 0, 0];
    p.uaL = [p.uaL[0] + 0.035 * ex * br, 0, p.uaL[2] + 0.1 * ex];
    p.uaR = [p.uaR[0] + 0.035 * ex * br, 0, p.uaR[2] - 0.1 * ex];
    p.shL = [0, 0, 0.05 * ex];
    p.shR = [0, 0, -0.05 * ex];
  }
  /* ПРАВКА ОПОРЫ: dy клипа считается в пространстве клипа (до PL_FLIP), рисуемая
   поза — после инверсии; для несимметричных стоп footLowest(rig) ≠
   footLowest(clip). Дельта двух замеров на итоговой позе добавляется к dy. */
  {
    const uf = {};
    for (const k of ['pel', 'thL', 'snL', 'ftL', 'thR', 'snR', 'ftR']) {
      const a = p[k];
      uf[k] = a ? [-a[0], a[1], a[2]] : [0, 0, 0];
    }
    dy += footLowest(uf) - footLowest(p);
  }
  SB.pose = cpPose(p);
  SB.dy = dy; /* источник смешивания для следующего кадра; снимок делается ДО expandHands: он
   добавляет поворот ладони к haL АДДИТИВНО — снимок после него удвоил бы поворот. */
  expandHands(p);
  /* ТРЕТЬЕ ЛИЦО: с фонарём правая рука поднята (луч ~10° вперёд-вниз), во время
   замены батарейки обе руки перед телом.
   _holdK ограничивается по скорости в GPU.frame, а снимок смешивания берётся ДО
   этих дельт — включение стойки плавное. */
  if (st.fl && st.fl.owned) {
    const rlNow = st.fl.rl > 0;
    const L2 = (a, b, k) => a + (b - a) * k;
    if (!rlNow) {
      const hk = clp(st._holdK || 0, 0, 1);
      if (hk > 0.001) {
        p.shL = [0, 0, L2(p.shL[2], 0.1, hk)];
        p.uaL = [L2(p.uaL[0], 0.7, hk), L2(p.uaL[1], -0.1, hk), L2(p.uaL[2], 0.22, hk)];
        p.faL = [L2(p.faL[0], 1.45, hk), L2(p.faL[1], 0.3, hk), L2(p.faL[2], -0.1, hk)];
        gripHand(
          p,
          'L',
          [L2(p.haL[0], -0.34, hk), L2(p.haL[1], -1.04, hk), L2(p.haL[2], -1.01, hk)],
          0.9 + (3.06 - 0.9) * hk,
          0.02,
          GRIP_THUMB,
          hk
        ); /* ось кулака вдоль луча, ~10° вперёд-вниз */
      }
    } else {
      const u = clp((t - (st.fl.rlT0 || 0)) / RL_DUR, 0, 1);
      const env = Math.sin(Math.PI * Math.min(1, u * 1.05));
      const k = 0.85 * env;
      p.shL = [0, 0, L2(p.shL[2], 0.12, k)];
      p.shR = [0, 0, L2(p.shR[2], -0.12, k)];
      p.uaL = [L2(p.uaL[0], 0.85, k), L2(p.uaL[1], -0.15, k), L2(p.uaL[2], 0.25, k)];
      p.faL = [L2(p.faL[0], 1.6, k), L2(p.faL[1], 0.32, k), L2(p.faL[2], -0.15, k)];
      p.uaR = [L2(p.uaR[0], 0.8, k), L2(p.uaR[1], 0.15, k), L2(p.uaR[2], -0.28, k)];
      p.faR = [L2(p.faR[0], 1.65, k), L2(p.faR[1], -0.34, k), L2(p.faR[2], 0.16, k)];
      gripHand(
        p,
        'L',
        [L2(p.haL[0], 0.1, k), L2(p.haL[1], -0.5, k), L2(p.haL[2], -0.3, k)],
        1.08,
        0.02
      );
      gripHand(
        p,
        'R',
        [L2(p.haR[0], 0.1, k), L2(p.haR[1], 0.5, k), L2(p.haR[2], 0.3, k)],
        0.95,
        0.1
      );
    }
  }
  /* ТРЕТЬЕ ЛИЦО, щипок: ключ или батарейка в правой руке — рука поднята к груди,
   пальцы в PINCH_POSE (предмет держит тот же ЗАХВАТ, что и от первого лица) */
  {
    const hk2 = clp(st._pinchK || 0, 0, 1);
    if (hk2 > 0.001 && !(st.fl && st.fl.rl > 0)) {
      const L2 = (a, b, k) => a + (b - a) * k;
      p.shL = [0, 0, L2(p.shL[2], 0.08, hk2)];
      p.uaL = [L2(p.uaL[0], 0.78, hk2), L2(p.uaL[1], -0.12, hk2), L2(p.uaL[2], 0.2, hk2)];
      p.faL = [L2(p.faL[0], 1.55, hk2), L2(p.faL[1], 0.3, hk2), L2(p.faL[2], -0.1, hk2)];
      p.haL = [L2(p.haL[0], -0.45, hk2), L2(p.haL[1], -1.2, hk2), L2(p.haL[2], 0.1, hk2)];
      for (const q in PINCH_POSE) {
        const b = q + 'L',
          T = PINCH_POSE[q];
        p[b] = [L2(p[b][0], T[0], hk2), L2(p[b][1], T[1], hk2), L2(p[b][2], T[2], hk2)];
      }
    }
  }
  /* СМЕНА ПРЕДМЕТА (st.sw): тело повторяет провал вьюмодели «рука вниз — вверх»
   (см. playerPoseFP). Без него предмет телепортировался бы в руку в отражении
   лужи и от третьего лица без прикрывающей анимации. Применяется ПОСЛЕ поз
   захвата — во время провала они не переопределяют опускание руки. */
  if (slot !== 'fp' && st.sw && st.sw.dur > 0) {
    const dipB = Math.sin(Math.PI * clp((t - st.sw.t0) / st.sw.dur, 0, 1));
    if (dipB > 0.001) {
      const L2 = (a, b, k) => a + (b - a) * k;
      p.shL = [p.shL[0], p.shL[1], L2(p.shL[2], 0.05, dipB)];
      p.uaL = [L2(p.uaL[0], -0.3, dipB), L2(p.uaL[1], 0.1, dipB), L2(p.uaL[2], 0.2, dipB)];
      p.faL = [L2(p.faL[0], -0.12, dipB), L2(p.faL[1], 0.02, dipB), L2(p.faL[2], 0.1, dipB)];
    }
  }
  return { pose: p, dy: dy, anim: want };
}
function skinRigEx(rig, pose, rootM, out, hide) {
  let o = 0;
  for (let i = 0; i < rig.B.length; i++) {
    const b = rig.B[i],
      rt = (pose && pose[rig.names[i]]) || [0, 0, 0];
    const local = m4mul(
      m4t(b.off[0], b.off[1], b.off[2]),
      m4mul(m4rotY(rt[1]), m4mul(m4rotX(rt[0]), m4rotZ(rt[2])))
    );
    b.m = b.parent < 0 ? m4mul(rootM, local) : m4mul(rig.B[b.parent].m, local);
    /* ВАЖНО: корень нельзя вырождать — потомки считаются из его матрицы. Скрытая
   кость не пишет вершины, но матрицу сохраняет, иначе иерархия ниже «обнуляется»
   (руки, если скрыт торс). */
    if (hide && hide[i]) {
      if (b.parent >= 0) continue;
    }
    const M = b.m,
      v = b.v;
    for (let k = 0; k < v.length; k += 9) {
      const x = v[k],
        y = v[k + 1],
        z = v[k + 2];
      out[o++] = M[0] * x + M[4] * y + M[8] * z + M[12];
      out[o++] = M[1] * x + M[5] * y + M[9] * z + M[13];
      out[o++] = M[2] * x + M[6] * y + M[10] * z + M[14];
      out[o++] = v[k + 3];
      out[o++] = v[k + 4];
      const nx = v[k + 5],
        ny = v[k + 6],
        nz = v[k + 7];
      const lx = M[0] * nx + M[4] * ny + M[8] * nz,
        ly = M[1] * nx + M[5] * ny + M[9] * nz,
        lz = M[2] * nx + M[6] * ny + M[10] * nz;
      const ll = Math.hypot(lx, ly, lz) || 1;
      out[o++] = lx / ll;
      out[o++] = ly / ll;
      out[o++] = lz / ll;
      out[o++] = v[k + 8];
    }
  }
  return (o / 9) | 0;
}

/* =============== GPU-СКИННИНГ ================
   skinRigEx остаётся для dev-тестов; кадр использует fkAll (матрицы костей на
   CPU — нужны капсулам теней, предмету в руке, глазам и высоте камеры) + compute
   csSkin (преобразование вершин на GPU, см. WGS_SKIN). */
function fkAll(rig, pose, rootM) {
  for (let i = 0; i < rig.B.length; i++) {
    const b = rig.B[i],
      rt = (pose && pose[rig.names[i]]) || [0, 0, 0];
    const local = m4mul(
      m4t(b.off[0], b.off[1], b.off[2]),
      m4mul(m4rotY(rt[1]), m4mul(m4rotX(rt[0]), m4rotZ(rt[2])))
    );
    b.m = b.parent < 0 ? m4mul(rootM, local) : m4mul(rig.B[b.parent].m, local);
  }
}
/* статические данные рига для csSkin: вершины в одном буфере + индекс кости */
function rigSrcData(rig) {
  const src = new Float32Array(rig.total * 9),
    bi = new Uint32Array(rig.total);
  let o = 0,
    vi = 0;
  for (let i = 0; i < rig.B.length; i++) {
    const b = rig.B[i];
    src.set(b.v, o);
    for (let k = 0; k < b.n; k++) bi[vi + k] = i;
    o += b.n * 9;
    vi += b.n;
  }
  return { src: src, bi: bi };
}
function rigVisCount(rig, hide) {
  if (!hide) return rig.total;
  let n = 0;
  for (let i = 0; i < rig.B.length; i++) if (!hide[i]) n += rig.B[i].n;
  return n;
}
/* упаковка матриц костей и флагов скрытия в staging + writeBuffer;
   сам диспатч csSkin выполняется в compute-проходе кадра (после всех записей
   юниформ) */
function skinUp(I, hide) {
  const B = I.rig.B,
    f = I.f32,
    u = I.u32;
  f.fill(0);
  u.fill(0);
  for (let i = 0; i < B.length; i++) {
    f.set(B[i].m, i * 16);
    u[i] = hide && hide[i] ? 1 : 0;
  }
  dev.queue.writeBuffer(I.bones, 0, I.bb);
}

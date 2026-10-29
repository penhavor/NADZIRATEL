let lampScratch =
  []; /* переиспользуемые записи: на карте 100×100 тысячи ламп — покадровое выделение
   кормило бы только сборщик мусора */
function collectLamps(S, out) {
  const near = lampScratch,
    L = S.lamps.length;
  while (near.length < L) near.push({ l: null, d: 0, r: 3.2 });
  near.length = L;
  for (let i = 0; i < L; i++) {
    const e = near[i],
      l = S.lamps[i];
    e.l = l;
    e.d = Math.hypot(l.x - S.px, l.y - S.py);
    e.r = 3.2;
  }
  near.sort((a, b) => a.d - b.d);
  const n = Math.min(Q.lamps, L);
  for (let i = 0; i < n; i++) {
    const e = near[i];
    out[i * 4] = e.l.x + 0.5;
    out[i * 4 + 1] = e.l.y + 0.5;
    out[i * 4 + 2] = e.r;
    out[i * 4 + 3] = e.l.I * 0.85;
  }
  return n;
}

const SHW_MAX = 512,
  SH_ROWS_MAX = 128;
/* Высотная угловая карта теней (compute csShadow): лучи каждой лампы идут по
   кругу (shSteps колонок) И по подъёму (shRows полос). Карта хранит
   ГОРИЗОНТАЛЬНОЕ расстояние до окклюдера (r16float; «окклюдера нет» = 1.0).
   Перегораживают: стены (точный вход на границе плиты — иначе освещённые стены
   «кусают сами себя»), дверная створка, скелет, плащ и капсулы реквизита. */
const SH_EL0 = 1.3523,
  SH_EL1 = 0.6545; /* нижняя и верхняя границы диапазона подъёма (рад, нижняя отрицательная) */
const CAPS_MAX = 160,
  SEGS_MAX = 16,
  SHL_MAX = 64;
let capsArr = new Float32Array(CAPS_MAX * 7);
let segArr = new Float32Array(SEGS_MAX * 4);
let lshArr = new Float32Array(SHL_MAX * 4 + 8); /* лампы + фонарь для csShadow */
/* дверная створка (анимированная) — отрезки для карты теней, каждый кадр */
function collectDoorSegs(S, out) {
  let n = 0;
  const addLeaf = (D, open) => {
    if (!D || n >= SEGS_MAX)
      return; /* закрытая створка тоже: отрезок даёт карте теней точную плоскость полотна */
    const e = open > 1 ? 1 : open,
      ee = e * e * (3 - 2 * e),
      a = D.yaw + D.aOpen * ee;
    /* направление створки — буквально как в модели: m4rotY отображает локальную +X в
   (cos a, −sin a); знак +sin превращал отрезок открытой створки в стену за
   петлёй — фантомная вертикальная тень. */
    out[n * 4] = D.hx;
    out[n * 4 + 1] = D.hz;
    out[n * 4 + 2] = D.hx + Math.cos(a);
    out[n * 4 + 3] = D.hz - Math.sin(a);
    n++;
  };
  addLeaf(GPU.DR && GPU.DR.exit, S.doorLeafT || 0);
  if (GPU.DR) {
    const ds = S.doorState,
      W = S.W;
    for (const sd of GPU.DR.safe) addLeaf(sd, ds ? ds[sd.y * W + sd.x] : 0);
  }
  return n;
}
/* состояние карты в одном u32-буфере: значение клетки + бит открытой двери.
   Общее для теней и поля облучённости; строится один раз за кадр (~1 тыс. клеток). */
function collectGridU32(S, out) {
  const n = S.W * S.H,
    g = S.grid,
    ds = S.doorState;
  for (let i = 0; i < n; i++) {
    const v = g[i];
    out[i] = (v | (v === 3 && ds && ds[i] > 0.5 ? 4 : 0)) >>> 0;
  }
  return n;
}

/* Маска ламп на клетку (2×u32 = до 64 слотов): бит i установлен, если радиус
   света лампы i достаёт до клетки (2D-расстояние точка→квадрат клетки). В fsWorld
   пиксель перебирает только биты своей клетки — набор света строго тот же: для
   ламп вне маски dist>L.z в любой точке клетки (3D-расстояние только больше 2D). */
function buildCellLightMask(S, lamps, n, out) {
  out.fill(0);
  const W = S.W,
    H = S.H;
  const nn = Math.min(n, 64);
  for (let i = 0; i < nn; i++) {
    if (lamps[i * 4 + 3] <= 0.001) continue;
    const lx = lamps[i * 4],
      lz = lamps[i * 4 + 1],
      R = lamps[i * 4 + 2],
      R2 = R * R;
    const x0 = Math.max(0, Math.floor(lx - R)),
      x1 = Math.min(W - 1, Math.ceil(lx + R));
    const y0 = Math.max(0, Math.floor(lz - R)),
      y1 = Math.min(H - 1, Math.ceil(lz + R));
    const bit = 1 << (i & 31),
      word = (i >> 5) & 1;
    for (let y = y0; y <= y1; y++) {
      const dy = y > lz ? y - lz : lz > y + 1 ? y + 1 - lz : 0,
        dy2 = dy * dy;
      if (dy2 > R2) continue;
      const row = y * W * 2 + word;
      for (let x = x0; x <= x1; x++) {
        const dx = x > lx ? x - lx : lx > x + 1 ? x + 1 - lx : 0;
        if (dx * dx + dy2 <= R2) out[row + x * 2] |= bit;
      }
    }
  }
  return out;
}

/* Лежит ли хотя бы одна клетка с лужей во вьюпорте (mvp = proj·view,
   column-major). Тест p-вершины по 6 плоскостям — консервативный: ложное «да»
   лишь возвращает зеркальный проход, ложное «нет» невозможно. */
const FP_PLANES = new Float64Array(24);
function frustumPud(mvp, cells, W) {
  const g = r => [mvp[r], mvp[4 + r], mvp[8 + r], mvp[12 + r]];
  const r3 = g(3),
    r2 = g(2),
    r0 = g(0),
    r1 = g(1);
  for (let k = 0; k < 6; k++) {
    let a, b, c, d;
    /* left/right/bottom/top = row3 ± row0/row1; near = row2; far = row3 − row2 */
    if (k === 0) {
      a = r3[0] + r0[0];
      b = r3[1] + r0[1];
      c = r3[2] + r0[2];
      d = r3[3] + r0[3];
    } else if (k === 1) {
      a = r3[0] - r0[0];
      b = r3[1] - r0[1];
      c = r3[2] - r0[2];
      d = r3[3] - r0[3];
    } else if (k === 2) {
      a = r3[0] + r1[0];
      b = r3[1] + r1[1];
      c = r3[2] + r1[2];
      d = r3[3] + r1[3];
    } else if (k === 3) {
      a = r3[0] - r1[0];
      b = r3[1] - r1[1];
      c = r3[2] - r1[2];
      d = r3[3] - r1[3];
    } else if (k === 4) {
      a = r2[0];
      b = r2[1];
      c = r2[2];
      d = r2[3];
    } else {
      a = r3[0] - r2[0];
      b = r3[1] - r2[1];
      c = r3[2] - r2[2];
      d = r3[3] - r2[3];
    }
    const L = Math.hypot(a, b, c) || 1;
    FP_PLANES[k * 4] = a / L;
    FP_PLANES[k * 4 + 1] = b / L;
    FP_PLANES[k * 4 + 2] = c / L;
    FP_PLANES[k * 4 + 3] = d / L;
  }
  for (let i = 0; i < cells.length; i++) {
    const ci = cells[i],
      gx = ci % W,
      gy = (ci / W) | 0;
    const x0 = gx,
      x1 = gx + 1,
      y0 = -0.02,
      y1 = 0.08,
      z0 = gy,
      z1 = gy + 1;
    let vis = true;
    for (let k = 0; k < 6; k++) {
      const a = FP_PLANES[k * 4],
        b = FP_PLANES[k * 4 + 1],
        c = FP_PLANES[k * 4 + 2],
        d = FP_PLANES[k * 4 + 3];
      const px = a > 0 ? x1 : x0,
        py = b > 0 ? y1 : y0,
        pz = c > 0 ? z1 : z0;
      if (a * px + b * py + c * pz + d < 0) {
        vis = false;
        break;
      }
    }
    if (vis) return true;
  }
  return false;
}

/* ПОЛОСЫ КАРТЫ ТЕНЕЙ: «грязные» пересчитываются, «чистые» пропускаются
   (f32-буфер хранит расстояния прошлого кадра — они идентичны, поскольку входные
   данные не изменились). Полоса грязная, если: изменилась лампа или её яркость в
   слоте, изменилась позиция любого окклюдера внутри её радиуса (капсулы, дверная
   створка, состояние карты), либо изменилась конфигурация (nSH/фонарь/карта) —
   тогда грязные все. Заголовок слота: 0xFFFFFFFF = чисто; иначе число капсул
   полосы, затем их индексы — csShadow проходит только капсулы своей полосы
   (раньше — все капсулы сцены в каждом потоке). Предикат отбора буквально
   повторяет ранний выход шейдера (сфера вокруг середины капсулы радиуса
   r+½|B−A|), список повторяет прежний обход. */
const SHAUX_STR = CAPS_MAX + 1;
let shAuxArr = new Uint32Array((SHL_MAX + 1) * SHAUX_STR);
function capNear(caps, o7, lx, lz, Ri) {
  const ax = caps[o7],
    ay = caps[o7 + 1],
    az = caps[o7 + 2],
    bx = caps[o7 + 3],
    by = caps[o7 + 4],
    bz = caps[o7 + 5];
  const mx = (ax + bx) * 0.5,
    mz = (az + bz) * 0.5;
  const crad =
    caps[o7 + 6] +
    0.5 * Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay) + (bz - az) * (bz - az));
  const dx = mx - lx,
    dz = mz - lz,
    d2 = Math.sqrt(dx * dx + dz * dz);
  return d2 <= Ri + crad && d2 >= 1e-4;
}
function buildShadowAux(
  S,
  nSH,
  fshSlot,
  cn,
  nMonC,
  propsStartC,
  segN,
  shW,
  shRowsQ,
  flO,
  flI,
  lamps,
  gridU32,
  ncell
) {
  const aux = shAuxArr;
  const flOn = fshSlot >= 0;
  const nSlots = nSH + (flOn ? 1 : 0);
  let st = GPU.shTrack;
  if (
    !st ||
    st.seed !== S.seed ||
    st.W !== S.W ||
    st.H !== S.H ||
    st.nSH !== nSH ||
    st.flOn !== flOn ||
    st.shW !== shW ||
    st.shRowsQ !== shRowsQ ||
    st.grid.length !== ncell
  ) {
    st = GPU.shTrack = {
      seed: S.seed,
      W: S.W,
      H: S.H,
      nSH: nSH,
      flOn: flOn,
      shW: shW,
      shRowsQ: shRowsQ,
      lampKey: new Float32Array(SHL_MAX * 3),
      flKey: new Float32Array(4),
      flSet: false,
      caps: new Float32Array(CAPS_MAX * 7),
      cn: 0,
      nMon: 0,
      propsStart: 0,
      seg: new Float32Array(SEGS_MAX * 4),
      segN: 0,
      grid: new Uint32Array(ncell),
      first: true
    };
  }
  const allDirty = st.first;
  /* геометрия мира, двери и структура капсул — любое отличие пачкает все полосы */
  let geoDirty = allDirty;
  if (!geoDirty) {
    if (st.cn !== cn || st.nMon !== nMonC || st.propsStart !== propsStartC || st.segN !== segN)
      geoDirty = true;
    else {
      for (let i = 0; i < ncell; i++)
        if (st.grid[i] !== gridU32[i]) {
          geoDirty = true;
          break;
        }
      if (!geoDirty)
        for (let i = 0, n = segN * 4; i < n; i++)
          if (st.seg[i] !== segArr[i]) {
            geoDirty = true;
            break;
          }
    }
  }
  /* изменившиеся капсулы (индексы) — пачкают только те полосы, до которых достают
   (старая ИЛИ новая позиция внутри Ri+crad — как в шейдере) */
  let chA = null,
    chN = 0;
  if (!geoDirty && !allDirty) {
    chA = buildShadowAux._ch || (buildShadowAux._ch = new Int32Array(CAPS_MAX));
    for (let c = 0; c < cn; c++) {
      const o7 = c * 7;
      let diff = false;
      for (let k = 0; k < 7; k++)
        if (st.caps[o7 + k] !== capsArr[o7 + k]) {
          diff = true;
          break;
        }
      if (diff) chA[chN++] = c;
    }
  }
  for (let s = 0; s < nSlots; s++) {
    const isFl = flOn && s === fshSlot;
    let lx, lz, Ri, I;
    if (isFl) {
      lx = flO[0];
      lz = flO[2];
      Ri = FL_RANGE;
      I = flI;
    } else {
      lx = lamps[s * 4];
      lz = lamps[s * 4 + 1];
      Ri = lamps[s * 4 + 2] > 0.05 ? lamps[s * 4 + 2] : LAMP_R;
      I = lamps[s * 4 + 3];
    }
    let dirty = geoDirty;
    if (!dirty) {
      if (isFl) {
        const k = st.flKey;
        dirty = !st.flSet || k[0] !== flO[0] || k[1] !== flO[1] || k[2] !== flO[2] || k[3] !== flI;
      } else {
        const o = s * 3,
          k = st.lampKey;
        dirty = k[o] !== lx || k[o + 1] !== lz || k[o + 2] !== I;
      }
    }
    if (!dirty && chN) {
      for (let q = 0; q < chN; q++) {
        const c = chA[q],
          o7 = c * 7;
        if (capNear(capsArr, o7, lx, lz, Ri) || capNear(st.caps, o7, lx, lz, Ri)) {
          dirty = true;
          break;
        }
      }
    }
    const base = s * SHAUX_STR;
    if (!dirty) {
      aux[base] = 0xffffffff;
      continue;
    }
    let n = 0;
    for (let c = 0; c < cn && n < CAPS_MAX; c++) {
      if (capNear(capsArr, c * 7, lx, lz, Ri)) aux[base + 1 + n++] = c;
    }
    aux[base] = n;
  }
  /* сохраняем текущее как предыдущее */
  for (let s = 0; s < nSH; s++) {
    const o = s * 3;
    st.lampKey[o] = lamps[s * 4];
    st.lampKey[o + 1] = lamps[s * 4 + 1];
    st.lampKey[o + 2] = lamps[s * 4 + 3];
  }
  if (flOn) {
    st.flKey[0] = flO[0];
    st.flKey[1] = flO[1];
    st.flKey[2] = flO[2];
    st.flKey[3] = flI;
    st.flSet = true;
  }
  st.caps.set(capsArr.subarray(0, cn * 7));
  st.cn = cn;
  st.nMon = nMonC;
  st.propsStart = propsStartC;
  st.seg.set(segArr.subarray(0, segN * 4));
  st.segN = segN;
  st.grid.set(gridU32.subarray(0, ncell));
  st.first = false;
  return nSlots * SHAUX_STR;
}

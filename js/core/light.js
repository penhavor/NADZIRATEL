/* ================ СВЕТ ФОНАРЯ ================
   Конус по направлению взгляда + «рассеяние» вокруг игрока. Клетка освещена, если
   она в пределах дальности, внутри внешнего конуса (или в радиусе рассеяния) и есть
   прямая видимость. Используют телепорт монстра и таймер темноты. */
/* плавное падение яркости: выше FL_DIM_AT — полная, ниже — (e/порог)^1.4 */
function flashBright(e) {
  if (!(e > 0)) return 0;
  return e >= FL_DIM_AT ? 1 : Math.pow(e / FL_DIM_AT, 1.4);
}
/* мигание сажающейся батареи (<8%): детерминировано от s.time, биение двух
   несоизмеримых синусов — провалы нерегулярные, как у настоящей лампы */
function flashFlick(s) {
  const e = (s.fl && s.fl.e) || 0;
  if (e >= 0.08) return 1;
  const t = s.time || 0;
  const n = 0.5 + 0.5 * Math.sin(t * 7.3 + Math.sin(t * 2.1) * 1.7) * Math.sin(t * 2.9 + 1.1);
  const deep = 1 - e / 0.08; /* ближе к нулю = глубже провалы */
  return Math.max(0.06, 1 - deep * 0.85 * (1 - n));
}
function cellLitByFlash(s, x, y) {
  const fl = s.fl;
  if (!fl || !fl.owned || !fl.on || !(fl.bri > 0.05))
    return false; /* севший или сажающийся фонарь не защищает */
  const dx = x - s.px,
    dy = y - s.py,
    d = Math.hypot(dx, dy);
  if (d < FL_SPILL_R) return true;
  if (d > FL_RANGE) return false;
  const fx = Math.cos(s.ang),
    fy = Math.sin(s.ang);
  const cs = (dx * fx + dy * fy) / d;
  if (cs < FL_COS_OUT) return false;
  return los(s, s.px, s.py, x, y);
}
function playerInDark(s) {
  const cx = Math.floor(s.px),
    cy = Math.floor(s.py);
  if (cx < 0 || cy < 0 || cx >= s.W || cy >= s.H) return false;
  const i = cy * s.W + cx;
  if (s.light[i] >= HALLU_DARK_T) return false;
  if (s.giA && s.giA[i] >= HALLU_GI_T)
    return false; /* сюда доходит рассеянный свет — это не темнота */
  return !(s.fl && s.fl.owned && s.fl.on && s.fl.bri > 0.05);
}

function updateLamps(s, dt) {
  const L = s.light;
  L.fill(AMBIENT);
  const G = s.gate || (s.gate = new Float32Array(s.W * s.H));
  G.fill(0);
  for (const lp of s.lamps) {
    if (lp.always) {
      lp.I = 1;
      applyLamp(s, L, G, lp);
      continue;
    }
    const dSh = s.monster ? Math.hypot(lp.x + 0.5 - s.mx, lp.y + 0.5 - s.my) : 1e9;
    if (s.monster && dSh < 3.8) {
      lp.fl -= dt;
      if (lp.fl <= 0) {
        lp.fl = 0.03 + s.rndL() * 0.08;
        lp.on2 = s.rndL() < 0.55;
      }
      lp.I = lp.on2 ? 0.25 + 0.75 * s.rndL() : 0.04;
    } else {
      lp.gt -= dt;
      if (lp.gt <= 0) {
        lp.gOff = 0.1 + 0.06 * s.rndL();
        lp.gt = 14 + s.rndL() * 46;
      }
      if (lp.gOff > 0) {
        lp.gOff -= dt;
        lp.I = 0.05;
      } else lp.I = 1;
    }
    if (lp.I > 0.03) applyLamp(s, L, G, lp);
  }
  /* Процессорная копия GPU-диффузии (csLmIter: 6 итераций, 0.55*0.25 на соседа):
   непрямой свет загибается за углы, поэтому клетка за углом от лампы ВИДИМА.
   Поле нужно только проверке темноты для галлюцинаций (playerInDark). */
  const W = s.W,
    H = s.H,
    GR = s.grid,
    DS = s.doorState;
  let A = s.giA,
    B = s.giB,
    OP = s.giOp;
  if (!A || A.length !== L.length) {
    A = s.giA = new Float32Array(W * H);
    B = s.giB = new Float32Array(W * H);
    OP = s.giOp = new Uint8Array(W * H);
  }
  for (let i = 0; i < L.length; i++) {
    const v = GR[i],
      open = v === 0 || (v === 3 && DS && DS[i] > 0.5);
    OP[i] = open ? 1 : 0;
    const d = L[i] - AMBIENT;
    A[i] = d > 0 ? d : 0;
  }
  for (let it = 0; it < 6; it++) {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        if (!OP[i]) {
          B[i] = A[i];
          continue;
        }
        let sm = 0;
        if (x > 0 && OP[i - 1]) sm += A[i - 1];
        if (x < W - 1 && OP[i + 1]) sm += A[i + 1];
        if (y > 0 && OP[i - W]) sm += A[i - W];
        if (y < H - 1 && OP[i + W]) sm += A[i + W];
        B[i] = A[i] + 0.1375 * sm;
      }
    }
    const T = A;
    A = B;
    B = T;
    s.giA = A;
    s.giB = B;
  }
}

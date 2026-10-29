/* ==== ГЕНЕРАЦИЯ МИРА: лабиринт, шкафы, выход ====
   W/H — СГЕНЕРИРОВАННЫЙ размер лабиринта, ровно то, что игрок выставил в меню.
   Комнаты старта и выхода в него НЕ входят: каждая — одна клетка ЗА кольцом
   стен лабиринта, соединённая собственной дверью (безопасная / железная).
   Сетка имеет размер (W+4)x(H+4): кольцо лабиринта занимает [1..W+2]x[1..H+2],
   внешний пояс остаётся стеной, кроме двух клеток комнат. Поэтому ЛЮБАЯ
   комбинация ползунков (1..100, включая прямоугольные) даёт целую структуру:
   комнаты и двери никогда не совпадут ни с клетками лабиринта, ни друг с другом,
   а выход всегда за железной дверью. Клетки лабиринта лежат на нечётных
   координатах; на ЧЁТНОЙ стороне шаг 2 перескочил бы последний ряд или столбец,
   поэтому крайняя клетка сливается с соседом шагом 1 (без разделительной
   стены) — классическая правка чётности. Прорезка остаётся остовным деревом:
   ход требует непрорезанного назначения. */
function genMaze(rnd, W, H, opts) {
  /* rnd — это .rnd потока Xoshiro512** с индексом XS_MAZE */
  W = Math.max(1, W | 0);
  H = Math.max(1, H | 0); /* ползунки 1..100 — страховка от ввода вне диапазона */
  const GW = W + 4,
    GH = H + 4;
  const g = new Uint8Array(GW * GH).fill(1);
  const ix = (x, y) => y * GW + x;
  const inA = (x, y) =>
    x > 1 && y > 1 && x < GW - 2 && y < GH - 2; /* внутри проходимой коробки лабиринта */
  const start = { x: 2, y: 2 }; /* вход в лабиринт (комната старта снаружи) */
  {
    const stack = [[2, 2]];
    g[ix(2, 2)] = 0;
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const dirs = [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2]
      ];
      for (let i = dirs.length - 1; i > 0; i--) {
        const j = (rnd() * (i + 1)) | 0;
        const t = dirs[i];
        dirs[i] = dirs[j];
        dirs[j] = t;
      }
      let moved = false;
      for (const [dx, dy] of dirs) {
        let nx = cx + dx,
          ny = cy + dy,
          mid = 1;
        if (!inA(nx, ny)) {
          nx = cx + (dx >> 1);
          ny = cy + (dy >> 1);
          mid = 0;
        } /* шаг 1 для чётности на чётном краю */
        if (inA(nx, ny) && g[ix(nx, ny)] === 1) {
          if (mid) g[ix(cx + (dx >> 1), cy + (dy >> 1))] = 0;
          g[ix(nx, ny)] = 0;
          /* крайние клетки (шаг 1 для чётности) — концевые листья: обход от них НЕ
   продолжается, иначе открылась бы вторая решётка и съела стены */
          if (mid) stack.push([nx, ny]);
          moved = true;
          break;
        }
      }
      if (!moved) stack.pop();
    }
  }
  /* BFS от входа в лабиринт по коридорам (комнаты ещё не прорезаны) */
  const dist = new Int32Array(GW * GH).fill(-1),
    par = new Int32Array(GW * GH).fill(-1);
  const q = [ix(start.x, start.y)];
  dist[q[0]] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi],
      cx = c % GW,
      cy = (c / GW) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const nx = cx + dx,
        ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ix(nx, ny);
      if (g[n] === 0 && dist[n] === -1) {
        dist[n] = dist[c] + 1;
        par[n] = c;
        q.push(n);
      }
    }
  }
  let maxD = 0;
  for (let i = 0; i < GW * GH; i++) if (g[i] === 0 && dist[i] > maxD) maxD = dist[i];
  /* ВЫХОД: самая дальняя клетка лабиринта со свободным соседом в кольце стен.
   Железная дверь занимает эту клетку кольца, комната выхода — клетку пояса за
   ней, поэтому портал всегда живёт в своей запертой комнате. Внешнее направление
   предпочтительно указывает прочь от входа (на лабиринте 1x1 — напротив
   безопасной двери: прямая линия). */
  const RING = (x, y) =>
    x >= 1 &&
    y >= 1 &&
    x <= GW - 2 &&
    y <= GH - 2 &&
    (x === 1 || y === 1 || x === GW - 2 || y === GH - 2);
  const DIRS = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0]
  ];
  const sDoor = { x: 2, y: 1 },
    sRoom = { x: 2, y: 0 }; /* безопасная дверь в кольце, комната старта за ней */
  const ringFree = (x, y) => RING(x, y) && g[ix(x, y)] === 1 && !(x === sDoor.x && y === sDoor.y);
  let cI = -1;
  for (let i = 0; i < GW * GH; i++) {
    if (g[i] !== 0 || dist[i] < 0) continue;
    const x = i % GW,
      y = (i / GW) | 0;
    if (!DIRS.some(([dx, dy]) => ringFree(x + dx, y + dy))) continue;
    if (cI < 0 || dist[i] > dist[cI]) cI = i;
  }
  if (cI < 0) cI = ix(start.x, start.y); /* микро-карты: сам вход */
  const ccx = cI % GW,
    ccy = (cI / GW) | 0;
  const fd = DIRS.filter(([dx, dy]) => ringFree(ccx + dx, ccy + dy));
  fd.sort(
    (a, b) =>
      b[0] * (ccx - start.x) +
      b[1] * (ccy - start.y) -
      (a[0] * (ccx - start.x) + a[1] * (ccy - start.y))
  );
  const dd = fd.length ? fd[0] : [0, 1];
  const door = { x: ccx + dd[0], y: ccy + dd[1] };
  const room = { x: ccx + 2 * dd[0], y: ccy + 2 * dd[1] };
  const doorFace = { x: -dd[0], y: -dd[1] };
  g[ix(door.x, door.y)] = 2;
  g[ix(room.x, room.y)] = 0;
  g[ix(sDoor.x, sDoor.y)] = 3;
  g[ix(sRoom.x, sRoom.y)] = 0;
  /* startComp — область, достижимая из комнаты старта без железной двери:
   безопасные двери считаются проходимыми (они открываются свободно), сетка 2 — нет */
  const startComp = new Uint8Array(GW * GH);
  {
    const q = [ix(sRoom.x, sRoom.y)];
    startComp[q[0]] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi],
        cx = c % GW,
        cy = (c / GW) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx,
          ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const n = ix(nx, ny);
        if (g[n] !== 1 && g[n] !== 2 && !startComp[n]) {
          startComp[n] = 1;
          q.push(n);
        }
      }
    }
  }
  const pathSet = new Set();
  let c0 = cI;
  while (c0 !== -1) {
    pathSet.add(c0);
    c0 = par[c0];
  }

  /* Шкафы вдоль стен (глубина 0.18 клетки оставляет коридоры проходимыми), стол с
   фонарём. Весь лут живёт только в шкафах. cabDens (0..1) = доля открытых
   клеток, получающих шкаф; loot (0..100) = доля шкафов с содержимым: в одном
   лежит ключ, в остальных — батарейки. loot=0 означает, что ключа нет (меню
   предупреждает, но играть не запрещает). Всё детерминировано от сида. */
  const cabD = Math.max(0, Math.min(1, opts && opts.cabDens != null ? +opts.cabDens : 0.04));
  const lootP = Math.max(0, Math.min(100, opts && opts.loot != null ? +opts.loot : 50));
  const excl = new Uint8Array(GW * GH);
  excl[ix(door.x, door.y)] = 1;
  excl[ix(room.x, room.y)] = 1;
  excl[ix(sDoor.x, sDoor.y)] = 1;
  excl[ix(sRoom.x, sRoom.y)] = 1;
  excl[ix(start.x, start.y)] = 1;
  const markAround = (cx, cy) => {
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx,
        ny = cy + dy;
      if (nx > 0 && ny > 0 && nx < GW - 1 && ny < GH - 1) excl[ix(nx, ny)] = 1;
    }
  };
  markAround(door.x, door.y);
  markAround(start.x, start.y);
  markAround(sDoor.x, sDoor.y);
  /* кандидаты: клетки пола хотя бы с одной сплошной стеной (шкаф упирается в неё спинкой) */
  const wallOf = i => {
    const x = i % GW,
      y = (i / GW) | 0;
    const sol = DIRS.filter(([dx, dy]) => {
      const nx = x + dx,
        ny = y + dy;
      return nx < 0 || ny < 0 || nx >= GW || ny >= GH || g[ny * GW + nx] === 1;
    });
    return sol.length ? sol[(rnd() * sol.length) | 0] : null;
  };
  let cabCands = [];
  for (let i = 0; i < GW * GH; i++) if (g[i] === 0 && !excl[i] && wallOf(i)) cabCands.push(i);
  const nTot = Math.min(cabCands.length, Math.round(cabD * cabCands.length));
  let nLoot = Math.floor((nTot * lootP) / 100);
  /* шкаф с ключом — как можно дальше от старта; ставится, только если лут есть */
  let keyI;
  if (nTot > 0 && nLoot > 0) {
    let keyCands = cabCands.filter(
      i => startComp[i] && dist[i] >= Math.ceil(maxD * 0.55) && !pathSet.has(i)
    );
    if (!keyCands.length)
      keyCands = cabCands.filter(i => startComp[i] && dist[i] >= Math.ceil(maxD * 0.4));
    if (!keyCands.length) keyCands = cabCands.filter(i => startComp[i] && dist[i] > 2);
    if (!keyCands.length) keyCands = cabCands.slice();
    keyCands.sort((a, b) => dist[b] - dist[a]);
    if (keyCands.length) keyI = keyCands[(rnd() * Math.max(1, Math.min(keyCands.length, 6))) | 0];
  }
  const key = {
    x: (keyI === undefined ? door.x : keyI) % GW,
    y: ((keyI === undefined ? door.x : keyI) / GW) | 0
  };
  const cabs = [];
  const used = new Set();
  if (keyI !== undefined) {
    const w = wallOf(keyI);
    cabs.push({ x: keyI % GW, y: (keyI / GW) | 0, wx: w[0], wy: w[1], content: 'key' });
    used.add(keyI);
    nLoot--;
  }
  /* остальные шкафы: первые nLoot получают батарейки, затем пустые; интервал
   >= 1.8 клетки (при высокой плотности ослабляется до 0) */
  const rest = cabCands.filter(i => !used.has(i));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = rest[i];
    rest[i] = rest[j];
    rest[j] = t;
  }
  const nPlace = Math.max(0, nTot - cabs.length);
  const far = (i, minD) => {
    const x = i % GW,
      y = (i / GW) | 0;
    for (const c of cabs) if (Math.hypot(c.x - x, c.y - y) < minD) return false;
    return true;
  };
  let placed = 0;
  for (const minD of [1.8, 1.0, 0.01]) {
    for (const i of rest) {
      if (placed >= nPlace) break;
      if (used.has(i) || !far(i, minD)) continue;
      const w = wallOf(i);
      if (!w) continue;
      used.add(i);
      cabs.push({
        x: i % GW,
        y: (i / GW) | 0,
        wx: w[0],
        wy: w[1],
        content: placed < nLoot ? 'batt' : null
      }); /* в ящике всегда ровно ОДИН предмет */
      placed++;
    }
    if (placed >= nPlace) break;
  }
  /* стол с фонарём в комнате старта: у одной из её сплошных стен (внешний пояс
   считается стеной). Старт смотрит в сторону ключа — стол уходит ВПРАВО, ВЛЕВО
   или ЗА СПИНУ игрока (сторону выбирает генератор). */
  {
    const solidAt = (x, y) => x < 0 || y < 0 || x >= GW || y >= GH || g[ix(x, y)] === 1;
    const fkx = key.x - sRoom.x,
      fky = key.y - sRoom.y;
    const fwd =
      Math.abs(fkx) >= Math.abs(fky) ? [Math.sign(fkx) || 1, 0] : [0, Math.sign(fky) || 1];
    const right = [-fwd[1], fwd[0]]; /* 90° по часовой на карте с осью y вниз = правая рука */
    const cands = [
      [right[0], right[1]],
      [-right[0], -right[1]],
      [-fwd[0], -fwd[1]]
    ];
    const solidWalls = cands.filter(([dx, dy]) => solidAt(sRoom.x + dx, sRoom.y + dy));
    let tblW = solidWalls.length ? solidWalls[(rnd() * solidWalls.length) | 0] : null;
    if (!tblW)
      for (const [dx, dy] of [
        [-1, 0],
        [0, -1],
        [1, 0],
        [0, 1]
      ]) {
        if (solidAt(sRoom.x + dx, sRoom.y + dy)) {
          tblW = [dx, dy];
          break;
        }
      }
    if (!tblW) tblW = [-1, 0];
    var table = { x: sRoom.x, y: sRoom.y, wx: tblW[0], wy: tblW[1] };
  }
  const floors = [],
    mazeFloors = [];
  for (let i = 0; i < GW * GH; i++)
    if (g[i] === 0) {
      floors.push(i);
      if (inA(i % GW, (i / GW) | 0)) mazeFloors.push(i);
    }
  const keyI2 = key.y * GW + key.x;
  return {
    grid: g,
    W: GW,
    H: GH,
    start: sRoom,
    door,
    key,
    maxDist: maxD,
    keyDist: dist[keyI2] >= 0 ? dist[keyI2] : maxD,
    dist,
    floors,
    mazeFloors,
    safeDoors: [{ x: sDoor.x, y: sDoor.y }],
    exitRoom: [room],
    doorFace,
    startComp,
    cabs: cabs,
    batts: [],
    table: table,
    nCand: cabCands.length
  };
}

/* ==== ЛАМПЫ И КАРТА СВЕТА ==== */
function genLamps(s, density, rnd) {
  const d = Math.max(0, Math.min(1, density || 0));
  const lamps = [];
  if (d > 0) {
    const minD = 1 + (1 - d) * 2;
    const order = (s.mazeFloors || s.floors).slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    for (const f of order) {
      if (rnd() >= d) continue;
      const x = f % s.W,
        y = (f / s.W) | 0;
      let ok = true;
      for (const L of lamps)
        if (Math.hypot(L.x - x, L.y - y) < minD) {
          ok = false;
          break;
        }
      if (ok) lamps.push({ x, y, gt: 10 + rnd() * 40, gOff: 0, fl: 0, on2: true, I: 1 });
    }

    let nearStart = false;
    for (const L of lamps) if (Math.hypot(L.x - s.start.x, L.y - s.start.y) < 3) nearStart = true;
    if (!nearStart) {
      let best = s.mazeFloors.length ? s.mazeFloors[0] : s.start.y * s.W + s.start.x,
        bd = 1e9; /* микро-карта без полов — лампа висит на старте */
      for (const f of s.mazeFloors) {
        const dd = Math.hypot((f % s.W) - s.start.x, ((f / s.W) | 0) - s.start.y);
        if (dd < bd) {
          bd = dd;
          best = f;
        }
      }
      lamps.push({
        x: best % s.W,
        y: (best / s.W) | 0,
        gt: 10 + rnd() * 40,
        gOff: 0,
        fl: 0,
        on2: true,
        I: 1
      });
    }
  }

  lamps.push({ x: s.start.x, y: s.start.y, gt: 1e9, gOff: 0, fl: 0, on2: true, I: 1, always: 1 });
  if (s.exitRoom && s.exitRoom.length)
    lamps.push({
      x: s.exitRoom[0].x,
      y: s.exitRoom[0].y,
      gt: 1e9,
      gOff: 0,
      fl: 0,
      on2: true,
      I: 1,
      always: 1
    });
  return lamps;
}
function buildLampCells(s, lp) {
  const R = LAMP_R,
    cells = [];
  const lx = lp.x + 0.5,
    ly = lp.y + 0.5;
  const y0 = Math.max(0, Math.floor(ly - R)),
    y1 = Math.min(s.H - 1, Math.ceil(ly + R));
  const x0 = Math.max(0, Math.floor(lx - R)),
    x1 = Math.min(s.W - 1, Math.ceil(lx + R));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const gv0 = s.grid[y * s.W + x];
      if (gv0 === 1 || gv0 === 2) continue;
      const d = Math.hypot(x + 0.5 - lx, y + 0.5 - ly);
      if (d > R) continue;
      const fall = 1 - d / R;
      const vis = losDoorsOpen(s, lx, ly, x + 0.5, y + 0.5);

      cells.push(y * s.W + x, fall, vis ? 1 : 0, vis ? Math.min(1, 0.25 + fall * 1.6) : 0);
    }
  lp.cells = new Float32Array(cells);
}
function applyLamp(s, L, G, lp) {
  if (!lp.cells) buildLampCells(s, lp);
  const c = lp.cells,
    I = lp.I;
  for (let k = 0; k < c.length; k += 4) {
    const i = c[k];
    L[i] = Math.min(1, L[i] + I * c[k + 1] * 0.95 * c[k + 2]);
    if (G) {
      const gv = c[k + 3];
      if (gv > G[i]) G[i] = gv;
    }
  }
}
function baseLight(s) {
  const L = new Float32Array(s.W * s.H).fill(AMBIENT);
  for (const lp of s.lamps) applyLamp(s, L, null, lp);
  return L;
}

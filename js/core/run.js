/* ==== СОСТОЯНИЕ ЗАБЕГА ==== */
function newState(seedBytes, opts) {
  /* seedBytes — весь 64-байтный вывод SHA3-512 */
  opts = Object.assign(
    {
      W: 21,
      H: 21,
      monster: true,
      monsterSpeed: KMH(15),
      fov: 0.8,
      density: 0.3,
      teleport: false,
      cabDens: 0.04,
      loot: 38
    },
    opts
  );
  opts.map = mapCfg(opts.map);
  const st = xsSeed(seedBytes);
  const m = genMaze(xsStream(st, XS_MAZE).rnd, opts.W, opts.H, opts);
  /* m ПОСЛЕ opts: генератор владеет W/H — opts несёт СГЕНЕРИРОВАННЫЙ размер
   лабиринта, m возвращает истинный размер СЕТКИ (лабиринт + кольцо стен +
   пояс комнат) */
  const s = Object.assign({}, opts, m);
  s.seed = seedHex(seedBytes);
  s.seedBytes = seedBytes;
  s.seedState = st;
  s.actDid = false;
  s.px = m.start.x + 0.5;
  s.py = m.start.y + 0.5;
  s.ang = Math.atan2(m.key.y + 0.5 - s.py, m.key.x + 0.5 - s.px);
  s.hasKey = false;
  s.doorOpen = false;
  s.won = false;
  s.caught = false;
  s.time = 0;
  s.steps = 0;
  s.bot = false;
  s.botPath = null;
  s.botStage = 'key';
  s.bobA = 0;
  /* состояние персонажа/анимации */
  s.animPhase = 0;
  s.pAnimWant = 'idle';
  s.pAnimPrev = null;
  s.pAnimK = 1;
  s.pCrouch = 0;
  s.pCrouchT = 0;
  s.crC = 0;
  s.pYawVis = s.ang;
  s.pActKind = 'item';
  s.pk = null;
  s.sw = null;
  s.drops = [];
  s.thirdPerson = 0;
  s.manAnim = -1; /* 0=нет, 1=сзади, 2=спереди */
  s.stam = 1;
  s.exhausted = false;
  s.dev = { noclip: false, invisible: false, infStam: false };

  s.safeDoors = m.safeDoors.map(d => ({ x: d.x, y: d.y, t: 0, want: 0 }));
  s.doorState = new Float32Array(m.W * m.H);
  s.exitRoom = m.exitRoom || [];
  s.winCell = s.exitRoom.length ? s.exitRoom[0] : m.door;
  s.doorT = 0;
  s.doorUnlocked = false;
  s.doorLeaf = false;
  s.doorLeafT = 0;
  s.noiseR = 0;
  s.noisePos = null;
  s.noiseCd = 0;
  /* инвентарь, фонарь, шкафы, стол, таймер темноты */
  s.inv = [null, null, null, null];
  s.sel = -1;
  s.fl = { owned: false, on: false, e: 1.0, bri: 0, rl: 0, rlT0: -99, tgT: -99 };
  s.cabs = (m.cabs || []).map(c => ({
    x: c.x,
    y: c.y,
    wx: c.wx,
    wy: c.wy,
    content: c.content,
    looted: false,
    open: 0,
    want: 0,
    cd: 0,
    phase: ((c.x * 7 + c.y * 13) % 17) / 17
  }));
  s.batts = (m.batts || []).map(b => ({
    x: b.x,
    y: b.y,
    taken: false,
    rot: (((b.x * 31 + b.y * 17) % 13) / 13) * Math.PI
  }));
  s.table = m.table || { x: m.start.x, y: m.start.y, wx: -1, wy: 0 };
  s.flashTaken = false;
  s.darkT = 0;
  s.aimT = null;
  /* коллизия с мебелью: AABB-коробки, разрешается после tryMove */
  s._boxes = [];
  for (const c of s.cabs) s._boxes.push(boxOf(c, CAB_D, CAB_W));
  s._boxes.push(boxOf(s.table, TBL_D, TBL_W));
  s.mPhase = 0;
  s.mSpeedNow = 0;

  s.mGait = 'walk';
  s.mPauseT = 0;
  s.mScan = null;
  s.mScanOff = 0;
  s.explored = new Uint8Array(m.W * m.H);
  /* каждая подсистема — свой параллельный поток Xoshiro512** из одного сида */
  const rM = xsStream(st, XS_MON).rnd;
  s.rndM = rM;
  const rL = xsStream(st, XS_LAMP).rnd;
  s.rndL = rL;
  s.rndV = xsStream(st, XS_VIS).rnd;
  s.rndA = xsStream(st, XS_AUD).rnd;
  s.seedTag = xsStream(st, XS_TAG).u32() & 0x7fffffff; /* u32-тег — шум внутри шейдеров */
  s.mYaw = rM() * Math.PI * 2;
  s.lamps = genLamps(s, opts.density, rL);
  s.light = new Float32Array(s.W * s.H).fill(AMBIENT);
  s.gate = new Float32Array(s.W * s.H);
  const bl = baseLight(s);
  s.darkCells = [];
  for (let i = 0; i < s.W * s.H; i++) if (s.grid[i] === 0 && bl[i] < DARK_T) s.darkCells.push(i);
  updateLamps(s, 0);
  let mi = m.mazeFloors.length
    ? m.mazeFloors[(rM() * m.mazeFloors.length) | 0]
    : m.start.y * m.W +
      m.start
        .x; /* в вырожденных микро-картах обычного пола нет — Монитор стоит на точке появления */
  if (m.startComp && !m.startComp[mi]) mi = m.mazeFloors.find(f => m.startComp[f]) ?? mi;
  for (const f of m.mazeFloors)
    if (m.startComp[f] && m.dist[f] >= m.maxDist * 0.5 && m.dist[f] < m.maxDist && rM() < 0.25) {
      mi = f;
      break;
    }
  s.mx = (mi % m.W) + 0.5;
  s.my = ((mi / m.W) | 0) + 0.5;
  s.mMode = 'wander';
  s.mPath = null;
  s.mRep = 0;
  s.lastSeen = null;
  s.tpCd = 8 + rM() * 8;
  return s;
}

/* =============== ИНВЕНТАРЬ / ПРЕДМЕТЫ ================
   Слоты: null | {kind:'flash'} | {kind:'batt',n:1..4} | {kind:'key'}.
   s.sel = номер предмета в руке; клавиши 1-4 берут слот в руку. */
function invAdd(s, kind) {
  if (kind === 'batt') {
    /* стэкинг как в Minecraft: частичные стэки добираются первыми; полные стэки не
   блокируют подбор — новая батарейка уходит в любой свободный слот */
    for (let i = 0; i < INV_SLOTS; i++) {
      const it = s.inv[i];
      if (it && it.kind === 'batt' && it.n < BATT_STACK) {
        it.n++;
        return true;
      }
    }
    for (let i = 0; i < INV_SLOTS; i++)
      if (!s.inv[i]) {
        s.inv[i] = { kind: 'batt', n: 1 };
        if (s.sel < 0) s.sel = i;
        return true;
      }
    return false;
  }
  for (let i = 0; i < INV_SLOTS; i++) {
    const it = s.inv[i];
    if (it && it.kind === kind) return false;
  }
  for (let i = 0; i < INV_SLOTS; i++)
    if (!s.inv[i]) {
      s.inv[i] = { kind: kind };
      if (s.sel < 0) s.sel = i;
      return true;
    }
  return false;
}
function invCount(s, kind) {
  let n = 0;
  for (const it of s.inv) if (it && it.kind === kind) n += kind === 'batt' ? it.n : 1;
  return n;
}
function invRemoveBatt(s) {
  for (let i = 0; i < INV_SLOTS; i++) {
    const it = s.inv[i];
    if (it && it.kind === 'batt') {
      it.n--;
      if (it.n <= 0) {
        s.inv[i] = null;
        if (s.sel === i) invFixSel(s);
      }
      return true;
    }
  }
  return false;
}
function invFixSel(s) {
  /* sel всегда указывает на занятый слот */
  let k = -1;
  for (let i = 0; i < INV_SLOTS; i++)
    if (s.inv[i]) {
      k = i;
      break;
    }
  s.sel = s.sel >= 0 && s.inv[s.sel] ? s.sel : k;
}
function invSelKind(s) {
  const it = s.inv[s.sel];
  return it ? it.kind : null;
}
function invSlotOfKind(s, kind) {
  for (let i = 0; i < INV_SLOTS; i++) if (s.inv[i] && s.inv[i].kind === kind) return i;
  return -1;
}
/* смена предмета (1-4 / F в руку): sel переключается в середине анимации, когда
   рука со старым предметом опущена и вне кадра (см. s.sw в update) */
function invSwapTo(s, slot, tg, drop) {
  if (slot < 0 || slot >= INV_SLOTS || s.sw) return false;
  if (!drop && slot === s.sel) return false; /* бросок идёт «в тот же слот» (он опустеет) */
  s.sw = {
    t0: s.time,
    slot: slot,
    dur: SW_DUR,
    applied: false,
    tg: !!tg,
    drop: !!drop,
    fromKind: invSelKind(s)
  };
  return true;
}
/* подбор: предмет ПОЯВЛЯЕТСЯ в руке в верхней точке подъёма (s.pk), а не в кадре
   нажатия — до этого слот уже занят, но рука ещё пуста (sel восстановлен в sel0) */
function pkDefer(s, sel0, kind, hadIt) {
  if (s.bot || hadIt) return; /* рука была занята — предмет ушёл в инвентарь */
  const ns = s.sel;
  if (ns < 0) return; /* в руку ничего не пришло */
  s.pk = { slot: ns, kind: kind, t0: s.time };
  s.sel =
    ns === sel0
      ? -1
      : sel0; /* слот заполнился на наших глазах — рука остаётся пустой до верхней точки */
}
function invSelectKind(s, kind) {
  for (let i = 0; i < INV_SLOTS; i++)
    if (s.inv[i] && s.inv[i].kind === kind) {
      s.sel = i;
      return true;
    }
  return false;
}
/* =============== ШКАФЫ / МЕБЕЛЬ ================
   Мебель стоит у стены: (wx,wy) = нормаль фасада, d = глубина, w = ширина. */
function cabFront(c) {
  return { x: -c.wx, y: -c.wy };
}
function boxCenter(o, d) {
  return { x: o.x + 0.5 + o.wx * (0.5 - d / 2), y: o.y + 0.5 + o.wy * (0.5 - d / 2) };
}
function boxOf(o, d, w) {
  const c = boxCenter(o, d);
  return o.wx !== 0
    ? { cx: c.x, cy: c.y, hx: d / 2, hz: w / 2 }
    : { cx: c.x, cy: c.y, hx: w / 2, hz: d / 2 };
}
function cabCenter(c) {
  return boxCenter(c, CAB_D);
}
function nearestCab(s, px, py, maxD) {
  let best = null,
    bd = maxD;
  for (const c of s.cabs) {
    const cc = cabCenter(c);
    const d = Math.hypot(cc.x - px, cc.y - py);
    if (d < bd) {
      /* дотянуться «сквозь стену» нельзя: стоять нужно со стороны фасада */
      const f = cabFront(c);
      if ((px - cc.x) * f.x + (py - cc.y) * f.y > -0.22) {
        bd = d;
        best = c;
      }
    }
  }
  return best;
}
function nearestDrop(s, px, py, maxD) {
  let best = null,
    bd = maxD;
  for (const d of s.drops || []) {
    const dd = Math.hypot(d.wx - px, d.wy - py);
    if (dd < bd) {
      bd = dd;
      best = d;
    }
  }
  return best;
}
function nearestBatt(s, px, py, maxD) {
  let best = null,
    bd = maxD;
  for (const b of s.batts) {
    if (b.taken) continue;
    const d = Math.hypot(b.x + 0.5 - px, b.y + 0.5 - py);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}
/* разрешаем коллизию игрока с AABB мебели (после осевого tryMove) */
function resolveBoxes(s) {
  if (!s._boxes || (s.dev && s.dev.noclip)) return;
  const r = 0.09;
  for (const b of s._boxes) {
    const dx = s.px - b.cx,
      dy = s.py - b.cy;
    const ox = b.hx + r - Math.abs(dx),
      oy = b.hz + r - Math.abs(dy);
    if (ox > 0 && oy > 0) {
      if (ox < oy) s.px = b.cx + Math.sign(dx || 1) * (b.hx + r);
      else s.py = b.cy + Math.sign(dy || 1) * (b.hz + r);
    }
  }
}

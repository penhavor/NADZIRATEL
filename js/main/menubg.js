/* ==== ФОН ГЛАВНОГО МЕНЮ: Т-образный коридор 11×11 ====
   Случайный лабиринт с гарантированной формой «Т»: перекладина, лампы (-) по
   сторонам пересечения, хвост с камерой (^) и управляемой лампой (_) сверху.
   Монитор стоит на пересечении (&): пока (_) горит — его нет; (_) гаснет — он
   появляется и дёргает головой. Сид чисто случайный и нигде не задаётся —
   лабиринт перестраивается при каждом входе в меню. */
let menuS = null,
  menuM = null,
  menuBusy = false;
function menuMonChance() {
  if (!PLAY.mon) return 0;
  /* фиксированный шанс на пресет; «своя» — всегда спокойно, как на тренировке */
  return (
    { practice: 0, easy: 0.05, medium: 0.2, hard: 0.5, extreme: 0.75, impossible: 1 }[
      PLAY.preset
    ] || 0
  );
}
function menuMazeState() {
  /* меню ВСЕГДА случайное и никогда не привязано к сиду игрока: свежие байты при
   каждом входе в меню */
  const s = newState(randBytes(64), {
    W: 9,
    H: 9,
    monster: true,
    monsterSpeed: KMH(8),
    density: 0,
    teleport: false,
    cabDens: 0,
    loot: 0,
    map: mapCfg({ on: false })
  });
  /* Т-образный коридор 11x11 внутри сетки 13x13 (сетка = проходимый лабиринт +
   кольцо стен + пояс комнат): перекладина, лампы (-) по сторонам пересечения,
   хвост с камерой (^) и управляемой лампой (_), железная дверь за камерой. Сетка
   строится заново — от комнат и дверей генератора в сцене меню ничего не остаётся */
  const W = s.W,
    H = s.H,
    MX = W >> 1;
  const g = s.grid,
    ix = (x, y) => y * W + x;
  g.fill(1);
  for (let x = 2; x <= W - 3; x++) g[ix(x, 2)] = 0; /* Т: перекладина */
  for (let y = 2; y <= H - 3; y++) g[ix(MX, y)] = 0; /* Т: хвост */
  g[ix(MX, H - 3)] = 2; /* железная дверь за камерой */
  s.start = { x: MX, y: H - 4 };
  s.door = { x: MX, y: H - 3 };
  s.doorFace = { x: 0, y: -1 };
  s.doorState = new Float32Array(W * H);
  s.winCell = { x: MX, y: H - 3 };
  s.exitRoom = [];
  s.safeDoors = [];
  s.cabs = [];
  s.batts = [];
  s.drops = [];
  s.table = null;
  s.flashTaken = true;
  s._boxes = [];
  const fl = [];
  for (let i = 0; i < W * H; i++) if (g[i] === 0) fl.push(i);
  s.floors = fl;
  s.mazeFloors = fl;
  s.lamps = [
    /* (-) по сторонам пересечения: их свет ДОСТАЁТ монстра и стену за ним (радиус
   лампы 3.2, расстояние 2) — силуэт читается, а не «чёрное по чёрному».
   base 0.55: когда (_) гаснет, пересечение остаётся тусклым (~0.4), а не столь же
   ярким — момент «свет умер» должен быть заметен */
    { x: MX - 2, y: 2, base: 0.55, gt: 12 + Math.random() * 30, gOff: 0, fl: 0, on2: true, I: 1 },
    { x: MX + 2, y: 2, base: 0.55, gt: 12 + Math.random() * 30, gOff: 0, fl: 0, on2: true, I: 1 },
    { x: MX, y: 3, ctl: true, on: true, gt: 0, gOff: 0, fl: 0, on2: true, I: 1 }
  ];
  /* камера — в хвосте, в трёх клетках от пересечения: с низа хвоста монстр был бы
   пятном в 8°; здесь он крупный, а световое пятно пересечения в кадре */
  s.px = MX + 0.5;
  s.py = 5.55;
  s.ang = -Math.PI / 2;
  s.pitch = 0;
  s.pYawVis = s.ang;
  s.thirdPerson = 0;
  s.noVM = 1;
  s.monster = false;
  s.headJerk = 0;
  s.mx = MX + 0.5;
  s.my = 2.5;
  s.mYaw = 0;
  s.mMode = 'wander';
  s.mGait = 'stand';
  s.mSpeedNow = 0;
  s.mPhase = 0;
  s.mScan = null;
  s.mScanOff = 0;
  s.mPauseT = 0;
  s.time = 0;
  s.inv = [null, null, null, null];
  s.sel = -1;
  s.fl = { owned: false, on: false, e: 1, bri: 0, rl: 0, rlT0: -99, tgT: -99 };
  menuLamps(s, 0);
  return s;
}
/* свет меню: (-) горят всегда (редкие провалы — как в игре), (_) — по сценарию */
function menuLamps(s, dt) {
  const L = s.light,
    G = s.gate;
  L.fill(AMBIENT);
  G.fill(0);
  for (const lp of s.lamps) {
    if (lp.ctl) lp.I = lp.on ? 1 : 0;
    else {
      lp.gt -= dt;
      if (lp.gt <= 0) {
        lp.gOff = 0.1 + 0.06 * s.rndL();
        lp.gt = 14 + s.rndL() * 46;
      }
      if (lp.gOff > 0) {
        lp.gOff -= dt;
        lp.I = 0.05;
      } else lp.I = lp.base || 1;
    }
    if (lp.I > 0.03) applyLamp(s, L, G, lp);
  }
}
/* сценарий: спокойно → мигание (лампа моргает) → увидели (монстр) → спокойно.
   Шанс проверяется раз в секунду и только пока «всё спокойно»; 100% —
   бесконечное появление (без исчезновения и мгновенного возврата). */
function menuScenario(dt) {
  const s = menuS,
    jl = menuM.jl,
    p = menuMonChance();
  if (menuM.phase === 'calm') {
    jl.on = true;
    if (p >= 1) {
      menuM.phase = 'seen';
      menuM.dur = Infinity;
      s.monster = true;
      s.headJerk = 1;
      jl.on = false;
    } else {
      menuM.t += dt;
      if (menuM.t >= 1) {
        menuM.t -= 1;
        if (Math.random() < p) {
          menuM.phase = 'flick';
          menuM.dur = 0.14 + Math.random() * 0.22;
        }
      }
    }
  } else if (menuM.phase === 'flick') {
    jl.on = Math.random() < 0.5;
    menuM.dur -= dt;
    if (menuM.dur <= 0) {
      menuM.phase = 'seen';
      menuM.dur = 0.5 + Math.random() * 1.5;
      s.monster = true;
      s.headJerk = 1;
      jl.on = false;
      musSting();
    }
  } else {
    jl.on = false;
    s.monster = true;
    s.headJerk = 1;
    if (menuM.dur === Infinity && p < 1) menuM.dur = 0.7; /* сложность снизили прямо в меню */
    if (menuM.dur !== Infinity) {
      menuM.dur -= dt;
      if (menuM.dur <= 0) {
        menuM.phase = 'calm';
        menuM.t = 0;
        s.monster = false;
        s.headJerk = 0;
        jl.on = true;
      }
    }
  }
}
function menuTick(dt) {
  const s = menuS;
  s.time += dt;
  menuScenario(dt);
  menuLamps(s, dt);
}
/* фоновый рендер — на всё окно, но в умеренном разрешении (сцена всё равно под
   размытием): пропорции окна, высота ≤620, ширина ≤1700 */
function menuResize() {
  if (!menuS || !GPU.ready || gpuBusy) return;
  const a = innerWidth / Math.max(1, innerHeight);
  let h = 620,
    w = Math.round(h * a);
  if (w > 1700) {
    w = 1700;
    h = Math.round(w / a);
  }
  GPU.resize(w, h);
}
/* игровой рендер на весь экран: «пиксельный бюджет» пресета сохраняется, но
   пропорции берутся от окна — картинка без растяжения и без полос */
function gameResize() {
  if (!started || !GPU.ready || gpuBusy) return;
  const a = innerWidth / Math.max(1, innerHeight);
  const area = (Q.res[0] | 0) * (Q.res[1] | 0);
  const h = Math.max(200, Math.round(Math.sqrt(area / Math.max(0.4, a))));
  GPU.resize(Math.round(h * a), h);
}
async function menuBgStart() {
  if (menuBusy) return;
  menuBusy = true;
  menuS = null;
  try {
    Q = buildQ();
    const ms = menuMazeState();
    view.classList.add('menubg');
    view.classList.remove('pixelated');
    if (GPU.ready && !gpuBusy) GPU.clearBlack();
    if (await gpuInitQ(view, ms)) {
      menuS = ms;
      menuM = { phase: 'calm', t: 0, dur: 0, jl: ms.lamps[2] };
      menuResize();
      /* первый кадр — самая тяжёлая стадия (ленивая компиляция всех конвейеров):
   экран загрузки отмечает её отдельно */
      if (window.LDSTEP) await window.LDSTEP(0.98, 'первый кадр');
      if (GPU.ready) GPU.frame(menuS, 0);
    }
  } catch (e) {}
  menuBusy = false;
}

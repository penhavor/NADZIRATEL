'use strict';
/* Симуляция забега: движение и stamina, поза и шаг, фонарик, предметы, двери,
   тумбочки, комната-убежище, ИИ Надзирателя и сквозные прогоны автопилота.
   Всё проверяется на детерминированных состояниях без реального времени. */

(function () {
  const T = __T;
  const DT = 1 / 60;

  const EVTTBL = LIB.G('EVT');
  /* 'caught' и 'reload_start' ядро отправляет, но в UI-таблице EVT их нет:
     поимка ведёт прямо на экран смерти, у перезарядки нет сообщения */
  const KNOWN_EVENTS = (function () {
    const set = { caught: 1, reload_start: 1 };
    if (EVTTBL) for (const k in EVTTBL) set[k] = 1;
    return set;
  })();

  function checkEvents(ev, where) {
    if (!EVTTBL) return ev;
    for (const e of ev) T.eq(!!KNOWN_EVENTS[e], true, (where || '') + ': неизвестное событие ' + e);
    return ev;
  }

  /* открытая площадка r×r в центре карты: скорости и повороты без стен */
  function arena(cfg, r) {
    const R = r || 8;
    const s = LIB.run(
      Object.assign(
        {
          seed: 'arena',
          W: R * 2 + 2,
          H: R * 2 + 2,
          density: 0,
          cabDens: 0,
          loot: 0,
          monster: false
        },
        cfg || {}
      )
    );
    const cx = (s.W / 2) | 0,
      cy = (s.H / 2) | 0;
    for (let y = cy - R; y <= cy + R; y++)
      for (let x = cx - R; x <= cx + R; x++) s.grid[y * s.W + x] = 0;
    s.px = cx + 0.5;
    s.py = cy + 0.5;
    s.ang = 0;
    s.pitch = 0;
    s._boxes = [boxOf(s.table, TBL_D, TBL_W)];
    s.darkT = 0;
    updateLamps(s, 0);
    s._cx = cx;
    s._cy = cy;
    return s;
  }

  /* навести взгляд на объект: перебор позиции/направления/угла наклона,
     потому что высота глаз (0.55) выше низких предметов — нужен наклон вниз */
  function aimAt(s, kind, place) {
    const pitches = [0, -0.4, -0.6, -0.7, -0.8, -0.9, -1.0];
    for (const p of place) {
      for (const pitch of pitches) {
        s.px = p.px;
        s.py = p.py;
        s.ang = p.ang;
        s.pitch = pitch;
        update(s, {}, DT);
        if (s.aimT && s.aimT.t === kind && (!p.want || p.want(s.aimT))) return pitch;
      }
    }
    return null;
  }

  T.test('симуляция: время, шаги и пройденный путь', function () {
    const s = arena();
    T.eq(s.time, 0, 'время в начале');
    update(s, {}, 0);
    T.eq(s.time, 0, 'нулевой dt сдвинул время');
    const x0 = s.px;
    update(s, { fwd: 1 }, DT);
    T.near(s.time, DT, 1e-12, 'время после кадра');
    T.ok(s.px > x0, 'игрок не сдвинулся');
    T.near(s.steps, s.px - x0, 1e-9, 'steps не совпадают с перемещением');
    /* за секунду ходьбы — WALK_SP клеток */
    const s2 = arena();
    for (let i = 0; i < 60; i++) update(s2, { fwd: 1 }, DT);
    T.near(s2.steps, WALK_SP, WALK_SP * 0.02, 'путь за секунду ходьбы');
    T.near(s2.time, 1, 1e-9, 'время за 60 кадров');
    /* бег быстрее ходьбы */
    const s3 = arena();
    for (let i = 0; i < 60; i++) update(s3, { fwd: 1, run: 1 }, DT);
    T.near(s3.steps, RUN_SP, RUN_SP * 0.02, 'путь за секунду бега');
    T.ok(s3.steps / s2.steps > 2, 'бег не быстрее ходьбы вдвое');
    /* присед: сначала фильтр приседа (0.74 с) выходит на 1, затем скорость CROUCH_SP */
    const s4 = arena();
    for (let i = 0; i < 60; i++) update(s4, { crouch: 1 }, DT);
    T.near(s4.crC, 1, 0.01, 'crC не вышел на режим');
    for (let i = 0; i < 60; i++) update(s4, { fwd: 1, crouch: 1 }, DT);
    T.near(s4.steps, CROUCH_SP, CROUCH_SP * 0.05, 'путь за секунду приседа');
    T.ok(s4.steps < s2.steps * 0.5, 'присед не медленнее ходьбы');
    /* поворот на месте не даёт пути */
    const s5 = arena();
    for (let i = 0; i < 60; i++) update(s5, { turnL: 1 }, DT);
    T.eq(s5.steps, 0, 'поворот дал пройденный путь');
    T.ok(s5.ang !== 0, 'поворот не изменил угол');
    /* диагональ не быстрее оси: вектор нормируется */
    const s6 = arena();
    for (let i = 0; i < 60; i++) update(s6, { fwd: 1, right: 1 }, DT);
    T.near(s6.steps, WALK_SP, WALK_SP * 0.02, 'диагональ быстрее прямого хода');
  });

  T.test('симуляция: stamina — 15 с бега, 30 с отдыха, истощение', function () {
    const s = arena();
    T.eq(s.stam, 1, 'стамина в начале');
    for (let i = 0; i < 60; i++) update(s, { fwd: 1, run: 1 }, DT);
    T.near(s.stam, 1 - 1 / 15, 1e-6, 'расход за секунду бега');
    for (let i = 0; i < 60; i++) update(s, {}, DT);
    T.near(s.stam, 1 - 1 / 15 + 1 / 30, 1e-6, 'восстановление за секунду покоя');
    /* ходьба восстанавливает силы (зигзаг: 20 с бега уводят далеко от центра) */
    for (let i = 0; i < 1200; i++) update(s, i % 60 < 30 ? { fwd: 1 } : { back: 1 }, DT);
    T.near(s.stam, 1, 1e-9, 'стамина не восстановилась при ходьбе');
    /* бег до истощения: зигзаг на месте, иначе игрок упрётся в край площадки */
    const zig = (i, run) =>
      i % 60 < 30 ? { fwd: 1, run: run ? 1 : 0 } : { back: 1, run: run ? 1 : 0 };
    const ev = [];
    let frames = 0;
    for (let i = 0; i < 60 * 20; i++) {
      const e = update(s, zig(i, true), DT);
      frames++;
      if (e && e.length) for (const x of e) ev.push(x);
      if (s.exhausted) break;
    }
    T.eq(s.stam, 0, 'стамина не дошла до нуля');
    T.eq(s.exhausted, true, 'истощение не наступило');
    T.near(frames, 15 * 60, 2, 'кадров до истощения: ' + frames);
    T.ok(ev.indexOf('exhausted') >= 0, 'нет события exhausted');
    checkEvents(ev, 'истощение');
    /* бег больше не ускоряет */
    const before = s.steps;
    for (let i = 0; i < 60; i++) update(s, zig(i, true), DT);
    T.near(s.steps - before, WALK_SP, WALK_SP * 0.05, 'истощённый игрок бежит');
    T.eq(s.runNow, 0, 'runNow при истощении');
    /* выход из истощения — на 25% стамины */
    for (let i = 0; i < 60 * 8; i++) update(s, {}, DT);
    T.ok(s.stam > 0.25, 'стамина не поднялась: ' + s.stam);
    T.eq(s.exhausted, false, 'истощение не снято');
    /* присед с зажатым Shift не тратит силы (бег отменён) */
    const s2 = arena();
    for (let i = 0; i < 60; i++) update(s2, { fwd: 1, run: 1, crouch: 1 }, DT);
    T.near(s2.stam, 1, 1e-9, 'стамина тратилась при приседании');
    T.eq(s2.runNow, 0, 'runNow при приседе');
    T.near(s2.pCrouch, 1, 0.02, 'игрок не присел');
  });

  T.test('симуляция: поза, фаза шага и покачивание камеры', function () {
    const s = arena();
    T.eq(s.pCrouch, 0, 'присед в начале');
    for (let i = 0; i < 30; i++) update(s, { crouch: 1 }, DT);
    T.ok(s.pCrouch > 0.8, 'присед не дошёл: ' + s.pCrouch);
    for (let i = 0; i < 60; i++) update(s, {}, DT);
    T.near(s.pCrouch, 0, 1e-3, 'игрок не встал');
    /* фаза шага растёт с пройденным путём, а не со временем */
    const k0 = s.animPhase;
    for (let i = 0; i < 60; i++) update(s, {}, DT);
    T.eq(s.animPhase, k0, 'фаза шага растёт на месте');
    for (let i = 0; i < 60; i++) update(s, { fwd: 1 }, DT);
    T.near(s.animPhase - k0, s.steps * GAIT_K.walk, 1e-6, 'фаза не связана с путём');
    T.ok(s.bobA > 0.9, 'покачивание камеры не вышло на режим: ' + s.bobA);
    /* бег идёт со своим коэффициентом (шаг длиннее — рад/клетку может быть меньше) */
    T.ok(GAIT_K.run > 0 && GAIT_K.walk > 0 && GAIT_K.sneak > 0, 'коэффициенты походок');
    T.neq(GAIT_K.run, GAIT_K.walk, 'бег и шаг с одним коэффициентом');
    const s3 = arena();
    for (let i = 0; i < 60; i++) update(s3, { fwd: 1, run: 1 }, DT);
    T.near(s3.animPhase, s3.steps * GAIT_K.run, 1e-6, 'фаза бега');
    /* движение назад даёт отрицательную фазу */
    const s4 = arena();
    for (let i = 0; i < 60; i++) update(s4, { back: 1 }, DT);
    T.ok(s4.animPhase < 0, 'фаза при движении назад: ' + s4.animPhase);
    T.ok(s4.steps > 0, 'путь назад не считается');
    /* желаемая анимация соответствует состоянию (runK сглаживает boot.js) */
    T.eq(s4.pAnimWant, 'walk', 'pAnimWant при ходьбе назад');
    const s5 = arena();
    update(s5, {}, DT);
    T.eq(s5.pAnimWant, 'idle', 'pAnimWant в покое');
    const s6 = arena();
    s6.runK = 1;
    for (let i = 0; i < 10; i++) update(s6, { fwd: 1, run: 1 }, DT);
    T.eq(s6.pAnimWant, 'run', 'pAnimWant при беге');
    const s7 = arena();
    for (let i = 0; i < 10; i++) update(s7, { crouch: 1 }, DT);
    T.eq(s7.pAnimWant, 'crouch', 'pAnimWant при приседе');
    T.ok(animNames().indexOf(s7.pAnimWant) >= 0, 'желаемой анимации нет среди клипов');
    /* присед в движении — sneak */
    for (let i = 0; i < 40; i++) update(s7, { crouch: 1, fwd: 1 }, DT);
    T.eq(s7.pAnimWant, 'sneak', 'pAnimWant при ходьбе в приседе');
  });

  T.test('симуляция: фонарик тратит заряд, гаснет и заряжается', function () {
    const s = arena();
    const ev = [];
    for (const e of LIB.frames(s, { flash: 1 }, 3)) ev.push(e);
    checkEvents(ev, 'фонарь без предмета');
    T.ok(ev.indexOf('flash_none') >= 0, 'нет события flash_none');
    T.eq(s.fl.on, false, 'фонарь включился без предмета');
    /* включаем: фонарик должен быть В РУКЕ */
    s.fl.owned = true;
    invAdd(s, 'flash');
    invSelectKind(s, 'flash');
    s.fl.e = 1;
    const ev2 = LIB.frames(s, { flash: 1 }, 1);
    T.deepEq(ev2, ['flash_on'], 'включение');
    T.eq(s.fl.on, true, 'фонарь не включился');
    const ev3 = LIB.frames(s, { flash: 1 }, 1);
    T.deepEq(ev3, ['flash_off'], 'выключение');
    T.eq(s.fl.on, false, 'фонарь не выключился');
    /* расход: FL_CAP секунд непрерывного света */
    s.fl.on = true;
    s.fl.e = 1;
    LIB.frames(s, {}, 60);
    T.near(s.fl.e, 1 - 1 / FL_CAP, 1e-6, 'расход за секунду');
    T.ok(s.fl.bri > 0.5, 'яркость включённого фонаря: ' + s.fl.bri);
    LIB.frames(s, {}, 60 * 60);
    T.near(s.fl.e, 1 - 61 / FL_CAP, 1e-5, 'расход за минуту');
    /* выключенный фонарь заряд не тратит */
    s.fl.on = false;
    const e0 = s.fl.e;
    LIB.frames(s, {}, 600);
    T.eq(s.fl.e, e0, 'заряд тратился в выключенном состоянии');
    T.eq(s.fl.bri, 0, 'яркость выключенного фонаря');
    /* разрядка до нуля */
    s.fl.on = true;
    s.fl.e = 0.001;
    const ev4 = LIB.frames(s, {}, 60);
    checkEvents(ev4, 'разрядка');
    T.eq(s.fl.e, 0, 'заряд не дошёл до нуля');
    T.eq(s.fl.on, false, 'фонарь остался включённым без заряда');
    T.ok(ev4.indexOf('flash_dead') >= 0, 'нет flash_dead: ' + ev4.join(','));
    const ev5 = LIB.frames(s, { flash: 1 }, 1);
    T.deepEq(ev5, ['flash_dead_try'], 'попытка включить мёртвый фонарь');
    /* перезарядка без батарейки невозможна */
    const ev6 = LIB.frames(s, { reload: 1 }, 1);
    checkEvents(ev6, 'перезарядка без батарейки');
    T.deepEq(ev6, ['no_batt'], 'событие перезарядки без батарейки');
    T.eq(s.fl.e, 0, 'заряд появился без батарейки');
    T.eq(s.fl.rl, 0, 'перезарядка началась без батарейки');
    /* с батарейкой — идёт RL_DUR и возвращает полный заряд */
    invAdd(s, 'batt');
    T.eq(invCount(s, 'batt'), 1, 'батарейка не добавилась');
    const ev7 = LIB.frames(s, { reload: 1 }, 3);
    T.deepEq(ev7, ['reload_start'], 'начало перезарядки');
    T.eq(invCount(s, 'batt'), 0, 'батарейка не израсходована');
    T.ok(s.fl.rl > 0, 'перезарядка не идёт');
    T.near(s.fl.rl, RL_DUR, 0.08, 'оставшееся время перезарядки');
    T.eq(s.fl.on, false, 'фонарь горит во время перезарядки');
    const ev8 = LIB.frames(s, {}, Math.ceil(RL_DUR * 60) + 10);
    checkEvents(ev8, 'перезарядка');
    T.eq(s.fl.rl, 0, 'перезарядка не закончилась');
    T.near(s.fl.e, 1, 1e-9, 'заряд не восстановился');
    T.ok(ev8.indexOf('batt_in') >= 0, 'нет batt_in: ' + ev8.join(','));
    T.ok(ev8.indexOf('reload_done') >= 0, 'нет reload_done: ' + ev8.join(','));
    /* во время перезарядки руки заняты */
    const s2 = arena();
    s2.fl.owned = true;
    s2.fl.e = 0;
    invAdd(s2, 'flash');
    invSelectKind(s2, 'flash');
    s2.fl.rl = 1;
    const evBusy = LIB.frames(s2, { interact: 1 }, 1);
    T.deepEq(evBusy, ['hands_busy'], 'действия во время перезарядки');
  });

  T.test('симуляция: предмет можно бросить и поднять с пола', function () {
    const s = arena();
    invAdd(s, 'flash');
    invSelectKind(s, 'flash');
    s.fl.owned = true;
    T.eq(invCount(s, 'flash'), 1, 'фонарь не в инвентаре');
    /* бросок запускается перекладыванием с флагом drop */
    T.eq(invSwapTo(s, s.sel, false, true), true, 'бросок не начался');
    const ev = LIB.frames(s, {}, Math.ceil(SW_DUR * 60) + 5);
    checkEvents(ev, 'бросок');
    T.ok(ev.indexOf('drop_item') >= 0, 'нет drop_item: ' + ev.join(','));
    T.eq(s.drops.length, 1, 'предмет не лёг на пол');
    T.eq(s.inv[0], null, 'слот не освободился');
    T.eq(invCount(s, 'flash'), 0, 'фонарь остался в инвентаре');
    T.eq(invSelKind(s), null, 'рука не опустела');
    const dr = s.drops[0];
    T.eq(dr.kind, 'flash', 'что брошено');
    T.finite(dr.wx, 'wx предмета');
    T.finite(dr.wy, 'wy предмета');
    T.near(Math.hypot(dr.wx - s.px, dr.wy - s.py), 0.55, 0.3, 'предмет лёг не перед игроком');
    /* подбираем: предмет низкий (h=0.08) — нужен взгляд вниз */
    const places = [];
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      places.push({
        px: dr.wx + Math.cos(a) * 0.35,
        py: dr.wy + Math.sin(a) * 0.35,
        ang: Math.atan2(-Math.sin(a), -Math.cos(a))
      });
    }
    const pitch = aimAt(s, 'drop', places);
    T.ok(pitch !== null, 'брошенный предмет не попадает в прицел');
    const ev2 = LIB.frames(s, { interact: 1 }, Math.ceil(PK_DUR * 60) + 4);
    checkEvents(ev2, 'подбор с пола');
    T.ok(ev2.indexOf('pickup_flash') >= 0, 'нет pickup_flash: ' + ev2.join(','));
    T.eq(s.drops.length, 0, 'предмет остался на полу');
    T.eq(s.fl.owned, true, 'фонарь не вернулся в руки');
    /* sel переходит на предмет в апогее клипа подъёма (pkDefer), не мгновенно */
    T.eq(invSelKind(s), 'flash', 'фонарь не выбрался в руку');
    T.near(s.fl.e, dr.e, 1e-12, 'заряд подобранного фонаря потерян');
  });

  T.test('симуляция: фонарик берётся со стола в комнате убежища', function () {
    const s = LIB.run({
      seed: 'table',
      W: 10,
      H: 10,
      density: 0.3,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    T.eq(s.flashTaken, false, 'фонарик уже взят');
    const tb = boxCenter(s.table, TBL_D);
    const places = [];
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      for (const r of [0.28, 0.34, 0.4]) {
        places.push({
          px: tb.x + Math.cos(a) * r,
          py: tb.y + Math.sin(a) * r,
          ang: Math.atan2(-Math.sin(a), -Math.cos(a))
        });
      }
    }
    const pitch = aimAt(s, 'table', places);
    T.ok(pitch !== null, 'стол не попадает в прицел ни с одной стороны');
    T.ok(pitch < -0.3, 'стол виден без наклона взгляда: ' + pitch);
    const ev = LIB.frames(s, { interact: 1 }, 4);
    checkEvents(ev, 'подбор со стола');
    T.ok(ev.indexOf('pickup_flash') >= 0, 'нет pickup_flash: ' + ev.join(','));
    T.eq(s.flashTaken, true, 'фонарик не помечен взятым');
    T.eq(s.fl.owned, true, 'фонарик не в руках');
    T.eq(s.fl.e, 1, 'заряд подобранного фонарика');
    T.eq(invCount(s, 'flash'), 1, 'фонарика нет в инвентаре');
    /* второй раз взять нельзя */
    const ev2 = LIB.frames(s, { interact: 1 }, 4);
    T.eq(ev2.indexOf('pickup_flash'), -1, 'фонарик взялся дважды');
  });

  T.test('симуляция: тумбочка открывается, отдаёт ключ и закрывается', function () {
    const s = LIB.run({
      seed: 'cabrun',
      W: 14,
      H: 14,
      density: 0.3,
      cabDens: 0.4,
      loot: 100,
      monster: false
    });
    const cab = s.cabs.filter(c => c.content === 'key')[0];
    T.ok(cab, 'нет тумбочки с ключом');
    const cc = cabCenter(cab),
      f = cabFront(cab);
    const places = [];
    for (const r of [0.35, 0.4, 0.45]) {
      places.push({ px: cc.x + f.x * r, py: cc.y + f.y * r, ang: Math.atan2(-f.y, -f.x) });
    }
    const pitch = aimAt(s, 'cab', places);
    T.ok(pitch !== null, 'тумбочка не попадает в прицел с фасада');
    T.ok(pitch < -0.3, 'тумбочка видна без наклона взгляда: ' + pitch);
    T.eq(s.aimT.o, cab, 'в прицеле другая тумбочка');
    const ev = LIB.frames(s, { interact: 1 }, 1);
    checkEvents(ev, 'тумбочка');
    T.deepEq(ev, ['cab_open'], 'открытие ящика');
    T.eq(cab.want, 1, 'ящик не открылся');
    T.ok(cab.cd > 0, 'нет паузы между нажатиями E');
    /* ящик выезжает 0.5 с */
    LIB.frames(s, {}, 40);
    T.near(cab.open, 1, 0.25, 'ящик не выдвинулся: ' + cab.open);
    T.ok(cab.open >= 0.5, 'ящик не доехал до половины: ' + cab.open);
    /* содержимое забирается следующим нажатием */
    const ev2 = LIB.frames(s, { interact: 1 }, 4);
    checkEvents(ev2, 'лут');
    T.ok(ev2.indexOf('pickup_key') >= 0, 'нет pickup_key: ' + ev2.join(','));
    T.eq(s.hasKey, true, 'ключ не в руках');
    T.eq(cab.looted, true, 'тумбочка не помечена обобранной');
    T.eq(invCount(s, 'key'), 1, 'ключа нет в инвентаре');
    /* повторное нажатие закрывает ящик */
    LIB.frames(s, {}, 60);
    const ev3 = LIB.frames(s, { interact: 1 }, 1);
    checkEvents(ev3, 'закрытие');
    T.deepEq(ev3, ['cab_close'], 'закрытие ящика');
    T.eq(cab.want, 0, 'ящик не закрылся');
    LIB.frames(s, {}, 60);
    T.near(cab.open, 0, 1e-6, 'ящик не задвинулся: ' + cab.open);
    /* пустая тумбочка ключа не даёт (loot:0 — содержимого нет ни у кого) */
    const s2 = LIB.run({
      seed: 'cabempty',
      W: 14,
      H: 14,
      density: 0.3,
      cabDens: 0.4,
      loot: 0,
      monster: false
    });
    const empty = s2.cabs.filter(c => !c.content || c.content === 'none')[0];
    T.ok(empty, 'при loot:0 все тумбочки полны');
    const ec = cabCenter(empty),
      ef = cabFront(empty);
    const places2 = [];
    for (const r of [0.35, 0.4, 0.45]) {
      places2.push({
        px: ec.x + ef.x * r,
        py: ec.y + ef.y * r,
        ang: Math.atan2(-ef.y, -ef.x),
        want: t => t.o === empty
      });
    }
    const pitch2 = aimAt(s2, 'cab', places2);
    T.ok(pitch2 !== null, 'пустая тумбочка не попала в прицел');
    const ev4 = LIB.frames(s2, { interact: 1 }, 45);
    checkEvents(ev4, 'пустая тумбочка');
    T.ok(ev4.indexOf('cab_open') >= 0, 'пустая тумбочка не открылась: ' + ev4.join(','));
    T.eq(ev4.indexOf('pickup_key'), -1, 'пустая тумбочка дала ключ');
    T.eq(ev4.indexOf('pickup_batt'), -1, 'пустая тумбочка дала батарейку');
    T.eq(empty.looted, false, 'пустая тумбочка помечена обобранной');
  });

  T.test('симуляция: дверь выхода — ключ в руке, вентиль, створка, победа', function () {
    const s = LIB.run({
      seed: 'win',
      W: 12,
      H: 12,
      density: 0.3,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    const f = s.doorFace;
    T.ok(f && (f.x || f.y), 'нет направления двери');
    const stand = { x: s.door.x + 0.5 + f.x * 0.7, y: s.door.y + 0.5 + f.y * 0.7 };
    s.px = stand.x;
    s.py = stand.y;
    s.ang = Math.atan2(-f.y, -f.x);
    s.pitch = 0;
    update(s, {}, DT);
    T.ok(s.aimT && s.aimT.t === 'exit', 'дверь выхода не в прицеле: ' + JSON.stringify(s.aimT));
    /* без ключа */
    const ev0 = LIB.frames(s, { interact: 1 }, 1);
    T.deepEq(ev0, ['door_locked'], 'дверь без ключа');
    T.eq(s.doorOpen, false, 'дверь открылась без ключа');
    /* ключ есть, но не в руке */
    s.hasKey = true;
    invAdd(s, 'key');
    invAdd(s, 'flash');
    invSelectKind(s, 'flash');
    const ev1 = LIB.frames(s, { interact: 1 }, 1);
    T.deepEq(ev1, ['door_needhand'], 'ключ не в руке');
    T.eq(s.doorOpen, false, 'дверь открылась без ключа в руке');
    /* ключ в руке: вентиль */
    invSelectKind(s, 'key');
    T.eq(invSelKind(s), 'key', 'ключ не в руке');
    const ev2 = LIB.frames(s, { interact: 1 }, 1);
    checkEvents(ev2, 'вентиль');
    T.deepEq(ev2, ['door_unlock'], 'поворот вентиля');
    T.eq(s.doorOpen, true, 'дверь не начала открываться');
    T.ok(s.doorT > 0 && s.doorT < 0.05, 'doorT не начал расти: ' + s.doorT);
    /* 1.3 с на вентиль */
    LIB.frames(s, {}, 90);
    T.near(s.doorT, 1, 1e-6, 'doorT не дошёл до 1');
    T.eq(s.doorUnlocked, true, 'вентиль не довернул');
    /* раньше времени створка не толкается */
    s.doorT = 0.5;
    s.doorUnlocked = false;
    const evEarly = LIB.frames(s, { interact: 1 }, 1);
    T.eq(evEarly.length, 0, 'створка открылась до вентиля: ' + evEarly.join(','));
    LIB.frames(s, {}, 60);
    T.eq(s.doorUnlocked, true, 'вентиль не довернулся снова');
    /* створка */
    const ev3 = LIB.frames(s, { interact: 1 }, 3);
    T.ok(ev3.indexOf('door_open') >= 0, 'нет door_open: ' + ev3.join(','));
    T.eq(s.doorLeaf, true, 'створка не пошла');
    LIB.frames(s, {}, 70);
    T.near(s.doorLeafT, 1, 1e-6, 'створка не открылась');
    T.eq(cellAt(s, s.door.x + 0.5, s.door.y + 0.5), 0, 'клетка двери осталась закрытой');
    /* выход в комнату победы */
    s.ang = Math.atan2(-f.y, -f.x);
    const ev4 = LIB.frames(s, { fwd: 1 }, 180);
    checkEvents(ev4, 'выход');
    T.eq(s.won, true, 'победа не наступила');
    T.ok(ev4.indexOf('win') >= 0, 'нет события win: ' + ev4.join(','));
    const wc = s.winCell;
    T.ok(
      Math.hypot(s.px - (wc.x + 0.5), s.py - (wc.y + 0.5)) < 0.6,
      'игрок далеко от клетки победы'
    );
    /* после победы состояние стабильно */
    const won = LIB.snap(s);
    LIB.frames(s, { fwd: 1 }, 60);
    T.eq(s.won, true, 'победа отменилась');
    T.eq(s.caught, false, 'после победы поймали');
    T.eq(won.hasKey, s.hasKey, 'ключ пропал');
    T.eq(s.inv.filter(x => x && x.kind === 'key').length, 1, 'ключ исчез из инвентаря');
  });

  T.test('симуляция: дверь убежища — открыть, закрыть, не пустить монстра', function () {
    const s = LIB.run({
      seed: 'safe',
      W: 12,
      H: 12,
      density: 0.3,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    const d = s.safeDoors[0];
    T.ok(d, 'нет дверей убежища');
    T.eq(d.t, 0, 'дверь открыта в начале');
    T.eq(d.want, 0, 'дверь уже хочет открыться');
    /* встаём со стороны убежища: ≥0.26 от клетки двери, иначе закрытие запрещено.
       Позицию проверяем ПОСЛЕ resolveBoxes — стол и стены могут подвинуть игрока */
    const vx = s.start.x - d.x,
      vy = s.start.y - d.y,
      L = Math.hypot(vx, vy) || 1;
    let stood = false;
    for (const off of [0.8, 0.95, 1.1]) {
      s.px = d.x + 0.5 + (vx / L) * off;
      s.py = d.y + 0.5 + (vy / L) * off;
      s.ang = Math.atan2(d.y + 0.5 - s.py, d.x + 0.5 - s.px);
      s.pitch = 0;
      update(s, {}, DT);
      const qx = Math.max(d.x, Math.min(d.x + 1, s.px)),
        qy = Math.max(d.y, Math.min(d.y + 1, s.py));
      if (
        s.aimT &&
        s.aimT.t === 'safe' &&
        s.aimT.o === d &&
        Math.hypot(s.px - qx, s.py - qy) >= 0.3
      ) {
        stood = true;
        break;
      }
    }
    T.eq(
      stood,
      true,
      'не нашлось точки для закрытия двери (прицел ' + JSON.stringify(s.aimT) + ')'
    );
    const ev = LIB.frames(s, { interact: 1 }, 1);
    checkEvents(ev, 'дверь убежища');
    T.deepEq(ev, ['safe_open'], 'открытие двери убежища');
    T.eq(d.want, 1, 'дверь не захотела открыться');
    LIB.frames(s, {}, 40);
    T.near(d.t, 1, 1e-6, 'дверь не открылась');
    T.eq(safeOpenAt(s, d.x, d.y), true, 'safeOpenAt не видит открытую дверь');
    T.eq(s.grid[d.y * s.W + d.x], 3, 'клетка двери изменилась');
    /* закрыть можно, только отойдя от проёма */
    const ev2 = LIB.frames(s, { interact: 1 }, 1);
    T.deepEq(ev2, ['safe_close'], 'закрытие издалека');
    T.eq(d.want, 0, 'дверь не захотела закрыться');
    LIB.frames(s, {}, 40);
    T.near(d.t, 0, 1e-6, 'дверь не закрылась');
    T.eq(safeOpenAt(s, d.x, d.y), false, 'закрытая дверь проходимa');
    /* монстр внутри убежища — дверь открывается насильно, прятаться нельзя */
    const s2 = LIB.run({
      seed: 'safe',
      W: 12,
      H: 12,
      density: 0.3,
      cabDens: 0,
      loot: 0,
      monster: true
    });
    s2.mx = s2.start.x + 0.5;
    s2.my = s2.start.y + 0.5;
    const far = s2.mazeFloors[s2.mazeFloors.length - 1];
    s2.px = (far % s2.W) + 0.5;
    s2.py = ((far / s2.W) | 0) + 0.5;
    const d2 = s2.safeDoors[0];
    const ev3 = LIB.frames(s2, {}, 4);
    T.eq(s2.monInSafe, true, 'монстр не опознан в убежище');
    T.ok(ev3.indexOf('safe_forced_mon') >= 0, 'нет safe_forced_mon: ' + ev3.join(','));
    T.eq(d2.want, 1, 'дверь не открылась при монстре внутри');
    /* игрок в проёме — дверь дожимается сама */
    const s3 = LIB.run({
      seed: 'safe3',
      W: 12,
      H: 12,
      density: 0.3,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    const d3 = s3.safeDoors[0];
    s3.px = d3.x + 0.5;
    s3.py = d3.y + 0.5;
    const ev4 = LIB.frames(s3, {}, 2);
    T.ok(ev4.indexOf('safe_forced') >= 0, 'нет safe_forced: ' + ev4.join(','));
    T.eq(d3.want, 1, 'дверь не закрылась за игроком');
    LIB.frames(s3, {}, 60);
    T.near(d3.t, 1, 1e-6, 'дверь в проёме не дожалась');
    T.eq(safeOpenAt(s3, d3.x, d3.y), true, 'дверь в проёме осталась закрытой');
  });

  T.test('симуляция: Надзиратель видит игрока и переходит в погоню', function () {
    const s = arena({ monster: true, monsterSpeed: KMH(20) }, 7);
    s.px = s._cx + 0.5;
    s.py = s._cy + 0.5;
    s.mx = s.px;
    s.my = s.py + 4.5;
    /* yaw монстра отсчитывается от оси Y: atan2(dx,dy) */
    s.mYaw = Math.atan2(s.px - s.mx, s.py - s.my);
    T.eq(los(s, s.mx, s.my, s.px, s.py), true, 'нет линии видимости');
    T.eq(seesFrom(s, s.mx, s.my, s.mYaw), true, 'монстр не видит игрока в упор');
    /* вне конуса — не видит (расстояние больше радиуса периферии) */
    T.eq(seesFrom(s, s.mx, s.my, s.mYaw + Math.PI), false, 'монстр видит игрока спиной');
    T.eq(seesFrom(s, s.mx, s.my, s.mYaw + MON_FOV + 0.2), false, 'монстр видит вне конуса');
    /* вблизи видит даже спиной — периферическое зрение */
    s.mx = s.px + 0.3;
    s.my = s.py;
    T.eq(seesFrom(s, s.mx, s.my, 0), true, 'периферия не сработала');
    /* погоня до поимки */
    s.mx = s.px;
    s.my = s.py + 4.5;
    s.mYaw = Math.atan2(s.px - s.mx, s.py - s.my);
    const ev = [];
    let i = 0;
    for (; i < 60 * 30; i++) {
      const e = update(s, {}, DT);
      if (e && e.length) for (const x of e) ev.push(x);
      if (s.caught) break;
    }
    checkEvents(ev, 'погоня');
    T.ok(ev.indexOf('monster_seen') >= 0, 'нет monster_seen: ' + ev.slice(0, 6).join(','));
    T.eq(s.mMode, 'chase', 'режим ИИ: ' + s.mMode);
    T.ok(s.lastSeen, 'монстр потерял цель');
    T.eq(s.caught, true, 'монстр не догнал игрока за 30 с');
    T.ok(ev.indexOf('caught') >= 0, 'нет события caught');
    T.ok(
      Math.hypot(s.mx - s.px, s.my - s.py) < 1.5,
      'монстр далеко от игрока: ' + Math.hypot(s.mx - s.px, s.my - s.py)
    );
    T.ok(i < 60 * 10, 'погоня затянулась: ' + i + ' кадров');
    /* скорость монстра из настроек */
    T.near(s.monsterSpeed, KMH(20), 1e-12, 'скорость');
    T.ok(s.mSpeedNow > 0, 'монстр не двигался');
    T.ok(s.mGait === 'run' || s.mGait === 'walk', 'неизвестная походка: ' + s.mGait);
  });

  T.test('симуляция: без видимости монстр бродит, а шум отправляет его на поиск', function () {
    /* площадка со стеной между игроком и монстром: шум слышен, игрока не видно */
    const s = arena({ monster: true, monsterSpeed: KMH(12) }, 6);
    const cx = s._cx,
      cy = s._cy;
    for (let y = cy - 1; y <= cy + 1; y++) s.grid[y * s.W + (cx + 2)] = 1;
    s.px = cx + 0.5;
    s.py = cy + 0.5;
    s.ang = Math.PI / 2; /* бег вдоль стены, в открытую зону */
    s.mx = cx + 3.5;
    s.my = cy + 0.5;
    s.mYaw = Math.atan2(-1, 0);
    T.eq(los(s, s.mx, s.my, s.px, s.py), false, 'стена не перекрыла видимость');
    T.eq(seesFrom(s, s.mx, s.my, s.mYaw), false, 'монстр видит игрока сквозь стену');
    const ev = [];
    for (let i = 0; i < 20; i++) {
      const e = update(s, { fwd: 1, run: 1 }, DT);
      if (e && e.length) for (const x of e) ev.push(x);
      if (ev.indexOf('monster_heard') >= 0) break;
    }
    checkEvents(ev, 'шум');
    T.ok(ev.indexOf('monster_heard') >= 0, 'монстр не услышал бег: ' + ev.join(','));
    T.eq(s.mMode, 'investigate', 'режим после шума: ' + s.mMode);
    T.ok(s.noiseCd > 0, 'шум не ушёл в откат');
    T.near(s.noiseR, RUN_NOISE, 1e-9, 'радиус шума бега');
    T.deepEq(s.noisePos, { x: cx, y: cy }, 'позиция шума');
    /* ходьба не шумит */
    const s2 = arena({ monster: false }, 6);
    LIB.frames(s2, { fwd: 1 }, 60);
    T.eq(s2.noiseR, 0, 'ходьба шумит как бег');
    /* бег на месте не шумит */
    const s3 = arena({ monster: false }, 6);
    LIB.frames(s3, { run: 1 }, 60);
    T.eq(s3.noiseR, 0, 'бег на месте шумит');
    /* присед с бегом не шумит */
    const s4 = arena({ monster: false }, 6);
    LIB.frames(s4, { fwd: 1, run: 1, crouch: 1 }, 60);
    T.eq(s4.noiseR, 0, 'бег в приседе шумит');
  });

  T.test('симуляция: телепорт тени работает только в темноте и с откатом', function () {
    const s = LIB.run({
      seed: 'tp',
      W: 20,
      H: 20,
      density: 0,
      cabDens: 0,
      loot: 0,
      monster: true,
      teleport: true
    });
    updateLamps(s, 0);
    const dk = (function () {
      for (const idx of s.mazeFloors) {
        const x = (idx % s.W) + 0.5,
          y = ((idx / s.W) | 0) + 0.5;
        s.px = x;
        s.py = y;
        if (playerInDark(s)) return { x, y };
      }
      return null;
    })();
    T.ok(dk, 'на карте без ламп нет тёмной клетки');
    s.px = dk.x;
    s.py = dk.y;
    s.darkT = DARK_HALLU_T + 1;
    s.tpCd = 0;
    const ev = LIB.frames(s, {}, 60 * 10);
    checkEvents(ev, 'телепорт');
    T.ok(ev.indexOf('shadow_teleport') >= 0, 'телепорта не было: ' + ev.slice(0, 5).join(','));
    T.ok(s.tpCd > 0, 'откат телепорта не выставлен');
    T.eq(cellAt(s, s.mx, s.my) === 1 && !s.mTele, false, 'монстр телепортировался в стену');
    /* с включённым фонарём телепорта нет */
    const s2 = LIB.run({
      seed: 'tp',
      W: 20,
      H: 20,
      density: 0,
      cabDens: 0,
      loot: 0,
      monster: true,
      teleport: true
    });
    updateLamps(s2, 0);
    s2.px = dk.x;
    s2.py = dk.y;
    s2.darkT = DARK_HALLU_T + 1;
    s2.tpCd = 0;
    s2.fl.owned = true;
    s2.fl.on = true;
    s2.fl.e = 1;
    invAdd(s2, 'flash');
    invSelectKind(s2, 'flash');
    update(s2, {}, DT);
    T.eq(playerInDark(s2), false, 'с фонарём темно');
    const ev2 = LIB.frames(s2, {}, 60 * 10);
    T.eq(ev2.indexOf('shadow_teleport'), -1, 'телепорт случился при включённом фонаре');
    T.eq(s2.darkT, 0, 'darkT не сбрасывается на свету');
    /* без teleport в настройках — тоже */
    const s3 = LIB.run({
      seed: 'tp',
      W: 20,
      H: 20,
      density: 0,
      cabDens: 0,
      loot: 0,
      monster: true,
      teleport: false
    });
    s3.px = dk.x;
    s3.py = dk.y;
    s3.darkT = DARK_HALLU_T + 1;
    s3.tpCd = 0;
    const ev3 = LIB.frames(s3, {}, 60 * 10);
    T.eq(ev3.indexOf('shadow_teleport'), -1, 'телепорт при teleport:false');
  });

  T.test('симуляция: автопилот доходит до выхода и побеждает', function () {
    const cfg = {
      seed: 'botwin',
      W: 10,
      H: 10,
      monster: false,
      density: 0.5,
      cabDens: 0.25,
      loot: 100,
      map: mapCfg({ mon: true, key: true })
    };
    const r = __T.SIM.botRun(cfg, { frames: 60 * 240 });
    T.eq(r.errs.length, 0, 'нарушены инварианты: ' + r.errs.slice(0, 3).join(' | '));
    T.eq(r.won, true, 'забег не выигран за ' + r.frames + ' кадров');
    T.eq(r.caught, false, 'игрока поймали');
    T.eq(r.hasKey, true, 'ключ не подобран');
    checkEvents(r.events, 'автопилот');
    for (const e of ['pickup_flash', 'cab_open', 'pickup_key', 'door_unlock', 'door_open', 'win']) {
      T.ok(r.events.indexOf(e) >= 0, 'в забеге не было ' + e + ': ' + r.events.join(','));
    }
    T.ok(r.time > 5, 'забег подозрительно короткий: ' + r.time);
    T.ok(r.steps > 5, 'игрок почти не ходил: ' + r.steps);
    /* детерминированность */
    const r2 = __T.SIM.botRun(cfg, { frames: 60 * 240 });
    T.eq(r2.digest, r.digest, 'прогоны разошлись');
    T.eq(r2.frames, r.frames, 'число кадров разошлось');
    T.eq(r2.events.join(','), r.events.join(','), 'события разошлись');
  });

  T.test('симуляция: с Надзирателем автопилот играет честно, инварианты целы', function () {
    for (const cfg of [
      {
        seed: 'botmon1',
        W: 14,
        H: 14,
        monster: true,
        monsterSpeed: KMH(12),
        density: 0.35,
        cabDens: 0.1,
        loot: 60
      },
      {
        seed: 'botmon2',
        W: 12,
        H: 12,
        monster: true,
        monsterSpeed: KMH(30),
        teleport: true,
        density: 0.3,
        cabDens: 0.2,
        loot: 100
      }
    ]) {
      const r = __T.SIM.botRun(cfg, { frames: 60 * 180 });
      T.eq(r.errs.length, 0, cfg.seed + ': нарушены инварианты: ' + r.errs.slice(0, 3).join(' | '));
      T.eq(r.won && r.caught, false, cfg.seed + ': одновременно победа и поимка');
      T.ok(r.frames > 60, cfg.seed + ': забег оборвался сразу');
      checkEvents(r.events, cfg.seed);
      T.inRange(r.s.stam, 0, 1, cfg.seed + ': стамина');
      T.inRange(r.s.fl.e, 0, 1, cfg.seed + ': заряд');
      T.eq(r.s.inv.length, INV_SLOTS, cfg.seed + ': инвентарь');
      T.eq(cellAt(r.s, r.s.px, r.s.py) === 1, false, cfg.seed + ': игрок в стене');
    }
  });

  T.test('симуляция: хаотичный ввод не ломает инвариант на разных сидах', function () {
    for (const seed of ['chaos-1', 'chaos-2', 'ключ', 'zzz']) {
      const r = __T.SIM.chaosRun(
        {
          seed: seed,
          W: 12,
          H: 12,
          monster: true,
          monsterSpeed: KMH(25),
          teleport: true,
          density: 0.4,
          cabDens: 0.25,
          loot: 80
        },
        3600,
        seed.length * 7919
      );
      T.eq(r.errs.length, 0, seed + ': ' + r.errs.slice(0, 3).join(' | '));
      T.eq(r.won && r.caught, false, seed + ': победа и поимка вместе');
      const s = r.s;
      T.finite(s.px, seed + ': px');
      T.finite(s.py, seed + ': py');
      T.finite(s.time, seed + ': time');
      T.ok(s.time > 0, seed + ': время не шло');
      T.inRange(s.stam, 0, 1, seed + ': стамина');
      T.inRange(s.fl.e, 0, 1, seed + ': заряд');
      for (const it of s.inv)
        if (it && it.kind === 'batt') T.inRange(it.n, 1, BATT_STACK, seed + ': стак');
    }
  });

  T.test('симуляция: одинаковый ввод даёт одинаковый забег', function () {
    const script = [
      { n: 45, inp: { fwd: 1 } },
      { n: 20, inp: { fwd: 1, run: 1 } },
      { n: 15, inp: { turnR: 1 } },
      { n: 30, inp: { fwd: 1, interact: 1 } },
      { n: 20, inp: { crouch: 1, back: 1 } },
      { n: 60, inp: { fwd: 1, flash: 1 } }
    ];
    const cfg = {
      seed: 'replay',
      W: 12,
      H: 12,
      monster: false,
      density: 0.35,
      cabDens: 0.2,
      loot: 100
    };
    const total = script.reduce((a, x) => a + x.n, 0);
    const a = __T.SIM.scriptRun(cfg, script, {});
    const b = __T.SIM.scriptRun(cfg, script, {});
    T.eq(a.errs.length, 0, 'инварианты: ' + a.errs.slice(0, 3).join(' | '));
    T.eq(a.frames, total, 'прогон оборвался рано: ' + a.frames);
    T.eq(a.digest, b.digest, 'два одинаковых прогона разошлись');
    T.eq(a.events.join(','), b.events.join(','), 'события');
    T.near(a.s.px, b.s.px, 0, 'px');
    T.near(a.s.py, b.s.py, 0, 'py');
    /* другой ввод меняет забег */
    const c = __T.SIM.scriptRun(cfg, [{ n: 10, inp: { turnL: 1 } }].concat(script), {});
    T.neq(c.digest, a.digest, 'забег не зависит от ввода');
    /* dt вдвое короче при том числе кадров даёт вдвое меньше времени */
    const d = __T.SIM.scriptRun(cfg, script, { dt: 1 / 120 });
    T.eq(d.frames, total, 'прогон на dt/2 оборвался');
    T.near(d.s.time, a.s.time / 2, 1e-9, 'время не пропорционально dt');
  });

  T.test('симуляция: максимальный dt кадра не пробивает стены и не ломает состояние', function () {
    const s = LIB.run({
      seed: 'bigdt',
      W: 14,
      H: 14,
      density: 0.4,
      cabDens: 0.3,
      loot: 100,
      monster: true
    });
    const errs = [];
    for (let i = 0; i < 1200; i++) {
      const inp = {
        fwd: i % 3 ? 1 : 0,
        run: i % 5 ? 1 : 0,
        left: i % 7 ? 1 : 0,
        interact: i % 11 ? 0 : 1
      };
      const ev = update(s, inp, 0.05); /* потолок dt из boot.js */
      if (ev && ev.length) checkEvents(ev, 'кадр ' + i);
      __T.SIM.check(s, errs, i);
      if (errs.length) break;
    }
    T.eq(errs.length, 0, 'инварианты на крупном dt: ' + errs.slice(0, 3).join(' | '));
    T.near(s.time, 1200 * 0.05, 1e-6, 'время');
    T.eq(cellAt(s, s.px, s.py) === 1, false, 'игрок в стене');
    /* нулевой dt ничего не меняет */
    const snap = LIB.snap(s);
    update(s, { fwd: 1, run: 1 }, 0);
    const after = LIB.snap(s);
    T.eq(after.time, snap.time, 'время сдвинулось');
    T.eq(after.px, snap.px, 'позиция сдвинулась');
    T.eq(after.py, snap.py, 'позиция Y сдвинулась');
    T.eq(after.stam, snap.stam, 'стамина изменилась');
    T.eq(after.steps, snap.steps, 'путь изменился');
    T.eq(after.doorT, snap.doorT, 'дверь изменилась');
    T.eq(after.inv, snap.inv, 'инвентарь изменился');
  });
})();

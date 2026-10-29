'use strict';
/* Конфигурация: масштаб мира, скорости, пресеты сложности и графики, настройки
   и их сохранение. Здесь же проверяются «честные» инварианты из комментариев
   config.js — их нарушение ломает и ощущения, и баланс. */

(function () {
  const T = __T;

  T.test('config: масштаб — рост героя ровно 1.80 м, потолок 3.5 м', function () {
    T.near(CELL_M, 2.94225, 1e-9, 'CELL_M');
    T.near(1.773 * 0.345 * CELL_M, 1.8, 0.001, 'рост героя в метрах');
    T.near(CEIL_H * CELL_M, 3.5, 1e-9, 'потолок в метрах');
    T.ok(LAMP_Y < CEIL_H, 'лампа выше потолка');
    T.near(CEIL_H - LAMP_Y, 0.1, 1e-9, 'подвес лампы 0.10 клетки');
    T.ok(DOOR_H <= CEIL_H, 'дверь выше проёма');
    T.near(CEIL_H - DOOR_H, 0.002, 1e-9, 'зазор над дверью');
  });

  T.test('config: KMH переводит км/ч в клетки/с', function () {
    T.eq(KMH(0), 0, 'ноль');
    T.near(KMH(3.6 * CELL_M), 1, 1e-12, 'одна клетка в секунду');
    T.near(KMH(7), 7 / 3.6 / CELL_M, 1e-12, '7 км/ч');
    T.ok(KMH(20) > KMH(7), 'монотонность');
    T.near(KMH(100) / KMH(50), 2, 1e-12, 'линейность');
  });

  T.test('config: скорости ходьбы, бега и приседа согласованы', function () {
    T.near(WALK_SP, KMH(7), 1e-12, 'ходьба 7 км/ч');
    T.near(RUN_SP, KMH(20), 1e-12, 'бег 20 км/ч');
    T.ok(CROUCH_SP < WALK_SP, 'присед медленнее ходьбы');
    T.ok(CROUCH_SP > 0, 'присед не стоит на месте');
    T.ok(MON_WALK > 0, 'скорость Надзирателя');
    T.ok(RUN_NOISE > 0, 'радиус шума бега');
    /* бегущий игрок быстрее шагающего монстра, иначе игра непроходима */
    T.ok(RUN_SP > MON_WALK, 'игрок не убегает от монстра');
  });

  T.test('config: wrapPi заворачивает угол в [-π,π]', function () {
    for (const a of [0, 1, -1, Math.PI, -Math.PI, 7.5, -7.5, 1e3, -1e3, 0.0001]) {
      const w = wrapPi(a);
      T.ok(w >= -Math.PI - 1e-12 && w <= Math.PI + 1e-12, 'wrapPi(' + a + ') = ' + w);
      T.near(Math.cos(w), Math.cos(a), 1e-9, 'косинус сохраняется для ' + a);
      T.near(Math.sin(w), Math.sin(a), 1e-9, 'синус сохраняется для ' + a);
    }
  });

  T.test('config: MAP_DEF и mapCfg — копия с точечными правками', function () {
    const def = JSON.stringify(MAP_DEF);
    T.eq(Object.keys(MAP_DEF).length, 8, 'число переключателей карты');
    for (const k of ['on', 'unexp', 'mon', 'lamps', 'cabs', 'key', 'spawn', 'exit']) {
      T.eq(typeof MAP_DEF[k], 'boolean', 'тип ' + k);
    }
    const c = mapCfg({ mon: true, key: true });
    T.eq(c.mon, true, 'mon');
    T.eq(c.key, true, 'key');
    T.eq(c.on, MAP_DEF.on, 'остальное из MAP_DEF');
    T.eq(JSON.stringify(MAP_DEF), def, 'mapCfg изменил MAP_DEF');
    T.eq(JSON.stringify(mapCfg()), def, 'mapCfg() без аргумента');
    /* правки не накапливаются между вызовами */
    T.eq(mapCfg({ on: false }).on, false, 'первый вызов');
    T.eq(mapCfg({}).on, MAP_DEF.on, 'второй вызов унаследовал правку');
  });

  T.test('config: шесть пресетов сложности с корректными полями', function () {
    const names = ['practice', 'easy', 'medium', 'hard', 'extreme', 'impossible'];
    T.deepEq(Object.keys(PRESETS), names, 'состав пресетов');
    for (const n of names) {
      const p = PRESETS[n];
      T.inRange(p.W, 1, 100, n + '.W');
      T.inRange(p.H, 1, 100, n + '.H');
      T.inRange(p.density, 0, 1, n + '.density');
      T.inRange(p.cabD, 0, 1, n + '.cabD');
      T.inRange(p.loot, 0, 100, n + '.loot');
      T.eq(typeof p.monster, 'boolean', n + '.monster');
      T.eq(typeof p.teleport, 'boolean', n + '.teleport');
      T.finite(p.monsterSpeed, n + '.monsterSpeed');
      T.ok(p.monsterSpeed > 0, n + ': скорость монстра положительна');
      T.eq(typeof p.map, 'object', n + '.map');
      for (const k in MAP_DEF) T.eq(typeof p.map[k], 'boolean', n + '.map.' + k);
    }
  });

  T.test('config: лестница сложности монотонна', function () {
    const order = ['practice', 'easy', 'medium', 'hard', 'extreme', 'impossible'];
    for (let i = 1; i < order.length; i++) {
      const a = PRESETS[order[i - 1]],
        b = PRESETS[order[i]];
      T.ok(b.W * b.H >= a.W * a.H, order[i] + ': карта меньше предыдущей');
      T.ok(b.monsterSpeed >= a.monsterSpeed, order[i] + ': монстр медленнее');
      T.ok(b.loot <= a.loot, order[i] + ': лута больше');
      T.ok(b.density <= a.density, order[i] + ': лабиринт плотнее');
    }
    T.eq(PRESETS.practice.monster, false, 'на практике монстра нет');
    T.eq(PRESETS.impossible.density, 0, 'невозможный уровень — открытое поле');
    T.ok(PRESETS.hard.teleport && PRESETS.extreme.teleport, 'телепорт тени с hard');
  });

  T.test('config: пресеты графики содержат все параметры QSIG', function () {
    const ladder = ['low', 'medium', 'high', 'ultra', 'max'];
    for (const n of ladder) {
      const q = QUALITY[n];
      T.ok(q, 'нет пресета ' + n);
      for (const k of QSIG) T.ok(q[k] !== undefined, n + ': нет параметра ' + k);
      T.eq(q.res.length, 2, n + '.res');
      T.ok(q.res[0] > 0 && q.res[1] > 0, n + ': разрешение положительное');
      T.ok(q.atlas >= 64, n + ': атлас ' + q.atlas);
      for (const k of QSIG) {
        const v = q[k];
        if (typeof v === 'number') T.finite(v, n + '.' + k);
      }
      T.eq(typeof q.msaa === 'number' || typeof q.msaa === 'boolean', true, n + '.msaa');
    }
    /* лестница разрешения и атласа неубывающая */
    for (let i = 1; i < ladder.length; i++) {
      const a = QUALITY[ladder[i - 1]],
        b = QUALITY[ladder[i]];
      T.ok(b.res[0] >= a.res[0] && b.res[1] >= a.res[1], ladder[i] + ': разрешение меньше');
      T.ok(b.atlas >= a.atlas, ladder[i] + ': атлас меньше');
    }
    T.eq(QUALITY.max.atlas, 2048, 'максимальный атлас');
    T.deepEq(QUALITY.max.res, [7680, 4320], 'максимальное разрешение');
    /* общие параметры одинаковы у всех пресетов — «античит» */
    for (const n of ladder) {
      for (const k of ['lamps', 'fog', 'exposure', 'grade', 'det', 'micro', 'sdet', 'bloomK']) {
        T.eq(QUALITY[n][k], QUALITY.BASE[k], n + ': ' + k + ' отличается от BASE');
      }
    }
  });

  T.test('config: QUALITY.OFF выключает постобработку, BASE её включает', function () {
    const off = QUALITY.OFF;
    for (const k of ['tbn', 'pbr', 'spec', 'hdr']) T.eq(off[k], false, 'OFF.' + k);
    for (const k of ['msaa', 'ssao', 'vol', 'sharp', 'flare', 'pomRef', 'reflScale', 'detN']) {
      T.eq(off[k], 0, 'OFF.' + k);
    }
    T.eq(QUALITY.BASE.post, true, 'BASE.post');
    T.eq(QUALITY.BASE.normals, true, 'BASE.normals');
  });

  T.test('config: GKEYS = QSIG без level, knobsOf снимает ровно их', function () {
    T.deepEq(
      GKEYS,
      QSIG.filter(k => k !== 'level'),
      'состав GKEYS'
    );
    T.eq(GKEYS.indexOf('level'), -1, 'level не должен быть ручкой');
    const v = knobsOf(QUALITY.high);
    T.deepEq(Object.keys(v).sort(), GKEYS.slice().sort(), 'ключи knobsOf');
    T.deepEq(v.res, QUALITY.high.res, 'значение res');
    T.neq(v.res, QUALITY.high.res, 'res скопирован ссылкой');
    for (const k of GKEYS) if (k !== 'res') T.eq(v[k], QUALITY.high[k], 'ручка ' + k);
  });

  T.test('config: buildQ собирает BASE + OFF + ручки и помечает уровень', function () {
    const saveG = { preset: GFX.preset, v: JSON.parse(JSON.stringify(GFX.v)) };
    try {
      GFX.preset = 'high';
      GFX.v = knobsOf(QUALITY.high);
      let q = buildQ();
      T.eq(q.level, 'high', 'level');
      T.eq(q.name, QUALITY.high.name, 'name');
      T.deepEq(q.res, QUALITY.high.res, 'res из пресета');
      T.eq(q.lamps, QUALITY.BASE.lamps, 'lamps из BASE');
      T.eq(q.tbn, QUALITY.high.tbn, 'tbn из пресета');
      /* правка любой ручки переводит профиль в «свой» */
      GFX.preset = 'custom';
      GFX.v = knobsOf(QUALITY.high);
      GFX.v.ssao = 3;
      q = buildQ();
      T.eq(q.level, 'custom', 'level после правки');
      T.eq(q.name, 'своя', 'имя своего профиля');
      T.eq(q.ssao, 3, 'правленная ручка');
      T.eq(q.lamps, QUALITY.BASE.lamps, 'общие параметры не потеряны');
    } finally {
      GFX.preset = saveG.preset;
      GFX.v = saveG.v;
    }
    T.eq(buildQ().level, GFX.preset, 'профиль восстановлен');
  });

  T.test('config: qSig и gpuSigOf меняются вместе с параметрами графики', function () {
    const q0 = Q;
    const sig0 = qSig(),
      g0 = gpuSigOf('seed', 12, 14);
    T.eq(sig0, qSig(), 'сигнатура стабильна');
    T.eq(g0, 'seed_12x14_' + sig0, 'формат gpuSigOf');
    T.neq(gpuSigOf('seed2', 12, 14), g0, 'сид входит в сигнатуру');
    T.neq(gpuSigOf('seed', 13, 14), g0, 'размер входит в сигнатуру');
    try {
      Q = Object.assign({}, q0, { atlas: q0.atlas + 1 });
      T.neq(qSig(), sig0, 'сигнатура не заметила смену атласа');
      Q = Object.assign({}, q0, { exposure: q0.exposure + 0.1 });
      T.eq(qSig(), sig0, 'не-QSIG параметр попал в сигнатуру');
    } finally {
      Q = q0;
    }
    T.eq(qSig(), sig0, 'Q восстановлен');
  });

  T.test('config: привязки клавиш — 15 действий, DEF_BINDS не мутируется', function () {
    const acts = BIND_DEFS.map(x => x[0]);
    T.eq(acts.length, 15, 'число действий');
    T.deepEq(acts.slice(), Object.keys(DEF_BINDS).slice(), 'BIND_DEFS и DEF_BINDS расходятся');
    for (const a of acts) {
      T.ok(Array.isArray(binds[a]) && binds[a].length > 0, 'нет привязки ' + a);
      for (const c of binds[a]) T.eq(typeof c, 'string', 'код клавиши ' + a);
      T.ok(BIND_DEFS.find(x => x[0] === a)[1].length > 0, 'нет подписи ' + a);
    }
    T.deepEq(DEF_BINDS.fwd, ['KeyW', 'ArrowUp'], 'вперёд');
    T.deepEq(DEF_BINDS.pause, ['Escape'], 'пауза');
    T.deepEq(binds, JSON.parse(JSON.stringify(DEF_BINDS)), 'binds по умолчанию');
    binds.fwd.push('KeyT');
    T.eq(DEF_BINDS.fwd.length, 2, 'DEF_BINDS изменён через binds');
    binds.fwd.pop();
    T.eq(keyName('KeyW'), 'W', 'keyName буквы');
    T.eq(keyName('Digit3'), '3', 'keyName цифры');
    T.eq(keyName('ArrowUp'), '↑', 'keyName стрелки');
    T.eq(keyName('ShiftLeft'), 'L-Shift', 'keyName модификатора');
    T.eq(keyName(''), '—', 'keyName пустого кода');
    T.eq(actOf('KeyE'), 'interact', 'actOf');
    T.eq(actOf('F19'), null, 'actOf неизвестной клавиши');
    T.eq(bindLabel('fwd'), 'W / ↑', 'bindLabel');
  });

  T.test('config: kd читает состояние клавиш через привязки', function () {
    clearKeys();
    T.eq(kd('fwd'), 0, 'ничего не нажато');
    keys['KeyW'] = 1;
    T.eq(kd('fwd'), 1, 'W нажата');
    keys['KeyW'] = 0;
    T.eq(kd('fwd'), 0, 'W отпущена');
    keys['ArrowUp'] = 1;
    T.eq(kd('fwd'), 1, 'альтернативная клавиша');
    clearKeys();
    T.eq(kd('fwd'), 0, 'clearKeys');
    T.eq(kd('nosuchaction'), 0, 'неизвестное действие');
  });

  T.test('config: константы инвентаря, фонаря и мебели', function () {
    T.eq(INV_SLOTS, 4, 'слоты');
    T.eq(BATT_STACK, 4, 'батарейки в слоте');
    T.ok(FL_CAP > 60, 'заряд фонаря слишком мал: ' + FL_CAP);
    T.ok(FL_RANGE > 3 && FL_RANGE < 20, 'дальность луча: ' + FL_RANGE);
    T.ok(FL_COS_IN > FL_COS_OUT, 'конус: ядро уже края');
    T.inRange(FL_COS_IN, 0, 1, 'FL_COS_IN');
    T.inRange(FL_COS_OUT, 0, 1, 'FL_COS_OUT');
    T.ok(FL_SPILL_R > 0 && FL_SPILL_R < 3, 'обратная засветка');
    T.ok(FL_DIM_AT > 0 && FL_DIM_AT < 1, 'порог тускнения');
    for (const v of [RL_DUR, SW_DUR, PK_DUR, PK_APPEAR, TG_DUR])
      T.ok(v > 0 && v < 3, 'длительность анимации ' + v);
    T.ok(PK_APPEAR < PK_DUR, 'предмет появляется до конца клипа');
    for (const v of [CAB_W, CAB_D, CAB_SLIDE, CAB_H, TBL_W, TBL_D, TBL_H]) {
      T.ok(v > 0 && v < 1, 'размер мебели в клетках: ' + v);
    }
    T.ok(CAB_SLIDE < CAB_D, 'выдвижение ящика глубже самого ящика');
    T.ok(REACH_OBJ > 0 && REACH_OBJ < 1.5, 'досягаемость предметов: ' + REACH_OBJ);
    T.ok(REACH_DOOR >= REACH_OBJ, 'дверь дальше предмета');
    T.near(REACH_OBJ * CELL_M, 1.5, 1e-9, 'досягаемость 1.5 м');
    T.near(REACH_DOOR * CELL_M, 2, 1e-9, 'досягаемость двери 2 м');
  });

  T.test('config: пороги света и темноты согласованы', function () {
    T.ok(AMBIENT > 0 && AMBIENT < 0.1, 'AMBIENT: ' + AMBIENT);
    T.ok(DARK_T > AMBIENT, 'порог темноты выше фонового света');
    T.ok(HALLU_DARK_T < DARK_T, 'галлюцинации начинаются в более густой темноте');
    T.ok(HALLU_GI_T > 0, 'порог рассеянного света');
    T.ok(LAMP_R > 1 && LAMP_R < 10, 'радиус лампы: ' + LAMP_R);
    T.ok(DARK_HALLU_T > 1, 'задержка галлюцинаций: ' + DARK_HALLU_T);
    T.eq(FOGC.length, 3, 'цвет тумана');
    for (const c of FOGC) T.ok(c >= 0 && c < 0.1, 'компонента тумана ' + c);
  });

  T.test('config: монстр — поле зрения и периферия', function () {
    T.ok(MON_FOV > 0.3 && MON_FOV < Math.PI, 'MON_FOV: ' + MON_FOV);
    T.ok(MON_PERIPH > 0 && MON_PERIPH < 3, 'MON_PERIPH: ' + MON_PERIPH);
    T.eq(typeof MON_K_FALLBACK, 'object', 'MON_K_FALLBACK');
  });

  /* ---- сохранение настроек ---- */
  function withSettings(fn) {
    const snap = {
      sens: SENS,
      binds: JSON.parse(JSON.stringify(binds)),
      gfx: { preset: GFX.preset, v: JSON.parse(JSON.stringify(GFX.v)) },
      play: JSON.parse(JSON.stringify(PLAY)),
      raw: localStorage.getItem(CFG_KEY),
      legacy: localStorage.getItem('sml84')
    };
    try {
      const r = fn();
      return r && r.then
        ? r.then(finish, e => {
            finish();
            throw e;
          })
        : (finish(), r);
    } catch (e) {
      finish();
      throw e;
    }
    function finish() {
      SENS = snap.sens;
      binds = snap.binds;
      GFX.preset = snap.gfx.preset;
      GFX.v = snap.gfx.v;
      Object.keys(PLAY).forEach(k => {
        delete PLAY[k];
      });
      Object.assign(PLAY, snap.play);
      if (snap.raw === null) localStorage.removeItem(CFG_KEY);
      else localStorage.setItem(CFG_KEY, snap.raw);
      if (snap.legacy === null) localStorage.removeItem('sml84');
      else localStorage.setItem('sml84', snap.legacy);
    }
  }

  T.test('настройки: saveSettings пишет полный снимок в localStorage', function () {
    withSettings(function () {
      SENS = 2.25;
      binds.interact = ['KeyQ'];
      GFX.preset = 'low';
      GFX.v = knobsOf(QUALITY.low);
      PLAY.W = 33;
      PLAY.preset = 'custom';
      saveSettings();
      const raw = localStorage.getItem(CFG_KEY);
      T.ok(raw, 'запись не появилась');
      const j = JSON.parse(raw);
      T.deepEq(Object.keys(j).sort(), ['binds', 'gfx', 'play', 'sens'], 'состав записи');
      T.eq(j.sens, 2.25, 'sens');
      T.deepEq(j.binds.interact, ['KeyQ'], 'binds');
      T.eq(j.gfx.preset, 'low', 'gfx.preset');
      T.eq(j.play.W, 33, 'play.W');
      /* загрузка из этой записи восстанавливает то же состояние */
      SENS = 1;
      binds.interact = ['KeyE'];
      GFX.preset = 'ultra';
      GFX.v = knobsOf(QUALITY.ultra);
      PLAY.W = 24;
      loadSettings();
      T.eq(SENS, 2.25, 'sens после загрузки');
      T.deepEq(binds.interact, ['KeyQ'], 'binds после загрузки');
      T.eq(GFX.preset, 'low', 'профиль графики');
      T.deepEq(GFX.v.res, QUALITY.low.res, 'ручки профиля');
      T.eq(PLAY.W, 33, 'play.W');
    });
  });

  T.test('настройки: мусор в сейве отбрасывается, дефолты сохраняются', function () {
    withSettings(function () {
      localStorage.setItem(
        CFG_KEY,
        JSON.stringify({
          sens: 99,
          binds: {
            fwd: 'KeyZ',
            interact: [],
            pause: [1, 2],
            drop: ['KeyG', 'KeyH', 'KeyJ', 'KeyK']
          },
          gfx: { preset: 'nosuch', v: { res: 5, ssao: 4, alien: 1 } },
          play: {
            preset: 'nosuch',
            W: 5000,
            H: -3,
            dens: 7,
            loot: 'много',
            mon: 'yes',
            monSp: 1,
            map: { on: 3, mon: false }
          }
        })
      );
      SENS = 1.4;
      binds = JSON.parse(JSON.stringify(DEF_BINDS));
      GFX.preset = 'ultra';
      GFX.v = knobsOf(QUALITY.ultra);
      const before = JSON.parse(JSON.stringify(PLAY));
      loadSettings();
      T.eq(SENS, 1.4, 'чувствительность вне диапазона принята');
      T.deepEq(binds.fwd, DEF_BINDS.fwd, 'не-массив принят как привязка');
      T.deepEq(binds.interact, DEF_BINDS.interact, 'пустая привязка принята');
      T.deepEq(binds.pause, DEF_BINDS.pause, 'не-строковые коды приняты');
      T.eq(binds.drop.length, 3, 'привязка не обрезана до 3 клавиш');
      T.eq(GFX.preset, 'ultra', 'неизвестный профиль принят');
      T.deepEq(GFX.v.res, [1600, 1000], 'битый res не восстановлен');
      T.eq(GFX.v.alien, undefined, 'чужая ручка попала в GFX.v');
      T.eq(GFX.v.ssao, 4, 'допустимая ручка потеряна');
      T.eq(PLAY.W, before.W, 'W вне диапазона принят');
      T.eq(PLAY.H, before.H, 'H вне диапазона принят');
      T.eq(PLAY.dens, before.dens, 'dens вне диапазона принят');
      T.eq(PLAY.loot, before.loot, 'loot не-число принято');
      T.eq(PLAY.mon, before.mon, 'mon не-boolean принят');
      T.eq(PLAY.monSp, before.monSp, 'monSp вне диапазона принят');
      T.eq(PLAY.map.on, true, 'не-boolean в карте принят');
      T.eq(PLAY.map.mon, false, 'допустимый переключатель карты потерян');
    });
  });

  T.test('настройки: битый JSON и старый ключ не роняют загрузку', function () {
    withSettings(function () {
      localStorage.setItem(CFG_KEY, '{ это не json');
      T.noThrow(loadSettings, 'битый JSON');
      localStorage.removeItem(CFG_KEY);
      T.noThrow(loadSettings, 'нет записи вовсе');
      /* миграция со старого ключа */
      localStorage.setItem(
        'sml84',
        JSON.stringify({ sens: 2.5, play: { preset: 'custom', W: 40 } })
      );
      loadSettings();
      T.eq(SENS, 2.5, 'sens из старого ключа');
      T.eq(PLAY.W, 40, 'W из старого ключа');
      /* старый сейв без H: глубина падает на ширину */
      localStorage.setItem('sml84', JSON.stringify({ play: { preset: 'custom', W: 21 } }));
      loadSettings();
      T.eq(PLAY.H, 21, 'H не унаследован от W');
      /* именованный пресет, который перестал совпадать со своими параметрами,
         возвращается к текущим значениям пресета */
      localStorage.setItem('sml84', JSON.stringify({ play: { preset: 'medium', W: 40 } }));
      loadSettings();
      T.eq(PLAY.W, PRESETS.medium.W, 'W не восстановлен из пресета');
      T.eq(PLAY.preset, 'medium', 'имя пресета');
      /* сейв с настройками, которых больше нет в игре */
      localStorage.setItem(
        CFG_KEY,
        JSON.stringify({ gfx: { preset: 'high', v: { removedKnob: 1, msaa: 2 } } })
      );
      loadSettings();
      T.eq(GFX.preset, 'high', 'профиль');
      T.eq(GFX.v.removedKnob, undefined, 'удалённая ручка осталась');
      T.eq(GFX.v.msaa, 2, 'ручка msaa');
    });
  });

  T.test('настройки: scheduleSave откладывает запись на 250 мс', async function () {
    await withSettings(async function () {
      localStorage.removeItem(CFG_KEY);
      SENS = 1.75;
      scheduleSave();
      T.eq(localStorage.getItem(CFG_KEY), null, 'запись появилась сразу');
      await T.advance(300);
      const raw = localStorage.getItem(CFG_KEY);
      T.ok(raw, 'отложенная запись не сработала');
      T.eq(JSON.parse(raw).sens, 1.75, 'содержимое');
      /* серия правок схлопывается в одну запись */
      localStorage.removeItem(CFG_KEY);
      scheduleSave();
      await T.advance(100);
      SENS = 2;
      scheduleSave();
      await T.advance(100);
      T.eq(localStorage.getItem(CFG_KEY), null, 'запись до истечения debounce');
      await T.advance(300);
      T.eq(JSON.parse(localStorage.getItem(CFG_KEY)).sens, 2, 'последнее значение');
    });
  });

  T.test('настройки: pagehide дописывает отложенную запись', function () {
    withSettings(function () {
      localStorage.removeItem(CFG_KEY);
      SENS = 0.75;
      scheduleSave();
      T.fire(window, 'pagehide');
      T.ok(localStorage.getItem(CFG_KEY), 'pagehide не сбросил debounce');
      T.eq(JSON.parse(localStorage.getItem(CFG_KEY)).sens, 0.75, 'значение');
    });
  });
})();

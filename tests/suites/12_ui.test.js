'use strict';
/* Интерфейс: версия в DOM, экранные переключатели, меню и пресеты, панель
   настроек с перехватом клавиш, сохранение в localStorage, загрузчик, HUD
   (инвентарь и миникарта), клавиатурный ввод и события окна. */

(function () {
  const T = __T;
  const G = LIB.G;
  const byId = T.byId;

  function hiddenOf(id) {
    return byId(id).classList.contains('hidden');
  }

  T.test('интерфейс: версия пробита в заголовок и в .mver', function () {
    T.eq(GAME_VER, 'v1.0.0 (BUILD 121)', 'GAME_VER');
    T.eq(T.doc.title, 'NADZIRATEL · ' + GAME_VER, 'title не пробит из version.js');
    const mv = T.doc.querySelector('.mver');
    T.ok(mv, 'нет элемента .mver');
    T.eq(mv.textContent, GAME_VER + ' · WebGPU', '.mver не совпадает с GAME_VER');
  });

  T.test('интерфейс: форматировщики ui.js', function () {
    T.eq(fmtDur(0), '0 с', 'fmtDur(0)');
    T.eq(fmtDur(45), '45 с', 'fmtDur(45)');
    T.eq(fmtDur(125), '2 мин, 5 с', 'fmtDur(125)');
    T.eq(fmtDur(3600), '1 ч', 'fmtDur(3600)');
    T.eq(fmtDur(3661), '1 ч, 1 мин, 1 с', 'fmtDur(3661)');
    T.eq(fmtDur(3605.7), '1 ч, 5 с', 'fmtDur с дробью');
    T.eq(fmtDist(255), '255 м', 'fmtDist(255)');
    T.eq(fmtDist(999.4), '999 м', 'fmtDist округление вниз');
    T.eq(fmtDist(1000), '1 км', 'fmtDist(1000)');
    T.eq(fmtDist(2255), '2 км, 255 м', 'fmtDist(2255)');
    for (const p of ['practice', 'easy', 'medium', 'hard', 'extreme', 'impossible']) {
      T.ok(diffName(p) && diffName(p) !== 'своя', 'diffName(' + p + ')');
    }
    T.eq(diffName('custom'), 'своя', 'diffName(custom)');
    T.eq(diffName(''), 'своя', 'diffName пусто');
    /* setMsg/show */
    setMsg('тест-сообщение');
    T.eq(byId('msg').textContent, 'тест-сообщение', 'setMsg не написал текст');
    T.eq(byId('msg').style.opacity, '1', 'setMsg не показал сообщение');
    show('msg', false);
    T.eq(hiddenOf('msg'), true, 'show(false) не спрятал');
    show('msg', true);
    T.eq(hiddenOf('msg'), false, 'show(true) не показал');
  });

  T.test('интерфейс: загрузчик — честный прогресс и скрытие', function () {
    ldShow('тест-загрузки');
    T.eq(hiddenOf('loader'), false, 'ldShow не показал загрузчик');
    T.eq(byId('ldLbl').textContent, 'тест-загрузки', 'подпись загрузчика');
    T.eq(byId('ldFill').style.width, '0%', 'полоса не сброшена');
    T.eq(byId('ldPct').textContent, '0%', 'процент не сброшен');
    LD.set(37, 'проверка');
    T.eq(byId('ldFill').style.width, '37%', 'LD.set ширина');
    T.eq(byId('ldPct').textContent, '37%', 'LD.set процент');
    T.eq(byId('ldLbl').textContent, 'проверка', 'LD.set подпись');
    /* clamp и повтор той же величины */
    LD.set(150, 'x');
    T.eq(byId('ldFill').style.width, '100%', 'LD.set не клампит сверху');
    LD.set(-9);
    T.eq(byId('ldFill').style.width, '0%', 'LD.set не клампит снизу');
    /* ldTrack: прогресс шага init (LD.tick живёт на часах — крутим их сами) */
    ldTrack(20, 30);
    const p1 = window.LDSTEP(0.5, 'шаг');
    T.advance(200, 100);
    return p1.then(function () {
      T.eq(byId('ldPct').textContent, '35%', 'ldTrack 20+0.5*30');
      T.eq(byId('ldLbl').textContent, 'шаг', 'ldTrack подпись');
      window.LDSTEP = null;
      const p = ldHide();
      T.advance(600, 200);
      return p.then(function () {
        T.eq(hiddenOf('loader'), true, 'ldHide не спрятал загрузчик');
        T.eq(byId('ldFill').style.width, '100%', 'ldHide не довёл до 100%');
      });
    });
  });

  T.test('интерфейс: экраны меню переключаются', function () {
    menuScreen('main');
    T.eq(hiddenOf('msMain'), false, 'main не виден');
    T.eq(hiddenOf('msPlay'), true, 'play виден при main');
    T.eq(hiddenOf('msSet'), true, 'set виден при main');
    T.eq(byId('menu').classList.contains('onmain'), true, 'нет onmain на главном экране');
    menuScreen('play');
    T.eq(hiddenOf('msMain'), true, 'main виден при play');
    T.eq(hiddenOf('msPlay'), false, 'play не виден');
    T.eq(byId('menu').classList.contains('onmain'), false, 'onmain остался');
    menuScreen('set');
    T.eq(hiddenOf('msSet'), false, 'set не виден');
    T.eq(G('menuScr'), 'set', 'menuScr не обновлён');
    menuScreen('main');
  });

  T.test('интерфейс: пресеты партии и startCfg', function () {
    /* easy применяется целиком */
    applyPlayPreset('easy');
    T.eq(G('PLAY').preset, 'easy', 'пресет не записан');
    T.eq(playMatchesPreset(), true, 'партия не соответствует easy');
    const c = startCfg();
    T.eq(c.preset, 'easy', 'startCfg preset');
    T.eq(c.W, PRESETS.easy.W, 'startCfg W');
    T.eq(c.H, PRESETS.easy.H, 'startCfg H');
    T.eq(c.mon, PRESETS.easy.monster, 'startCfg mon');
    T.near(
      KMH(c.monSpKmh),
      PRESETS.easy.monsterSpeed,
      1e-9,
      'startCfg скорость монстра (км/ч → кл/с)'
    );
    T.finite(c.sens, 'startCfg sens');
    T.ok(c.map && typeof c.map === 'object', 'startCfg map');
    T.neq(c.map, G('PLAY').map, 'startCfg должен копировать map');
    /* правка параметра сбивает соответствие пресету */
    G('PLAY').W = PRESETS.easy.W + 1;
    T.eq(playMatchesPreset(), false, 'правка W не сбила пресет');
    /* impossible и practice */
    applyPlayPreset('impossible');
    T.eq(playMatchesPreset(), true, 'impossible не применился');
    applyPlayPreset('practice');
    T.eq(G('PLAY').mon, false, 'practice без монстра');
    /* custom: touchPlay сбивает пресет только при ручной правке параметра */
    touchPlay();
    T.eq(G('PLAY').preset, 'practice', 'touchPlay не должен менять совпадающий пресет');
    G('PLAY').dens = PRESETS.practice.density + 0.01;
    touchPlay();
    T.eq(G('PLAY').preset, 'custom', 'touchPlay не перевёл в custom после правки');
    T.eq(byId('plPreset').value, 'custom', 'селект plPreset не синхронизирован');
    /* для custom сравнивать не с чем — playMatchesPreset возвращает true */
    T.eq(playMatchesPreset(), true, 'custom должен давать true (нет пресета для сравнения)');
    /* updMazeInfo оценивает генерацию и пишет в панель */
    applyPlayPreset('medium');
    G('PLAY').seedText = 'тест-сид';
    updMazeInfo();
    const info = byId('mazeInfo').textContent;
    T.ok(info.length > 3, 'mazeInfo пуст: ' + info);
    G('PLAY').seedText = '';
    updMazeInfo();
    T.ok(byId('mazeInfo').textContent.length > 3, 'mazeInfo пуст без сида');
    /* синхронизация контролов не роняет */
    T.noThrow(function () {
      syncControls();
      updPlayVis();
    }, 'syncControls/updPlayVis');
    applyPlayPreset('medium');
    syncControls();
  });

  T.test('интерфейс: панель настроек и сохранение в localStorage', function () {
    /* открытие/закрытие */
    menuScreen('main');
    openSettings(false);
    T.eq(hiddenOf('msSet'), false, 'настройки не открылись');
    T.eq(G('menuScr'), 'set', 'menuScr после openSettings');
    closeSettings();
    T.eq(hiddenOf('msSet'), true, 'настройки не закрылись');
    /* панели строятся */
    buildBindsPanel();
    const rows = byId('bindRows');
    T.eq(rows.childNodes.length, BIND_DEFS.length, 'строк биндов не ' + BIND_DEFS.length);
    buildGfxPanel();
    T.ok(true, 'buildGfxPanel не бросил');
    /* перехват клавиши: клик по кнопке → нажатие → бинд заменён */
    buildBindsPanel();
    const btn = rows.childNodes[0].querySelector('button');
    T.ok(btn, 'нет кнопки в строке бинда');
    btn.click();
    T.eq(G('bindCapture'), 'fwd', 'клик не включил захват');
    T.key('keydown', 'KeyT', {});
    T.deepEq(G('binds').fwd, ['KeyT'], 'бинд не заменился');
    T.eq(G('bindCapture'), null, 'захват не сброшен');
    /* новый код вычищен из остальных действий */
    let dup = 0;
    const bb = G('binds');
    for (const a in bb) if (a !== 'fwd' && bb[a].indexOf('KeyT') >= 0) dup++;
    T.eq(dup, 0, 'KeyT остался в других биндах');
    T.eq(actOf('KeyT'), 'fwd', 'actOf не знает нового бинда');
    T.eq(bindLabel('fwd'), 'T', 'bindLabel');
    /* сохранение → localStorage */
    saveSettings();
    const raw = T.env.localStorageStore.get('nadziratel_cfg');
    T.ok(raw, 'настройки не сохранились');
    const j = JSON.parse(raw);
    T.deepEq(j.binds.fwd, ['KeyT'], 'сохранённый бинд');
    T.finite(j.sens, 'сохранённый sens');
    T.ok(j.gfx && j.gfx.v, 'сохранённый gfx');
    T.ok(j.play && j.play.preset, 'сохранённый play');
    /* восстановление: дефолтные бинды, затем loadSettings из сейва */
    eval('binds = JSON.parse(JSON.stringify(DEF_BINDS))');
    T.deepEq(G('binds').fwd, DEF_BINDS.fwd, 'сброс биндов');
    loadSettings();
    T.deepEq(G('binds').fwd, ['KeyT'], 'loadSettings не вернул бинд');
    /* мусор в хранилище не роняет и не портит состояние */
    T.env.localStorageStore.set('nadziratel_cfg', '{не json');
    T.noThrow(loadSettings, 'loadSettings на битом json');
    T.deepEq(G('binds').fwd, ['KeyT'], 'битый json сбросил бинды');
    /* завышенные значения клампятся */
    T.env.localStorageStore.set(
      'nadziratel_cfg',
      JSON.stringify({ sens: 99, play: { preset: 'easy', W: 5000, H: 2, loot: 999, monSp: 1 } })
    );
    loadSettings();
    T.ok(G('SENS') <= 3, 'sens не клампится: ' + G('SENS'));
    T.ok(G('PLAY').W <= 100, 'W не клампится: ' + G('PLAY').W);
    T.ok(G('PLAY').loot <= 100, 'loot не клампится');
    /* вернуть рабочее состояние */
    T.env.localStorageStore.delete('nadziratel_cfg');
    eval('binds = JSON.parse(JSON.stringify(DEF_BINDS)); SENS = 1.4');
    applyPlayPreset('medium');
    saveSettings();
    buildBindsPanel();
    updMenuHints();
    T.ok(byId('mfootHint').textContent.indexOf('W') >= 0, 'подсказки не обновлены');
  });

  T.test('интерфейс: buildQ собирает качество из GFX', function () {
    const q = buildQ();
    T.ok(q && typeof q === 'object', 'buildQ не объект');
    T.ok(Array.isArray(q.res) && q.res.length === 2, 'buildQ res');
    T.ok(q.lamps >= 1, 'buildQ lamps');
    T.eq(typeof q.level, 'string', 'buildQ level');
    /* knobsOf/buildQ согласованы: все GKEYS присутствуют */
    const kn = knobsOf(q);
    for (const k of GKEYS) T.eq(kn[k] !== undefined, true, 'knobsOf потерял ' + k);
    T.deepEq(
      knobsOf(QUALITY.ultra).res,
      [QUALITY.ultra.res[0], QUALITY.ultra.res[1]],
      'knobsOf res'
    );
  });

  T.test('интерфейс: HUD — инвентарь и миникарта', function () {
    const s = LIB.run({
      seed: 'hud',
      W: 12,
      H: 12,
      density: 0.3,
      cabDens: 0.2,
      loot: 50,
      monster: true
    });
    T.eq(Object.keys(INV_ICON).sort().join(','), 'batt,flash,key', 'набор иконок');
    for (const k in INV_ICON) T.ok(INV_ICON[k].indexOf('<svg') === 0, k + ': не svg');
    /* пустой инвентарь: 4 слота, ни один не выбран */
    eval('invSig = "~"');
    s.sel = -1;
    updInvHud(s);
    const bar = byId('invBar');
    T.eq(bar.childNodes.length, INV_SLOTS, 'слотов в панели');
    T.eq(bar.querySelector('.sel'), null, 'выбранный слот при sel=-1');
    /* предметы и выбор */
    invAdd(s, 'flash');
    invAdd(s, 'batt');
    invAdd(s, 'batt');
    invSelectKind(s, 'flash');
    updInvHud(s);
    T.eq(bar.childNodes.length, INV_SLOTS, 'слотов после предметов');
    T.ok(bar.querySelector('.sel'), 'нет выбранного слота');
    T.ok(bar.innerHTML.indexOf('×2') >= 0, 'счётчик батареек не показан');
    /* кэш сигнатуры: повторный вызов не перерисовывает */
    const html0 = bar.innerHTML;
    updInvHud(s);
    T.eq(bar.innerHTML, html0, 'перерисовка без изменений');
    /* миникарта: скрыта без M, видна с M */
    eval('S = s');
    eval('showMap = false');
    drawMinimap();
    T.eq(byId('minimap').style.visibility, 'hidden', 'миникарта видна при showMap=false');
    eval('showMap = true');
    s.explored.fill(1);
    T.noThrow(drawMinimap, 'drawMinimap с исследованной картой');
    T.eq(byId('minimap').style.visibility, 'visible', 'миникарта скрыта при showMap=true');
    /* повторная отрисовка использует кэш слоя (тот же mmLayer) */
    const layer = G('mmLayer');
    T.ok(layer, 'слой миникарты не создан');
    drawMinimap();
    T.eq(G('mmLayer'), layer, 'слой пересоздан без изменений');
    /* смена забега сбрасывает кэш */
    const s2 = LIB.run({
      seed: 'hud2',
      W: 10,
      H: 10,
      density: 0.3,
      cabDens: 0.1,
      loot: 50,
      monster: false
    });
    eval('S = s2');
    drawMinimap();
    T.neq(G('mmLayer'), undefined, 'слой пропал');
    eval('showMap = false; S = null');
  });

  T.test('интерфейс: клавиатура — флаги, импульсы, присед-переключатель, пауза', function () {
    const s = LIB.run({
      seed: 'input',
      W: 10,
      H: 10,
      density: 0.3,
      cabDens: 0.1,
      loot: 50,
      monster: false
    });
    eval('S = s; started = true; paused = false; setFromPause = false');
    clearKeys();
    T.key('keydown', 'KeyW', {});
    T.eq(G('keys').KeyW, 1, 'KeyW не зарегистрирован');
    T.eq(kd('fwd'), 1, 'kd(fwd) не видит KeyW');
    T.key('keyup', 'KeyW', {});
    T.eq(G('keys').KeyW, 0, 'keyup не снял флаг');
    /* импульс взаимодействия */
    T.key('keydown', 'KeyE', {});
    T.eq(G('interactPulse'), 1, 'E не дал импульс взаимодействия');
    T.key('keyup', 'KeyE', {});
    /* присед — переключатель с блокировкой прочих действий */
    eval('actLock = 0; crouchTog = false');
    T.key('keydown', 'KeyC', {});
    T.eq(G('crouchTog'), true, 'C не включил присед');
    T.near(G('actLock'), ACT_CROUCH, 1e-9, 'actLock не выставлен');
    /* пока actLock жив, остальные импульсы не проходят */
    T.key('keydown', 'KeyF', {});
    T.eq(G('flashPulse'), 0, 'фонарь сработал во время блокировки');
    T.key('keyup', 'KeyF', {});
    eval('actLock = 0');
    T.key('keydown', 'KeyC', {});
    T.eq(G('crouchTog'), false, 'второй C не выключил присед');
    T.key('keyup', 'KeyC', {});
    /* слоты инвентаря */
    eval('actLock = 0; swPulse = -1');
    T.key('keydown', 'Digit3', {});
    T.eq(G('swPulse'), 2, 'Digit3 не выбрал слот 3');
    T.key('keyup', 'Digit3', {});
    /* M переключает карту (нужен cfg.map — в меню он пустой) */
    eval('cfg = { map: { on: true } }');
    eval('showMap = false');
    T.key('keydown', 'KeyM', {});
    T.eq(G('showMap'), true, 'M не включил карту');
    T.key('keyup', 'KeyM', {});
    T.key('keydown', 'KeyM', {});
    T.eq(G('showMap'), false, 'M не выключил карту');
    T.key('keyup', 'KeyM', {});
    eval('cfg = {}');
    /* Escape — пауза */
    T.key('keydown', 'Escape', {});
    T.eq(G('paused'), true, 'Escape не поставил паузу');
    T.eq(hiddenOf('pause'), false, 'экран паузы не показан');
    /* во время паузы игровые клавиши не проходят */
    T.key('keydown', 'KeyE', {});
    T.eq(G('interactPulse'), 0, 'E сработал на паузе');
    T.key('keyup', 'Escape', {});
    T.key('keydown', 'Escape', {});
    T.eq(G('paused'), false, 'Escape не снял паузу');
    T.eq(hiddenOf('pause'), true, 'экран паузы не спрятан');
    T.key('keyup', 'Escape', {});
    /* мышь без захвата: drag-поворот меняет угол */
    const a0 = s.ang;
    T.fire(byId('view'), 'pointerdown', { clientX: 100, button: 0 });
    T.fire(T.doc, 'mousemove', { clientX: 140, movementX: 0, movementY: 0 });
    T.ok(s.ang !== a0, 'drag-поворот не изменил угол');
    eval('drag = false');
    /* clearKeys гасит всё */
    T.key('keydown', 'KeyW', {});
    clearKeys();
    T.eq(G('keys').KeyW, 0, 'clearKeys не сбросил клавиши');
    T.eq(G('interactPulse'), 0, 'clearKeys не сбросил импульсы');
    T.eq(G('swPulse'), -1, 'clearKeys не сбросил слот');
    eval('started = false; paused = false; S = null');
  });

  T.test('интерфейс: события окна — resize и видимость вкладки', function () {
    T.fire(T.doc.defaultView, 'resize', {});
    /* видимость: скрытие вкладки в меню не роняет, duck вызывается */
    T.doc.hidden = true;
    T.fire(T.doc, 'visibilitychange', {});
    T.doc.hidden = false;
    T.fire(T.doc, 'visibilitychange', {});
    /* pause при started: скрытие вкладки ставит паузу */
    const s = LIB.run({
      seed: 'vis',
      W: 8,
      H: 8,
      density: 0.3,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    eval('S = s; started = true; paused = false');
    T.doc.hidden = true;
    T.fire(T.doc, 'visibilitychange', {});
    T.eq(G('paused'), true, 'скрытие вкладки не поставило паузу');
    T.doc.hidden = false;
    T.fire(T.doc, 'visibilitychange', {});
    T.eq(G('paused'), true, 'пауза должна оставаться до явного снятия');
    eval('setPaused(false); started = false; S = null');
    T.eq(G('paused'), false, 'пауза не снята');
  });

  T.test('интерфейс: таблица событий EVT покрывает ядро', function () {
    const pushed = {
      pickup_flash: 1,
      pickup_key: 1,
      pickup_batt: 1,
      inv_full: 1,
      cab_open: 1,
      cab_close: 1,
      door_locked: 1,
      door_needhand: 1,
      door_unlock: 1,
      door_open: 1,
      win: 1,
      safe_open: 1,
      safe_close: 1,
      safe_denied: 1,
      safe_denied_mon: 1,
      safe_forced: 1,
      safe_forced_mon: 1,
      flash_on: 1,
      flash_off: 1,
      flash_none: 1,
      flash_needhand: 1,
      flash_dead: 1,
      flash_dead_try: 1,
      batt_in: 1,
      batt_fresh: 1,
      no_batt: 1,
      reload_done: 1,
      hands_busy: 1,
      drop_item: 1,
      exhausted: 1,
      monster_seen: 1,
      monster_heard: 1,
      monster_lost: 1,
      shadow_teleport: 1
    };
    let inTable = 0;
    for (const k in pushed) if (EVT[k]) inTable++;
    T.ok(
      inTable >= Object.keys(pushed).length - 3,
      'в EVT нет событий ядра: ' + inTable + '/' + Object.keys(pushed).length
    );
    /* caught и reload_start в UI-таблицу не входят — это проверено набором симуляции */
    for (const k in EVT) {
      const r = EVT[k];
      T.ok(r && typeof r === 'object', 'EVT.' + k + ' не объект');
      if (r.msg) T.ok(Array.isArray(r.msg) && r.msg.length >= 1, 'EVT.' + k + '.msg не массив');
      if (r.snd) T.eq(typeof r.snd, 'function', 'EVT.' + k + '.snd не функция');
    }
    /* evMsg не роняет ни на известном, ни на неизвестном событии */
    T.noThrow(function () {
      evMsg('door_locked');
    }, 'evMsg door_locked');
    T.noThrow(function () {
      evMsg('нет-такого');
    }, 'evMsg неизвестного');
    T.noThrow(function () {
      auEvent('pickup_key');
    }, 'auEvent');
  });

  T.test('интерфейс: экраны manual и пауза с сидом', function () {
    openManual('menu');
    T.eq(hiddenOf('manual'), false, 'manual не открылся');
    T.eq(G('manualFrom'), 'menu', 'manualFrom');
    closeManual();
    T.eq(hiddenOf('manual'), true, 'manual не закрылся');
    /* сид забега на экране паузы */
    const s = LIB.run({
      seed: 'pause-seed',
      W: 8,
      H: 8,
      density: 0.3,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    eval('S = s; started = true; paused = false');
    setPauseSeed();
    const el = byId('pauseSeed');
    T.ok(el.textContent.indexOf(s.seedText) >= 0, 'сид не показан: ' + el.textContent);
    seedHint('скопировано', true);
    T.eq(byId('pauseSeedHint').classList.contains('ok'), true, 'seedHint не отметил успех');
    seedHint('ошибка', false);
    T.eq(byId('pauseSeedHint').classList.contains('ok'), false, 'seedHint не снял отметку');
    /* won/caught блокируют паузу */
    setPaused(true);
    T.eq(G('paused'), true, 'пауза не встала');
    setPaused(false);
    s.won = true;
    setPaused(true);
    T.eq(G('paused'), false, 'пауза встала после победы');
    s.won = false;
    eval('started = false; S = null');
  });
})();

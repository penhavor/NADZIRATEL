'use strict';
/* Свет: фонарик (конус + засветка вокруг игрока), лампы, их мерцание рядом с
   Надзирателем, поле рассеянного света и критерий «игрок в темноте».
   От этих функций зависят телепорт тени, галлюцинации и видимость. */

(function () {
  const T = __T;

  function darkSpot(s) {
    for (const idx of s.mazeFloors) {
      const x = (idx % s.W) + 0.5,
        y = ((idx / s.W) | 0) + 0.5;
      s.px = x;
      s.py = y;
      if (playerInDark(s)) return { x, y, idx };
    }
    return null;
  }
  /* клетка с длинным свободным коридором вправо — для проверки конуса */
  function clearRun(s, need) {
    for (const idx of s.mazeFloors) {
      const x = idx % s.W,
        y = (idx / s.W) | 0;
      let ok = true;
      for (let k = 1; k <= need; k++)
        if (s.grid[y * s.W + x + k] !== 0) {
          ok = false;
          break;
        }
      if (ok) return { x: x + 0.5, y: y + 0.5 };
    }
    return null;
  }

  function litSpot(s) {
    for (const lp of s.lamps) {
      const x = lp.x + 0.5,
        y = lp.y + 0.5;
      s.px = x;
      s.py = y;
      if (!playerInDark(s)) return { x, y, idx: lp.y * s.W + lp.x };
    }
    return null;
  }

  T.test('свет: flashBright — полный выше порога, плавный спад ниже', function () {
    T.eq(flashBright(0), 0, 'нулевой заряд');
    T.eq(flashBright(-1), 0, 'отрицательный заряд');
    T.eq(flashBright(NaN), 0, 'NaN');
    T.eq(flashBright(FL_DIM_AT), 1, 'ровно на пороге');
    T.eq(flashBright(1), 1, 'полный заряд');
    let prev = -1;
    for (let i = 0; i <= 50; i++) {
      const e = i / 50;
      const b = flashBright(e);
      T.inRange(b, 0, 1, 'яркость при e=' + e.toFixed(2));
      T.ok(b >= prev - 1e-12, 'яркость немонотонна при e=' + e.toFixed(2));
      prev = b;
      if (e < FL_DIM_AT)
        T.near(b, Math.pow(e / FL_DIM_AT, 1.4), 1e-12, 'формула спада при e=' + e.toFixed(2));
      else T.eq(b, 1, 'выше порога яркость не полная при e=' + e.toFixed(2));
    }
    /* спад заметный: на 10% заряда света примерно втрое меньше */
    T.ok(flashBright(FL_DIM_AT * 0.5) < 0.5, 'слишком пологий спад');
  });

  T.test('свет: flashFlick мерцает только на почти севшей батарее', function () {
    const s = LIB.run({ seed: 'flick', W: 10, H: 10, density: 0.3, monster: false });
    for (const e of [0.08, 0.2, 0.5, 1]) {
      s.fl.e = e;
      for (const t of [0, 1.3, 7.7, 123.45]) {
        s.time = t;
        T.eq(flashFlick(s), 1, 'мерцание при e=' + e + ' t=' + t);
      }
    }
    /* детерминированно от s.time и глубже при меньшем заряде */
    let minFull = 1,
      minLow = 1;
    for (let i = 0; i < 4000; i++) {
      const t = i * 0.037;
      s.time = t;
      s.fl.e = 0.079;
      const a = flashFlick(s);
      T.inRange(a, 0.06, 1, 'мерцание вне диапазона: ' + a);
      s.fl.e = 0.001;
      const b = flashFlick(s);
      T.inRange(b, 0.06, 1, 'глубокое мерцание вне диапазона: ' + b);
      T.eq(flashFlick(s), b, 'flashFlick не детерминирована');
      if (a < minFull) minFull = a;
      if (b < minLow) minLow = b;
    }
    T.ok(minFull < 1, 'на 8% заряда мерцания нет');
    T.ok(minLow < minFull, 'на нуле заряда провалы не глубже');
    /* нижняя граница 0.06 — страховка, реальная глубина задаётся зарядом */
    T.ok(minLow >= 0.06 - 1e-12, 'минимум ниже пола: ' + minLow);
    T.ok(minLow < 0.3, 'провалы слишком мелкие: ' + minLow);
    s.fl.e = 0;
    T.inRange(flashFlick(s), 0.06, 1, 'нулевой заряд');
  });

  T.test('свет: cellLitByFlash — конус по взгляду, засветка вокруг, дальность', function () {
    const R = Math.ceil(FL_RANGE) + 2;
    const s = LIB.run({
      seed: 'cone',
      W: R * 2,
      H: R * 2,
      density: 0,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    /* расчищаем площадку больше дальности луча: конус проверяется без влияния стен */
    const cx = (s.W / 2) | 0,
      cy = (s.H / 2) | 0;
    for (let y = cy - R; y <= cy + R; y++)
      for (let x = cx - R; x <= cx + R; x++) s.grid[y * s.W + x] = 0;
    s.px = cx + 0.5;
    s.py = cy + 0.5;
    s.ang = 0;
    s.pitch = 0;
    T.eq(cellAt(s, s.px, s.py), 0, 'площадка не расчищена');
    T.eq(cellLitByFlash(s, s.px, s.py), false, 'фонарь не в руках');
    s.fl.owned = true;
    T.eq(cellLitByFlash(s, s.px, s.py), false, 'фонарь выключен');
    s.fl.on = true;
    s.fl.bri = 0;
    T.eq(cellLitByFlash(s, s.px, s.py), false, 'яркость 0 всё равно светит');
    s.fl.bri = 0.05;
    T.eq(cellLitByFlash(s, s.px, s.py), false, 'порог яркости 0.05 включён');
    s.fl.bri = 1;
    s.fl.e = 1;
    /* засветка вокруг игрока — без проверки угла и линии видимости */
    T.eq(cellLitByFlash(s, s.px + FL_SPILL_R * 0.5, s.py), true, 'засветка спереди');
    T.eq(cellLitByFlash(s, s.px - FL_SPILL_R * 0.5, s.py), true, 'засветка сзади');
    T.eq(cellLitByFlash(s, s.px, s.py + FL_SPILL_R * 0.5), true, 'засветка сбоку');
    /* вне засветки решает конус */
    const d = FL_SPILL_R + 1;
    T.eq(cellLitByFlash(s, s.px + d, s.py), true, 'вперёд по взгляду не освещено');
    T.eq(cellLitByFlash(s, s.px - d, s.py), false, 'назад освещено');
    T.eq(cellLitByFlash(s, s.px, s.py + d), false, 'строго вбок освещено');
    T.eq(cellLitByFlash(s, s.px + d * 0.7, s.py + d * 0.7), false, 'диагональ 45° освещена');
    /* границы конуса: внутри внешнего — светло, снаружи — нет */
    const inCone = Math.acos(FL_COS_OUT) - 0.03,
      outCone = Math.acos(FL_COS_OUT) + 0.03;
    T.eq(
      cellLitByFlash(s, s.px + Math.cos(inCone) * d, s.py + Math.sin(inCone) * d),
      true,
      'внутри внешнего конуса темно'
    );
    T.eq(
      cellLitByFlash(s, s.px + Math.cos(-inCone) * d, s.py + Math.sin(-inCone) * d),
      true,
      'конус несимметричен'
    );
    T.eq(
      cellLitByFlash(s, s.px + Math.cos(outCone) * d, s.py + Math.sin(outCone) * d),
      false,
      'вне внешнего конуса светло'
    );
    /* ядро конуса уже внешнего */
    T.ok(Math.acos(FL_COS_IN) < inCone, 'ядро конуса не уже внешнего');
    /* поворот взгляда поворачивает конус */
    for (const a of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
      s.ang = a;
      T.eq(
        cellLitByFlash(s, s.px + Math.cos(a) * d, s.py + Math.sin(a) * d),
        true,
        'конус не повернулся на ' + a
      );
      T.eq(
        cellLitByFlash(s, s.px - Math.cos(a) * d, s.py - Math.sin(a) * d),
        false,
        'старое направление светится при ' + a
      );
    }
    s.ang = 0;
    /* дальность */
    T.eq(cellLitByFlash(s, s.px + FL_RANGE - 0.5, s.py), true, 'внутри дальности темно');
    T.eq(cellLitByFlash(s, s.px + FL_RANGE + 0.5, s.py), false, 'за пределами дальности светло');
    T.eq(cellLitByFlash(s, s.px + 4.5, s.py), true, 'внутри площадки темно');
    /* линия видимости: стена гасит луч, но не засветку вокруг игрока */
    const s2 = LIB.run({
      seed: 'cone-wall',
      W: 14,
      H: 14,
      density: 0.5,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    let spot = null;
    for (const idx of s2.mazeFloors) {
      const x = idx % s2.W;
      if (s2.grid[idx + 1] === 1) {
        spot = { x: x + 0.5, y: ((idx / s2.W) | 0) + 0.5 };
        break;
      }
    }
    T.ok(spot, 'не нашлось пола со стеной справа');
    s2.px = spot.x;
    s2.py = spot.y;
    s2.ang = 0;
    s2.pitch = 0;
    s2.fl.owned = true;
    s2.fl.on = true;
    s2.fl.bri = 1;
    s2.fl.e = 1;
    T.eq(cellLitByFlash(s2, spot.x + 0.4, spot.y), true, 'луч не доходит до стены');
    T.eq(
      cellLitByFlash(s2, spot.x + FL_SPILL_R * 0.5, spot.y + 0.3),
      true,
      'засветка зависит от линии видимости'
    );
    T.eq(cellLitByFlash(s2, spot.x + FL_SPILL_R + 1.2, spot.y), false, 'луч прошёл сквозь стену');
  });

  T.test('свет: playerInDark — темнота без лампы и без фонаря', function () {
    const s = LIB.run({
      seed: 'dark',
      W: 18,
      H: 18,
      density: 0,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    const dk = darkSpot(s);
    T.ok(dk, 'на карте без ламп нет ни одной тёмной клетки');
    T.eq(playerInDark(s), true, 'тёмная клетка не считается тёмной');
    T.ok(s.light[dk.idx] < HALLU_DARK_T, 'свет в тёмной клетке выше порога');
    /* фонарик снимает темноту */
    s.fl.owned = true;
    s.fl.on = true;
    s.fl.bri = 1;
    s.fl.e = 1;
    T.eq(playerInDark(s), false, 'с включённым фонарём темно');
    s.fl.bri = 0.05;
    T.eq(playerInDark(s), true, 'умирающий фонарь (bri=0.05) спасает от темноты');
    s.fl.bri = 0.06;
    T.eq(playerInDark(s), false, 'порог яркости 0.06 не работает');
    s.fl.on = false;
    s.fl.bri = 1;
    T.eq(playerInDark(s), true, 'выключенный фонарь в руках спасает');
    /* светлая клетка не тёмная */
    const lt = litSpot(s);
    T.ok(lt, 'не нашлось освещённой клетки');
    s.px = lt.x;
    s.py = lt.y;
    T.eq(playerInDark(s), false, 'под лампой темно');
    T.ok(s.light[lt.idx] >= HALLU_DARK_T, 'свет под лампой ниже порога');
    /* вне карты — не темнота (защита от телепорта за пределами мира) */
    s.px = -5;
    s.py = -5;
    T.eq(playerInDark(s), false, 'за картой темно');
  });

  function sum(a) {
    let t = 0;
    for (let i = 0; i < a.length; i++) t += a[i];
    return t;
  }
  function near1(a, b) {
    return Math.abs(a - b) < 1e-4;
  }

  T.test('свет: updateLamps пересобирает карту света и поле рассеяния', function () {
    const s = LIB.run({
      seed: 'upd',
      W: 16,
      H: 16,
      density: 0.5,
      cabDens: 0,
      loot: 0,
      monster: true
    });
    const n = s.W * s.H;
    T.eq(s.light.length, n, 'light');
    T.eq(s.gate.length, n, 'gate');
    T.ok(s.giA && s.giA.length === n, 'giA не создан');
    T.ok(s.giB && s.giB.length === n, 'giB не создан');
    T.eq(s.giOp.length, n, 'giOp');
    let mn = Infinity,
      mx = -Infinity,
      gmn = Infinity,
      gmx = -Infinity;
    for (let i = 0; i < n; i++) {
      T.finite(s.light[i], 'light[' + i + ']');
      T.finite(s.giA[i], 'giA[' + i + ']');
      if (s.light[i] < mn) mn = s.light[i];
      if (s.light[i] > mx) mx = s.light[i];
      if (s.giA[i] < gmn) gmn = s.giA[i];
      if (s.giA[i] > gmx) gmx = s.giA[i];
    }
    T.near(mn, AMBIENT, 1e-6, 'минимум света');
    T.ok(mx <= 1 + 1e-6, 'максимум света ' + mx);
    T.ok(gmn >= 0, 'giA отрицательный');
    T.ok(gmx > 0, 'поле рассеяния пустое');
    /* нулевой шаг ничего не меняет (без монстра мерцание не запускается) */
    const s0 = LIB.run({
      seed: 'upd0',
      W: 16,
      H: 16,
      density: 0.5,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    const lBefore = sum(s0.light),
      gBefore = s0.lamps.map(l => l.gt).join(',');
    updateLamps(s0, 0);
    T.near(sum(s0.light), lBefore, 1e-6, 'нулевой шаг изменил свет');
    T.eq(s0.lamps.map(l => l.gt).join(','), gBefore, 'нулевой шаг изменил время горения');
    /* одинаковая последовательность шагов даёт одинаковый свет */
    const s1 = LIB.run({
      seed: 'upd0',
      W: 16,
      H: 16,
      density: 0.5,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    for (let i = 0; i < 120; i++) {
      updateLamps(s0, 1 / 60);
      updateLamps(s1, 1 / 60);
    }
    T.near(sum(s0.light), sum(s1.light), 1e-6, 'свет разошёлся на одинаковых входах');
    /* постоянные лампы не гаснут */
    updateLamps(s, 5);
    for (const l of s.lamps.filter(x => x.always)) T.eq(l.I, 1, 'постоянная лампа погасла');
    /* обычные лампы теряют время горения */
    const far = s.lamps.filter(
      l => !l.always && Math.hypot(l.x + 0.5 - s.mx, l.y + 0.5 - s.my) >= 3.8
    );
    T.ok(far.length > 3, 'мало ламп вдали от монстра');
    const g1 = far.map(l => l.gt);
    updateLamps(s, 1);
    let decreased = 0;
    for (let i = 0; i < g1.length; i++) if (near1(far[i].gt, g1[i] - 1)) decreased++;
    T.eq(
      decreased,
      g1.length,
      'время горения уменьшилось не у всех дальних ламп: ' + decreased + '/' + g1.length
    );
    for (const l of far) T.eq(l.I, 1, 'дальняя лампа не на полной яркости');
    for (const l of s.lamps) T.ok(l.I >= 0 && l.I <= 1, 'яркость лампы вне [0,1]: ' + l.I);
  });

  T.test('свет: лампа перегорает и уходит в короткое затухание', function () {
    const s = LIB.run({
      seed: 'burn',
      W: 12,
      H: 12,
      density: 0.5,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    const l = s.lamps.find(x => !x.always);
    T.ok(l, 'нет обычной лампы');
    l.gt = 0.05;
    updateLamps(s, 0.1);
    T.ok(l.gOff > 0, 'лампа не ушла в затухание');
    /* gOff задаётся в [0.10,0.16] и тут же уменьшается на dt */
    T.inRange(l.gOff, 0.1 - 0.1 - 1e-9, 0.16 - 0.1 + 1e-9, 'длительность затухания');
    T.near(l.I, 0.05, 1e-9, 'яркость в затухании');
    T.inRange(l.gt, 14 - 0.1, 60, 'новое время горения');
    T.ok(s.light[l.y * s.W + l.x] < 0.2, 'потухшая лампа светит как полная');
    /* затухание trwa до конца следующего кадра, затем лампа снова горит */
    updateLamps(s, 0.2);
    T.ok(l.gOff <= 0, 'затухание не закончилось');
    T.near(l.I, 0.05, 1e-9, 'яркость сменилась раньше окончания кадра');
    updateLamps(s, 1 / 60);
    T.eq(l.I, 1, 'лампа не вернулась к полной яркости');
    /* свет в её клетке заметно выше фонового */
    T.ok(s.light[l.y * s.W + l.x] > AMBIENT * 2, 'лампа не осветила клетку');
  });

  T.test('свет: лампы мигают рядом с Надзирателем и стабильны вдали', function () {
    const s = LIB.run({
      seed: 'flick2',
      W: 16,
      H: 16,
      density: 0.6,
      cabDens: 0,
      loot: 0,
      monster: true
    });
    const near = s.lamps.find(
      l => !l.always && Math.hypot(l.x + 0.5 - s.mx, l.y + 0.5 - s.my) < 3.8
    );
    const far = s.lamps.find(l => !l.always && Math.hypot(l.x + 0.5 - s.mx, l.y + 0.5 - s.my) > 6);
    T.ok(near, 'нет лампы рядом с монстром');
    T.ok(far, 'нет лампы вдали от монстра');
    const seen = new Set();
    let farChanged = 0;
    const far0 = far.I;
    for (let i = 0; i < 400; i++) {
      updateLamps(s, 1 / 60);
      seen.add(near.I.toFixed(4));
      if (far.I !== far0) farChanged++;
    }
    T.ok(seen.size > 3, 'лампа рядом с монстром не мерцает: значений ' + seen.size);
    for (const v of seen) T.ok(+v > 0 && +v <= 1, 'яркость мигания вне [0,1]: ' + v);
    T.eq(farChanged, 0, 'дальняя лампа меняла яркость ' + farChanged + ' раз');
    T.eq(far.I, 1, 'дальняя лампа не на полной яркости');
    /* мерцание детерминировано: одинаковые прогоны дают одинаковые значения */
    const run = () => {
      const st = LIB.run({
        seed: 'flick2',
        W: 16,
        H: 16,
        density: 0.6,
        cabDens: 0,
        loot: 0,
        monster: true
      });
      const l = st.lamps.find(
        x => !x.always && Math.hypot(x.x + 0.5 - st.mx, x.y + 0.5 - st.my) < 3.8
      );
      const seq = [];
      for (let i = 0; i < 400; i++) {
        updateLamps(st, 1 / 60);
        seq.push(l.I.toFixed(6) + ':' + (l.on2 ? 1 : 0));
      }
      return seq.join('|');
    };
    T.eq(run(), run(), 'мерцание не воспроизводится');
  });

  T.test('свет: рассеянный свет огибает углы и затухает с расстоянием', function () {
    const s = LIB.run({
      seed: 'gi',
      W: 14,
      H: 14,
      density: 0.5,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    updateLamps(s, 0);
    const l = s.lamps.find(x => !x.always) || s.lamps[0];
    const at = l.y * s.W + l.x;
    T.ok(s.giA[at] > 0, 'в клетке лампы нет рассеянного света');
    /* ищем клетку той же лампы за углом: свет прямой мал, рассеянный есть */
    let corner = null;
    for (const idx of s.mazeFloors) {
      const d = Math.hypot((idx % s.W) - l.x, ((idx / s.W) | 0) - l.y);
      if (d < 1.5 || d > 4) continue;
      if (!los(s, l.x + 0.5, l.y + 0.5, (idx % s.W) + 0.5, ((idx / s.W) | 0) + 0.5)) {
        if (s.giA[idx] > 0) {
          corner = { idx, d };
          break;
        }
      }
    }
    if (corner) {
      T.ok(s.giA[corner.idx] < s.giA[at], 'за углом света больше, чем у лампы');
      T.ok(s.giA[corner.idx] > 0, 'за углом света нет вовсе');
    }
    /* поле не растёт выше прямого света и не уходит в минус */
    for (let i = 0; i < s.giA.length; i++) {
      T.ok(s.giA[i] >= 0, 'giA[' + i + '] < 0');
      T.ok(s.giA[i] <= 16, 'giA[' + i + '] слишком велик: ' + s.giA[i]);
      if (s.grid[i] === 1) T.ok(s.giA[i] <= s.light[i] + 1e-6, 'стена накопила свет');
    }
    /* giOp помечает проходимые клетки */
    T.eq(s.giOp[at], 1, 'клетка лампы не открыта');
    T.eq(s.giOp[0], 0, 'угол карты открыт');
    const d = s.safeDoors[0];
    T.eq(s.giOp[d.y * s.W + d.x], 0, 'закрытая дверь считается открытой');
    s.doorState[d.y * s.W + d.x] = 1;
    updateLamps(s, 0);
    T.eq(s.giOp[d.y * s.W + d.x], 1, 'открытая дверь не считается проходимой');
  });

  T.test('свет: темнота копится в darkT и сбрасывается на свету', function () {
    const s = LIB.run({
      seed: 'darkT',
      W: 18,
      H: 18,
      density: 0,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    const dk = darkSpot(s);
    T.ok(dk, 'нет тёмной клетки');
    s.px = dk.x;
    s.py = dk.y;
    T.eq(s.darkT || 0, 0, 'darkT не ноль в начале');
    for (let i = 0; i < 60; i++) update(s, {}, 1 / 60);
    T.near(s.darkT, 1, 1e-6, 'darkT не накопился за секунду');
    for (let i = 0; i < 120; i++) update(s, {}, 1 / 60);
    T.near(s.darkT, 3, 1e-6, 'darkT не накопился за три секунды');
    const lt = litSpot(s);
    T.ok(lt, 'нет светлой клетки');
    s.px = lt.x;
    s.py = lt.y;
    update(s, {}, 1 / 60);
    T.eq(s.darkT, 0, 'darkT не сбросился на свету');
  });
})();

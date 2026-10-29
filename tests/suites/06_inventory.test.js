'use strict';
/* Инвентарь и предметы: четыре слота, стеки батареек, выбор предмета в руку,
   перекладывание и отложенный подбор. Геометрия мебели — там же, она общая. */

(function () {
  const T = __T;

  function fresh(cfg) {
    return LIB.run(
      Object.assign(
        { seed: 'inv', W: 10, H: 10, density: 0, cabDens: 0, loot: 0, monster: false },
        cfg || {}
      )
    );
  }
  const kinds = s => s.inv.map(x => (x ? x.kind + (x.kind === 'batt' ? x.n : '') : '-')).join(',');

  T.test('инвентарь: четыре пустых слота, ничего не выбрано', function () {
    const s = fresh();
    T.eq(s.inv.length, INV_SLOTS, 'число слотов');
    for (let i = 0; i < INV_SLOTS; i++) T.eq(s.inv[i], null, 'слот ' + i + ' не пуст');
    T.eq(s.sel, -1, 'выбранный слот');
    T.eq(invSelKind(s), null, 'предмет в руке');
    T.eq(invCount(s, 'flash'), 0, 'фонарик');
    T.eq(invCount(s, 'batt'), 0, 'батарейки');
    T.eq(invCount(s, 'key'), 0, 'ключ');
    T.eq(invSlotOfKind(s, 'flash'), -1, 'слот фонарика');
  });

  T.test('инвентарь: первый предмет сам берётся в руку', function () {
    const s = fresh();
    T.eq(invAdd(s, 'flash'), true, 'фонарик не добавился');
    T.eq(s.sel, 0, 'выбор не перешёл на первый предмет');
    T.eq(invSelKind(s), 'flash', 'предмет в руке');
    T.eq(kinds(s), 'flash,-,-,-', 'раскладка');
    /* второй предмет руку не перехватывает */
    T.eq(invAdd(s, 'key'), true, 'ключ не добавился');
    T.eq(s.sel, 0, 'выбор перескочил на новый предмет');
    T.eq(kinds(s), 'flash,key,-,-', 'раскладка после ключа');
    /* дубликаты одиночных предметов не берутся */
    T.eq(invAdd(s, 'flash'), false, 'второй фонарик добавился');
    T.eq(invAdd(s, 'key'), false, 'второй ключ добавился');
    T.eq(kinds(s), 'flash,key,-,-', 'раскладка изменилась от отказа');
    T.eq(invCount(s, 'flash'), 1, 'счётчик фонариков');
  });

  T.test('инвентарь: батарейки стекаются, полный инвентарь отказывает', function () {
    const s = fresh();
    for (let i = 1; i <= BATT_STACK; i++) {
      T.eq(invAdd(s, 'batt'), true, 'батарейка ' + i);
      T.eq(invCount(s, 'batt'), i, 'счётчик после ' + i);
      T.eq(s.inv[0].n, i, 'стак в первом слоте');
    }
    T.eq(kinds(s), 'batt' + BATT_STACK + ',-,-,-', 'первый стак');
    /* полный стак не мешает подбору: батарейка уходит в свободный слот */
    T.eq(invAdd(s, 'batt'), true, 'батарейка поверх полного стака');
    T.eq(kinds(s), 'batt' + BATT_STACK + ',batt1,-,-', 'второй стак');
    T.eq(invCount(s, 'batt'), BATT_STACK + 1, 'счётчик');
    /* заполняем всё */
    invAdd(s, 'flash');
    while (invAdd(s, 'batt')) {
      /* до отказа */
    }
    T.eq(invCount(s, 'batt'), (INV_SLOTS - 1) * BATT_STACK, 'вместимость по батарейкам');
    T.eq(s.inv.filter(x => !x).length, 0, 'остался свободный слот');
    T.eq(invAdd(s, 'batt'), false, 'батарейка легла в полный инвентарь');
    T.eq(invAdd(s, 'key'), false, 'ключ лёг в полный инвентарь');
    for (const it of s.inv) {
      if (it.kind === 'batt') T.inRange(it.n, 1, BATT_STACK, 'стак вне предела');
    }
  });

  T.test('инвентарь: invRemoveBatt снимает по одной и чинит выбор', function () {
    const s = fresh();
    T.eq(invRemoveBatt(s), false, 'сняли батарейку из пустого инвентаря');
    invAdd(s, 'flash');
    T.eq(invRemoveBatt(s), false, 'сняли батарейку, когда их нет');
    invAdd(s, 'batt');
    invAdd(s, 'batt');
    invAdd(s, 'batt');
    T.eq(invCount(s, 'batt'), 3, 'счётчик');
    T.eq(s.sel, 0, 'выбор');
    /* выбираем слот с батарейками и опустошаем его */
    invSelectKind(s, 'batt');
    const slot = s.sel;
    T.eq(s.inv[slot].kind, 'batt', 'выбран не тот слот');
    for (let i = 0; i < 3; i++) {
      T.eq(invRemoveBatt(s), true, 'снятие ' + i);
    }
    T.eq(invCount(s, 'batt'), 0, 'батарейки остались');
    T.eq(s.inv[slot], null, 'пустой слот не освобождён');
    T.neq(s.sel, slot, 'выбор остался на пустом слоте');
    T.eq(invSelKind(s), 'flash', 'в руке не фонарик');
    /* sel всегда указывает на занятый слот или -1 */
    invFixSel(s);
    T.ok(s.sel === -1 || !!s.inv[s.sel], 'invFixSel оставил выбор на пустом');
    s.inv[0] = null;
    s.sel = 0;
    invFixSel(s);
    T.eq(invSelKind(s), null, 'в руке остался предмет из пустого слота');
  });

  T.test('инвентарь: invSelectKind и invSlotOfKind ищут предмет', function () {
    const s = fresh();
    invAdd(s, 'flash');
    invAdd(s, 'key');
    invAdd(s, 'batt');
    T.eq(invSlotOfKind(s, 'flash'), 0, 'слот фонарика');
    T.eq(invSlotOfKind(s, 'key'), 1, 'слот ключа');
    T.eq(invSlotOfKind(s, 'batt'), 2, 'слот батареек');
    T.eq(invSlotOfKind(s, 'nosuch'), -1, 'несуществующий предмет');
    T.eq(invSelectKind(s, 'key'), true, 'ключ не выбрался');
    T.eq(s.sel, 1, 'выбор');
    T.eq(invSelKind(s), 'key', 'предмет в руке');
    T.eq(invSelectKind(s, 'nosuch'), false, 'выбор несуществующего удался');
    T.eq(s.sel, 1, 'отказанный выбор сбил руку');
  });

  T.test('инвентарь: invSwapTo запускает анимацию перекладывания', function () {
    const s = fresh();
    invAdd(s, 'flash');
    invAdd(s, 'key');
    s.time = 12.5;
    T.eq(invSwapTo(s, 1, false, false), true, 'перекладывание не началось');
    T.ok(s.sw, 's.sw не создан');
    T.eq(s.sw.slot, 1, 'целевой слот');
    T.eq(s.sw.t0, 12.5, 'время начала');
    T.near(s.sw.dur, SW_DUR, 1e-12, 'длительность');
    T.eq(s.sw.applied, false, 'уже применено');
    T.eq(s.sw.drop, false, 'флаг броска');
    T.eq(s.sw.fromKind, 'flash', 'предмет в руке на момент старта');
    /* пока анимация идёт, новый обмен не начинается */
    T.eq(invSwapTo(s, 0, false, false), false, 'обмен во время анимации');
    T.eq(invSwapTo(s, 5, false, false), false, 'несуществующий слот');
    T.eq(invSwapTo(s, -1, false, false), false, 'отрицательный слот');
    /* тот же слот без броска — отказ (рука и так там) */
    s.sw = null;
    s.sel = 1;
    T.eq(invSwapTo(s, 1, false, false), false, 'обмен в текущий слот');
    T.eq(s.sw, null, 's.sw создан зря');
    /* бросок разрешён в тот же слот: он освободится */
    T.eq(invSwapTo(s, 1, false, true), true, 'бросок не начался');
    T.eq(s.sw.drop, true, 'флаг броска');
  });

  T.test('инвентарь: pkDefer оставляет руку пустой до вершины клипа', function () {
    const s = fresh();
    s.time = 3;
    /* обычный подбор: слот появился, рука пустая, создан s.pk */
    s.inv[2] = { kind: 'key' };
    s.sel = 2;
    pkDefer(s, -1, 'key', false);
    T.ok(s.pk, 's.pk не создан');
    T.eq(s.pk.slot, 2, 'слот в s.pk');
    T.eq(s.pk.kind, 'key', 'предмет в s.pk');
    T.eq(s.pk.t0, 3, 'время подбора');
    T.eq(s.sel, -1, 'рука не осталась пустой');
    /* автопилот и занятая рука не ждут анимации */
    const s2 = fresh();
    s2.bot = true;
    s2.inv[1] = { kind: 'flash' };
    s2.sel = 1;
    pkDefer(s2, -1, 'flash', false);
    T.eq(s2.pk, null, 'автопилот получил отложенный подбор');
    T.eq(s2.sel, 1, 'выбор автопилота сбит');
    const s3 = fresh();
    s3.inv[0] = { kind: 'flash' };
    s3.inv[1] = { kind: 'key' };
    s3.sel = 1;
    pkDefer(s3, 0, 'key', true);
    T.eq(s3.pk, null, 'занятая рука получила отложенный подбор');
    T.eq(s3.sel, 1, 'выбор сбит при занятой руке');
  });

  T.test('инвентарь: геометрия мебели — фасад, центр и коробка', function () {
    const s = LIB.run({
      seed: 'geo',
      W: 12,
      H: 12,
      density: 0.3,
      cabDens: 0.4,
      loot: 100,
      monster: false
    });
    T.ok(s.cabs.length > 3, 'мало тумбочек для проверки');
    for (const c of s.cabs) {
      const f = cabFront(c);
      T.deepEq(f, { x: -c.wx, y: -c.wy }, 'фасад');
      const cc = cabCenter(c, CAB_D);
      T.near(cc.x, c.x + 0.5 + c.wx * (0.5 - CAB_D / 2), 1e-12, 'центр по X');
      T.near(cc.y, c.y + 0.5 + c.wy * (0.5 - CAB_D / 2), 1e-12, 'центр по Y');
      /* центр всегда внутри своей клетки */
      T.eq(Math.floor(cc.x), c.x, 'центр вышел из клетки по X');
      T.eq(Math.floor(cc.y), c.y, 'центр вышел из клетки по Y');
      const b = boxOf(c, CAB_D, CAB_W);
      T.near(b.hx * b.hz, (CAB_D * CAB_W) / 4, 1e-12, 'площадь коробки');
      T.eq(b.hx > 0 && b.hz > 0, true, 'полуоси положительные');
      /* коробка не вылезает за пределы клетки больше, чем на половину глубины/ширины */
      T.ok(b.cx - b.hx >= c.x - 0.001 && b.cx + b.hx <= c.x + 1.001, 'коробка вылезла по X');
      T.ok(b.cy - b.hz >= c.y - 0.001 && b.cy + b.hz <= c.y + 1.001, 'коробка вылезла по Y');
    }
    /* коробка стола согласована с его размерами */
    const tb = boxOf(s.table, TBL_D, TBL_W);
    T.near(tb.hx * tb.hz, (TBL_D * TBL_W) / 4, 1e-12, 'площадь коробки стола');
    T.near(
      boxCenter(s.table, TBL_D).x,
      s.table.x + 0.5 + s.table.wx * (0.5 - TBL_D / 2),
      1e-12,
      'центр стола'
    );
    /* cabCenter всегда считает по глубине тумбочки */
    T.near(cabCenter(s.cabs[0]).x, boxCenter(s.cabs[0], CAB_D).x, 1e-12, 'cabCenter');
  });

  T.test('инвентарь: nearest* ищет ближайший объект в радиусе', function () {
    const s = LIB.run({
      seed: 'near',
      W: 16,
      H: 16,
      density: 0.3,
      cabDens: 0.4,
      loot: 100,
      monster: false
    });
    T.ok(s.cabs.length > 2, 'мало тумбочек');
    const c = s.cabs[0];
    const cc = cabCenter(c),
      f = cabFront(c);
    /* со стороны фасада тумбочка доступна, сквозь стену — нет */
    T.eq(
      nearestCab(s, cc.x + f.x * 0.4, cc.y + f.y * 0.4, 3),
      c,
      'тумбочка не найдена со стороны фасада'
    );
    T.neq(
      nearestCab(s, cc.x - f.x * 0.4, cc.y - f.y * 0.4, 3),
      c,
      'тумбочка доступна сквозь стену'
    );
    T.eq(nearestCab(s, cc.x + f.x * 0.4, cc.y + f.y * 0.4, 0.01), null, 'радиус не соблюдён');
    T.eq(nearestCab(s, -50, -50, 3), null, 'тумбочка найдена далеко за картой');
    /* ищется ближайшая из доступных (с учётом стороны фасада) */
    let best = null,
      bd = Infinity;
    for (const q of s.cabs) {
      const qc = cabCenter(q),
        qf = cabFront(q);
      const d = Math.hypot(qc.x - s.px, qc.y - s.py);
      if ((s.px - qc.x) * qf.x + (s.py - qc.y) * qf.y <= -0.22) continue;
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    T.eq(nearestCab(s, s.px, s.py, 1e6), best, 'поиск ближайшей от игрока');
    /* батарейки на полу: только не подобранные */
    s.batts.push({ x: s.px, y: s.py, taken: false });
    T.eq(nearestBatt(s, s.px, s.py, 2).taken, false, 'батарейка не найдена');
    s.batts[0].taken = true;
    T.eq(nearestBatt(s, s.px, s.py, 2), null, 'подобранная батарейка найдена');
    s.batts.push({ x: s.px + 4, y: s.py, taken: false });
    T.eq(nearestBatt(s, s.px, s.py, 1), null, 'батарейка найдена вне радиуса');
    /* предметы на полу */
    T.eq(nearestDrop(s, s.px, s.py, 2), null, 'на полу что-то нашлось');
    const dr = { kind: 'flash', wx: s.px + 0.1, wy: s.py };
    s.drops.push(dr);
    T.eq(nearestDrop(s, s.px, s.py, 2), dr, 'предмет на полу не найден');
    T.eq(nearestDrop(s, s.px, s.py, 0.01), null, 'предмет найден вне радиуса');
    s.drops.push({ kind: 'batt', wx: s.px - 3, wy: s.py });
    T.eq(nearestDrop(s, s.px, s.py, 10), dr, 'найден не ближайший предмет');
  });

  T.test('инвентарь: pickUp кладёт предмет и сообщает событием', function () {
    const s = fresh();
    const ev = [];
    T.eq(pickUp(s, 'flash', ev), true, 'фонарик не поднялся');
    T.eq(kinds(s), 'flash,-,-,-', 'раскладка');
    T.deepEq(ev, ['pickup_flash'], 'события');
    T.eq(pickUp(s, 'key', ev), true, 'ключ не поднялся');
    T.ok(ev.indexOf('pickup_key') >= 0, 'нет события pickup_key');
    T.eq(pickUp(s, 'flash', ev), false, 'второй фонарик поднялся');
    /* полный инвентарь — inv_full */
    const s2 = fresh();
    invAdd(s2, 'flash');
    invAdd(s2, 'key');
    while (invAdd(s2, 'batt')) {
      /* заполняем стеки */
    }
    const ev2 = [];
    T.eq(pickUp(s2, 'batt', ev2), false, 'подбор в полный инвентарь удался');
    T.deepEq(ev2, ['inv_full'], 'событие полного инвентаря');
    /* батарейки увеличивают стак */
    const s3 = fresh();
    const ev3 = [];
    pickUp(s3, 'batt', ev3);
    pickUp(s3, 'batt', ev3);
    T.eq(invCount(s3, 'batt'), 2, 'стак');
    T.deepEq(ev3, ['pickup_batt', 'pickup_batt'], 'события батареек');
  });
})();

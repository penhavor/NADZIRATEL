'use strict';
/* Движение и запросы к карте: клетки, блокировки, линия видимости, BFS,
   коробки мебели и зазор камеры. Это фундамент и ходьбы, и ИИ, и звука. */

(function () {
  const T = __T;
  const BASE = {
    seed: 'movement',
    W: 16,
    H: 16,
    density: 0.4,
    cabDens: 0.25,
    loot: 100,
    monster: false
  };

  function fresh(cfg) {
    const s = LIB.run(Object.assign({}, BASE, cfg || {}));
    const sp = LIB.openSpot(s);
    s.px = sp.x;
    s.py = sp.y;
    return s;
  }
  /* свободная клетка, у которой сосед слева — стена */
  function spotNearWall(s) {
    for (const idx of s.mazeFloors) {
      const x = idx % s.W,
        y = (idx / s.W) | 0;
      if (
        s.grid[idx - 1] === 1 &&
        s.grid[idx + 1] === 0 &&
        s.grid[idx - s.W] === 0 &&
        s.grid[idx + s.W] === 0
      ) {
        return { x: x + 0.5, y: y + 0.5 };
      }
    }
    throw new Error('не найдена клетка у стены');
  }

  T.test('движение: cellAt читает сетку и считает выход за карту стеной', function () {
    const s = LIB.run(BASE);
    T.eq(cellAt(s, s.start.x + 0.5, s.start.y + 0.5), 0, 'пол');
    T.eq(cellAt(s, 0.5, 0.5), 1, 'стена');
    T.eq(cellAt(s, s.door.x + 0.5, s.door.y + 0.5), 2, 'дверь выхода');
    T.eq(cellAt(s, s.safeDoors[0].x + 0.5, s.safeDoors[0].y + 0.5), 3, 'дверь убежища');
    T.eq(cellAt(s, -1, -1), 1, 'за картой');
    T.eq(cellAt(s, s.W + 5, s.H + 5), 1, 'далеко за картой');
    /* NaN не защищён: cellAt отдаёт undefined. В игре до него не доходит
       (позиция всегда конечна), но поведение фиксируем, чтобы заметить изменение поведения */
    T.eq(cellAt(s, NaN, NaN), undefined, 'cellAt(NaN) изменил поведение');
    /* координаты округляются вниз: любая точка клетки даёт её значение */
    for (const f of [0.001, 0.5, 0.999]) {
      T.eq(cellAt(s, s.start.x + f, s.start.y + f), 0, 'доля ' + f);
    }
  });

  T.test('движение: blocked — стены и двери, пол и открытая дверь убежища проходимы', function () {
    const s = fresh();
    T.eq(blocked(s, s.px, s.py), false, 'пол заблокирован');
    T.eq(blocked(s, 0.5, 0.5), true, 'стена не блокирует');
    T.eq(blocked(s, s.door.x + 0.5, s.door.y + 0.5), true, 'дверь выхода не блокирует');
    const d = s.safeDoors[0];
    T.eq(blocked(s, d.x + 0.5, d.y + 0.5), true, 'закрытая дверь убежища не блокирует');
    s.doorState[d.y * s.W + d.x] = 0.5;
    T.eq(blocked(s, d.x + 0.5, d.y + 0.5), true, 'дверь на пороге 0.5 уже открыта');
    s.doorState[d.y * s.W + d.x] = 0.51;
    T.eq(blocked(s, d.x + 0.5, d.y + 0.5), false, 'открытая дверь убежища блокирует');
    T.eq(safeOpenAt(s, d.x, d.y), true, 'safeOpenAt');
    T.eq(blocked(s, -2, -2), true, 'вне карты');
    /* мебель блокируется отдельно (resolveBoxes), а не через blocked */
    const c = s.cabs[0];
    const b = boxOf(c, CAB_D, CAB_W);
    T.eq(blocked(s, b.cx, b.cy), false, 'тумбочка блокирует клетку');
    T.eq(inBox(s, b.cx, b.cy, 0), true, 'тумбочка не найдена inBox');
  });

  T.test('движение: tryMove двигает по осям раздельно и не пускает в стену', function () {
    const s = fresh();
    const x0 = s.px,
      y0 = s.py;
    tryMove(s, 0.25, 0);
    T.near(s.px, x0 + 0.25, 1e-12, 'свободное перемещение по X');
    T.eq(s.py, y0, 'Y сдвинулся');
    tryMove(s, 0, -0.125);
    T.near(s.py, y0 - 0.125, 1e-12, 'свободное перемещение по Y');
    /* в стену — ни на сколько */
    const w = spotNearWall(s);
    s.px = w.x;
    s.py = w.y;
    tryMove(s, -0.6, 0);
    T.eq(s.px, w.x, 'игрок вошёл в стену');
    T.eq(s.py, w.y, 'Y сдвинулся при блокировке по X');
    /* вторая ось при этом работает: скольжение вдоль стены */
    tryMove(s, -0.6, 0.2);
    T.eq(s.px, w.x, 'X прошёл сквозь стену');
    T.near(s.py, w.y + 0.2, 1e-12, 'скольжение вдоль стены не работает');
    /* корпус (0.09 клетки) не проходит впритык к стене */
    s.px = w.x;
    s.py = w.y;
    for (let k = 0; k < 12; k++) tryMove(s, -0.08, 0);
    T.ok(s.px < w.x, 'игрок не сдвинулся к стене');
    T.ok(w.x - s.px > 0.3, 'игрок прошёл сквозь стену: ' + (w.x - s.px));
    T.neq(cellAt(s, s.px - 0.09, s.py), 1, 'плечо игрока в стене');
    T.neq(cellAt(s, s.px + 0.09, s.py), 1, 'второе плечо в стене');
  });

  T.test('движение: noclip проходит сквозь стены, но остаётся в карте', function () {
    const s = fresh();
    s.dev.noclip = true;
    tryMove(s, -99, -99);
    T.near(s.px, 0.05, 1e-12, 'нижняя граница X');
    T.near(s.py, 0.05, 1e-12, 'нижняя граница Y');
    tryMove(s, 999, 999);
    T.near(s.px, s.W - 0.05, 1e-12, 'верхняя граница X');
    T.near(s.py, s.H - 0.05, 1e-12, 'верхняя граница Y');
    T.eq(blocked(s, s.px, s.py), true, 'noclip не должен выталкивать из стены');
    s.dev.noclip = false;
  });

  T.test('движение: clampClear выталкивает камеру из текстуры', function () {
    const s = fresh();
    const w = spotNearWall(s);
    /* вплотную к границе клетки — зазор не нужен */
    s.px = w.x;
    s.py = w.y;
    clampClear(s);
    T.near(s.px, w.x, 1e-12, 'зазор сработал в центре клетки');
    /* наезжаем на стену слева: камера обязана отступить на CLR_WALL */
    s.px = w.x - 0.5 + CLR_WALL - 0.02;
    s.py = w.y;
    clampClear(s);
    T.near(s.px, Math.floor(s.px) + CLR_WALL, 1e-9, 'не дотянули до зазора стены');
    T.eq(blocked(s, s.px - CLR_WALL - 1e-6, s.py), true, 'стена не там, где зазор');
    T.eq(blocked(s, s.px, s.py), false, 'камера осталась в стене');
    /* noclip отключает выталкивание */
    s.dev.noclip = true;
    const before = s.px;
    clampClear(s);
    T.eq(s.px, before, 'clampClear сработал в noclip');
    s.dev.noclip = false;
    T.ok(CLR_DOOR > CLR_WALL, 'зазор двери меньше зазора стены');
  });

  T.test('движение: los симметрична и не видит сквозь стену', function () {
    const s = fresh();
    T.eq(los(s, s.px, s.py, s.px, s.py), true, 'в саму себя');
    T.eq(los(s, s.px, s.py, s.px + 0.3, s.py), true, 'соседняя точка');
    T.eq(los(s, s.px, s.py, 0.5, 0.5), false, 'сквозь карту');
    /* пара точек в одной открытой клетке и та же пара через стену */
    const w = spotNearWall(s);
    const a = { x: w.x, y: w.y },
      b = { x: w.x - 1.5, y: w.y };
    T.eq(los(s, a.x, a.y, b.x, b.y), false, 'стена не перекрыла луч');
    T.eq(los(s, b.x, b.y, a.x, a.y), false, 'los не симметрична');
    T.eq(los(s, a.x, a.y, a.x + 0.4, a.y), true, 'короткий луч в пределах клетки');
    /* losDoorsOpen не считает дверь убежища препятствием, но дверь выхода — считает */
    const d = s.safeDoors[0];
    const inside = { x: s.start.x + 0.5, y: s.start.y + 0.5 };
    const beyond = { x: d.x + 0.5, y: d.y + 1.5 };
    T.eq(cellAt(s, beyond.x, beyond.y), 0, 'клетка за дверью не пол');
    T.eq(los(s, inside.x, inside.y, beyond.x, beyond.y), false, 'los прошла через закрытую дверь');
    d.t = 1;
    s.doorState[d.y * s.W + d.x] = 1;
    T.eq(
      los(s, inside.x, inside.y, beyond.x, beyond.y),
      true,
      'los не прошла через открытую дверь'
    );
    T.eq(
      losDoorsOpen(s, inside.x, inside.y, beyond.x, beyond.y),
      true,
      'открытая дверь перекрыла луч'
    );
    s.doorState[d.y * s.W + d.x] = 0;
    T.eq(
      losDoorsOpen(s, inside.x, inside.y, beyond.x, beyond.y),
      true,
      'losDoorsOpen должна игнорировать дверь убежища'
    );
    /* дверь выхода непрозрачна даже для losDoorsOpen */
    const f = s.doorFace;
    const mz = { x: s.door.x + f.x + 0.5, y: s.door.y + f.y + 0.5 };
    const ex = { x: s.door.x - f.x + 0.5, y: s.door.y - f.y + 0.5 };
    T.neq(cellAt(s, mz.x, mz.y), 2, 'клетка со стороны лабиринта найдена неверно');
    T.eq(cellAt(s, ex.x, ex.y), 0, 'комната выхода не пол');
    T.eq(losDoorsOpen(s, mz.x, mz.y, ex.x, ex.y), false, 'дверь выхода прозрачна');
  });

  T.test('движение: wallCrossings и occFactor гасят звук за каждой стеной', function () {
    const s = fresh();
    T.eq(wallCrossings(s, s.px, s.py, s.px + 0.2, s.py), 0, 'пересечения в открытой клетке');
    T.eq(occFactor(s, s.px, s.py, s.px + 0.2, s.py), 1, 'коэффициент без стен');
    const w = spotNearWall(s);
    const k1 = wallCrossings(s, w.x, w.y, w.x - 1.5, w.y);
    T.ok(k1 >= 1, 'стена не пересечена');
    T.near(
      occFactor(s, w.x, w.y, w.x - 1.5, w.y),
      Math.max(0.015, Math.pow(0.14, k1)),
      1e-12,
      'occFactor'
    );
    /* чем дальше, тем больше стен и тише */
    let prev = 1,
      ks = [];
    for (const d of [1.5, 3, 6, 12, 24]) {
      const k = wallCrossings(s, w.x, w.y, w.x - d, w.y);
      const o = occFactor(s, w.x, w.y, w.x - d, w.y);
      ks.push(k);
      T.ok(o <= prev + 1e-12, 'звук усилился с расстоянием');
      T.ok(o >= 0.015, 'ниже пола: ' + o);
      prev = o;
    }
    T.ok(ks[ks.length - 1] >= ks[0], 'дальняя дистанция пересекла меньше стен');
    T.near(occFactor(s, w.x, w.y, w.x - 200, w.y), 0.015, 1e-12, 'пол не достигается');
    /* одна и та же пара точек даёт один результат */
    T.eq(wallCrossings(s, w.x, w.y, w.x - 3, w.y), ks[1], 'wallCrossings не детерминирована');
  });

  T.test('движение: bfsPath строит соседний путь только по проходимым клеткам', function () {
    const s = LIB.run(BASE);
    s.doorState[s.safeDoors[0].y * s.W + s.safeDoors[0].x] = 1;
    const from = { x: s.start.x, y: s.start.y };
    for (const to of [
      s.key,
      s.door,
      { x: s.mazeFloors[0] % s.W, y: (s.mazeFloors[0] / s.W) | 0 }
    ]) {
      const p = bfsPath(s, from, to);
      T.ok(p, 'путь не найден до ' + JSON.stringify(to));
      T.eq(p[0].x, from.x, 'путь начинается не там');
      T.eq(p[0].y, from.y, 'путь начинается не там по Y');
      T.eq(p[p.length - 1].x, to.x, 'путь заканчивается не там');
      T.eq(p[p.length - 1].y, to.y, 'путь заканчивается не там по Y');
      for (let i = 1; i < p.length; i++) {
        T.eq(
          Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y),
          1,
          'разрыв пути на шаге ' + i
        );
        const v = s.grid[p[i].y * s.W + p[i].x];
        /* промежуточные клетки — пол или открытая дверь убежища, последняя может быть дверью выхода */
        T.ok(
          v === 0 || (v === 3 && safeOpenAt(s, p[i].x, p[i].y)) || (i === p.length - 1 && v === 2),
          'путь идёт через клетку ' + v + ' на шаге ' + i
        );
      }
    }
    /* недостижимое и недопустимое */
    T.eq(bfsPath(s, from, { x: 0, y: 0 }), null, 'путь в стену');
    T.eq(bfsPath(s, from, { x: -5, y: -5 }), null, 'путь за карту');
    T.eq(bfsPath(s, from, { x: NaN, y: 1 }), null, 'путь в NaN');
    const one = bfsPath(s, from, from);
    T.eq(one.length, 1, 'путь в собственную клетку');
    /* закрытая дверь убежища запирает спавн */
    const s2 = LIB.run(BASE);
    T.eq(bfsPath(s2, s2.start, s2.key), null, 'путь найден через закрытую дверь');
  });

  T.test('движение: bfsDist согласована с bfsPath и не считает стены', function () {
    const s = LIB.run(BASE);
    const from = { x: s.mazeFloors[0] % s.W, y: (s.mazeFloors[0] / s.W) | 0 };
    const d = bfsDist(s, from);
    T.eq(d.length, s.W * s.H, 'длина');
    T.eq(d[from.y * s.W + from.x], 0, 'расстояние до цели');
    for (let i = 0; i < d.length; i++) {
      if (s.grid[i] === 1) T.eq(d[i], -1, 'стена получила расстояние');
      T.ok(d[i] === -1 || d[i] >= 0, 'dist[' + i + '] = ' + d[i]);
    }
    /* соседние достижимые клетки отличаются не больше чем на 1 */
    for (let y = 1; y < s.H - 1; y++)
      for (let x = 1; x < s.W - 1; x++) {
        const i = y * s.W + x;
        if (d[i] < 0) continue;
        for (const j of [i - 1, i + 1, i - s.W, i + s.W]) {
          if (d[j] < 0) continue;
          T.ok(Math.abs(d[i] - d[j]) <= 1, 'скачок расстояния между соседями ' + d[i] + '/' + d[j]);
        }
      }
    /* длина пути = расстояние + 1 (клетки, а не рёбра) */
    let checked = 0;
    for (const idx of s.mazeFloors.slice(0, 40)) {
      const to = { x: idx % s.W, y: (idx / s.W) | 0 };
      const p = bfsPath(s, from, to);
      if (!p) continue;
      T.eq(p.length, d[idx] + 1, 'путь и расстояние расходятся для ' + idx);
      checked++;
    }
    T.ok(checked > 10, 'мало клеток сверено: ' + checked);
  });

  T.test('движение: мебель — коробка, игрок из неё выталкивается', function () {
    const s = fresh();
    const c = s.cabs[0];
    T.eq(s._boxes.length, s.cabs.length + 1, 'число коробок');
    const b = boxOf(c, CAB_D, CAB_W);
    const cc = cabCenter(c, CAB_D);
    T.near(b.cx, cc.x, 1e-12, 'центр коробки');
    T.near(b.cy, cc.y, 1e-12, 'центр коробки по Y');
    T.near(cc.x, c.x + 0.5 + c.wx * (0.5 - CAB_D / 2), 1e-12, 'boxCenter');
    T.eq(
      c.wx !== 0
        ? b.hx === CAB_D / 2 && b.hz === CAB_W / 2
        : b.hx === CAB_W / 2 && b.hz === CAB_D / 2,
      true,
      'полуоси не соответствуют ориентации'
    );
    T.deepEq(cabFront(c), { x: -c.wx, y: -c.wy }, 'фасад тумбочки');
    /* ставим игрока внутрь коробки со стороны фасада — resolveBoxes
       выталкивает по короткой оси, то есть в комнату, а не в стену */
    const fr = cabFront(c);
    s.px = b.cx + fr.x * 0.02;
    s.py = b.cy + fr.y * 0.02;
    resolveBoxes(s);
    /* выталкивание ставит игрока ровно на границу корпуса (0.09), поэтому
       сравниваем с допуском на ошибку представления float */
    const outX = Math.abs(s.px - b.cx) >= b.hx + 0.09 - 1e-9;
    const outY = Math.abs(s.py - b.cy) >= b.hz + 0.09 - 1e-9;
    T.ok(outX || outY, 'игрок остался в тумбочке: dx=' + (s.px - b.cx) + ' dy=' + (s.py - b.cy));
    T.ok(Math.hypot(s.px - b.cx, s.py - b.cy) < 0.5, 'игрока выбросило слишком далеко');
    T.eq(cellAt(s, s.px, s.py), 0, 'вытолкнули в стену');
    T.ok((s.px - b.cx) * fr.x >= 0 && (s.py - b.cy) * fr.y >= 0, 'вытолкнули не в сторону фасада');
    /* noclip отключает выталкивание */
    s.px = b.cx;
    s.py = b.cy;
    s.dev.noclip = true;
    resolveBoxes(s);
    T.near(s.px, b.cx, 1e-12, 'resolveBoxes сработал в noclip');
    s.dev.noclip = false;
    /* стол тоже физический */
    const tb = boxOf(s.table, TBL_D, TBL_W);
    T.eq(inBox(s, tb.cx, tb.cy, 0), true, 'стол не в коробках');
  });

  T.test('движение: игрок никогда не оказывается в стене после случайной ходьбы', function () {
    const s = LIB.run({
      seed: 'nowalls',
      W: 14,
      H: 14,
      density: 0.4,
      cabDens: 0.3,
      loot: 50,
      monster: false
    });
    const rnd = T.rng(11);
    for (let i = 0; i < 4000; i++) {
      const inp = {
        fwd: rnd() < 0.5 ? 1 : 0,
        back: rnd() < 0.3 ? 1 : 0,
        left: rnd() < 0.3 ? 1 : 0,
        right: rnd() < 0.3 ? 1 : 0,
        run: rnd() < 0.4 ? 1 : 0,
        crouch: rnd() < 0.1 ? 1 : 0
      };
      update(s, inp, 1 / 60);
      if (i % 7 === 0) {
        T.neq(
          cellAt(s, s.px, s.py),
          1,
          'кадр ' + i + ': игрок в стене (' + s.px.toFixed(3) + ',' + s.py.toFixed(3) + ')'
        );
        T.inRange(s.px, 0, s.W, 'px вне карты');
        T.inRange(s.py, 0, s.H, 'py вне карты');
        T.eq(inBox(s, s.px, s.py, 0.09), false, 'кадр ' + i + ': игрок застрял в мебели');
      }
    }
    T.ok(s.steps > 1, 'игрок почти не двигался: ' + s.steps);
  });
})();

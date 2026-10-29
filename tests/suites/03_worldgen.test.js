'use strict';
/* Генерация мира: лабиринт, комнаты, тумбочки, лампы и карта света.
   Здесь же — воспроизводимость по сиду и поведение на вырожденных входах. */

(function () {
  const T = __T;

  const BASE = {
    seed: 'worldgen',
    W: 14,
    H: 14,
    density: 0.35,
    cabDens: 0.25,
    loot: 100,
    monster: true
  };

  function counts(s) {
    const c = { 0: 0, 1: 0, 2: 0, 3: 0, other: 0 };
    for (let i = 0; i < s.grid.length; i++)
      c[s.grid[i] === undefined ? 'other' : s.grid[i]] = (c[s.grid[i]] || 0) + 1;
    return c;
  }
  function lightStat(s) {
    let mn = Infinity,
      mx = -Infinity,
      nan = 0;
    for (let i = 0; i < s.light.length; i++) {
      const v = s.light[i];
      if (!isFinite(v)) nan++;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    return { min: mn, max: mx, nan: nan, len: s.light.length };
  }

  T.test('worldgen: сетка = заказанный лабиринт + кольцо стен и комнаты', function () {
    for (const cfg of [
      { W: 1, H: 1 },
      { W: 8, H: 8 },
      { W: 24, H: 16 },
      { W: 40, H: 40 }
    ]) {
      const s = LIB.run(Object.assign({ seed: 'grid', density: 0.3 }, cfg));
      T.eq(s.W, cfg.W + 4, 'W для ' + cfg.W);
      T.eq(s.H, cfg.H + 4, 'H для ' + cfg.H);
      T.eq(s.grid.length, s.W * s.H, 'длина grid');
      T.eq(s.light.length, s.W * s.H, 'длина light');
      T.eq(s.explored.length, s.W * s.H, 'длина explored');
      T.eq(s.doorState.length, s.W * s.H, 'длина doorState');
      const c = counts(s);
      T.eq(c.other, 0, 'неизвестные значения клеток');
      T.eq(c[2], 1, 'ровно одна дверь выхода');
      T.eq(c[3], 1, 'ровно одна дверь убежища');
      T.ok(c[0] > 0, 'нет проходимых клеток');
    }
  });

  T.test('worldgen: стартовая комната, стол и дверь убежища рядом со спавном', function () {
    const s = LIB.run(BASE);
    T.eq(cellAt(s, s.start.x + 0.5, s.start.y + 0.5), 0, 'клетка спавна не пол');
    T.eq(Math.floor(s.px), s.start.x, 'игрок не в своей клетке по X');
    T.eq(Math.floor(s.py), s.start.y, 'игрок не в своей клетке по Y');
    T.near(s.px, s.start.x + 0.5, 1e-9, 'игрок в центре клетки');
    T.finite(s.ang, 'угол обзора');
    T.ok(Math.abs(s.ang) <= Math.PI + 1e-9, 'угол вне [-π,π]: ' + s.ang);
    /* стол стоит в той же клетке, что и спавн */
    T.ok(s.table, 'нет стола');
    T.eq(s.table.x, s.start.x, 'стол по X');
    T.eq(s.table.y, s.start.y, 'стол по Y');
    T.ok(Math.abs(s.table.wx) + Math.abs(s.table.wy) === 1, 'ориентация стола не единичная');
    /* дверь убежища — соседняя клетка со значением 3 */
    const d = s.safeDoors[0];
    T.eq(s.grid[d.y * s.W + d.x], 3, 'клетка двери убежища');
    T.eq(
      Math.abs(d.x - s.start.x) + Math.abs(d.y - s.start.y),
      1,
      'дверь не соседствует со спавном'
    );
    T.eq(d.t, 0, 'дверь закрыта в начале');
    T.eq(safeOpenAt(s, d.x, d.y), false, 'дверь считается открытой до открытия');
  });

  T.test('worldgen: дверь выхода ведёт в комнату победы', function () {
    const s = LIB.run(BASE);
    T.eq(s.grid[s.door.y * s.W + s.door.x], 2, 'клетка двери не имеет значения 2');
    T.eq(s.exitRoom.length, 1, 'число комнат выхода');
    const r = s.exitRoom[0];
    T.eq(cellAt(s, r.x + 0.5, r.y + 0.5), 0, 'комната выхода не пол');
    T.eq(Math.abs(r.x - s.door.x) + Math.abs(r.y - s.door.y), 1, 'комната выхода не у двери');
    T.deepEq(
      { x: s.winCell.x, y: s.winCell.y },
      { x: r.x, y: r.y },
      'winCell не совпадает с комнатой выхода'
    );
    T.ok(Math.abs(s.doorFace.x) + Math.abs(s.doorFace.y) === 1, 'нормаль двери не единичная');
    /* нормаль смотрит из комнаты выхода в лабиринт */
    T.eq(s.door.x - s.doorFace.x, r.x, 'нормаль двери не указывает от выхода в лабиринт');
    T.eq(s.door.y - s.doorFace.y, r.y, 'то же по Y');
    /* дверь стоит в кольце стен: ровно одна её сторона — комната выхода */
    T.eq(
      cellAt(s, s.door.x + s.doorFace.x + 0.5, s.door.y + s.doorFace.y + 0.5) !== 2,
      true,
      'две двери подряд'
    );
  });

  T.test('worldgen: лабиринт связан — из спавна достижимы все клетки', function () {
    for (const cfg of [
      { W: 8, H: 8, density: 0.5 },
      { W: 20, H: 14, density: 0.2 },
      { W: 30, H: 30, density: 0.35 }
    ]) {
      const s = LIB.run(Object.assign({ seed: 'conn-' + cfg.W, cabDens: 0.1, loot: 100 }, cfg));
      s.doorState[s.safeDoors[0].y * s.W + s.safeDoors[0].x] = 1;
      T.eq(safeOpenAt(s, s.safeDoors[0].x, s.safeDoors[0].y), true, 'дверь не открылась');
      let bad = 0,
        checked = 0;
      for (const idx of s.mazeFloors) {
        checked++;
        const p = bfsPath(s, s.start, { x: idx % s.W, y: (idx / s.W) | 0 });
        if (!p) bad++;
      }
      T.eq(
        bad,
        0,
        'лабиринт ' + cfg.W + 'x' + cfg.H + ': недостижимых клеток ' + bad + ' из ' + checked
      );
      T.ok(checked > 10, 'слишком мало клеток проверено: ' + checked);
      /* ключ и дверь выхода тоже достижимы */
      T.ok(bfsPath(s, s.start, s.key), 'ключ недостижим');
      T.ok(bfsPath(s, s.start, s.door), 'дверь выхода недостижима');
    }
  });

  T.test('worldgen: dist, maxDist и keyDist согласованы', function () {
    const s = LIB.run(BASE);
    let mx = 0,
      zeros = 0;
    for (let i = 0; i < s.dist.length; i++) {
      const v = s.dist[i];
      T.ok(v === -1 || (v >= 0 && v <= s.W * s.H), 'dist[' + i + '] = ' + v);
      if (s.grid[i] === 1) T.eq(v, -1, 'стена получила расстояние');
      if (v === 0) zeros++;
      if (v > mx) mx = v;
    }
    /* отсчёт — от входа в лабиринт, поэтому каждая его клетка достижима */
    T.eq(zeros, 1, 'нулевых расстояжений не одно');
    T.eq(mx, s.maxDist, 'maxDist не совпадает с максимумом dist');
    for (const idx of s.mazeFloors)
      T.ok(s.dist[idx] >= 0, 'клетка лабиринта ' + idx + ' недостижима');
    T.eq(s.dist[s.key.y * s.W + s.key.x], s.keyDist, 'keyDist не совпадает с dist');
    T.ok(s.keyDist > 0, 'ключ лежит во входе лабиринта');
    T.ok(s.keyDist <= s.maxDist, 'ключ дальше самой дальней клетки');
  });

  T.test('worldgen: ключ лежит ровно в одной тумбочке, когда лут включён', function () {
    for (const cfg of [
      { seed: 'k1', loot: 100 },
      { seed: 'k2', loot: 50 },
      { seed: 'k3', loot: 4 }
    ]) {
      const s = LIB.run(
        Object.assign({ W: 16, H: 16, density: 0.3, cabDens: 0.2, monster: false }, cfg)
      );
      const withKey = s.cabs.filter(c => c.content === 'key');
      T.eq(withKey.length, 1, cfg.seed + ': тумбочек с ключом ' + withKey.length);
      T.eq(s.key.x, withKey[0].x, cfg.seed + ': s.key не указывает на тумбочку');
      T.eq(s.key.y, withKey[0].y, cfg.seed + ': s.key не указывает на тумбочку по Y');
      T.eq(s.hasKey, false, 'ключ уже в руках');
    }
  });

  T.test('worldgen: без лута ключа в тумбочках нет', function () {
    const s = LIB.run({
      seed: 'noloot',
      W: 12,
      H: 12,
      density: 0.4,
      cabDens: 0.3,
      loot: 0,
      monster: false
    });
    T.ok(s.cabs.length > 0, 'тумбочки не сгенерированы');
    T.eq(s.cabs.filter(c => c.content === 'key').length, 0, 'ключ появился без лута');
    for (const c of s.cabs) T.eq(c.content, null, 'в тумбочке что-то лежит');
  });

  T.test('worldgen: тумбочки стоят у стен, не пересекаются и их доля ≈ cabDens', function () {
    for (const dens of [0.05, 0.25, 0.6]) {
      const s = LIB.run({
        seed: 'cabs',
        W: 20,
        H: 20,
        density: 0.3,
        cabDens: dens,
        loot: 60,
        monster: false
      });
      T.ok(s.cabs.length > 0, 'нет тумбочек при cabDens=' + dens);
      const seen = new Set();
      for (const c of s.cabs) {
        const idx = c.y * s.W + c.x;
        T.not(seen.has(idx), 'две тумбочки в одной клетке ' + idx);
        seen.add(idx);
        T.eq(s.grid[idx], 0, 'тумбочка не на полу');
        T.ok(Math.abs(c.wx) + Math.abs(c.wy) === 1, 'ориентация тумбочки');
        T.eq(s.grid[(c.y + c.wy) * s.W + (c.x + c.wx)], 1, 'за тумбочкой нет стены');
        T.eq(c.open, 0, 'тумбочка открыта в начале');
        T.eq(c.want, 0, 'тумбочка хочет открыться');
        T.eq(!!c.looted, false, 'тумбочка уже обобрана');
        T.ok(
          c.content === null || c.content === 'key' || c.content === 'batt',
          'содержимое: ' + c.content
        );
        T.inRange(c.phase, 0, 1, 'фаза');
      }
      T.inRange(
        s.cabs.length / s.nCand,
        dens * 0.6,
        Math.min(1, dens * 1.6),
        'доля тумбочек при cabDens=' + dens
      );
    }
  });

  T.test('worldgen: содержимое тумбочек примерно соответствует loot%', function () {
    const full = LIB.run({
      seed: 'loot',
      W: 30,
      H: 30,
      density: 0.2,
      cabDens: 0.35,
      loot: 100,
      monster: false
    });
    const none = LIB.run({
      seed: 'loot',
      W: 30,
      H: 30,
      density: 0.2,
      cabDens: 0.35,
      loot: 0,
      monster: false
    });
    const filled = full.cabs.filter(c => c.content).length;
    T.eq(filled, full.cabs.length, 'при loot=100 не все тумбочки наполнены');
    T.eq(none.cabs.filter(c => c.content).length, 0, 'при loot=0 тумбочки наполнены');
    const half = LIB.run({
      seed: 'loot',
      W: 30,
      H: 30,
      density: 0.2,
      cabDens: 0.35,
      loot: 50,
      monster: false
    });
    const share = half.cabs.filter(c => c.content).length / half.cabs.length;
    T.inRange(share, 0.3, 0.7, 'доля наполненных при loot=50: ' + share);
  });

  T.test('worldgen: лампы стоят на проходимых клетках, спавн и выход освещены всегда', function () {
    for (const dens of [0, 0.3, 1]) {
      const s = LIB.run({
        seed: 'lamps',
        W: 18,
        H: 18,
        density: dens,
        cabDens: 0.1,
        loot: 50,
        monster: false
      });
      T.ok(s.lamps.length >= 2, 'меньше двух ламп при density=' + dens);
      const always = s.lamps.filter(l => l.always);
      T.eq(always.length, 2, 'постоянных ламп не две при density=' + dens);
      const cells = always.map(l => l.y * s.W + l.x).sort((a, b) => a - b);
      T.deepEq(
        cells,
        [s.start.y * s.W + s.start.x, s.exitRoom[0].y * s.W + s.exitRoom[0].x].sort(
          (a, b) => a - b
        ),
        'постоянные лампы не над спавном и выходом'
      );
      for (const l of s.lamps) {
        T.inRange(l.x, 0, s.W - 1, 'x лампы');
        T.inRange(l.y, 0, s.H - 1, 'y лампы');
        T.neq(s.grid[l.y * s.W + l.x], 1, 'лампа в стене');
        T.ok(l.I > 0 && l.I <= 1.5, 'яркость лампы: ' + l.I);
        T.ok(l.cells instanceof Float32Array, 'тип cells');
        T.eq(l.cells.length % 4, 0, 'cells не кратен 4');
        for (let k = 0; k < l.cells.length; k += 4) {
          const i = l.cells[k];
          T.ok(i >= 0 && i < s.W * s.H, 'индекс клетки лампы: ' + i);
          T.inRange(l.cells[k + 1], 0, 1, 'доля света');
          T.neq(s.grid[i], 1, 'лампа светит в стену');
        }
        if (!l.always) T.ok(l.gt > 0 && l.gt < 1e6, 'время горения: ' + l.gt);
      }
    }
  });

  T.test('worldgen: число ламп растёт с плотностью', function () {
    const n = d =>
      LIB.run({ seed: 'lamp-n', W: 20, H: 20, density: d, cabDens: 0, loot: 0, monster: false })
        .lamps.length;
    const a = n(0),
      b = n(0.5),
      c = n(1);
    T.eq(a, 2, 'при нулевой плотности только постоянные лампы');
    T.ok(b > a, 'средняя плотность не добавила ламп');
    T.ok(c >= b, 'полная плотность уменьшила число ламп');
    /* одинаковая плотность и сид — одинаковый результат */
    T.eq(n(0.5), b, 'генерация ламп не воспроизводится');
  });

  T.test('worldgen: genLamps принимает функцию потока и не трогает свет', function () {
    const s = LIB.run({
      seed: 'gl',
      W: 12,
      H: 12,
      density: 0,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    const st = xsSeed(seedBytesFromText('lamp-stream'));
    const mk = () => xsStream(st, XS_LAMP).rnd;
    T.eq(genLamps(s, 0, mk()).length, 2, 'нулевая плотность');
    const half = genLamps(s, 0.5, mk()).length,
      full = genLamps(s, 1, mk()).length;
    T.ok(full >= half, 'плотность 1 дала меньше ламп, чем 0.5');
    T.eq(genLamps(s, 1, mk()).length, full, 'genLamps не детерминирована');
    T.eq(genLamps(s, -1, mk()).length, 2, 'отрицательная плотность не ограничена');
    T.eq(genLamps(s, 5, mk()).length, full, 'плотность больше 1 не ограничена');
    /* buildLampCells заполняет cells один раз и одинаково */
    const lp = { x: s.start.x, y: s.start.y, I: 1 };
    buildLampCells(s, lp);
    T.ok(lp.cells && lp.cells.length >= 4, 'cells не построены');
    const first = Array.from(lp.cells);
    buildLampCells(s, lp);
    T.deepEq(Array.from(lp.cells), first, 'повторная сборка изменила cells');
    const L0 = new Float32Array(s.W * s.H).fill(AMBIENT);
    applyLamp(s, L0, null, lp);
    T.ok(L0[lp.y * s.W + lp.x] > AMBIENT, 'лампа не осветила свою клетку');
    T.ok(L0[lp.y * s.W + lp.x] <= 1, 'свет больше единицы');
    const G = new Float32Array(s.W * s.H);
    applyLamp(s, new Float32Array(s.W * s.H).fill(AMBIENT), G, lp);
    T.ok(G[lp.y * s.W + lp.x] > 0, 'поле рассеянного света не заполнено');
  });

  T.test('worldgen: baseLight — пол AMBIENT, свет не выходит за [AMBIENT,1]', function () {
    const s = LIB.run({
      seed: 'bl',
      W: 14,
      H: 14,
      density: 0.4,
      cabDens: 0.1,
      loot: 50,
      monster: false
    });
    const L = baseLight(s);
    T.eq(L.length, s.W * s.H, 'длина');
    let mn = Infinity,
      mx = -Infinity,
      atAmb = 0;
    for (let i = 0; i < L.length; i++) {
      T.finite(L[i], 'light[' + i + ']');
      if (L[i] < mn) mn = L[i];
      if (L[i] > mx) mx = L[i];
      if (Math.abs(L[i] - AMBIENT) < 1e-6) atAmb++; /* Float32: точного равенства нет */
    }
    T.near(mn, AMBIENT, 1e-6, 'минимум не равен AMBIENT');
    T.ok(mx <= 1 + 1e-6, 'максимум больше 1: ' + mx);
    T.ok(atAmb > 0, 'нет клеток с фоновым светом');
    T.eq(atAmb >= s.grid.length / 4, true, 'фоновых клеток подозрительно мало: ' + atAmb);
    T.deepEq(Array.from(s.light), Array.from(L), 's.light не совпадает с baseLight');
  });

  T.test('worldgen: карта света конечна, darkCells — тёмные клетки лабиринта', function () {
    for (const cfg of [{ density: 0 }, { density: 0.3 }, { density: 1 }]) {
      const s = LIB.run(
        Object.assign({ seed: 'lt', W: 16, H: 16, cabDens: 0.1, loot: 50, monster: false }, cfg)
      );
      const st = lightStat(s);
      T.eq(st.nan, 0, 'density=' + cfg.density + ': неконечных значений ' + st.nan);
      T.ok(st.min >= AMBIENT - 1e-6, 'density=' + cfg.density + ': свет ниже AMBIENT');
      T.ok(st.max <= 1 + 1e-6, 'density=' + cfg.density + ': свет выше 1');
      const maze = new Set(s.mazeFloors);
      let bad = 0;
      for (const idx of s.darkCells) {
        if (!maze.has(idx)) bad++;
        else if (!(s.light[idx] < DARK_T)) bad++;
      }
      T.eq(bad, 0, 'density=' + cfg.density + ': darkCells содержит лишние клетки (' + bad + ')');
      T.ok(s.darkCells.length <= s.mazeFloors.length, 'тёмных клеток больше, чем клеток лабиринта');
    }
    /* без ламп темно почти везде, с лампами — заметно светлее */
    const dark = LIB.run({
      seed: 'lt2',
      W: 16,
      H: 16,
      density: 0,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    const lit = LIB.run({
      seed: 'lt2',
      W: 16,
      H: 16,
      density: 1,
      cabDens: 0,
      loot: 0,
      monster: false
    });
    T.ok(dark.darkCells.length > lit.darkCells.length, 'лампы не уменьшили число тёмных клеток');
    T.ok(lit.lamps.length > 2, 'при density=1 ламп не больше двух');
  });

  T.test('worldgen: исследованные клетки начинаются с нуля и копятся через markExp', function () {
    const s = LIB.run(BASE);
    let n = 0;
    for (let i = 0; i < s.explored.length; i++) n += s.explored[i] ? 1 : 0;
    T.eq(n, 0, 'карта уже исследована');
    T.eq(s.expV || 0, 0, 'expV не ноль');
    const i0 = s.start.y * s.W + s.start.x;
    markExp(s, i0);
    T.eq(s.explored[i0], 1, 'клетка не отмечена');
    T.eq(s.expV, 1, 'expV не увеличился');
    markExp(s, i0);
    T.eq(s.expV, 1, 'повторная отметка увеличила счётчик');
    markExp(s, i0 + 1);
    T.eq(s.expV, 2, 'вторая клетка');
  });

  T.test('worldgen: один и тот же сид даёт байт-в-байт тот же мир', function () {
    const a = LIB.run(BASE),
      b = LIB.run(BASE);
    T.eq(a.seed, b.seed, 'сид');
    T.eq(a.seedTag, b.seedTag, 'seedTag');
    T.deepEq(Array.from(a.grid), Array.from(b.grid), 'сетка');
    T.deepEq(Array.from(a.light), Array.from(b.light), 'свет');
    T.deepEq(Array.from(a.dist), Array.from(b.dist), 'dist');
    T.deepEq(a.cabs, b.cabs, 'тумбочки');
    T.deepEq(
      a.lamps.map(l => [l.x, l.y, l.I, l.gt, !!l.always]),
      b.lamps.map(l => [l.x, l.y, l.I, l.gt, !!l.always]),
      'лампы'
    );
    T.deepEq({ x: a.key.x, y: a.key.y }, { x: b.key.x, y: b.key.y }, 'ключ');
    T.deepEq({ x: a.mx, y: a.my }, { x: b.mx, y: b.my }, 'монстр');
    T.eq(a.seed.length, 128, 'сид в состоянии — не hex сида');
    T.eq(a.seed, seedHex(seedBytesFromText(BASE.seed)), 'seed не соответствует тексту');
  });

  T.test('worldgen: другой сид меняет лабиринт, размер — сетку', function () {
    const a = LIB.run(BASE);
    const otherSeed = LIB.run(Object.assign({}, BASE, { seed: 'worldgen!' }));
    const otherSize = LIB.run(Object.assign({}, BASE, { W: 15 }));
    let diff = 0;
    for (let i = 0; i < a.grid.length; i++) if (a.grid[i] !== otherSeed.grid[i]) diff++;
    T.ok(diff > 10, 'другой сид почти не изменил сетку: ' + diff);
    T.neq(otherSize.W, a.W, 'размер не применён');
    T.neq(otherSeed.seedTag, a.seedTag, 'seedTag не изменился');
    T.neq(
      otherSize.seedTag === a.seedTag && otherSize.W === a.W,
      true,
      'сида и размера недостаточно'
    );
  });

  T.test('worldgen: density — это плотность ламп, а не стен', function () {
    const a = LIB.run(Object.assign({}, BASE, { density: 0 }));
    const b = LIB.run(Object.assign({}, BASE, { density: 1 }));
    T.deepEq(Array.from(a.grid), Array.from(b.grid), 'плотность ламп изменила лабиринт');
    T.deepEq(
      a.cabs.map(c => [c.x, c.y]),
      b.cabs.map(c => [c.x, c.y]),
      'плотность ламп сдвинула тумбочки'
    );
    T.ok(b.lamps.length > a.lamps.length, 'лампы: ' + a.lamps.length + ' против ' + b.lamps.length);
    const st1 = lightStat(a),
      st2 = lightStat(b);
    T.ok(st2.max >= st1.max, 'с лампами не стало светлее');
  });

  T.test('worldgen: вырожденные и предельные параметры не роняют генерацию', function () {
    const cases = [
      { seed: 'tiny', W: 1, H: 1, density: 1, cabDens: 1, loot: 100, monster: true },
      { seed: 'flat', W: 3, H: 2, density: 0, cabDens: 0, loot: 0, monster: false },
      {
        seed: 'max',
        W: 100,
        H: 100,
        density: 0.5,
        cabDens: 0.5,
        loot: 50,
        monster: true,
        teleport: true
      },
      { seed: 'neg', W: -5, H: 0, density: 2, cabDens: -1, loot: 500, monster: false },
      { seed: 'nan', W: NaN, H: undefined, density: NaN, cabDens: NaN, loot: NaN, monster: false }
    ];
    for (const c of cases) {
      const s = T.noThrow(() => LIB.run(c), 'генерация ' + c.seed);
      T.ok(s.W >= 1 && s.H >= 1, c.seed + ': размеры ' + s.W + 'x' + s.H);
      T.eq(s.grid.length, s.W * s.H, c.seed + ': длина grid');
      T.eq(lightStat(s).nan, 0, c.seed + ': NaN в свете');
      T.ok(Number.isInteger(s.W) && Number.isInteger(s.H), c.seed + ': размеры не целые');
      T.finite(s.px, c.seed + ': px');
      T.finite(s.py, c.seed + ': py');
      T.eq(cellAt(s, s.px, s.py) === 1, false, c.seed + ': игрок в стене');
      const st = lightStat(s);
      T.ok(st.min >= AMBIENT - 1e-6 && st.max <= 1 + 1e-6, c.seed + ': свет вне диапазона');
      /* из спавна достижима хотя бы одна клетка лабиринта или дверь */
      s.doorState[s.safeDoors[0].y * s.W + s.safeDoors[0].x] = 1;
      const p = bfsPath(s, s.start, s.door);
      if (s.mazeFloors.length) T.ok(p, c.seed + ': дверь выхода недостижима');
    }
  });

  T.test('worldgen: s.map — переключатели миникарты, мир от них не зависит', function () {
    const a = LIB.run({
      seed: 'map',
      W: 12,
      H: 12,
      density: 0.3,
      cabDens: 0.2,
      loot: 100,
      monster: true,
      map: mapCfg({})
    });
    const b = LIB.run({
      seed: 'map',
      W: 12,
      H: 12,
      density: 0.3,
      cabDens: 0.2,
      loot: 100,
      monster: true,
      map: mapCfg({
        on: false,
        mon: false,
        lamps: false,
        cabs: false,
        key: false,
        exit: false,
        spawn: false,
        unexp: false
      })
    });
    T.deepEq(a.map, MAP_DEF, 'карта по умолчанию');
    for (const k in MAP_DEF) T.eq(b.map[k], false, 'переключатель ' + k + ' не применился');
    T.deepEq(Array.from(a.grid), Array.from(b.grid), 'переключатели миникарты изменили мир');
    T.eq(a.cabs.length, b.cabs.length, 'тумбочки пропали');
    T.eq(a.lamps.length, b.lamps.length, 'лампы пропали');
    /* переключатели не протекают между забегами */
    T.eq(MAP_DEF.on, true, 'MAP_DEF испорчен');
    T.neq(a.map, MAP_DEF, 's.map — это сам MAP_DEF');
    /* monster:false убирает Надзирателя, map.mon — только его значок */
    const noMon = LIB.run({
      seed: 'map',
      W: 12,
      H: 12,
      density: 0.3,
      monster: false,
      map: mapCfg({ mon: true })
    });
    T.eq(noMon.monster, false, 'монстр появился при monster:false');
    T.eq(noMon.map.mon, true, 'map.mon');
  });

  T.test('worldgen: Надзиратель появляется в проходимой клетке вдали от игрока', function () {
    for (const seed of ['m1', 'm2', 'm3', 'm4']) {
      const s = LIB.run({
        seed: seed,
        W: 16,
        H: 16,
        density: 0.3,
        cabDens: 0.1,
        loot: 50,
        monster: true,
        monsterSpeed: KMH(15)
      });
      T.eq(s.monster, true, 'монстр не создан');
      T.inRange(s.mx, 0, s.W - 1, 'mx');
      T.inRange(s.my, 0, s.H - 1, 'my');
      T.neq(cellAt(s, s.mx, s.my), 1, 'монстр в стене');
      T.finite(s.mYaw, 'mYaw');
      T.inRange(s.mYaw, 0, Math.PI * 2 + 1e-9, 'mYaw вне [0,2π)');
      T.eq(cellAt(s, s.mx, s.my), 0, 'монстр не на полу');
      T.ok(
        s.mazeFloors.indexOf(Math.floor(s.my) * s.W + Math.floor(s.mx)) >= 0,
        'монстр вне лабиринта'
      );
      T.near(s.mx, Math.floor(s.mx) + 0.5, 1e-9, 'mx не в центре клетки');
      T.eq(s.mMode, 'wander', 'режим ИИ');
      T.eq(s.mPath, null, 'путь задан до первого кадра');
      T.eq(s.lastSeen, null, 'монстр уже кого-то видел');
      T.eq(s.mGait, 'walk', 'походка');
      T.eq(s.mPhase, 0, 'фаза шага');
      T.eq(s.mSpeedNow, 0, 'текущая скорость');
      T.inRange(s.tpCd, 8, 16, 'задержка телепорта');
      T.ok(Math.hypot(s.mx - s.px, s.my - s.py) > 1, 'монстр в клетке игрока');
      T.eq(s.caught, false, 'пойман в первый кадр');
      T.finite(s.monsterSpeed, 'скорость монстра');
      T.near(s.monsterSpeed, KMH(15), 1e-12, 'скорость не из настроек');
    }
    const noMon = LIB.run({ seed: 'm1', W: 16, H: 16, density: 0.3, monster: false });
    T.eq(noMon.monster, false, 'монстр создан вопреки настройке');
  });

  T.test('worldgen: начальное состояние забега корректно', function () {
    const s = LIB.run(BASE);
    T.eq(s.time, 0, 'время');
    T.eq(s.stam, 1, 'стамина');
    T.eq(s.steps, 0, 'шаги');
    T.eq(s.hasKey, false, 'ключ');
    T.eq(s.won, false, 'победа');
    T.eq(s.caught, false, 'поимка');
    T.eq(s.doorOpen, false, 'дверь открыта');
    T.eq(s.doorT, 0, 'doorT');
    T.eq(s.inv.length, INV_SLOTS, 'слоты инвентаря');
    for (const it of s.inv) T.eq(it, null, 'инвентарь не пуст');
    T.eq(s.sel, -1, 'выбранный слот');
    T.eq(s.fl.owned, false, 'фонарь уже в руках');
    T.eq(s.flashTaken, false, 'фонарь уже взят');
    T.eq(s.drops.length, 0, 'на полу что-то лежит');
    T.eq(s._boxes.length, s.cabs.length + 1, 'число физических коробок');
    T.deepEq(Object.keys(s.dev).sort(), ['infStam', 'invisible', 'noclip'], 'dev-флаги');
    T.eq(s.dev.noclip || s.dev.invisible || s.dev.infStam, false, 'dev-режим включён по умолчанию');
    T.eq(s.thirdPerson, 0, 'вид от третьего лица');
  });
})();

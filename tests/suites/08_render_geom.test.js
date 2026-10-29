'use strict';
/* Геометрия и математика рендерера: матрицы, генераторы мешей, кэш мира,
   карты луж, риг дверей, сборщики данных кадра (лампы/двери/сетка),
   SSAO-ядро и преобразование высоты в нормаль. */

(function () {
  const T = __T;
  const G = LIB.G;

  /* UV-прямоугольники существуют только после инициализации атласа */
  G('applyAtlasQ')(256);

  function fn(name) {
    return LIB.fn(name);
  }

  function sameArr(a, b, msg) {
    T.eq(a.length, b.length, msg + ': длина');
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        T.eq(a[i], b[i], msg + ': элемент ' + i);
        return;
      }
    }
  }

  function assertMesh(m, msg, opt) {
    T.ok(m && m.arr instanceof Float32Array, msg + ': нет Float32Array');
    T.eq(m.arr.length % 9, 0, msg + ': длина не кратна шагу вершины 9');
    T.eq(m.n, m.arr.length / 9, msg + ': n не совпадает с arr');
    T.eq(m.n % 3, 0, msg + ': число вершин не кратно 3 (треугольники)');
    if (opt && opt.n !== undefined) T.eq(m.n, opt.n, msg + ': число вершин');
    for (let v = 0; v < m.n; v++) {
      const o = v * 9;
      for (let k = 0; k < 9; k++)
        T.eq(isFinite(m.arr[o + k]), true, msg + ': NaN в вершине ' + v + ' к ' + k);
      const nl = Math.hypot(m.arr[o + 5], m.arr[o + 6], m.arr[o + 7]);
      T.near(nl, 1, 1e-4, msg + ': нормаль не единичная у вершины ' + v);
      T.inRange(m.arr[o + 8], 0, 1, msg + ': AO вне [0,1] у вершины ' + v);
      if (opt && opt.bound) {
        T.ok(Math.abs(m.arr[o]) <= opt.bound + 1e-5, msg + ': X вне габарита');
        T.ok(Math.abs(m.arr[o + 2]) <= opt.bound + 1e-5, msg + ': Z вне габарита');
        T.ok(
          m.arr[o + 1] >= -opt.bound - 1e-5 && m.arr[o + 1] <= opt.bound * 4 + 1e-5,
          msg + ': Y вне габарита'
        );
      }
    }
  }

  function mulVec(m, x, y, z) {
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
  }

  T.test('рендер-математика: m4t/m4sc/m4rotY/m4mul/m4invView', function () {
    const m4mul = fn('m4mul'),
      m4t = fn('m4t'),
      m4rotY = fn('m4rotY'),
      m4sc = fn('m4sc'),
      m4inv = fn('m4invView');
    /* трансляция: единицы на диагонали, сдвиг в 12..14 */
    const t = m4t(1, 2, 3);
    T.eq(t[12], 1, 'm4t x');
    T.eq(t[13], 2, 'm4t y');
    T.eq(t[14], 3, 'm4t z');
    T.eq(t[0], 1, 'm4t диагональ');
    T.eq(t[5], 1, 'm4t диагональ');
    T.eq(t[15], 1, 'm4t диагональ');
    /* композиция трансляций складывается */
    const tt = m4mul(m4t(1, 2, 3), m4t(10, 20, 30));
    T.near(tt[12], 11, 1e-6, 'сумма трансляций x');
    T.near(tt[13], 22, 1e-6, 'сумма трансляций y');
    T.near(tt[14], 33, 1e-6, 'сумма трансляций z');
    /* масштаб */
    const sc = m4sc(2);
    T.eq(sc[0], 2, 'm4sc x');
    T.eq(sc[5], 2, 'm4sc y');
    T.eq(sc[10], 2, 'm4sc z');
    T.eq(sc[15], 1, 'm4sc w');
    /* rotY(π/2) дважды = rotY(π): вектор +X уходит в −X */
    const r2 = m4mul(m4rotY(Math.PI / 2), m4rotY(Math.PI / 2));
    const v = mulVec(r2, 1, 0, 0);
    T.near(v[0], -1, 1e-5, 'двойной поворот X');
    T.near(v[1], 0, 1e-5, 'двойной поворот Y');
    T.near(v[2], 0, 1e-5, 'двойной поворот Z');
    /* rotY сохраняет длину и ортонормирован */
    for (const a of [0, 0.7, -2.1, Math.PI]) {
      const r = m4rotY(a);
      const u = mulVec(r, 0.3, -0.9, 1.7);
      T.near(
        Math.hypot(u[0], u[1], u[2]),
        Math.hypot(0.3, -0.9, 1.7),
        1e-5,
        'поворот меняет длину'
      );
      const inv = m4inv(r);
      const prod = m4mul(r, inv);
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          T.near(prod[i * 4 + j], i === j ? 1 : 0, 1e-5, 'rotY*inv не единица');
        }
    }
    /* invView от полной видовой матрицы (поворот+сдвиг) */
    const view = m4mul(m4rotY(0.7), m4t(4, -2, 9));
    const back = m4mul(view, m4inv(view));
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        T.near(back[i * 4 + j], i === j ? 1 : 0, 1e-4, 'view*invView не единица');
      }
    /* точка, повёрнутая view и возвращённая invView, возвращается на место */
    const p = mulVec(view, 1, 2, 3);
    const q = mulVec(m4inv(view), p[0], p[1], p[2]);
    T.near(q[0], 1, 1e-4, 'round-trip x');
    T.near(q[1], 2, 1e-4, 'round-trip y');
    T.near(q[2], 3, 1e-4, 'round-trip z');
  });

  T.test('рендер-меши: составные генераторы дают валидные детерминированные данные', function () {
    const boxMeshData = fn('boxMeshData'),
      discMeshData = fn('discMeshData'),
      leafMeshData = fn('leafMeshData');
    const uvRect = G('quadUV')(1, 1);
    /* коробка: 5 граней (без дна) = 30 вершин, габарит ровно w/h/d */
    const b = boxMeshData(0.2, 0.3, 0.15);
    assertMesh(b, 'boxMeshData', { n: 30, bound: 0.2 });
    let maxY = -1e9,
      minY = 1e9;
    for (let v = 0; v < b.n; v++) {
      maxY = Math.max(maxY, b.arr[v * 9 + 1]);
      minY = Math.min(minY, b.arr[v * 9 + 1]);
    }
    T.near(maxY, 0.3, 1e-6, 'высота коробки');
    T.near(minY, 0, 1e-6, 'дно коробки не на нуле');
    sameArr(b.arr, boxMeshData(0.2, 0.3, 0.15).arr, 'boxMeshData детерминирован');
    /* диск: seg треугольников из центра */
    const d = discMeshData(0.5, 12);
    assertMesh(d, 'discMeshData', { n: 36, bound: 0.5 });
    for (let v = 0; v < d.n; v++) T.eq(d.arr[v * 9 + 1], 0, 'диск не в плоскости Y=0');
    sameArr(d.arr, discMeshData(0.5, 12).arr, 'discMeshData детерминирован');
    /* обод диска: первая вершина обода = (cos0*r, 0, sin0*r) — радиус влияет */
    T.near(d.arr[9], 0.5, 1e-6, 'радиус обода');
    T.near(discMeshData(0.7, 12).arr[9], 0.7, 1e-6, 'радиус не влияет на меш');
    /* полотно двери: 6 граней = 36 вершин, AO граней 1 (лицевые) и 0.55 (кромки) */
    const l = leafMeshData(0.5, 2.1, 0.05, uvRect, [0.5, 0.5]);
    assertMesh(l, 'leafMeshData', { n: 36 });
    const aos = {};
    for (let v = 0; v < l.n; v++) aos[l.arr[v * 9 + 8].toFixed(2)] = 1;
    T.deepEq(Object.keys(aos).sort(), ['0.55', '1.00'], 'набор AO полотна');
    /* uv лицевой грани (вторая по счёту, вершины 6..11) лежат внутри rect */
    for (let v = 6; v < 12; v++) {
      T.inRange(l.arr[v * 9 + 3], uvRect.u0 - 1e-6, uvRect.u1 + 1e-6, 'u вне rect');
      T.inRange(l.arr[v * 9 + 4], uvRect.v0 - 1e-6, uvRect.v1 + 1e-6, 'v вне rect');
    }
    sameArr(
      l.arr,
      leafMeshData(0.5, 2.1, 0.05, uvRect, [0.5, 0.5]).arr,
      'leafMeshData детерминирован'
    );
    /* rectBack: задняя грань (вершины 0..5) берёт свой прямоугольник */
    const back = G('quadUV')(0, 0);
    const l2 = leafMeshData(0.5, 2.1, 0.05, uvRect, [0.5, 0.5], back);
    for (let v = 0; v < 6; v++) {
      T.inRange(
        l2.arr[v * 9 + 3],
        back.u0 - 1e-6,
        back.u1 + 1e-6,
        'задняя грань не использует rectBack'
      );
    }
    /* реквизит и мебель: непустые, конечные, стабильные */
    const gens = [
      [
        'buildKeyMeshData',
        function () {
          return fn('buildKeyMeshData')();
        }
      ],
      [
        'buildFlashlightData',
        function () {
          return fn('buildFlashlightData')();
        }
      ],
      [
        'buildFlashLensData',
        function () {
          return fn('buildFlashLensData')();
        }
      ],
      [
        'buildBatteryBodyData',
        function () {
          return fn('buildBatteryBodyData')();
        }
      ],
      [
        'buildBatteryBandData',
        function () {
          return fn('buildBatteryBandData')();
        }
      ],
      [
        'buildCabinetData',
        function () {
          return fn('buildCabinetData')();
        }
      ],
      [
        'buildCabinetDrawerData',
        function () {
          return fn('buildCabinetDrawerData')();
        }
      ],
      [
        'buildTableData',
        function () {
          return fn('buildTableData')();
        }
      ]
    ];
    for (const g of gens) {
      const m = g[1]();
      assertMesh(m, g[0]);
      T.ok(m.n >= 3, g[0] + ': меньше треугольника');
      sameArr(m.arr, g[1]().arr, g[0] + ' детерминирован');
    }
    /* плафон лампы: тело вращения, R — прямоугольники атласа */
    const uv = G('uv') ? G('uv')() : null;
    T.ok(uv && uv.UV_IRON, 'нет таблицы UV');
    const lf = fn('lampFixtureData')({ iron: uv.UV_IRON, inner: uv.UV_CEIL });
    assertMesh(lf, 'lampFixtureData');
    sameArr(
      lf.arr,
      fn('lampFixtureData')({ iron: uv.UV_IRON, inner: uv.UV_CEIL }).arr,
      'lampFixtureData детерминирован'
    );
  });

  T.test('рендер-меши: quadUV и таблица UV — плитки не пересекаются', function () {
    const quadUV = fn('quadUV');
    const a = quadUV(0, 0),
      b = quadUV(1, 0),
      c = quadUV(0, 1);
    for (const r of [a, b, c]) {
      T.ok(r.u0 < r.u1 && r.v0 < r.v1, 'прямоугольник выверен');
      T.inRange(r.u0, 0, 1, 'u0');
      T.inRange(r.u1, 0, 1, 'u1');
      T.inRange(r.v0, 0, 1, 'v0');
      T.inRange(r.v1, 0, 1, 'v1');
    }
    /* соседние колонки/строки не наезжают друг на друга (есть паддинг) */
    T.ok(a.u1 < b.u0, 'колонки пересекаются по U');
    T.ok(a.v1 < c.v0, 'строки пересекаются по V');
    const dims = G('atlasDims')();
    const pad = 2 * (dims.AQ / 256);
    T.near(a.u0, pad / dims.AW, 1e-6, 'паддинг слева');
    T.near(b.u0 - a.u1, (2 * pad) / dims.AW, 1e-6, 'зазор между плитками');
    /* таблица UV: все прямоугольники валидны и попарно различны */
    const uv = G('uv')();
    const seen = {};
    for (const k in uv) {
      const r = uv[k];
      T.ok(r && r.u0 < r.u1 && r.v0 < r.v1, k + ': прямоугольник');
      const key = [r.u0, r.u1, r.v0, r.v1].join(',');
      T.eq(seen[key], undefined, k + ': дубль плитки ' + (seen[key] || ''));
      seen[key] = k;
    }
    T.ok(
      Object.keys(seen).length >= 6,
      'таблица UV подозрительно мала: ' + Object.keys(seen).length
    );
  });

  T.test('рендер-мир: worldData кэшируется по сигнатуре сида и размера', function () {
    const worldData = fn('worldData');
    const s1 = LIB.run({
      seed: 'wd-a',
      W: 10,
      H: 10,
      density: 0.4,
      cabDens: 0.2,
      loot: 50,
      monster: false
    });
    const s2 = LIB.run({
      seed: 'wd-a',
      W: 10,
      H: 10,
      density: 0.4,
      cabDens: 0.2,
      loot: 50,
      monster: false
    });
    const s3 = LIB.run({
      seed: 'wd-b',
      W: 10,
      H: 10,
      density: 0.4,
      cabDens: 0.2,
      loot: 50,
      monster: false
    });
    const w1 = worldData(s1);
    assertMesh(w1, 'worldData');
    T.eq(worldData(s1), w1, 'кэш не вернул тот же объект');
    T.eq(worldData(s2), w1, 'одинаковая сигнатура не переиспользует кэш');
    const w3 = worldData(s3);
    T.neq(w3, w1, 'другой сид не перестроил мир');
    assertMesh(w3, 'worldData(seed B)');
    T.neq(w3.arr.length, 0, 'пустой меш мира');
    /* координаты мира в пределах карты (клетки ~ [0..W]×[0..H], высота ≤ CEIL_H) */
    for (let v = 0; v < w1.n; v++) {
      const x = w1.arr[v * 9],
        y = w1.arr[v * 9 + 1],
        z = w1.arr[v * 9 + 2];
      T.inRange(x, -1, s1.W + 1, 'X вершины мира');
      T.inRange(z, -1, s1.H + 1, 'Z вершины мира');
      T.inRange(y, -0.5, CEIL_H + 0.5, 'Y вершины мира');
    }
    /* возврат кэша на первую сигнатуру снова перестраивает данные */
    const w1b = worldData(s1);
    assertMesh(w1b, 'worldData после смены сигнатуры');
    sameArr(w1b.arr, w1.arr, 'перестройка кэша изменила геометрию');
  });

  T.test('рендер-мир: genPuddleMap — лужи только на полу, детерминированы', function () {
    const genPuddleMap = fn('genPuddleMap');
    const s = LIB.run({
      seed: 'puddle',
      W: 12,
      H: 12,
      density: 0.6,
      cabDens: 0.1,
      loot: 50,
      monster: false
    });
    const m = genPuddleMap(s);
    T.eq(m.w, s.W * 4, 'ширина карты луж (4 текселя на клетку)');
    T.eq(m.h, s.H * 4, 'высота карты луж');
    T.eq(m.data.length, m.w * m.h, 'размер данных');
    T.ok(m.data instanceof Uint8Array, 'тип данных');
    /* под стенами луж нет: все 16 текселей клетки-стены нулевые */
    let wet = 0,
      checked = 0;
    for (let y = 0; y < s.H; y++)
      for (let x = 0; x < s.W; x++) {
        const solid = s.grid[y * s.W + x] !== 0;
        for (let ty = 0; ty < 4; ty++)
          for (let tx = 0; tx < 4; tx++) {
            const v = m.data[(y * 4 + ty) * m.w + (x * 4 + tx)];
            if (solid) T.eq(v, 0, 'лужа в стене ' + x + ',' + y);
            else {
              checked++;
              if (v > 0) wet++;
            }
          }
      }
    T.ok(wet > 0, 'на карте с лампами нет ни одной лужи');
    T.ok(wet < checked, 'весь пол залит');
    /* детерминированность: поток XS_PUD выводится из сида заново */
    const m2 = genPuddleMap(s);
    sameArr(m2.data, m.data, 'genPuddleMap детерминирован');
    const s2 = LIB.run({
      seed: 'puddle2',
      W: 12,
      H: 12,
      density: 0.6,
      cabDens: 0.1,
      loot: 50,
      monster: false
    });
    const m3 = genPuddleMap(s2);
    let diff = 0;
    for (let i = 0; i < m.data.length; i++) if (m3.data[i] !== m.data[i]) diff++;
    T.ok(diff > 0, 'другой сид дал ту же карту луж');
  });

  T.test('рендер-двери: doorRig/doorModel/doorSides/collectDoorSegs', function () {
    const s = LIB.run({
      seed: 'doorgeom',
      W: 14,
      H: 14,
      density: 0.35,
      cabDens: 0.1,
      loot: 50,
      monster: false
    });
    const DR = fn('doorRig')(s);
    T.ok(DR && DR.exit && Array.isArray(DR.safe), 'структура doorRig');
    const ex = DR.exit;
    T.eq(ex.x, s.door.x, 'дверь выхода X');
    T.eq(ex.y, s.door.y, 'дверь выхода Y');
    T.eq(ex.aOpen, -1.6, 'угол открытия');
    T.finite(ex.hx, 'петля hx');
    T.finite(ex.hz, 'петля hz');
    T.near(Math.hypot(ex.ax, ex.ay), 1, 1e-6, 'ось двери не нормирована');
    T.eq(ex.safe === undefined, true, 'лишние поля');
    T.eq(DR.safe.length, s.safeDoors.length, 'число дверей убежища');
    /* in/out: вход со стороны убежища, выход наружу */
    const f = s.doorFace;
    T.eq(ex.inX, s.door.x - f.x, 'inX');
    T.eq(ex.inY, s.door.y - f.y, 'inY');
    T.eq(ex.outX, s.door.x + f.x, 'outX');
    T.eq(ex.outY, s.door.y + f.y, 'outY');
    for (const d of DR.safe) {
      T.eq(d.inX, s.start.x, 'safe inX указывает на убежище');
      T.near(Math.hypot(d.ax, d.ay), 1, 1e-6, 'safe ось не нормирована');
      T.finite(d.hx, 'safe петля');
    }
    /* doorModel: жёсткая матрица, полотно всегда в 0.5 от петли, open01 клампится */
    const doorModel = fn('doorModel');
    const m0 = doorModel(ex, 0),
      m1 = doorModel(ex, 1);
    const mNeg = doorModel(ex, -0.5),
      mOver = doorModel(ex, 1.5);
    sameArr(mNeg, m0, 'open01<0 не клампится');
    sameArr(mOver, m1, 'open01>1 не клампится');
    for (const m of [m0, m1]) {
      for (let i = 0; i < 16; i++) T.eq(isFinite(m[i]), true, 'NaN в матрице двери');
      const p = [m[12], m[13], m[14]];
      T.near(Math.hypot(p[0] - ex.hx, p[2] - ex.hz), 0.5, 1e-5, 'полотно не в 0.5 от петли');
      T.near(p[1], 0, 1e-6, 'полотно не на полу');
    }
    let diff = 0;
    for (let i = 0; i < 16; i++) if (Math.abs(m0[i] - m1[i]) > 1e-6) diff++;
    T.ok(diff > 0, 'открытие не меняет матрицу');
    /* плавность: середина хода — между крайними положениями */
    const mHalf = doorModel(ex, 0.5);
    T.near(Math.hypot(mHalf[12] - ex.hx, mHalf[14] - ex.hz), 0.5, 1e-5, 'серединa: радиус');
    /* doorSides заполняет освещённость сторон и возвращает тот же объект */
    const ds = fn('doorSides')(s, ex);
    T.eq(ds, ex, 'doorSides вернул другой объект');
    for (const k of ['inL', 'inG', 'outL', 'outG']) {
      T.finite(ex[k], k);
      T.ok(ex[k] >= 0, k + ' отрицателен');
    }
    T.ok(ex.inL > 0, 'inL не положителен: ' + ex.inL);
    /* collectDoorSegs: по сегменту на полотно (выход + убежища), длина сегмента 1 */
    GPU.DR = DR;
    const seg = new Float32Array(16 * 4);
    const n = fn('collectDoorSegs')(s, seg);
    T.eq(n, 1 + s.safeDoors.length, 'число сегментов дверей');
    for (let i = 0; i < n; i++) {
      const x1 = seg[i * 4],
        z1 = seg[i * 4 + 1],
        x2 = seg[i * 4 + 2],
        z2 = seg[i * 4 + 3];
      T.finite(x1, 'seg x1');
      T.finite(z2, 'seg z2');
      T.near(Math.hypot(x2 - x1, z2 - z1), 1, 1e-5, 'длина сегмента');
      T.near(x1, i === 0 ? ex.hx : DR.safe[i - 1].hx, 1e-6, 'сегмент не от петли');
    }
    /* закрытая створка выхода направлена по yaw: (cos yaw, −sin yaw) */
    T.near(seg[2] - seg[0], Math.cos(ex.yaw), 1e-5, 'направление закрытой створки X');
    T.near(seg[3] - seg[1], -Math.sin(ex.yaw), 1e-5, 'направление закрытой створки Z');
    /* открытая створка повёрнута на aOpen */
    s.doorLeafT = 1;
    fn('collectDoorSegs')(s, seg);
    const a = ex.yaw + ex.aOpen;
    T.near(seg[2] - seg[0], Math.cos(a), 1e-4, 'направление открытой створки X');
    T.near(seg[3] - seg[1], -Math.sin(a), 1e-4, 'направление открытой створки Z');
    s.doorLeafT = 0;
    delete GPU.DR;
  });

  T.test('рендер-кадр: collectGridU32 и collectLamps', function () {
    const s = LIB.run({
      seed: 'collect',
      W: 14,
      H: 14,
      density: 0.5,
      cabDens: 0.1,
      loot: 50,
      monster: false
    });
    const out = new Uint32Array(s.W * s.H);
    const n = fn('collectGridU32')(s, out);
    T.eq(n, s.W * s.H, 'размер сетки');
    /* дверь убежища закрыта — бит 4 не выставлен */
    let bad = 0;
    for (let i = 0; i < n; i++) {
      const v = s.grid[i];
      const want = (v | (v === 3 && s.doorState[i] > 0.5 ? 4 : 0)) >>> 0;
      if (out[i] !== want) bad++;
    }
    T.eq(bad, 0, 'collectGridU32 разошёлся с сеткой');
    /* открытая дверь убежища даёт бит 4 */
    const d = s.safeDoors[0];
    const di = d.y * s.W + d.x;
    s.doorState[di] = 1;
    fn('collectGridU32')(s, out);
    T.eq(out[di], 3 | 4, 'бит открытой двери');
    s.doorState[di] = 0;
    /* лампы: ближайшие Q.lamps штук, отсортированы по расстоянию до игрока */
    const lampsArr = new Float32Array(Math.max(1, Q.lamps) * 4);
    const ln = fn('collectLamps')(s, lampsArr);
    T.eq(ln, Math.min(Q.lamps, s.lamps.length), 'число собранных ламп');
    T.ok(s.lamps.length > 0, 'на карте нет ламп для теста');
    let anyBad = false;
    const dists = [];
    for (let i = 0; i < ln; i++) {
      const lx = lampsArr[i * 4],
        ly = lampsArr[i * 4 + 1],
        r = lampsArr[i * 4 + 2],
        I = lampsArr[i * 4 + 3];
      T.finite(lx, 'лампа x');
      T.finite(I, 'лампа I');
      T.near(r, 3.2, 1e-6, 'радиус лампы');
      /* позиция — центр одной из клеток ламп, интенсивность = I*0.85 */
      const src = s.lamps.filter(
        l => Math.abs(l.x + 0.5 - lx) < 1e-6 && Math.abs(l.y + 0.5 - ly) < 1e-6
      )[0];
      if (!src) anyBad = true;
      else if (Math.abs(src.I * 0.85 - I) > 1e-6) anyBad = true;
      dists.push(Math.hypot(lx - 0.5 - s.px, ly - 0.5 - s.py));
    }
    T.eq(anyBad, false, 'собранные лампы не соответствуют s.lamps');
    for (let i = 1; i < dists.length; i++)
      T.ok(dists[i] >= dists[i - 1] - 1e-6, 'лампы не отсортированы по расстоянию');
    if (s.lamps.length > ln) {
      const minAll = Math.min.apply(
        null,
        s.lamps.map(l => Math.hypot(l.x + 0.5 - s.px, l.y + 0.5 - s.py))
      );
      T.near(dists[0], minAll, 1e-6, 'первая лампа не ближайшая');
    }
  });

  T.test('рендер-пост: ssaoKernel и heightToNormal', function () {
    const ssaoKernel = fn('ssaoKernel');
    const k = ssaoKernel(16);
    T.eq(k.length, 48, 'размер ядра');
    T.ok(k instanceof Float32Array, 'тип ядра');
    for (let i = 0; i < 16; i++) {
      const x = k[i * 3],
        y = k[i * 3 + 1],
        z = k[i * 3 + 2];
      const l = Math.hypot(x, y, z);
      /* длина — масштаб 0.30..1.00, растущий к концу ядра; z всегда вверх */
      T.inRange(l, 0.3 - 1e-5, 1 + 1e-5, 'длина вектора ядра ' + i);
      T.ok(z > 0, 'z ядра не положителен');
      if (i > 0)
        T.ok(
          l >= Math.hypot(k[(i - 1) * 3], k[(i - 1) * 3 + 1], k[(i - 1) * 3 + 2]) - 1e-6,
          'масштаб ядра не монотонен'
        );
    }
    sameArr(ssaoKernel(16), k, 'ssaoKernel детерминирован');
    T.eq(ssaoKernel(2).length, 12, 'ядро меньше 4 не клампится');
    T.neq(ssaoKernel(8)[0], ssaoKernel(16)[0], 'размер не влияет на ядро');

    const heightToNormal = fn('heightToNormal');
    const W = 8,
      H = 8;
    /* плоская карта высот → нормаль (0,0,1): R=G≈127.5, B=255 */
    const flat = { data: new Uint8ClampedArray(W * H * 4) };
    for (let i = 0; i < W * H; i++) {
      flat.data[i * 4] = 128;
      flat.data[i * 4 + 1] = 128;
      flat.data[i * 4 + 2] = 128;
      flat.data[i * 4 + 3] = 255;
    }
    const nf = heightToNormal(flat, W, H, 2);
    T.ok(nf instanceof Uint8Array, 'тип результата');
    T.eq(nf.length, W * H * 4, 'размер результата');
    for (let i = 0; i < W * H; i++) {
      T.inRange(nf[i * 4], 126, 129, 'flat R');
      T.inRange(nf[i * 4 + 1], 126, 129, 'flat G');
      T.eq(nf[i * 4 + 2], 255, 'flat B');
      T.eq(nf[i * 4 + 3], 255, 'flat A');
    }
    /* градиент по X наклоняет нормаль: R уходит от 127 */
    const grad = { data: new Uint8ClampedArray(W * H * 4) };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        grad.data[i] = x * 36;
        grad.data[i + 3] = 255;
      }
    const ng = heightToNormal(grad, W, H, 2);
    const mid = (4 * W + 4) * 4;
    T.ok(ng[mid] < 120 || ng[mid] > 135, 'градиент не наклонил нормаль: R=' + ng[mid]);
    T.inRange(ng[mid + 2], 150, 255, 'B при наклоне');
    T.ok(ng[mid + 2] < 255, 'наклон не уменьшил B');
    /* детерминированность и зависимость от strength */
    sameArr(heightToNormal(grad, W, H, 2), ng, 'heightToNormal детерминирован');
    const n0 = heightToNormal(grad, W, H, 0);
    sameArr(n0, nf, 'strength=0 не эквивалентен плоской карте');
  });
})();

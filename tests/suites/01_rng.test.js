'use strict';
/* ГСЧ и хэш сида: эталонные векторы SHA3-512, детерминизм потоков Xoshiro512**,
   их независимость и пригодность выходных чисел. */

(function () {
  const T = __T;
  const enc = s => new TextEncoder().encode(s);
  const hex = b => seedHex(b);

  /* эталонные значения из FIPS 202 */
  const VEC = {
    '': 'a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26',
    abc: 'b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0'
  };

  T.test('rng: SHA3-512 совпадает с эталоном FIPS 202', function () {
    for (const k of Object.keys(VEC)) {
      T.eq(hex(sha3_512(enc(k))), VEC[k], 'sha3_512(' + JSON.stringify(k) + ')');
    }
  });

  T.test('rng: SHA3-512 даёт 64 байта и зависит от каждого бита входа', function () {
    const a = sha3_512(enc('NADZIRATEL'));
    T.eq(a.length, 64, 'длина');
    T.ok(a instanceof Uint8Array, 'тип');
    const b = sha3_512(enc('NADZIRATEM'));
    T.neq(hex(a), hex(b), 'одна буква меняет хэш');
    /* лавина: в среднем около половины бит отличается */
    let diff = 0;
    for (let i = 0; i < 64; i++) {
      let x = a[i] ^ b[i];
      while (x) {
        diff += x & 1;
        x >>>= 1;
      }
    }
    T.inRange(diff, 180, 340, 'бит отличается: ' + diff + ' из 512');
  });

  T.test('rng: seedBytesFromText — это SHA3-512 от текста', function () {
    for (const s of [
      '',
      'ключ',
      'seed-123',
      'длинный текст с пробелами и UTF-8: фонарик-дверь-тумбочка'
    ]) {
      T.eq(hex(seedBytesFromText(s)), hex(sha3_512(enc(s))), 'seed ' + JSON.stringify(s));
    }
  });

  T.test('rng: seedHex — 128 шестнадцатеричных символов, обратим', function () {
    const b = seedBytesFromText('hex-test');
    const s = seedHex(b);
    T.eq(s.length, 128, 'длина строки');
    T.match(s, /^[0-9a-f]{128}$/, 'формат');
    const back = new Uint8Array(64);
    for (let i = 0; i < 64; i++) back[i] = parseInt(s.substr(i * 2, 2), 16);
    T.eq(hex(back), s, 'обратное чтение');
  });

  T.test('rng: xsSeed раскладывает 64 байта в 8 слов little-endian', function () {
    const b = new Uint8Array(64);
    for (let i = 0; i < 64; i++) b[i] = i;
    const st = xsSeed(b);
    T.eq(st.length, 8, 'число слов');
    T.eq(st[0], 0x0706050403020100n, 'слово 0');
    T.eq(st[7], 0x3f3e3d3c3b3a3938n, 'слово 7');
    T.eq(hex(xsSeed(seedBytesFromText('x'))), hex(xsSeed(seedBytesFromText('x'))), 'повторимость');
  });

  T.test('rng: xsSeed чинит запрещённое нулевое состояние', function () {
    const st = xsSeed(new Uint8Array(64));
    let zero = true;
    for (let i = 0; i < 8; i++) if (st[i] !== 0n) zero = false;
    T.not(zero, 'все слова нулевые');
    const g = xs512(st);
    T.finite(g.rnd(), 'rnd из восстановленного состояния');
  });

  T.test('rng: xs512 детерминирован и не повторяется на 5000 значений', function () {
    const mk = () => xs512(xsSeed(seedBytesFromText('det')));
    const a = mk(),
      b = mk();
    const seen = new Set();
    for (let i = 0; i < 5000; i++) {
      const x = a.rnd();
      T.eq(x, b.rnd(), 'расхождение на шаге ' + i);
      T.ok(x >= 0 && x < 1, 'rnd вне [0,1): ' + x);
      seen.add(x);
    }
    T.ok(seen.size > 4990, 'повторов слишком много: ' + (5000 - seen.size));
  });

  T.test('rng: u32 и nextU64 в своих диапазонах', function () {
    const g = xs512(xsSeed(seedBytesFromText('ranges')));
    for (let i = 0; i < 2000; i++) {
      const u = g.u32();
      T.ok(Number.isInteger(u) && u >= 0 && u <= 0xffffffff, 'u32 = ' + u);
      const w = g.nextU64();
      T.eq(typeof w, 'bigint', 'тип nextU64');
      T.ok(w >= 0n && w <= 0xffffffffffffffffn, 'nextU64 = ' + w);
    }
  });

  T.test('rng: распределение rnd() ровное (среднее 0.5, корзины равны)', function () {
    const g = xs512(xsSeed(seedBytesFromText('dist')));
    const N = 40000,
      K = 16;
    const bins = new Array(K).fill(0);
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const x = g.rnd();
      sum += x;
      bins[Math.min(K - 1, (x * K) | 0)]++;
    }
    T.near(sum / N, 0.5, 0.01, 'среднее');
    for (let i = 0; i < K; i++) {
      T.inRange(bins[i], (N / K) * 0.9, (N / K) * 1.1, 'корзина ' + i + ': ' + bins[i]);
    }
  });

  T.test('rng: xsRotl — циклический сдвиг на 64 бита', function () {
    T.eq(xsRotl(1n, 1n), 2n, '1<<1');
    T.eq(xsRotl(1n, 63n), 0x8000000000000000n, '1<<63');
    T.eq(xsRotl(0x8000000000000000n, 1n), 1n, 'перенос через старший бит');
    T.eq(xsRotl(0x123456789abcdef0n, 0n), 0x123456789abcdef0n, 'сдвиг на 0');
  });

  T.test('rng: xsJump меняет состояние детерминированно', function () {
    const a = xsSeed(seedBytesFromText('jump')),
      b = xsSeed(seedBytesFromText('jump'));
    xsJump(a);
    T.neq(
      a[0].toString(16) + a[3].toString(16),
      b[0].toString(16) + b[3].toString(16),
      'состояние не изменилось'
    );
    xsJump(b);
    for (let i = 0; i < 8; i++) T.eq(a[i], b[i], 'слово ' + i);
  });

  T.test('rng: параллельные потоки независимы', function () {
    const base = xsSeed(seedBytesFromText('streams'));
    const maze1 = xsStream(base, XS_MAZE),
      mon1 = xsStream(base, XS_MON);
    const before = mon1.rnd();
    for (let i = 0; i < 500; i++) maze1.rnd();
    const mon2 = xsStream(base, XS_MON);
    T.eq(mon2.rnd(), before, 'поток монстра сдвинулся после 500 выборок потока лабиринта');
    /* разные номера потоков дают разные последовательности */
    const vals = [
      XS_MAZE,
      XS_LAMP,
      XS_MON,
      XS_VIS,
      XS_AUD,
      XS_TEX,
      XS_SKIN,
      XS_PUD,
      XS_SCR,
      XS_TAG
    ].map(k => xsStream(base, k).rnd().toFixed(12));
    T.eq(new Set(vals).size, vals.length, 'потоки совпали: ' + vals.join(','));
  });

  T.test('rng: xsSub не зависит от порядка обращения и различается по тегу', function () {
    const st = xsSeed(seedBytesFromText('sub'));
    const a = xsSub(st, 7),
      b = xsSub(st, 8);
    const a0 = a.rnd(),
      b0 = b.rnd();
    T.neq(a0, b0, 'разные теги дали одно значение');
    /* тот же тег после других обращений — тот же результат */
    xsSub(st, 99).rnd();
    xsSub(st, 100).rnd();
    T.eq(xsSub(st, 7).rnd(), a0, 'тег 7');
    T.eq(xsSub(st, 8).rnd(), b0, 'тег 8');
    /* потребление одного пода не трогает другой */
    const c = xsSub(st, 7),
      d = xsSub(st, 8);
    for (let i = 0; i < 100; i++) c.rnd();
    T.eq(d.rnd(), xsSub(st, 8).rnd(), 'под 8 сдвинулся');
  });

  T.test('rng: xsFromU32/u64 — splitmix64, одинаковы для одного числа', function () {
    const g1 = xsFromU32(0xa0d10e23),
      g2 = xsFromU64(0xa0d10e23n);
    for (let i = 0; i < 32; i++) T.eq(g1.rnd(), g2.rnd(), 'шаг ' + i);
    const g3 = xsFromU32(0xa0d10e24);
    T.neq(xsFromU32(1).rnd(), g3.rnd(), 'соседние сиды совпали');
    const z = xsFromU32(0);
    T.finite(z.rnd(), 'нулевой сид');
    for (let i = 0; i < 100; i++) T.ok(z.rnd() < 1, 'rnd вне диапазона');
  });

  T.test('rng: xsBulk — детерминированный белый шум в [0,1)', function () {
    const f = xsBulk(12345),
      g = xsBulk(12345),
      h = xsBulk(54321);
    let sum = 0,
      same = 0;
    for (let i = 0; i < 20000; i++) {
      const x = f();
      T.ok(x >= 0 && x < 1, 'значение ' + x);
      T.eq(x, g(), 'расхождение на ' + i);
      if (x === h()) same++;
      sum += x;
    }
    T.near(sum / 20000, 0.5, 0.02, 'среднее');
    T.ok(same < 100, 'слишком много совпадений с другим тегом: ' + same);
  });

  T.test('rng: randBytes и randSeedText дают настоящий случайный сид', function () {
    const b = randBytes(64);
    T.ok(b instanceof Uint8Array, 'тип');
    T.eq(b.length, 64, 'длина');
    const uniq = new Set(Array.from(b)).size;
    T.ok(uniq > 20, 'байты почти не различаются: ' + uniq);
    const s1 = randSeedText(),
      s2 = randSeedText();
    T.eq(s1.length, 128, 'длина сида');
    T.match(s1, /^[0-9a-f]{128}$/, 'формат сида');
    T.neq(s1, s2, 'два случайных сида совпали');
    /* случайный сид проходит тот же путь, что и введённый текстом */
    T.eq(hex(seedBytesFromText(s1)), hex(sha3_512(enc(s1))), 'хэш от случайного сида');
  });

  T.test('rng: одинаковый текст сида даёт одинаковый лабиринт', function () {
    const a = LIB.run({ seed: 'same-seed', W: 12, H: 12, density: 0.4 });
    const b = LIB.run({ seed: 'same-seed', W: 12, H: 12, density: 0.4 });
    const c = LIB.run({ seed: 'other-seed', W: 12, H: 12, density: 0.4 });
    T.eq(a.grid.length, b.grid.length, 'размер сетки');
    for (let i = 0; i < a.grid.length; i++) T.eq(a.grid[i], b.grid[i], 'клетка ' + i);
    let diff = 0;
    for (let i = 0; i < a.grid.length; i++) if (a.grid[i] !== c.grid[i]) diff++;
    T.ok(diff > 10, 'другой сид почти не изменил карту: ' + diff);
  });
})();

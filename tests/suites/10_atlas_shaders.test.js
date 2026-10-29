'use strict';
/* Атлас текстур и WGSL-шейдеры: построение атласа из сида, реакция на
   качество, кэш getAtlas, валидность и параметризация шейдерных исходников.
   genSkinTex здесь не гоняем (1024², десятки секунд) — его покрывает отпечаток. */

(function () {
  const T = __T;
  const G = LIB.G;

  /* --- проверка WGSL-исходника на явные признаки порчи --- */
  function assertWgsl(src, name) {
    T.eq(typeof src, 'string', name + ': не строка');
    T.ok(src.length > 100, name + ': подозрительно короткий (' + src.length + ')');
    let br = 0,
      par = 0;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '{') br++;
      else if (c === '}') br--;
      else if (c === '(') par++;
      else if (c === ')') par--;
      T.ok(br >= 0 && par >= 0, name + ': несбалансированные скобки у ' + i);
    }
    T.eq(br, 0, name + ': фигурные скобки не сбалансированы');
    T.eq(par, 0, name + ': круглые скобки не сбалансированы');
    /* комментарии снимаем: в них законно встречаются слова NaN/undefined */
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    T.eq(code.indexOf('undefined'), -1, name + ': в коде есть undefined');
    T.eq(code.indexOf('NaN'), -1, name + ': в коде есть NaN');
    T.eq(src.indexOf('${'), -1, name + ': не подставленный шаблон');
    T.ok(src.indexOf('@') >= 0, name + ': нет WGSL-аннотаций');
    return src;
  }

  /* атлас = {w,h,col:ImageData,nrm:Uint8Array,hgt:Uint8Array} */
  function assertAtlas(a, name, w, h) {
    T.ok(a && a.col, name + ': нет цветового слоя');
    T.eq(a.w, w, name + ': w');
    T.eq(a.h, h, name + ': h');
    T.eq(a.col.width, w, name + ': col.width');
    T.eq(a.col.height, h, name + ': col.height');
    T.eq(a.col.data.length, w * h * 4, name + ': col.data');
    T.eq(a.nrm.length, w * h * 4, name + ': nrm — RGBA-байты');
    T.eq(a.hgt.length, w * h, name + ': hgt — один байт на пиксель (R8)');
    /* содержимое пикселей в харнессе — детерминированный шум от истории
       canvas-операций (нет настоящего растеризатора): проверяем только
       структуру и байт-в-байт воспроизводимость, но не «похожесть на кирпич» */
    let nonZero = 0;
    for (let i = 0; i < a.col.data.length; i++) if (a.col.data[i]) nonZero++;
    T.ok(nonZero > 0, name + ': слой col целиком нулевой');
    for (let i = 0; i < a.nrm.length; i++)
      if (!isFinite(a.nrm[i])) {
        T.eq(true, false, name + ': NaN в nrm');
        break;
      }
  }

  function sameBytes(x, y) {
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  T.test('атлас: buildAtlasData — размер, детерминизм, зависимость от сида', function () {
    const applyAtlasQ = G('applyAtlasQ'),
      buildAtlasData = G('buildAtlasData');
    const dims0 = G('atlasDims')();
    applyAtlasQ(64); /* маленький атлас: тесты быстрые, структура та же */
    try {
      const dims = G('atlasDims')();
      T.eq(dims.AQ, 64, 'AQ не применился');
      T.eq(dims.AW, 256, 'AW = AQ*4');
      T.eq(dims.AH, 256, 'AH = AQ*4');
      const s1 = LIB.run({ seed: 'atlas-a', W: 6, H: 6, monster: false, density: 0.3 });
      const s2 = LIB.run({ seed: 'atlas-a', W: 6, H: 6, monster: false, density: 0.3 });
      const s3 = LIB.run({ seed: 'atlas-b', W: 6, H: 6, monster: false, density: 0.3 });
      const a = buildAtlasData(s1.seedState, { det: 1, micro: 0 });
      assertAtlas(a, 'atlas', 256, 256);
      /* тот же сид → те же байты во всех трёх слоях */
      const b = buildAtlasData(s2.seedState, { det: 1, micro: 0 });
      T.eq(sameBytes(a.col.data, b.col.data), true, 'col одного сида разошёлся');
      T.eq(sameBytes(a.nrm, b.nrm), true, 'nrm одного сида разошёлся');
      T.eq(sameBytes(a.hgt, b.hgt), true, 'hgt одного сида разошёлся');
      /* другой сид → другие параметры рисования → другие байты */
      const c = buildAtlasData(s3.seedState, { det: 1, micro: 0 });
      T.eq(sameBytes(a.col.data, c.col.data), false, 'атласы разных сидов совпали');
      /* det/micro вне диапазона клампятся и не роняют построение */
      const lo = buildAtlasData(s1.seedState, { det: 0.05, micro: 0 });
      assertAtlas(lo, 'atlas det=0.05', 256, 256);
      const cl = buildAtlasData(s1.seedState, { det: -5, micro: 9 });
      assertAtlas(cl, 'atlas clamped', 256, 256);
    } finally {
      applyAtlasQ(dims0.AQ);
    }
  });

  T.test('атлас: getAtlas кэшируется по сигнатуре сида и качества', function () {
    const getAtlas = G('getAtlas');
    const q0 = { atlas: Q.atlas, det: Q.det, micro: Q.micro, level: Q.level };
    Q.atlas = 64; /* QUALITY.ultra — тот же объект, что Q: восстанавливаем в конце */
    try {
      const s1 = LIB.run({ seed: 'atlas-cache', W: 6, H: 6, monster: false, density: 0.3 });
      const s1b = LIB.run({ seed: 'atlas-cache', W: 6, H: 6, monster: false, density: 0.3 });
      const s2 = LIB.run({ seed: 'atlas-cache2', W: 6, H: 6, monster: false, density: 0.3 });
      const a = getAtlas(s1);
      assertAtlas(a, 'getAtlas', 256, 256);
      T.eq(getAtlas(s1), a, 'кэш не вернул тот же объект');
      T.eq(getAtlas(s1b), a, 'тот же сид не переиспользует кэш');
      const b = getAtlas(s2);
      T.neq(b, a, 'другой сид не перестроил атлас');
      assertAtlas(b, 'getAtlas(seed2)', 256, 256);
      /* смена качества сбрасывает кэш */
      Q.atlas = 32;
      const c = getAtlas(s1);
      T.neq(c, b, 'смена atlas не перестроила кэш');
      T.eq(c.w, 128, 'новый размер атласа');
      T.eq(G('atlasDims')().AQ, 32, 'applyAtlasQ не вызван из getAtlas');
    } finally {
      Q.atlas = q0.atlas;
      Q.det = q0.det;
      Q.micro = q0.micro;
      Q.level = q0.level;
      G('applyAtlasQ')(q0.atlas | 0);
    }
  });

  T.test('шейдеры: статические WGSL-модули валидны', function () {
    for (const k of ['WGS_SKIN', 'WGS_LM', 'WGS_SHADOW']) {
      const src = G(k)();
      assertWgsl(src, k);
      T.ok(src.indexOf('fn ') >= 0, k + ': нет функций');
    }
    const sk = G('WGS_SKIN')();
    T.ok(sk.indexOf('@compute') >= 0, 'WGS_SKIN: не compute-шейдер');
    const sh = G('WGS_SHADOW')();
    T.ok(
      sh.indexOf('@compute') >= 0 || sh.indexOf('@vertex') >= 0 || sh.indexOf('@fragment') >= 0,
      'WGS_SHADOW: нет точки входа'
    );
  });

  T.test('шейдеры: shaders() — полный набор постпроцесса и мира', function () {
    const S = G('shaders')();
    T.ok(S && typeof S === 'object', 'shaders() не объект');
    /* всегда непустые */
    for (const k of [
      'VS_WORLD',
      'VS_POST',
      'FS_BRIGHT',
      'FS_DOWN',
      'FS_UP',
      'FS_SHARP',
      'FS_BLIT',
      'VS_GLOW',
      'FS_GLOW',
      'FS_AOBLUR',
      'FS_STREAK',
      'FS_ADAPT'
    ]) {
      assertWgsl(S[k], k);
    }
    /* FS_COMP — compute-блюр: существует только после инициализации GPU */
    T.ok(S.FS_COMP === '' || typeof S.FS_COMP === 'string', 'FS_COMP: не строка');
    if (S.FS_COMP) assertWgsl(S.FS_COMP, 'FS_COMP');
    /* условные: SSAO/VOL присутствуют только при включённых флагах качества */
    if ((Q.ssao | 0) > 0) assertWgsl(S.FS_SSAO, 'FS_SSAO');
    else T.eq(S.FS_SSAO, '', 'FS_SSAO должен быть пуст при ssao=0');
    if ((Q.vol | 0) > 0) assertWgsl(S.FS_VOL, 'FS_VOL');
    else T.eq(S.FS_VOL, '', 'FS_VOL должен быть пуст при vol=0');
    /* мировой шейдер всех пресетов валиден и различается */
    const worlds = {
      ultra: S.fsUltra,
      high: S.fsHigh,
      medium: S.fsMedium,
      low: S.fsLow,
      max: S.fsMax
    };
    for (const k in worlds) assertWgsl(worlds[k], 'fsWorld(' + k + ')');
    T.neq(worlds.ultra, worlds.low, 'ultra и low совпали');
    T.neq(worlds.ultra, worlds.max, 'ultra и max совпали');
    T.neq(worlds.high, worlds.medium, 'high и medium совпали');
    /* вью-шейдер содержит общий префикс-помощник */
    T.eq(S.VS_WORLD.indexOf(S.fsUltra) >= 0, false, 'VS_WORLD не должен содержать фрагментный код');
    /* детерминированность генерации */
    const S2 = G('shaders')();
    T.eq(S2.fsUltra, S.fsUltra, 'fsUltra не детерминирован');
    T.eq(S2.VS_WORLD, S.VS_WORLD, 'VS_WORLD не детерминирован');
  });

  T.test('шейдеры: fsWorldSrc параметризуется качеством', function () {
    const fsWorldSrc = G('fsWorldSrc');
    const srcs = {};
    for (const k in QUALITY) {
      const src = fsWorldSrc(QUALITY[k]);
      assertWgsl(src, 'fsWorldSrc(' + k + ')');
      srcs[k] = src;
      /* число слотов ламп в шейдере следует за lamps из качества */
      const nl = Math.max(1, QUALITY[k].lamps | 0);
      T.ok(src.indexOf(String(nl)) >= 0, k + ': в шейдере не нашлось NL=' + nl);
    }
    T.ok(Object.keys(srcs).length >= 5, 'мало пресетов качества: ' + Object.keys(srcs).length);
    /* ssao/vol-шейдеры ultra уже проверены в shaders() — здесь только наличие */
    const S = G('shaders')();
    if (S.fsSsaoUltra) T.ok(S.fsSsaoUltra.indexOf('@') >= 0, 'fsSsaoUltra без аннотаций');
    if (S.fsVolUltra) T.ok(S.fsVolUltra.indexOf('@') >= 0, 'fsVolUltra без аннотаций');
  });

  T.test('атлас: quadUV согласован с atlasDims после любого applyAtlasQ', function () {
    const applyAtlasQ = G('applyAtlasQ'),
      quadUV = G('quadUV');
    const dims0 = G('atlasDims')();
    for (const q of [32, 64, 128, 256]) {
      applyAtlasQ(q);
      const d = G('atlasDims')();
      T.eq(d.AQ, q, 'AQ');
      T.eq(d.AW, q * 4, 'AW');
      T.eq(d.AH, q * 4, 'AH');
      const r = quadUV(2, 1);
      const p = 2 * (q / 256);
      T.near(r.u0, (2 * q + p) / d.AW, 1e-6, 'u0 при AQ=' + q);
      T.near(r.u1, (3 * q - p) / d.AW, 1e-6, 'u1 при AQ=' + q);
      T.near(r.v0, (1 * q + p) / d.AH, 1e-6, 'v0 при AQ=' + q);
      T.near(r.v1, (2 * q - p) / d.AH, 1e-6, 'v1 при AQ=' + q);
      T.ok(r.u0 < r.u1 && r.v0 < r.v1, 'прямоугольник выверен при AQ=' + q);
    }
    applyAtlasQ(dims0.AQ);
    /* UV-таблица пересобрана под текущий AQ */
    const uv = G('uv')();
    const d2 = G('atlasDims')();
    T.inRange(uv.UV_WALL.u1, 0, 1, 'UV_WALL в диапазоне после восстановления');
    T.near(uv.UV_IRON.u0, (1 * d2.AQ + 2 * (d2.AQ / 256)) / d2.AW, 1e-6, 'UV_IRON не пересобран');
  });
})();

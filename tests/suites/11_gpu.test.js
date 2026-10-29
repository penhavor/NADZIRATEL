'use strict';
/* Жизненный цикл WebGPU-рендерера на фейковом устройстве: инициализация,
   кадры настоящего забега, resize, пересборка под другую карту.
   Пиксели не проверяем (у заглушки нет растеризатора) — только структуру
   ресурсов, счётчики операций и отсутствие исключений. */

(function () {
  const T = __T;
  if (!T.gpu) {
    T.skip('gpu: окружение без WebGPU', 'запуск с --gpu off');
    return;
  }

  const DT = 1 / 60;
  let canvas = null;
  let s1 = null,
    s2 = null;
  let savedS, savedStarted;

  function statsSnap() {
    const st = T.gpu.stats;
    return {
      modules: st.modules,
      buffers: st.buffers,
      textures: st.textures,
      pipelines: st.pipelines,
      draws: st.draws,
      dispatches: st.dispatches,
      writes: st.writes,
      passes: st.passes
    };
  }

  function frameNoThrow(s, i) {
    try {
      GPU.frame(s, DT);
    } catch (e) {
      T.eq(
        'кадр ' + i + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e),
        'без исключений',
        'GPU.frame бросил'
      );
    }
    T.clock.t += 1000 / 60;
  }

  /* кадры рисуются только после resize: он строит цели рендера (T) */
  function initAndSize(s, w, h) {
    return gpuInitQ(canvas, s).then(function (ok) {
      if (ok) GPU.resize(w || 800, h || 500);
      return ok;
    });
  }

  /* framesDone растёт из микротаска onSubmittedWorkDone — flushing */
  async function flush() {
    await null;
    await null;
    await null;
  }

  T.test('gpu: инициализация устройства и ресурсов под забег', async function () {
    T.env.enableGPU();
    canvas = T.doc.getElementById('view');
    T.ok(canvas, 'нет канваса #view');
    s1 = T.SIM.makeRun({
      seed: 'gpu-suite',
      W: 12,
      H: 12,
      monster: true,
      monsterSpeed: KMH(18),
      density: 0.4,
      cabDens: 0.2,
      loot: 80,
      teleport: true
    });
    const before = statsSnap();
    let ok = false;
    try {
      ok = await gpuInitQ(canvas, s1);
    } catch (e) {
      T.eq(
        'init: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e),
        'без исключений',
        'gpuInitQ бросил'
      );
    }
    T.eq(ok, true, 'gpuInitQ вернул не true');
    T.eq(GPU.ready, true, 'GPU.ready');
    GPU.ok = ok; /* как делает меню: GPU.ok выставляет вызывающий */
    T.eq(GPU.sig, gpuSigOf(s1.seed, s1.W, s1.H), 'сигнатура не соответствует забегу');
    GPU.resize(800, 500);
    T.eq(canvas.width, 800, 'resize не выставил ширину канваса');
    T.eq(canvas.height, 500, 'resize не выставил высоту канваса');
    T.eq(GPU.mapW, s1.W, 'mapW');
    T.eq(GPU.mapH, s1.H, 'mapH');
    const after = statsSnap();
    T.ok(after.modules > before.modules, 'не создано ни одного шейдер-модуля');
    T.ok(
      after.buffers > before.buffers + 5,
      'подозрительно мало буферов: +' + (after.buffers - before.buffers)
    );
    T.ok(after.textures > before.textures, 'не создано текстур');
    T.ok(after.pipelines > before.pipelines, 'не создано конвейеров');
    /* device lost не сработал */
    T.eq(GPU.ready, true, 'GPU.ready после инициализации');
  });

  T.test('gpu: кадры забега — бот, фонарик, третье лицо, дверь', async function () {
    T.ok(GPU.ready, 'GPU не готов — предыдущий тест провален');
    savedS = LIB.G('S');
    savedStarted = LIB.G('started');
    try {
      eval('S = s1');
      eval('started = true');
    } catch (e) {}
    enableBot(s1);
    const before = statsSnap();
    const fd0 = GPU.framesDone | 0;
    for (let i = 0; i < 36; i++) {
      const bi = botInput(s1);
      try {
        update(s1, bi, DT);
      } catch (e) {
        T.eq('update ' + i + ': ' + e.message, 'без исключений', 'update бросил');
      }
      /* сценарные переключения, как в отпечатке сборки */
      if (i === 5) {
        s1.fl.owned = true;
        s1.fl.on = true;
        invAdd(s1, 'flash');
      }
      if (i === 12) {
        s1.fl.e = 0.15;
        s1.fl.rl = 0.4;
        invAdd(s1, 'batt');
      }
      if (i === 18) s1.thirdPerson = 1;
      if (i === 24) s1.thirdPerson = 2;
      if (i === 30) {
        s1.thirdPerson = 0;
        s1.doorT = 0.7;
        s1.hasKey = true;
      }
      frameNoThrow(s1, i);
    }
    await flush();
    const after = statsSnap();
    T.eq(GPU.framesDone, fd0 + 36, 'framesDone не увеличился на 36');
    T.ok(after.draws > before.draws + 100, 'мало draw-вызовов: +' + (after.draws - before.draws));
    T.ok(after.dispatches > before.dispatches, 'не было compute-dispatch (скининг/тени)');
    T.ok(after.passes > before.passes + 30, 'мало render-pass: +' + (after.passes - before.passes));
    T.ok(after.writes > before.writes, 'не было записей в буферы');
    /* симуляция за кадром не сломалась */
    const errs = [];
    T.SIM.check(s1, errs, -1);
    T.eq(errs.length, 0, 'инварианты после gpu-кадров: ' + errs.slice(0, 2).join(' | '));
  });

  T.test('gpu: одинаковые кадры дают одинаковое число записей в буферы', async function () {
    /* то же состояние, без update: три серии по 4 кадра — дельта writes
       стабильна, т.е. рендерер не плодит лишние writeBuffer между кадрами */
    T.ok(GPU.ready, 'GPU не готов');
    const d = [];
    for (let series = 0; series < 3; series++) {
      const w0 = T.gpu.stats.writes;
      for (let i = 0; i < 4; i++) frameNoThrow(s1, i);
      d.push(T.gpu.stats.writes - w0);
    }
    T.eq(d[1], d[2], 'записи в буферы плавают между одинаковыми кадрами: ' + d.join(','));
    T.ok(d[1] > 0, 'кадры вообще ничего не пишут');
  });

  T.test('gpu: resize пересобирает цели и рисование продолжается', async function () {
    T.ok(GPU.ready, 'GPU не готов');
    try {
      GPU.resize(960, 600);
    } catch (e) {
      T.eq('resize: ' + e.message, 'без исключений', 'GPU.resize бросил');
    }
    T.eq(canvas.width, 960, 'ширина канваса после resize');
    T.eq(canvas.height, 600, 'высота канваса после resize');
    const fd0 = GPU.framesDone | 0;
    const before = statsSnap();
    frameNoThrow(s1, 0);
    frameNoThrow(s1, 1);
    await flush();
    T.eq(GPU.framesDone, fd0 + 2, 'кадры после resize не рисуются');
    T.ok(T.gpu.stats.passes > before.passes, 'после resize нет render-pass');
    /* обратный resize вниз тоже работает */
    GPU.resize(640, 400);
    frameNoThrow(s1, 2);
    await flush();
    T.eq(GPU.framesDone, fd0 + 3, 'кадр после уменьшения');
  });

  T.test('gpu: повторная инициализация под другую карту', async function () {
    s2 = T.SIM.makeRun({
      seed: 'gpu-suite-2',
      W: 9,
      H: 9,
      monster: false,
      density: 0.5,
      cabDens: 0.3,
      loot: 100
    });
    const sig1 = GPU.sig;
    let ok2 = false;
    try {
      ok2 = await initAndSize(s2, 800, 500);
    } catch (e) {
      T.eq(
        'init2: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e),
        'без исключений',
        'gpuInitQ(2) бросил'
      );
    }
    T.eq(ok2, true, 'повторный init не удался');
    T.eq(GPU.sig, gpuSigOf(s2.seed, s2.W, s2.H), 'сигнатура не обновилась');
    T.neq(GPU.sig, sig1, 'сигнатура не изменилась');
    T.eq(GPU.mapW, s2.W, 'mapW после пересборки');
    T.eq(GPU.mapH, s2.H, 'mapH после пересборки');
    const fd0 = GPU.framesDone | 0;
    for (let i = 0; i < 6; i++) {
      update(s2, { fwd: i % 2 }, DT);
      frameNoThrow(s2, i);
    }
    await flush();
    T.eq(GPU.framesDone, fd0 + 6, 'кадры второй карты');
    /* init тем же забегом — сигнатура та же, рисование продолжается */
    const ok3 = await gpuInitQ(canvas, s2);
    T.eq(ok3, true, 're-init тем же забегом');
    T.eq(GPU.sig, gpuSigOf(s2.seed, s2.W, s2.H), 'сигнатура после re-init');
    GPU.resize(800, 500);
    frameNoThrow(s2, 99);
    await flush();
    /* вернуть глобалы страницы */
    try {
      eval('S = savedS');
      eval('started = savedStarted');
    } catch (e) {}
  });

  T.test('gpu: clearBlack и frame при нулевом dt не ломают состояние', async function () {
    const fd0 = GPU.framesDone | 0;
    if (typeof GPU.clearBlack === 'function') {
      try {
        GPU.clearBlack();
      } catch (e) {
        T.eq('clearBlack: ' + e.message, 'без исключений', 'clearBlack бросил');
      }
      await flush();
      /* после очистки можно рисовать снова */
      frameNoThrow(s2, 0);
      await flush();
      T.ok((GPU.framesDone | 0) >= fd0 + 1, 'кадр после clearBlack');
    }
    try {
      GPU.frame(s2, 0);
    } catch (e) {
      T.eq('frame(dt=0): ' + e.message, 'без исключений', 'GPU.frame(0) бросил');
    }
    T.eq(GPU.ready, true, 'GPU.ready в конце');
    T.eq(GPU.ok, true, 'GPU.ok в конце');
  });
})();

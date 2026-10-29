'use strict';
/* Звук: шина AU и auInit, процедурные генераторы (auNoise/auTone/одиночные
   звуки), пространственная обработка spat/posOf, фоновый планировщик auFrame
   (гул ламп, стадии перезарядки, галлюцинации в темноте, треск, монстр) и
   музыка меню MusEng (кривая, буферы, квантование, start/pump/stop, биндинг
   musTry/musMenu/musSting). */

(function () {
  const T = __T;
  const G = LIB.G;
  const A = T.env.audio;

  function withRnd(seed, fn) {
    const prev = AU.rnd;
    AU.rnd = xsFromU32(seed).rnd;
    try {
      return fn();
    } finally {
      AU.rnd = prev;
    }
  }

  const CAP_NAMES = [
    'createGain',
    'createOscillator',
    'createBiquadFilter',
    'createStereoPanner',
    'createBufferSource',
    'createWaveShaper',
    'createDelay',
    'createConvolver',
    'createDynamicsCompressor'
  ];
  function captureCtx() {
    const c = AU.ctx,
      made = [],
      orig = {};
    for (const n of CAP_NAMES) {
      orig[n] = c[n];
      c[n] = function () {
        const node = orig[n].apply(c, arguments);
        made.push(node);
        return node;
      };
    }
    return {
      made: made,
      restore: function () {
        for (const n of CAP_NAMES) c[n] = orig[n];
      }
    };
  }

  T.test('звук: шина auInit — мастер, дак, лимитер, гул, шум', function () {
    auInit();
    T.ok(AU.on && AU.ctx, 'AU не инициализирован');
    const ctx0 = AU.ctx;
    auInit();
    T.eq(AU.ctx, ctx0, 'повторный auInit пересоздал контекст');
    /* дак → компрессор → выход; мастер → дак */
    T.eq(AU.duck.gain.value, 1, 'duck gain');
    T.eq(AU.comp.threshold.value, -3, 'comp threshold');
    T.eq(AU.comp.knee.value, 6, 'comp knee');
    T.eq(AU.comp.ratio.value, 12, 'comp ratio');
    T.near(AU.comp.attack.value, 0.003, 1e-12, 'comp attack');
    T.near(AU.comp.release.value, 0.25, 1e-12, 'comp release');
    /* базовый гул 100 Гц через lowpass 240, громкость 0 */
    T.eq(AU.hum.type, 'sawtooth', 'hum type');
    T.eq(AU.hum.frequency.value, 100, 'hum freq');
    T.eq(AU.humF.type, 'lowpass', 'humF type');
    T.eq(AU.humF.frequency.value, 240, 'humF freq');
    T.eq(AU.humG.gain.value, 0, 'humG выключен');
    /* 4 голоса гула с расстройкой */
    T.eq(AU.humV.length, 4, 'humV');
    const wantF = [
      100 * (1 - 0.004),
      100 * (1 + 0.006),
      100 * (1 - 0.004 + 0.002),
      100 * (1 + 0.006 + 0.002)
    ];
    for (let i = 0; i < 4; i++) {
      const v = AU.humV[i];
      T.near(v.o.frequency.value, wantF[i], 1e-9, 'humV[' + i + '] freq');
      /* gain/pan/lamp мог сдвинуть auFrame предыдущих сьютов — только структура */
      T.eq(v.f.type, 'lowpass', 'humV[' + i + '] filter');
      T.ok(isFinite(v.g.gain.value) && v.g.gain.value >= 0, 'humV[' + i + '] gain');
      T.ok(v.lamp === -1 || (Number.isInteger(v.lamp) && v.lamp >= 0), 'humV[' + i + '] lamp');
    }
    /* буфер шума: 2 с моно, заполнен детерминированно, значения в [-1,1] */
    T.eq(AU.noise.numberOfChannels, 1, 'noise channels');
    T.eq(AU.noise.length, AU.ctx.sampleRate * 2, 'noise length');
    const d = AU.noise.getChannelData(0);
    let sum = 0,
      sum2 = 0;
    for (let i = 0; i < d.length; i += 37) {
      T.ok(d[i] >= -1 && d[i] <= 1 && isFinite(d[i]), 'noise[' + i + '] вне диапазона');
      sum += d[i];
      sum2 += d[i] * d[i];
    }
    const n = Math.ceil(d.length / 37);
    T.ok(sum2 / n > 0.1, 'шум вырожден (средний квадрат ' + sum2 / n + ')');
    T.ok(Math.abs(sum / n) < 0.1, 'шум смещён (среднее ' + sum / n + ')');
    /* rnd заменён на сид-поток, mute/unmute */
    T.neq(AU.rnd, Math.random, 'AU.rnd остался Math.random');
    auSetMute(true);
    T.eq(AU.master.gain.value, 0, 'mute');
    auSetMute(false);
    T.eq(AU.master.gain.value, G('MASTER'), 'unmute');
  });

  T.test('звук: auReseedNoise детерминирован от AU.rnd', function () {
    const d = AU.noise.getChannelData(0);
    const before = [d[0], d[1], d[999], d[44099]];
    let s1, s2;
    withRnd(777, function () {
      auReseedNoise();
      s1 = [d[0], d[1], d[999], d[44099]];
    });
    withRnd(777, function () {
      auReseedNoise();
      s2 = [d[0], d[1], d[999], d[44099]];
    });
    T.deepEq(s1, s2, 'один сид — разные буферы');
    T.ok(s1[0] !== before[0] || s1[999] !== before[999], 'reseed не изменил буфер');
    withRnd(778, function () {
      auReseedNoise();
    });
    T.ok(d[0] !== s1[0] || d[999] !== s1[999], 'другой сид — тот же буфер');
  });

  T.test('звук: граф auNoise и auTone', function () {
    withRnd(5, function () {
      const cap = captureCtx();
      const t = AU.ctx.currentTime;
      auNoise(0.5, 800, 2, 0.3, 0.25, false);
      const m = cap.made;
      cap.restore();
      T.eq(m.length, 4, 'auNoise: источник, фильтр, гейн, паннер');
      const src = m[0],
        bp = m[1],
        g = m[2],
        p = m[3];
      T.eq(src.buffer, AU.noise, 'auNoise buffer');
      T.ok(
        src.playbackRate.value >= 0.7 && src.playbackRate.value <= 1.3,
        'playbackRate вне 0.7..1.3'
      );
      T.eq(bp.type, 'bandpass', 'auNoise filter type');
      T.eq(bp.frequency.value, 800, 'auNoise filter freq');
      T.eq(bp.Q.value, 2, 'auNoise filter Q');
      T.deepEq(
        g.gain.automation,
        [
          ['set', 0.3, t],
          ['exp', 0.0001, t + 0.5]
        ],
        'auNoise огибающая'
      );
      T.eq(p.pan.value, 0.25, 'auNoise pan');
      T.eq(src.__started, t, 'auNoise start');
    });
    withRnd(5, function () {
      const cap = captureCtx();
      auNoise(0.4, 500, 1, 0.2, 0, true);
      const m = cap.made;
      cap.restore();
      T.eq(m.length, 5, 'muf добавляет lowpass');
      T.eq(m[4].type, 'lowpass', 'muf filter type');
      T.eq(m[4].frequency.value, 700, 'muf filter freq');
    });
    withRnd(5, function () {
      const cap = captureCtx();
      const t = AU.ctx.currentTime;
      auTone(440, 220, 0.3, 'triangle', 0.5, -0.4, false);
      const m = cap.made;
      cap.restore();
      T.eq(m.length, 3, 'auTone: осциллятор, гейн, паннер');
      const o = m[0],
        g = m[1],
        p = m[2];
      T.eq(o.type, 'triangle', 'auTone type');
      T.deepEq(
        o.frequency.automation,
        [
          ['set', 440, t],
          ['exp', 220, t + 0.3]
        ],
        'auTone частоты'
      );
      const atk = Math.min(0.04, 0.3 * 0.3);
      T.deepEq(
        g.gain.automation,
        [
          ['set', 0.0001, t],
          ['exp', 0.5, t + atk],
          ['exp', 0.0001, t + 0.3]
        ],
        'auTone огибающая'
      );
      T.eq(p.pan.value, -0.4, 'auTone pan');
    });
    withRnd(5, function () {
      const cap = captureCtx();
      auTone(10, 5, 0.2, 'sine', 0.1, 0, false);
      const m = cap.made;
      cap.restore();
      /* нижняя граница 20 Гц на экспоненте */
      T.deepEq(
        m[0].frequency.automation[1],
        ['exp', 20, AU.ctx.currentTime + 0.2],
        'auTone clamp 20 Гц'
      );
    });
    /* без AU.on генераторы молчат */
    AU.on = false;
    try {
      const cap = captureCtx();
      auNoise(0.5, 800, 2, 0.3, 0, false);
      auTone(440, 220, 0.3, 'sine', 0.5, 0, false);
      cap.restore();
      T.eq(cap.made.length, 0, 'auNoise/auTone работают при AU.on=false');
    } finally {
      AU.on = true;
    }
  });

  T.test('звук: spat и posOf — панорама, затухание, заглушение', function () {
    const s = T.SIM.makeRun({
      seed: 'audio-spat',
      W: 16,
      H: 16,
      monster: true,
      monsterSpeed: KMH(12),
      density: 0.3,
      cabDens: 0.1,
      loot: 50
    });
    eval('S = s');
    try {
      const x = s.px + 3,
        y = s.py;
      const sp = spat(x, y);
      T.near(sp.d, 3, 1e-9, 'spat d');
      T.near(sp.att, 1 / (1 + 3 * 0.12), 1e-12, 'spat att');
      const wantPan = Math.max(
        -1,
        Math.min(1, Math.sin(Math.atan2(y - s.py, x - s.px) - s.ang) * 1.4)
      );
      T.near(sp.pan, wantPan, 1e-12, 'spat pan');
      T.eq(sp.muf, !los(s, s.px, s.py, x, y), 'spat muf');
      T.near(sp.occ, occFactor(s, s.px, s.py, x, y), 1e-12, 'spat occ');
      /* pan ограничен ±1 даже для резкого угла */
      const back = spat(s.px - Math.cos(s.ang) * 0.5, s.py - Math.sin(s.ang) * 0.5);
      T.ok(back.pan >= -1 && back.pan <= 1, 'spat pan вне [-1,1]');
      /* posOf: дверь и монстр */
      const pd = posOf('door');
      const wd = spat(s.door.x + 0.5, s.door.y + 0.5);
      T.near(pd.d, wd.d, 1e-12, 'posOf(door) d');
      T.near(pd.pan, wd.pan, 1e-12, 'posOf(door) pan');
      const pm = posOf('mon'),
        wm = spat(s.mx, s.my);
      T.near(pm.d, wm.d, 1e-12, 'posOf(mon) d');
      /* без S — нейтральные значения */
      eval('S = null');
      const z = spat(5, 5);
      T.deepEq(z, { d: 0, pan: 0, muf: false, att: 1, occ: 1 }, 'spat без S');
      T.deepEq(posOf('door'), { d: 0, pan: 0, muf: false, att: 1 }, 'posOf без S');
    } finally {
      eval('S = s');
      eval('S = null');
    }
  });

  T.test('звук: одиночные звуки создают граф и молчат без AU.on', function () {
    const oneShots = [
      [
        'auCrack',
        function () {
          auCrack(0.5, 0.2, true);
        }
      ],
      [
        'auCave',
        function () {
          auCave(-0.3, false);
        }
      ],
      [
        'auWhisper',
        function () {
          auWhisper(0.5, true);
        }
      ],
      [
        'auClick(on)',
        function () {
          auClick(0.8, 0, true);
        }
      ],
      [
        'auClick(off)',
        function () {
          auClick(0.8, 0, false);
        }
      ],
      ['auTwist', auTwist],
      ['auRustle', auRustle],
      ['auBattOut', auBattOut],
      ['auBattIn', auBattIn],
      [
        'auDrawer(open)',
        function () {
          auDrawer(true);
        }
      ],
      [
        'auDrawer(close)',
        function () {
          auDrawer(false);
        }
      ],
      [
        'auBreath',
        function () {
          auBreath(0.2);
        }
      ],
      [
        'auScratch',
        function () {
          auScratch(-0.2);
        }
      ],
      [
        'auHeart',
        function () {
          auHeart(0.4);
        }
      ],
      [
        'auClang',
        function () {
          auClang(0.1, true);
        }
      ],
      ['auScream', auScream],
      [
        'auSeen',
        function () {
          auSeen(0.3, false);
        }
      ]
    ];
    for (const [name, fn] of oneShots) {
      const r = withRnd(11, function () {
        const cap = captureCtx();
        let err = null;
        try {
          fn();
        } catch (e) {
          err = e;
        }
        cap.restore();
        return { err: err, n: cap.made.length };
      });
      T.ok(!r.err, name + ' бросил: ' + (r.err && r.err.message));
      T.ok(r.n > 0, name + ' не создал узлов');
    }
    /* с выключенным звуком — ни одного узла */
    AU.on = false;
    try {
      const cap = captureCtx();
      for (const [, fn] of oneShots) {
        T.noThrow(fn, 'без AU.on');
      }
      cap.restore();
      T.eq(cap.made.length, 0, 'звуки работают при AU.on=false');
    } finally {
      AU.on = true;
    }
  });

  T.test('звук: auEvent маршрутизирует события в звуки', function () {
    withRnd(3, function () {
      const cap = captureCtx();
      T.noThrow(function () {
        auEvent('pickup_key');
      }, 'auEvent(pickup_key)');
      T.ok(cap.made.length > 0, 'pickup_key без звука');
      const n1 = cap.made.length;
      auEvent('нет_такого_события');
      T.eq(cap.made.length, n1, 'неизвестное событие создало узлы');
      cap.restore();
    });
    AU.on = false;
    try {
      const cap = captureCtx();
      auEvent('door_open');
      cap.restore();
      T.eq(cap.made.length, 0, 'auEvent звучит при AU.on=false');
    } finally {
      AU.on = true;
    }
  });

  T.test('звук: auHumFrame — голоса ламп, захват, slew, освобождение', function () {
    const s = T.SIM.makeRun({
      seed: 'audio-hum',
      W: 12,
      H: 12,
      monster: false,
      density: 0.3,
      cabDens: 0.1,
      loot: 50
    });
    s.lamps = [{ x: Math.floor(s.px), y: Math.floor(s.py), I: 1 }];
    for (const v of AU.humV) {
      v.lamp = -1;
      v.tg = 0;
      v.tp = 0;
      v.tf = 240;
      v.g.gain.value = 0;
      v.p.pan.value = 0;
      v.f.frequency.value = 240;
    }
    auHumFrame(s, 0.1);
    const claimed = AU.humV.filter(function (v) {
      return v.lamp === 0;
    });
    T.eq(claimed.length, 1, 'лампу захватили ' + claimed.length + ' голосов');
    const v = claimed[0];
    const lx = s.lamps[0].x + 0.5,
      ly = s.lamps[0].y + 0.5;
    const d = Math.hypot(lx - s.px, ly - s.py);
    const occ = occFactor(s, s.px, s.py, lx, ly);
    const tg = ((1 * 0.22) / (1 + d * d * 0.1)) * occ;
    T.ok(tg >= 0.0006, 'тестовая лампа слишком тихая: ' + tg);
    T.near(v.tg, tg, 1e-12, 'humV tg');
    /* slew: gain += (tg-gain)*min(1,dt*8), dt=0.1 → 0.8 от цели */
    T.near(v.g.gain.value, tg * 0.8, 1e-12, 'humV gain slew');
    const vis = los(s, s.px, s.py, lx, ly);
    T.eq(v.tf, vis ? 240 : 95, 'humV tf (видимость)');
    const wantPan = Math.max(
      -1,
      Math.min(1, Math.sin(Math.atan2(ly - s.py, lx - s.px) - s.ang) * 1.4)
    );
    T.near(v.tp, wantPan, 1e-12, 'humV tp');
    T.near(v.p.pan.value, wantPan * 1.0, 1e-12, 'humV pan slew (dt*10=1)');
    auHumFrame(s, 0.1);
    T.near(v.g.gain.value, tg * 0.8 + (tg - tg * 0.8) * 0.8, 1e-12, 'humV второй кадр');
    /* остальные голоса не захватили ту же лампу и молчат */
    for (const w of AU.humV) {
      if (w === v) continue;
      T.eq(w.lamp, -1, 'свободный голос присвоил лампу');
      T.eq(w.tg, 0, 'свободный голос tg');
      T.eq(w.g.gain.value, 0, 'свободный голос звучит');
    }
    /* лампа потухла (I<0.3) — голос освобождается, когда gain упадёт */
    s.lamps[0].I = 0.1;
    for (let i = 0; i < 40; i++) auHumFrame(s, 0.1);
    T.eq(v.lamp, -1, 'голос не отпустил потухшую лампу');
    T.ok(v.g.gain.value < 0.0015, 'голос не затих: ' + v.g.gain.value);
  });

  T.test('звук: auFrame — охраны, стадии перезарядки, темнота, треск, монстр', function () {
    const s = T.SIM.makeRun({
      seed: 'audio-frame',
      W: 16,
      H: 16,
      monster: true,
      monsterSpeed: KMH(10),
      density: 0.3,
      cabDens: 0.1,
      loot: 50
    });
    s.monster = false;
    s.darkT = 0;
    s.fl = { rl: 1, rlT0: 0 };
    eval('S = s');
    eval('started = true');
    eval('paused = false');
    eval('rlStage = 0');
    try {
      /* охраны: без started / на паузе — полная тишина */
      eval('started = false');
      let cap = captureCtx();
      s.time = 0.5 * RL_DUR;
      auFrame(s, 0.016);
      cap.restore();
      T.eq(cap.made.length, 0, 'auFrame звучит без started');
      eval('started = true');
      eval('paused = true');
      cap = captureCtx();
      auFrame(s, 0.016);
      cap.restore();
      T.eq(cap.made.length, 0, 'auFrame звучит на паузе');
      eval('paused = false');
      /* стадии перезарядки: 0.10 twist, 0.26 battOut, 0.54 rustle, 0.86 twist */
      eval('rlStage = 0');
      const stages = [
        [0.12, 1],
        [0.3, 2],
        [0.6, 3],
        [0.9, 4]
      ];
      for (const [u, want] of stages) {
        s.time = u * RL_DUR;
        const c2 = captureCtx();
        auFrame(s, 0.016);
        c2.restore();
        T.eq(G('rlStage'), want, 'стадия перезарядки при u=' + u);
        T.ok(c2.made.length > 0, 'стадия ' + want + ' без звука');
      }
      s.time = 0.95 * RL_DUR;
      auFrame(s, 0.016);
      T.eq(G('rlStage'), 4, 'лишняя стадия');
      s.fl.rl = 0;
      auFrame(s, 0.016);
      T.eq(G('rlStage'), 0, 'rlStage не сброшен после перезарядки');
      /* темнота: таймер сбрасывается на 1.5 в свете и тикает во тьме */
      auTimers.hallu = 1.5;
      auFrame(s, 0.1);
      T.eq(auTimers.hallu, 1.5, 'в темноте hallu не тикает');
      s.darkT = DARK_HALLU_T + 5;
      auFrame(s, 0.1);
      T.near(auTimers.hallu, 1.4, 1e-9, 'hallu не отсчитал dt');
      const c3 = withRnd(9, function () {
        auTimers.hallu = 0;
        const cc = captureCtx();
        auFrame(s, 0.1);
        cc.restore();
        return { n: cc.made.length, t: auTimers.hallu };
      });
      T.ok(c3.n > 0, 'галлюцинация без звука');
      T.ok(c3.t > 0 && c3.t <= 8 * 1.45, 'hallu не перезарядился: ' + c3.t);
      s.darkT = 0;
      auFrame(s, 0.1);
      T.eq(auTimers.hallu, 1.5, 'на свету hallu не вернулся к 1.5');
      /* треск лампы: скачок I > 0.45 ближе 6 клеток */
      const lp = s.lamps[0];
      T.ok(lp, 'в состоянии нет ламп');
      s.px = lp.x + 0.5 + 0.3;
      s.py = lp.y + 0.5;
      prevI = null;
      auTimers.crk = 5;
      auFrame(s, 0.016); /* первый кадр только запоминает prevI */
      auTimers.crk = 0;
      lp.I += 0.9;
      const c4 = withRnd(4, function () {
        const cc = captureCtx();
        auFrame(s, 0.016);
        cc.restore();
        return { n: cc.made.length, crk: auTimers.crk };
      });
      T.ok(c4.n > 0, 'треск не прозвучал');
      T.near(c4.crk, 0.07, 1e-12, 'crk не перезарядился');
      /* монстр рядом — пещерныйAmbient по таймеру cave */
      s.monster = true;
      s.mx = s.px + 1;
      s.my = s.py;
      const c5 = withRnd(8, function () {
        auTimers.cave = 0;
        const cc = captureCtx();
        auFrame(s, 0.016);
        cc.restore();
        return { n: cc.made.length, cave: auTimers.cave };
      });
      T.ok(c5.n > 0, 'монстр рядом без звука');
      T.ok(c5.cave >= 4 && c5.cave < 10, 'cave вне 4..10: ' + c5.cave);
      s.monster = false;
    } finally {
      eval('started = false');
      eval('paused = false');
      eval('S = null');
      eval('rlStage = 0');
      auTimers.cave = 4;
      auTimers.crk = 0;
      auTimers.hallu = 2;
      prevI = null;
    }
  });

  T.test('музыка: musCurve, musParams, menuMonChance, musFear', function () {
    const c = musCurve(1.25);
    T.eq(c.length, 2048, 'musCurve длина');
    T.near(c[0], -1, 1e-6, 'musCurve край');
    T.near(c[1024], 0, 1e-12, 'musCurve центр');
    const norm = Math.tanh(1.25);
    T.near(c[2047], Math.tanh(1.25 * ((2047 * 2) / 2048 - 1)) / norm, 1e-6, 'musCurve хвост');
    for (let i = 1; i < c.length; i++) T.ok(c[i] >= c[i - 1], 'musCurve не монотонна на ' + i);
    /* musParams: линейная интерполяция от f */
    const p0 = musParams(0),
      p1 = musParams(1),
      ph = musParams(0.5);
    T.eq(p0.volume, 0.85, 'p0 volume');
    T.eq(p1.volume, 0.85, 'p1 volume');
    T.near(p0.intensity, 0.4, 1e-12, 'p0 intensity');
    T.near(p1.intensity, 0.85, 1e-12, 'p1 intensity');
    T.near(p0.dread, 0.18, 1e-12, 'p0 dread');
    T.near(p1.dread, 0.98, 1e-12, 'p1 dread');
    T.near(p0.heartbeat, 0, 1e-12, 'p0 heartbeat');
    T.near(p1.heartbeat, 1, 1e-12, 'p1 heartbeat');
    T.near(p0.reverb, 0.74, 1e-12, 'p0 reverb');
    T.near(p1.reverb, 0.47, 1e-12, 'p1 reverb');
    T.near(p0.metal, 0.18, 1e-12, 'p0 metal');
    T.near(p1.metal, 1, 1e-12, 'p1 metal');
    T.near(p0.bells, 0.62, 1e-12, 'p0 bells');
    T.near(p1.bells, 0.32, 1e-12, 'p1 bells');
    T.near(p0.whispers, 0.15, 1e-12, 'p0 whispers');
    T.near(p1.whispers, 1, 1e-12, 'p1 whispers');
    T.near(ph.dread, (0.18 + 0.98) / 2, 1e-12, 'ph dread');
    /* menuMonChance по пресетам и musFear=√chance */
    const chances = {
      practice: 0,
      easy: 0.05,
      medium: 0.2,
      hard: 0.5,
      extreme: 0.75,
      impossible: 1
    };
    for (const k in chances) {
      applyPlayPreset(k);
      T.near(menuMonChance(), chances[k], 1e-12, 'menuMonChance(' + k + ')');
      T.near(musFear(), Math.sqrt(chances[k]), 1e-12, 'musFear(' + k + ')');
    }
    G('PLAY').preset = 'custom';
    T.eq(menuMonChance(), 0, 'custom всегда спокоен');
    applyPlayPreset('medium');
    syncControls();
  });

  T.test('музыка: MusEng — квантование, шина, детерминированные буферы', function () {
    const eng = new MusEng(AU.ctx, 12345, musParams(0.5));
    T.eq(eng.L, 32, 'длина цикла');
    T.eq(eng.seed, 12345, 'seed');
    T.eq(eng.running, false, 'не запущен');
    /* квантование частот: f·L — целое; 0 → 1/L */
    T.eq(eng.q(0), 1 / 32, 'q(0)');
    T.eq(eng.q(0.1), 3 / 32, 'q(0.1) → 3/32');
    T.eq(eng.q(100), 100, 'q(100)');
    T.eq(Math.round(eng.q(2.718281) * 32), 87, 'q всегда кратна 1/32');
    /* шина: master тихий, шейпер, реверб, эхо */
    T.eq(eng.master.gain.value, 0.0001, 'master старт');
    T.eq(eng.shaper.curve.length, 2048, 'shaper curve');
    T.eq(eng.shaper.oversample, '2x', 'shaper oversample');
    T.eq(eng.out.gain.value, 1, 'out gain');
    T.near(eng.revSend.gain.value, 0.605, 1e-12, 'revSend = reverb(0.5)');
    T.eq(eng.conv.buffer.numberOfChannels, 2, 'IR стерео');
    T.eq(eng.conv.buffer.length, Math.floor(6.0 * AU.ctx.sampleRate), 'IR 6 с');
    T.near(eng.echo.delayTime.value, 0.42, 1e-12, 'echo delay');
    T.near(eng.echoFb.gain.value, 0.34, 1e-12, 'echo feedback');
    T.eq(eng.revTone.frequency.value, 3200, 'revTone');
    T.eq(eng.revHp.frequency.value, 85, 'revHp');
    /* шумовые буферы: 8 с моно, детерминированы от seed */
    T.eq(eng.noiseBuf.length, 8 * AU.ctx.sampleRate, 'noiseBuf 8 с');
    T.eq(eng.brownBuf.length, 8 * AU.ctx.sampleRate, 'brownBuf 8 с');
    const eng2 = new MusEng(AU.ctx, 12345, musParams(0.5));
    const d1 = eng.noiseBuf.getChannelData(0),
      d2 = eng2.noiseBuf.getChannelData(0);
    const b1 = eng.brownBuf.getChannelData(0),
      b2 = eng2.brownBuf.getChannelData(0);
    for (let i = 0; i < d1.length; i += 997) {
      T.eq(d1[i], d2[i], 'noiseBuf расходится на ' + i);
      T.eq(b1[i], b2[i], 'brownBuf расходится на ' + i);
      T.ok(d1[i] >= -1.0001 && d1[i] <= 1.0001, 'noiseBuf диапазон');
      T.ok(isFinite(b1[i]), 'brownBuf не конечен');
    }
    const eng3 = new MusEng(AU.ctx, 54321, musParams(0.5));
    const d3 = eng3.noiseBuf.getChannelData(0);
    let diff = 0;
    for (let i = 0; i < d1.length; i += 997) if (d1[i] !== d3[i]) diff++;
    T.ok(diff > 100, 'другой seed не изменил шум');
    /* _levels отражает параметры */
    const LV = eng._levels();
    const p = eng.p;
    T.near(LV.drone, 0.44 + 0.46 * p.intensity, 1e-12, 'levels drone');
    T.near(LV.pad, 0.45 + 0.85 * p.dread, 1e-12, 'levels pad');
    T.near(LV.bus, 0.5 + 0.5 * p.intensity, 1e-12, 'levels bus');
    eng2.stop(0.01);
    eng3.stop(0.01);
    T.test.eng = eng;
  });

  T.test('музыка: MusEng start/pump/stop и stingNow', async function () {
    const eng = T.test.eng || new MusEng(AU.ctx, 777, musParams(0));
    eng.fearFn = function () {
      return 1;
    };
    const tBefore = AU.ctx.currentTime;
    eng.start();
    try {
      T.eq(eng.running, true, 'start не запустил');
      T.ok(eng._timer, 'нет планировщика');
      T.near(eng.t0, tBefore + 0.09, 1e-9, 't0');
      T.eq(eng.nextLoop, 1, 'nextLoop после start');
      /* быстрый вход: exp-рампа к громкости за 0.45 с */
      const auto = eng.master.gain.automation;
      const last = auto[auto.length - 1];
      T.eq(last[0], 'exp', 'вход не экспонентой');
      T.eq(last[1], 0.85, 'вход не к volume');
      T.near(last[2], eng.t0 + 0.45, 1e-9, 'вход время');
      T.ok(eng._cont.length > 0, 'нет непрерывных слоёв');
      /* pump: fear ползёт к цели, параметры пересчитываются */
      await T.advance(1600, 400);
      T.ok(eng.fear > 0.5, 'fear не растёт: ' + eng.fear);
      T.ok(eng.fear <= 1, 'fear > 1');
      T.near(eng.p.dread, 0.18 + 0.8 * eng.fear, 1e-9, 'p не пересчитан под fear');
      T.eq(eng.running, true, 'pump остановил движок');
      /* stop: тишина, слои сняты, планировщик выключен */
      eng.stop(0.1);
      T.eq(eng.running, false, 'stop не остановил');
      T.eq(eng._timer, null, 'интервал не снят');
      T.eq(eng._cont.length, 0, 'непрерывные слои не сняты');
      const tail = eng.master.gain.automation;
      const fin = tail[tail.length - 1];
      T.eq(fin[0], 'exp', 'выход не экспонентой');
      T.eq(fin[1], 0.0002, 'выход не к 0.0002');
      /* через (fade+0.5) с — отключение drone (setTimeout) */
      await T.advance(800, 200);
      /* stingNow: одноразовый узел, rnd восстановлен */
      const rndBefore = eng.rnd;
      const cap = captureCtx();
      T.noThrow(function () {
        eng.stingNow(0.3);
      }, 'stingNow');
      cap.restore();
      T.ok(cap.made.length > 0, 'stingNow без узлов');
      T.eq(eng.rnd, rndBefore, 'stingNow не восстановил rnd');
    } finally {
      if (eng.running) eng.stop(0.01);
      eng.fearFn = null;
    }
  });

  T.test('музыка: связка musTry/musMenu/musSting', function () {
    /* остановить возможный движок от загрузки */
    if (MUS && MUS.running) MUS.stop(0.01);
    eval('MUS = null');
    eval('musWant = false');
    applyPlayPreset('medium');
    /* без musWant — не создаётся */
    musTry();
    T.eq(MUS, null, 'musTry создал движок без musWant');
    /* musMenu(true) — создаёт и запускает (ctx уже running) */
    musMenu(true);
    T.ok(MUS, 'musMenu(true) не создал MUS');
    T.eq(MUS.running, true, 'musMenu(true) не запустил');
    T.eq(MUS.fearFn, musFear, 'fearFn не привязан');
    T.near(MUS.fear, musFear(), 1e-12, 'fear не выставлен');
    T.eq(musWant, true, 'musWant');
    /* повторный вызов не создаёт второй движок */
    const first = MUS;
    musMenu(true);
    T.eq(MUS, first, 'musMenu создал второй движок');
    /* musSting на главном экране звучит (chance=0.2 < 1) */
    eval("menuScr = 'main'");
    const cap = captureCtx();
    T.noThrow(musSting, 'musSting');
    cap.restore();
    T.ok(cap.made.length > 0, 'musSting молчит на главном меню');
    /* на impossible (chance=1) — молчит */
    applyPlayPreset('impossible');
    MUS.fear = MUS.fearT = musFear();
    MUS.p = musParams(MUS.fear);
    const cap2 = captureCtx();
    musSting();
    cap2.restore();
    T.eq(cap2.made.length, 0, 'musSting звучит на impossible');
    applyPlayPreset('medium');
    /* musMenu(false) — останавливает */
    musMenu(false, 0.05);
    T.eq(MUS.running, false, 'musMenu(false) не остановил');
    T.eq(musWant, false, 'musWant после false');
    eval('MUS = null');
  });
})();

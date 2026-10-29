'use strict';
/* Отпечаток поведения игры.
   Прогоняет страницу по фиксированному сценарию и складывает в хэш всё, что игра
   реально делает: разметку, генераторы, атлас текстур, геометрию, шейдеры, риги и
   позы, симуляцию забегов, звук и GPU-вызовы. Одинаковый отпечаток у исходников и
   у собранного файла = сборка ничего не сломала.
   Всё обращение к рендереру идёт через публичный API (GPU._test, window.*, ядро),
   поэтому отпечаток сравнивается и между разными версиями исходников. */

(function () {
  const T = __T;
  const H = T.Hash;
  const wgslNorm = T.wgslNorm;

  /* внутренности рендерера: сначала тестовый хук GPU._test, потом глобалы */
  function G(name) {
    try {
      if (typeof GPU !== 'undefined' && GPU._test && GPU._test[name] !== undefined)
        return GPU._test[name];
    } catch (e) {}
    try {
      return eval(name);
    } catch (e) {
      return undefined;
    }
  }
  function has(name) {
    return typeof G(name);
  }
  function call(h, name, args) {
    const fn = G(name);
    h.str(name + ':' + typeof fn);
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.apply(null, args || []);
    } catch (e) {
      h.str('EXC ' + ((e && e.message) || e));
      return undefined;
    }
  }

  function nums(h, a, step) {
    if (!a) return h.u32(0);
    if (a.length === undefined) {
      h.f64(a);
      return h;
    }
    const st = step || 1;
    h.u32(a.length);
    for (let i = 0; i < a.length; i += st) h.f64(a[i]);
    return h;
  }
  function obj(h, o, keys) {
    if (!o) return h.u32(0);
    for (const k of keys) {
      const v = o[k];
      h.str(k);
      if (typeof v === 'number') h.f64(v);
      else if (typeof v === 'boolean') h.u32(v ? 1 : 2);
      else if (v === null || v === undefined) h.u32(0);
      else h.str(String(v));
    }
    return h;
  }
  function dump(h, o, prefix, step) {
    if (!o) return h.u32(0);
    for (const k of Object.keys(o).sort()) {
      const v = o[k];
      h.str((prefix || '') + k);
      if (typeof v === 'number') h.f64(v);
      else if (typeof v === 'boolean') h.u32(v ? 1 : 2);
      else if (typeof v === 'string') h.str(v);
      else if (v && v.length !== undefined && typeof v !== 'function') nums(h, v, step || 1);
      else if (v && typeof v === 'object') h.str('{' + Object.keys(v).sort().join(',') + '}');
      else h.u32(0);
    }
    return h;
  }
  function mesh(h, m) {
    if (!m) return h.u32(0);
    h.u32(1);
    return dump(h, m, '', 1);
  }
  function poses(h, p) {
    if (!p) return h.u32(0);
    h.u32(1);
    if (p.pose) for (const k of Object.keys(p.pose).sort()) nums(h, p.pose[k], 1);
    for (const k of Object.keys(p).sort())
      if (k !== 'pose') {
        const v = p[k];
        h.str(k);
        if (typeof v === 'number') h.f64(v);
        else if (v && v.length !== undefined) nums(h, v, 1);
        else h.u32(v ? 1 : 0);
      }
    return h;
  }

  /* каноническая разметка: script/style/link не учитываются (в сборке они другие) */
  function domHash(h, node, depth) {
    if (!node) return;
    if (node.nodeType === 3) {
      const t = String(node.data).replace(/\s+/g, ' ').trim();
      if (t) h.str('#t:' + t);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === 'script' || tag === 'style' || tag === 'link') return;
    h.str('<' + tag + '.' + depth);
    for (const k of Object.keys(node.attributes).sort()) h.str(' ' + k + '=' + node.attributes[k]);
    if (tag === 'canvas') h.str(' wh=' + node.width + 'x' + node.height);
    if (tag === 'input' || tag === 'select' || tag === 'textarea')
      h.str(' v=' + node.value + '/' + (node.checked ? 1 : 0));
    for (const c of node.childNodes) domHash(h, c, depth + 1);
    h.str('/' + tag);
  }

  const SEEDS = ['NADZIRATEL', 'ключ', '0', 'maze-42', 'aaaa'];
  function hashOf(s) {
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) {
      x ^= s.charCodeAt(i);
      x = Math.imul(x, 16777619);
    }
    return x >>> 0;
  }

  async function build() {
    const notes = {};
    const sections = {};

    async function run(name, fn) {
      T.rec.begin(name);
      try {
        await fn();
      } catch (e) {
        T.rec.op(
          'SECTION-EXC',
          String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)
        );
        notes[name] =
          String((e && e.message) || e) +
          '\n' +
          String((e && e.stack) || '')
            .split('\n')
            .slice(0, 5)
            .join('\n');
      }
      T.rec.end();
      sections[name] = T.rec.sections[name];
    }

    /* 1. разметка после загрузки */
    await run('dom', function () {
      const h = new H(11);
      domHash(h, T.doc.documentElement, 0);
      T.rec.op('dom', h.a, h.b);
      T.rec.str('title:' + T.doc.title);
    });

    /* 2. итоги загрузки: ошибки, консоль, состояние */
    await run('boot', function () {
      T.rec.u32(T.loadErrors.length);
      for (const e of T.loadErrors)
        T.rec.str(e.file + ':' + ((e.error && e.error.message) || e.error));
      T.rec.u32(T.consoleLog.length);
      for (const c of T.consoleLog) T.rec.str(c.level + ':' + c.text);
      T.rec.u32((T.env.handlerErrors || []).length);
      for (const e of T.env.handlerErrors || [])
        T.rec.str(e.where + ':' + ((e.err && e.err.message) || e.err));
      T.rec.str(
        'GPU=' +
          (typeof GPU !== 'undefined'
            ? [GPU.ok, GPU.ready, GPU.framesDone | 0, GPU.sig || ''].join('|')
            : 'noGPU')
      );
      T.rec.str('started=' + String(G('started')));
      T.rec.str(
        'LD=' +
          JSON.stringify(
            G('LD') ? { p: G('LD').p, ready: G('LD').ready, done: G('LD').done } : null
          )
      );
      const menu = T.doc.getElementById('menu');
      T.rec.str('menu=' + (menu ? menu.className : 'none'));
      T.rec.str('ldGo=' + ((T.doc.getElementById('ldGo') || {}).className || ''));
      T.rec.str('ldPct=' + ((T.doc.getElementById('ldPct') || {}).textContent || ''));
      T.rec.str('mver=' + ((T.doc.querySelector('.mver') || {}).textContent || ''));
    });

    /* 3. состав API — пропавший файл сразу меняет отпечаток */
    await run('api', function () {
      const names = [
        'GAME_VER',
        'xsSeed',
        'xsStream',
        'xsJump',
        'xsSub',
        'xsBulk',
        'xsFromU32',
        'xsFromU64',
        'xs512',
        'sha3_512',
        'seedBytesFromText',
        'seedHex',
        'randBytes',
        'randSeedText',
        'xsRotl',
        'XS_MAZE',
        'XS_LAMP',
        'XS_MON',
        'XS_VIS',
        'XS_AUD',
        'XS_TEX',
        'XS_SKIN',
        'XS_PUD',
        'XS_SCR',
        'XS_TAG',
        'CELL_M',
        'CEIL_H',
        'LAMP_Y',
        'DOOR_H',
        'KMH',
        'MAP_DEF',
        'mapCfg',
        'PRESETS',
        'AMBIENT',
        'LAMP_R',
        'DARK_T',
        'SC_FLOOR',
        'WALK_SP',
        'RUN_SP',
        'CROUCH_SP',
        'MON_WALK',
        'MON_K_FALLBACK',
        'QUALITY',
        'Q',
        'QSIG',
        'INV_SLOTS',
        'BATT_STACK',
        'CAB_D',
        'CAB_W',
        'TBL_D',
        'TBL_W',
        'PK_DUR',
        'SW_DUR',
        'RL_DUR',
        'TG_DUR',
        'genMaze',
        'genLamps',
        'applyLamp',
        'baseLight',
        'newState',
        'invAdd',
        'invCount',
        'invRemoveBatt',
        'invFixSel',
        'invSwapTo',
        'invSelectKind',
        'invSelKind',
        'invSlotOfKind',
        'pkDefer',
        'nearestCab',
        'nearestDrop',
        'nearestBatt',
        'resolveBoxes',
        'cabFront',
        'cabCenter',
        'boxOf',
        'boxCenter',
        'flashBright',
        'flashFlick',
        'cellLitByFlash',
        'playerInDark',
        'updateLamps',
        'cellAt',
        'blocked',
        'tryMove',
        'clampClear',
        'los',
        'losDoorsOpen',
        'wallCrossings',
        'occFactor',
        'bfsPath',
        'bfsDist',
        'markExp',
        'safeOpenAt',
        'inBox',
        'enableBot',
        'botInput',
        'seesFrom',
        'pickWanderTarget',
        'startScan',
        'scanYaw',
        'tryShadowJump',
        'stepMonster',
        'aimTarget',
        'botTarget',
        'pickUp',
        'interact',
        'update',
        'GPU',
        'gpuInitQ',
        'gpuBusy',
        'gpuPend',
        'ldStep',
        'AU',
        'auInit',
        'auFrame',
        'auEvent',
        'auScream',
        'auSetMute',
        'auReseedNoise',
        'auTone',
        'auNoise',
        'auClick',
        'auDrawer',
        'auRustle',
        'auBattIn',
        'auSeen',
        'MUS',
        'MusEng',
        'musParams',
        'musFear',
        'musMenu',
        'musTry',
        'musSting',
        'musCurve',
        'MUS_VOL',
        'MASTER',
        'S',
        'started',
        'paused',
        'locked',
        'botMode',
        'showMap',
        'screaming',
        'view',
        'mm',
        'fxcv',
        'cfg',
        'binds',
        'DEF_BINDS',
        'BIND_DEFS',
        'PLAY',
        'GFX',
        'SENS',
        'GKEYS',
        'CFG_KEY',
        'loadSettings',
        'saveSettings',
        'buildQ',
        'knobsOf',
        'scheduleSave',
        'applyPresetData',
        'applyPlayPreset',
        'playMatchesPreset',
        'touchPlay',
        'EVT',
        'SOUNDS',
        'evMsg',
        'posOf',
        'show',
        'setMsg',
        'fmtDur',
        'fmtDist',
        'diffName',
        'menuScreen',
        'startGame',
        'startCfg',
        'setPaused',
        'endScreen',
        'drawScreamer',
        'sizeFx',
        'updInvHud',
        'drawMinimap',
        'openSettings',
        'closeSettings',
        'buildBindsPanel',
        'buildGfxPanel',
        'updMazeInfo',
        'updMenuHints',
        'updPlayVis',
        'syncControls',
        'mapFields',
        'menuBgStart',
        'menuMazeState',
        'menuTick',
        'menuLamps',
        'menuScenario',
        'menuResize',
        'gameResize',
        'menuMonChance',
        'menuOverlayOpen',
        'LD',
        'ldShow',
        'ldHide',
        'ldTrack',
        'ldWait',
        'ldBusy',
        'boot',
        'frame',
        'setTxt',
        'setSty',
        'musBuild',
        'devMode',
        'devOn',
        'applyDevMode',
        'devMark',
        'setThirdPerson',
        'TP_LABEL',
        'DEV_HASH',
        'kd',
        'keys',
        'clearKeys',
        'requestLook',
        'INV_ICON',
        'playerAutoAnim',
        'poseDistSnap',
        'ANIM_CLIPS',
        'animNames',
        'animLabels',
        'GAIT_RATE',
        'GAIT_K',
        'MON_GAIT_K',
        'playerPose',
        'playerPoseFP',
        'poseFromClip',
        'buildPlayerRigFn',
        'skinRigExFn'
      ];
      for (const n of names) T.rec.str(n + '=' + has(n));
      const tt = typeof GPU !== 'undefined' && GPU._test ? Object.keys(GPU._test).sort() : [];
      T.rec.str('GPU._test=' + tt.join(','));
      if (typeof GPU !== 'undefined' && GPU._test) {
        for (const k of tt) T.rec.str('  ' + k + '=' + typeof GPU._test[k]);
        const d = GPU._test.atlasDims ? GPU._test.atlasDims() : null;
        T.rec.str('atlasDims=' + JSON.stringify(d));
        T.rec.str('uv=' + JSON.stringify(GPU._test.uv ? GPU._test.uv() : null));
      }
    });

    /* 4. ГСЧ и хэш сида */
    await run('rng', function () {
      const h = new H(13);
      for (const v of [
        '',
        'abc',
        'NADZIRATEL',
        'The quick brown fox jumps over the lazy dog',
        'ключ-фонарик-дверь'
      ]) {
        h.str(seedHex(sha3_512(new TextEncoder().encode(v))));
      }
      for (const u of [0, 1, 0x5ceef4ce, 0xa0d10e23, 0xffffffff]) {
        const g = xsFromU32(u);
        for (let i = 0; i < 8; i++) h.f64(g.rnd());
        h.u32(g.u32());
        h.str('u64:' + g.nextU64().toString(16));
      }
      const b = xsFromU64(0x123456789abcdefn);
      for (let i = 0; i < 8; i++) h.f64(b.rnd());
      const st = xsSeed(seedBytesFromText('stream-test'));
      h.str(
        'state:' +
          Array.from(st)
            .map(x => x.toString(16))
            .join(',')
      );
      for (const k of [
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
      ]) {
        const g = xsStream(st, k);
        for (let i = 0; i < 4; i++) h.f64(g.rnd());
      }
      const sub = xsSub(st, 0x1000);
      for (let i = 0; i < 4; i++) h.f64(sub.rnd());
      const bulk = xsBulk(12345);
      for (let i = 0; i < 8; i++) h.f64(bulk());
      /* потоки независимы */
      const s2 = xsSeed(seedBytesFromText('stream-test'));
      const a1 = xsStream(s2, XS_MAZE),
        a2 = xsStream(s2, XS_MON);
      a1.rnd();
      a1.rnd();
      h.f64(a2.rnd());
      /* все нули — запрещённое состояние, xsSeed обязан его починить */
      h.str(
        'zero:' +
          Array.from(xsSeed(new Uint8Array(64)))
            .map(x => x.toString(16))
            .join(',')
      );
      T.rec.op('rng', h.a, h.b);
    });

    /* 5. конфигурация */
    await run('config', function () {
      const h = new H(17);
      for (const v of [
        CELL_M,
        CEIL_H,
        LAMP_Y,
        DOOR_H,
        AMBIENT,
        LAMP_R,
        DARK_T,
        SC_FLOOR,
        WALK_SP,
        RUN_SP,
        CROUCH_SP,
        MON_WALK
      ])
        h.f64(v);
      h.str('MAP_DEF=' + JSON.stringify(MAP_DEF));
      h.str('MON_K_FALLBACK=' + JSON.stringify(MON_K_FALLBACK));
      for (const k of Object.keys(PRESETS).sort())
        h.str('preset.' + k + '=' + JSON.stringify(PRESETS[k]));
      for (const k of Object.keys(QUALITY).sort()) {
        if (k === 'BASE' || k === 'OFF') {
          h.str(k + '=' + JSON.stringify(QUALITY[k]));
          continue;
        }
        const q = QUALITY[k];
        h.str(
          'q.' + k + '=' + QSIG.map(s => (s === 'res' ? q.res.join('x') : String(q[s]))).join('|')
        );
      }
      h.str('QSIG=' + QSIG.join(','));
      h.str('GFX=' + JSON.stringify({ preset: GFX.preset, v: GFX.v }));
      h.str('PLAY=' + JSON.stringify(PLAY));
      h.f64(SENS);
      h.str('binds=' + JSON.stringify(binds));
      h.str('DEF_BINDS=' + JSON.stringify(DEF_BINDS));
      h.f64(INV_SLOTS);
      h.f64(BATT_STACK);
      for (const v of [CAB_D, CAB_W, TBL_D, TBL_W]) h.f64(v);
      h.str('Q.level=' + Q.level + ' atlas=' + Q.atlas + ' res=' + Q.res.join('x'));
      T.rec.op('config', h.a, h.b);
    });

    /* 6. генерация мира */
    await run('worldgen', function () {
      const h = new H(19);
      const cases = [
        { seed: 'NADZIRATEL', W: 8, H: 8, density: 0.5, cabDens: 0.25, loot: 100 },
        { seed: 'maze-42', W: 24, H: 24, density: 0.3, cabDens: 0.05, loot: 50 },
        { seed: 'ключ', W: 16, H: 32, density: 0.1, cabDens: 0.16, loot: 10 },
        { seed: '0', W: 1, H: 1, density: 1, cabDens: 1, loot: 0 },
        { seed: 'degenerate', W: 3, H: 2, density: 0, cabDens: 0, loot: 0 }
      ];
      for (const c of cases) {
        const s = T.SIM.makeRun(c);
        h.str(c.seed + ':' + c.W + 'x' + c.H + ':' + s.W + 'x' + s.H);
        nums(h, s.grid, 1);
        h.u32(s.floors.length);
        nums(h, s.floors, 1);
        h.u32(s.mazeFloors.length);
        nums(h, s.mazeFloors, 3);
        if (s.dist) {
          let sum = 0,
            mx = 0;
          for (let i = 0; i < s.dist.length; i++) {
            sum += s.dist[i];
            if (s.dist[i] > mx) mx = s.dist[i];
          }
          h.u32(sum);
          h.u32(mx);
          h.u32(s.maxDist);
        }
        obj(h, s.start, ['x', 'y']);
        obj(h, s.key, ['x', 'y']);
        obj(h, s.door, ['x', 'y']);
        obj(h, s.doorFace, ['x', 'y']);
        h.u32(s.exitRoom.length);
        for (const r of s.exitRoom) obj(h, r, ['x', 'y']);
        h.u32(s.safeDoors.length);
        for (const d of s.safeDoors) obj(h, d, ['x', 'y']);
        h.u32(s.cabs.length);
        for (const cb of s.cabs) {
          h.f64(cb.x);
          h.f64(cb.y);
          h.f64(cb.wx);
          h.f64(cb.wy);
          h.str(String(cb.content));
        }
        h.u32(s.batts.length);
        for (const bt of s.batts) {
          h.f64(bt.x);
          h.f64(bt.y);
        }
        obj(h, s.table, ['x', 'y', 'wx', 'wy']);
        h.u32(s.lamps.length);
        for (const lp of s.lamps) {
          h.f64(lp.x);
          h.f64(lp.y);
          h.f64(lp.base === undefined ? -1 : lp.base);
          h.u32(lp.always ? 1 : 0);
          h.u32(lp.scripted ? 1 : 0);
        }
        nums(h, s.light, 1);
        h.u32(s.darkCells.length);
        const d1 = bfsDist(s, s.key);
        const d2 = bfsDist(s, s.door);
        const i0 = s.start.y * s.W + s.start.x;
        h.f64(d1[i0]);
        h.f64(d2[i0]);
        h.f64(s.px);
        h.f64(s.py);
        h.f64(s.ang);
        h.f64(s.mx);
        h.f64(s.my);
        h.f64(s.mYaw);
        h.u32(s.seedTag);
        /* ключ действительно лежит в тумбочке, а выход достижим */
        h.str(
          'keyInCab=' +
            (c.loot > 0 && s.cabs.length ? s.cabs.some(x => x.content === 'key') : 'n/a')
        );
      }
      const a = T.SIM.makeRun({ seed: 'same', W: 20, H: 20, density: 0.4 });
      const b = T.SIM.makeRun({ seed: 'same', W: 20, H: 20, density: 0.4 });
      h.str(
        'reproducible=' +
          (a.seed === b.seed &&
            a.lamps.length === b.lamps.length &&
            a.grid.every((v, i) => v === b.grid[i]))
      );
      T.rec.op('worldgen', h.a, h.b);
    });

    /* 7. атлас текстур: всё рисование уходит в хэш 2D-контекста */
    await run('atlas', function () {
      const h = new H(23);
      const st = xsSeed(seedBytesFromText('atlas-seed'));
      const dims = G('atlasDims');
      h.str('dims=' + JSON.stringify(typeof dims === 'function' ? dims() : null));
      const uvFn = G('uv');
      if (typeof uvFn === 'function') h.str('uv=' + JSON.stringify(uvFn()));
      const quadUVFn = G('quadUV');
      if (typeof quadUVFn === 'function')
        for (let r = 0; r < 4; r++)
          for (let c = 0; c < 4; c++) h.str('q' + c + r + '=' + JSON.stringify(quadUVFn(c, r)));
      const aqBefore = typeof dims === 'function' ? dims().AQ : 256;
      for (const q of [
        { det: 1, micro: 1 },
        { det: 0.5, micro: 0.5 },
        { det: 0.05, micro: 0 }
      ]) {
        const d = call(h, 'buildAtlasData', [st, q]);
        if (!d) continue;
        h.u32(d.w);
        h.u32(d.h);
        nums(h, d.col.data, 37);
        nums(h, d.nrm.data, 53);
        nums(h, d.hgt, 29);
      }
      const applyQ = G('applyAtlasQ');
      if (typeof applyQ === 'function') {
        applyQ(128);
        h.str('uv128=' + JSON.stringify(typeof uvFn === 'function' ? uvFn() : null));
        applyQ(aqBefore);
      }
      const hn = G('heightToNormal');
      if (typeof hn === 'function') {
        const w = 16,
          hh = 16;
        const id = { data: new Uint8ClampedArray(w * hh * 4) };
        for (let i = 0; i < w * hh; i++) {
          const v = (i * 7) % 256;
          id.data[i * 4] = v;
          id.data[i * 4 + 1] = v;
          id.data[i * 4 + 2] = v;
          id.data[i * 4 + 3] = 255;
        }
        for (const str2 of [0.5, 2.6, 8]) nums(h, hn(id, w, hh, str2).data, 3);
      }
      T.rec.op('atlas', h.a, h.b);
    });

    /* 8. геометрия мира, пропов и предметов */
    await run('geometry', function () {
      const h = new H(29);
      const s = T.SIM.makeRun({
        seed: 'geometry',
        W: 12,
        H: 12,
        density: 0.4,
        cabDens: 0.2,
        loot: 60
      });
      const wd = call(h, 'worldData', [s]);
      if (wd) dump(h, wd, 'world.', 1);
      mesh(h, call(h, 'boxMeshData', [1, 2, 0.5]));
      mesh(h, call(h, 'discMeshData', [0.4, 12]));
      mesh(h, call(h, 'buildKeyMeshData', []));
      mesh(h, call(h, 'buildValveData', []));
      mesh(h, call(h, 'buildSafeHwData', [1, 1, 0.2]));
      mesh(h, call(h, 'buildFlashlightData', []));
      mesh(h, call(h, 'buildFlashLensData', []));
      mesh(h, call(h, 'buildBatteryBodyData', []));
      mesh(h, call(h, 'buildBatteryBandData', []));
      mesh(h, call(h, 'buildCabinetData', []));
      mesh(h, call(h, 'buildCabinetDrawerData', []));
      mesh(h, call(h, 'buildTableData', []));
      mesh(h, call(h, 'lampFixtureData', [0.1]));
      mesh(h, call(h, 'lampPaneData', [0.1, 0.2]));
      const leaf = G('leafMeshData');
      if (typeof leaf === 'function') {
        const uv = G('uv');
        const uvs = typeof uv === 'function' ? uv() : null;
        try {
          const m = leaf(
            1,
            2,
            0.1,
            { u0: 0, v0: 0, u1: 0.25, v1: 0.25 },
            uvs ? [uvs.UV_IRON.u0, uvs.UV_IRON.v1] : [0, 0],
            true
          );
          mesh(h, m);
        } catch (e) {
          h.str('leaf EXC ' + e.message);
        }
      }
      /* дверь: риг, стороны, модель на разных углах */
      const dr = G('doorRig');
      if (typeof dr === 'function') {
        try {
          const r = dr(s);
          h.str('doorRig');
          if (r) {
            h.u32(r.B ? r.B.length : -1);
            if (r.names) for (const n of r.names) h.str(n);
            if (r.B) for (const b of r.B) nums(h, b, 1);
          }
        } catch (e) {
          h.str('doorRig EXC ' + e.message);
        }
      }
      const ds = G('doorSides');
      if (typeof ds === 'function') {
        try {
          const r = ds(s, s.door);
          h.str(
            'doorSides=' +
              JSON.stringify(r && r.length === undefined ? Object.keys(r || {}) : (r || []).length)
          );
          if (r && r.length) nums(h, r, 1);
        } catch (e) {
          h.str('doorSides EXC ' + e.message);
        }
      }
      const dmod = G('doorModel');
      if (typeof dmod === 'function')
        for (const t of [0, 0.12, 0.5, 0.85, 1]) {
          try {
            nums(h, dmod(s.door, t), 1);
          } catch (e) {
            h.str('doorModel EXC ' + e.message);
          }
        }
      const dmix = G('doorMix');
      if (typeof dmix === 'function') for (const t of [0, 0.3, 1]) h.f64(dmix(t));
      /* лужи, лампы, сетка, сегменты двери, теневые колпаки */
      const pud = call(h, 'genPuddleMap', [s]);
      if (pud) {
        h.u32(pud.w);
        h.u32(pud.h);
        nums(h, pud.data, 7);
      }
      const lampsArr = new Float32Array(64 * 4);
      const nL = call(h, 'collectLamps', [s, lampsArr]);
      h.u32(nL || 0);
      nums(h, lampsArr, 1);
      const gridArr = new Uint32Array(s.W * s.H);
      call(h, 'collectGridU32', [s, gridArr]);
      nums(h, gridArr, 1);
      const segArr = new Float32Array(4 * 256);
      const segN = call(h, 'collectDoorSegs', [s, segArr]);
      h.u32(typeof segN === 'number' ? segN : -1);
      nums(h, segArr, 3);
      const bodyP = G('playerPose') ? G('playerPose')(s, 1.5) : null;
      const mPose = G('monPose') ? G('monPose')(s, 1.5) : null;
      const caps = call(h, 'collectShadowCaps', [s, bodyP, mPose, null]);
      if (caps) {
        h.u32(caps.n === undefined ? caps.length || -1 : caps.n);
        if (caps.arr) nums(h, caps.arr, 3);
        else if (caps.length) nums(h, caps, 3);
      }
      /* вспомогательные данные теней и маска света по клеткам */
      const bsl = G('buildShadowAux');
      if (typeof bsl === 'function') {
        try {
          const r = bsl(s, lampsArr, nL || 0);
          h.str('shadowAux=' + typeof r);
          if (r && r.length !== undefined) nums(h, r, 5);
          else if (r) dump(h, r, 'sa.', 5);
        } catch (e) {
          h.str('shadowAux EXC ' + e.message);
        }
      }
      const clm = G('buildCellLightMask');
      if (typeof clm === 'function') {
        try {
          const out = new Uint32Array(s.W * s.H * 2);
          const r = clm(s, lampsArr, nL || 0, out);
          h.u32(typeof r === 'number' ? r : -1);
          nums(h, out, 5);
        } catch (e) {
          h.str('cellLightMask EXC ' + e.message);
        }
      }
      T.rec.op('geometry', h.a, h.b);
    });

    /* 9. WGSL: все варианты качества */
    await run('shaders', function () {
      const h = new H(31);
      const sh = G('shaders');
      if (typeof sh === 'function') {
        const o = sh();
        for (const k of Object.keys(o).sort()) {
          /* WGSL сравнивается без комментариев и повторов пробелов */
          const v = typeof o[k] === 'string' ? wgslNorm(o[k]) : o[k];
          h.str(k + ':' + typeof v + ':' + (v && v.length !== undefined ? v.length : -1));
          if (typeof v === 'string') h.str(v);
        }
      }
      for (const k of ['WGS_SKIN', 'WGS_LM', 'WGS_SHADOW']) {
        const fn = G(k);
        h.str(k + ':' + typeof fn);
        if (typeof fn === 'function') {
          const src = wgslNorm(fn());
          h.u32(src.length);
          h.str(src);
        }
      }
      const wgslWorld = G('fsWorldSrc') || G('wgslWorld');
      if (typeof wgslWorld === 'function') {
        for (const p of ['low', 'medium', 'high', 'ultra', 'max']) {
          const src = wgslNorm(wgslWorld(QUALITY[p]));
          h.str('world:' + p + ':' + src.length);
          h.str(src);
        }
      }
      for (const name of [
        'sdWgsl',
        'wgslSsao',
        'wgslVol',
        'wgslBright',
        'wgslComp',
        'MAT_WGSL',
        'WGS_HELPERS',
        'WGS_PP',
        'WGS_PACK',
        'WGS_GLOW',
        'WGS_DOWN',
        'WGS_UP',
        'WGS_SHARP',
        'WGS_AOBLUR',
        'WGS_STREAK',
        'WGS_ADAPT',
        'WGS_BLIT'
      ]) {
        const v = G(name);
        h.str(name + ':' + typeof v);
        if (typeof v === 'string') {
          const w = wgslNorm(v);
          h.u32(w.length);
          h.str(w);
        } else if (typeof v === 'function') {
          for (const p of ['low', 'medium', 'ultra']) {
            try {
              let src = v(QUALITY[p]);
              if (src) src = wgslNorm(src);
              h.str(p + ':' + (src ? src.length : -1));
              if (src) h.str(src);
            } catch (e) {
              h.str(p + ' EXC ' + e.message);
            }
          }
        }
      }
      const k = G('ssaoKernel');
      if (typeof k === 'function') for (const n of [6, 8, 12, 16, 24]) nums(h, k(n), 1);
      const iv = G('m4invView');
      const look = G('look');
      if (typeof iv === 'function' && typeof look === 'function') {
        for (const c of [
          [0, 0, 0, 0, 0],
          [1.5, 1.6, 2.5, 0.7, -0.2]
        ])
          nums(h, iv(look(c[0], c[1], c[2], c[3], c[4])), 1);
      }
      for (const name of ['m4mul', 'm4t', 'm4rotY', 'm4sc']) {
        const fn = G(name);
        h.str(name + ':' + typeof fn);
        if (typeof fn !== 'function') continue;
        try {
          if (name === 'm4mul')
            nums(h, fn(look(1, 2, 3, 0.4, -0.3), fn === G('m4t') ? null : G('m4t')(1, 2, 3)), 1);
          else if (name === 'm4t') nums(h, fn(1, 2, 3), 1);
          else if (name === 'm4rotY') nums(h, fn(0.7), 1);
          else nums(h, fn(2.5), 1);
        } catch (e) {
          h.str('EXC ' + e.message);
        }
      }
      T.rec.op('shaders', h.a, h.b);
    });

    /* 10. персонаж: риг, позы, анимации, скиннинг, кожа */
    await run('character', function () {
      const h = new H(37);
      const PREGv = G('PREG'),
        PMATv = G('PMAT');
      h.str('PREG=' + JSON.stringify(PREGv));
      h.str('PMAT=' + JSON.stringify(PMATv));
      const bpr = G('buildPlayerRig');
      let rig = null;
      if (typeof bpr === 'function') {
        try {
          rig = bpr(PREGv);
        } catch (e) {
          h.str('buildPlayerRig EXC ' + e.message);
        }
      }
      if (rig) {
        h.u32(rig.B ? rig.B.length : -1);
        if (rig.names) {
          h.u32(rig.names.length);
          for (const n of rig.names) h.str(n);
        }
        if (rig.B) for (const b of rig.B) nums(h, b, 1);
        for (const k of Object.keys(rig).sort())
          if (['B', 'names'].indexOf(k) < 0) {
            h.str('rig.' + k);
            const v = rig[k];
            if (typeof v === 'number') h.f64(v);
            else if (v && v.length !== undefined && typeof v !== 'function') nums(h, v, 3);
            else if (v && typeof v === 'object') h.str('{' + Object.keys(v).sort().join(',') + '}');
            else h.u32(v ? 1 : 0);
          }
      }
      h.str('HIDE_FP=' + JSON.stringify(G('HIDE_FP')));
      h.str('VM_FRAME=' + JSON.stringify(G('VM_FRAME')));
      for (const g of ['GRIP_FLASH', 'GRIP_KEY', 'GRIP_BATT', 'GRIP_SMALL_L']) {
        const fn = G(g);
        h.str(g + ':' + typeof fn);
        if (typeof fn === 'function') {
          try {
            poses(h, fn());
          } catch (e) {
            h.str('EXC ' + e.message);
          }
        }
      }
      const s = T.SIM.makeRun({ seed: 'character', W: 10, H: 10, monster: false });
      const pp = G('playerPose'),
        ppf = G('playerPoseFP');
      const states = [
        { time: 0, animPhase: 0, pCrouch: 0, runK: 0, pAnimWant: 'idle' },
        { time: 0.7, animPhase: 3.1, pCrouch: 0, runK: 0, pAnimWant: 'walk' },
        { time: 1.4, animPhase: 6.2, pCrouch: 0.5, runK: 0.4, pAnimWant: 'run' },
        { time: 2.9, animPhase: 9.7, pCrouch: 1, runK: 0, pAnimWant: 'crouch' }
      ];
      for (const st2 of states) {
        Object.assign(s, st2);
        if (typeof pp === 'function') {
          try {
            poses(h, pp(s, st2.time));
          } catch (e) {
            h.str('playerPose EXC ' + e.message);
          }
        }
        if (typeof ppf === 'function') {
          try {
            poses(h, ppf(s, st2.time));
          } catch (e) {
            h.str('playerPoseFP EXC ' + e.message);
          }
        }
      }
      const clips = G('ANIM_CLIPS');
      const pfc = G('poseFromClip');
      if (clips) {
        h.u32(clips.length);
        for (let i = 0; i < clips.length; i++) {
          const c = clips[i];
          h.str('clip' + i + '=' + (c.name || c.label || ''));
          h.u32(c.keys ? c.keys.length : c.frames ? c.frames.length : -1);
          if (typeof pfc === 'function') {
            const nm = c.name || c.label;
            for (const t of [0, 0.5, 0.999]) {
              try {
                const p = pfc(nm, t);
                if (p) for (const k of Object.keys(p).sort()) nums(h, p[k], 1);
              } catch (e) {
                h.str('poseFromClip EXC ' + nm + ' ' + e.message);
                break;
              }
            }
          }
        }
      }
      const names = G('animNames'),
        labels = G('animLabels');
      if (typeof names === 'function') h.str('names=' + names().join(','));
      if (typeof labels === 'function') h.str('labels=' + labels().join(','));
      h.str('GAIT_RATE=' + JSON.stringify(G('GAIT_RATE')));
      h.str('GAIT_K=' + JSON.stringify(G('GAIT_K')));
      const auto = G('playerAutoAnim');
      if (typeof auto === 'function') {
        for (const st2 of states) {
          Object.assign(s, st2);
          try {
            h.str('auto=' + String(auto(s)));
          } catch (e) {
            h.str('auto EXC ' + e.message);
          }
        }
      }
      const pds = G('poseDistSnap');
      if (typeof pds === 'function' && typeof pp === 'function') {
        try {
          h.f64(pds(pp(s, 0.3), pp(s, 0.9)));
        } catch (e) {
          h.str('poseDistSnap EXC ' + e.message);
        }
      }
      if (rig) {
        const fk = G('fkAll'),
          src = G('rigSrcData'),
          vis = G('rigVisCount'),
          skin = G('skinRigEx');
        const pose = typeof pp === 'function' ? pp(s, 0.7) : null;
        if (pose) {
          if (typeof fk === 'function') {
            try {
              nums(h, fk(rig, pose.pose, null), 7);
            } catch (e) {
              h.str('fkAll EXC ' + e.message);
            }
          }
          if (typeof skin === 'function') {
            try {
              const bb = skin(rig, pose.pose, null);
              if (bb) nums(h, bb, 11);
            } catch (e) {
              h.str('skinRigEx EXC ' + e.message);
            }
          }
        }
        if (typeof src === 'function') {
          try {
            const d = src(rig);
            if (d) dump(h, d, 'rigSrc.', 5);
          } catch (e) {
            h.str('rigSrcData EXC ' + e.message);
          }
        }
        if (typeof vis === 'function') {
          try {
            h.u32(vis(rig, G('HIDE_FP')));
            h.u32(vis(rig, null));
          } catch (e) {
            h.str('rigVisCount EXC ' + e.message);
          }
        }
      }
      const gst = G('genSkinTex');
      if (typeof gst === 'function') {
        try {
          const d = gst(xsSeed(seedBytesFromText('skin')));
          h.u32(d.length);
          nums(h, d, 997);
        } catch (e) {
          h.str('genSkinTex EXC ' + e.message);
        }
      }
      T.rec.op('character', h.a, h.b);
    });

    /* 11. Надзиратель: риг, походка, плащ */
    await run('monitor', function () {
      const h = new H(41);
      const s = T.SIM.makeRun({
        seed: 'monitor',
        W: 12,
        H: 12,
        monster: true,
        monsterSpeed: KMH(20),
        teleport: true
      });
      const br = G('buildRig');
      let rig = null;
      if (typeof br === 'function') {
        try {
          rig = br();
        } catch (e) {
          h.str('buildRig EXC ' + e.message);
        }
      }
      if (rig) {
        h.u32(rig.B ? rig.B.length : -1);
        if (rig.names) {
          h.u32(rig.names.length);
          for (const n of rig.names) h.str(n);
        }
        if (rig.B) for (const b of rig.B) nums(h, b, 1);
        for (const k of Object.keys(rig).sort())
          if (['B', 'names'].indexOf(k) < 0) {
            h.str('mrig.' + k);
            const v = rig[k];
            if (typeof v === 'number') h.f64(v);
            else if (v && v.length !== undefined && typeof v !== 'function') nums(h, v, 3);
            else h.u32(v ? 1 : 0);
          }
      }
      h.str('MON_GAIT=' + JSON.stringify(G('MON_GAIT')));
      h.str('MON_GAIT_K=' + JSON.stringify(G('MON_GAIT_K')));
      const mp = G('monPose'),
        mgp = G('monGaitPose');
      for (const t of [0, 0.31, 1.7, 4.2]) {
        s.time = t;
        s.mPhase = t * 4;
        s.mSpeedNow = (t * 0.7) % 2;
        s.mGait = t > 2 ? 'run' : 'walk';
        if (typeof mp === 'function') {
          try {
            poses(h, mp(s, t));
          } catch (e) {
            h.str('monPose EXC ' + e.message);
          }
        }
        if (typeof mgp === 'function') {
          for (const om of [0, 1.5, 3]) {
            try {
              poses(h, mgp(s.mPhase, G('MON_GAIT'), om, 0.2));
            } catch (e) {
              h.str('monGaitPose EXC ' + e.message);
              break;
            }
          }
        }
      }
      const mfl = G('monFootLowest'),
        mlf = G('monLegFK');
      if (typeof mp === 'function') {
        const pose = (function () {
          try {
            return mp(s, 0.5);
          } catch (e) {
            return null;
          }
        })();
        if (pose) {
          if (typeof mfl === 'function') {
            try {
              h.f64(mfl(pose.pose || pose));
            } catch (e) {
              h.str('monFootLowest EXC ' + e.message);
            }
          }
          if (typeof mlf === 'function') {
            try {
              const r = mlf(pose.pose || pose);
              if (r) dump(h, r, 'legfk.', 3);
            } catch (e) {
              h.str('monLegFK EXC ' + e.message);
            }
          }
        }
      }
      const ss = G('skirtSim'),
        sb = G('skirtBuild');
      const poseFor = (function () {
        try {
          return mp(s, 0.5);
        } catch (e) {
          return null;
        }
      })();
      if (typeof sb === 'function' && rig) {
        try {
          const r = sb(rig);
          h.str('skirtBuild=' + typeof r);
          if (r && r.length !== undefined) nums(h, r, 5);
          else if (r) dump(h, r, 'sk.', 5);
        } catch (e) {
          h.str('skirtBuild EXC ' + e.message);
        }
      }
      if (typeof ss === 'function' && rig && poseFor) {
        try {
          for (let i = 0; i < 10; i++) {
            const r = ss(s, 1 / 60, poseFor.pose || poseFor, rig, s.mYaw + i * 0.1);
            if (r && r.length !== undefined) nums(h, r, 13);
            else if (r) dump(h, r, 'skirt.', 13);
          }
        } catch (e) {
          h.str('skirtSim EXC ' + e.message);
        }
      }
      for (const name of [
        'SKIRT_NU',
        'SKIRT_NV',
        'SKIRT_TOP',
        'SKIRT_LEN',
        'SKIRT_FRONT',
        'SKIRT_VN',
        'SKIRT_R0',
        'SKIRT_SEGY',
        'SKIRT_RX'
      ]) {
        const v = G(name);
        h.str(name + ':' + typeof v);
        if (typeof v === 'number') h.f64(v);
        else if (v && v.length !== undefined) nums(h, v, 1);
        else if (v && typeof v === 'object') dump(h, v, name + '.', 1);
      }
      T.rec.op('monitor', h.a, h.b);
    });

    /* 12. симуляция забегов */
    await run('sim', function () {
      const h = new H(43);
      const runs = [
        { seed: 'sim-a', W: 12, H: 12, monster: false, density: 0.4, cabDens: 0.2, loot: 100 },
        {
          seed: 'sim-b',
          W: 16,
          H: 16,
          monster: true,
          monsterSpeed: KMH(15),
          density: 0.3,
          cabDens: 0.05,
          loot: 50
        },
        {
          seed: 'sim-c',
          W: 10,
          H: 10,
          monster: true,
          monsterSpeed: KMH(40),
          teleport: true,
          density: 0.2,
          cabDens: 0.1,
          loot: 25
        }
      ];
      for (const cfg of runs) {
        const r = T.SIM.botRun(cfg, { frames: 60 * 90 });
        h.str('bot:' + cfg.seed + ':' + r.digest);
        h.u32(r.frames);
        h.u32(r.won ? 1 : 0);
        h.u32(r.caught ? 1 : 0);
        h.u32(r.hasKey ? 1 : 0);
        h.f64(r.time);
        h.f64(r.steps);
        h.str(r.events.join(','));
        h.u32(r.errs.length);
        for (const e of r.errs.slice(0, 10)) h.str('ERR ' + e);
      }
      /* сценарий с полным набором входов */
      const script = [
        { n: 60, inp: { fwd: 1 } },
        { n: 30, inp: { fwd: 1, run: 1 } },
        { n: 30, inp: { fwd: 1, run: 1, crouch: 1 } },
        { n: 40, inp: { back: 1, left: 1 } },
        { n: 20, inp: { turnL: 1 } },
        { n: 20, inp: { turnR: 1, right: 1 } },
        { n: 10, inp: { interact: 1 } },
        { n: 10, inp: { flash: 1 } },
        { n: 30, inp: { fwd: 1, flash: 1 } },
        { n: 10, inp: { reload: 1 } },
        { n: 600, inp: null }
      ];
      const cfg2 = {
        seed: 'script',
        W: 14,
        H: 14,
        monster: true,
        density: 0.35,
        cabDens: 0.2,
        loot: 100
      };
      const probe = T.SIM.makeRun(cfg2);
      script[script.length - 1].inp = function (st3) {
        return botInput(st3);
      };
      const sr = T.SIM.scriptRun(cfg2, script, {});
      h.str('script:' + sr.digest);
      h.u32(sr.frames);
      h.u32(sr.errs.length);
      for (const e of sr.errs.slice(0, 10)) h.str('ERR ' + e);
      h.str(sr.events.join(','));
      h.f64(probe.px);
      for (const seed of SEEDS) {
        const c = T.SIM.chaosRun(
          { seed: seed, W: 11, H: 11, monster: true, density: 0.3, cabDens: 0.15, loot: 60 },
          900,
          hashOf(seed)
        );
        h.str(
          'chaos:' +
            seed +
            ':' +
            c.digest +
            ':' +
            c.errs.length +
            ':' +
            (c.won ? 'W' : '') +
            (c.caught ? 'C' : '')
        );
        for (const e of c.errs.slice(0, 6)) h.str('ERR ' + e);
      }
      T.rec.op('sim', h.a, h.b);
    });

    /* 13. звук и музыка */
    await run('audio', function () {
      const h = new H(47);
      const s = T.SIM.makeRun({ seed: 'audio', W: 10, H: 10, monster: true });
      const prevS = G('S');
      try {
        eval('S = s');
      } catch (e) {
        h.str('S assign EXC ' + e.message);
      }
      h.str('AU.on=' + (typeof AU !== 'undefined' ? AU.on : 'none'));
      if (typeof auInit === 'function') auInit();
      h.str('ctx=' + (AU.ctx ? 'yes' : 'no'));
      if (typeof auReseedNoise === 'function') auReseedNoise();
      const evNames = typeof EVT !== 'undefined' && EVT ? Object.keys(EVT).sort() : [];
      h.str('EVT=' + evNames.join(','));
      for (const e of evNames) {
        if (typeof auEvent === 'function') {
          try {
            auEvent(e);
          } catch (err) {
            h.str('auEvent EXC ' + e + ' ' + err.message);
          }
        }
        if (typeof evMsg === 'function') {
          try {
            evMsg(e);
          } catch (err) {
            h.str('evMsg EXC ' + e + ' ' + err.message);
          }
        }
      }
      for (let i = 0; i < 90; i++) {
        s.time = i / 60;
        s.px = 2.5 + (i % 7) * 0.25;
        s.py = 3.5 + (i % 3) * 0.2;
        s.stam = 1 - (i % 30) / 30;
        s.fl.on = i % 20 < 10;
        if (typeof auFrame === 'function') {
          try {
            auFrame(s, 1 / 60);
          } catch (err) {
            h.str('auFrame EXC ' + err.message);
            break;
          }
        }
        T.clock.t += 1000 / 60;
      }
      if (typeof auScream === 'function') {
        try {
          auScream();
        } catch (e) {
          h.str('auScream EXC ' + e.message);
        }
      }
      if (typeof drawScreamer === 'function') {
        for (const t of [0, 0.4, 1.1, 1.9]) {
          try {
            drawScreamer(t);
          } catch (e) {
            h.str('drawScreamer EXC ' + e.message);
            break;
          }
        }
      }
      /* музыка: движок, стinger, уровни страха */
      for (const fear of [0, 0.5, 1]) {
        h.str(
          'musParams' +
            fear +
            '=' +
            JSON.stringify(typeof musParams === 'function' ? musParams(fear) : null)
        );
        if (typeof MusEng === 'function' && AU.ctx) {
          try {
            const m = new MusEng(AU.ctx, 0x1234abcd, musParams(fear));
            m.start();
            for (let i = 0; i < 8; i++) {
              T.clock.t += 250;
              m._pump();
            }
            if (typeof m.stingNow === 'function') m.stingNow(0.4);
            m.stop(0.5);
            h.str('mus' + fear + '=ok:' + m.running);
          } catch (e) {
            h.str('MusEng EXC ' + e.message);
          }
        }
      }
      if (typeof musCurve === 'function') nums(h, musCurve(3), 7);
      if (typeof musMenu === 'function') {
        try {
          musMenu(true);
          musMenu(false, 0.4);
        } catch (e) {
          h.str('musMenu EXC ' + e.message);
        }
      }
      try {
        eval('S = prevS');
      } catch (e) {}
      T.audio.hashBuffers(h, 11);
      T.rec.op('audio', h.a, h.b);
    });

    /* 14. интерфейс */
    await run('ui', function () {
      const h = new H(53);
      const d = T.doc;
      const byId = id => d.getElementById(id);
      /* Enter на экране загрузки → главное меню */
      T.key('keydown', 'Enter', { code: 'Enter', key: 'Enter' });
      h.str('loader=' + byId('loader').className);
      h.str('menu=' + byId('menu').className);
      const menuScreen = G('menuScreen');
      if (typeof menuScreen === 'function') {
        for (const scr of ['play', 'set', 'man', 'main']) {
          try {
            menuScreen(scr);
          } catch (e) {
            h.str('menuScreen EXC ' + scr + ' ' + e.message);
          }
          const hh = new H(3);
          domHash(hh, byId('menu'), 0);
          h.str('screen:' + scr + ':' + hh.digest());
        }
      }
      for (const fn of [
        'buildBindsPanel',
        'buildGfxPanel',
        'syncControls',
        'updMazeInfo',
        'updMenuHints',
        'updPlayVis',
        'applyDevMode'
      ]) {
        const f = G(fn);
        h.str(fn + ':' + typeof f);
        if (typeof f === 'function') {
          try {
            f();
          } catch (e) {
            h.str(fn + ' EXC ' + e.message);
          }
        }
      }
      const hh2 = new H(5);
      domHash(hh2, byId('msSet'), 0);
      h.str('settingsDom=' + hh2.digest());
      const preset = byId('plPreset');
      if (preset) {
        for (const p of ['practice', 'easy', 'medium', 'hard', 'extreme', 'impossible', 'custom']) {
          preset.value = p;
          T.fire(preset, 'change', { target: preset });
          h.str('preset:' + p + ':' + JSON.stringify(PLAY));
        }
      }
      const gfx = byId('gfxPreset');
      if (gfx) {
        for (const p of ['low', 'medium', 'high', 'ultra', 'max', 'custom']) {
          gfx.value = p;
          T.fire(gfx, 'change', { target: gfx });
          h.str('gfx:' + p + ':' + GFX.preset + ':' + JSON.stringify(GFX.v));
        }
        h.str('buildQ=' + JSON.stringify(typeof buildQ === 'function' ? buildQ() : null));
      }
      for (const id of ['plW', 'plH', 'plDens', 'plCabD', 'plLoot', 'plMonSp', 'setSens']) {
        const el = byId(id);
        if (!el) {
          h.str(id + ':none');
          continue;
        }
        el.value = id === 'plW' || id === 'plH' ? '13' : id === 'setSens' ? '2.2' : '42';
        T.fire(el, 'input', { target: el });
        h.str(
          id +
            '=' +
            JSON.stringify({
              W: PLAY.W,
              H: PLAY.H,
              dens: PLAY.dens,
              cabD: PLAY.cabD,
              loot: PLAY.loot,
              monSp: PLAY.monSp,
              sens: SENS
            })
        );
      }
      const seedEl = byId('plSeed');
      if (seedEl) {
        seedEl.value = 'ui-seed';
        T.fire(seedEl, 'input', { target: seedEl });
        h.str('seed=' + PLAY.seedText);
      }
      for (const id of [
        'plMon',
        'plTp',
        'plMapOn',
        'plMapUnexp',
        'plMapMon',
        'plMapLamps',
        'plMapCabs',
        'plMapKey',
        'plMapSpawn',
        'plMapExit'
      ]) {
        const el = byId(id);
        if (!el) {
          h.str(id + ':none');
          continue;
        }
        el.checked = !el.checked;
        T.fire(el, 'change', { target: el });
        h.str(
          id + '=' + el.checked + ':' + JSON.stringify(PLAY.map) + ':' + PLAY.mon + ':' + PLAY.tp
        );
        el.checked = !el.checked;
        T.fire(el, 'change', { target: el });
      }
      for (const el of d.querySelectorAll('.ahead'))
        T.fire(el, 'click', { target: el, currentTarget: el });
      for (const id of [
        'miPlay',
        'miSet',
        'miMan',
        'plBack',
        'stBack',
        'sndW',
        'sndClose',
        'bindReset',
        'dvNoclip',
        'dvInvis',
        'dvStam',
        'dvMan',
        'dvTp'
      ]) {
        const el = byId(id);
        if (!el) {
          h.str(id + ':none');
          continue;
        }
        T.fire(el, 'click', { target: el, currentTarget: el });
        h.str('click:' + id);
      }
      /* клавиатура: бинды, пауза, слоты, миникарта */
      for (const code of [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'ShiftLeft',
        'KeyC',
        'KeyE',
        'KeyF',
        'KeyR',
        'KeyG',
        'KeyM',
        'Digit1',
        'Digit2',
        'Digit3',
        'Digit4',
        'Escape',
        'F3',
        'ArrowLeft',
        'ArrowRight'
      ]) {
        T.key('keydown', code, { code: code, key: code });
        T.key('keyup', code, { code: code, key: code });
      }
      h.str('keys=' + JSON.stringify(typeof keys !== 'undefined' ? keys : null));
      /* инвентарь и миникарта на живом забеге */
      const s = T.SIM.makeRun({
        seed: 'ui-run',
        W: 12,
        H: 12,
        monster: true,
        density: 0.35,
        cabDens: 0.2,
        loot: 80
      });
      invAdd(s, 'flash');
      invAdd(s, 'batt');
      invAdd(s, 'batt');
      invAdd(s, 'key');
      s.sel = 0;
      const updInv = G('updInvHud');
      if (typeof updInv === 'function') {
        updInv(s);
        const hh3 = new H(7);
        domHash(hh3, byId('invBar'), 0);
        h.str('inv=' + hh3.digest());
      }
      const prevS = G('S'),
        prevStarted = G('started'),
        prevMap = G('showMap');
      try {
        eval('S = s');
        eval('started = true');
        eval('showMap = true');
        for (let i = 0; i < 12; i++) {
          s.time = i / 10;
          s.px += 0.1;
          markExp(s, Math.floor(s.py) * s.W + Math.floor(s.px));
          if (typeof drawMinimap === 'function') drawMinimap();
        }
        const hh5 = new H(8);
        h.str('minimap=' + hh5.digest());
      } catch (e) {
        h.str('minimap EXC ' + e.message);
      }
      try {
        eval('S = prevS');
        eval('started = prevStarted');
        eval('showMap = prevMap');
      } catch (e) {}
      if (typeof setMsg === 'function') {
        setMsg('тест сообщения', '#fff');
        h.str('msg=' + byId('msg').textContent + '|' + byId('msg').style.color);
      }
      if (typeof fmtDur === 'function')
        for (const t of [0, 1, 59, 60, 3599, 3600, 123456]) h.str('dur' + t + '=' + fmtDur(t));
      if (typeof fmtDist === 'function')
        for (const t of [0, 1, 12.5, 999, 12345]) h.str('dist' + t + '=' + fmtDist(t));
      if (typeof diffName === 'function')
        for (const p of [
          'practice',
          'easy',
          'medium',
          'hard',
          'extreme',
          'impossible',
          'custom',
          'none'
        ])
          h.str('diff' + p + '=' + diffName(p));
      if (typeof ldShow === 'function') {
        ldShow('тест');
        h.str('ldShow=' + byId('ldPct').textContent + '|' + byId('loader').className);
      }
      if (typeof LD !== 'undefined') {
        LD.set(37, 'проверка');
        h.str(
          'LD=' +
            byId('ldFill').style.width +
            '|' +
            byId('ldPct').textContent +
            '|' +
            byId('ldLbl').textContent
        );
      }
      /* настройки: открыть/закрыть, сохранение в localStorage */
      if (typeof openSettings === 'function') {
        try {
          openSettings(false);
          h.str('open=' + byId('msSet').className);
        } catch (e) {
          h.str('openSettings EXC ' + e.message);
        }
      }
      if (typeof saveSettings === 'function') {
        try {
          saveSettings();
          h.str('saved=' + String(T.env.localStorageStore.get('nadziratel_cfg')).slice(0, 400));
        } catch (e) {
          h.str('saveSettings EXC ' + e.message);
        }
      }
      if (typeof closeSettings === 'function') {
        try {
          closeSettings();
        } catch (e) {
          h.str('closeSettings EXC ' + e.message);
        }
      }
      /* событие изменения размера окна и скрытия вкладки */
      T.fire(d.defaultView, 'resize', {});
      T.fire(d, 'visibilitychange', {});
      const hh4 = new H(9);
      domHash(hh4, d.documentElement, 0);
      h.str('finalDom=' + hh4.digest());
      T.rec.op('ui', h.a, h.b);
    });

    /* 15. рендер: устройство, инициализация и кадры настоящего забега */
    await run('gpu', async function () {
      const h = new H(59);
      if (!T.gpu) {
        T.rec.op('gpu.disabled', 1);
        return;
      }
      T.env.enableGPU();
      const s = T.SIM.makeRun({
        seed: 'gpu-run',
        W: 14,
        H: 14,
        monster: true,
        monsterSpeed: KMH(18),
        density: 0.4,
        cabDens: 0.2,
        loot: 80,
        teleport: true
      });
      const canvas = T.doc.getElementById('view');
      h.str('canvas=' + canvas.width + 'x' + canvas.height);
      let ok = false;
      try {
        ok = await gpuInitQ(canvas, s);
      } catch (e) {
        h.str('init EXC ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
      }
      h.str(
        'init=' +
          ok +
          '|' +
          GPU.ready +
          '|' +
          GPU.ok +
          '|' +
          GPU.sig +
          '|' +
          GPU.mapW +
          'x' +
          GPU.mapH
      );
      h.u32(GPU.wCount || 0);
      h.u32(GPU.wFCount || 0);
      T.rec.str('stats=' + JSON.stringify(T.gpu.stats));
      enableBot(s);
      const prevS = G('S'),
        prevStarted = G('started');
      try {
        eval('S = s');
        eval('started = true');
      } catch (e) {}
      for (let i = 0; i < 36; i++) {
        const bi = botInput(s);
        let ev = null;
        try {
          ev = update(s, bi, 1 / 60);
        } catch (e) {
          h.str('update EXC ' + i + ' ' + e.message);
          break;
        }
        if (ev && ev.length) h.str('ev' + i + ':' + ev.join(','));
        if (i === 5) {
          s.fl.owned = true;
          s.fl.on = true;
          invAdd(s, 'flash');
        }
        if (i === 12) {
          s.fl.e = 0.15;
          s.fl.rl = 0.4;
          invAdd(s, 'batt');
        }
        if (i === 18) s.thirdPerson = 1;
        if (i === 24) s.thirdPerson = 2;
        if (i === 30) {
          s.thirdPerson = 0;
          s.doorT = 0.7;
          s.hasKey = true;
        }
        try {
          GPU.frame(s, 1 / 60);
        } catch (e) {
          h.str(
            'frame EXC ' +
              i +
              ' ' +
              (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)
          );
          break;
        }
        if (i % 4 === 0) T.SIM.hashState(h, s);
        T.clock.t += 1000 / 60;
      }
      h.u32(GPU.framesDone || 0);
      try {
        GPU.resize(960, 600);
        h.str('resize=ok');
      } catch (e) {
        h.str('resize EXC ' + e.message);
      }
      try {
        GPU.frame(s, 1 / 60);
      } catch (e) {
        h.str('frame2 EXC ' + e.message);
      }
      try {
        if (typeof GPU.clearBlack === 'function') GPU.clearBlack();
      } catch (e) {
        h.str('clearBlack EXC ' + e.message);
      }
      /* второй забег — пересборка ресурсов под другую карту */
      const s2 = T.SIM.makeRun({
        seed: 'gpu-run-2',
        W: 9,
        H: 9,
        monster: false,
        density: 0.5,
        cabDens: 0.3,
        loot: 100
      });
      try {
        const ok2 = await gpuInitQ(canvas, s2);
        h.str('init2=' + ok2 + '|' + GPU.sig);
        for (let i = 0; i < 6; i++) {
          update(s2, { fwd: i % 2 }, 1 / 60);
          GPU.frame(s2, 1 / 60);
          T.clock.t += 1000 / 60;
        }
      } catch (e) {
        h.str('init2 EXC ' + (e && e.message));
      }
      try {
        eval('S = prevS');
        eval('started = prevStarted');
      } catch (e) {}
      T.rec.str('stats2=' + JSON.stringify(T.gpu.stats));
      T.rec.op('gpu', h.a, h.b);
    });

    return { sections, total: T.rec.digest(), notes, ops: T.rec.ops };
  }

  globalThis.__NADZ_FINGERPRINT__ = build;
})();

'use strict';
/* Детерминированная симуляция забега: используется и тестами, и отпечатком
   сборки. Один и тот же код прогона на исходниках и на собранном файле даёт
   одинаковый хэш — любое расхождение логики сразу видно. */

(function () {
  const T = typeof __T !== 'undefined' ? __T : null;

  const SIM = {};

  /* сид забега — текстом, как это делает игра */
  SIM.seedBytes = function (text) {
    return seedBytesFromText(text);
  };

  SIM.defaults = {
    seed: 'NADZIRATEL-TEST',
    W: 24,
    H: 24,
    monster: true,
    monsterSpeed: KMH(15),
    density: 0.3,
    teleport: false,
    cabDens: 0.05,
    loot: 50,
    map: null
  };

  SIM.makeRun = function (cfg) {
    const c = Object.assign({}, SIM.defaults, cfg || {});
    const bytes = c.seedBytes || SIM.seedBytes(c.seed);
    const s = newState(bytes, {
      W: c.W,
      H: c.H,
      monster: c.monster,
      monsterSpeed: c.monsterSpeed,
      density: c.density,
      teleport: c.teleport,
      cabDens: c.cabDens,
      loot: c.loot,
      map: c.map === null ? undefined : c.map
    });
    s.seedText = c.seed;
    return s;
  };

  /* ---- инварианты: то, что не должно нарушаться никогда ---- */
  SIM.check = function (s, errs, frame) {
    const bad = msg => {
      errs.push('кадр ' + frame + ': ' + msg);
    };
    const num = (v, name) => {
      if (typeof v !== 'number' || !isFinite(v)) bad(name + ' = ' + v);
    };

    num(s.px, 'px');
    num(s.py, 'py');
    num(s.ang, 'ang');
    num(s.time, 'time');
    num(s.stam, 'stam');
    num(s.steps, 'steps');
    if (s.stam < -1e-9 || s.stam > 1 + 1e-9) bad('стамина вне [0,1]: ' + s.stam);
    if (s.px < 0 || s.py < 0 || s.px >= s.W || s.py >= s.H)
      bad('игрок вне сетки: ' + s.px + ',' + s.py);

    /* игрок не должен стоять внутри стены (кроме noclip в dev) */
    if (!(s.dev && s.dev.noclip)) {
      const cell = cellAt(s, s.px, s.py);
      if (cell === 1)
        bad('игрок внутри стены в клетке ' + Math.floor(s.px) + ',' + Math.floor(s.py));
    }

    if (s.monster) {
      num(s.mx, 'mx');
      num(s.my, 'my');
      num(s.mYaw, 'mYaw');
      if (s.mx < 0 || s.my < 0 || s.mx >= s.W || s.my >= s.H)
        bad('Надзиратель вне сетки: ' + s.mx + ',' + s.my);
      const mc = cellAt(s, s.mx, s.my);
      if (mc === 1 && !s.mTele)
        bad('Надзиратель внутри стены: ' + Math.floor(s.mx) + ',' + Math.floor(s.my));
      if (s.mMode !== 'wander' && s.mMode !== 'chase' && s.mMode !== 'investigate')
        bad('неизвестный режим ИИ: ' + s.mMode);
      num(s.mPhase, 'mPhase');
    }

    /* инвентарь: 4 слота, sel указывает на занятый или -1, батарейки в пределах стака */
    if (s.inv.length !== INV_SLOTS) bad('инвентарь не из ' + INV_SLOTS + ' слотов');
    for (let i = 0; i < s.inv.length; i++) {
      const it = s.inv[i];
      if (!it) continue;
      if (it.kind !== 'key' && it.kind !== 'flash' && it.kind !== 'batt')
        bad('неизвестный предмет: ' + it.kind);
      if (it.kind === 'batt' && !(it.n >= 1 && it.n <= BATT_STACK))
        bad('стак батареек вне [1,' + BATT_STACK + ']: ' + it.n);
    }
    if (s.sel >= 0 && !s.inv[s.sel]) bad('sel=' + s.sel + ' указывает на пустой слот');

    /* свет и лампы */
    if (s.light) {
      for (let i = 0; i < s.light.length; i++)
        if (!isFinite(s.light[i])) {
          bad('light[' + i + '] = ' + s.light[i]);
          break;
        }
    }
    num(s.fl.e, 'fl.e');
    num(s.fl.bri, 'fl.bri');
    if (s.fl.e < -1e-9 || s.fl.e > 1 + 1e-9) bad('заряд фонаря вне [0,1]: ' + s.fl.e);

    /* тумбочки: содержимое не должно исчезать само */
    for (const c of s.cabs) {
      if (c.content && c.content !== 'none' && c.looted && !c._wasLooted) c._wasLooted = 1;
      num(c.open, 'cab.open');
      num(c.want, 'cab.want');
    }

    if (s.won && s.caught) bad('одновременно won и caught');
    if (s.hasKey && !s.won && s.doorUnlocked === undefined) bad('нет поля doorUnlocked');
    return errs;
  };

  /* ---- запись состояния в хэш ---- */
  SIM.hashState = function (h, s) {
    h.f64(s.px);
    h.f64(s.py);
    h.f64(s.ang);
    h.f64(s.time);
    h.f64(s.stam);
    h.f64(s.steps);
    h.u32(s.sel + 1);
    for (let i = 0; i < s.inv.length; i++) {
      const it = s.inv[i];
      h.str(it ? it.kind + (it.n || 1) : '-');
    }
    h.u32(s.hasKey ? 1 : 0);
    h.u32(s.doorOpen ? 1 : 0);
    h.u32(s.doorUnlocked ? 1 : 0);
    h.f64(s.doorT);
    h.f64(s.doorLeafT);
    h.u32(s.fl.owned ? 1 : 0);
    h.u32(s.fl.on ? 1 : 0);
    h.f64(s.fl.e);
    h.f64(s.fl.bri);
    h.f64(s.fl.rl);
    h.f64(s.pCrouch);
    h.u32(s.pAnimWant ? hashStr(s.pAnimWant) : 0);
    h.f64(s.animPhase);
    h.f64(s.noiseR);
    h.u32(s.noiseCd > 0 ? 1 : 0);
    h.f64(s.darkT);
    if (s.monster) {
      h.f64(s.mx);
      h.f64(s.my);
      h.f64(s.mYaw);
      h.str(s.mMode);
      h.f64(s.mPhase);
      h.f64(s.mSpeedNow);
      h.str(s.mGait);
      h.f64(s.tpCd);
      h.u32(s.lastSeen ? 1 : 0);
    }
    let lit = 0,
      dark = 0;
    for (let i = 0; i < s.light.length; i++) {
      const v = s.light[i];
      if (v > 0.5) lit++;
      else if (v < DARK_T) dark++;
    }
    h.u32(lit);
    h.u32(dark);
    let expl = 0;
    for (let i = 0; i < s.explored.length; i++) expl += s.explored[i] ? 1 : 0;
    h.u32(expl);
    let openCab = 0,
      looted = 0;
    for (const c of s.cabs) {
      openCab += c.open > 0.5 ? 1 : 0;
      looted += c.looted ? 1 : 0;
    }
    h.u32(openCab);
    h.u32(looted);
    h.u32(s.drops.length);
    h.u32(s.won ? 1 : 0);
    h.u32(s.caught ? 1 : 0);
    return h;
  };

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* ---- один кадр симуляции ---- */
  SIM.frame = function (s, inp, dt, errs, n) {
    const ev = update(s, inp, dt);
    if (errs) SIM.check(s, errs, n);
    return ev;
  };

  /* ---- прогон автопилота: ключ → фонарь → выход ---- */
  SIM.botRun = function (cfg, opts) {
    const o = opts || {};
    const s = SIM.makeRun(cfg);
    enableBot(s);
    const h = new T.Hash(hashStr('botrun:' + JSON.stringify(cfg && cfg.seed)));
    const errs = [];
    const dt = o.dt || 1 / 60;
    const frames = o.frames || 60 * 240;
    const evAll = [];
    let i = 0;
    for (; i < frames; i++) {
      const inp = botInput(s);
      const ev = update(s, inp, dt);
      if (ev && ev.length) {
        for (const e of ev) {
          evAll.push(e);
          h.str('ev' + i + ':' + e);
        }
      }
      if (i % 3 === 0) SIM.hashState(h, s);
      SIM.check(s, errs, i);
      if (errs.length > 40) break;
      if (s.won || s.caught) break;
    }
    return {
      s,
      frames: i,
      events: evAll,
      errs,
      won: !!s.won,
      caught: !!s.caught,
      hasKey: !!s.hasKey,
      time: s.time,
      steps: s.steps,
      digest: h.digest()
    };
  };

  /* ---- прогон по скрипту ввода: [{n:кадров, inp:{...}}, ...] ---- */
  SIM.scriptRun = function (cfg, script, opts) {
    const o = opts || {};
    const s = SIM.makeRun(cfg);
    const h = new T.Hash(hashStr('scriptrun:' + (cfg && cfg.seed)));
    const errs = [];
    const dt = o.dt || 1 / 60;
    const evAll = [];
    let n = 0;
    for (const step of script) {
      for (let k = 0; k < step.n; k++) {
        const inp = typeof step.inp === 'function' ? step.inp(s, n) : step.inp;
        const ev = update(s, inp, dt);
        if (ev && ev.length)
          for (const e of ev) {
            evAll.push(e);
            h.str('ev' + n + ':' + e);
          }
        if (n % 2 === 0) SIM.hashState(h, s);
        SIM.check(s, errs, n);
        if (errs.length > 40) return { s, frames: n, events: evAll, errs, digest: h.digest() };
        n++;
        if (s.won || s.caught)
          return {
            s,
            frames: n,
            events: evAll,
            errs,
            digest: h.digest(),
            won: !!s.won,
            caught: !!s.caught
          };
      }
    }
    return {
      s,
      frames: n,
      events: evAll,
      errs,
      digest: h.digest(),
      won: !!s.won,
      caught: !!s.caught
    };
  };

  /* ---- случайный (но детерминированный) ввод: стресс-тест симуляции ---- */
  SIM.chaosRun = function (cfg, frames, seed) {
    const s = SIM.makeRun(cfg);
    const rnd = T.rng(seed || 7);
    const h = new T.Hash(hashStr('chaos:' + (cfg && cfg.seed) + ':' + seed));
    const errs = [];
    const dt = 1 / 60;
    let stuck = 0,
      lastX = s.px,
      lastY = s.py;
    for (let n = 0; n < frames; n++) {
      const inp = {
        fwd: rnd() < 0.5 ? 1 : 0,
        back: rnd() < 0.2 ? 1 : 0,
        left: rnd() < 0.25 ? 1 : 0,
        right: rnd() < 0.25 ? 1 : 0,
        turnL: rnd() < 0.2 ? 1 : 0,
        turnR: rnd() < 0.2 ? 1 : 0,
        interact: rnd() < 0.06 ? 1 : 0,
        run: rnd() < 0.3 ? 1 : 0,
        crouch: rnd() < 0.05 ? 1 : 0,
        flash: rnd() < 0.04 ? 1 : 0,
        reload: rnd() < 0.02 ? 1 : 0
      };
      const ev = update(s, inp, dt);
      if (ev && ev.length) for (const e of ev) h.str('ev' + n + ':' + e);
      if (n % 4 === 0) SIM.hashState(h, s);
      SIM.check(s, errs, n);
      if (errs.length > 40) break;
      if (Math.abs(s.px - lastX) < 1e-6 && Math.abs(s.py - lastY) < 1e-6) stuck++;
      else stuck = 0;
      lastX = s.px;
      lastY = s.py;
      if (s.won || s.caught) break;
    }
    return { s, errs, stuck, digest: h.digest(), won: !!s.won, caught: !!s.caught };
  };

  if (T) T.SIM = SIM;
  if (typeof globalThis !== 'undefined') globalThis.__SIM = SIM;
  return SIM;
})();

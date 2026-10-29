'use strict';
/* Общие помощники наборов. Внутри VM-контекста страницы, поэтому видит все
   глобалы игры. Подключается первым (имя сортируется раньше остальных). */

const LIB = (function () {
  const L = {};

  /* внутренности рендерера: сначала тестовый хук, потом глобалы страницы */
  L.G = function (name) {
    try {
      if (typeof GPU !== 'undefined' && GPU._test && GPU._test[name] !== undefined)
        return GPU._test[name];
    } catch (e) {}
    try {
      return eval(name);
    } catch (e) {
      return undefined;
    }
  };
  L.fn = function (name) {
    const f = L.G(name);
    if (typeof f !== 'function')
      throw new Error('нет функции ' + name + ' (получено ' + typeof f + ')');
    return f;
  };

  L.run = function (cfg) {
    return __T.SIM.makeRun(cfg || {});
  };

  /* свободная клетка в середине лабиринта: чтобы проверка движения не упиралась
     в стену стартовой комнаты */
  L.openSpot = function (s) {
    const list = s.mazeFloors && s.mazeFloors.length ? s.mazeFloors : s.floors;
    if (!list || !list.length) return { x: s.px, y: s.py };
    let best = null,
      bestScore = -1;
    for (const idx of list) {
      const x = idx % s.W,
        y = (idx / s.W) | 0;
      let free = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const v = s.grid[(y + dy) * s.W + (x + dx)];
          if (v === 0) free++;
        }
      if (free > bestScore) {
        bestScore = free;
        best = { x: x + 0.5, y: y + 0.5 };
      }
    }
    return best || { x: s.px, y: s.py };
  };

  L.place = function (s, x, y, ang) {
    s.px = x;
    s.py = y;
    if (ang !== undefined) s.ang = ang;
    return s;
  };

  /* прогнать n кадров, собрать события */
  L.frames = function (s, inp, n, dt) {
    const ev = [];
    const d = dt || 1 / 60;
    for (let i = 0; i < n; i++) {
      const e = update(s, typeof inp === 'function' ? inp(s, i) : inp, d);
      if (e && e.length) for (const x of e) ev.push(x);
      __T.clock.t += d * 1000;
    }
    return ev;
  };

  L.has = function (arr, name) {
    return arr.indexOf(name) >= 0;
  };

  /* точка перед объектом, из которой aimTarget его видит */
  L.aimSpot = function (s, obj, kind, reach) {
    const cc = kind === 'cab' ? cabCenter(obj, CAB_D) : { x: obj.x + 0.5, y: obj.y + 0.5 };
    const dirs =
      obj.wx !== undefined && (obj.wx || obj.wy)
        ? [{ x: -obj.wx, y: -obj.wy }]
        : [
            { x: 1, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: -1 }
          ];
    const saved = { px: s.px, py: s.py, ang: s.ang };
    for (const d of dirs) {
      for (let r = 0.25; r <= (reach || 0.6); r += 0.05) {
        s.px = cc.x + d.x * r;
        s.py = cc.y + d.y * r;
        s.ang = Math.atan2(-d.y, -d.x);
        s.pitch = 0;
        const t = aimTarget(s);
        if (t && t.t === kind) {
          const res = { px: s.px, py: s.py, ang: s.ang, target: t };
          Object.assign(s, saved);
          return res;
        }
      }
    }
    Object.assign(s, saved);
    return null;
  };

  /* конечные числа в массиве */
  L.allFinite = function (a) {
    for (let i = 0; i < a.length; i++) if (typeof a[i] === 'number' && !isFinite(a[i])) return i;
    return -1;
  };

  /* копия состояния для сравнения «до/после» */
  L.snap = function (s) {
    return {
      px: s.px,
      py: s.py,
      ang: s.ang,
      time: s.time,
      stam: s.stam,
      steps: s.steps,
      hasKey: !!s.hasKey,
      won: !!s.won,
      caught: !!s.caught,
      doorT: s.doorT,
      inv: s.inv.map(x => (x ? x.kind + (x.n || 1) : '-')).join(','),
      fl: { owned: !!s.fl.owned, on: !!s.fl.on, e: s.fl.e, rl: s.fl.rl }
    };
  };

  return L;
})();

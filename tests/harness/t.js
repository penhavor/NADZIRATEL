'use strict';
/* Мостик между Node и VM-контекстом страницы: регистрация тестов, утверждения,
   доступ к регистратору, часам и заглушкам. Injected как __T. */

const { Hash, hashSeed, wgslNorm } = require('./hash');

function createT(page) {
  const tests = [];
  const T = {
    tests,
    Hash,
    hashSeed,
    wgslNorm,
    rec: page.rec,
    clock: page.clock,
    env: page.env,
    doc: page.env.doc,
    audio: page.env.audio,
    gpu: page.env.gpu,
    consoleLog: page.env.consoleLog,
    loadErrors: page.loadErrors,
    mode: page.mode,

    test(name, fn, opts) {
      tests.push({ name, fn, opts: opts || {} });
    },
    skip(name, why) {
      tests.push({ name, fn: null, skip: why || true });
    },

    section(name, fn) {
      return page.rec.section(name, fn);
    },
    sectionAsync(name, fn) {
      return page.rec.sectionAsync(name, fn);
    },

    ok(v, msg) {
      if (!v) fail(msg || 'ожидалось истинное значение, получено ' + show(v));
    },
    not(v, msg) {
      if (v) fail(msg || 'ожидалось ложное значение');
    },
    eq(a, b, msg) {
      if (a !== b) fail((msg || 'значения не равны') + ': ' + show(a) + ' != ' + show(b));
    },
    neq(a, b, msg) {
      if (a === b) fail((msg || 'значения совпали') + ': ' + show(a));
    },
    near(a, b, eps, msg) {
      const e = eps === undefined ? 1e-9 : eps;
      if (!isFinite(a) || !isFinite(b) || Math.abs(a - b) > e)
        fail((msg || 'числа расходятся') + ': ' + show(a) + ' ~ ' + show(b) + ' (eps ' + e + ')');
    },
    finite(v, msg) {
      if (typeof v !== 'number' || !isFinite(v))
        fail((msg || 'ожидалось конечное число') + ', получено ' + show(v));
    },
    nan(v, msg) {
      if (typeof v === 'number' && isNaN(v)) fail(msg || 'получен NaN');
    },
    match(s, re, msg) {
      if (!re.test(String(s)))
        fail((msg || 'строка не подходит под шаблон') + ': ' + show(s) + ' !~ ' + re);
    },
    throws(fn, msg) {
      let thrown = null;
      try {
        fn();
      } catch (e) {
        thrown = e;
      }
      if (!thrown) fail(msg || 'ожидалось исключение');
      return thrown;
    },
    noThrow(fn, msg) {
      try {
        return fn();
      } catch (e) {
        fail((msg || 'неожиданное исключение') + ': ' + (e && e.message ? e.message : e));
      }
    },
    arrayFinite(a, msg) {
      if (!a || typeof a.length !== 'number') fail((msg || 'не массив') + ': ' + show(a));
      for (let i = 0; i < a.length; i++)
        if (typeof a[i] === 'number' && !isFinite(a[i]))
          fail((msg || 'не конечное значение') + ' в [' + i + '] = ' + a[i]);
      return a;
    },
    deepEq(a, b, msg) {
      const sa = safe(a),
        sb = safe(b);
      if (sa !== sb) fail((msg || 'объекты не равны') + ':\n  ' + sa + '\n  ' + sb);
    },
    inRange(v, lo, hi, msg) {
      if (!(v >= lo && v <= hi))
        fail(
          (msg || 'значение вне диапазона') + ': ' + show(v) + ' not in [' + lo + ',' + hi + ']'
        );
    },

    /* детерминированный ГПСЧ для тестов */
    rng(seed) {
      let s = hashSeed('test-rng:' + (seed || 0)) >>> 0;
      return function () {
        s ^= s << 13;
        s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5;
        s >>>= 0;
        return s / 4294967296;
      };
    },

    /* события интерфейса */
    key: (type, code, props) => page.env.key(type, code, props),
    mouse: (type, props) => page.env.mouse(type, props),
    click(el) {
      if (!el) fail('нет элемента для клика');
      el.click();
    },
    fire(el, type, props) {
      return page.env.event(el, type, props);
    },
    byId(id) {
      const e = page.env.doc.getElementById(id);
      if (!e) fail('не найден #' + id);
      return e;
    },

    advance: (ms, maxSteps) => page.clock.run(ms, maxSteps),
    drain: maxSteps => page.clock.drain(maxSteps),
    now: () => page.clock.now(),
    eval: (code, name) => page.eval(code, name)
  };

  function fail(msg) {
    throw new AssertionError(msg);
  }
  function show(v) {
    if (typeof v === 'string') return JSON.stringify(v.length > 120 ? v.slice(0, 117) + '…' : v);
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'function') return 'fn ' + (v.name || '');
    try {
      const s = JSON.stringify(v);
      return s && s.length > 160 ? s.slice(0, 157) + '…' : String(s);
    } catch (e) {
      return Object.prototype.toString.call(v);
    }
  }
  function safe(v) {
    try {
      return JSON.stringify(v, (k, x) => (typeof x === 'number' && !isFinite(x) ? String(x) : x));
    } catch (e) {
      return String(v);
    }
  }

  class AssertionError extends Error {
    constructor(msg) {
      super(msg);
      this.name = 'AssertionError';
      this.isAssertion = true;
    }
  }
  T.AssertionError = AssertionError;

  return T;
}

module.exports = { createT };

'use strict';
/* Окружение страницы: window, document, navigator, localStorage, часы,
   аудио, WebGPU, детерминированный Math.random. Всё пишется в регистратор. */

const {
  El,
  TextNode,
  parseDocument,
  parseNodes,
  makeEvent,
  dispatch,
  handlerErrors
} = require('./dom');
const { createCanvas2D } = require('./canvas2d');
const { createAudioEnv } = require('./audio');
const { createGPU } = require('./webgpu');
const { Clock, yieldMicro } = require('./clock');
const { Hash, hashSeed, prng } = require('./hash');

function createEnv(opts) {
  const o = opts || {};
  const rec = o.rec;
  const clock = o.clock || new Clock(o.startTime || 0);
  const search = o.search || '';
  const errors = [];

  /* детерминированный ГПСЧ вместо Math.random */
  let rndState = prng(hashSeed('math-random:' + (o.seed || 1)));
  const detRandom = () => (rndState() >>> 8) / 16777216;

  const audio = createAudioEnv(rec, clock, { sampleRate: o.sampleRate || 44100 });
  /* gpu: 'on' — устройство видно сразу (загрузка страницы делает полный init),
     'hidden' — объект есть, но navigator.gpu пустой, пока тест не позовёт enableGPU(),
     'off' — WebGPU нет вовсе */
  const gpuMode = o.gpu === false || o.gpu === 'off' ? 'off' : o.gpu === 'on' ? 'on' : 'hidden';
  const gpu =
    gpuMode === 'off'
      ? null
      : createGPU(rec, { features: o.gpuFeatures || [], noAdapter: o.noAdapter });

  const sandbox = {};

  /* ---- document ---- */
  const doc = new El('#document', null);
  doc.nodeType = 9;
  doc.nodeName = '#document';
  doc.localName = '#document';
  doc.ownerDocument = doc;
  doc._indexId = () => {};
  doc._indexTree = () => {};
  doc._deindex = () => {};
  doc.defaultView = sandbox;
  doc.title = '';
  doc.hidden = false;
  doc.visibilityState = 'visible';
  doc.readyState = 'loading';
  doc.pointerLockElement = null;
  doc.activeElement = null;
  doc.listeners = {};
  doc.createElement = tag => new El(tag, doc);
  doc.createElementNS = (ns, tag) => new El(tag, doc);
  doc.createTextNode = t => new TextNode(t);
  doc.createDocumentFragment = () => {
    const f = new El('#fragment', doc);
    f.nodeType = 11;
    return f;
  };
  doc.getElementById = id => findById(doc, id);
  doc.getElementsByTagName = t => doc.querySelectorAll(String(t).toLowerCase());
  doc.getElementsByClassName = c => doc.querySelectorAll('.' + c);
  doc.querySelector = sel => doc.querySelectorAll(sel)[0] || null;
  doc.querySelectorAll = sel => queryAllDoc(doc, sel);
  doc.addEventListener = El.prototype.addEventListener;
  doc.removeEventListener = El.prototype.removeEventListener;
  doc.dispatchEvent = ev => dispatch(doc, ev);
  doc.exitPointerLock = () => {
    rec.op('dom', 'exitPointerLock', 0, 0);
    doc.pointerLockElement = null;
  };
  doc.execCommand = () => false;
  doc.hasFocus = () => true;
  doc.elementFromPoint = () => null;
  doc._makeContext = (canvas, kind) => {
    if (kind === '2d') return createCanvas2D(canvas, rec);
    if (kind === 'webgpu') return gpu ? gpu.contextWebGPU(canvas) : null;
    return null;
  };

  function findById(root, id) {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      if (!n || !n.childNodes) continue;
      if (n.nodeType === 1 && n.attributes.id === id) return n;
      for (let i = n.childNodes.length - 1; i >= 0; i--) stack.push(n.childNodes[i]);
    }
    return null;
  }

  /* querySelectorAll от document: цепочки матчатся относительно корня документа */
  function queryAllDoc(root, sel) {
    const { queryAll } = require('./dom');
    return queryAll(root, sel);
  }

  /* ---- window ---- */
  const navigator = {
    userAgent: 'Mozilla/5.0 (headless-test) NADZIRATEL',
    platform: 'Linux x86_64',
    language: 'ru-RU',
    languages: ['ru-RU', 'ru', 'en'],
    vendor: '',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    onLine: true,
    clipboard: {
      writeText: t => {
        rec.op('dom', 'clipboard', hashSeed(String(t)), 0);
        return Promise.resolve();
      },
      readText: () => Promise.resolve('')
    },
    gpu: gpuMode === 'on' && gpu ? gpu.gpu : undefined
  };

  const localStorageStore = new Map();
  const localStorage = {
    getItem: k => (localStorageStore.has(String(k)) ? localStorageStore.get(String(k)) : null),
    setItem: (k, v) => {
      localStorageStore.set(String(k), String(v));
      rec.op('storage', 'set', hashSeed(String(k)), hashSeed(String(v)));
    },
    removeItem: k => {
      localStorageStore.delete(String(k));
      rec.op('storage', 'remove', hashSeed(String(k)), 0);
    },
    clear: () => {
      localStorageStore.clear();
      rec.op('storage', 'clear', 0, 0);
    },
    key: i => Array.from(localStorageStore.keys())[i] || null,
    get length() {
      return localStorageStore.size;
    }
  };

  const location = {
    href: 'https://localhost/index.html' + search,
    protocol: 'https:',
    host: 'localhost',
    hostname: 'localhost',
    port: '',
    pathname: '/index.html',
    search,
    hash: '',
    origin: 'https://localhost',
    reload() {
      rec.op('dom', 'location.reload', 0, 0);
    },
    assign(u) {
      rec.op('dom', 'location.assign', hashSeed(String(u)), 0);
    },
    replace(u) {
      rec.op('dom', 'location.replace', hashSeed(String(u)), 0);
    }
  };

  const consoleLog = [];
  const mkConsole =
    level =>
    (...args) => {
      const text = args.map(fmtArg).join(' ');
      consoleLog.push({ level, text, args });
      const h = new Hash(hashSeed('console:' + level));
      h.str(text);
      rec.op('console', level, h.a, h.b);
      if (o.echoConsole && level !== 'log') process.stderr.write('[' + level + '] ' + text + '\n');
    };
  function fmtArg(a) {
    if (a instanceof Error)
      return (
        a.name +
        ': ' +
        a.message +
        (a.stack ? '\n' + String(a.stack).split('\n').slice(1, 4).join('\n') : '')
      );
    if (typeof a === 'object' && a !== null) {
      try {
        return JSON.stringify(a);
      } catch (e) {
        return String(a);
      }
    }
    return String(a);
  }

  Object.assign(sandbox, {
    document: doc,
    navigator,
    localStorage,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    location,
    history: { length: 1, pushState() {}, replaceState() {}, back() {} },
    innerWidth: o.innerWidth || 1280,
    innerHeight: o.innerHeight || 800,
    outerWidth: o.innerWidth || 1280,
    outerHeight: o.innerHeight || 800,
    devicePixelRatio: 1,
    screen: {
      width: o.innerWidth || 1280,
      height: o.innerHeight || 800,
      availWidth: 1280,
      availHeight: 800
    },
    performance: {
      now: () => clock.now(),
      timeOrigin: 0,
      mark() {},
      measure() {},
      memory: { usedJSHeapSize: 1e8 }
    },
    setTimeout: (cb, ms, ...args) => clock.setTimeout(cb, ms, args),
    clearTimeout: id => clock.clearTimeout(id),
    setInterval: (cb, ms, ...args) => clock.setInterval(cb, ms, args),
    clearInterval: id => clock.clearInterval(id),
    setImmediate: (cb, ...args) => clock.setTimeout(cb, 0, args),
    requestAnimationFrame: cb => clock.requestAnimationFrame(cb),
    cancelAnimationFrame: id => clock.cancelAnimationFrame(id),
    queueMicrotask: cb => Promise.resolve().then(cb),
    console: {
      log: mkConsole('log'),
      info: mkConsole('info'),
      warn: mkConsole('warn'),
      error: mkConsole('error'),
      debug: mkConsole('debug'),
      trace: mkConsole('trace'),
      table: mkConsole('table'),
      group() {},
      groupEnd() {},
      time() {},
      timeEnd() {},
      assert: mkConsole('assert')
    },
    alert: m => rec.op('dom', 'alert', hashSeed(String(m)), 0),
    confirm: () => true,
    prompt: () => null,
    close() {
      rec.op('dom', 'window.close', 0, 0);
    },
    focus() {},
    blur() {},
    print() {},
    stop() {},
    open() {
      return null;
    },
    scroll() {},
    scrollTo() {},
    getComputedStyle: el => {
      const st = el && el.style ? el.style : {};
      return {
        getPropertyValue: n => (st[n] !== undefined ? String(st[n]) : ''),
        display: st.display || 'block',
        visibility: st.visibility || 'visible',
        opacity: st.opacity || '1',
        width: st.width || '0px',
        height: st.height || '0px'
      };
    },
    matchMedia: q => ({
      media: q,
      matches: false,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      }
    }),
    TextEncoder: require('util').TextEncoder,
    TextDecoder: require('util').TextDecoder,
    URL: require('url').URL,
    URLSearchParams: require('url').URLSearchParams,
    crypto: {
      getRandomValues(arr) {
        for (let i = 0; i < arr.length; i++) arr[i] = rndState() & 0xff;
        rec.op('crypto', 'getRandomValues', arr.length, 0);
        return arr;
      },
      randomUUID: () => '00000000-0000-4000-8000-000000000000'
    },
    AudioContext: audio.AudioContext,
    webkitAudioContext: audio.AudioContext,
    structuredClone: v => JSON.parse(JSON.stringify(v)),
    Image: class {
      constructor() {
        this.width = 0;
        this.height = 0;
        this.src = '';
      }
    },
    HTMLElement: El,
    Element: El,
    Node: El,
    Event: function (type, init) {
      return makeEvent(type, init);
    },
    CustomEvent: function (type, init) {
      return makeEvent(type, init);
    },
    KeyboardEvent: function (type, init) {
      return makeEvent(type, init);
    },
    MouseEvent: function (type, init) {
      return makeEvent(type, init);
    },
    ImageData: require('./canvas2d').ImageData,
    OffscreenCanvas: class {
      constructor(w, h) {
        this.width = w;
        this.height = h;
        this.__hashId = hashSeed('offscreen' + w + 'x' + h);
        this._ctx = {};
      }
      getContext(k) {
        if (!this._ctx[k]) this._ctx[k] = createCanvas2D(this, rec);
        return this._ctx[k];
      }
    },
    Math: (() => {
      const M = Object.create(Math);
      M.random = detRandom;
      return M;
    })(),
    Date: class extends Date {
      static now() {
        return Math.floor(clock.now());
      }
      constructor(...a) {
        if (a.length === 0) super(Math.floor(clock.now()));
        else super(...a);
      }
    },
    addEventListener: (type, fn) => El.prototype.addEventListener.call(sandbox, type, fn),
    removeEventListener: (type, fn) => El.prototype.removeEventListener.call(sandbox, type, fn),
    dispatchEvent: ev => dispatch(sandbox, ev)
  });

  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.parent = sandbox;
  sandbox.frames = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.closed = false;
  sandbox.listeners = {};

  if (gpu) Object.assign(sandbox, gpu.constants);

  doc.documentElement = null;

  return {
    sandbox,
    doc,
    clock,
    rec,
    audio,
    gpu,
    gpuMode,
    errors,
    consoleLog,
    localStorageStore,
    handlerErrors,
    /* включить WebGPU по ходу теста: ensureDevice() ещё не кэшировал отказ */
    enableGPU() {
      if (!gpu) throw new Error('WebGPU выключен в этом окружении');
      navigator.gpu = gpu.gpu;
      return gpu.gpu;
    },
    disableGPU() {
      navigator.gpu = undefined;
    },
    setHTML(html) {
      /* дерево строится заново: documentElement/head/body как в браузере */
      for (const n of doc.childNodes.slice()) doc.removeChild(n);
      const nodes = parseDocument(html, doc).childNodes.slice();
      let htmlEl = nodes.find(n => n.nodeType === 1 && n.localName === 'html');
      if (!htmlEl) {
        htmlEl = new El('html', doc);
        doc.appendChild(htmlEl);
        for (const n of nodes) htmlEl.appendChild(n);
      }
      doc.documentElement = htmlEl;
      doc.head =
        htmlEl.children.find(c => c.localName === 'head') ||
        htmlEl.appendChild(new El('head', doc));
      doc.body =
        htmlEl.children.find(c => c.localName === 'body') ||
        htmlEl.appendChild(new El('body', doc));
      doc.readyState = 'complete';
      const t = htmlEl.querySelector('title');
      doc.title = t ? t.textContent : '';
      return doc;
    },
    parseNodes: html => parseNodes(html, doc),
    /* события: клавиатура, мышь, resizing — то, чем управляют тесты */
    key(type, code, props) {
      const ev = makeEvent(
        type,
        Object.assign(
          {
            code,
            key: code,
            repeat: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            metaKey: false
          },
          props
        )
      );
      /* одна рассылка: dispatch всплывает по цепочке target → … → doc → window,
         повторный dispatch(doc) доставил бы событие оконным слушателям дважды */
      dispatch(doc.activeElement || doc.body || doc, ev);
      return ev;
    },
    mouse(type, props) {
      const ev = makeEvent(
        type,
        Object.assign(
          { clientX: 0, clientY: 0, movementX: 0, movementY: 0, button: 0, buttons: 0 },
          props
        )
      );
      dispatch(doc, ev);
      return ev;
    },
    event(target, type, props) {
      const ev = makeEvent(type, props);
      dispatch(target, ev);
      return ev;
    },
    yieldMicro
  };
}

module.exports = { createEnv };

'use strict';
/* Заглушка 2D-контекста: не рисует, а ЗАПИСЫВАЕТ последовательность операций
   в хэш. getImageData возвращает детерминированный шум, зависящий от всех
   предыдущих операций холста — любое изменение поведения кода меняет «пиксели». */

const { Hash, hashSeed, prng } = require('./hash');

const OPS = [
  'save',
  'restore',
  'scale',
  'rotate',
  'translate',
  'transform',
  'setTransform',
  'resetTransform',
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'bezierCurveTo',
  'quadraticCurveTo',
  'arc',
  'arcTo',
  'ellipse',
  'rect',
  'roundRect',
  'fill',
  'stroke',
  'clip',
  'fillRect',
  'strokeRect',
  'clearRect',
  'fillText',
  'strokeText',
  'setLineDash',
  'drawImage',
  'putImageData',
  'createLinearGradient',
  'createRadialGradient',
  'createConicGradient',
  'createPattern',
  'getImageData',
  'createImageData',
  'measureText',
  'isPointInPath',
  'style',
  'gradient',
  'reset'
];
const OP_ID = {};
OPS.forEach((n, i) => {
  OP_ID[n] = i + 1;
});

function argHash(h, a) {
  if (a === null || a === undefined) return h.u32(0);
  const t = typeof a;
  if (t === 'number') return h.f64(a);
  if (t === 'string') return h.str(a);
  if (t === 'boolean') return h.u32(a ? 1 : 2);
  if (a && a.__opHash) return h.u32(a.__opHash);
  if (a && a.data && a.width !== undefined) {
    h.u32(a.width);
    h.u32(a.height);
    return h.bytes(a.data, 97);
  }
  if (a && a.canvas) return h.u32(a.canvas.__hashId || 0);
  if (Array.isArray(a)) {
    h.u32(a.length);
    for (const x of a) argHash(h, x);
    return h;
  }
  return h.str(Object.prototype.toString.call(a));
}

class Gradient {
  constructor(rec, cvh, kind, args) {
    this.__stops = [];
    this.__kind = kind;
    const h = new Hash(hashSeed('grad'));
    h.u32(OP_ID[kind === 'linear' ? 'createLinearGradient' : 'createRadialGradient']);
    for (const a of args) argHash(h, a);
    this.__opHash = (h.a ^ Math.imul(h.b, 0x9e3779b9)) >>> 0;
    this._rec = rec;
    this._cvh = cvh;
    rec.op('gradient', kind, this.__opHash);
  }
  addColorStop(off, color) {
    this.__stops.push([off, color]);
    const h = new Hash(this.__opHash);
    h.f64(off);
    h.str(color);
    this.__opHash = (h.a ^ Math.imul(h.b, 0x2545f491)) >>> 0;
    this._rec.op('gradient', 'stop', this.__opHash);
    this._cvh.u32(this.__opHash);
  }
}

class ImageData {
  constructor(w, h, data) {
    this.width = Math.max(0, w | 0);
    this.height = Math.max(0, h | 0);
    this.data = data || new Uint8ClampedArray(this.width * this.height * 4);
  }
}

function createCanvas2D(canvas, rec) {
  const cvh = new Hash(
    hashSeed('canvas:' + (canvas.__hashId || 0) + ':' + canvas.width + 'x' + canvas.height)
  );
  let gradSeq = 0;

  const ctx = {
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    filter: 'none',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    lineDashOffset: 0,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    direction: 'inherit',
    letterSpacing: '0px',
    shadowBlur: 0,
    shadowColor: 'transparent',
    shadowOffsetX: 0,
    shadowOffsetY: 0
  };

  const note = (name, args) => {
    cvh.u32(OP_ID[name] || hashSeed(name));
    for (let i = 0; i < args.length; i++) argHash(cvh, args[i]);
    rec.op(name, cvh.a, cvh.b);
  };

  /* стиль-объект (градиент) тоже должен попадать в запись */
  const styleProps = [
    'fillStyle',
    'strokeStyle',
    'shadowColor',
    'font',
    'filter',
    'globalCompositeOperation'
  ];
  const raw = {};
  for (const p of styleProps) raw[p] = ctx[p];
  for (const p of styleProps) {
    Object.defineProperty(ctx, p, {
      get() {
        return raw[p];
      },
      set(v) {
        raw[p] = v;
        cvh.u32(hashSeed('set:' + p));
        if (v && v.__opHash) cvh.u32(v.__opHash);
        else if (typeof v === 'string') cvh.str(v);
        else cvh.str(String(v));
        rec.op('style', p, cvh.a, cvh.b);
      },
      enumerable: true,
      configurable: true
    });
  }
  for (const p of [
    'globalAlpha',
    'lineWidth',
    'lineCap',
    'lineJoin',
    'miterLimit',
    'lineDashOffset',
    'textAlign',
    'textBaseline',
    'shadowBlur',
    'shadowOffsetX',
    'shadowOffsetY',
    'imageSmoothingEnabled',
    'direction'
  ]) {
    let cur = ctx[p];
    Object.defineProperty(ctx, p, {
      get() {
        return cur;
      },
      set(v) {
        cur = v;
        cvh.u32(hashSeed('set:' + p));
        argHash(cvh, v);
        rec.op('style', p, cvh.a, cvh.b);
      },
      enumerable: true,
      configurable: true
    });
  }

  const simple = [
    'save',
    'restore',
    'scale',
    'rotate',
    'translate',
    'transform',
    'setTransform',
    'resetTransform',
    'beginPath',
    'closePath',
    'moveTo',
    'lineTo',
    'bezierCurveTo',
    'quadraticCurveTo',
    'arc',
    'arcTo',
    'ellipse',
    'rect',
    'roundRect',
    'fill',
    'stroke',
    'clip',
    'fillRect',
    'strokeRect',
    'clearRect',
    'fillText',
    'strokeText',
    'setLineDash',
    'drawImage',
    'putImageData',
    'reset'
  ];
  for (const name of simple) {
    ctx[name] = function () {
      note(name, arguments);
      if (name === 'reset') cvh.u32(0xdeadbeef);
      return undefined;
    };
  }

  ctx.createLinearGradient = function () {
    note('createLinearGradient', arguments);
    return new Gradient(rec, cvh, 'linear', Array.prototype.slice.call(arguments));
  };
  ctx.createRadialGradient = function () {
    note('createRadialGradient', arguments);
    return new Gradient(rec, cvh, 'radial', Array.prototype.slice.call(arguments));
  };
  ctx.createConicGradient = function () {
    note('createConicGradient', arguments);
    return new Gradient(rec, cvh, 'conic', Array.prototype.slice.call(arguments));
  };
  ctx.createPattern = function () {
    note('createPattern', arguments);
    gradSeq++;
    return { __opHash: hashSeed('pattern' + gradSeq), setTransform() {} };
  };

  ctx.createImageData = function (a, b) {
    if (a && a.width !== undefined) return new ImageData(a.width, a.height);
    return new ImageData(a || 1, b || 1);
  };

  /* «пиксели» — детерминированная функция от всей истории операций холста */
  ctx.getImageData = function (sx, sy, sw, sh) {
    note('getImageData', arguments);
    const w = Math.max(1, Math.round(sw) || 1),
      h = Math.max(1, Math.round(sh) || 1);
    const out = new Uint8ClampedArray(w * h * 4);
    const seed = hashSeed(cvh.digest() + '|' + sx + ',' + sy + ',' + w + ',' + h);
    const rnd = prng(seed);
    for (let i = 0; i < out.length; i++) out[i] = rnd() & 0xff;
    return new ImageData(w, h, out);
  };

  ctx.measureText = function (t) {
    note('measureText', arguments);
    const s = String(t);
    return {
      width: s.length * 6,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: s.length * 6,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 10,
      fontBoundingBoxDescent: 3
    };
  };

  ctx.isPointInPath = function () {
    return false;
  };
  ctx.getLineDash = function () {
    return [];
  };
  ctx.getContextAttributes = function () {
    return { willReadFrequently: true, alpha: true };
  };

  ctx.__hash = () => cvh.digest();
  ctx.__resetHash = function (tag) {
    cvh.u32(hashSeed('reset:' + (tag || '')));
  };
  return ctx;
}

module.exports = { createCanvas2D, ImageData, Gradient };

'use strict';
/* Детерминированный хэш для отпечатков поведения.
   Два 32-битных слова дают 16 hex-символов; чувствителен и к порядку, и к значениям. */

const F64 = new Float64Array(1);
const F64U = new Uint32Array(F64.buffer);

class Hash {
  constructor(seed) {
    this.a = (seed === undefined ? 0x811c9dc5 : seed) >>> 0;
    this.b = 0x9e3779b9 >>> 0;
    this.n = 0;
  }

  u32(v) {
    v = v >>> 0;
    this.a = Math.imul(this.a ^ v, 0x85ebca6b) >>> 0;
    this.a = ((this.a << 13) | (this.a >>> 19)) >>> 0;
    this.b = Math.imul(this.b + v + 0x9e3779b9, 0xc2b2ae35) >>> 0;
    this.b = ((this.b << 16) | (this.b >>> 16)) >>> 0;
    this.n++;
    return this;
  }

  /* точные биты IEEE-754: NaN/±Inf/-0 тоже различимы */
  f64(v) {
    if (typeof v !== 'number') return this.str(String(v));
    if (v !== v) return this.u32(0x7fc00001);
    F64[0] = v;
    return this.u32(F64U[0]).u32(F64U[1]);
  }

  str(s) {
    s = String(s);
    this.u32(s.length);
    for (let i = 0; i < s.length; i++) this.u32(s.charCodeAt(i));
    return this;
  }

  /* массив чисел: длина + элементы (типизированные и обычные) */
  nums(a) {
    if (!a) return this.u32(0);
    this.u32(a.length);
    for (let i = 0; i < a.length; i++) this.f64(a[i]);
    return this;
  }

  /* побайтовый массив; step>1 — прореживание для длинных буферов */
  bytes(a, step) {
    if (!a) return this.u32(0);
    const st = step || 1;
    this.u32(a.length);
    this.u32(st);
    for (let i = 0; i < a.length; i += st) this.u32(a[i]);
    return this;
  }

  tag(name) {
    return this.str('\u0001' + name);
  }

  digest() {
    const h = this.a.toString(16).padStart(8, '0') + this.b.toString(16).padStart(8, '0');
    return h;
  }

  clone() {
    const c = new Hash();
    c.a = this.a;
    c.b = this.b;
    c.n = this.n;
    return c;
  }
}

/* Хэш из строки — для стабильных сидов псевдослучайных данных в заглушках. */
function hashSeed(str) {
  const h = new Hash();
  h.str(str);
  return (h.a ^ Math.imul(h.b, 0x2545f491)) >>> 0;
}

/* xmur3-подобный ГПСЧ с состоянием: для детерминированных «пикселей» заглушек. */
function prng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s >>> 0;
  };
}

/* WGSL без оформления: видеокарта не смотрит ни на комментарии, ни на повторы
   пробелов, а сборка их вырезает — отпечаток сравнивает код шейдера, а не его
   оформление. Пробелы сворачиваются в один, но не исчезают: в WGSL пробел
   разделяет токены, и «var x» с «varx» должны оставаться разными. */
function wgslNorm(s) {
  return String(s)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');
}

module.exports = { Hash, hashSeed, prng, wgslNorm };

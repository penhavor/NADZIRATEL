'use strict';
/* Регистратор: один общий хэш + хэши отдельных «секций» отпечатка.
   Секции нужны, чтобы при расхождении сборки и оригинала было видно,
   на каком именно subsystem всё поехало. */

const { Hash, hashSeed } = require('./hash');

class Recorder {
  constructor(seed) {
    this.global = new Hash(hashSeed(seed || 'NADZIRATEL'));
    this.sections = {};
    this.order = [];
    this.cur = null;
    this.ops = 0;
  }

  u32(v) {
    this.global.u32(v);
    if (this.cur) this.cur.h.u32(v);
    this.ops++;
    return this;
  }
  f64(v) {
    this.global.f64(v);
    if (this.cur) this.cur.h.f64(v);
    this.ops++;
    return this;
  }
  str(s) {
    this.global.str(s);
    if (this.cur) this.cur.h.str(s);
    this.ops++;
    return this;
  }
  bytes(a, step) {
    this.global.bytes(a, step);
    if (this.cur) this.cur.h.bytes(a, step);
    this.ops++;
    return this;
  }
  nums(a) {
    this.global.nums(a);
    if (this.cur) this.cur.h.nums(a);
    this.ops++;
    return this;
  }

  /* смесь из разнотипных аргументов — для коротких записей операций */
  op(...args) {
    for (const a of args) {
      if (typeof a === 'number') this.f64(a);
      else if (typeof a === 'string') this.str(a);
      else if (a === undefined) this.u32(1);
      else if (a === null) this.u32(2);
      else if (typeof a === 'boolean') this.u32(a ? 3 : 4);
      else this.str(String(a));
    }
    return this;
  }

  begin(name) {
    if (this.cur) throw new Error('recorder: секция ' + this.cur.name + ' не закрыта');
    this.cur = { name, h: new Hash(hashSeed('section:' + name)) };
    return this;
  }

  end(name) {
    if (!this.cur) throw new Error('recorder: нет открытой секции');
    const s = this.cur;
    this.cur = null;
    const d = s.h.digest();
    this.sections[s.name] = d;
    this.order.push(s.name);
    this.global.str(s.name + '=' + d);
    return d;
  }

  section(name, fn) {
    this.begin(name);
    try {
      fn();
    } finally {
      this.end();
    }
    return this.sections[name];
  }

  async sectionAsync(name, fn) {
    this.begin(name);
    try {
      return await fn();
    } finally {
      this.end();
    }
  }

  digest() {
    return this.global.digest();
  }
  snapshot() {
    return Object.assign({}, this.sections);
  }
}

module.exports = { Recorder };

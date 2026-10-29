'use strict';
/* Виртуальные часы: performance.now / Date.now / setTimeout / requestAnimationFrame.
   Всё детерминировано и двигается только когда тест явно вызывает advance/drain. */

const FRAME = 1000 / 60;

class Clock {
  constructor(start) {
    this.t = start || 0;
    this.seq = 0;
    this.timers = [];
    this.rafs = [];
    this.steps = 0;
  }

  now() {
    return this.t;
  }

  setTimeout(cb, ms, args) {
    const id = ++this.seq;
    this.timers.push({
      id,
      at: this.t + Math.max(0, Number(ms) || 0),
      cb,
      args: args || [],
      kind: 'timeout'
    });
    return id;
  }

  setInterval(cb, ms, args) {
    const id = ++this.seq;
    this.timers.push({
      id,
      at: this.t + Math.max(0, Number(ms) || 0),
      cb,
      args: args || [],
      kind: 'interval',
      every: Math.max(1, Number(ms) || 1)
    });
    return id;
  }

  clearTimeout(id) {
    const i = this.timers.findIndex(x => x.id === id);
    if (i >= 0) this.timers.splice(i, 1);
  }
  clearInterval(id) {
    this.clearTimeout(id);
  }

  requestAnimationFrame(cb) {
    const id = ++this.seq;
    this.rafs.push({ id, at: this.t + FRAME, cb });
    return id;
  }

  cancelAnimationFrame(id) {
    const i = this.rafs.findIndex(x => x.id === id);
    if (i >= 0) this.rafs.splice(i, 1);
  }

  pending() {
    return this.timers.length + this.rafs.length;
  }

  /* ближайшая задача; rAF и таймеры в одной временной шкале */
  _next(limit) {
    let best = null,
      bestArr = null;
    for (const it of this.timers)
      if (it.at <= limit && (!best || it.at < best.at || (it.at === best.at && it.id < best.id))) {
        best = it;
        bestArr = this.timers;
      }
    for (const it of this.rafs)
      if (it.at <= limit && (!best || it.at < best.at || (it.at === best.at && it.id < best.id))) {
        best = it;
        bestArr = this.rafs;
      }
    return best ? { item: best, arr: bestArr } : null;
  }

  /* один шаг: выполнить ближайшую задачу и дать микротаскам отработать */
  async step(target) {
    const limit = target === undefined ? Infinity : target;
    const nx = this._next(limit);
    if (!nx) return false;
    const { item, arr } = nx;
    arr.splice(arr.indexOf(item), 1);
    if (this.t < item.at) this.t = item.at;
    if (item.kind === 'interval') ((item.at = this.t + item.every), arr.push(item));
    this.steps++;
    try {
      if (arr === this.rafs) item.cb(this.t);
      else item.cb.apply(null, item.args);
    } catch (e) {
      this.errors = this.errors || [];
      this.errors.push(e);
    }
    await yieldMicro();
    return true;
  }

  /* двигать время, пока есть задачи не позже t+ms */
  async advance(ms, maxSteps) {
    const target = this.t + (ms || 0);
    let guard = maxSteps || 100000;
    while (guard-- > 0) {
      if (!(await this.step(target))) break;
    }
    return this;
  }

  /* выполнить всё, что уже запланировано (без роста времени дальше текущего) */
  async drain(maxSteps) {
    let guard = maxSteps || 100000;
    while (guard-- > 0) {
      if (!(await this.step(this.t))) break;
    }
    return this;
  }

  /* полное «проигрывание» времени: задачи + новые, появившиеся по ходу */
  async run(ms, maxSteps) {
    const target = this.t + ms;
    let guard = maxSteps || 200000;
    while (guard-- > 0) {
      const nx = this._next(target);
      if (!nx) break;
      if (!(await this.step(target))) break;
    }
    this.t = Math.max(this.t, target);
    return this;
  }
}

/* полностью слить очередь микротасок (в т.ч. из VM-контекста) */
function yieldMicro() {
  return new Promise(resolve => setImmediate(resolve));
}

module.exports = { Clock, yieldMicro, FRAME };

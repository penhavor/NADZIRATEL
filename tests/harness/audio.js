'use strict';
/* Заглушка WebAudio: узлы и параметры не звучат, но каждая операция
   (создание, connect, автоматизация параметра, start/stop) пишется в хэш.
   Буферы — настоящие Float32Array, поэтому процедурная генерация звука и
   музыки считается по-честному и её результат можно сверять. */

const { Hash, hashSeed } = require('./hash');

function createAudioEnv(rec, clock, opts) {
  const o = opts || {};
  const sampleRate = o.sampleRate || 44100;
  const env = { buffers: [], nodes: 0, params: 0 };
  let nodeId = 0;

  const note = (id, name, a, b) => rec.op('audio', id, hashSeed(name), a, b);

  function param(node, name, value, extra) {
    const p = {
      _v: value === undefined ? 0 : value,
      defaultValue: value === undefined ? 0 : value,
      minValue: extra && extra.min !== undefined ? extra.min : -3.4028235e38,
      maxValue: extra && extra.max !== undefined ? extra.max : 3.4028235e38,
      automation: [],
      get value() {
        return p._v;
      },
      set value(v) {
        p._v = v;
        env.params++;
        note(node.__id, name + '=value', num(v), 0);
      },
      setValueAtTime(v, t) {
        p._v = v;
        p.automation.push(['set', v, t]);
        note(node.__id, name + '.set', num(v), num(t));
        return p;
      },
      linearRampToValueAtTime(v, t) {
        p._v = v;
        p.automation.push(['lin', v, t]);
        note(node.__id, name + '.lin', num(v), num(t));
        return p;
      },
      exponentialRampToValueAtTime(v, t) {
        p._v = v;
        p.automation.push(['exp', v, t]);
        note(node.__id, name + '.exp', num(v), num(t));
        return p;
      },
      setTargetAtTime(v, t, tc) {
        p._v = v;
        p.automation.push(['tgt', v, t, tc]);
        note(node.__id, name + '.tgt', num(v), num(t) ^ num(tc));
        return p;
      },
      cancelScheduledValues(t) {
        note(node.__id, name + '.cancel', num(t), 0);
        return p;
      },
      cancelAndHoldAtTime(t) {
        note(node.__id, name + '.hold', num(t), 0);
        return p;
      },
      setValueCurveAtTime(curve, t, dur) {
        note(node.__id, name + '.curve', curve ? curve.length : 0, num(t) ^ num(dur));
        if (curve && curve.length) p._v = curve[curve.length - 1];
        return p;
      }
    };
    return p;
  }

  function num(v) {
    if (typeof v !== 'number' || !isFinite(v)) return hashSeed(String(v));
    const h = new Hash(1);
    h.f64(v);
    return (h.a ^ h.b) >>> 0;
  }

  function node(kind) {
    const n = {
      __id: ++nodeId,
      __kind: kind,
      context: ctx,
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: 'max',
      channelInterpretation: 'speakers',
      onended: null,
      connect(dest) {
        note(
          n.__id,
          'connect',
          dest && dest.__id ? dest.__id : hashSeed(String(dest && dest.__kind)),
          0
        );
        return dest && dest.__id ? dest : undefined;
      },
      disconnect() {
        note(n.__id, 'disconnect', 0, 0);
      }
    };
    env.nodes++;
    note(n.__id, 'create:' + kind, 0, 0);
    return n;
  }

  function srcNode(n) {
    n.start = function (t, off, dur) {
      n.__started = t === undefined ? clock.now() / 1000 : t;
      note(n.__id, 'start', num(n.__started), num(off) ^ num(dur));
    };
    n.stop = function (t) {
      note(n.__id, 'stop', num(t), 0);
    };
    return n;
  }

  const ctx = {
    sampleRate,
    get currentTime() {
      return clock.now() / 1000;
    },
    state: 'running',
    baseLatency: 0.01,
    outputLatency: 0,
    listener: {
      positionX: param({ __id: 0 }, 'lx', 0),
      positionY: param({ __id: 0 }, 'ly', 0),
      positionZ: param({ __id: 0 }, 'lz', 0),
      forwardX: param({ __id: 0 }, 'fx', 0),
      forwardY: param({ __id: 0 }, 'fy', 0),
      forwardZ: param({ __id: 0 }, 'fz', -1),
      upX: param({ __id: 0 }, 'ux', 0),
      upY: param({ __id: 0 }, 'uy', 1),
      upZ: param({ __id: 0 }, 'uz', 0),
      setPosition() {},
      setOrientation() {}
    },
    resume() {
      ctx.state = 'running';
      note(0, 'resume', 0, 0);
      return Promise.resolve();
    },
    suspend() {
      ctx.state = 'suspended';
      return Promise.resolve();
    },
    close() {
      ctx.state = 'closed';
      return Promise.resolve();
    },

    createGain() {
      const n = node('gain');
      n.gain = param(n, 'gain', 1);
      return n;
    },
    createOscillator() {
      const n = srcNode(node('osc'));
      n.type = 'sine';
      n.frequency = param(n, 'frequency', 440);
      n.detune = param(n, 'detune', 0);
      n.setPeriodicWave = function (w) {
        note(n.__id, 'setPeriodicWave', w && w.__id ? w.__id : 0, 0);
      };
      return n;
    },
    createBiquadFilter() {
      const n = node('biquad');
      n.type = 'lowpass';
      n.frequency = param(n, 'frequency', 350);
      n.Q = param(n, 'Q', 1);
      n.gain = param(n, 'gain', 0);
      n.detune = param(n, 'detune', 0);
      n.getFrequencyResponse = function (f, mag, phase) {
        for (let i = 0; i < f.length; i++) {
          if (mag) mag[i] = 1;
          if (phase) phase[i] = 0;
        }
      };
      return n;
    },
    createStereoPanner() {
      const n = node('panner2');
      n.pan = param(n, 'pan', 0);
      return n;
    },
    createPanner() {
      const n = node('panner3');
      n.panningModel = 'equalpower';
      n.distanceModel = 'inverse';
      n.refDistance = 1;
      n.maxDistance = 10000;
      n.rolloffFactor = 1;
      n.coneInnerAngle = 360;
      n.coneOuterAngle = 0;
      n.coneOuterGain = 0;
      n.positionX = param(n, 'positionX', 0);
      n.positionY = param(n, 'positionY', 0);
      n.positionZ = param(n, 'positionZ', 0);
      n.orientationX = param(n, 'orientationX', 1);
      n.orientationY = param(n, 'orientationY', 0);
      n.orientationZ = param(n, 'orientationZ', 0);
      n.setPosition = function () {};
      n.setOrientation = function () {};
      return n;
    },
    createDelay(max) {
      const n = node('delay');
      n.delayTime = param(n, 'delayTime', 0);
      n.__max = max || 1;
      return n;
    },
    createConvolver() {
      const n = node('convolver');
      n.normalize = true;
      let buf = null;
      Object.defineProperty(n, 'buffer', {
        get() {
          return buf;
        },
        set(v) {
          buf = v;
          note(n.__id, 'convolver.buffer', v ? v.__id : 0, v ? v.length : 0);
        }
      });
      return n;
    },
    createWaveShaper() {
      const n = node('shaper');
      n.oversample = 'none';
      let curve = null;
      Object.defineProperty(n, 'curve', {
        get() {
          return curve;
        },
        set(v) {
          curve = v;
          const h = new Hash(n.__id);
          if (v) h.bytes(v, 13);
          note(n.__id, 'shaper.curve', h.a, h.b);
        }
      });
      return n;
    },
    createDynamicsCompressor() {
      const n = node('comp');
      n.threshold = param(n, 'threshold', -24);
      n.knee = param(n, 'knee', 30);
      n.ratio = param(n, 'ratio', 12);
      n.attack = param(n, 'attack', 0.003);
      n.release = param(n, 'release', 0.25);
      n.reduction = 0;
      return n;
    },
    createAnalyser() {
      const n = node('analyser');
      n.fftSize = 2048;
      n.frequencyBinCount = 1024;
      n.minDecibels = -100;
      n.maxDecibels = -30;
      n.smoothingTimeConstant = 0.8;
      n.getByteFrequencyData = function (a) {
        a.fill(0);
      };
      n.getFloatFrequencyData = function (a) {
        a.fill(-100);
      };
      n.getByteTimeDomainData = function (a) {
        a.fill(128);
      };
      return n;
    },
    createConstantSource() {
      const n = srcNode(node('const'));
      n.offset = param(n, 'offset', 1);
      return n;
    },
    createChannelMerger(nch) {
      const n = node('merger');
      n.numberOfInputs = nch || 6;
      return n;
    },
    createChannelSplitter(nch) {
      const n = node('splitter');
      n.numberOfOutputs = nch || 6;
      return n;
    },
    createPeriodicWave(real, imag) {
      const w = { __id: ++nodeId, __kind: 'wave' };
      const h = new Hash(w.__id);
      if (real) h.bytes(real, 1);
      if (imag) h.bytes(imag, 1);
      note(w.__id, 'wave', h.a, h.b);
      return w;
    },
    createBufferSource() {
      const n = srcNode(node('bufsrc'));
      n.loop = false;
      n.loopStart = 0;
      n.loopEnd = 0;
      n.playbackRate = param(n, 'playbackRate', 1);
      n.detune = param(n, 'detune', 0);
      let buf = null;
      Object.defineProperty(n, 'buffer', {
        get() {
          return buf;
        },
        set(v) {
          buf = v;
          note(n.__id, 'bufsrc.buffer', v ? v.__id : 0, v ? v.length : 0);
        }
      });
      return n;
    },
    createBuffer(ch, len, sr) {
      const channels = Math.max(1, ch | 0);
      const length = Math.max(1, len | 0);
      const data = [];
      for (let c = 0; c < channels; c++) data.push(new Float32Array(length));
      const b = {
        __id: ++nodeId,
        __kind: 'buffer',
        numberOfChannels: channels,
        length,
        sampleRate: sr || sampleRate,
        duration: length / (sr || sampleRate),
        getChannelData(c) {
          return data[c] || (data[c] = new Float32Array(length));
        },
        copyFromChannel(dst, c, start) {
          const s = data[c] || new Float32Array(length);
          dst.set(s.subarray(start || 0, (start || 0) + dst.length));
        },
        copyToChannel(src, c, start) {
          const d = data[c] || (data[c] = new Float32Array(length));
          d.set(src.subarray(0, Math.min(src.length, length - (start || 0))), start || 0);
        }
      };
      env.buffers.push(b);
      note(b.__id, 'createBuffer', channels, length);
      return b;
    }
  };
  ctx.destination = node('destination');

  function AudioContext() {
    return ctx;
  }
  AudioContext.prototype = {};

  env.ctx = ctx;
  env.AudioContext = AudioContext;

  /* отпечаток всех сгенерированных аудиобуферов */
  env.hashBuffers = function (h, step) {
    h.u32(env.buffers.length);
    for (const b of env.buffers) {
      h.u32(b.__id);
      h.u32(b.numberOfChannels);
      h.u32(b.length);
      for (let c = 0; c < b.numberOfChannels; c++) h.bytes(b.getChannelData(c), step || 7);
    }
    return h;
  };

  return env;
}

module.exports = { createAudioEnv };

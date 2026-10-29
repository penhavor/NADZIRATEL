'use strict';
/* Подставной WebGPU: устройство и очереди ничего не рисуют, но фиксируют в хэше
   всю последовательность вызовов — источники шейдеров, записи в буферы
   (юниформы, вершины), текстуры, диспатчи и отрисовки. Это самый чувствительный
   отпечаток рендерера без настоящей видеокарты. */

const { Hash, hashSeed, wgslNorm } = require('./hash');

const GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
const GPUBufferUsage = {
  MAP_READ: 1,
  MAP_WRITE: 2,
  COPY_SRC: 4,
  COPY_DST: 8,
  INDEX: 16,
  VERTEX: 32,
  UNIFORM: 64,
  STORAGE: 128,
  INDIRECT: 256,
  QUERY_RESOLVE: 512
};
const GPUTextureUsage = {
  COPY_SRC: 1,
  COPY_DST: 2,
  TEXTURE_BINDING: 4,
  STORAGE_BINDING: 8,
  RENDER_ATTACHMENT: 16
};
const GPUMapMode = { READ: 1, WRITE: 2 };
const GPUColorWrite = { RED: 1, GREEN: 2, BLUE: 4, ALPHA: 8, ALL: 15 };
const GPUErrorFilter = {
  VALIDATION: 'validation',
  OUT_OF_MEMORY: 'out-of-memory',
  INTERNAL: 'internal'
};

/* большой буфер целиком не хэшируем: длина + голова/хвост + равномерная выборка */
function hashData(h, data, dataOffset, size) {
  let arr = data;
  if (arr instanceof ArrayBuffer) arr = new Uint8Array(arr);
  if (!arr) return h.u32(0);
  const bpe = arr.BYTES_PER_ELEMENT || 1;
  const off = dataOffset || 0;
  const total = arr.length - off;
  const len = size === undefined ? total : typeof size === 'number' ? size : total;
  const n = Math.max(0, Math.min(total, len));
  h.u32(arr.length);
  h.u32(off);
  h.u32(n);
  h.u32(bpe);
  if (n === 0) return h;
  const head = Math.min(32, n),
    tail = Math.min(32, Math.max(0, n - head));
  for (let i = 0; i < head; i++) h.f64(arr[off + i]);
  for (let i = 0; i < tail; i++) h.f64(arr[off + n - tail + i]);
  const samples = Math.min(1024, n);
  const stride = Math.max(1, Math.floor(n / samples));
  for (let i = 0; i < n; i += stride) h.f64(arr[off + i]);
  return h;
}

/* описание объекта (дескриптор пайплайна и т.п.) — в стабильную строку */
function shape(v, depth) {
  const d = depth === undefined ? 0 : depth;
  if (d > 6) return '…';
  if (v === null) return 'null';
  if (v === undefined) return 'undef';
  const t = typeof v;
  if (t === 'number' || t === 'boolean' || t === 'string') return t[0] + ':' + v;
  if (t === 'function') return 'fn';
  if (Array.isArray(v)) return '[' + v.map(x => shape(x, d + 1)).join(',') + ']';
  if (v.__id !== undefined) return '#' + v.__id + (v.__kind ? '(' + v.__kind + ')' : '');
  if (ArrayBuffer.isView(v)) return 'view' + v.length;
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => k + '=' + shape(v[k], d + 1)).join(',') + '}';
}

function createGPU(rec, opts) {
  const o = opts || {};
  let idSeq = 0;
  const stats = {
    modules: 0,
    buffers: 0,
    textures: 0,
    pipelines: 0,
    draws: 0,
    dispatches: 0,
    writes: 0,
    passes: 0
  };

  const note = (name, a, b) =>
    rec.op('gpu', hashSeed(name), a === undefined ? 0 : a, b === undefined ? 0 : b);
  const noteDesc = (name, desc) => {
    const h = new Hash(hashSeed(name));
    h.str(shape(desc));
    note(name, h.a, h.b);
    return h;
  };

  const mk = (kind, extra) =>
    Object.assign(
      {
        __id: ++idSeq,
        __kind: kind,
        destroy() {
          note('destroy', this.__id, 0);
        },
        label: null
      },
      extra || {}
    );

  function view(tex, desc) {
    const v = mk('view');
    v.texture = tex;
    noteDesc('createView', Object.assign({ __tex: tex.__id }, desc || {}));
    return v;
  }

  function texture(desc) {
    const size = desc.size || {};
    const t = mk('texture', {
      width: size.width || 1,
      height: size.height || 1,
      depthOrArrayLayers: size.depthOrArrayLayers || 1,
      format: desc.format || 'rgba8unorm',
      usage: desc.usage || 0,
      mipLevelCount: desc.mipLevelCount || 1,
      sampleCount: desc.sampleCount || 1,
      dimension: desc.dimension || '2d'
    });
    t.createView = d => view(t, d);
    stats.textures++;
    noteDesc('createTexture', desc);
    return t;
  }

  function buffer(desc) {
    const size = Math.max(4, desc.size || 4);
    const b = mk('buffer', {
      size,
      usage: desc.usage || 0,
      mapState: 'unmapped',
      _data: new ArrayBuffer(size),
      getMappedRange(off, sz) {
        const s = off || 0,
          n = sz === undefined ? size - s : sz;
        note('getMappedRange', b.__id, n);
        return b._data.slice(s, s + n);
      },
      unmap() {
        b.mapState = 'unmapped';
        note('unmap', b.__id, 0);
      },
      mapAsync() {
        b.mapState = 'mapped';
        return Promise.resolve();
      }
    });
    stats.buffers++;
    noteDesc('createBuffer', desc);
    return b;
  }

  function pipeline(kind, desc) {
    const p = mk(kind, { getBindGroupLayout: i => mk('bgl-auto:' + i) });
    stats.pipelines++;
    noteDesc(kind, desc);
    return p;
  }

  const passProto = {
    setPipeline(p) {
      note('setPipeline', p && p.__id, 0);
    },
    setBindGroup(i, bg, offs) {
      note('setBindGroup', (i << 20) ^ (bg && bg.__id ? bg.__id : 0), offs ? offs.length : 0);
      if (offs) for (const v of offs) note('dynOffset', v, 0);
    },
    setVertexBuffer(slot, buf, off, size) {
      note(
        'setVertexBuffer',
        (slot << 20) ^ (buf && buf.__id ? buf.__id : 0),
        (off || 0) ^ (size || 0)
      );
    },
    setIndexBuffer(buf, fmt, off, size) {
      note(
        'setIndexBuffer',
        buf && buf.__id ? buf.__id : 0,
        hashSeed(String(fmt)) ^ (off || 0) ^ (size || 0)
      );
    },
    setViewport(x, y, w, h, mn, mx) {
      const hh = new Hash(7);
      hh.f64(x);
      hh.f64(y);
      hh.f64(w);
      hh.f64(h);
      hh.f64(mn);
      hh.f64(mx);
      note('setViewport', hh.a, hh.b);
    },
    setScissorRect(x, y, w, h) {
      const hh = new Hash(8);
      hh.f64(x);
      hh.f64(y);
      hh.f64(w);
      hh.f64(h);
      note('setScissorRect', hh.a, hh.b);
    },
    setBlendConstant(c) {
      note('setBlendConstant', hashSeed(shape(c)), 0);
    },
    setStencilReference(v) {
      note('setStencilReference', num(v), 0);
    },
    draw(count, inst, first, firstInst) {
      stats.draws++;
      const hh = new Hash(9);
      hh.u32(count);
      hh.u32(inst);
      hh.u32(first);
      hh.u32(firstInst);
      note('draw', hh.a, hh.b);
    },
    drawIndexed(count, inst, first, base, firstInst) {
      stats.draws++;
      const hh = new Hash(10);
      hh.u32(count);
      hh.u32(inst);
      hh.u32(first);
      hh.u32(base);
      hh.u32(firstInst);
      note('drawIndexed', hh.a, hh.b);
    },
    dispatchWorkgroups(x, y, z) {
      stats.dispatches++;
      const hh = new Hash(11);
      hh.u32(x);
      hh.u32(y);
      hh.u32(z);
      note('dispatchWorkgroups', hh.a, hh.b);
    },
    pushDebugGroup(s) {
      note('pushDebugGroup', hashSeed(String(s)), 0);
    },
    popDebugGroup() {
      note('popDebugGroup', 0, 0);
    },
    insertDebugMarker(s) {
      note('insertDebugMarker', hashSeed(String(s)), 0);
    },
    end() {
      note('pass.end', this.__id, 0);
    }
  };
  function num(v) {
    const h = new Hash(3);
    h.f64(v);
    return (h.a ^ h.b) >>> 0;
  }

  const queue = {
    writeBuffer(buf, offset, data, dataOffset, size) {
      stats.writes++;
      const h = new Hash(hashSeed('writeBuffer'));
      h.u32(buf && buf.__id ? buf.__id : 0);
      h.u32(offset || 0);
      hashData(h, data, dataOffset, size);
      note('writeBuffer', h.a, h.b);
    },
    writeTexture(dest, data, layout, size) {
      stats.writes++;
      const h = new Hash(hashSeed('writeTexture'));
      h.u32(dest && dest.texture && dest.texture.__id ? dest.texture.__id : 0);
      h.u32(dest && dest.mipLevel ? dest.mipLevel : 0);
      h.str(shape(layout));
      h.str(shape(size));
      hashData(h, data, 0, undefined);
      note('writeTexture', h.a, h.b);
    },
    copyBufferToBuffer(s, so, d, doff, size) {
      const h = new Hash(hashSeed('copyBufferToBuffer'));
      h.u32(s.__id);
      h.u32(so);
      h.u32(d.__id);
      h.u32(doff);
      h.u32(size);
      note('copyBufferToBuffer', h.a, h.b);
    },
    copyExternalImageToTexture(src, dst, size) {
      note(
        'copyExternalImageToTexture',
        hashSeed(shape(src)),
        hashSeed(shape(dst)) ^ hashSeed(shape(size))
      );
    },
    submit(cmds) {
      note('submit', cmds ? cmds.length : 0, 0);
      return Promise.resolve();
    },
    onSubmittedWorkDone() {
      return Promise.resolve();
    }
  };

  const limits = {
    maxTextureDimension1D: 8192,
    maxTextureDimension2D: 16384,
    maxTextureDimension3D: 2048,
    maxTextureArrayLayers: 256,
    maxBindGroups: 4,
    maxBindGroupsPlusVertexBuffers: 24,
    maxBindingsPerBindGroup: 1000,
    maxDynamicUniformBuffersPerPipelineLayout: 8,
    maxDynamicStorageBuffersPerPipelineLayout: 4,
    maxSampledTexturesPerShaderStage: 16,
    maxSamplersPerShaderStage: 16,
    maxStorageBuffersPerShaderStage: 8,
    maxStorageTexturesPerShaderStage: 4,
    maxUniformBuffersPerShaderStage: 12,
    maxUniformBufferBindingSize: 65536,
    maxStorageBufferBindingSize: 134217728,
    maxBufferSize: 268435456,
    maxVertexAttributes: 16,
    maxVertexBufferArrayStride: 2048,
    maxInterStageShaderComponents: 60,
    maxComputeWorkgroupSizeX: 256,
    maxComputeWorkgroupSizeY: 256,
    maxComputeWorkgroupSizeZ: 64,
    maxComputeInvocationsPerWorkgroup: 256,
    maxComputeWorkgroupsPerDimension: 65535,
    maxColorAttachments: 8
  };
  const features = {
    has: f => !!(o.features && o.features.indexOf(f) >= 0),
    keys: function* () {
      for (const f of o.features || []) yield f;
    },
    entries: function* () {
      for (const f of o.features || []) yield [f, true];
    },
    size: (o.features || []).length
  };

  const device = mk('device', {
    queue,
    limits,
    features,
    lost: new Promise(() => {}),
    createShaderModule(desc) {
      const m = mk('module');
      stats.modules++;
      /* источник шейдера сравнивается без оформления: сборка вырезает из WGSL
         комментарии и лишние пробелы, на поведение GPU это не влияет */
      const code = desc && desc.code ? wgslNorm(desc.code) : null;
      const h = new Hash(hashSeed('module'));
      h.str(code === null ? String(desc) : code);
      m.__codeHash = h.digest();
      m.__codeLength = code === null ? 0 : code.length;
      note('createShaderModule', h.a, h.b);
      m.getCompilationInfo = () => Promise.resolve({ messages: [] });
      return m;
    },
    createBindGroupLayout(desc) {
      const l = mk('bgl');
      noteDesc('createBindGroupLayout', desc);
      return l;
    },
    createPipelineLayout(desc) {
      const l = mk('pl');
      noteDesc('createPipelineLayout', desc);
      return l;
    },
    createBindGroup(desc) {
      const g = mk('bg');
      noteDesc('createBindGroup', desc);
      return g;
    },
    createBuffer: buffer,
    createTexture: texture,
    createSampler(desc) {
      const s = mk('sampler');
      noteDesc('createSampler', desc);
      return s;
    },
    createComputePipeline(desc) {
      return pipeline('computePipeline', desc);
    },
    createComputePipelineAsync(desc) {
      return Promise.resolve(pipeline('computePipeline', desc));
    },
    createRenderPipeline(desc) {
      return pipeline('renderPipeline', desc);
    },
    createRenderPipelineAsync(desc) {
      return Promise.resolve(pipeline('renderPipeline', desc));
    },
    createCommandEncoder(desc) {
      const enc = mk('encoder');
      noteDesc('createCommandEncoder', desc || {});
      const makePass = (kind, d) => {
        const p = Object.create(passProto);
        p.__id = ++idSeq;
        p.__kind = kind;
        stats.passes++;
        noteDesc(kind, d);
        return p;
      };
      enc.beginComputePass = d => makePass('computePass', d || {});
      enc.beginRenderPass = d => makePass('renderPass', d || {});
      enc.copyBufferToBuffer = queue.copyBufferToBuffer;
      enc.copyBufferToTexture = (s, t, sz) =>
        note('copyBufferToTexture', hashSeed(shape(s)), hashSeed(shape(t)) ^ hashSeed(shape(sz)));
      enc.copyTextureToBuffer = (s, t, sz) =>
        note('copyTextureToBuffer', hashSeed(shape(s)), hashSeed(shape(t)) ^ hashSeed(shape(sz)));
      enc.clearBuffer = (b, off, size) => note('clearBuffer', b.__id, (off || 0) ^ (size || 0));
      enc.resolveQuerySet = () => note('resolveQuerySet', 0, 0);
      enc.pushDebugGroup = s => note('pushDebugGroup', hashSeed(String(s)), 0);
      enc.popDebugGroup = () => note('popDebugGroup', 0, 0);
      enc.insertDebugMarker = s => note('insertDebugMarker', hashSeed(String(s)), 0);
      enc.writeTimestamp = () => note('writeTimestamp', 0, 0);
      enc.finish = () => {
        const c = mk('commandBuffer');
        note('finish', enc.__id, 0);
        return c;
      };
      return enc;
    },
    createQuerySet(desc) {
      return mk('querySet');
    },
    pushErrorScope() {},
    popErrorScope() {
      return Promise.resolve(null);
    },
    setLabel() {},
    requestAdapterInfo() {
      return Promise.resolve(adapter.info);
    }
  });

  const adapter = {
    __kind: 'adapter',
    features,
    limits,
    info: { vendor: 'test', architecture: 'headless', device: '0', description: 'fake' },
    isFallbackAdapter: false,
    requestDevice(desc) {
      noteDesc('requestDevice', desc || {});
      return Promise.resolve(device);
    },
    requestAdapterInfo() {
      return Promise.resolve(adapter.info);
    }
  };

  const gpu = {
    requestAdapter() {
      note('requestAdapter', 0, 0);
      return Promise.resolve(o.noAdapter ? null : adapter);
    },
    requestAdapterInfo() {
      return Promise.resolve(adapter.info);
    },
    getPreferredCanvasFormat() {
      return 'bgra8unorm';
    }
  };

  function contextWebGPU(canvas) {
    const c = mk('gpuctx');
    let current = null;
    c.canvas = canvas;
    c.configure = desc => {
      noteDesc(
        'configure',
        Object.assign({ __device: desc && desc.device ? desc.device.__id : 0 }, desc || {})
      );
    };
    c.unconfigure = () => note('unconfigure', 0, 0);
    c.getConfiguration = () => ({ format: 'bgra8unorm', alphaMode: 'opaque', device });
    c.getPreferredFormat = () => 'bgra8unorm';
    c.getCurrentTexture = () => {
      note('getCurrentTexture', 0, 0);
      if (!current)
        current = texture({
          size: { width: canvas.width || 1, height: canvas.height || 1, depthOrArrayLayers: 1 },
          format: 'bgra8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
      return current;
    };
    return c;
  }

  return {
    gpu,
    device,
    adapter,
    stats,
    contextWebGPU,
    constants: {
      GPUShaderStage,
      GPUBufferUsage,
      GPUTextureUsage,
      GPUMapMode,
      GPUColorWrite,
      GPUErrorFilter
    }
  };
}

module.exports = { createGPU, hashData, shape };

/* ---- конвейеры ---- */
function modOf(src) {
  let m = MODS.get(src);
  if (!m) {
    m = dev.createShaderModule({ code: src });
    MODS.set(src, m);
  }
  return m;
}
function plOf(key, desc) {
  let p = PLS.get(key);
  if (!p) {
    p = dev.createRenderPipeline(desc);
    PLS.set(key, p);
  }
  return p;
}
function plOfC(key, desc) {
  let p = PLS.get(key);
  if (!p) {
    p = dev.createComputePipeline(desc);
    PLS.set(key, p);
  }
  return p;
}
function layoutOf(bglArr) {
  return dev.createPipelineLayout({ bindGroupLayouts: bglArr });
}

const VBL_WORLD = [
  {
    arrayStride: 36,
    stepMode: 'vertex',
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x2' },
      { shaderLocation: 2, offset: 20, format: 'float32x3' },
      { shaderLocation: 3, offset: 32, format: 'float32' }
    ]
  }
];
const VBL_POST = [
  {
    arrayStride: 8,
    stepMode: 'vertex',
    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
  }
];
const VBL_GLOW = [
  {
    arrayStride: 8,
    stepMode: 'vertex',
    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
  },
  {
    arrayStride: 32,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 1, offset: 0, format: 'float32x3' },
      { shaderLocation: 2, offset: 12, format: 'float32' },
      { shaderLocation: 3, offset: 16, format: 'float32x3' }
    ]
  }
];

function worldLayout() {
  return layoutOf([BGLS.w0, BGLS.w1, BGLS.w2]);
}
function plWorld(frontFace, cullMode, samples, fmt) {
  const key = 'W|' + frontFace + '|' + cullMode + '|' + samples + '|' + fmt + '|' + GPU.qlevel;
  return plOf(key, {
    layout: worldLayout(),
    vertex: { module: modWorld, entryPoint: 'vsWorld', buffers: VBL_WORLD },
    fragment: { module: modWorld, entryPoint: 'fsWorld', targets: [{ format: fmt }] },
    primitive: { topology: 'triangle-list', frontFace: frontFace, cullMode: cullMode },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    multisample: { count: samples }
  });
}
function plPost(key, src, entry, bgl, fmt, blend, samples) {
  return plOf(key + '|' + fmt + '|' + (blend ? 1 : 0) + '|' + (samples || 1), {
    layout: layoutOf([BGLS.pp, bgl]),
    vertex: { module: modOf(src), entryPoint: 'vsFull', buffers: VBL_POST },
    fragment: {
      module: modOf(src),
      entryPoint: entry,
      targets: [blend ? { format: fmt, blend: blend } : { format: fmt }]
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: samples || 1 }
  });
}
const BL_ADD = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
};

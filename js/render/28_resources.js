/* ---- ресурсы ---- */
const VISVF = () => GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
function mkT(w, h, fmt, usage, mips, samples) {
  return dev.createTexture({
    size: { width: w, height: h, depthOrArrayLayers: 1 },
    format: fmt,
    usage: usage,
    mipLevelCount: mips || 1,
    sampleCount: samples || 1,
    dimension: '2d'
  });
}
function mipCount(w, h) {
  return Math.floor(Math.log2(Math.max(w, h))) + 1;
}
function uploadMips(tex, data, w, h, ch) {
  let cw = w,
    chh = h,
    src = data;
  for (let lv = 0; ; lv++) {
    dev.queue.writeTexture(
      { texture: tex, mipLevel: lv },
      src,
      { bytesPerRow: cw * ch, rowsPerImage: chh },
      { width: cw, height: chh, depthOrArrayLayers: 1 }
    );
    if (cw === 1 && chh === 1) break;
    const nw = Math.max(1, cw >> 1),
      nh = Math.max(1, chh >> 1);
    const dst = new Uint8Array(nw * nh * ch);
    for (let y = 0; y < nh; y++) {
      const y0 = Math.min(y * 2, chh - 1),
        y1 = Math.min(y * 2 + 1, chh - 1);
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(x * 2, cw - 1),
          x1 = Math.min(x * 2 + 1, cw - 1);
        const a = (y0 * cw + x0) * ch,
          b = (y0 * cw + x1) * ch,
          c = (y1 * cw + x0) * ch,
          d = (y1 * cw + x1) * ch,
          o = (y * nw + x) * ch;
        for (let k = 0; k < ch; k++)
          dst[o + k] = (src[a + k] + src[b + k] + src[c + k] + src[d + k] + 2) >> 2;
      }
    }
    src = dst;
    cw = nw;
    chh = nh;
  }
}
function mkBuf(bytes, usage, data) {
  const b = dev.createBuffer({ size: Math.max(4, bytes), usage: usage | GPUBufferUsage.COPY_DST });
  if (data) dev.queue.writeBuffer(b, 0, data);
  return b;
}
function wrapMesh(m) {
  return { buf: mkBuf(m.arr.byteLength, GPUBufferUsage.VERTEX, m.arr), n: m.n };
}
function mkSamplers() {
  const px = !!Q.pixelated;
  sAtl = dev.createSampler({
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    magFilter: px ? 'nearest' : 'linear',
    minFilter: px ? 'nearest' : 'linear',
    mipmapFilter: px ? 'nearest' : 'linear',
    maxAnisotropy: px ? 1 : Math.max(1, Q.aniso | 0)
  }); /* анизотропия через Q.aniso */
  sLin = dev.createSampler({
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'nearest'
  });
  sSh = dev.createSampler({
    addressModeU: 'repeat',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'nearest'
  });
  sDep = dev.createSampler({
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'nearest',
    minFilter: 'nearest',
    mipmapFilter: 'nearest'
  });
  sNoise = dev.createSampler({
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    magFilter: 'nearest',
    minFilter: 'nearest',
    mipmapFilter: 'nearest'
  });
}
function texEntry(b) {
  return { binding: b, visibility: VISVF(), texture: { sampleType: 'float' } };
}
function depEntry(b) {
  return { binding: b, visibility: VISVF(), texture: { sampleType: 'depth' } };
}
function sampEntry(b) {
  return { binding: b, visibility: VISVF(), sampler: { type: 'filtering' } };
}
function dsampEntry(b) {
  return { binding: b, visibility: VISVF(), sampler: { type: 'non-filtering' } };
}
function uniEntry(b) {
  return {
    binding: b,
    visibility: VISVF(),
    buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 0 }
  };
}
/* compute-записи: видимость COMPUTE, storage read / read_write / текстура только
   для записи */
const VISCS = () => GPUShaderStage.COMPUTE;
function csUniEntry(b) {
  return {
    binding: b,
    visibility: VISCS(),
    buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 0 }
  };
}
function csRO(b) {
  return { binding: b, visibility: VISCS(), buffer: { type: 'read-only-storage' } };
}
function csRW(b) {
  return { binding: b, visibility: VISCS(), buffer: { type: 'storage' } };
}
function csST(b, fmt) {
  return {
    binding: b,
    visibility: VISCS(),
    storageTexture: { access: 'write-only', format: fmt, viewDimension: '2d' }
  };
}

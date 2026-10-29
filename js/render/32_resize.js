/* ==== GPU.resize ==== */
function mkRT(w, h, fmt, usage, mips) {
  const t = mkT(w, h, fmt, usage, mips);
  return { t: t, v: t.createView(), w: w, h: h };
}
/* Цели кадра строятся с откатом: если GPU не смог выделить буферы пресета (8K на
   слабом железе) — молча режем разрешение вдвое и повторяем, пока не заработает. */
function buildTargets(w, h) {
  freeTargets();
  BG_CACHE = null;
  volPhase = 0;
  const hdr = !!(Q.hdr && GPU.hdrOK);
  sceneFmt = hdr ? 'rgba16float' : 'rgba8unorm';
  const CU = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  let ms = (Q.msaa | 0) > 1 ? Q.msaa | 0 : 0;
  if (ms > 4) ms = 4;
  GPU.msaa = ms;
  T = { bl: [] };
  if (ms > 0) {
    const mc = mkT(w, h, sceneFmt, GPUTextureUsage.RENDER_ATTACHMENT, 1, ms);
    const md = mkT(w, h, 'depth24plus', GPUTextureUsage.RENDER_ATTACHMENT, 1, ms);
    T.msC = { t: mc, v: mc.createView() };
    T.msD = { t: md, v: md.createView() };
  }
  if (ms > 0) {
    const mvd = mkT(w, h, 'depth24plus', GPUTextureUsage.RENDER_ATTACHMENT, 1, ms);
    T.msDvm = { t: mvd, v: mvd.createView() };
  } else {
    T.vmD = mkRT(w, h, 'depth24plus', GPUTextureUsage.RENDER_ATTACHMENT);
  }
  T.scene = mkRT(w, h, sceneFmt, CU);
  T.depth = mkRT(w, h, 'depth24plus', CU);
  if ((Q.ssao | 0) > 0) {
    const aw = Math.max(1, w >> 1),
      ah = Math.max(1, h >> 1);
    T.ao = mkRT(aw, ah, 'r8unorm', CU);
    T.ao2 = mkRT(aw, ah, 'r8unorm', CU);
  }
  if ((Q.vol | 0) > 0) {
    const vw = Math.max(1, w >> 1),
      vh = Math.max(1, h >> 1);
    T.volA = mkRT(vw, vh, sceneFmt, CU);
    T.volB = mkRT(vw, vh, sceneFmt, CU);
  }
  if (Q.post && (Q.bloomLv | 0) > 0) {
    let bw = Math.max(1, w >> 1),
      bh = Math.max(1, h >> 1);
    for (let i = 0; i < (Q.bloomLv | 0); i++) {
      T.bl.push(mkRT(bw, bh, sceneFmt, CU));
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
  }
  if ((Q.sharp || 0) > 0) T.L = mkRT(w, h, 'rgba8unorm', CU);
  if ((Q.ssr | 0) > 0) {
    /* планарные отражения пола: масштаб задаёт пресет (эпический — полное разрешение) */
    const rs = Math.min(1.0, Math.max(0.25, Q.reflScale || 0.5));
    const rw = Math.max(1, Math.round(w * rs)),
      rh = Math.max(1, Math.round(h * rs));
    T.reflC = mkRT(rw, rh, sceneFmt, CU);
    T.reflD = mkRT(rw, rh, 'depth24plus', GPUTextureUsage.RENDER_ATTACHMENT);
  }
  if ((Q.flare | 0) > 0) T.stk = mkRT(Math.max(1, w >> 2), Math.max(1, h >> 2), sceneFmt, CU);
  GPU.aexpOn = !!Q.aexp && !!GPU.hdrOK;
  if (GPU.aexpOn) {
    T.ed = mkRT(Math.max(16, w >> 4), Math.max(16, h >> 4), sceneFmt, CU);
    T.ea = mkRT(1, 1, sceneFmt, CU);
    T.eb = mkRT(1, 1, sceneFmt, CU);
  }
  /* bind-группы мира: группа 2 отличается только текстурой планарного отражения */
  const w2 = [
    { binding: 0, resource: V.texTex },
    { binding: 1, resource: V.texNrm },
    { binding: 2, resource: V.texLM },
    { binding: 3, resource: V.texHgt },
    { binding: 4, resource: V.texPud },
    { binding: 5, resource: V.texSh },
    { binding: 6, resource: T.reflC ? T.reflC.v : V.texBlack },
    { binding: 7, resource: sAtl },
    { binding: 8, resource: sLin },
    { binding: 9, resource: sSh },
    { binding: 10, resource: V.texSkin },
    { binding: 11, resource: { buffer: bufCellLit } }
  ];
  bgW2main = dev.createBindGroup({ layout: BGLS.w2, entries: w2 });
  bgW2refl = dev.createBindGroup({
    layout: BGLS.w2,
    entries: w2.map(e => (e.binding === 6 ? { binding: 6, resource: V.texBlack } : e))
  });
  bgW0 = dev.createBindGroup({
    layout: BGLS.w0,
    entries: [{ binding: 0, resource: { buffer: ub, offset: 0, size: FW_SIZE } }]
  });
  bgW1 = dev.createBindGroup({
    layout: BGLS.w1,
    entries: [{ binding: 0, resource: { buffer: ub, offset: 0, size: DRAW_SIZE } }]
  });
  /* начальное содержимое целей временного накопления */
  const ini = [];
  if (T.volA) ini.push({ view: T.volA.v, color: { r: 0, g: 0, b: 0, a: 1 } });
  if (T.volB) ini.push({ view: T.volB.v, color: { r: 0, g: 0, b: 0, a: 1 } });
  if (T.ea) ini.push({ view: T.ea.v, color: { r: 0.18, g: 0, b: 0, a: 1 } });
  if (T.eb) ini.push({ view: T.eb.v, color: { r: 0.18, g: 0, b: 0, a: 1 } });
  if (ini.length) {
    const e = dev.createCommandEncoder();
    for (const c of ini) {
      const p = e.beginRenderPass({
        colorAttachments: [{ view: c.view, clearValue: c.color, loadOp: 'clear', storeOp: 'store' }]
      });
      p.end();
    }
    dev.queue.submit([e.finish()]);
  }
}
GPU.resize = function (w, h) {
  if (!dev || !GPU.ready) return;
  const maxD = (dev.limits && dev.limits.maxTextureDimension2D) || 8192;
  let ww = Math.max(160, Math.min(w | 0, maxD)),
    hh = Math.max(100, Math.min(h | 0, maxD));
  for (var att = 0; att < 6; att++) {
    try {
      buildTargets(ww, hh);
      RW = ww;
      RH = hh;
      if (gpuCanvas.width !== ww || gpuCanvas.height !== hh) {
        gpuCanvas.width = ww;
        gpuCanvas.height = hh;
      }
      return;
    } catch (e) {
      try {
        freeTargets();
      } catch (e2) {}
      ww = Math.max(160, ww >> 1);
      hh = Math.max(100, hh >> 1);
    }
  }
};

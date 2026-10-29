/* ==== GPU.init ==== */
GPU.init = async function (canvas, S) {
  gpuBusy = true;
  try {
    if (!dev) {
      const r = await ensureDevice();
      adp = r.a;
      dev = r.d;
      ctx = canvas.getContext('webgpu');
      if (!ctx) throw new Error('нет webgpu-контекста');
      ctxFmt = navigator.gpu.getPreferredCanvasFormat();
      gpuCanvas = canvas;
      ctx.configure({ device: dev, format: ctxFmt, alphaMode: 'opaque' });
      ubStage = new ArrayBuffer(UB_SIZE);
      ubF = new Float32Array(ubStage);
      ubU = new Uint32Array(ubStage);
      ub = dev.createBuffer({
        size: UB_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      BGLS.pp = dev.createBindGroupLayout({ entries: [uniEntry(0)] });
      BGLS.w0 = dev.createBindGroupLayout({ entries: [uniEntry(0)] });
      BGLS.w1 = dev.createBindGroupLayout({ entries: [uniEntry(0)] });
      BGLS.w2 = dev.createBindGroupLayout({
        entries: [
          texEntry(0),
          texEntry(1),
          texEntry(2),
          texEntry(3),
          texEntry(4),
          texEntry(5),
          texEntry(6),
          sampEntry(7),
          sampEntry(8),
          sampEntry(9),
          texEntry(10),
          {
            binding: 11,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'read-only-storage' }
          }
        ]
      });
      BGLS.glow = dev.createBindGroupLayout({ entries: [] });
      BGLS.one = dev.createBindGroupLayout({ entries: [texEntry(0), sampEntry(1)] });
      BGLS.two = dev.createBindGroupLayout({ entries: [texEntry(0), sampEntry(1), texEntry(2)] });
      BGLS.aoB = dev.createBindGroupLayout({
        entries: [texEntry(0), sampEntry(1), depEntry(2), dsampEntry(3)]
      });
      BGLS.ao = dev.createBindGroupLayout({
        entries: [depEntry(0), dsampEntry(1), texEntry(2), dsampEntry(3)]
      });
      BGLS.vol = dev.createBindGroupLayout({
        entries: [depEntry(0), dsampEntry(1), texEntry(2), sampEntry(3), texEntry(4)]
      });
      /* compute-лейауты: скиннинг, поле облучённости, карта теней */
      BGLS.cUni = dev.createBindGroupLayout({ entries: [csUniEntry(0)] });
      BGLS.cSkin = dev.createBindGroupLayout({ entries: [csRO(0), csRO(1), csRO(2), csRW(3)] });
      BGLS.cLm = dev.createBindGroupLayout({
        entries: [csRO(0), csRO(1), csRW(2), csRW(3), csST(4, 'rgba8unorm')]
      });
      BGLS.cLamp = dev.createBindGroupLayout({ entries: [csRO(0), csRO(1)] });
      BGLS.cSh = dev.createBindGroupLayout({ entries: [csRO(0), csRO(1), csRO(2), csRW(3)] });
      BGLS.cPack = dev.createBindGroupLayout({ entries: [csRO(0), csRW(1)] });
      bgPP = dev.createBindGroup({
        layout: BGLS.pp,
        entries: [{ binding: 0, resource: { buffer: ub, offset: 0, size: PP_SIZE } }]
      });
      bgCPP = dev.createBindGroup({
        layout: BGLS.cUni,
        entries: [{ binding: 0, resource: { buffer: ub, offset: 0, size: PP_SIZE } }]
      });
      bufPost = mkBuf(24, GPUBufferUsage.VERTEX, new Float32Array([-1, -1, 3, -1, -1, 3]));
      bufPtQ = mkBuf(
        48,
        GPUBufferUsage.VERTEX,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1])
      );
      bufGlowQ = bufPtQ;
      await ldStep(0.06, 'видеокарта');
    }
    gpuFreeRes();
    FW_SIZE =
      208 +
      16 * Math.max(1, Q.lamps | 0) +
      96; /* +4 vec4 на фонарь игрока; +2 vec4 на рассеяние пятна (flE/flF) */
    FW_SLOT = (FW_SIZE + 255) & ~255;
    if (GPU.qlevel !== qSig()) {
      gpuFreeProgs();
      modWorld = modOf(wgslWorld(Q));
      compB = wgslComp(Q);
      BGLS.comp = dev.createBindGroupLayout({
        entries: (() => {
          const e = [];
          const B = compB.bindings;
          const n = Object.keys(B).length;
          for (const k in B) {
            if (k === 'samp') e.push(sampEntry(B[k]));
            else e.push(texEntry(B[k]));
          }
          return e;
        })()
      });
      mkSamplers();
      /* шум для SSAO (4×4) */
      if ((Q.ssao | 0) > 0) {
        if (texNoise) {
          try {
            texNoise.destroy();
          } catch (e) {}
        }
        const ND = new Uint8Array(64),
          rn = xsFromU32(0x55aa1234).rnd; /* фиксированный ассет рендера */
        for (let i = 0; i < 16; i++) {
          const a = rn() * Math.PI * 2;
          ND[i * 4] = ((Math.cos(a) * 0.5 + 0.5) * 255) | 0;
          ND[i * 4 + 1] = ((Math.sin(a) * 0.5 + 0.5) * 255) | 0;
          ND[i * 4 + 2] = ((0.5 + rn() * 0.2) * 255) | 0;
          ND[i * 4 + 3] = 255;
        }
        texNoise = mkT(
          4,
          4,
          'rgba8unorm',
          GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        );
        dev.queue.writeTexture(
          { texture: texNoise },
          ND,
          { bytesPerRow: 16, rowsPerImage: 4 },
          { width: 4, height: 4, depthOrArrayLayers: 1 }
        );
        const k3 = ssaoKernel(Q.ssao | 0),
          k4 = new Float32Array(24 * 4);
        for (let i = 0; i * 3 < k3.length && i < 24; i++) {
          k4[i * 4] = k3[i * 3];
          k4[i * 4 + 1] = k3[i * 3 + 1];
          k4[i * 4 + 2] = k3[i * 3 + 2];
          k4[i * 4 + 3] = 0;
        }
        ssaoK = k4;
      }
      modBright = wgslBright(Q);
      modSsao = (Q.ssao | 0) > 0 ? wgslSsao(Q) : '';
      modVol = (Q.vol | 0) > 0 ? wgslVol(Q) : '';
      GPU.qlevel = qSig();
    }
    await ldStep(0.16, 'шейдеры');
    /* заглушки 1×1 */
    texWhite = mkT(1, 1, 'rgba8unorm', GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
    dev.queue.writeTexture(
      { texture: texWhite },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4, rowsPerImage: 1 },
      { width: 1, height: 1, depthOrArrayLayers: 1 }
    );
    texBlack01 = mkT(
      1,
      1,
      'rgba8unorm',
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    );
    dev.queue.writeTexture(
      { texture: texBlack01 },
      new Uint8Array([0, 0, 0, 255]),
      { bytesPerRow: 4, rowsPerImage: 1 },
      { width: 1, height: 1, depthOrArrayLayers: 1 }
    );
    texDummyR = mkT(1, 1, 'r8unorm', GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
    dev.queue.writeTexture(
      { texture: texDummyR },
      new Uint8Array([255]),
      { bytesPerRow: 1, rowsPerImage: 1 },
      { width: 1, height: 1, depthOrArrayLayers: 1 }
    );

    /* атлас: цвет + нормали + высоты (мипы считаются на CPU — в WebGPU нет
   generateMipmap) */
    await ldStep(0.22, 'текстуры мира');
    const atl = getAtlas(S);
    const TU = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
    const aw = atl.w,
      ah = atl.h,
      amc = mipCount(aw, ah);
    texTex = mkT(aw, ah, 'rgba8unorm', TU, amc);
    uploadMips(
      texTex,
      new Uint8Array(atl.col.data.buffer, atl.col.data.byteOffset, aw * ah * 4),
      aw,
      ah,
      4
    );
    texNrm = mkT(aw, ah, 'rgba8unorm', TU, amc);
    uploadMips(texNrm, atl.nrm, aw, ah, 4);
    if (Q.pom || Q.cav) {
      texHgt = mkT(aw, ah, 'r8unorm', TU, amc);
      uploadMips(texHgt, atl.hgt, aw, ah, 1);
    } else texHgt = texDummyR;
    await ldStep(0.5, 'текстуры мира');
    /* Ширина = shSteps пресета (при фиксированном SHW_MAX и shSteps<256 азимут
   сжимался бы в левую часть карты), глубина — r16float (ядро WebGPU), 64 лампы ×
   shRows полос. Карта заполняется через csShadow→csPack→copyBufferToTexture:
   r16float в ядре WebGPU не поддерживает storage-запись из compute. */
    const TUS = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
    texSh = mkT(
      Math.max(16, Math.min(SHW_MAX, Q.shSteps | 0)),
      64 * Math.max(8, Math.min(SH_ROWS_MAX, Q.shRows | 0)),
      'r16float',
      TU
    );
    /* атлас кожи и материалов тела — 1024², мипы на CPU */
    texSkin = mkT(1024, 1024, 'rgba8unorm', TU, mipCount(1024, 1024));
    uploadMips(texSkin, genSkinTex(S.seedState), 1024, 1024, 4);
    await ldStep(0.6, 'материалы');
    texLM = mkT(S.W, S.H, 'rgba8unorm', TUS); /* карта света пишется compute-шейдером csLmFinal */
    const PM = genPuddleMap(S);
    texPud = mkT(PM.w, PM.h, 'r8unorm', TU);
    dev.queue.writeTexture(
      { texture: texPud },
      PM.data,
      { bytesPerRow: PM.w, rowsPerImage: PM.h },
      { width: PM.w, height: PM.h, depthOrArrayLayers: 1 }
    );
    /* клетки с лужами (список на CPU): если ни одна не попадает во вьюпорт —
   зеркальный проход пропускается целиком, отражать всё равно нечего (порог 40/255
   ниже порога лужи в fsWorld 0.18 — список с запасом покрывает все видимые лужи) */
    {
      const res = (PM.w / S.W) | 0 || 4;
      const mark = new Uint8Array(S.W * S.H);
      for (let y = 0; y < PM.h; y++) {
        const ry = ((y / res) | 0) * S.W;
        for (let x = 0; x < PM.w; x++)
          if (PM.data[y * PM.w + x] >= 40) mark[ry + ((x / res) | 0)] = 1;
      }
      let cnt = 0;
      for (let i = 0; i < mark.length; i++) cnt += mark[i];
      const cl = new Uint16Array(cnt);
      let k = 0;
      for (let i = 0; i < mark.length; i++) if (mark[i]) cl[k++] = i;
      GPU.pudCells = cl;
    }

    const wd = worldData(S);
    bufWorld = mkBuf(wd.arr.byteLength, GPUBufferUsage.VERTEX, wd.arr);
    GPU.wCount = wd.n;
    bufWorldFloor = mkBuf(
      Math.max(4, wd.arrF.byteLength),
      GPUBufferUsage.VERTEX,
      wd.arrF.length ? wd.arrF : null
    );
    GPU.wFCount = wd.nF;
    GPU.rig = buildRig();
    await ldStep(0.68, 'геометрия');
    const VSU =
      GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE; /* csSkin пишет результат скиннинга */
    bufRig = mkBuf(GPU.rig.total * 36, VSU);
    /* динамический буфер ткани плаща (верле-сетка тряпки). Ткань остаётся на CPU:
   180 верле-частиц — это десятки микросекунд, а перенос изменил бы порядок
   решения связей (Gauss-Seidel → Jacobi) и поведение плаща без всякой выгоды. */
    GPU.skirtArr = new Float32Array(SKIRT_VN * 9);
    bufSkirt = mkBuf(GPU.skirtArr.byteLength, GPUBufferUsage.VERTEX);
    GPU.skirt = {
      p: new Float32Array(SKIRT_NU * SKIRT_NV * 3),
      q: new Float32Array(SKIRT_NU * SKIRT_NV * 3),
      init: 0,
      px: 0,
      pz: 0,
      vx: 0,
      vz: 0,
      sax: 0,
      saz: 0,
      wvx: 0,
      wvz: 0
    };
    /* один риг на всё тело; буферы: тело (мир), руки вьюмодели (main+refl не нужны —
   вьюмодель не отражается), манекен. Тело рисуется ОДНИМ буфером в обоих
   проходах: матрица модели мировая, а отражение в луже даёт сама зеркальная
   камера. */
    GPU.plRig = buildPlayerRig();
    /* второй набор скрытия для вьюмодели — без ног (пока взгляд не опущен) */
    GPU.hideFPl = Object.assign({}, GPU.plRig.hide);
    for (const bn of ['thL', 'snL', 'ftL', 'thR', 'snR', 'ftR']) GPU.hideFPl[GPU.plRig.idx[bn]] = 1;
    bufPlRig = mkBuf(GPU.plRig.total * 36, VSU); /* тело */
    bufPlRigB = mkBuf(GPU.plRig.total * 36, VSU); /* руки (вьюмодель) */
    bufMan = mkBuf(GPU.plRig.total * 36, VSU); /* манекен */
    MESH.key = wrapMesh(buildKeyMeshData());
    MESH.valve = wrapMesh(buildValveData());
    /* фонарь, батарейка, шкаф с ящиком, стол в безопасной комнате */
    MESH.flash = wrapMesh(buildFlashlightData());
    MESH.flashLens = wrapMesh(buildFlashLensData());
    MESH.battBody = wrapMesh(buildBatteryBodyData());
    MESH.battBand = wrapMesh(buildBatteryBandData());
    MESH.cab = wrapMesh(buildCabinetData());
    MESH.cabDrawer = wrapMesh(buildCabinetDrawerData());
    MESH.table = wrapMesh(buildTableData());
    MESH.portal = wrapMesh(discMeshData(0.42, 26));
    MESH.lampH = wrapMesh(
      lampFixtureData({
        iron: {
          u0: UV_IRON.u0 + (UV_IRON.u1 - UV_IRON.u0) * 0.06,
          u1: UV_IRON.u0 + (UV_IRON.u1 - UV_IRON.u0) * 0.34,
          v0: UV_IRON.v0 + (UV_IRON.v1 - UV_IRON.v0) * 0.06,
          v1: UV_IRON.v0 + (UV_IRON.v1 - UV_IRON.v0) * 0.34
        },
        inner: {
          u0: UV_CEIL.u0 + (UV_CEIL.u1 - UV_CEIL.u0) * 0.3,
          u1: UV_CEIL.u0 + (UV_CEIL.u1 - UV_CEIL.u0) * 0.7,
          v0: UV_CEIL.v0 + (UV_CEIL.v1 - UV_CEIL.v0) * 0.3,
          v1: UV_CEIL.v0 + (UV_CEIL.v1 - UV_CEIL.v0) * 0.7
        }
      })
    );
    MESH.lampP = wrapMesh(lampPaneData(0.15, -0.006));
    MESH.eye = wrapMesh(boxMeshData(0.02, 0.02, 0.02));
    MESH.door = wrapMesh(
      leafMeshData(0.5, DOOR_H, 0.055, UV_IRON, EDGE_IRON, UV_IRON2)
    ); /* к потолку */
    MESH.safe = wrapMesh(leafMeshData(0.5, DOOR_H, 0.05, UV_WOOD, EDGE_WOOD)); /* к потолку */
    MESH.safeHw = wrapMesh(buildSafeHwData(0.5, DOOR_H, 0.05)); /* пояса/заклёпки/ручка */
    GPU.DR = doorRig(S);
    GPU.doorYaw = GPU.DR.exit.yaw;
    /* портал ПОВЁРНУТ К ВХОДЯЩЕМУ ИГРОКУ: его диск перпендикулярен оси
   дверь→комната выхода (единственной связи комнаты в дереве лабиринта), а не
   дверной створке — теперь комната может примыкать к двери с любой стороны */
    {
      const wc = S.winCell || S.door,
        pdx = wc.x - S.door.x,
        pdy = wc.y - S.door.y;
      GPU.portalYaw = pdx || pdy ? Math.atan2(-pdx, -pdy) : GPU.doorYaw;
    }
    bufGlowI = mkBuf(glowArr.byteLength, GPUBufferUsage.VERTEX);
    await ldStep(0.8, 'модели');
    V = {
      texSkin: texSkin.createView(),
      texTex: texTex.createView(),
      texNrm: texNrm.createView(),
      texHgt: texHgt.createView(),
      texLM: texLM.createView(),
      texSh: texSh.createView(),
      texPud: texPud.createView(),
      texWhite: texWhite.createView(),
      texBlack: texBlack01.createView(),
      texNoise: texNoise ? texNoise.createView() : texBlack01.createView()
    };
    bgGlowEmpty = dev.createBindGroup({ layout: BGLS.glow, entries: [] });
    /* ---- compute-ресурсы: скиннинг, карта теней, поле облучённости ---- */
    const ncell = S.W * S.H;
    bufGrid = mkBuf(ncell * 4, GPUBufferUsage.STORAGE);
    bufLG = mkBuf(ncell * 8, GPUBufferUsage.STORAGE);
    /* маска ламп на клетку (2×u32) — пиксель шейдит только лампы своей клетки */
    bufCellLit = mkBuf(ncell * 8, GPUBufferUsage.STORAGE);
    /* полосы карты теней: заголовок (число капсул / 0xFFFFFFFF = «чисто») +
   индексы капсул полосы — csShadow проходит только свой список и пропускает
   чистые полосы */
    bufShAux = mkBuf((SHL_MAX + 1) * (CAPS_MAX + 1) * 4, GPUBufferUsage.STORAGE);
    GPU.shTrack = null; /* новый буфер расстояний — первый кадр считает все полосы */
    bufScA = mkBuf(ncell * 4, GPUBufferUsage.STORAGE);
    bufScB = mkBuf(ncell * 4, GPUBufferUsage.STORAGE);
    bufCaps = mkBuf(CAPS_MAX * 7 * 4, GPUBufferUsage.STORAGE);
    bufSegs = mkBuf(SEGS_MAX * 4 * 4, GPUBufferUsage.STORAGE);
    bufLampSh = mkBuf((SHL_MAX * 4 + 8) * 4, GPUBufferUsage.STORAGE);
    /* вывод карты теней: f32-расстояния (csShadow) → упакованные пары half (csPack)
   → copyBufferToTexture. Шаг строки кратен 256 (требование копирования), высота —
   максимум строк диспатча: (лампы теней + фонарь) × полосы пресета. */
    {
      const shWQ = Math.max(16, Math.min(SHW_MAX, Q.shSteps | 0));
      const shRQ = Math.max(8, Math.min(SH_ROWS_MAX, Q.shRows | 0));
      shPitch = Math.max(256, Math.ceil((shWQ * 2) / 256) * 256);
      const rowsMax =
        (Math.min(Math.max(1, Q.lamps | 0), Math.max(1, Q.shLamps | 0 || 64)) + 1) * shRQ;
      bufShF32 = mkBuf(shWQ * rowsMax * 4, GPUBufferUsage.STORAGE);
      bufShU16 = mkBuf(shPitch * rowsMax, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    }
    {
      const dM = rigSrcData(GPU.rig);
      bufSrcMon = mkBuf(dM.src.byteLength, GPUBufferUsage.STORAGE, dM.src);
      bufBIdxMon = mkBuf(Math.max(4, dM.bi.byteLength), GPUBufferUsage.STORAGE, dM.bi);
      const dP = rigSrcData(GPU.plRig);
      bufSrcPl = mkBuf(dP.src.byteLength, GPUBufferUsage.STORAGE, dP.src);
      bufBIdxPl = mkBuf(Math.max(4, dP.bi.byteLength), GPUBufferUsage.STORAGE, dP.bi);
    }
    const BONES_B = NB_MAX * 16 * 4 + NB_MAX * 4;
    function skinInst(rig, srcB, bidxB, dst) {
      const bb = new ArrayBuffer(BONES_B);
      return {
        rig: rig,
        bb: bb,
        f32: new Float32Array(bb, 0, NB_MAX * 16),
        u32: new Uint32Array(bb, NB_MAX * 16 * 4, NB_MAX),
        bones: mkBuf(BONES_B, GPUBufferUsage.STORAGE),
        dst: dst,
        srcB: srcB,
        bidxB: bidxB,
        bg: null
      };
    }
    SK = {
      mon: skinInst(GPU.rig, bufSrcMon, bufBIdxMon, bufRig),
      body: skinInst(GPU.plRig, bufSrcPl, bufBIdxPl, bufPlRig),
      vm: skinInst(GPU.plRig, bufSrcPl, bufBIdxPl, bufPlRigB),
      man: skinInst(GPU.plRig, bufSrcPl, bufBIdxPl, bufMan)
    };
    for (const k in SK) {
      const I = SK[k];
      I.bg = dev.createBindGroup({
        layout: BGLS.cSkin,
        entries: [
          { binding: 0, resource: { buffer: I.bones } },
          { binding: 1, resource: { buffer: I.srcB } },
          { binding: 2, resource: { buffer: I.bidxB } },
          { binding: 3, resource: { buffer: I.dst } }
        ]
      });
    }
    /* итерации Якоби для поля чередуют буферы: AB (scA→scB) и BA (scB→scA); после
   6 итераций результат снова в scA — его и читает csLmFinal. */
    bgLmAB = dev.createBindGroup({
      layout: BGLS.cLm,
      entries: [
        { binding: 0, resource: { buffer: bufLG } },
        { binding: 1, resource: { buffer: bufGrid } },
        { binding: 2, resource: { buffer: bufScA } },
        { binding: 3, resource: { buffer: bufScB } },
        { binding: 4, resource: V.texLM }
      ]
    });
    bgLmBA = dev.createBindGroup({
      layout: BGLS.cLm,
      entries: [
        { binding: 0, resource: { buffer: bufLG } },
        { binding: 1, resource: { buffer: bufGrid } },
        { binding: 2, resource: { buffer: bufScB } },
        { binding: 3, resource: { buffer: bufScA } },
        { binding: 4, resource: V.texLM }
      ]
    });
    bgShLamp = dev.createBindGroup({
      layout: BGLS.cLamp,
      entries: [
        { binding: 0, resource: { buffer: bufLampSh } },
        { binding: 1, resource: { buffer: bufShAux } }
      ]
    });
    bgShData = dev.createBindGroup({
      layout: BGLS.cSh,
      entries: [
        { binding: 0, resource: { buffer: bufGrid } },
        { binding: 1, resource: { buffer: bufCaps } },
        { binding: 2, resource: { buffer: bufSegs } },
        { binding: 3, resource: { buffer: bufShF32 } }
      ]
    });
    bgPack = dev.createBindGroup({
      layout: BGLS.cPack,
      entries: [
        { binding: 0, resource: { buffer: bufShF32 } },
        { binding: 1, resource: { buffer: bufShU16 } }
      ]
    });
    plCSkin = plOfC('CSKIN', {
      layout: layoutOf([BGLS.cSkin]),
      compute: { module: modOf(WGS_SKIN), entryPoint: 'csSkin' }
    });
    plLmInit = plOfC('CLM0', {
      layout: layoutOf([BGLS.cUni, BGLS.cLm]),
      compute: { module: modOf(WGS_LM), entryPoint: 'csLmInit' }
    });
    plLmIter = plOfC('CLM1', {
      layout: layoutOf([BGLS.cUni, BGLS.cLm]),
      compute: { module: modOf(WGS_LM), entryPoint: 'csLmIter' }
    });
    plLmFinal = plOfC('CLM2', {
      layout: layoutOf([BGLS.cUni, BGLS.cLm]),
      compute: { module: modOf(WGS_LM), entryPoint: 'csLmFinal' }
    });
    plCSh = plOfC('CSH', {
      layout: layoutOf([BGLS.cUni, BGLS.cLamp, BGLS.cSh]),
      compute: { module: modOf(WGS_SHADOW), entryPoint: 'csShadow' }
    });
    plPack = plOfC('CPK', {
      layout: layoutOf([BGLS.cUni, BGLS.cPack]),
      compute: { module: modOf(WGS_PACK), entryPoint: 'csPack' }
    });
    await ldStep(0.94, 'конвейеры');
    GPU.mapW = S.W;
    GPU.mapH = S.H;
    lampsArr = new Float32Array(Math.max(1, Q.lamps) * 4);
    GPU.hdrOK = true;
    GPU.sig = gpuSigOf(S.seed, S.W, S.H);
    GPU.ready = true;
    try {
      console.info('NADZIRATEL · ' + GAME_VER + ' · WebGPU');
    } catch (e) {}
    gpuBusy = false;
    return true;
  } catch (e) {
    console.warn('GPU init failed: ' + (e && e.message ? e.message : e));
    GPU.ready = false;
    GPU.ok = false;
    gpuBusy = false;
    return false;
  }
};

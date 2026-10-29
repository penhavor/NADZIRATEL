GPU.clearBlack = function () {
  if (!GPU.ready || !dev || !ctx) return;
  try {
    const e = dev.createCommandEncoder();
    const p = e.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    });
    p.end();
    dev.queue.submit([e.finish()]);
  } catch (err) {}
};
GPU.look = look;

GPU._test = {
  fsWorldSrc: wgslWorld,
  doorRig: doorRig,
  doorSides: doorSides,
  doorModel: doorModel,
  doorMix: doorMix,
  leafMeshData: leafMeshData,
  buildRig: buildRig,
  quadUV: quadUV,
  collectShadowCaps: collectShadowCaps,
  collectDoorSegs: collectDoorSegs,
  collectGridU32: collectGridU32,
  collectLamps: collectLamps,
  fkAll: fkAll,
  rigSrcData: rigSrcData,
  rigVisCount: rigVisCount,
  m4mul: m4mul,
  m4t: m4t,
  m4rotY: m4rotY,
  m4sc: m4sc,
  WGS_SKIN: () => WGS_SKIN,
  WGS_LM: () => WGS_LM,
  WGS_SHADOW: () => WGS_SHADOW,
  genPuddleMap: genPuddleMap,
  lampFixtureData: lampFixtureData,
  boxMeshData: boxMeshData,
  discMeshData: discMeshData,
  buildKeyMeshData: buildKeyMeshData,
  buildFlashlightData: buildFlashlightData,
  buildFlashLensData: buildFlashLensData,
  buildBatteryBodyData: buildBatteryBodyData,
  buildBatteryBandData: buildBatteryBandData,
  buildCabinetData: buildCabinetData,
  buildCabinetDrawerData: buildCabinetDrawerData,
  buildTableData: buildTableData,
  GRIP_FLASH: () => GRIP_FLASH,
  GRIP_KEY: () => GRIP_KEY,
  GRIP_BATT: () => GRIP_BATT,
  GRIP_SMALL_L: () => GRIP_SMALL_L,
  rlSample: rlSample,
  rlBattOld: rlBattOld,
  rlBattNew: rlBattNew,
  gripHand: gripHand,
  heldMat: heldMat,
  worldData: worldData,
  monPose: monPose,
  monGaitPose: monGaitPose,
  MON_GAIT: MON_GAIT,
  MON_GAIT_K: MON_GAIT_K,
  monFootLowest: monFootLowest,
  monLegFK: monLegFK,
  /* персонаж доступен инструментам разработчика и автотестам */
  playerRig: () => GPU.plRig,
  buildPlayerRig: buildPlayerRig,
  skinRigEx: skinRigEx,
  playerPose: playerPose,
  playerPoseFP: playerPoseFP,
  poseFromClip: poseFromClip,
  animNames: animNames,
  animLabels: animLabels,
  ANIM_CLIPS: ANIM_CLIPS,
  GAIT_RATE: GAIT_RATE,
  GAIT_K: GAIT_K,
  VM_FRAME: () => VM_FRAME,
  HIDE_FP: () => HIDE_FP_NAMES,
  genSkinTex: genSkinTex,
  PREG: () => PREG,
  PMAT: () => PMAT,
  getAtlas: getAtlas,
  buildAtlasData: buildAtlasData,
  applyAtlasQ: applyAtlasQ,
  heightToNormal: heightToNormal,
  atlasDims: () => ({ AQ: AQ, AW: AW, AH: AH }),
  uv: () => ({
    UV_WALL: UV_WALL,
    UV_FLOOR: UV_FLOOR,
    UV_WOOD: UV_WOOD,
    UV_CEIL: UV_CEIL,
    UV_IRON: UV_IRON,
    UV_IRON2: UV_IRON2
  }),
  shaders: () => ({
    VS_WORLD: wgslWorld(Q),
    VS_POST: WGS_PP,
    FS_BRIGHT: wgslBright(Q),
    FS_DOWN: WGS_DOWN,
    FS_UP: WGS_UP,
    FS_SHARP: WGS_SHARP,
    FS_COMP: compB ? compB.src : '',
    FS_BLIT: WGS_BLIT,
    VS_GLOW: WGS_GLOW,
    FS_GLOW: WGS_GLOW,
    FS_AOBLUR: WGS_AOBLUR,
    FS_SSAO: (Q.ssao | 0) > 0 ? wgslSsao(Q) : '',
    FS_VOL: (Q.vol | 0) > 0 ? wgslVol(Q) : '',
    FS_STREAK: WGS_STREAK,
    FS_ADAPT: WGS_ADAPT,
    fsUltra: wgslWorld(QUALITY.ultra),
    fsHigh: wgslWorld(QUALITY.high),
    fsMedium: wgslWorld(QUALITY.medium),
    fsLow: wgslWorld(QUALITY.low),
    fsMax: wgslWorld(QUALITY.max),
    fsSsaoUltra: wgslSsao(QUALITY.ultra),
    fsVolUltra: wgslVol(QUALITY.ultra)
  }),
  ssaoKernel: ssaoKernel,
  m4invView: m4invView,
  look: look,
  buildValveData: buildValveData,
  buildSafeHwData: buildSafeHwData,
  lampPaneData: lampPaneData,
  buildCellLightMask: buildCellLightMask,
  buildShadowAux: buildShadowAux,
  skirtSim: skirtSim,
  skirtBuild: skirtBuild,
  sdWgsl: sdWgsl,
  wgslWorld: wgslWorld,
  wgslSsao: wgslSsao,
  wgslVol: wgslVol,
  wgslBright: wgslBright,
  wgslComp: wgslComp,
  MAT_WGSL: MAT_WGSL,
  WGS_HELPERS: WGS_HELPERS,
  WGS_PP: WGS_PP,
  WGS_PACK: WGS_PACK,
  WGS_GLOW: WGS_GLOW,
  WGS_DOWN: WGS_DOWN,
  WGS_UP: WGS_UP,
  WGS_SHARP: WGS_SHARP,
  WGS_AOBLUR: WGS_AOBLUR,
  WGS_STREAK: WGS_STREAK,
  WGS_ADAPT: WGS_ADAPT,
  WGS_BLIT: WGS_BLIT,
  SKIRT_LEN: SKIRT_LEN,
  SKIRT_R0: SKIRT_R0,
  SKIRT_RX: SKIRT_RX,
  SKIRT_TOP: SKIRT_TOP,
  SKIRT_FRONT: SKIRT_FRONT,
  SKIRT_NU: SKIRT_NU,
  SKIRT_NV: SKIRT_NV,
  SKIRT_SEGY: SKIRT_SEGY,
  SKIRT_VN: SKIRT_VN
};
/* персонаж нужен основным скриптам (update) и коду ввода с панелью разработчика,
   но объявлен внутри этого IIFE — публикуем в window */
window.playerAutoAnim = playerAutoAnim;
window.poseDistSnap = poseDistSnap;
window.ANIM_CLIPS = ANIM_CLIPS;
window.animNames = animNames;
window.animLabels = animLabels;
window.GAIT_RATE = GAIT_RATE;
window.GAIT_K = GAIT_K; /* нужны основным скриптам (update) — коэффициенты фазы шага */
window.MON_GAIT_K = MON_GAIT_K; /* то же для шага монстра — нужно основным скриптам (stepMonster) */
window.playerPose = playerPose;
window.playerPoseFP = playerPoseFP;
window.poseFromClip = poseFromClip;
window.buildPlayerRigFn = buildPlayerRig;
window.skinRigExFn = skinRigEx;

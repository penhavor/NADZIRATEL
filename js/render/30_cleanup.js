/* ---- очистка ---- */
function destroyList(list) {
  const seen = new Set();
  for (const o of list) {
    if (o && o.destroy && !seen.has(o)) {
      seen.add(o);
      try {
        o.destroy();
      } catch (e) {}
    }
  }
}
function gpuFreeRes() {
  destroyList([
    texTex,
    texNrm,
    texHgt,
    texLM,
    texSh,
    texWhite,
    texBlack01,
    texPud,
    texDummyR,
    texSkin
  ]);
  destroyList([
    bufWorld,
    bufWorldFloor,
    bufRig,
    bufPlRig,
    bufPlRigB,
    bufMan,
    bufGlowI,
    bufSkirt,
    bufGrid,
    bufLG,
    bufScA,
    bufScB,
    bufCaps,
    bufSegs,
    bufLampSh,
    bufShF32,
    bufShU16,
    bufCellLit,
    bufShAux,
    bufSrcMon,
    bufBIdxMon,
    bufSrcPl,
    bufBIdxPl,
    SK && SK.mon && SK.mon.bones,
    SK && SK.body && SK.body.bones,
    SK && SK.vm && SK.vm.bones,
    SK && SK.man && SK.man.bones
  ]);
  for (const k in MESH) destroyList([MESH[k] && MESH[k].buf]);
  texTex =
    texNrm =
    texHgt =
    texLM =
    texSh =
    texWhite =
    texBlack01 =
    texPud =
    texDummyR =
    texSkin =
      null;
  bufWorld = bufWorldFloor = bufRig = bufPlRig = bufPlRigB = bufMan = bufGlowI = null;
  MESH = {}; /* bufPost/bufPtQ/bufGlowQ — время жизни устройства */
  bufSkirt = bufGrid = bufLG = bufScA = bufScB = bufCaps = bufSegs = bufLampSh = null;
  bufShF32 = bufShU16 = null;
  bufCellLit = null;
  bufShAux = null;
  GPU.shTrack = null;
  GPU.pudCells = null;
  bufSrcMon = bufBIdxMon = bufSrcPl = bufBIdxPl = null;
  SK = null;
  bgW0 = bgW1 = bgW2main = bgW2refl = null;
  bgLmAB = bgLmBA = bgShLamp = bgShData = bgPack = null;
} /* bgCPP — время жизни устройства (как bgPP) */
function freeTargets() {
  if (!T) return;
  const l = [];
  const add = o => {
    if (o && o.t) l.push(o.t);
  };
  for (const k in T) {
    const v = T[k];
    if (Array.isArray(v)) {
      for (const b of v) add(b);
    } else add(v);
  }
  destroyList(l);
  T = null;
  bgW2main = bgW2refl = null;
}
function gpuFreeProgs() {
  PLS.clear();
  MODS.clear();
  modWorld = null;
  compB = null;
}

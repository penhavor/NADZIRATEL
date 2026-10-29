/* ==== WebGPU: устройство ==== */
const PP_SIZE = 640,
  DRAW_SIZE = 256;
let FW_SIZE = 208 + 16,
  FW_SLOT = 0;
let dev = null,
  adp = null,
  ctx = null,
  ctxFmt = 'bgra8unorm',
  gpuCanvas = null,
  devP = null;
let ub = null,
  ubStage = null,
  ubF = null,
  ubU = null,
  ubOff = 0;
const UB_SIZE = 1 << 20;
let MODS = new Map(),
  PLS = new Map(),
  BGLS = {};
let sAtl = null,
  sLin = null,
  sSh = null,
  sDep = null;
let texTex = null,
  texNrm = null,
  texHgt = null,
  texLM = null,
  texSh = null,
  texNoise = null;
let texWhite = null,
  texBlack01 = null,
  texPud = null,
  texDummyR = null,
  texSkin = null;
let bufWorld = null,
  bufRig = null,
  bufPlRig = null,
  bufPlRigB = null,
  bufMan = null,
  bufPost = null,
  bufPtQ = null,
  bufGlowQ = null,
  bufGlowI = null,
  bufSkirt = null;
/* compute-инфраструктура: скиннинг, карта теней, поле облучённости */
let bufGrid = null,
  bufLG = null,
  bufScA = null,
  bufScB = null,
  bufCaps = null,
  bufSegs = null,
  bufLampSh = null;
let bufCellLit = null,
  bufShAux = null,
  bufWorldFloor = null;
let bufShF32 = null,
  bufShU16 = null,
  shPitch = 256;
let bufSrcMon = null,
  bufBIdxMon = null,
  bufSrcPl = null,
  bufBIdxPl = null;
let SK = null,
  bgCPP = null,
  bgLmAB = null,
  bgLmBA = null,
  bgShLamp = null,
  bgShData = null,
  bgPack = null;
let plCSkin = null,
  plCSh = null,
  plPack = null,
  plLmInit = null,
  plLmIter = null,
  plLmFinal = null;
let MESH = {};
let bgPP = null,
  bgW0 = null,
  bgW1 = null,
  bgW2main = null,
  bgW2refl = null;
let modWorld = null,
  compB = null;
let V = {},
  sNoise = null;
let modSsao = '',
  modVol = '',
  modBright = '';
let bgGlowEmpty = null;
let T = null,
  sceneFmt = 'rgba8unorm';
let lampsArr = new Float32Array(64 * 4);
let volArr = new Float32Array(8 * 4);
let glowArr = new Float32Array(64 * 8);
let glowN = 0;
let wlList = []; /* список отрисовки мира: переиспользуется между кадрами */
let RW = 832,
  RH = 520,
  zA = 0,
  zB = 0;

function ensureDevice() {
  if (!devP) {
    devP = (async () => {
      if (!navigator.gpu) throw new Error('WebGPU недоступен в этом браузере');
      const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!a) throw new Error('не найден GPU-адаптер');
      const d = await a.requestDevice();
      d.lost.then(() => {
        GPU.ready = false;
      });
      return { a: a, d: d };
    })();
    /* отказ не кэшируем навсегда: следующая попытка запросит устройство заново */
    devP.catch(() => {
      if (devP) devP = null;
    });
  }
  return devP;
}
/* запрос адаптера начинается сразу, чтобы устройство было готово к нажатию «Старт» */
if (typeof navigator !== 'undefined' && navigator.gpu) {
  ensureDevice().catch(() => {});
}

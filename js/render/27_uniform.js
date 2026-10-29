/* Проекция WebGPU: z в NDC равен [0,1] (в отличие от WebGL2) */
function perspW(fovy, asp, n, f) {
  const t = 1 / Math.tan(fovy / 2);
  return new Float32Array([
    t / asp,
    0,
    0,
    0,
    0,
    t,
    0,
    0,
    0,
    0,
    f / (n - f),
    -1,
    0,
    0,
    (n * f) / (n - f),
    0
  ]);
}

/* ---- uniform-буфер ---- */
function ubReset() {
  ubOff = 0;
}
function ubAlloc(bytes) {
  const o = (ubOff + 255) & ~255;
  ubOff = o + bytes;
  if (ubOff > UB_SIZE) throw new Error('uniform overflow');
  return o;
}
function ubFlush() {
  if (ubOff > 0) dev.queue.writeBuffer(ub, 0, ubStage, 0, ubOff);
}

/* смещения внутри FrameW */
const FO_PROJ = 0,
  FO_VIEW = 64,
  FO_CAM = 128,
  FO_FOG = 144,
  FO_MAP = 160,
  FO_P1 = 176,
  FO_I1 = 192,
  FO_LAMPS = 208;
/* смещения внутри DrawW */
const DO_MODEL = 0,
  DO_EM = 64,
  DO_FLAT = 80,
  DO_DOORIO = 96,
  DO_AXIS = 112,
  DO_F1 = 128,
  DO_F2 = 144,
  DO_F3 = 160;
/* смещения внутри PP */
const PO_M0 = 0,
  PO_M1 = 64,
  PO_V0 = 128,
  PO_V1 = 144,
  PO_V2 = 160,
  PO_V3 = 176,
  PO_V4 = 192,
  PO_V5 = 208,
  PO_V6 = 224,
  PO_K = 256;

function putF(off, arr) {
  ubF.set(arr, off >> 2);
}
function putM(off, m) {
  ubF.set(m, off >> 2);
}
function put4(off, a, b, c, d) {
  const i = off >> 2;
  ubF[i] = a;
  ubF[i + 1] = b;
  ubF[i + 2] = c;
  ubF[i + 3] = d;
}
function putU(off, a, b, c, d) {
  const i = off >> 2;
  ubU[i] = a;
  ubU[i + 1] = b;
  ubU[i + 2] = c;
  ubU[i + 3] = d;
}

function allocDraw() {
  const o = ubAlloc(DRAW_SIZE);
  putM(o + DO_MODEL, IDENT);
  put4(o + DO_EM, 0, 0, 0, 0);
  put4(o + DO_FLAT, 0, 0, 0, 0);
  put4(o + DO_DOORIO, 0, 0, 0, 0);
  put4(o + DO_AXIS, 0, 0, 0, 0);
  put4(o + DO_F1, 0, 0, 0, 0);
  put4(o + DO_F2, 0, 0, 0, 0);
  put4(o + DO_F3, 0, 0, 0, 0);
  return o;
}
function allocPP() {
  const o = ubAlloc(PP_SIZE);
  for (let i = o >> 2, n = (o + PP_SIZE) >> 2; i < n; i++) ubF[i] = 0;
  putM(o + PO_M0, IDENT);
  putM(o + PO_M1, IDENT);
  return o;
}
function allocFrame(proj, view) {
  const o = ubAlloc(FW_SLOT);
  putM(o + FO_PROJ, proj);
  putM(o + FO_VIEW, view);
  return o;
}

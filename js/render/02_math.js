/* ==== МАТЕМАТИКА: матрицы, камера ==== */
function look(cx, cy, cz, yaw, pitch) {
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const f = [Math.cos(yaw) * cp, sp, Math.sin(yaw) * cp];

  let r = [-f[2], 0, f[0]];
  const rl = Math.hypot(r[0], r[2]) || 1;
  r = [r[0] / rl, 0, r[2] / rl];

  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const m = new Float32Array(16);
  m[0] = r[0];
  m[4] = r[1];
  m[8] = r[2];
  m[12] = -(r[0] * cx + r[1] * cy + r[2] * cz);
  m[1] = u[0];
  m[5] = u[1];
  m[9] = u[2];
  m[13] = -(u[0] * cx + u[1] * cy + u[2] * cz);
  m[2] = -f[0];
  m[6] = -f[1];
  m[10] = -f[2];
  m[14] = f[0] * cx + f[1] * cy + f[2] * cz;
  m[3] = 0;
  m[7] = 0;
  m[11] = 0;
  m[15] = 1;
  return m;
}
function m4mul(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
  return o;
}
function m4t(x, y, z) {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}
function m4rotY(a) {
  const c = Math.cos(a),
    s = Math.sin(a);
  const m = new Float32Array(16);
  m[0] = c;
  m[2] = -s;
  m[5] = 1;
  m[8] = s;
  m[10] = c;
  m[15] = 1;
  return m;
}
function m4rotX(a) {
  const c = Math.cos(a),
    s = Math.sin(a);
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  m[15] = 1;
  return m;
}
/* отражение относительно плоскости пола y=0 (для планарных отражений) */
const M4MIR = (() => {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = -1;
  m[10] = 1;
  m[15] = 1;
  return m;
})();
function m4rotZ(a) {
  const c = Math.cos(a),
    s = Math.sin(a);
  const m = new Float32Array(16);
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  m[10] = 1;
  m[15] = 1;
  return m;
}
const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

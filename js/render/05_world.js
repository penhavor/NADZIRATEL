/* ==== ГЕОМЕТРИЯ МИРА: стены, пол, потолок ====
   Пол — ОТДЕЛЬНЫЙ буфер: зеркальный проход его просто не рисует (раньше пол
   отсекался discard в fsWorld, а discard отключал early-z на весь проход мира —
   каждый перекрытый пиксель честно шейдился). Основной проход рисует оба буфера —
   картинка та же, а тест глубины срезает перерисовку до шейдера. */
function buildWorldData(S) {
  const V = []; /* стены + потолки */
  const VF = []; /* полы (исключены из зеркального прохода) */
  const pushTo = (A, px, py, pz, u, v, nx, ny, nz, ao) => {
    A.push(px, py, pz, u, v, nx, ny, nz, ao);
  };
  const push = (px, py, pz, u, v, nx, ny, nz, ao) => {
    V.push(px, py, pz, u, v, nx, ny, nz, ao);
  };
  const quadTo = (A, a, b, c, d, uvs, n, aos) => {
    pushTo(A, a[0], a[1], a[2], uvs[0], uvs[1], n[0], n[1], n[2], aos[0]);
    pushTo(A, b[0], b[1], b[2], uvs[2], uvs[3], n[0], n[1], n[2], aos[1]);
    pushTo(A, c[0], c[1], c[2], uvs[4], uvs[5], n[0], n[1], n[2], aos[2]);
    pushTo(A, a[0], a[1], a[2], uvs[0], uvs[1], n[0], n[1], n[2], aos[0]);
    pushTo(A, c[0], c[1], c[2], uvs[4], uvs[5], n[0], n[1], n[2], aos[2]);
    pushTo(A, d[0], d[1], d[2], uvs[6], uvs[7], n[0], n[1], n[2], aos[3]);
  };
  const quad = (a, b, c, d, uvs, n, aos) => quadTo(V, a, b, c, d, uvs, n, aos);
  const quadF = (a, b, c, d, uvs, n, aos) => quadTo(VF, a, b, c, d, uvs, n, aos);

  const QU = (qx, qy) => {
    const q = qx === 1 && qy === 0 ? UV_FLOOR : UV_CEIL;
    return [q.u0, q.v0, q.u1, q.v0, q.u1, q.v1, q.u0, q.v1];
  };
  const QW = () => {
    const q = UV_WALL;

    return [q.u0, q.v1, q.u0, q.v0, q.u1, q.v0, q.u1, q.v1];
  };
  const solid = (x, z) => x < 0 || z < 0 || x >= S.W || z >= S.H || S.grid[z * S.W + x] === 1;
  const cornerAO = (gx, gz) => {
    let k = 0;
    if (solid(gx - 1, gz - 1)) k++;
    if (solid(gx, gz - 1)) k++;
    if (solid(gx - 1, gz)) k++;
    if (solid(gx, gz)) k++;
    return 1 - 0.1 * k;
  };
  const wallAO = y => {
    const t = Math.min(1, y / (0.38 * CEIL_H));
    const top = y > 0.82 * CEIL_H ? 0.86 : 1; /* потолок на 3.5 м */
    return (0.55 + 0.45 * t * (2 - t)) * top;
  };
  /* одно виртуальное кольцо стен ВОКРУГ сетки: комнаты старта и выхода сидят на
   внешнем поясе, и у их стороны вне сетки не было клетки-стены, из которой можно
   выпустить грань, — комната смотрела в чёрную пустоту (виртуальная клетка рисует
   ровно один квад: грань в сторону комнаты, все остальные её соседи сплошные) */
  for (let z = -1; z <= S.H; z++)
    for (let x = -1; x <= S.W; x++) {
      const g = x < 0 || z < 0 || x >= S.W || z >= S.H ? 1 : S.grid[z * S.W + x];
      if (g === 1) {
        const q = QW();
        const CH = CEIL_H; /* стены до потолка (3.5 м) */
        if (!solid(x - 1, z))
          quad(
            [x, 0, z],
            [x, CH, z],
            [x, CH, z + 1],
            [x, 0, z + 1],
            q,
            [-1, 0, 0],
            [wallAO(0), wallAO(CH), wallAO(CH), wallAO(0)]
          );
        if (!solid(x + 1, z))
          quad(
            [x + 1, 0, z + 1],
            [x + 1, CH, z + 1],
            [x + 1, CH, z],
            [x + 1, 0, z],
            q,
            [1, 0, 0],
            [wallAO(0), wallAO(CH), wallAO(CH), wallAO(0)]
          );
        if (!solid(x, z - 1))
          quad(
            [x + 1, 0, z],
            [x + 1, CH, z],
            [x, CH, z],
            [x, 0, z],
            q,
            [0, 0, -1],
            [wallAO(0), wallAO(CH), wallAO(CH), wallAO(0)]
          );
        if (!solid(x, z + 1))
          quad(
            [x, 0, z + 1],
            [x, CH, z + 1],
            [x + 1, CH, z + 1],
            [x + 1, 0, z + 1],
            q,
            [0, 0, 1],
            [wallAO(0), wallAO(CH), wallAO(CH), wallAO(0)]
          );
        quad(
          [x, CH, z],
          [x, CH, z + 1],
          [x + 1, CH, z + 1],
          [x + 1, CH, z],
          QU(0, 1),
          [0, 1, 0],
          [
            cornerAO(x, z) * 0.72,
            cornerAO(x, z + 1) * 0.72,
            cornerAO(x + 1, z + 1) * 0.72,
            cornerAO(x + 1, z) * 0.72
          ]
        );
      } else {
        quadF(
          [x, 0, z + 1],
          [x + 1, 0, z + 1],
          [x + 1, 0, z],
          [x, 0, z],
          QU(1, 0),
          [0, 1, 0],
          [cornerAO(x, z + 1), cornerAO(x + 1, z + 1), cornerAO(x + 1, z), cornerAO(x, z)]
        );
        quad(
          [x, CEIL_H, z],
          [x + 1, CEIL_H, z],
          [x + 1, CEIL_H, z + 1],
          [x, CEIL_H, z + 1],
          QU(0, 1),
          [0, -1, 0],
          [
            cornerAO(x, z) * 0.72,
            cornerAO(x + 1, z) * 0.72,
            cornerAO(x + 1, z + 1) * 0.72,
            cornerAO(x, z + 1) * 0.72
          ]
        );
      }
    }
  return {
    arr: new Float32Array(V),
    n: V.length / 9,
    arrF: new Float32Array(VF),
    nF: VF.length / 9,
    W: S.W,
    H: S.H
  };
}
const WCACHE = { sig: '', data: null };
function worldData(S) {
  const sig = S.seed + '_' + S.W + 'x' + S.H + '_' + AQ;
  if (WCACHE.sig !== sig) {
    WCACHE.data = buildWorldData(S);
    WCACHE.sig = sig;
  }
  return WCACHE.data;
}

/* ==== ТЕЛО. Имена и смещения костей зафиксированы клипами и опорной кинематикой. ==== */
/* Пропорции ноги: бедро 0.460 + голень 0.385 = 0.845 рига (досягаемость 0.85 м).
   Досягаемость — жёсткий потолок шага:
   (S/2)^2 + (hipBase - ankle)^2 <= (L1+L2-0.008)^2.
   Макушка на 1.773 рига; CELL_M подобран так, что 1.773*PL_SCALE*CELL_M = 1.80 м. */
const PL_HIP = 0.955,
  PL_THLEN = 0.46,
  PL_SNLEN = 0.385;

/* ---- волосы ---- */
function hairLine(phi) {
  const a = Math.abs(phi);
  if (a < 0.55) return 0.126 - 0.008 * smk(cl01(a / 0.55));
  if (a < 1.05) return 0.118 - 0.018 * smk(cl01((a - 0.55) / 0.5));
  if (a < 1.45) return 0.108 - 0.055 * smk(cl01((a - 1.05) / 0.4));
  if (a < 2.05) return 0.053 - 0.02 * smk(cl01((a - 1.45) / 0.6));
  return 0.033 - 0.012 * smk(cl01((a - 2.05) / 1.1));
}
function buildHair(HR) {
  /* МАКУШКА ЗАКРЫТА: последний ряд волосяной сетки — полюс (схлопнутая вершина),
   сетка сшивается веером. Открытое кольцо при t=1 пропускало яркую шапочку черепа. */
  const nu = 32,
    nv = 12,
    V = [];
  for (let j = 0; j < nv; j++) {
    const t = j / (nv - 1);
    for (let i = 0; i < nu; i++) {
      const phi = (i / nu - 0.5) * 2 * Math.PI;
      if (t > 0.999) {
        /* полюс макушки: все i схлопываются в одну точку */
        const uu = HR[0] + (HR[1] - HR[0]) * 0.5,
          vv = HR[3];
        V.push(0, HEAD_Y1 + 0.005, profAt(HEAD_Y1)[3], uu, vv, 0, 0, 0, 1);
        continue;
      }
      const y0 = hairLine(phi),
        y = y0 + (HEAD_Y1 + 0.006 - y0) * t;
      const p = headSurfF(phi, Math.min(y, HEAD_Y1));
      const n = headNorm(phi, Math.min(y, HEAD_Y1));
      const thick = 0.007 + 0.008 * Math.sin(Math.PI * cl01(t)) * (0.7 + 0.3 * Math.sin(phi * 7.0));
      const strand =
        0.0012 * Math.sin(phi * 23.0 + t * 9.0) + 0.0008 * Math.sin(phi * 41.0 - t * 5.0);
      const h = thick + strand + (t < 0.12 ? 0.003 * (1 - t / 0.12) : 0);
      const uu = HR[0] + (HR[1] - HR[0]) * (i / nu),
        vv = HR[2] + (HR[3] - HR[2]) * t;
      V.push(p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h, uu, vv, 0, 0, 0, 1);
    }
  }
  smoothGridNormals(V, nu, nv, true);
  normalsOutward(V, y => [0, profAt(y)[3]]);
  /* на вершине волосяного купола сглаживание может направить нормали вниз —
   макушка шейдилась «чёрной точкой». В верхней зоне принудительно поднимаем
   вертикальную составляющую: купол всегда освещён сверху. */
  for (let k = 1; k < V.length; k += 9) {
    if (V[k] > HEAD_Y1 - 0.015 && V[k + 5] < 0) V[k + 5] = -V[k + 5];
  }
  const out = gridToTris(V, nu, nv, true);
  /* чёлка: пара прядей надо лбом для силуэта */
  for (const sg of [1, -1]) {
    out.push.apply(
      out,
      partAO(
        partXf(
          loftPart(
            [
              pr(0, 0, 0, 0.02, 0.01, 2.2),
              pr(-0.03, 0, -0.004, 0.016, 0.008, 2.2),
              pr(-0.055, 0, -0.008, 0.008, 0.005, 2.0)
            ],
            7,
            HR,
            true
          ),
          sg * 0.03,
          0.15,
          -0.07,
          -0.5,
          sg * 0.35,
          sg * 0.5
        ),
        0.6
      )
    );
  }
  return out;
}

/* ---- кисть с пальцами ---- */
/* по UV-окнам: ладонь [0.500..0.600]x[0.30..0.48], пальцы [0.600..0.700]x[0.06..0.30] */
const FING_UV = [0.6, 0.7, 0.06, 0.3];
function fingerPart(len, r0, r1, uv) {
  return loftPart(
    [
      pr(0, 0, 0, r0, r0 * 0.82, 2.3),
      pr(-len * 0.45, 0, -0.001, r0 * 0.92, r0 * 0.8, 2.3),
      pr(-len, 0, -0.002, r1, r1 * 0.85, 2.2)
    ],
    6,
    uv,
    true
  );
}

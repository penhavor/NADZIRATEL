/* ==== КАРТА МАТЕРИАЛОВ ==== */
let PREG = {
  flesh: { u0: 0.015, u1: 0.485 },
  skin: { u0: 0.5, u1: 0.7 },
  jacket: { u0: 0.712, u1: 0.848 },
  pants: { u0: 0.858, u1: 0.918 },
  boot: { u0: 0.926, u1: 0.968 },
  hair: { u0: 0.974, u1: 0.998 }
};
const PMAT = {
  skin: { rough: 0.4, spec: 0.85, bump: 7.0 },
  jacket: { rough: 0.88, spec: 0.2, bump: 5.0 },
  pants: { rough: 0.92, spec: 0.14, bump: 4.5 },
  boot: { rough: 0.48, spec: 0.7, bump: 6.0 },
  hair: { rough: 0.36, spec: 1.05, bump: 8.0 }
};

/* ==== ТЕКСТУРА КОЖИ ==== */
function genSkinTex(st) {
  /* st — состояние сида, поток XS_SKIN */
  const SZ = 1024,
    data = new Uint8Array(SZ * SZ * 4);
  const G = xsStream(st, XS_SKIN);
  const seed = G.u32() | 0; /* 32-битный тег для попиксельных хэшей позиции (зоны fbm) */
  const H = (x, y, s) => pudHash(x | 0, y | 0, s | 0);
  const VN = (x, y, s) => pudVnoise(x, y, s);
  const fb = (x, y, s) =>
    VN(x, y, s) * 0.56 +
    VN(x * 2.03 + 17.1, y * 2.03 + 5.3, s + 101) * 0.29 +
    VN(x * 4.31 + 91.7, y * 4.31 + 3.9, s + 211) * 0.15;
  const fb2 = (x, y, s) =>
    VN(x, y, s) * 0.62 +
    VN(x * 2.71 + 3.3, y * 2.71 + 11.9, s + 57) * 0.26 +
    VN(x * 6.13 + 41.1, y * 6.13 + 7.7, s + 131) * 0.12;
  const rid = (x, y, s) => {
    const n = fb(x, y, s);
    return 1 - Math.abs(2 * n - 1);
  };
  const cl = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---- зона 1: плоть Монитора ---- */
  const FX1 = Math.round(PREG.flesh.u1 * SZ);
  for (let y = 0; y < SZ; y++)
    for (let x = 0; x < FX1; x++) {
      const m = fb(x * 0.018, y * 0.018, seed + 11),
        m2 = fb(x * 0.05 + 40, y * 0.05, seed + 77);
      const ve = rid(x * 0.03, y * 0.03, seed + 33),
        ve2 = rid(x * 0.013 + 9, y * 0.013, seed + 55);
      const po = H(x, y, seed + 7) & 15;
      const base = 0.3 + 0.26 * m;
      let r = base * 1.06,
        g = base * 0.88,
        b = base * 0.78;
      const vm = Math.max(ve * ve, ve2 * ve2 * 0.8);
      const vk = Math.max(0, vm - 0.55) * 2.2;
      r = r * (1 - vk * 0.55) + 0.16 * vk;
      g = g * (1 - vk * 0.62) + 0.07 * vk;
      b = b * (1 - vk * 0.6) + 0.08 * vk;
      const sc = Math.max(0, rid(x * 0.008 + 3, y * 0.045, seed + 91) - 0.8) * 5;
      r += sc * 0.16;
      g += sc * 0.14;
      b += sc * 0.12;
      const pk = (po / 15 - 0.5) * 0.1 * (0.4 + m2);
      r += pk;
      g += pk * 0.9;
      b += pk * 0.8;
      const h = 0.35 * m + 0.3 * vk + 0.2 * (po / 15) + 0.15 * m2;
      const o = (y * SZ + x) * 4;
      data[o] = cl(r * 255, 0, 255) | 0;
      data[o + 1] = cl(g * 255, 0, 255) | 0;
      data[o + 2] = cl(b * 255, 0, 255) | 0;
      data[o + 3] = cl(h * 255, 0, 255) | 0;
    }

  /* ---- общая зона «принтер»: u — вокруг кости, v — вдоль кости ---- */
  function fill(reg, fn) {
    const x0 = Math.round(reg.u0 * SZ),
      x1 = Math.round(reg.u1 * SZ),
      w = x1 - x0;
    for (let y = 0; y < SZ; y++) {
      const v = (y + 0.5) / SZ; /* строка y ↔ v=y/SZ (так это сэмплирует WebGPU после загрузки) */
      for (let x = x0; x < x1; x++) {
        const u = (x + 0.5 - x0) / w;
        const c = fn(u, v, x, y);
        const o = (y * SZ + x) * 4;
        data[o] = cl(c[0] * 255, 0, 255) | 0;
        data[o + 1] = cl(c[1] * 255, 0, 255) | 0;
        data[o + 2] = cl(c[2] * 255, 0, 255) | 0;
        data[o + 3] = cl(c[3] * 255, 0, 255) | 0;
      }
    }
    /* защитные колонки: крайние текселы зоны дублируются, чтобы фильтрация не тянула
   соседний материал (особенно важно для мипов и анизотропии) */
    for (let y = 0; y < SZ; y++) {
      const o = (y * SZ + x0) * 4,
        o2 = (y * SZ + x0 + 1) * 4;
      data[o] = data[o2];
      data[o + 1] = data[o2 + 1];
      data[o + 2] = data[o2 + 2];
      data[o + 3] = data[o2 + 3];
      const p = (y * SZ + x1 - 1) * 4,
        p2 = (y * SZ + x1 - 2) * 4;
      data[p] = data[p2];
      data[p + 1] = data[p2 + 1];
      data[p + 2] = data[p2 + 2];
      data[p + 3] = data[p2 + 3];
    }
  }
  const wstrip = (u, k, ph) => {
    const d = Math.abs(((((u * k + ph) % 1) + 1) % 1) - 0.5);
    return 1 - cl((d - 0.4) / 0.1, 0, 1);
  };

  /* --- кожа: зона кожи разбита на окна: шея / ладонь / пальцы / лицо --- */
  const browArc = hx =>
    0.117 + 0.011 * (1 - cl01(Math.abs(hx) / 0.048) * cl01(Math.abs(hx) / 0.048));
  fill(PREG.skin, (u, v, x, y) => {
    /* u здесь ЛОКАЛЬНА для зоны (0..1); окнам головы и кисти нужна абсолютная */
    const ua = PREG.skin.u0 + u * (PREG.skin.u1 - PREG.skin.u0);
    const p = fb2(x * 0.55 + 31, y * 0.55 + 7, seed + 5);
    const q = fb2(x * 0.13 + 91, y * 0.13 + 17, seed + 23);
    const pore = H(x, y, seed + 13);
    let base = 0.36 + 0.085 * q + 0.05 * p - 0.032 * pore * pore;
    const cap = Math.max(0, rid(x * 0.055 + 3, y * 0.055, seed + 44) - 0.8) * 4.2;
    const blot = Math.max(0, fb(x * 0.021 + 61, y * 0.021 + 3, seed + 71) - 0.6) * 1.4;
    let r = base * 1.2,
      g = base * 0.935,
      b = base * 0.815;
    r += cap * 0.075 + blot * 0.045;
    g -= cap * 0.012;
    b -= cap * 0.022;
    r += blot * 0.03;
    g += blot * 0.01;
    if (H(x >> 2, y >> 2, seed + 97) > 0.966) {
      r += 0.036;
      g += 0.013;
      b -= 0.011;
    }
    let h = 0.5 + 0.28 * pore + 0.16 * p - 0.1 * blot + 0.1 * cap;
    /* ---- шея: тень от челюсти ---- */
    if (v < 0.3 && ua < 0.6 && v > 0.14) {
      const k = smk(cl01((v - 0.16) / 0.14));
      const sh = 0.38 * (1 - k);
      r *= 1 - sh;
      g *= 1 - sh * 1.02;
      b *= 1 - sh * 0.98;
      h -= 0.1 * (1 - k);
    }
    /* ---- ладонь / тыльная сторона кисти ---- */
    if (v >= 0.3 && v < 0.48 && ua < 0.6) {
      const du = (ua - 0.5) / 0.1,
        dv = (v - 0.3) / 0.18;
      const palmS = smk(cl01((du - 0.5) / 0.1)) * (1 - smk(cl01((du - 0.95) / 0.05)));
      const c1 = Math.exp(-Math.pow((dv - 0.55 - 0.1 * Math.sin(du * 6.0)) / 0.03, 2)) * palmS;
      const c2 =
        Math.exp(-Math.pow((dv - 0.74 - 0.08 * Math.sin(du * 5.0 + 1.0)) / 0.026, 2)) * palmS;
      const thc = Math.exp(-(Math.pow((du - 0.5) / 0.07, 2) + Math.pow((dv - 0.34) / 0.2, 2)));
      const cc = Math.max(Math.max(c1, c2), thc * 0.8);
      r *= 1 - 0.2 * cc;
      g *= 1 - 0.2 * cc;
      b *= 1 - 0.19 * cc;
      h -= 0.3 * cc;
      /* подушечки: светлее и рельефнее */
      r += 0.03 * palmS;
      g += 0.02 * palmS;
      b += 0.014 * palmS;
      h += 0.1 * palmS;
      /* тыльная сторона: сухожилия и вены */
      const back = 1 - palmS;
      const tend =
        Math.exp(-Math.pow((du - 0.25) / 0.045, 2)) * Math.exp(-Math.pow((dv - 0.55) / 0.3, 2));
      r += 0.02 * tend * back;
      g += 0.018 * tend * back;
      b += 0.016 * tend * back;
      const vein = Math.max(0, rid(du * 7.0, dv * 3.5, seed + 77) - 0.82) * 5 * back;
      r -= vein * 0.01;
      g += vein * 0.004;
      b += vein * 0.012;
      const kn = Math.exp(-Math.pow((dv - 0.94) / 0.05, 2)) * (0.5 + 0.5 * Math.sin(du * 46.0));
      r *= 1 - 0.1 * kn;
      g *= 1 - 0.1 * kn;
      b *= 1 - 0.1 * kn;
      h -= 0.15 * kn;
    }
    /* ---- пальцы: ноготь, складки, подушечка ---- */
    if (v >= 0.06 && v < 0.3 && ua >= 0.6) {
      const du = (ua - 0.6) / 0.1,
        dv = (v - 0.06) / 0.24;
      const nail =
        smk(cl01(1 - Math.pow((du - 0.25) / 0.11, 2))) *
        smk(cl01((dv - 0.52) / 0.1)) *
        (1 - smk(cl01((dv - 0.96) / 0.03)));
      if (nail > 0.01) {
        const lun = smk(cl01((0.7 - dv) / 0.1));
        const free = smk(cl01((dv - 0.88) / 0.06));
        let nr = 0.575 + 0.1 * lun + 0.14 * free,
          ng = 0.465 + 0.1 * lun + 0.13 * free,
          nb = 0.41 + 0.09 * lun + 0.12 * free;
        const ridge = 0.012 * Math.sin(du * 90.0 + dv * 8.0);
        r = r * (1 - nail) + (nr + ridge) * nail;
        g = g * (1 - nail) + (ng + ridge) * nail;
        b = b * (1 - nail) + (nb + ridge) * nail;
        h = h * (1 - nail) + (0.78 - 0.1 * free) * nail;
      }
      const kc =
        Math.exp(-Math.pow((dv - 0.1) / 0.055, 2)) * (0.55 + 0.45 * Math.sin(du * 40.0 + 1.3));
      const kc2 =
        Math.exp(-Math.pow((dv - 0.5) / 0.04, 2)) * (0.5 + 0.5 * Math.sin(du * 36.0)) * 0.6;
      const kk = Math.max(kc, kc2);
      r *= 1 - 0.13 * kk;
      g *= 1 - 0.13 * kk;
      b *= 1 - 0.12 * kk;
      h -= 0.22 * kk;
      const pad =
        smk(cl01((du - 0.55) / 0.15)) *
        (1 - smk(cl01((du - 0.98) / 0.05))) *
        smk(cl01((dv - 0.7) / 0.15));
      const fr = 0.02 * Math.sin(dv * 230.0) * pad;
      r += 0.028 * pad + fr;
      g += 0.018 * pad + fr;
      b += 0.013 * pad + fr;
      h += 0.12 * pad;
    }
    /* ---- ЛИЦО: дуговые координаты ---- */
    if (v >= 0.5) {
      const phi = invHeadU(ua),
        hy = invHeadV(v),
        hx = phi * 0.075;
      /* тени глазниц */
      for (const sgn of [1, -1]) {
        const dx = hx - sgn * 0.0315,
          dy = hy - 0.088;
        const ex = dx / 0.0075,
          ey = dy / 0.0052,
          rho = Math.hypot(ex, ey);
        const ao = Math.exp(-Math.pow(rho / 2.3, 2)) * 0.13;
        r *= 1 - ao;
        g *= 1 - ao * 1.05;
        b *= 1 - ao * 0.95;
        if (rho > 0.9 && rho < 1.2 && ey < 0) {
          r = r * 0.25 + 0.03;
          g = g * 0.25 + 0.026;
          b = b * 0.25 + 0.024;
          h -= 0.2;
        } /* линия ресниц */
        else if (rho > 0.95 && rho < 1.16 && ey > 0) {
          r *= 0.55;
          g *= 0.52;
          b *= 0.5;
          h -= 0.1;
        } else if (rho > 1.42 && rho < 1.78 && ey < 0) {
          r *= 0.88;
          g *= 0.87;
          b *= 0.87;
          h -= 0.06;
        } /* складка века */
      }
      /* брови: штрихи */
      const ba = browArc(hx),
        db = hy - ba;
      const bm =
        Math.exp(-Math.pow(db / 0.0062, 2)) *
        smk(cl01(1 - Math.pow(Math.abs(hx) / 0.049, 2))) *
        smk(cl01((Math.abs(hx) - 0.008) / 0.006));
      const st = Math.sin(hx * 1500 + fb(x * 0.35, y * 0.35, seed + 51) * 7.0 + db * 300);
      if (bm > 0.02 && st > -0.1) {
        const k = bm * smk(cl01((st + 0.1) / 0.7)) * 0.85;
        r = r * (1 - k) + 0.085 * k;
        g = g * (1 - k) + 0.062 * k;
        b = b * (1 - k) + 0.045 * k;
        h -= 0.12 * k;
      }
      /* щетина */
      const lipM =
        Math.exp(-Math.pow((hy - 0.01) / 0.014, 2)) * smk(cl01(1 - Math.pow(hx / 0.028, 2)));
      const stb =
        smk(cl01((0.045 - hy) / 0.022)) * smk(cl01((0.088 - Math.abs(hx)) / 0.03)) * (1 - lipM);
      const sd = H(x, y, seed + 141);
      if (stb > 0.02 && sd > 0.42) {
        const k = stb * (0.3 + 0.45 * sd);
        r *= 1 - 0.16 * k;
        g *= 1 - 0.15 * k;
        b *= 1 - 0.12 * k;
        h -= 0.06 * k;
      }
      /* губы */
      const lm =
        smk(cl01(1 - Math.pow(Math.abs(hx) / 0.0265, 2))) *
        Math.exp(-Math.pow((hy - 0.01) / 0.0135, 2));
      if (lm > 0.01) {
        const k = lm * 0.8;
        r = r * (1 - k) + 0.4 * k;
        g = g * (1 - k) + 0.185 * k;
        b = b * (1 - k) + 0.165 * k;
        h = h * (1 - lm) + 0.44 * lm;
      }
      const ml = Math.exp(-Math.pow((hy - 0.011) / 0.0016, 2)) * lm;
      if (ml > 0.01) {
        r = r * (1 - ml) + 0.115 * ml;
        g = g * (1 - ml) + 0.068 * ml;
        b = b * (1 - ml) + 0.06 * ml;
        h += 0.18 * ml;
      }
      const lh = Math.exp(-Math.pow((hy - 0.0015) / 0.004, 2)) * lm;
      r += 0.045 * lh;
      g += 0.026 * lh;
      b += 0.022 * lh;
      /* ноздри и крылья носа */
      const nd = Math.exp(
        -(Math.pow((Math.abs(hx) - 0.0075) / 0.0021, 2) + Math.pow((hy - 0.0372) / 0.0022, 2))
      );
      if (nd > 0.01) {
        const k = nd * 0.55;
        r = r * (1 - k) + 0.085 * k;
        g = g * (1 - k) + 0.068 * k;
        b = b * (1 - k) + 0.062 * k;
        h -= 0.22 * nd;
      }
      /* тень у основания носа (снизу) — вместо чёрных точек спереди */
      const ush = Math.exp(-(Math.pow(hx / 0.0125, 2) + Math.pow((hy - 0.03) / 0.0045, 2)));
      r *= 1 - 0.22 * ush;
      g *= 1 - 0.22 * ush;
      b *= 1 - 0.2 * ush;
      h -= 0.1 * ush;
      const ac = Math.exp(
        -(Math.pow((Math.abs(hx) - 0.018) / 0.0026, 2) + Math.pow((hy - 0.04) / 0.008, 2))
      );
      r *= 1 - 0.12 * ac;
      g *= 1 - 0.12 * ac;
      b *= 1 - 0.11 * ac;
      /* румянец и Т-зона */
      const bl = Math.exp(
        -(Math.pow((Math.abs(hx) - 0.033) / 0.016, 2) + Math.pow((hy - 0.058) / 0.015, 2))
      );
      r += 0.03 * bl;
      g += 0.008 * bl;
      b += 0.004 * bl;
      /* ухо: тень раковины */
      const es = Math.exp(
        -(Math.pow((Math.abs(phi) - 1.72) / 0.3, 2) + Math.pow((hy - 0.07) / 0.032, 2))
      );
      r *= 1 - 0.3 * es;
      g *= 1 - 0.3 * es;
      b *= 1 - 0.28 * es;
      h -= 0.15 * es;
    }
    /* микрорельеф кожи: тончайшая сетка морщин + складки шеи.
   Амплитуды крошечные; черты лица (глаза, губы, брови) не смещаются. */
    const mic = fb2(x * 1.9 + 13, y * 1.9 + 29, seed + 151) - 0.5;
    const mic2 = fb2(x * 3.7 + 57, y * 3.7 + 11, seed + 241) - 0.5;
    r += mic * 0.01 + mic2 * 0.005;
    g += mic * 0.009 + mic2 * 0.004;
    b += mic * 0.008 + mic2 * 0.004;
    h += mic * 0.1 + mic2 * 0.06;
    if (v < 0.3 && v > 0.14 && ua < 0.6) {
      const nl = 0.5 + 0.5 * Math.sin(v * 150 + fb(x * 0.06, y * 0.06, seed + 251) * 3.0);
      const nk2 = cl((nl - 0.75) * 4, 0, 1) * 0.5;
      r -= nk2 * 0.012;
      g -= nk2 * 0.012;
      b -= nk2 * 0.011;
      h -= nk2 * 0.1;
    }
    return [r, g, b, h];
  });
  /* ---- окно глаза: радужка/зрачок/склера ---- */
  {
    const x0 = Math.round(EYE_U0 * SZ),
      x1 = Math.round(EYE_U1 * SZ);
    const y0 = Math.round(EYE_V0 * SZ),
      y1 = Math.round(EYE_V1 * SZ);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const u = (x + 0.5) / SZ,
          v = (y + 0.5) / SZ;
        const t = cl01((v - EYE_V0) / (EYE_V1 - EYE_V0));
        const ang = ((u - EYE_U0) / (EYE_U1 - EYE_U0)) * Math.PI * 2;
        let r, g, b, h;
        if (t < 0.115) {
          r = 0.02;
          g = 0.018;
          b = 0.017;
          h = 0.3;
        } /* зрачок */
        else if (t < 0.315) {
          /* радужка */
          const q = (t - 0.115) / 0.2;
          const stri = 0.5 + 0.5 * Math.sin(ang * 26 + fb(x * 0.9, y * 0.9, seed + 61) * 9);
          const stri2 = 0.5 + 0.5 * Math.sin(ang * 61 + 3.1 + fb(x * 1.7, y * 1.7, seed + 67) * 5);
          const base = 0.115 + 0.075 * stri + 0.045 * stri2;
          r = base * 1.35 + 0.045 * (1 - q);
          g = base * 1.05 + 0.03 * (1 - q);
          b = base * 0.72 + 0.018 * (1 - q);
          const col = Math.exp(-Math.pow((q - 0.35) / 0.22, 2)) * 0.06; /* коларетта */
          r += col;
          g += col * 0.85;
          b += col * 0.6;
          if (q > 0.86) {
            const k = (q - 0.86) / 0.14;
            r *= 1 - 0.75 * k;
            g *= 1 - 0.75 * k;
            b *= 1 - 0.72 * k;
          } /* лимб */
          h = 0.62;
        } else {
          /* склера */
          const q = (t - 0.315) / 0.685;
          let s = 0.6 - 0.16 * smk(cl01(q / 0.45));
          const vein = Math.max(0, rid(ang * 3.0 + 7, q * 6.0, seed + 71) - 0.8) * 4;
          r = s + vein * 0.055;
          g = s * 0.985 + vein * 0.012;
          b = s * 0.96 + vein * 0.01;
          r += 0.02 * Math.sin(ang * 3 + 1.0) * q;
          h = 0.55;
        }
        const o = (y * SZ + x) * 4;
        data[o] = cl(r * 255, 0, 255) | 0;
        data[o + 1] = cl(g * 255, 0, 255) | 0;
        data[o + 2] = cl(b * 255, 0, 255) | 0;
        data[o + 3] = cl(h * 255, 0, 255) | 0;
      }
  }

  /* --- куртка: саржа, кроеные панели, строченые швы, молния, износ --- */
  fill(PREG.jacket, (u, v, x, y) => {
    /* ткань плотнее и «дороже»: двухниточная саржа (грубая + тонкая), узелки пряжи,
   складки драпировки вдоль кости, двойная строчка шва. */
    const tw =
      0.5 +
      0.22 * Math.sin(x * 1.35 + y * 0.55) +
      0.14 * Math.sin(x * 0.55 - y * 1.35) +
      0.1 * Math.sin(x * 2.85 - y * 2.3) +
      0.06 * Math.sin(x * 4.7 + y * 3.9);
    const thr = fb2(x * 0.95 + 7, y * 0.95 + 23, seed + 141); /* зерно нити */
    const m = fb2(x * 0.085 + 11, y * 0.085 + 29, seed + 9);
    const coarse = fb(x * 0.021 + 5, y * 0.021 + 41, seed + 31);
    const fold = Math.max(
      0,
      Math.sin(v * 23 + fb(x * 0.02, y * 0.02, seed + 91) * 4.5)
    ); /* драпировка */
    const fk = cl((fold - 0.52) * 2.2, 0, 1);
    let base =
      0.2 +
      0.055 * m +
      0.03 * (tw - 0.5) +
      0.028 * (coarse - 0.5) +
      0.014 * (thr - 0.5) -
      0.02 * fk +
      0.01 * Math.max(0, Math.sin(v * 23 + 2.2 + fb(x * 0.02, y * 0.02, seed + 91) * 4.5) - 0.6);
    let r = base * 0.9,
      g = base * 1.0,
      b = base * 0.94;
    const pan = (((u * 4) % 1) + 1) % 1,
      seam = Math.min(pan, 1 - pan);
    const sLine = 1 - cl(seam / 0.03, 0, 1);
    r -= sLine * 0.058;
    g -= sLine * 0.052;
    b -= sLine * 0.05;
    /* двойная строчка: два ряда стежков по обе стороны шва + теневая канавка */
    const stA =
      Math.exp(-Math.pow((seam - 0.042) / 0.006, 2)) +
      Math.exp(-Math.pow((seam - 0.058) / 0.006, 2));
    const dash = 0.5 + 0.5 * Math.sin(v * 300);
    const stit = stA * cl((dash - 0.35) / 0.3, 0, 1);
    r += stit * 0.052;
    g += stit * 0.05;
    b += stit * 0.044;
    if (seam < 0.055 && Math.sin(u * 4 * Math.PI * 28) > 0.55) {
      r += 0.03;
      g += 0.03;
      b += 0.026;
    }
    /* передняя молния: u=0.75 — это локальная -Z, «лицо» модели */
    const zip = 1 - cl(Math.abs(u - 0.75) / 0.011, 0, 1);
    if (zip > 0) {
      const t2 = Math.sin(v * 200) * 0.5 + 0.5;
      r = r * (1 - zip * 0.55) + zip * (0.125 + 0.155 * t2);
      g = g * (1 - zip * 0.55) + zip * (0.13 + 0.16 * t2);
      b = b * (1 - zip * 0.55) + zip * (0.14 + 0.175 * t2);
    }
    const wear = Math.max(0, fb(x * 0.035 + 77, y * 0.035 + 13, seed + 53) - 0.62) * 2.4;
    r += wear * 0.055;
    g += wear * 0.058;
    b += wear * 0.05;
    /* отблеск на гребнях складок — ткань живёт */
    r += fk * 0.016;
    g += fk * 0.017;
    b += fk * 0.015;
    /* светоотражающая полоса — она же читается как рукав */
    const hv = 1 - cl(Math.abs(v - 0.3) / 0.02, 0, 1),
      hu = wstrip(u, 4, 0.12);
    if (hv * hu > 0.01) {
      const k = hv * hu;
      r += k * 0.105;
      g += k * 0.105;
      b += k * 0.078;
    }
    const h =
      0.44 +
      0.18 * (tw - 0.5) +
      0.18 * m +
      0.3 * sLine +
      0.34 * zip -
      0.12 * wear +
      0.1 * fk +
      0.08 * (thr - 0.5) +
      0.22 * stit -
      0.1 * stA;
    return [r, g, b, cl(h, 0, 1)];
  });

  /* --- штаны: тонкая саржа, боковой шов, складки на коленях --- */
  fill(PREG.pants, (u, v, x, y) => {
    /* брючная ткань тоньше: тонкое двухниточное переплетение, поперечные складки на
   колене и сидении, строчка бокового шва, микршум ворса. */
    const tw =
      0.5 +
      0.2 * Math.sin(x * 1.7 + y * 0.7) +
      0.12 * Math.sin(x * 0.7 - y * 1.7) +
      0.09 * Math.sin(x * 3.3 + y * 2.6) +
      0.05 * Math.sin(x * 5.6 - y * 4.8);
    const thr = fb2(x * 1.1 + 31, y * 1.1 + 17, seed + 161);
    const m = fb2(x * 0.095 + 53, y * 0.095 + 19, seed + 15);
    const fold = Math.max(0, Math.sin(v * 44 + fb(x * 0.03, y * 0.03, seed + 71) * 5));
    const fk = cl((fold - 0.55) * 2.4, 0, 1) * 0.6;
    const crease = Math.max(
      0,
      Math.sin(v * 13 + fb(x * 0.015, y * 0.05, seed + 171) * 3.0)
    ); /* крупные заломы */
    const crk = cl((crease - 0.72) * 3.0, 0, 1);
    let base =
      0.132 + 0.04 * m + 0.026 * (tw - 0.5) + 0.012 * (thr - 0.5) - 0.016 * crk + 0.01 * fk;
    let r = base * 0.93,
      g = base * 1.0,
      b = base * 1.15;
    const side = 1 - cl(Math.abs(((u * 2) % 1) - 0.5) / 0.04, 0, 1);
    r -= side * 0.03;
    g -= side * 0.03;
    b -= side * 0.026;
    /* строчка вдоль бокового шва */
    const stB =
      Math.exp(-Math.pow((Math.abs(((u * 2) % 1) - 0.5) - 0.055) / 0.006, 2)) *
      cl((0.5 + 0.5 * Math.sin(v * 320) - 0.35) / 0.3, 0, 1);
    r += stB * 0.04;
    g += stB * 0.04;
    b += stB * 0.036;
    r += fk * 0.02;
    g += fk * 0.02;
    b += fk * 0.022;
    const h =
      0.46 + 0.16 * (tw - 0.5) + 0.2 * m + 0.24 * fk + 0.08 * (thr - 0.5) + 0.18 * stB - 0.14 * crk;
    return [r, g, b, cl(h, 0, 1)];
  });

  /* --- ботинки и ремень: зерно кожи, трещины, рант, шнуровка --- */
  fill(PREG.boot, (u, v, x, y) => {
    /* кожа с порами и мелкими трещинами, рант со строчкой вокруг подошвы, износ на
   сгибах — ботинок выглядит «взрослым». */
    const g1 = fb2(x * 0.42 + 5, y * 0.42 + 61, seed + 27);
    const g2 = fb(x * 0.075 + 3, y * 0.075 + 83, seed + 39);
    const pore = H(x, y, seed + 181);
    const grain = fb2(x * 1.3 + 61, y * 1.3 + 7, seed + 191);
    const crack =
      Math.max(0, rid(x * 0.16 + 21, y * 0.16 + 9, seed + 61) - 0.86) * 6.5 +
      Math.max(0, rid(x * 0.34 + 5, y * 0.34 + 77, seed + 201) - 0.9) * 4.0;
    const crease = Math.max(
      0,
      Math.sin(v * 52 + fb(x * 0.05, y * 0.05, seed + 211) * 4.0)
    ); /* заломы кожи на сгибах */
    const crk = cl((crease - 0.78) * 3.4, 0, 1);
    let base =
      0.086 +
      0.045 * g2 +
      0.03 * (g1 - 0.5) +
      0.016 * (grain - 0.5) -
      0.01 * (pore > 0.93 ? 1 : 0) -
      0.014 * crk +
      0.01 * Math.max(0, crease - 0.5);
    let r = base * 1.02,
      g = base * 0.95,
      b = base * 0.9;
    r -= crack * 0.03;
    g -= crack * 0.03;
    b -= crack * 0.028;
    const sole = 1 - cl(Math.abs(v - 0.06) / 0.05, 0, 1);
    r -= sole * 0.045;
    g -= sole * 0.045;
    b -= sole * 0.045;
    /* рант: полоса + пунктирная строчка над подошвой */
    const welt = 1 - cl(Math.abs(v - 0.135) / 0.018, 0, 1);
    const wst = welt * cl((0.5 + 0.5 * Math.sin(u * 220) - 0.3) / 0.4, 0, 1);
    r += welt * 0.03 + wst * 0.045;
    g += welt * 0.028 + wst * 0.042;
    b += welt * 0.024 + wst * 0.036;
    const lac = Math.sin(v * 34) * 0.5 + 0.5,
      lz = 1 - cl(Math.abs(u - 0.75) / 0.07, 0, 1);
    if (lz * lac > 0.05) {
      const k = lz * lac * 0.85;
      r += k * 0.055;
      g += k * 0.052;
      b += k * 0.048;
    }
    const h =
      0.42 +
      0.24 * g1 +
      0.16 * g2 -
      0.34 * crack +
      0.3 * lz * lac +
      0.1 * (grain - 0.5) +
      0.3 * wst +
      0.16 * welt -
      0.2 * crk -
      0.1 * (pore > 0.93 ? 1 : 0);
    return [r, g, b, cl(h, 0, 1)];
  });

  /* --- волосы: пряди вдоль v, пробор --- */
  fill(PREG.hair, (u, v, x, y) => {
    /* пряди в двух масштабах + редкие глянцевые локоны, тёмные корни у пробора и
   края — волосы перестают быть однотонной «занавеской». */
    const strand = 0.5 + 0.5 * Math.sin(u * 320 + fb(x * 0.05, y * 0.05, seed + 83) * 7);
    const fine = 0.5 + 0.5 * Math.sin(u * 760 + fb(x * 0.12, y * 0.12, seed + 221) * 9);
    const gloss = Math.max(0, Math.sin(u * 47 + fb(x * 0.02, y * 0.02, seed + 231) * 3.0));
    const gl = cl((gloss - 0.86) * 7, 0, 1) * cl((v - 0.25) / 0.5, 0, 1);
    const m = fb2(x * 0.11 + 71, y * 0.11 + 3, seed + 19);
    let base = 0.054 + 0.034 * m + 0.03 * (strand - 0.5) + 0.014 * (fine - 0.5) + 0.045 * gl;
    const root = cl((0.16 - v) / 0.16, 0, 1);
    base -= root * 0.016;
    let r = base * 1.12,
      g = base * 0.94,
      b = base * 0.84;
    const part = 1 - cl(Math.abs(u - 0.25) / 0.018, 0, 1);
    r -= part * 0.02;
    g -= part * 0.018;
    b -= part * 0.016;
    const h = 0.4 + 0.32 * strand + 0.2 * m + 0.12 * fine - 0.18 * root + 0.1 * gl;
    return [r, g, b, cl(h, 0, 1)];
  });

  /* --- металлическая фурнитура поверх зоны ботинка: пряжка ремня и жетон --- */
  {
    const reg = PREG.boot,
      x0 = Math.round(reg.u0 * SZ),
      w = Math.round((reg.u1 - reg.u0) * SZ);
    const put = (u0, v0, uu, vv, kind) => {
      const wi = Math.max(2, Math.round(uu * w)),
        hi = Math.max(2, Math.round(vv * SZ));
      for (let j = 0; j < hi; j++)
        for (let i = 0; i < wi; i++) {
          const x = x0 + Math.round(u0 * w) + i,
            y = Math.round((v0 + j / SZ) * SZ);
          if (x < 0 || x >= SZ || y < 0 || y >= SZ) continue;
          const lu = i / (wi - 1),
            lv = j / (hi - 1);
          let r, g, b, h;
          if (kind === 1) {
            const edge = Math.min(Math.min(lu, 1 - lu), Math.min(lv, 1 - lv));
            const fr = 1 - cl(edge / 0.11, 0, 1);
            const br = 0.28 + 0.36 * Math.pow(cl(1 - Math.abs(lu - 0.34) * 2.2, 0, 1), 1.6);
            r = 0.28 + br * 0.55 + fr * 0.1;
            g = 0.25 + br * 0.5 + fr * 0.09;
            b = 0.19 + br * 0.36 + fr * 0.07;
            h = 0.52 + 0.38 * fr - 0.22 * (1 - fr);
          } else {
            const dx = (lu - 0.5) * 1.7,
              dy = lv - 0.5,
              rr = dx * dx + dy * dy * 2.4;
            const br = 0.2 + 0.42 * Math.pow(cl(1 - Math.abs(lu - 0.3) * 2.0, 0, 1), 1.4);
            if (rr < 0.62) {
              r = 0.15 + br * 0.3;
              g = 0.16 + br * 0.32;
              b = 0.19 + br * 0.36;
              h = 0.82;
            } else {
              r = 0.072;
              g = 0.07;
              b = 0.068;
              h = 0.34;
            }
            if (rr < 0.62 && lv > 0.58 && lv < 0.7) {
              r += 0.11;
              g += 0.035;
              b += 0.02;
            }
          }
          const o = (y * SZ + x) * 4;
          data[o] = cl(r * 255, 0, 255) | 0;
          data[o + 1] = cl(g * 255, 0, 255) | 0;
          data[o + 2] = cl(b * 255, 0, 255) | 0;
          data[o + 3] = cl(h * 255, 0, 255) | 0;
        }
    };
    put(0.3, 0.5, 0.17, 0.11, 1);
    put(0.6, 0.76, 0.11, 0.08, 2);
  }
  /* общее зерно, чтобы зоны не выглядели «цифровыми» */
  const gr = xsBulk(
    G.u32()
  ); /* массовая развёртка: 10⁶ выборок из BigInt-генератора были бы слишком медленными */
  for (let i = 0; i < data.length; i += 4) {
    const n = (gr() - 0.5) * 0.018 * 255;
    data[i] = cl(data[i] + n, 0, 255) | 0;
    data[i + 1] = cl(data[i + 1] + n, 0, 255) | 0;
    data[i + 2] = cl(data[i + 2] + n, 0, 255) | 0;
  }
  return data;
}

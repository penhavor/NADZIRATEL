function buildAtlasData(st, qq) {
  /* st — состояние сида (BigUint64Array), поток XS_TEX */
  qq = qq || Q;
  const det = Math.max(0.05, Math.min(1, qq.det === undefined ? 1 : qq.det));
  const micro = Math.max(0, Math.min(1, qq.micro || 0));
  const G = xsStream(st, XS_TEX);
  const rnd = G.rnd;
  const texTag = G.u32() | 0; /* тег для позиционных хэшей (хэш угла кирпича) */
  const rr = (a, b) => a + rnd() * (b - a);
  const k = AQ / 256;
  const H = 256;
  const N = (base, extra) => Math.max(0, Math.round(base * det + (extra || 0) * micro));
  const P = p => rnd() < p * det + micro * 0.15;
  /* хэш угла кирпича: одинаков для обеих половин кирпича, разрезанного краем
   квадрата атласа (cw4 = колонка по модулю 4) — половины остаются согласованными */
  const chH = (r, cw4, ci) => {
    let h =
      Math.imul(r + 11, 374761393) ^
      Math.imul(cw4 + 23, 668265263) ^
      Math.imul(ci + 7, 1442695041) ^
      Math.imul((texTag >>> 0) + 91, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  /* крупные пятна рисуются в 9 (торовых) смещениях: пятно, пересекающее край
   квадрата, продолжается на грани соседней клетки — шов невидим */
  const wrap9 = (fx, fy, fn) => {
    for (const dy of [-H, 0, H]) for (const dx of [-H, 0, H]) fn(fx + dx, fy + dy);
  };
  const col = makeTex(
    x => {
      x.scale(k, k);
      x.fillStyle = '#191c21';
      x.fillRect(
        0,
        0,
        1024,
        1024
      ); /* фон: неиспользуемые тайлы не должны быть прозрачными (иначе мипы тянут
   alpha 0); тёмный — торец двери берёт его как albedo */
      x.fillStyle = '#454a54';
      x.fillRect(0, 0, H, H); /* раствор серый, а не чёрный */
      const rows = 10,
        bh = H / rows,
        bw = H / 4;

      if (micro > 0) {
        for (let i = 0; i < N(0, 26); i++) {
          x.fillStyle =
            'rgba(' +
            (rr(24, 58) | 0) +
            ',' +
            (rr(26, 58) | 0) +
            ',' +
            (rr(30, 60) | 0) +
            ',' +
            rr(0.1, 0.3).toFixed(2) +
            ')';
          const ex = rr(0, H),
            ey = rr(0, H),
            e1 = rr(6, 34),
            e2 = rr(4, 20),
            e3 = rr(0, 3);
          wrap9(ex, ey, (X, Y) => {
            x.beginPath();
            x.ellipse(X, Y, e1, e2, e3, 0, 7);
            x.fill();
          });
        }
      }
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) * (bw / 2);
        for (let cX = -1; cX < 5; cX++) {
          const cw4 = ((cX % 4) + 4) % 4;
          const bhsh = (((r * 73856093) ^ ((cw4 + 8) * 19349663)) >>> 0) / 4294967296;
          const br = xsSub(
            st,
            0x1000 + r * 4 + cw4
          ).rnd; /* ключ — (row, cw4): обе половины кирпича, разрезанного краем атласа, остаются
   одинаковыми */
          const brr = (a, b) => a + br() * (b - a);
          let hue, sat, l;
          if (bhsh < 0.16) {
            hue = rr(12, 28);
            sat = rr(10, 20) * (0.5 + 0.5 * det);
            l = rr(25, 34);
          } else {
            hue = rr(206, 224);
            sat = rr(5, 10) * (0.6 + 0.4 * det);
            l = rr(20, 31) * (1 - 0.1 * (1 - det));
          }
          x.fillStyle = 'hsl(' + hue.toFixed(0) + ',' + sat.toFixed(0) + '%,' + l.toFixed(0) + '%)';
          const bx0 = cX * bw + off + 2,
            by0 = r * bh + 2,
            bW0 = bw - 4,
            bH0 = bh - 4;
          rrect(x, bx0, by0, bW0, bH0, 2.6);
          x.fill();
          const g = x.createLinearGradient(0, r * bh, 0, r * bh + bh);
          g.addColorStop(0, 'rgba(255,255,255,0.07)');
          g.addColorStop(0.55, 'rgba(255,255,255,0)');
          g.addColorStop(1, 'rgba(0,0,0,0.25)');
          x.fillStyle = g;
          rrect(x, bx0, by0, bW0, bH0, 2.6);
          x.fill();

          if (micro > 0) {
            const bx = cX * bw + off + 2,
              by = r * bh + 2,
              bW = bw - 4,
              bH = bh - 4;
            for (let i = 0; i < N(0, 26); i++) {
              const a = rr(0.05, 0.2) * micro;
              x.fillStyle =
                (br() < 0.5 ? 'rgba(255,246,232,' : 'rgba(10,10,14,') + a.toFixed(3) + ')';
              x.fillRect(bx + brr(0, bW), by + brr(0, bH), brr(0.8, 2.6), brr(0.8, 2.6));
            }
            if (br() < 0.3 * micro) {
              const gx = bx + brr(4, bW - 8),
                gw = brr(3, 9);
              const gs = x.createLinearGradient(0, by + bH * 0.35, 0, by + bH);
              gs.addColorStop(0, 'rgba(226,228,220,0)');
              gs.addColorStop(1, 'rgba(226,228,220,' + (0.1 * micro).toFixed(3) + ')');
              x.fillStyle = gs;
              x.fillRect(gx, by + bH * 0.35, gw, bH * 0.65);
            }
            if (br() < 0.42) {
              x.fillStyle = 'rgba(198,196,186,' + (0.05 + 0.05 * micro).toFixed(3) + ')';
              x.fillRect(bx, by, bW, brr(0.8, 1.8));
            }
            /* сколы albedo: те же углы и радиусы, что и в карте высот (chH) — верхние и
   нижние углы кирпича, половины поперёк края квадрата совпадают */
            for (let ci = 0; ci < 4; ci++) {
              const mi = cX + (ci === 1 || ci === 3 ? 1 : 0),
                e = r + (ci >= 2 ? 1 : 0);
              const mw4 = ((mi % 4) + 4) % 4;
              const hh = chH(mw4, e, 0);
              if (hh < 0.3) {
                const rd = 2 + chH(mw4, e, 64) * 2.6,
                  ang = chH(mw4, e, 131) * 3.1416,
                  ecc = 0.7 + 0.3 * chH(mw4, e, 197);
                const cxp = bx + (ci === 1 || ci === 3 ? bW : 0),
                  cyp = by + (ci >= 2 ? bH : 0);
                x.fillStyle = 'rgba(62,60,56,0.68)';
                x.beginPath();
                x.ellipse(cxp, cyp, rd, rd * ecc, ang, 0, 7);
                x.fill();
                x.strokeStyle = 'rgba(228,216,198,0.38)';
                x.lineWidth = 1.1;
                x.beginPath();
                x.ellipse(
                  cxp,
                  cyp,
                  rd * 0.72,
                  rd * 0.72 * ecc,
                  ang,
                  Math.PI * 1.02,
                  Math.PI * 1.78
                );
                x.stroke();
              }
            }
          }
        }
      }
      for (let i = 0; i < N(6, 4); i++) {
        x.fillStyle =
          'rgba(' +
          ((140 + rr(0, 40)) | 0) +
          ',' +
          ((142 + rr(0, 40)) | 0) +
          ',' +
          ((135 + rr(0, 40)) | 0) +
          ',0.09)';
        const ex = rr(0, H),
          ey = rr(0, H),
          e1 = rr(18, 60),
          e2 = rr(12, 40),
          e3 = rr(0, 3);
        wrap9(ex, ey, (X, Y) => {
          x.beginPath();
          x.ellipse(X, Y, e1, e2, e3, 0, 7);
          x.fill();
        });
      }
      for (let i = 0; i < N(12, 8); i++) {
        const gx = rr(0, H),
          gy = rr(0, H),
          gr = rr(24, 80);
        wrap9(gx, gy, (X, Y) => {
          const g = x.createRadialGradient(X, Y, 0, X, Y, gr);
          g.addColorStop(0, 'rgba(0,0,0,0.28)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          x.fillStyle = g;
          x.fillRect(X - gr, Y - gr, gr * 2, gr * 2);
        });
      }

      x.fillStyle = '#2b2e34';
      x.fillRect(H, 0, H, H);
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          const sx = H + (i * H) / 2,
            sy = (j * H) / 2;
          x.fillStyle = 'hsl(216,' + rr(4, 9).toFixed(0) + '%,' + rr(17, 25).toFixed(0) + '%)';
          x.fillRect(sx, sy, H / 2, H / 2);
          const g = x.createLinearGradient(sx, sy, sx + H / 2, sy + H / 2);
          g.addColorStop(0, 'rgba(255,255,255,0.05)');
          g.addColorStop(1, 'rgba(0,0,0,0.18)');
          x.fillStyle = g;
          x.fillRect(sx, sy, H / 2, H / 2);
          for (let q = 0; q < N(240, 220); q++) {
            x.fillStyle =
              'rgba(' +
              (rr(90, 150) | 0) +
              ',' +
              (rr(95, 150) | 0) +
              ',' +
              (rr(100, 150) | 0) +
              ',' +
              rr(0.03, 0.1).toFixed(2) +
              ')';
            x.fillRect(sx + rr(0, H / 2), sy + rr(0, H / 2), rr(1, 2.4), rr(1, 2.4));
          }
          if (micro > 0) {
            for (let q = 0; q < N(0, 26); q++) {
              const px = sx + rr(4, H / 2 - 4),
                py = sy + rr(4, H / 2 - 4),
                pr = rr(1.2, 3.4);
              const gp = x.createRadialGradient(px - pr * 0.3, py - pr * 0.3, 0, px, py, pr);
              gp.addColorStop(
                0,
                'rgba(' +
                  (rr(150, 196) | 0) +
                  ',' +
                  (rr(150, 196) | 0) +
                  ',' +
                  (rr(152, 198) | 0) +
                  ',' +
                  (0.3 * micro).toFixed(2) +
                  ')'
              );
              gp.addColorStop(1, 'rgba(60,64,72,' + (0.22 * micro).toFixed(2) + ')');
              x.fillStyle = gp;
              x.beginPath();
              x.ellipse(px, py, pr, pr * rr(0.7, 1.0), rr(0, 3), 0, 7);
              x.fill();
            }
            for (let q = 0; q < N(0, 7); q++) {
              const px = sx + rr(6, H / 2 - 6),
                py = sy + rr(6, H / 2 - 6),
                pr = rr(8, 26);
              const gs = x.createRadialGradient(px, py, 0, px, py, pr);
              gs.addColorStop(0, 'rgba(226,232,240,' + (0.055 * micro).toFixed(3) + ')');
              gs.addColorStop(1, 'rgba(226,232,240,0)');
              x.fillStyle = gs;
              x.beginPath();
              x.ellipse(px, py, pr, pr * rr(0.35, 0.7), rr(0, 3), 0, 7);
              x.fill();
            }
            for (let q = 0; q < N(0, 10); q++) {
              x.strokeStyle = 'rgba(210,216,226,' + (0.03 + 0.05 * micro).toFixed(3) + ')';
              x.lineWidth = rr(0.7, 2.0);
              const px = sx + rr(2, H / 2 - 2),
                py = sy + rr(2, H / 2 - 2);
              x.beginPath();
              x.moveTo(px, py);
              x.lineTo(px + rr(-30, 30), py + rr(-30, 30));
              x.stroke();
            }
          }
        }

      {
        const X = 2 * H,
          Y = 0;
        /* деревянная дверная створка — чистые доски (фурнитура объёмная, см.
   buildSafeHwData). Рельеф соответствует доскам; пояса и ручка дают только
   контактные тени: металл никогда не рисуется в albedo дерева. */
        const kp = i => {
          const r = xsSub(st, 0x2000 + i).rnd;
          return {
            has: r() < 0.72,
            kx: r(),
            ky: r(),
            ca: r(),
            cb: r(),
            shas: r() < 0.6,
            sx: r(),
            top: r() < 0.5,
            sl: r()
          };
        };
        const grJ = (yy, i) =>
          Math.sin(yy * 0.085 + i * 13.7) * 0.7 +
          Math.sin(yy * 0.021 + i * 5.3) * 0.55; /* дрожание паза: общее для albedo и рельефа */
        x.fillStyle = '#140c05';
        x.fillRect(X, Y, H, H);
        const planks = 5,
          pw = H / planks;
        for (let i = 0; i < planks; i++) {
          const px = X + i * pw,
            K = kp(i);
          const br = xsSub(st, 0x3000 + i).rnd;
          const brr = (a, b) => a + br() * (b - a);
          var hue = brr(19, 30) | 0,
            sat = brr(24, 36) | 0,
            li = brr(13, 21) | 0;
          if (br() < 0.14) {
            hue = brr(24, 40) | 0;
            sat = brr(7, 13) | 0;
            li = brr(17, 24) | 0;
          } /* серая ремонтная доска */
          const gB = x.createLinearGradient(px, 0, px + pw, 0);
          gB.addColorStop(0, 'hsl(' + hue + ',' + sat + '%,' + (li + 3) + '%)');
          gB.addColorStop(0.12, 'hsl(' + hue + ',' + sat + '%,' + (li + 1) + '%)');
          gB.addColorStop(0.55, 'hsl(' + hue + ',' + sat + '%,' + li + '%)');
          gB.addColorStop(1, 'hsl(' + (hue - 2) + ',' + sat + '%,' + (li - 3) + '%)');
          x.fillStyle = gB;
          x.fillRect(px, Y, pw, H);
          x.save();
          x.beginPath();
          x.rect(px + 1.5, Y, pw - 3, H);
          x.clip();
          for (let g2 = 0; g2 < N(52, 44); g2++) {
            /* волокна: длинные волнистые двухтонные штрихи */
            const gx = px + brr(2, pw - 2),
              dark = br() < 0.62;
            x.strokeStyle = dark
              ? 'rgba(30,17,7,' + brr(0.05, 0.2).toFixed(3) + ')'
              : 'rgba(170,128,80,' + brr(0.05, 0.12).toFixed(3) + ')';
            x.lineWidth = brr(0.5, 1.7);
            const ph = brr(0, 6.3),
              am = brr(0.6, 2.4),
              ww = brr(0.015, 0.05);
            x.beginPath();
            x.moveTo(gx, Y);
            for (let yy = 0; yy <= H; yy += 12) x.lineTo(gx + Math.sin(yy * ww + ph) * am, Y + yy);
            x.stroke();
          }
          if (br() < 0.8) {
            /* соборный рисунок: вложенные дуги распила */
            const kx = px + pw * brr(0.25, 0.75),
              ky = Y + brr(-0.25, 1.25) * H,
              st = 3 + (brr(0, 3) | 0);
            for (let q2 = 1; q2 <= st; q2++) {
              x.strokeStyle = 'rgba(46,26,12,' + brr(0.1, 0.2).toFixed(3) + ')';
              x.lineWidth = brr(0.9, 1.8);
              x.beginPath();
              x.ellipse(kx, ky, q2 * brr(2.6, 3.6), q2 * brr(7, 11), brr(-0.06, 0.06), 0, 7);
              x.stroke();
            }
          }
          if (K.has) {
            /* сучок: кольца, тёмное ядро, радиальные трещины */
            const kx = px + pw * (0.3 + 0.4 * K.kx),
              ky = Y + H * (0.12 + 0.76 * K.ky);
            for (let q2 = 5; q2 > 0; q2--) {
              x.strokeStyle = 'rgba(24,13,6,' + (0.62 - q2 * 0.09).toFixed(2) + ')';
              x.lineWidth = 1.4;
              x.beginPath();
              x.ellipse(kx, ky, q2 * 2.1, q2 * 3.4, K.ca - 0.5, 0, 7);
              x.stroke();
            }
            x.fillStyle = 'rgba(14,8,3,0.9)';
            x.beginPath();
            x.ellipse(kx, ky, 1.7, 2.6, 0, 0, 7);
            x.fill();
            x.strokeStyle = 'rgba(20,11,5,0.55)';
            x.lineWidth = 0.9;
            x.beginPath();
            x.moveTo(kx, ky - 3);
            x.lineTo(kx + (K.ca * 4 - 2), ky - brr(10, 26));
            x.stroke();
            x.beginPath();
            x.moveTo(kx, ky + 3);
            x.lineTo(kx + (K.cb * 4 - 2), ky + brr(10, 26));
            x.stroke();
          }
          for (let q2 = 0; q2 < N(0, 6); q2++) {
            /* вмятины: мягкие тёмные пятна */
            const dx2 = px + brr(3, pw - 3),
              dy2 = Y + brr(0, H),
              dr = brr(2, 7);
            const gD = x.createRadialGradient(dx2, dy2, 0, dx2, dy2, dr);
            gD.addColorStop(0, 'rgba(10,6,3,' + brr(0.1, 0.2).toFixed(3) + ')');
            gD.addColorStop(1, 'rgba(10,6,3,0)');
            x.fillStyle = gD;
            x.fillRect(dx2 - dr, dy2 - dr, dr * 2, dr * 2);
          }
          if (micro > 0) {
            for (let q2 = 0; q2 < N(0, 16); q2++) {
              /* лёгкие царапины */
              x.strokeStyle = 'rgba(226,198,150,' + (0.04 * micro + 0.02).toFixed(3) + ')';
              x.lineWidth = brr(0.4, 1.0);
              const sx2 = px + brr(2, pw - 2),
                sy2 = Y + brr(0, H);
              x.beginPath();
              x.moveTo(sx2, sy2);
              x.lineTo(sx2 + brr(-3, 3), sy2 + brr(-14, 14));
              x.stroke();
            }
            for (let q2 = 0; q2 < N(0, 5); q2++) {
              /* выветренные серые пятна */
              const wx2 = px + brr(0, pw),
                wy2 = Y + brr(0, H),
                wr = brr(6, 20);
              const gW = x.createRadialGradient(wx2, wy2, 0, wx2, wy2, wr);
              gW.addColorStop(0, 'rgba(146,140,128,' + (0.07 * micro).toFixed(3) + ')');
              gW.addColorStop(1, 'rgba(146,140,128,0)');
              x.fillStyle = gW;
              x.fillRect(wx2 - wr, wy2 - wr, wr * 2, wr * 2);
            }
          }
          x.restore();
          x.fillStyle = 'rgba(232,196,146,0.10)';
          x.fillRect(px + 1.2, Y, 1.6, H); /* фаска: свет слева */
          x.fillStyle = 'rgba(0,0,0,0.34)';
          x.fillRect(px + pw - 2.6, Y, 2.2, H); /* тень фаски справа */
          if (K.shas) {
            /* торцевой зазор: клин от края */
            const sx2 = px + 6 + (pw - 12) * K.sx,
              len = 26 + 54 * K.sl;
            x.strokeStyle = 'rgba(12,7,3,0.75)';
            x.lineWidth = 1.3;
            x.beginPath();
            x.moveTo(sx2, K.top ? Y : Y + H);
            for (let yy = 0; yy <= len; yy += 8)
              x.lineTo(sx2 + Math.sin(yy * 0.11) * 1.2, K.top ? Y + yy : Y + H - yy);
            x.stroke();
          }
        }
        for (let i = 1; i < planks; i++) {
          /* паз между досками: неровная щель + подсветка кромки */
          const gx = X + i * pw;
          x.strokeStyle = 'rgba(7,4,2,0.92)';
          x.lineWidth = 2.4;
          x.beginPath();
          x.moveTo(gx + grJ(0, i), Y);
          for (let yy = 0; yy <= H; yy += 16) x.lineTo(gx + grJ(yy, i), Y + yy);
          x.stroke();
          x.strokeStyle = 'rgba(214,178,128,0.09)';
          x.lineWidth = 1.0;
          x.beginPath();
          x.moveTo(gx - 2.4 + grJ(0, i), Y);
          for (let yy = 0; yy <= H; yy += 16) x.lineTo(gx - 2.4 + grJ(yy, i), Y + yy);
          x.stroke();
        }
        for (const cy of [0.2175, 0.7675]) {
          /* контактные тени поясов (пояса — геометрия; v инвертирована к y створки) */
          const y0 = Y + (cy - 0.0463) * H,
            y1 = Y + (cy + 0.0463) * H;
          for (const e of [
            [y0, -1],
            [y1, 1]
          ]) {
            const ye = e[0],
              sg = e[1];
            const gS = x.createLinearGradient(0, ye, 0, ye + sg * 9);
            gS.addColorStop(0, 'rgba(0,0,0,0.52)');
            gS.addColorStop(1, 'rgba(0,0,0,0)');
            x.fillStyle = gS;
            x.fillRect(X, Math.min(ye, ye + sg * 9), H, 9);
            x.fillStyle = 'rgba(0,0,0,0.30)';
            x.fillRect(X, sg < 0 ? ye - 1.6 : ye, H, 1.6);
          }
        }
        {
          /* ручка: кольцо AO вокруг бобышки */
          const hx2 = X + H * 0.76,
            hy2 = Y + H * 0.58;
          const gA = x.createRadialGradient(hx2, hy2, H * 0.05, hx2, hy2, H * 0.095);
          gA.addColorStop(0, 'rgba(0,0,0,0.34)');
          gA.addColorStop(1, 'rgba(0,0,0,0)');
          x.fillStyle = gA;
          x.fillRect(hx2 - H * 0.09, hy2 - H * 0.09, H * 0.18, H * 0.18);
        }
        const wear = x.createLinearGradient(0, Y + H * 0.8, 0, Y + H);
        wear.addColorStop(0, 'rgba(0,0,0,0)');
        wear.addColorStop(1, 'rgba(4,3,1,0.42)');
        x.fillStyle = wear;
        x.fillRect(X, Y + H * 0.8, H, H * 0.2);
        x.fillStyle = 'rgba(206,196,176,0.05)';
        x.fillRect(X, Y, H, H * 0.03);
        x.strokeStyle = 'rgba(0,0,0,0.42)';
        x.lineWidth = 2;
        x.strokeRect(X + 1, Y + 1, H - 2, H - 2);
        x.strokeStyle = 'rgba(255,222,170,0.06)';
        x.lineWidth = 1;
        x.strokeRect(X + 2.5, Y + 2.5, H - 5, H - 5);
      }
      x.fillStyle = '#191c22';
      x.fillRect(0, H, H, H);
      for (let i = 0; i < N(9, 8); i++) {
        const gx = rr(0, H),
          gy = H + rr(0, H),
          gr = rr(14, 52);
        wrap9(gx, gy, (X, Y) => {
          const g = x.createRadialGradient(X, Y, gr * 0.55, X, Y, gr);
          g.addColorStop(0, 'rgba(70,56,36,0)');
          g.addColorStop(0.75, 'rgba(72,58,38,0.14)');
          g.addColorStop(1, 'rgba(70,56,36,0)');
          x.fillStyle = g;
          x.fillRect(X - gr, Y - gr, gr * 2, gr * 2);
        });
      }
      for (let i = 0; i < N(400, 420); i++) {
        x.fillStyle = 'rgba(255,255,255,' + rr(0.01, 0.035).toFixed(3) + ')';
        x.fillRect(rr(0, H), H + rr(0, H), rr(1, 3), rr(1, 3));
      }
      if (micro > 0) {
        for (let i = 0; i < N(0, 10); i++) {
          const gx = rr(0, H),
            gy = H + rr(0, H);
          x.fillStyle =
            'rgba(' +
            (rr(120, 160) | 0) +
            ',' +
            (rr(122, 160) | 0) +
            ',' +
            (rr(118, 152) | 0) +
            ',' +
            (0.07 * micro).toFixed(3) +
            ')';
          const pts = [];
          for (let q = 0; q < 6; q++) pts.push([rr(-16, 16), rr(-14, 14)]);
          wrap9(gx, gy, (X, Y) => {
            x.beginPath();
            x.moveTo(X, Y);
            for (const q of pts) x.lineTo(X + q[0], Y + q[1]);
            x.closePath();
            x.fill();
          });
        }
        for (let i = 0; i < N(0, 9); i++) {
          const gx = rr(0, H),
            gy = H + rr(0, H),
            gr = rr(5, 18);
          wrap9(gx, gy, (X, Y) => {
            const g = x.createRadialGradient(X, Y, 0, X, Y, gr);
            g.addColorStop(0, 'rgba(126,70,32,' + (0.24 * micro).toFixed(2) + ')');
            g.addColorStop(1, 'rgba(126,70,32,0)');
            x.fillStyle = g;
            x.fillRect(X - gr, Y - gr, gr * 2, gr * 2);
          });
        }
      }

      {
        const X = H,
          Y = H;
        const g0 = x.createLinearGradient(X, Y, X + H, Y + H);
        g0.addColorStop(0, '#3f454d');
        g0.addColorStop(0.5, '#363c44');
        g0.addColorStop(1, '#2e333a');
        x.fillStyle = g0;
        x.fillRect(X, Y, H, H);
        for (let i = 0; i < N(420, 380); i++) {
          x.fillStyle = 'rgba(255,255,255,' + rr(0.012, 0.05).toFixed(3) + ')';
          const lx = X + rr(0, H);
          x.fillRect(lx, Y, 1, H);
        }
        for (let i = 0; i < N(150, 140); i++) {
          x.fillStyle = 'rgba(0,0,0,' + rr(0.02, 0.08).toFixed(3) + ')';
          const lx = X + rr(0, H);
          x.fillRect(lx, Y, rr(1, 2), H);
        }
        x.strokeStyle = 'rgba(8,10,14,0.92)';
        x.lineWidth = 9;
        x.strokeRect(X + 11, Y + 11, H - 22, H - 22);
        x.strokeStyle = 'rgba(196,206,218,0.16)';
        x.lineWidth = 2;
        x.strokeRect(X + 16.5, Y + 16.5, H - 33, H - 33);
        const panel = (px, py, pw2, ph2) => {
          const g1 = x.createLinearGradient(px, py, px, py + ph2);
          g1.addColorStop(0, '#272c33');
          g1.addColorStop(0.5, '#30363e');
          g1.addColorStop(1, '#23272e');
          x.fillStyle = g1;
          x.fillRect(px, py, pw2, ph2);
          x.strokeStyle = 'rgba(0,0,0,0.85)';
          x.lineWidth = 3;
          x.strokeRect(px, py, pw2, ph2);
          x.strokeStyle = 'rgba(210,220,232,0.14)';
          x.lineWidth = 1.5;
          x.beginPath();
          x.moveTo(px + 2, py + ph2 - 2);
          x.lineTo(px + 2, py + 2);
          x.lineTo(px + pw2 - 2, py + 2);
          x.stroke();
          x.strokeStyle = 'rgba(0,0,0,0.5)';
          x.beginPath();
          x.moveTo(px + pw2 - 2, py + 2);
          x.lineTo(px + pw2 - 2, py + ph2 - 2);
          x.lineTo(px + 2, py + ph2 - 2);
          x.stroke();
          if (micro > 0) {
            x.strokeStyle = 'rgba(150,160,172,' + (0.1 * micro).toFixed(3) + ')';
            x.lineWidth = 1.6;
            x.setLineDash && x.setLineDash([3, 2.5]);
            x.beginPath();
            x.moveTo(px + 8, py + ph2 * 0.5);
            x.lineTo(px + pw2 - 8, py + ph2 * 0.5);
            x.stroke();
            x.setLineDash && x.setLineDash([]);
            for (let q = 0; q < N(0, 26); q++) {
              x.fillStyle = 'rgba(0,0,0,' + (0.05 * micro + 0.02).toFixed(3) + ')';
              x.fillRect(px + rr(4, pw2 - 6), py + rr(4, ph2 - 6), rr(2, 10), rr(1, 4));
            }
          }
        };
        panel(X + 30, Y + 30, H - 60, H * 0.26);
        panel(X + 30, Y + H * 0.6, H - 60, H * 0.26);
        for (let i = 0; i < 22; i++) {
          const t = i / 22;
          const pts = [
            [X + 21, Y + 21 + t * (H - 42)],
            [X + H - 21, Y + 21 + t * (H - 42)],
            [X + 21 + t * (H - 42), Y + 21],
            [X + 21 + t * (H - 42), Y + H - 21]
          ];
          for (let q = 0; q < 4; q++) {
            const ax = pts[q][0],
              ay = pts[q][1];
            const g2 = x.createRadialGradient(ax - 1, ay - 1, 0, ax, ay, 4.2);
            g2.addColorStop(0, 'rgba(226,233,242,0.8)');
            g2.addColorStop(0.6, 'rgba(120,130,142,0.5)');
            g2.addColorStop(1, 'rgba(14,17,21,0.95)');
            x.fillStyle = g2;
            x.beginPath();
            x.arc(ax, ay, 3.3, 0, 7);
            x.fill();
          }
        }
        {
          const sx = X + H / 2 - 30,
            sy = Y + 30 + H * 0.13 - 11;
          x.fillStyle = 'rgba(10,14,12,0.9)';
          x.fillRect(sx - 3, sy - 3, 66, 26);
          x.fillStyle = '#0d3d24';
          x.fillRect(sx, sy, 60, 20);
          x.fillStyle = '#68ffa8';
          x.font = 'bold 13px sans-serif';
          x.textAlign = 'center';
          x.textBaseline = 'middle';
          x.fillText('ВЫХОД', sx + 30, sy + 11);
          x.textAlign = 'left';
          x.textBaseline = 'alphabetic';
          if (micro > 0) {
            x.fillStyle = 'rgba(190,210,200,' + (0.05 * micro).toFixed(3) + ')';
            x.fillRect(sx, sy, 60, 20);
            x.strokeStyle = 'rgba(220,240,230,' + (0.07 * micro).toFixed(3) + ')';
            x.lineWidth = 0.7;
            for (let q = 0; q < 5; q++) {
              const lx = sx + rr(2, 58);
              x.beginPath();
              x.moveTo(lx, sy + rr(1, 19));
              x.lineTo(lx + rr(-8, 8), sy + rr(1, 19));
              x.stroke();
            }
          }
        }
        x.save();
        x.beginPath();
        x.rect(X + 30, Y + H * 0.895, H - 60, H * 0.055);
        x.clip();
        for (let i = -6; i < 18; i++) {
          x.fillStyle = i % 2 ? '#c2992e' : '#10131a';
          x.beginPath();
          x.moveTo(X + 30 + i * 16, Y + H * 0.895);
          x.lineTo(X + 30 + i * 16 + 8, Y + H * 0.895);
          x.lineTo(X + 30 + i * 16 + 8 - H * 0.055, Y + H * 0.95);
          x.lineTo(X + 30 + i * 16 - H * 0.055, Y + H * 0.95);
          x.fill();
        }
        x.restore();
        if (micro > 0) {
          x.save();
          x.beginPath();
          x.rect(X + 30, Y + H * 0.895, H - 60, H * 0.055);
          x.clip();
          for (let q = 0; q < N(0, 26); q++) {
            x.fillStyle = 'rgba(28,30,34,' + (0.1 + 0.2 * micro).toFixed(2) + ')';
            x.fillRect(
              X + 30 + rr(0, H - 60),
              Y + H * 0.895 + rr(0, H * 0.055),
              rr(3, 16),
              rr(1, H * 0.055)
            );
          }
          x.restore();
        }
        for (let i = 0; i < N(7, 8); i++) {
          const gx = X + rr(0, H),
            gy = Y + H * 0.55 + rr(0, H * 0.45),
            gr = rr(10, 34);
          const g5 = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
          g5.addColorStop(0, 'rgba(122,66,28,0.30)');
          g5.addColorStop(0.6, 'rgba(96,52,22,0.14)');
          g5.addColorStop(1, 'rgba(80,44,18,0)');
          x.fillStyle = g5;
          x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
        }
        if (micro > 0) {
          for (let i = 0; i < N(0, 12); i++) {
            const gx = X + rr(6, H - 6),
              gy = Y + rr(H * 0.35, H - 10),
              gl = rr(10, 50);
            const g6 = x.createLinearGradient(0, gy, 0, gy + gl);
            g6.addColorStop(0, 'rgba(126,66,26,' + (0.24 * micro).toFixed(2) + ')');
            g6.addColorStop(1, 'rgba(126,66,26,0)');
            x.fillStyle = g6;
            x.fillRect(gx, gy, rr(1.0, 2.6), gl);
          }
          for (let i = 0; i < N(0, 14); i++) {
            const gx = X + rr(4, H - 8),
              gy = Y + rr(4, H - 8);
            x.fillStyle =
              'rgba(' +
              (rr(150, 190) | 0) +
              ',' +
              (rr(158, 196) | 0) +
              ',' +
              (rr(166, 204) | 0) +
              ',' +
              (0.16 * micro).toFixed(2) +
              ')';
            x.beginPath();
            x.ellipse(gx, gy, rr(1.5, 5), rr(1, 3.4), rr(0, 3), 0, 7);
            x.fill();
          }
        }
        for (let i = 0; i < N(12, 14); i++) {
          x.strokeStyle = 'rgba(200,210,222,' + rr(0.05, 0.16).toFixed(2) + ')';
          x.lineWidth = rr(0.5, 1.1);
          const sx2 = X + rr(0, H),
            sy2 = Y + rr(0, H);
          x.beginPath();
          x.moveTo(sx2, sy2);
          x.lineTo(sx2 + rr(-26, 26), sy2 + rr(-16, 16));
          x.stroke();
        }
      }

      /* ==== ТЫЛ железной двери (тайл 2,1): створка двусторонняя, albedo нужно обеим
   граням. Тот же язык фурнитуры, что и спереди, без знака и без сигнальной
   полосы; краска местами облупилась (matOf даёт этой зоне metal 0.45). ==== */
      {
        const X = 2 * H,
          Y = H;
        const g0 = x.createLinearGradient(X, Y + H, X + H, Y);
        g0.addColorStop(0, '#383e46');
        g0.addColorStop(0.5, '#31373f');
        g0.addColorStop(1, '#2a2f36');
        x.fillStyle = g0;
        x.fillRect(X, Y, H, H);
        for (let i = 0; i < N(380, 340); i++) {
          x.fillStyle = 'rgba(255,255,255,' + rr(0.01, 0.04).toFixed(3) + ')';
          const lx = X + rr(0, H);
          x.fillRect(lx, Y, 1, H);
        }
        for (let i = 0; i < N(120, 110); i++) {
          x.fillStyle = 'rgba(0,0,0,' + rr(0.02, 0.08).toFixed(3) + ')';
          const lx = X + rr(0, H);
          x.fillRect(lx, Y, rr(1, 2), H);
        }
        x.strokeStyle = 'rgba(8,10,14,0.92)';
        x.lineWidth = 9;
        x.strokeRect(X + 11, Y + 11, H - 22, H - 22);
        x.strokeStyle = 'rgba(196,206,218,0.14)';
        x.lineWidth = 2;
        x.strokeRect(X + 16.5, Y + 16.5, H - 33, H - 33);
        const pan = (px, py, pw2, ph2) => {
          const g1 = x.createLinearGradient(px, py, px, py + ph2);
          g1.addColorStop(0, '#252a31');
          g1.addColorStop(0.5, '#2d333b');
          g1.addColorStop(1, '#22262c');
          x.fillStyle = g1;
          x.fillRect(px, py, pw2, ph2);
          x.strokeStyle = 'rgba(0,0,0,0.85)';
          x.lineWidth = 3;
          x.strokeRect(px, py, pw2, ph2);
          x.strokeStyle = 'rgba(210,220,232,0.12)';
          x.lineWidth = 1.5;
          x.beginPath();
          x.moveTo(px + 2, py + ph2 - 2);
          x.lineTo(px + 2, py + 2);
          x.lineTo(px + pw2 - 2, py + 2);
          x.stroke();
          x.strokeStyle = 'rgba(0,0,0,0.5)';
          x.beginPath();
          x.moveTo(px + pw2 - 2, py + 2);
          x.lineTo(px + pw2 - 2, py + ph2 - 2);
          x.lineTo(px + 2, py + ph2 - 2);
          x.stroke();
        };
        pan(X + 30, Y + 30, H - 60, H * 0.26);
        pan(X + 30, Y + H * 0.6, H - 60, H * 0.26);
        for (let i = 0; i < 22; i++) {
          const t = i / 22;
          const pts = [
            [X + 21, Y + 21 + t * (H - 42)],
            [X + H - 21, Y + 21 + t * (H - 42)],
            [X + 21 + t * (H - 42), Y + 21],
            [X + 21 + t * (H - 42), Y + H - 21]
          ];
          for (let q = 0; q < 4; q++) {
            const ax = pts[q][0],
              ay = pts[q][1];
            const g2 = x.createRadialGradient(ax - 1, ay - 1, 0, ax, ay, 4.2);
            g2.addColorStop(0, 'rgba(226,233,242,0.75)');
            g2.addColorStop(0.6, 'rgba(120,130,142,0.5)');
            g2.addColorStop(1, 'rgba(14,17,21,0.95)');
            x.fillStyle = g2;
            x.beginPath();
            x.arc(ax, ay, 3.3, 0, 7);
            x.fill();
          }
        }
        /* облупившаяся краска: голое металлическое ядро с ореолом ржавчины */
        for (let i = 0; i < N(9, 10); i++) {
          const gx = X + rr(14, H - 14),
            gy = Y + rr(14, H - 14),
            gr = rr(8, 30);
          const g5 = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
          g5.addColorStop(0, 'rgba(122,128,138,0.55)');
          g5.addColorStop(0.55, 'rgba(96,62,30,0.30)');
          g5.addColorStop(1, 'rgba(80,44,18,0)');
          x.fillStyle = g5;
          x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
        }
      }

      /* ==== СТРОКА 2: мебельное дерево шкафа. Шпон: волокна вдоль V, тонкие волнистые
   нити и поры вдоль них, тональные пятна. Ни досок, ни обручей ящика — фурнитура
   шкафа отдельная. Вырезы граней берут ВНУТРЕННИЕ подрямоугольники тайлов (см.
   cabPartX), поэтому края тайлов и швы зеркальных копий никогда не попадают
   в UV. ==== */
      {
        const X = 0,
          Y = 2 * H;
        x.fillStyle = '#31200e';
        x.fillRect(X, Y, H, H);
        for (let i = 0; i < N(9, 7); i++) {
          /* тональные пятна шпона */
          const gx = rr(0, H),
            gy = Y + rr(0, H),
            gr = rr(28, 84);
          const g = x.createRadialGradient(gx, gy, gr * 0.25, gx, gy, gr);
          if (rnd() < 0.5) {
            g.addColorStop(0, 'rgba(98,66,32,0.20)');
          } else {
            g.addColorStop(0, 'rgba(22,13,6,0.22)');
          }
          g.addColorStop(1, 'rgba(0,0,0,0)');
          x.fillStyle = g;
          x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
        }
        for (let i = 0; i < N(6, 4); i++) {
          /* широкие мягкие полосы тона шпона */
          const bx = rr(0, H),
            bw2 = rr(14, 60),
            lt = rnd() < 0.5;
          const g = x.createLinearGradient(X + bx - bw2, 0, X + bx + bw2, 0);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(0.5, lt ? 'rgba(126,90,46,0.10)' : 'rgba(10,6,2,0.13)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          x.fillStyle = g;
          x.fillRect(X + bx - bw2, Y, bw2 * 2, H);
        }
        for (let i = 0; i < N(150, 120); i++) {
          /* волокна: волнистые линии вдоль V */
          const gx = rr(1.5, H - 1.5),
            ph = rr(0, 6.283),
            am = rr(0.5, 2.4),
            ww = rr(0.02, 0.09);
          if (rnd() < 0.62)
            x.strokeStyle =
              'rgba(' +
              (rr(30, 58) | 0) +
              ',' +
              (rr(18, 36) | 0) +
              ',' +
              (rr(7, 16) | 0) +
              ',' +
              rr(0.1, 0.3).toFixed(2) +
              ')';
          else
            x.strokeStyle =
              'rgba(' +
              (rr(122, 168) | 0) +
              ',' +
              (rr(88, 120) | 0) +
              ',' +
              (rr(48, 70) | 0) +
              ',' +
              rr(0.05, 0.14).toFixed(2) +
              ')';
          x.lineWidth = rr(0.5, 1.7);
          x.beginPath();
          x.moveTo(gx + Math.sin(ph) * am, Y);
          for (let yy = 8; yy <= H; yy += 8) x.lineTo(gx + Math.sin(yy * ww + ph) * am, Y + yy);
          x.stroke();
        }
        for (let i = 0; i < N(90, 70); i++) {
          /* поры — короткие штрихи вдоль волокон */
          x.fillStyle = 'rgba(16,9,4,' + rr(0.1, 0.26).toFixed(2) + ')';
          x.fillRect(X + rr(0, H), Y + rr(0, H), rr(0.6, 1.4), rr(3, 9));
        }
        const gs = x.createLinearGradient(X, 0, X + H, 0); /* мягкий отблеск поперёк волокон */
        gs.addColorStop(0, 'rgba(255,226,180,0.05)');
        gs.addColorStop(0.5, 'rgba(0,0,0,0)');
        gs.addColorStop(1, 'rgba(0,0,0,0.10)');
        x.fillStyle = gs;
        x.fillRect(X, Y, H, H);
      }
      {
        const X = H,
          Y = 2 * H; /* внутренность: тёмная необработанная доска */
        x.fillStyle = '#1c130a';
        x.fillRect(X, Y, H, H);
        for (let i = 0; i < N(8, 6); i++) {
          const gx = rr(0, H),
            gy = Y + rr(0, H),
            gr = rr(26, 70);
          const g = x.createRadialGradient(gx, gy, gr * 0.25, gx, gy, gr);
          g.addColorStop(0, 'rgba(58,38,18,0.16)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          x.fillStyle = g;
          x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
        }
        for (let i = 0; i < N(170, 140); i++) {
          const gx = rr(1.5, H - 1.5),
            ph = rr(0, 6.283),
            am = rr(0.6, 3.2),
            ww = rr(0.02, 0.12);
          if (rnd() < 0.7) x.strokeStyle = 'rgba(12,7,3,' + rr(0.14, 0.38).toFixed(2) + ')';
          else x.strokeStyle = 'rgba(96,68,36,' + rr(0.05, 0.12).toFixed(2) + ')';
          x.lineWidth = rr(0.6, 2.2);
          x.beginPath();
          x.moveTo(gx + Math.sin(ph) * am, Y);
          for (let yy = 8; yy <= H; yy += 8) x.lineTo(gx + Math.sin(yy * ww + ph) * am, Y + yy);
          x.stroke();
        }
        for (let i = 0; i < N(110, 90); i++) {
          x.fillStyle = 'rgba(8,5,2,' + rr(0.12, 0.3).toFixed(2) + ')';
          x.fillRect(X + rr(0, H), Y + rr(0, H), rr(0.7, 1.8), rr(3, 11));
        }
      }
      {
        const Dq = AQ;
        mirrorSquare(x, Dq, Dq, 2 * Dq, Dq, Dq);
        mirrorSquare(x, 0, 2 * Dq, 2 * Dq, 2 * Dq, Dq);
      }
      /* ==== СТРОКА 3: стол. Плиты независимы от дверного дерева: пласть доски,
   кромка, ножка, стальная стяжка. Вырезы граней — внутренние подрямоугольники
   (см. tblBox), плотность равномерная: TBL_SPAN клеток на сторону тайла. ==== */
      {
        const X = 0,
          Y = 3 * H,
          PB = 2,
          PT = 144.3,
          ph = (PT - PB) / 4; /* вырез пласти: v в [0,146.3] */
        x.fillStyle = '#201609';
        x.fillRect(X, Y, H, H);
        for (let i = 0; i < 4; i++) {
          const py = Y + PB + i * ph;
          x.fillStyle =
            'hsl(' +
            rr(25, 31).toFixed(0) +
            ',' +
            rr(30, 40).toFixed(0) +
            '%,' +
            rr(19, 27).toFixed(0) +
            '%)';
          x.fillRect(X, py + 1.1, H, ph - 2.2);
          for (let g2 = 0; g2 < N(26, 22); g2++) {
            /* волокна вдоль доски */
            if (rnd() < 0.62)
              x.strokeStyle =
                'rgba(' +
                (rr(30, 56) | 0) +
                ',' +
                (rr(18, 34) | 0) +
                ',' +
                (rr(8, 15) | 0) +
                ',' +
                rr(0.1, 0.3).toFixed(2) +
                ')';
            else
              x.strokeStyle =
                'rgba(' +
                (rr(148, 190) | 0) +
                ',' +
                (rr(110, 142) | 0) +
                ',' +
                (rr(70, 96) | 0) +
                ',' +
                rr(0.05, 0.12).toFixed(2) +
                ')';
            x.lineWidth = rr(0.6, 1.6);
            const gy = py + rr(2.5, ph - 2.5),
              ph2 = rr(0, 6.283),
              am = rr(0.5, 1.8),
              ww = rr(0.02, 0.08);
            x.beginPath();
            x.moveTo(X, gy);
            for (let xx = 16; xx <= H; xx += 16)
              x.lineTo(X + xx, gy + Math.sin(xx * ww + ph2) * am);
            x.stroke();
          }
          for (let q = 0; q < N(14, 10); q++) {
            /* поры вдоль волокон */
            x.fillStyle = 'rgba(20,12,5,' + rr(0.12, 0.26).toFixed(2) + ')';
            x.fillRect(X + rr(0, H), py + rr(2, ph - 2), rr(2, 7), rr(0.6, 1.3));
          }
          const gs = x.createLinearGradient(
            0,
            py,
            0,
            py + ph
          ); /* фаска доски: свет сверху, тень снизу */
          gs.addColorStop(0, 'rgba(255,226,180,0.10)');
          gs.addColorStop(0.25, 'rgba(255,226,180,0.0)');
          gs.addColorStop(0.8, 'rgba(0,0,0,0.06)');
          gs.addColorStop(1, 'rgba(0,0,0,0.22)');
          x.fillStyle = gs;
          x.fillRect(X, py + 1.1, H, ph - 2.2);
          if (P(0.5)) {
            /* сучок: кольца + ядро */
            const kx = X + rr(30, H - 30),
              ky = py + ph * 0.5 + rr(-4, 4);
            for (let q = 4; q > 0; q--) {
              x.strokeStyle = 'rgba(24,14,6,' + (0.52 - q * 0.1).toFixed(2) + ')';
              x.lineWidth = 1.4;
              x.beginPath();
              x.ellipse(kx, ky, q * 3.2, q * 2.0, rr(-0.3, 0.3), 0, 7);
              x.stroke();
            }
            x.fillStyle = 'rgba(16,9,4,0.85)';
            x.beginPath();
            x.ellipse(kx, ky, 2.4, 1.6, 0, 0, 7);
            x.fill();
          }
        }
        for (let i = 1; i < 4; i++) {
          /* паз между досками */
          const gy = Y + PB + i * ph;
          x.fillStyle = 'rgba(8,5,2,0.90)';
          x.fillRect(X, gy - 1.4, H, 2.8);
          x.fillStyle = 'rgba(255,214,160,0.10)';
          x.fillRect(X, gy + 1.4, H, 1.0);
        }
        for (let q = 0; q < N(10, 8); q++) {
          /* царапины износа */
          x.strokeStyle = 'rgba(214,186,146,' + rr(0.05, 0.13).toFixed(2) + ')';
          x.lineWidth = rr(0.5, 1.1);
          const sx2 = X + rr(6, H - 6),
            sy2 = Y + rr(4, PT - 4);
          x.beginPath();
          x.moveTo(sx2, sy2);
          x.lineTo(sx2 + rr(-26, 26), sy2 + rr(-5, 5));
          x.stroke();
        }
      }
      {
        const X = H,
          Y = 3 * H; /* кромка: волокна вдоль U */
        x.fillStyle = 'hsl(27,36%,21%)';
        x.fillRect(X, Y, H, H);
        for (let i = 0; i < N(46, 40); i++) {
          if (rnd() < 0.66)
            x.strokeStyle =
              'rgba(' +
              (rr(26, 50) | 0) +
              ',' +
              (rr(16, 30) | 0) +
              ',' +
              (rr(7, 13) | 0) +
              ',' +
              rr(0.1, 0.32).toFixed(2) +
              ')';
          else
            x.strokeStyle =
              'rgba(' +
              (rr(140, 182) | 0) +
              ',' +
              (rr(104, 136) | 0) +
              ',' +
              (rr(66, 90) | 0) +
              ',' +
              rr(0.05, 0.12).toFixed(2) +
              ')';
          x.lineWidth = rr(0.7, 2.0);
          const gy = Y + rr(2, H - 2),
            ph = rr(0, 6.283),
            am = rr(0.8, 2.6),
            ww = rr(0.01, 0.05);
          x.beginPath();
          x.moveTo(X, gy);
          for (let xx = 16; xx <= H; xx += 16) x.lineTo(X + xx, gy + Math.sin(xx * ww + ph) * am);
          x.stroke();
        }
        for (let i = 0; i < N(5, 4); i++) {
          x.fillStyle = 'rgba(12,7,3,' + rr(0.08, 0.16).toFixed(2) + ')';
          x.fillRect(X, Y + rr(4, H - 8), H, rr(2, 6));
        }
        for (let q = 0; q < N(30, 24); q++) {
          x.fillStyle = 'rgba(18,11,5,' + rr(0.12, 0.28).toFixed(2) + ')';
          x.fillRect(X + rr(0, H), Y + rr(0, H), rr(2, 8), rr(0.6, 1.4));
        }
      }
      {
        const X = 2 * H,
          Y = 3 * H; /* ножка: волокна вдоль V */
        x.fillStyle = 'hsl(26,34%,20%)';
        x.fillRect(X, Y, H, H);
        for (let i = 0; i < N(46, 40); i++) {
          if (rnd() < 0.66)
            x.strokeStyle =
              'rgba(' +
              (rr(26, 50) | 0) +
              ',' +
              (rr(16, 30) | 0) +
              ',' +
              (rr(7, 13) | 0) +
              ',' +
              rr(0.1, 0.32).toFixed(2) +
              ')';
          else
            x.strokeStyle =
              'rgba(' +
              (rr(140, 182) | 0) +
              ',' +
              (rr(104, 136) | 0) +
              ',' +
              (rr(66, 90) | 0) +
              ',' +
              rr(0.05, 0.12).toFixed(2) +
              ')';
          x.lineWidth = rr(0.7, 2.0);
          const gx = X + rr(2, H - 2),
            ph = rr(0, 6.283),
            am = rr(0.8, 2.6),
            ww = rr(0.01, 0.05);
          x.beginPath();
          x.moveTo(gx, Y);
          for (let yy = 16; yy <= H; yy += 16) x.lineTo(gx + Math.sin(yy * ww + ph) * am, Y + yy);
          x.stroke();
        }
        for (let i = 0; i < N(6, 5); i++) {
          const gx = X + rr(0, H),
            gy = Y + rr(0, H),
            gr = rr(20, 60);
          const g = x.createRadialGradient(gx, gy, gr * 0.2, gx, gy, gr);
          g.addColorStop(0, rnd() < 0.5 ? 'rgba(96,64,30,0.14)' : 'rgba(16,10,4,0.16)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          x.fillStyle = g;
          x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
        }
        for (let q = 0; q < N(30, 24); q++) {
          x.fillStyle = 'rgba(18,11,5,' + rr(0.12, 0.28).toFixed(2) + ')';
          x.fillRect(X + rr(0, H), Y + rr(0, H), rr(0.6, 1.4), rr(2, 8));
        }
      }
      {
        const X = 3 * H,
          Y = 3 * H; /* стяжка: шлифованная сталь, заклёпки вдоль поясов */
        const g0 = x.createLinearGradient(0, Y, 0, Y + H);
        g0.addColorStop(0, '#70767e');
        g0.addColorStop(0.5, '#565c64');
        g0.addColorStop(1, '#3f444b');
        x.fillStyle = g0;
        x.fillRect(X, Y, H, H);
        for (let i = 0; i < N(150, 120); i++) {
          /* штрихи шлифовки вдоль U */
          x.fillStyle =
            (rnd() < 0.5 ? 'rgba(210,220,232,' : 'rgba(18,22,28,') +
            rr(0.03, 0.09).toFixed(2) +
            ')';
          x.fillRect(X + rr(0, H * 0.7), Y + rr(0, H), rr(40, 256), rr(0.6, 1.4));
        }
        const dome = (cx, cy, r) => {
          const g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.35, 0, cx, cy, r);
          g.addColorStop(0, 'rgba(232,238,246,0.95)');
          g.addColorStop(0.7, 'rgba(148,156,166,0.9)');
          g.addColorStop(1, 'rgba(52,58,66,0.95)');
          x.fillStyle = g;
          x.beginPath();
          x.arc(cx, cy, r, 0, 7);
          x.fill();
          x.strokeStyle = 'rgba(10,12,16,0.8)';
          x.lineWidth = 1.2;
          x.beginPath();
          x.arc(cx, cy, r + 0.7, 0, 7);
          x.stroke();
        };
        for (const s of [0.1, 0.28, 0.5, 0.72, 0.9])
          dome(X + s * H, Y + 0.12 * H, 4.6); /* пояс A: заклёпки */
        x.fillStyle = 'rgba(15,18,22,0.55)';
        x.fillRect(X, Y + 0.226 * H, H, 2.4);
        for (const s of [0.1, 0.28, 0.5, 0.72, 0.9]) {
          dome(X + s * H, Y + 0.4 * H, 3.2); /* пояс B: винты */
          x.strokeStyle = 'rgba(8,10,12,0.85)';
          x.lineWidth = 1.0;
          x.beginPath();
          x.moveTo(X + s * H - 2.1, Y + 0.4 * H);
          x.lineTo(X + s * H + 2.1, Y + 0.4 * H);
          x.stroke();
        }
        x.fillStyle = 'rgba(15,18,22,0.55)';
        x.fillRect(X, Y + 0.506 * H, H, 2.4);
        x.fillRect(X, Y + 0.566 * H, H, 2.4);
      }
      noiseInto(x, AW, AH, Math.round(6 + 8 * det), rnd);
    },
    AW,
    AH
  );

  const hgt = makeTex(
    x => {
      x.scale(k, k);
      x.fillStyle = '#808080';
      x.fillRect(0, 0, 1024, 1024);
      const H2 = 256,
        rows = 10,
        bh = H2 / rows,
        bw = H2 / 4;
      x.fillStyle = '#3c3c3c';
      x.fillRect(0, 0, H2, H2);
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) * (bw / 2);
        for (let cX = -1; cX < 5; cX++) {
          const cw4 = ((cX % 4) + 4) % 4;
          const hs = (((r * 73856093) ^ ((cw4 + 8) * 19349663)) >>> 0) / 4294967296;
          const bx = cX * bw + off + 2,
            by = r * bh + 2,
            bW = bw - 4,
            bH = bh - 4;
          const base = 198 + (hs - 0.5) * 30;
          const gd = x.createRadialGradient(
            bx + bW * 0.5,
            by + bH * 0.5,
            1,
            bx + bW * 0.5,
            by + bH * 0.5,
            bW * 0.62
          );
          gd.addColorStop(
            0,
            'rgb(' + ((base + 12) | 0) + ',' + ((base + 12) | 0) + ',' + ((base + 12) | 0) + ')'
          );
          gd.addColorStop(0.72, 'rgb(' + (base | 0) + ',' + (base | 0) + ',' + (base | 0) + ')');
          gd.addColorStop(
            1,
            'rgb(' + ((base - 26) | 0) + ',' + ((base - 26) | 0) + ',' + ((base - 26) | 0) + ')'
          );
          x.fillStyle = gd;
          rrect(x, bx, by, bW, bH, 2.6);
          x.fill();
          const gb = x.createLinearGradient(0, by, 0, by + bH);
          gb.addColorStop(0, 'rgba(255,255,255,0.16)');
          gb.addColorStop(0.35, 'rgba(255,255,255,0)');
          gb.addColorStop(1, 'rgba(0,0,0,0.22)');
          x.fillStyle = gb;
          rrect(x, bx, by, bW, bH, 2.6);
          x.fill();
          for (let ci = 0; ci < 4; ci++) {
            const mi = cX + (ci === 1 || ci === 3 ? 1 : 0),
              e = r + (ci >= 2 ? 1 : 0);
            const mw4 = ((mi % 4) + 4) % 4;
            const hh = chH(mw4, e, 0);
            if (hh < 0.3) {
              const rd = 2 + chH(mw4, e, 64) * 2.6,
                ang = chH(mw4, e, 131) * 3.1416,
                ecc = 0.7 + 0.3 * chH(mw4, e, 197);
              const cxp = bx + (ci === 1 || ci === 3 ? bW : 0),
                cyp = by + (ci >= 2 ? bH : 0);
              x.fillStyle = '#3c3c3c';
              x.beginPath();
              x.ellipse(cxp, cyp, rd, rd * ecc, ang, 0, 7);
              x.fill();
            }
          }
        }
      }
      for (let i = 0; i < N(120, 150); i++) {
        x.fillStyle =
          'rgba(' +
          (rr(96, 176) | 0) +
          ',' +
          (rr(96, 176) | 0) +
          ',' +
          (rr(96, 176) | 0) +
          ',0.35)';
        x.fillRect(rr(0, H2), rr(0, H2), rr(0.8, 2.2), rr(0.8, 2.2));
      }
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          const tb = 194 + (((i * 2 + j) * 37) % 3) * 5;
          x.fillStyle = 'rgb(' + tb + ',' + tb + ',' + tb + ')';
          x.fillRect(H2 + (i * H2) / 2, (j * H2) / 2, H2 / 2, H2 / 2);
        }
      if (micro > 0) {
        for (let i = 0; i < N(0, 110); i++) {
          x.fillStyle =
            'rgba(' +
            (rr(110, 186) | 0) +
            ',' +
            (rr(110, 186) | 0) +
            ',' +
            (rr(110, 186) | 0) +
            ',0.30)';
          const px = H2 + rr(3, H2 - 3),
            py = rr(3, H2 - 3);
          x.beginPath();
          x.ellipse(px, py, rr(0.9, 2.6), rr(0.9, 2.2), rr(0, 3), 0, 7);
          x.fill();
        }
      }
      {
        const X = 2 * H2,
          Y = 0,
          planks = 5,
          pw = H2 / planks;
        /* рельеф створки: доски с фасками и пазами (grJ и kp те же, что в albedo), без
   поясов и ручки — они объёмные. Поверхность ~0.85, паз ~0.4. */
        const grJ = (yy, i) =>
          Math.sin(yy * 0.085 + i * 13.7) * 0.7 + Math.sin(yy * 0.021 + i * 5.3) * 0.55;
        for (let i = 0; i < planks; i++) {
          const px = X + i * pw;
          const K = (() => {
            const r = xsSub(
              st,
              0x2000 + i
            ).rnd; /* тот же тег, что и у kp в albedo — сучки совпадают */
            return {
              has: r() < 0.72,
              kx: r(),
              ky: r(),
              ca: r(),
              cb: r(),
              shas: r() < 0.6,
              sx: r(),
              top: r() < 0.5,
              sl: r()
            };
          })();
          const br = xsSub(st, 0x3000 + i).rnd; /* тот же тег, что и у волокон в albedo */
          const brr = (a, b) => a + br() * (b - a);
          const tb = (110 + ((i * 37) % 12)) | 0;
          x.fillStyle = 'rgb(' + tb + ',' + tb + ',' + tb + ')';
          x.fillRect(px, Y, pw, H2);
          x.save();
          x.beginPath();
          x.rect(px + 1.5, Y, pw - 3, H2);
          x.clip();
          for (let g2 = 0; g2 < N(34, 30); g2++) {
            /* волокна в рельефе — просто текстура */
            const gx = px + brr(2, pw - 2),
              dk = br() < 0.55;
            x.strokeStyle = dk
              ? 'rgba(96,96,96,' + brr(0.18, 0.36).toFixed(2) + ')'
              : 'rgba(128,128,128,' + brr(0.14, 0.3).toFixed(2) + ')';
            x.lineWidth = brr(0.5, 1.6);
            const ph = brr(0, 6.3),
              am = brr(0.5, 2.0),
              ww = brr(0.015, 0.05);
            x.beginPath();
            x.moveTo(gx, Y);
            for (let yy = 0; yy <= H2; yy += 12) x.lineTo(gx + Math.sin(yy * ww + ph) * am, Y + yy);
            x.stroke();
          }
          if (K.has) {
            /* сучок: чаша с бусиной */
            const kx = px + pw * (0.3 + 0.4 * K.kx),
              ky = Y + H2 * (0.12 + 0.76 * K.ky);
            x.fillStyle = 'rgb(92,92,92)';
            x.beginPath();
            x.ellipse(kx, ky, 5.5, 8.0, K.ca - 0.5, 0, 7);
            x.fill();
            x.strokeStyle = 'rgba(134,134,134,0.8)';
            x.lineWidth = 1.6;
            x.beginPath();
            x.ellipse(kx, ky, 7.0, 9.5, K.ca - 0.5, 0, 7);
            x.stroke();
          }
          for (let q2 = 0; q2 < N(0, 6); q2++) {
            /* вмятины */
            const dx2 = px + brr(3, pw - 3),
              dy2 = Y + brr(0, H2),
              dr = brr(2, 7);
            const gD = x.createRadialGradient(dx2, dy2, 0, dx2, dy2, dr);
            gD.addColorStop(0, 'rgba(88,88,88,' + brr(0.35, 0.6).toFixed(2) + ')');
            gD.addColorStop(1, 'rgba(88,88,88,0)');
            x.fillStyle = gD;
            x.fillRect(dx2 - dr, dy2 - dr, dr * 2, dr * 2);
          }
          if (K.shas) {
            /* торцевой зазор */
            const sx2 = px + 6 + (pw - 12) * K.sx,
              len = 26 + 54 * K.sl;
            x.strokeStyle = 'rgba(70,70,70,0.85)';
            x.lineWidth = 1.4;
            x.beginPath();
            x.moveTo(sx2, K.top ? Y : Y + H2);
            for (let yy = 0; yy <= len; yy += 8)
              x.lineTo(sx2 + Math.sin(yy * 0.11) * 1.2, K.top ? Y + yy : Y + H2 - yy);
            x.stroke();
          }
          x.restore();
          x.fillStyle = 'rgb(126,126,126)';
          x.fillRect(px + 1.2, Y, 1.6, H2); /* левая фаска идёт выше */
          x.fillStyle = 'rgb(96,96,96)';
          x.fillRect(px + pw - 2.6, Y, 2.2, H2); /* правая фаска сидит ниже */
        }
        for (let i = 1; i < planks; i++) {
          /* паз: широкий скат + узкое дно */
          const gx = X + i * pw;
          x.strokeStyle = 'rgba(86,86,86,0.9)';
          x.lineWidth = 5;
          x.beginPath();
          x.moveTo(gx + grJ(0, i), Y);
          for (let yy = 0; yy <= H2; yy += 16) x.lineTo(gx + grJ(yy, i), Y + yy);
          x.stroke();
          x.strokeStyle = 'rgba(52,52,52,0.95)';
          x.lineWidth = 2.6;
          x.beginPath();
          x.moveTo(gx + grJ(0, i), Y);
          for (let yy = 0; yy <= H2; yy += 16) x.lineTo(gx + grJ(yy, i), Y + yy);
          x.stroke();
        }
        {
          const gW = x.createLinearGradient(0, Y + H2 * 0.8, 0, Y + H2);
          gW.addColorStop(0, 'rgba(0,0,0,0)');
          gW.addColorStop(1, 'rgba(0,0,0,0.22)');
          x.fillStyle = gW;
          x.fillRect(X, Y + H2 * 0.8, H2, H2 * 0.2);
          x.strokeStyle = 'rgba(92,92,92,1)';
          x.lineWidth = 2;
          x.strokeRect(X + 1, Y + 1, H2 - 2, H2 - 2);
        }
      }
      {
        const X = H2,
          Y = H2;
        x.fillStyle = '#6e6e6e';
        x.fillRect(
          X,
          Y,
          H2,
          H2
        ); /* базовый уровень листа: фон 0 читался бы как яма под параллаксом */
        for (let i = 0; i < N(110, 90); i++) {
          /* шлифовка в рельефе */
          const gx = X + rr(1.5, H2 - 1.5);
          const g0 = (rnd() < 0.6 ? rr(96, 116) : rr(126, 146)) | 0;
          x.strokeStyle =
            'rgba(' + g0 + ',' + g0 + ',' + g0 + ',' + rr(0.15, 0.35).toFixed(2) + ')';
          x.lineWidth = rr(0.5, 1.4);
          x.beginPath();
          x.moveTo(gx, Y);
          x.lineTo(gx + rr(-1.5, 1.5), Y + H2);
          x.stroke();
        }
        x.strokeStyle = '#a4a4a4';
        x.lineWidth = 6;
        x.strokeRect(X + 11, Y + 11, H2 - 22, H2 - 22);
        x.fillStyle = '#7a7a7a';
        x.fillRect(X + 30, Y + 30, H2 - 60, H2 * 0.26);
        x.fillRect(X + 30, Y + H2 * 0.6, H2 - 60, H2 * 0.26);
        x.strokeStyle = '#b0b0b0';
        x.lineWidth = 2;
        x.strokeRect(X + 30, Y + 30, H2 - 60, H2 * 0.26);
        x.strokeRect(X + 30, Y + H2 * 0.6, H2 - 60, H2 * 0.26);
        x.fillStyle = '#dcdcdc';
        for (let i = 0; i < 22; i++) {
          const t = i / 22;
          const pts = [
            [X + 21, Y + 21 + t * (H2 - 42)],
            [X + H2 - 21, Y + 21 + t * (H2 - 42)],
            [X + 21 + t * (H2 - 42), Y + 21],
            [X + 21 + t * (H2 - 42), Y + H2 - 21]
          ];
          for (let q = 0; q < 4; q++) {
            x.beginPath();
            x.arc(pts[q][0], pts[q][1], 2.8, 0, 7);
            x.fill();
          }
        }
        x.fillStyle = '#9a9a9a';
        x.fillRect(X + H2 / 2 - 30, Y + 30 + H2 * 0.13 - 11, 60, 20);
        if (micro > 0) {
          x.fillStyle = '#c4c4c4';
          x.fillRect(X + 38, Y + 30 + H2 * 0.13 - 1, H2 - 76, 2);
          x.fillRect(X + 38, Y + H2 * 0.6 + H2 * 0.13 - 1, H2 - 76, 2);
        }
      }
      {
        const X = 2 * H2,
          Y = H2; /* тыл железной двери: панели и заклёпки как спереди, без выступа знака */
        x.fillStyle = '#6e6e6e';
        x.fillRect(X, Y, H2, H2);
        for (let i = 0; i < N(90, 80); i++) {
          const gx = X + rr(1.5, H2 - 1.5);
          const g0 = (rnd() < 0.6 ? rr(96, 116) : rr(126, 146)) | 0;
          x.strokeStyle =
            'rgba(' + g0 + ',' + g0 + ',' + g0 + ',' + rr(0.15, 0.35).toFixed(2) + ')';
          x.lineWidth = rr(0.5, 1.4);
          x.beginPath();
          x.moveTo(gx, Y);
          x.lineTo(gx + rr(-1.5, 1.5), Y + H2);
          x.stroke();
        }
        x.strokeStyle = '#a4a4a4';
        x.lineWidth = 6;
        x.strokeRect(X + 11, Y + 11, H2 - 22, H2 - 22);
        x.fillStyle = '#7a7a7a';
        x.fillRect(X + 30, Y + 30, H2 - 60, H2 * 0.26);
        x.fillRect(X + 30, Y + H2 * 0.6, H2 - 60, H2 * 0.26);
        x.strokeStyle = '#b0b0b0';
        x.lineWidth = 2;
        x.strokeRect(X + 30, Y + 30, H2 - 60, H2 * 0.26);
        x.strokeRect(X + 30, Y + H2 * 0.6, H2 - 60, H2 * 0.26);
        x.fillStyle = '#dcdcdc';
        for (let i = 0; i < 22; i++) {
          const t = i / 22;
          const pts = [
            [X + 21, Y + 21 + t * (H2 - 42)],
            [X + H2 - 21, Y + 21 + t * (H2 - 42)],
            [X + 21 + t * (H2 - 42), Y + 21],
            [X + 21 + t * (H2 - 42), Y + H2 - 21]
          ];
          for (let q = 0; q < 4; q++) {
            x.beginPath();
            x.arc(pts[q][0], pts[q][1], 2.8, 0, 7);
            x.fill();
          }
        }
      }
      {
        const X = 0,
          Y = 2 * H2; /* рельеф шпона: борозды волокон */
        x.fillStyle = '#808080';
        x.fillRect(X, Y, H2, H2);
        for (let i = 0; i < N(150, 120); i++) {
          const gx = rr(1.5, H2 - 1.5),
            ph = rr(0, 6.283),
            am = rr(0.5, 2.4),
            ww = rr(0.02, 0.09);
          const g0 = (rnd() < 0.62 ? rr(96, 118) : rr(140, 168)) | 0;
          x.strokeStyle =
            'rgba(' + g0 + ',' + g0 + ',' + g0 + ',' + rr(0.16, 0.42).toFixed(2) + ')';
          x.lineWidth = rr(0.5, 1.7);
          x.beginPath();
          x.moveTo(gx + Math.sin(ph) * am, Y);
          for (let yy = 8; yy <= H2; yy += 8) x.lineTo(gx + Math.sin(yy * ww + ph) * am, Y + yy);
          x.stroke();
        }
        for (let i = 0; i < N(90, 70); i++) {
          const g0 = rr(88, 104) | 0;
          x.fillStyle = 'rgba(' + g0 + ',' + g0 + ',' + g0 + ',0.5)';
          x.fillRect(X + rr(0, H2), Y + rr(0, H2), rr(0.6, 1.4), rr(3, 9));
        }
      }
      {
        const X = H2,
          Y = 2 * H2; /* внутренность: более грубый рельеф */
        x.fillStyle = '#787878';
        x.fillRect(X, Y, H2, H2);
        for (let i = 0; i < N(170, 140); i++) {
          const gx = rr(1.5, H2 - 1.5),
            ph = rr(0, 6.283),
            am = rr(0.6, 3.2),
            ww = rr(0.02, 0.12);
          const g0 = (rnd() < 0.7 ? rr(84, 104) : rr(140, 170)) | 0;
          x.strokeStyle = 'rgba(' + g0 + ',' + g0 + ',' + g0 + ',' + rr(0.2, 0.5).toFixed(2) + ')';
          x.lineWidth = rr(0.6, 2.2);
          x.beginPath();
          x.moveTo(gx + Math.sin(ph) * am, Y);
          for (let yy = 8; yy <= H2; yy += 8) x.lineTo(gx + Math.sin(yy * ww + ph) * am, Y + yy);
          x.stroke();
        }
        for (let i = 0; i < N(110, 90); i++) {
          const g0 = rr(80, 96) | 0;
          x.fillStyle = 'rgba(' + g0 + ',' + g0 + ',' + g0 + ',0.55)';
          x.fillRect(X + rr(0, H2), Y + rr(0, H2), rr(0.7, 1.8), rr(3, 11));
        }
      }
      {
        const Dq = AQ;
        mirrorSquare(x, Dq, Dq, 2 * Dq, Dq, Dq);
        mirrorSquare(x, 0, 2 * Dq, 2 * Dq, 2 * Dq, Dq);
      }
      /* строка 3: рельеф стола. Борозды досок и заклёпки совпадают с раскладкой
   albedo; случайные волокна независимы (в рельефе это просто текстура). */
      {
        const X = 0,
          Y = 3 * H2,
          PB = 2,
          PT = 144.3,
          ph = (PT - PB) / 4;
        x.fillStyle = '#7d7d7d';
        x.fillRect(X, Y, H2, H2);
        for (let i = 0; i < 4; i++) {
          const tb = (150 + ((i * 53) % 3) * 6) | 0;
          x.fillStyle = 'rgb(' + tb + ',' + tb + ',' + tb + ')';
          x.fillRect(X, Y + PB + i * ph + 1.2, H2, ph - 2.4);
        }
        for (let i = 0; i < N(60, 50); i++) {
          const g0 = rr(120, 172) | 0;
          x.strokeStyle = 'rgba(' + g0 + ',' + g0 + ',' + g0 + ',0.25)';
          x.lineWidth = rr(0.6, 1.4);
          const gy = Y + rr(PB + 2, PT - 2),
            ph2 = rr(0, 6.283),
            am = rr(0.4, 1.5),
            ww = rr(0.02, 0.08);
          x.beginPath();
          x.moveTo(X, gy);
          for (let xx = 16; xx <= H2; xx += 16) x.lineTo(X + xx, gy + Math.sin(xx * ww + ph2) * am);
          x.stroke();
        }
        for (let i = 1; i < 4; i++) {
          const gy = Y + PB + i * ph;
          x.fillStyle = '#303030';
          x.fillRect(X, gy - 1.4, H2, 2.8);
          x.fillStyle = '#c8c8c8';
          x.fillRect(X, gy + 1.4, H2, 1.0);
        }
        x.fillStyle = '#6a6a6a';
        x.fillRect(X, Y, H2, PB);
        x.fillRect(X, Y + PT - 2, H2, H2 - PT + 2);
      }
      {
        const X = H2,
          Y = 3 * H2;
        x.fillStyle = '#8a8a8a';
        x.fillRect(X, Y, H2, H2);
        for (let i = 0; i < N(70, 60); i++) {
          const g0 = (rnd() < 0.5 ? rr(112, 150) : rr(150, 186)) | 0;
          x.strokeStyle = 'rgba(' + g0 + ',' + g0 + ',' + g0 + ',0.28)';
          x.lineWidth = rr(0.6, 1.8);
          const gy = Y + rr(2, H2 - 2),
            ph = rr(0, 6.283),
            am = rr(0.6, 2.2),
            ww = rr(0.01, 0.05);
          x.beginPath();
          x.moveTo(X, gy);
          for (let xx = 16; xx <= H2; xx += 16) x.lineTo(X + xx, gy + Math.sin(xx * ww + ph) * am);
          x.stroke();
        }
      }
      {
        const X = 2 * H2,
          Y = 3 * H2;
        x.fillStyle = '#8a8a8a';
        x.fillRect(X, Y, H2, H2);
        for (let i = 0; i < N(70, 60); i++) {
          const g0 = (rnd() < 0.5 ? rr(112, 150) : rr(150, 186)) | 0;
          x.strokeStyle = 'rgba(' + g0 + ',' + g0 + ',' + g0 + ',0.28)';
          x.lineWidth = rr(0.6, 1.8);
          const gx = X + rr(2, H2 - 2),
            ph = rr(0, 6.283),
            am = rr(0.6, 2.2),
            ww = rr(0.01, 0.05);
          x.beginPath();
          x.moveTo(gx, Y);
          for (let yy = 16; yy <= H2; yy += 16) x.lineTo(gx + Math.sin(yy * ww + ph) * am, Y + yy);
          x.stroke();
        }
      }
      {
        const X = 3 * H2,
          Y = 3 * H2;
        x.fillStyle = '#909090';
        x.fillRect(X, Y, H2, H2);
        for (let i = 0; i < N(120, 100); i++) {
          const g0 = (rnd() < 0.5 ? rr(128, 160) : rr(160, 196)) | 0;
          x.fillStyle = 'rgba(' + g0 + ',' + g0 + ',' + g0 + ',0.30)';
          x.fillRect(X + rr(0, H2 * 0.7), Y + rr(0, H2), rr(40, 256), rr(0.6, 1.4));
        }
        for (const s of [0.1, 0.28, 0.5, 0.72, 0.9]) {
          let g = x.createRadialGradient(
            X + s * H2 - 1.6,
            Y + 0.12 * H2 - 1.6,
            0,
            X + s * H2,
            Y + 0.12 * H2,
            4.6
          );
          g.addColorStop(0, '#f2f2f2');
          g.addColorStop(1, '#8f8f8f');
          x.fillStyle = g;
          x.beginPath();
          x.arc(X + s * H2, Y + 0.12 * H2, 4.6, 0, 7);
          x.fill();
          g = x.createRadialGradient(
            X + s * H2 - 1.1,
            Y + 0.4 * H2 - 1.1,
            0,
            X + s * H2,
            Y + 0.4 * H2,
            3.2
          );
          g.addColorStop(0, '#e0e0e0');
          g.addColorStop(1, '#8f8f8f');
          x.fillStyle = g;
          x.beginPath();
          x.arc(X + s * H2, Y + 0.4 * H2, 3.2, 0, 7);
          x.fill();
        }
        x.fillStyle = '#4a4a4a';
        x.fillRect(X, Y + 0.226 * H2, H2, 2.4);
        x.fillRect(X, Y + 0.506 * H2, H2, 2.4);
        x.fillRect(X, Y + 0.566 * H2, H2, 2.4);
      }
      noiseInto(x, AW, AH, Math.round(9 + 9 * det), rnd);
    },
    AW,
    AH
  );

  const hd = hgt.data,
    hh = new Uint8Array(AW * AH);
  for (let i = 0, p = 0; i < hd.length; i += 4, p++) {
    let v = 255 - (128 - hd[i]) * 2.2;
    hh[p] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return {
    col: col,
    nrm: heightToNormal(hgt, AW, AH, 2.6 + 1.2 * det + 0.8 * micro),
    hgt: hh,
    w: AW,
    h: AH
  };
}

const ATL = { sig: null, data: null };
function getAtlas(S) {
  const sig = 'atlas_' + S.seed + '_' + Q.level + '_' + (Q.atlas | 0) + '_' + Q.det + '_' + Q.micro;
  if (ATL.sig !== sig) {
    applyAtlasQ(Q.atlas | 0);
    ATL.data = buildAtlasData(S.seedState, Q);
    ATL.sig = sig;
  }
  return ATL.data;
}

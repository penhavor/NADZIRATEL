function sizeFx() {
  fxcv.width = innerWidth;
  fxcv.height = innerHeight;
  if (!started) menuResize();
  else gameResize();
}
addEventListener('resize', sizeFx);

/* ==== СКРИМЕР ==== */
function scFigure(x, cx, cy, s, arm, fill, tilt) {
  x.save();
  x.translate(cx, cy);
  x.rotate(tilt || 0);
  x.fillStyle = fill;
  x.beginPath();
  x.ellipse(0, -0.38 * s, 0.075 * s, 0.095 * s, 0, 0, 7);
  x.fill();
  x.beginPath();
  x.moveTo(-0.15 * s, -0.3 * s);
  x.quadraticCurveTo(0, -0.34 * s, 0.15 * s, -0.3 * s);
  x.lineTo(0.1 * s, 0.05 * s);
  x.lineTo(-0.1 * s, 0.05 * s);
  x.closePath();
  x.fill();
  x.beginPath();
  x.moveTo(-0.1 * s, 0.02 * s);
  x.lineTo(0.1 * s, 0.02 * s);
  x.lineTo(0.19 * s, 0.46 * s);
  for (let i = 0; i < 6; i++)
    x.lineTo(0.19 * s - (i + 0.5) * 0.063 * s, 0.46 * s - (i % 2 ? 0.07 * s : 0));
  x.lineTo(-0.19 * s, 0.46 * s);
  x.closePath();
  x.fill();
  for (const sg of [-1, 1]) {
    const hx = sg * 0.3 * s,
      hy = -0.3 * s - arm * 0.28 * s;
    x.strokeStyle = fill;
    x.lineCap = 'round';
    x.lineWidth = 0.045 * s;
    x.beginPath();
    x.moveTo(sg * 0.14 * s, -0.28 * s);
    x.quadraticCurveTo(sg * 0.26 * s, -0.3 * s - arm * 0.1 * s, hx, hy);
    x.stroke();
    x.lineWidth = 0.012 * s;
    for (let f = 0; f < 4; f++) {
      const a = (-0.9 + f * 0.55) * sg,
        cl = 0.1 * s;
      x.beginPath();
      x.moveTo(hx, hy);
      x.lineTo(hx + Math.sin(a) * cl * sg, hy - Math.cos(a) * cl * (0.6 + arm * 0.5));
      x.stroke();
    }
  }
  x.restore();
}
function drawScreamer(t) {
  const W = fxcv.width,
    H = fxcv.height;
  const R = scrRng;
  let sh = 0;
  if (t < 0.55) sh = 6 + t * 20;
  else if (t < 0.95) sh = 26;
  else if (t < 1.55) sh = 10;
  else sh = 4;
  const jx = (R() * 2 - 1) * sh,
    jy = (R() * 2 - 1) * sh * 0.7;
  fxcv.style.transform =
    'translate(' +
    jx.toFixed(1) +
    'px,' +
    jy.toFixed(1) +
    'px) rotate(' +
    ((R() * 2 - 1) * 0.5).toFixed(2) +
    'deg)';
  fxc.save();
  fxc.fillStyle = '#000';
  fxc.fillRect(0, 0, W, H);
  const cx = W / 2,
    cy = H * 0.52;
  if (t < 0.55) {
    const k = t / 0.55,
      e = k * k * k;
    const s = H * (0.3 + 0.95 * e);
    const g = fxc.createRadialGradient(cx, cy, 0, cx, cy, H * 0.8);
    g.addColorStop(0, 'rgba(40,4,8,' + (0.5 + 0.4 * e) + ')');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    fxc.fillStyle = g;
    fxc.fillRect(0, 0, W, H);
    fxc.strokeStyle = 'rgba(120,10,20,' + (0.1 + 0.25 * e) + ')';
    fxc.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + R() * 0.1;
      fxc.beginPath();
      fxc.moveTo(cx + Math.cos(a) * H * 0.55, cy + Math.sin(a) * H * 0.55);
      fxc.lineTo(cx + Math.cos(a) * H * (0.75 + 0.3 * e), cy + Math.sin(a) * H * (0.75 + 0.3 * e));
      fxc.stroke();
    }
    scFigure(
      fxc,
      cx + (R() * 2 - 1) * 4 * e,
      cy + H * 0.1 * (1 - e),
      s,
      0.5 + 0.5 * e,
      '#07040a',
      0
    );
    for (const sg of [-1, 1]) {
      const ex = cx + sg * 0.032 * s,
        ey = cy + H * 0.1 * (1 - e) - 0.38 * s;
      const er = Math.max(2, 0.05 * s);
      const eg = fxc.createRadialGradient(ex, ey, 0, ex, ey, er);
      eg.addColorStop(0, 'rgba(255,90,70,1)');
      eg.addColorStop(0.3, 'rgba(255,30,20,0.8)');
      eg.addColorStop(1, 'rgba(120,0,0,0)');
      fxc.fillStyle = eg;
      fxc.beginPath();
      fxc.arc(ex, ey, er, 0, 7);
      fxc.fill();
    }
    if (t < 0.06) {
      fxc.fillStyle = 'rgba(255,255,255,0.9)';
      fxc.fillRect(0, 0, W, H);
    }
  } else if (t < 0.95) {
    const k = (t - 0.55) / 0.4;
    const s = H * (1.25 + 0.35 * k);
    fxc.fillStyle = 'rgba(24,2,6,0.92)';
    fxc.fillRect(0, 0, W, H);
    fxc.globalCompositeOperation = 'screen';
    scFigure(fxc, cx - 10, cy, s, 1, '#3a0512', -0.05);
    scFigure(fxc, cx + 10, cy, s, 1, '#052a33', 0.05);
    fxc.globalCompositeOperation = 'source-over';
    scFigure(fxc, cx, cy, s, 1, '#050308', -0.03 + R() * 0.06);
    for (const sg of [-1, 1]) {
      const ex = cx + sg * 0.032 * s,
        ey = cy - 0.38 * s;
      const eg = fxc.createRadialGradient(ex, ey, 0, ex, ey, 0.06 * s);
      eg.addColorStop(0, 'rgba(255,120,90,1)');
      eg.addColorStop(0.3, 'rgba(255,30,20,0.85)');
      eg.addColorStop(1, 'rgba(120,0,0,0)');
      fxc.fillStyle = eg;
      fxc.beginPath();
      fxc.arc(ex, ey, 0.06 * s, 0, 7);
      fxc.fill();
    }
    const sl = Math.max(0, (k - 0.35) / 0.65);
    if (sl > 0) {
      for (let i = 0; i < 4; i++) {
        const y0 = H * (0.18 + i * 0.2) + R() * 8;
        const g = fxc.createLinearGradient(0, y0, W, y0 + H * 0.22);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.35, 'rgba(255,235,225,' + 0.75 * sl + ')');
        g.addColorStop(0.65, 'rgba(200,20,30,' + 0.55 * sl + ')');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        fxc.strokeStyle = g;
        fxc.lineWidth = H * 0.012 * (1 + R());
        fxc.beginPath();
        fxc.moveTo(-20, y0);
        fxc.quadraticCurveTo(W * 0.5, y0 + H * 0.1, W + 20, y0 + H * 0.22);
        fxc.stroke();
      }
    }
  } else if (t < 1.55) {
    const k = (t - 0.95) / 0.6;
    const tilt = 0.12 * Math.sin(t * 9) + (R() * 2 - 1) * 0.02;
    fxc.fillStyle = 'rgba(10,1,4,0.94)';
    fxc.fillRect(0, 0, W, H);
    fxc.save();
    fxc.translate(cx, cy);
    fxc.rotate(tilt);
    const hr = H * 0.21 * (1 + 0.05 * k);
    const bg = fxc.createRadialGradient(0, -hr * 0.2, hr * 0.2, 0, 0, hr * 2.2);
    bg.addColorStop(0, '#0b0710');
    bg.addColorStop(1, '#030208');
    fxc.fillStyle = bg;
    fxc.beginPath();
    fxc.ellipse(0, hr * 1.5, hr * 2.1, hr * 1.2, 0, 0, 7);
    fxc.fill();
    fxc.fillStyle = '#080510';
    fxc.beginPath();
    fxc.ellipse(0, -hr * 0.15, hr * 0.72, hr, 0, 0, 7);
    fxc.fill();
    fxc.fillStyle = 'rgba(0,0,0,0.85)';
    for (const sg of [-1, 1]) {
      fxc.beginPath();
      fxc.ellipse(sg * hr * 0.3, -hr * 0.35, hr * 0.22, hr * 0.16, sg * 0.25, 0, 7);
      fxc.fill();
    }
    for (const sg of [-1, 1]) {
      const ex = sg * hr * 0.3 + Math.sin(t * 13 + sg) * hr * 0.03,
        ey = -hr * 0.35 + Math.cos(t * 11) * hr * 0.02;
      const er = hr * 0.055 * (1 + 0.25 * Math.sin(t * 40 + sg));
      const eg = fxc.createRadialGradient(ex, ey, 0, ex, ey, er * 5);
      eg.addColorStop(0, 'rgba(255,240,230,1)');
      eg.addColorStop(0.18, 'rgba(255,70,50,1)');
      eg.addColorStop(0.45, 'rgba(255,20,15,0.55)');
      eg.addColorStop(1, 'rgba(120,0,0,0)');
      fxc.fillStyle = eg;
      fxc.beginPath();
      fxc.arc(ex, ey, er * 5, 0, 7);
      fxc.fill();
    }
    const open = 0.55 + 0.45 * Math.min(1, k * 2);
    fxc.fillStyle = '#000';
    fxc.beginPath();
    fxc.ellipse(0, hr * 0.42, hr * 0.26, hr * 0.42 * open, 0, 0, 7);
    fxc.fill();
    fxc.strokeStyle = 'rgba(215,195,185,0.30)';
    fxc.lineWidth = hr * 0.03;
    for (let i = -3; i <= 3; i++) {
      fxc.beginPath();
      fxc.moveTo(i * hr * 0.07, hr * 0.42 - hr * 0.4 * open);
      fxc.lineTo(i * hr * 0.07 + hr * 0.01, hr * 0.42 - hr * 0.4 * open + hr * 0.1);
      fxc.stroke();
      fxc.beginPath();
      fxc.moveTo(i * hr * 0.07, hr * 0.42 + hr * 0.4 * open);
      fxc.lineTo(i * hr * 0.07 - hr * 0.01, hr * 0.42 + hr * 0.4 * open - hr * 0.08);
      fxc.stroke();
    }
    fxc.restore();
    if (((t * 16) | 0) % 5 === 0) {
      fxc.fillStyle = 'rgba(255,30,25,0.14)';
      fxc.fillRect(0, 0, W, H);
    }
    if (((t * 11) | 0) % 7 === 0) {
      fxc.fillStyle = 'rgba(255,255,255,0.13)';
      fxc.fillRect(0, 0, W, H);
    }
  } else {
    const k = (t - 1.55) / 0.35;
    fxc.fillStyle = 'rgba(0,0,0,' + (0.55 + 0.45 * k) + ')';
    fxc.fillRect(0, 0, W, H);
    const s = H * (1.6 - 0.9 * k);
    fxc.globalAlpha = 1 - k;
    scFigure(fxc, cx, cy + H * 0.3 * k, s, 0.2, '#050308', 0);
    fxc.globalAlpha = 1;
    fxc.fillStyle = 'rgba(255,255,255,' + (0.1 * (1 - k)).toFixed(3) + ')';
    for (let i = 0; i < 220 * (1 - k); i++) fxc.fillRect(R() * W, R() * H, 2, 2);
  }
  if ((t > 0.52 && t < 1.0) || (((t * 13) | 0) % 6 === 0 && t < 1.6)) {
    for (let i = 0; i < 5; i++) {
      const sy = (R() * H) | 0,
        shh = (4 + R() * 26) | 0,
        dx = ((R() * 2 - 1) * 70) | 0;
      fxc.drawImage(fxcv, 0, sy, W, shh, dx, sy, W, shh);
    }
  }
  fxc.fillStyle = 'rgba(255,255,255,0.03)';
  for (let i = 0; i < 140; i++) fxc.fillRect(R() * W, R() * H, 1.5, 1.5);
  const vg = fxc.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(96,0,0,0.85)');
  fxc.fillStyle = vg;
  fxc.fillRect(0, 0, W, H);
  fxc.restore();
}
view.addEventListener('click', () => {
  if (!started || !S || S.won || S.caught || paused) return;
  requestLook(true);
});

/* панель инвентаря (4 слота) — DOM, обновляется только при изменении */
const INV_ICON = {
  flash:
    '<svg viewBox="0 0 24 24"><rect x="3" y="9.5" width="9" height="5" rx="1.4" fill="#c6d0e0"/><path d="M12 8.6 L17.5 7 L17.5 17 L12 15.4 Z" fill="#e8eef8"/><path d="M18.6 8.2 L22 6.2 M18.6 12 L22.4 12 M18.6 15.8 L22 17.8" stroke="#ffd43b" stroke-width="1.4" stroke-linecap="round"/><circle cx="5.2" cy="12" r="1.05" fill="#8b95a8"/></svg>',
  batt: '<svg viewBox="0 0 24 24"><rect x="6.5" y="4" width="11" height="17" rx="2" fill="#2c3547" stroke="#c6d0e0" stroke-width="1.2"/><rect x="9.8" y="2.2" width="4.4" height="2.4" rx="0.8" fill="#c6d0e0"/><rect x="8" y="9" width="8" height="8.5" rx="1" fill="#ffd43b"/><path d="M12.6 9.6 L10 13.6 h2 L11.4 17 L14 13 h-2 Z" fill="#1a2130"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="7.5" cy="12" r="4.2" fill="none" stroke="#ffd43b" stroke-width="2.2"/><path d="M11.6 12 H21" stroke="#ffd43b" stroke-width="2.2" stroke-linecap="round"/><path d="M17 12 v3.4 M20 12 v2.6" stroke="#ffd43b" stroke-width="2" stroke-linecap="round"/></svg>'
};
let invSig = '~';
/* ==== HUD: ИНВЕНТАРЬ И МИНИКАРТА ==== */
/* статичный слой миникарты (клетки) кэшируется вне экрана: перерисовка — только
   когда сменился забег или выросла карта исследования (expV); каждый кадр — blit
   плюс динамические маркеры. Пиксели идентичны полной перерисовке, но кадровые
   fillRect по стенам (до ~1000) исчезли. */
let mmLayer = null,
  mmLayerCtx = null,
  mmLayerS = null,
  mmLayerKey = '';
function updInvHud(S) {
  let sig = S.sel + '|';
  for (let i = 0; i < INV_SLOTS; i++) {
    const it = S.inv[i];
    sig += it ? it.kind + (it.n || 1) : '-';
    sig += ',';
  }
  if (sig === invSig) return;
  invSig = sig;
  const bar = $('invBar');
  bar.innerHTML = '';
  for (let i = 0; i < INV_SLOTS; i++) {
    const it = S.inv[i];
    const d = document.createElement('div');
    d.className = 'islot' + (i === S.sel ? ' sel' : '');
    d.innerHTML =
      '<span class="num">' +
      (i + 1) +
      '</span>' +
      (it
        ? INV_ICON[it.kind] + (it.kind === 'batt' ? '<span class="cnt">×' + it.n + '</span>' : '')
        : '');
    bar.appendChild(d);
  }
}
function drawMinimap() {
  if (!showMap) {
    mm.style.visibility = 'hidden';
    return;
  }
  mm.style.visibility = 'visible';
  mctx.clearRect(0, 0, 150, 150);
  const c = 150 / Math.max(S.W, S.H);
  const M = S.map || MAP_DEF;
  /* known — клетка «видна» на карте: показывать неизведанные ИЛИ игрок там был.
   При выключенном unexp неизведанное — полная пустота: ни стен, ни объектов
   (шкафы, лампы, монстр, маркеры — всё привязано к клеткам). При включённом unexp
   ВСЯ карта читается как исследованная — цвета никогда не различаются. */
  const known = (x, y) =>
    !!M.unexp || (x >= 0 && y >= 0 && x < S.W && y < S.H && !!S.explored[y * S.W + x]);
  {
    const lk = (S.expV || 0) + '|' + (M.unexp ? 1 : 0);
    if (mmLayerS !== S || mmLayerKey !== lk) {
      if (!mmLayer) {
        mmLayer = document.createElement('canvas');
        mmLayer.width = 150;
        mmLayer.height = 150;
        mmLayerCtx = mmLayer.getContext('2d');
      }
      mmLayerCtx.clearRect(0, 0, 150, 150);
      for (let y = 0; y < S.H; y++)
        for (let x = 0; x < S.W; x++) {
          if (!known(x, y)) continue;
          const v = S.grid[y * S.W + x];
          mmLayerCtx.fillStyle = v === 1 ? '#232b3a' : '#39415a';
          mmLayerCtx.fillRect(x * c, y * c, c + 0.5, c + 0.5);
        }
      mmLayerS = S;
      mmLayerKey = lk;
    }
    mctx.drawImage(mmLayer, 0, 0);
  }
  /* заскриптованные лампы (комната старта, комната выхода — всегда:1) не
   показываются никогда: они существуют по замыслу */
  if (M.lamps !== false)
    for (const lp of S.lamps)
      if (!lp.always && lp.I > 0.3 && known(lp.x, lp.y)) {
        mctx.fillStyle = 'rgba(255,255,255,' + (0.3 + 0.45 * lp.I).toFixed(2) + ')';
        mctx.fillRect((lp.x + 0.3) * c, (lp.y + 0.3) * c, c * 0.4, c * 0.4);
      }
  if (M.spawn !== false && known(S.start.x, S.start.y)) {
    mctx.fillStyle = 'rgba(45,212,168,0.85)';
    mctx.fillRect((S.start.x + 0.15) * c, (S.start.y + 0.15) * c, c * 0.7, c * 0.7);
  }
  if (M.exit !== false && known(S.door.x, S.door.y)) {
    if (!S.doorOpen) {
      mctx.fillStyle = '#2b8a3e';
      mctx.fillRect((S.door.x + 0.08) * c, (S.door.y + 0.08) * c, c * 0.84, c * 0.84);
      mctx.strokeStyle = '#69db7c';
      mctx.lineWidth = 1;
      mctx.strokeRect((S.door.x + 0.08) * c, (S.door.y + 0.08) * c, c * 0.84, c * 0.84);
    } else if (!S.doorLeaf) {
      mctx.fillStyle = '#94d82d'; /* вентиль провернут — створка ещё закрыта */
      mctx.fillRect((S.door.x + 0.08) * c, (S.door.y + 0.08) * c, c * 0.84, c * 0.84);
      mctx.strokeStyle = '#c0eb7d';
      mctx.lineWidth = 1;
      mctx.strokeRect((S.door.x + 0.08) * c, (S.door.y + 0.08) * c, c * 0.84, c * 0.84);
    } else {
      const wc = S.winCell || S.door,
        pl = 0.6 + 0.4 * Math.sin(S.time * 4);
      if (known(wc.x, wc.y)) {
        mctx.fillStyle = 'rgba(81,207,102,' + (0.55 + 0.4 * pl).toFixed(2) + ')';
        mctx.beginPath();
        mctx.arc((wc.x + 0.5) * c, (wc.y + 0.5) * c, c * (0.42 + 0.12 * pl), 0, 7);
        mctx.fill();
      }
    }
  }
  /* шкафы: переключатель плюс видимость клетки; шкаф с ключом сразу получает
   золотой цвет КЛЮЧА (без наложения), пока включено «Показывать ключ» и ключ не
   забран */
  for (const cb of S.cabs || []) {
    if (M.cabs === false || !known(cb.x, cb.y)) continue;
    mctx.fillStyle =
      M.key && cb.content === 'key' && !cb.looted
        ? '#ffd43b'
        : cb.open > 0.5
          ? '#c9a15c'
          : '#8a6a3c';
    mctx.fillRect((cb.x + 0.28) * c, (cb.y + 0.28) * c, c * 0.44, c * 0.44);
  }
  /* монстр: «Показывать монстра» — вкл = виден всегда, выкл = никогда */
  if (M.mon && S.monster && known(Math.floor(S.mx), Math.floor(S.my))) {
    mctx.fillStyle = '#ff6b6b';
    mctx.beginPath();
    mctx.arc(S.mx * c, S.my * c, c * 0.36, 0, 7);
    mctx.fill();
  }
  mctx.fillStyle = '#63e6be';
  mctx.beginPath();
  mctx.arc(S.px * c, S.py * c, c * 0.36, 0, 7);
  mctx.fill();
  mctx.strokeStyle = '#63e6be';
  mctx.lineWidth = 1.6;
  mctx.beginPath();
  mctx.moveTo(S.px * c, S.py * c);
  mctx.lineTo((S.px + Math.cos(S.ang) * 1.4) * c, (S.py + Math.sin(S.ang) * 1.4) * c);
  mctx.stroke();
}
window.__DBG = () =>
  S
    ? {
        doorOpen: S.doorOpen,
        won: S.won,
        caught: S.caught,
        px: S.px,
        py: S.py,
        ang: S.ang,
        door: { x: S.door.x, y: S.door.y },
        key: { x: S.key.x, y: S.key.y },
        start: { x: S.start.x, y: S.start.y },
        mx: S.monster ? S.mx : 0,
        my: S.monster ? S.my : 0,
        hasKey: S.hasKey,
        monMode: S.monster ? S.mMode : 'off',
        mYaw: S.monster ? S.mYaw || 0 : 0,
        noiseR: S.noiseR,
        mode: 'gpu',
        winCell: S.winCell ? { x: S.winCell.x, y: S.winCell.y } : null,
        fl: S.fl
          ? {
              on: S.fl.on,
              e: +S.fl.e.toFixed(3),
              bri: +(S.fl.bri || 0).toFixed(3),
              rl: +(S.fl.rl || 0).toFixed(2),
              owned: S.fl.owned
            }
          : null,
        inv: S.inv ? S.inv.map(x => (x ? x.kind + (x.n ? 'x' + x.n : '') : null)) : null,
        sel: S.sel,
        darkT: +(S.darkT || 0).toFixed(1),
        cabs: S.cabs
          ? S.cabs.map(c => ({ x: c.x, y: c.y, c: c.content, o: +c.open.toFixed(2), l: c.looted }))
          : null,
        battsLeft: S.batts ? S.batts.filter(b => !b.taken).length : 0,
        mGait: S.monster ? S.mGait || '' : '',
        mPause: S.monster ? S.mPauseT || 0 : 0,
        quality: Q.level,
        doorT: S.doorT || 0,
        doorLeafT: S.doorLeafT || 0,
        doorUnlocked: !!S.doorUnlocked,
        lamps: S.lamps.length
      }
    : null;
window.__SETANG = (a, p) => {
  if (S) {
    S.ang = a;
    if (p !== undefined) S.pitch = p;
  }
};
window.__SETPOSE = (x, y, ang, pitch) => {
  if (S) {
    S.px = x;
    S.py = y;
    S.ang = ang;
    S.pitch = pitch || 0;
  }
};
window.__CELL = (x, y) => (S ? S.grid[Math.floor(y) * S.W + Math.floor(x)] : 1);
window.__SAFE = () => (S ? S.safeDoors.map(d => ({ x: d.x, y: d.y, t: d.t })) : []);

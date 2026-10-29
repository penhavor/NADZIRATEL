/* ================ ВЗАИМОДЕЙСТВИЕ (E) ================
   Только по прицелу: луч вдоль взгляда (спроецированный на план, наклон не важен —
   объекты низкие) ищет ПЕРВУЮ цель: шкаф, стол, предмет на полу, дверь.
   Центральная точка превращается в ладонь, когда цель есть (aimTarget считается
   каждый кадр в update). Автопилот сохраняет старую логику «по близости».
   Возврат true = действие СОСТОЯЛОСЬ: холостое нажатие не играет ни анимацию,
   ни блокировку ввода. */
function aimTarget(s) {
  const dx = Math.cos(s.ang),
    dy = Math.sin(s.ang);
  /* луч из глаз ВДОЛЬ ВЗГЛЯДА (рыскание+наклон): экранная точка должна
   действительно стоять на предмете, а не просто совпадать по азимуту.
   hy = высота луча в клетках. */
  const tanP = Math.tan(Math.max(-1.1, Math.min(1.1, s.pitch || 0)));
  const eye = 0.55 - 0.18 * (s.crC || 0); /* глаза: 1.62 м стоя, ниже при приседании */
  const cands = [];
  if (!s.flashTaken && s.table) {
    const b = boxOf(s.table, TBL_D, TBL_W);
    cands.push({ b: b, t: 'table', max: REACH_OBJ, rx: b.cx, ry: b.cy, h: TBL_H + 0.08 });
  }
  for (const c of s.cabs) {
    const b = boxOf(c, CAB_D, CAB_W);
    cands.push({ b: b, t: 'cab', max: REACH_OBJ, rx: b.cx, ry: b.cy, h: CAB_H, o: c });
  }
  for (const dr of s.drops || [])
    cands.push({
      b: { cx: dr.wx, cy: dr.wy, hx: 0.26, hz: 0.26 },
      t: 'drop',
      max: REACH_OBJ,
      rx: dr.wx,
      ry: dr.wy,
      h: 0.08,
      o: dr
    });
  for (const bt of s.batts || [])
    if (!bt.taken)
      cands.push({
        b: { cx: bt.x + 0.5, cy: bt.y + 0.5, hx: 0.26, hz: 0.26 },
        t: 'batt',
        max: REACH_OBJ,
        rx: bt.x + 0.5,
        ry: bt.y + 0.5,
        h: 0.08,
        o: bt
      });
  const pcx = Math.floor(s.px),
    pcy = Math.floor(s.py);
  for (let d = 0.02; d <= 0.7; d += 0.02) {
    /* шаг 2 см: граница досягаемости никогда не «перепрыгивается» */
    const x = s.px + dx * d,
      y = s.py + dy * d;
    const hy = eye + d * tanP;
    if (hy >= CEIL_H) return null; /* смотрим вверх: луч ушёл в потолок мимо всех целей */
    if (hy <= 0) return null; /* смотрим в пол перед предметом */
    for (const cd of cands)
      if (hy <= cd.h && Math.abs(x - cd.b.cx) <= cd.b.hx && Math.abs(y - cd.b.cy) <= cd.b.hz) {
        /* луч попал в коробку: радиус измеряется до центра объекта, а не до точки входа */
        const dc = Math.hypot(cd.rx - s.px, cd.ry - s.py);
        return dc <= cd.max ? { t: cd.t, o: cd.o } : null;
      }
    const cx = Math.floor(x),
      cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= s.W || cy >= s.H) return null;
    const v = s.grid[cy * s.W + cx];
    if (v === 1) return null; /* стена гасит луч */
    if (v === 2) return d <= REACH_DOOR ? { t: 'exit' } : null;
    if (v === 3) {
      if (cx === pcx && cy === pcy)
        continue; /* стоим в дверном проёме — дверь под ногами не цель */
      for (const q of s.safeDoors)
        if (q.x === cx && q.y === cy) return d <= REACH_DOOR ? { t: 'safe', o: q } : null;
      if (!safeOpenAt(s, cx, cy)) return null;
    }
  }
  return null;
}
/* автопилот не целится: старая приоритизация по расстоянию */
function botTarget(s) {
  if (!s.flashTaken && s.table) {
    const tc = boxCenter(s.table, TBL_D);
    if (Math.hypot(tc.x - s.px, tc.y - s.py) < 1.05) return { t: 'table' };
  }
  const c = nearestCab(s, s.px, s.py, 1.05);
  if (c && c.cd <= 0) return { t: 'cab', o: c };
  const dr = nearestDrop(s, s.px, s.py, 0.8);
  if (dr) return { t: 'drop', o: dr };
  const b = nearestBatt(s, s.px, s.py, 0.8);
  if (b) return { t: 'batt', o: b };
  const fx = Math.floor(s.px + Math.cos(s.ang) * 0.8),
    fy = Math.floor(s.py + Math.sin(s.ang) * 0.8);
  if (cellAt(s, fx, fy) === 2) return { t: 'exit' };
  let bd = 1.15,
    best = null;
  for (const d of s.safeDoors) {
    const dd = Math.hypot(d.x + 0.5 - s.px, d.y + 0.5 - s.py);
    if (dd < bd) {
      bd = dd;
      best = d;
    }
  }
  return best ? { t: 'safe', o: best } : null;
}
function pickUp(s, kind, ev) {
  const sel0 = s.sel,
    had = sel0 >= 0 && !!s.inv[sel0];
  if (!invAdd(s, kind)) {
    ev.push('inv_full');
    return false;
  }
  if (kind === 'flash') {
    s.fl.owned = true;
    invSelectKind(s, 'flash');
  } else if (kind === 'key') {
    s.hasKey = true;
    invFixSel(s);
  } else if (!(sel0 >= 0 && s.inv[sel0])) s.sel = invSlotOfKind(s, 'batt');
  pkDefer(s, sel0, kind, had);
  ev.push(kind === 'batt' ? 'pickup_batt' : 'pickup_' + kind);
  return true;
}
function interact(s, ev, monInSafe) {
  if (s.fl.rl > 0) {
    ev.push('hands_busy');
    return false;
  }
  s.pActKind = 'item';
  const t = s.bot ? botTarget(s) : s.aimT;
  if (!t) return false;
  /* 1) фонарь на столе в безопасной комнате */
  if (t.t === 'table') {
    if (!pickUp(s, 'flash', ev)) return false;
    s.flashTaken = true;
    s.fl.e = 1.0;
    return true;
  }
  /* 2) шкаф: выдвинуть ящик → забрать содержимое → задвинуть обратно */
  if (t.t === 'cab') {
    const c = t.o;
    if (c.cd > 0) return false;
    c.cd = 0.35;
    if (c.open < 0.5) {
      c.want = 1;
      ev.push('cab_open');
      return true;
    }
    if (!c.content || c.looted) {
      c.want = 0;
      ev.push('cab_close');
      return true;
    }
    const ok = pickUp(s, c.content === 'key' ? 'key' : 'batt', ev);
    if (ok) c.looted = true;
    return ok;
  }
  /* 3) предмет на полу: выброшен через G */
  if (t.t === 'drop') {
    const dr = t.o;
    if (!pickUp(s, dr.kind, ev)) return false;
    if (dr.kind === 'flash') s.fl.e = dr.e || 0;
    s.drops.splice(s.drops.indexOf(dr), 1);
    return true;
  }
  if (t.t === 'batt') {
    if (!pickUp(s, 'batt', ev)) return false;
    t.o.taken = true;
    return true;
  }
  /* 4) железная дверь выхода: ключ В РУКЕ проворачивает вентиль, затем E толкает створку */
  if (t.t === 'exit') {
    if (!s.doorOpen) {
      if (invSelKind(s) !== 'key') {
        ev.push(s.hasKey ? 'door_needhand' : 'door_locked');
        return false;
      }
      s.doorOpen = true;
      s.doorT = 0;
      s.pActKind = 'key';
      ev.push('door_unlock');
      return true;
    }
    if (!s.doorUnlocked || s.doorLeaf) return false; /* вентиль ещё проворачивается / уже открыт */
    s.pActKind = 'door';
    s.doorLeaf = true;
    s.doorLeafT = 0;
    ev.push('door_open');
    return true;
  }
  /* 5) двери безопасной комнаты — тоже толчок, а не «подбор» */
  if (t.t === 'safe') {
    const best = t.o;
    s.pActKind = 'door';
    if (monInSafe) {
      ev.push('safe_denied_mon');
      return false;
    }
    if (!best.want) {
      best.want = 1;
      ev.push('safe_open');
      return true;
    }
    /* не закроется, пока вы стоите в проёме */
    const qx = Math.max(best.x, Math.min(best.x + 1, s.px)),
      qy = Math.max(best.y, Math.min(best.y + 1, s.py));
    if (Math.hypot(s.px - qx, s.py - qy) < 0.26 && !(s.dev && s.dev.noclip)) {
      ev.push('safe_denied');
      return false;
    }
    best.want = 0;
    ev.push('safe_close');
    return true;
  }
  return false;
}

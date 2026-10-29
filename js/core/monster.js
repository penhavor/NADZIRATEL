/* ==== ИИ МОНИТОРА ==== */
function seesFrom(s, mx, my, yaw) {
  const dx = s.px - mx,
    dy = s.py - my,
    dP = Math.hypot(dx, dy);
  if (!los(s, mx, my, s.px, s.py)) return false;
  if (dP < MON_PERIPH) return true;
  return Math.abs(wrapPi(Math.atan2(dx, dy) - yaw)) < MON_FOV;
}

function pickWanderTarget(s) {
  if (!s.mazeFloors.length) {
    s.mPath = null;
    return;
  } /* вырожденная микро-карта: бродить негде */
  const cur = { x: Math.floor(s.mx), y: Math.floor(s.my) };
  const t = s.mazeFloors[(s.rndM() * s.mazeFloors.length) | 0];
  s.mPath = bfsPath(s, cur, { x: t % s.W, y: (t / s.W) | 0 });
}
function startScan(s, dur) {
  const r1 = 0.85 + s.rndM() * 0.55;
  const l1 = -(0.85 + s.rndM() * 0.55);
  const back = (s.rndM() < 0.5 ? 1 : -1) * (2.25 + s.rndM() * 0.75);
  const seq = [r1, l1, back, back * 0.35, 0];
  const w = [
    Math.abs(r1),
    Math.abs(r1 - l1),
    Math.abs(l1 - back),
    Math.abs(back - back * 0.35),
    Math.abs(back * 0.35)
  ];
  let tot = 0;
  for (const x of w) tot += x;
  const d = Math.max(1.2, dur, tot / 2.9);
  const cum = [];
  let acc = 0;
  for (let i = 0; i < w.length; i++) {
    acc += w[i] / tot;
    cum.push(acc);
  }
  s.mScan = { t: 0, dur: d, base: s.mYaw || 0, seq: seq, cum: cum };
  s.mPauseT = d;
  s.mGait = 'stand';
  s.mSpeedNow = 0;
}
function scanYaw(s) {
  const sc = s.mScan;
  if (!sc) return s.mYaw || 0;
  const n = sc.seq.length;
  const ft = Math.min(1, sc.t / sc.dur);
  let i = 0;
  while (i < n - 1 && ft >= sc.cum[i]) i++;
  const t0 = i > 0 ? sc.cum[i - 1] : 0,
    t1 = sc.cum[i];
  const f = Math.max(0, Math.min(1, (ft - t0) / Math.max(1e-6, t1 - t0)));
  const e = f * f * (3 - 2 * f);
  const a0 = i > 0 ? sc.seq[i - 1] : 0,
    a1 = sc.seq[i];
  return sc.base + a0 + (a1 - a0) * e;
}
/* ПРЫЖОК В ТЕНИ режет расстояние сквозь темноту. Цель = точка интереса
   (шум/свидетельство в агрессивных режимах, точка патруля в блуждании);
   приземление = ТЁМНАЯ клетка рядом с целью, укорачивающая маршрут на >= 4
   клетки. Минимального расстояния до игрока нет. Клетки конуса фонаря и
   рассеяния не тёмные — прыжка туда нет. */
function tryShadowJump(s, ev) {
  if (!s.teleport || s.won || s.caught || !s.darkCells.length) return false;
  let tgt = null;
  if ((s.mMode === 'investigate' || s.mMode === 'chase') && s.lastSeen) tgt = s.lastSeen;
  else if (s.mMode === 'wander' && s.mPath && s.mPath.length > 6) tgt = s.mPath[s.mPath.length - 1];
  if (!tgt) return false;
  const cur = { x: Math.floor(s.mx), y: Math.floor(s.my) };
  const df = bfsDist(s, tgt);
  const curLen = df[cur.y * s.W + cur.x];
  if (curLen < 0 || curLen < 5) return false; /* уже близко — прыжок бессмыслен */
  let best = -1,
    bestLen = 1e9;
  for (const dc of s.darkCells) {
    const L = df[dc];
    if (L < 0 || L > curLen - 4) continue; /* хотя бы на 4 клетки короче маршрута */
    const x = (dc % s.W) + 0.5,
      y = ((dc / s.W) | 0) + 0.5;
    if (cellLitByFlash(s, x, y)) continue; /* свет отгоняет тень */
    if (L < bestLen) {
      bestLen = L;
      best = dc;
    }
  }
  if (best < 0) return false;
  s.mx = (best % s.W) + 0.5;
  s.my = ((best / s.W) | 0) + 0.5;
  s.mPath = null;
  s.mScan = null;
  s.mScanOff = 0;
  s.mPauseT = 0;
  s.mSpeedNow = 0;
  /* режим агрессии ПЕРЕЖИВАЕТ прыжок: сразу перестраиваем маршрут до цели */
  if (s.mMode !== 'wander' && s.lastSeen)
    s.mPath = bfsPath(s, { x: Math.floor(s.mx), y: Math.floor(s.my) }, s.lastSeen);
  ev.push('shadow_teleport');
  return true;
}
function stepMonster(s, dt, ev) {
  if (!s.monster || s.won || s.caught) return;
  const inv = s.dev && s.dev.invisible;
  let dP = Math.hypot(s.px - s.mx, s.py - s.my);

  const monInStart = Math.floor(s.mx) === s.start.x && Math.floor(s.my) === s.start.y;
  const inSafe =
    Math.floor(s.px) === s.start.x &&
    Math.floor(s.py) === s.start.y &&
    s.safeDoors.length &&
    s.safeDoors.every(d => d.t < 0.5) &&
    !monInStart;
  let seen = false;
  /* Noclip не делает игрока видимым для монстра: зрение одинаково в обоих режимах
   (единственный чит для зрения — невидимость). */
  if (!inv && !inSafe) seen = seesFrom(s, s.mx, s.my, s.mYaw);
  const cur = { x: Math.floor(s.mx), y: Math.floor(s.my) };
  if (seen) {
    if (s.mMode !== 'chase') {
      s.mMode = 'chase';
      ev.push('monster_seen');
    }
    s.mPauseT = 0;
    s.mScan = null;
    s.mScanOff = 0;
    s.lastSeen = { x: Math.floor(s.px), y: Math.floor(s.py) };
    s.mRep -= dt;
    const atEnd =
      !s.mPath ||
      !s.mPath.length ||
      s.mPath[s.mPath.length - 1].x !== s.lastSeen.x ||
      s.mPath[s.mPath.length - 1].y !== s.lastSeen.y;
    if (s.mRep <= 0 || atEnd) {
      s.mPath = bfsPath(s, cur, s.lastSeen);
      s.mRep = 0.45;
    }
  } else if (s.mMode === 'chase') {
    s.mMode = 'investigate';
    s.mPath = s.lastSeen ? bfsPath(s, cur, s.lastSeen) : null;
    if (!s.mPath) startScan(s, 1.5 + s.rndM() * 1.2);
  }

  s.noiseCd -= dt;
  if (
    !seen &&
    s.mMode !== 'chase' &&
    s.noiseR > 0 &&
    dP <= s.noiseR &&
    s.noiseCd <= 0 &&
    s.noisePos
  ) {
    s.noiseCd = 1.6;
    s.mMode = 'investigate';
    s.lastSeen = { x: s.noisePos.x, y: s.noisePos.y };
    const pN = bfsPath(s, cur, s.lastSeen);
    if (pN) {
      s.mPath = pN;
      s.mPauseT = 0;
      s.mScan = null;
      s.mScanOff = 0;
    } else startScan(s, 1.4 + s.rndM() * 1.2);
    ev.push('monster_heard');
  }

  if (s.mMode === 'investigate' && s.lastSeen && s.mPauseT <= 0) {
    if (!s.mPath || !s.mPath.length) {
      s.mPath = bfsPath(s, cur, s.lastSeen);
      if (!s.mPath) {
        s.mMode = 'wander';
        pickWanderTarget(s);
      }
    }
  }

  if (s.mMode === 'wander' && s.mPauseT <= 0 && (!s.mPath || !s.mPath.length)) {
    pickWanderTarget(s);
  }
  if (s.mPauseT <= 0 && s.mPath && s.mPath.length) {
    if (s.mPath[0].x !== cur.x || s.mPath[0].y !== cur.y)
      s.mPath = bfsPath(s, cur, s.mPath[s.mPath.length - 1]);
  }
  if (s.mPauseT > 0) {
    s.mGait = 'stand';
    s.mSpeedNow = 0;
    s.mPauseT -= dt;
    if (s.mScan) {
      s.mScan.t = Math.min(s.mScan.t + dt, s.mScan.dur);
      const ty = scanYaw(s);
      const dY = wrapPi(ty - (s.mYaw || 0));
      const rate = 3.4 * dt;
      s.mYaw = wrapPi((s.mYaw || 0) + Math.max(-rate, Math.min(rate, dY)));
      s.mScanOff = dY;
      if (s.mScan.t >= s.mScan.dur && s.mPauseT > 0.3) s.mPauseT = 0.3;
    }

    const ph = s.mPhase || 0,
      ph0 = Math.round(ph / Math.PI) * Math.PI;
    s.mPhase = ph + (ph0 - ph) * Math.min(1, dt * 5);
    s.mLastX = s.mx;
    s.mLastY = s.my;
    if (s.mPauseT <= 0) {
      s.mScan = null;
      s.mScanOff = 0;
      if (s.mMode === 'investigate') s.mMode = 'wander';
      pickWanderTarget(s);
      s.mGait = 'walk';
    }
  } else if (s.mPath && s.mPath.length) {
    const run = s.mMode === 'chase' || s.mMode === 'investigate';
    s.mGait = run ? 'run' : 'walk';
    const wp = s.mPath.length > 1 ? s.mPath[1] : s.mPath[0];
    let tx = wp.x + 0.5,
      ty = wp.y + 0.5;
    /* ИСПРАВЛЕНИЕ УГЛА: BFS-путь заканчивается в ЦЕНТРЕ клетки игрока, но прижатый
   к углу игрок стоит в ~0.707 клетки от центра — монстр никогда не достигал
   радиуса захвата 0.55. На финальном подходе (игрок виден, линия чиста) ведём
   прямо на игрока. */
    let direct = false;
    if (seen && s.mMode === 'chase' && dP < 1.35 && los(s, s.mx, s.my, s.px, s.py)) {
      direct = true;
      tx = s.px;
      ty = s.py;
    }
    const d = Math.hypot(tx - s.mx, ty - s.my);
    const spNow = run ? Math.max(MON_WALK, s.monsterSpeed) : MON_WALK;
    const step = Math.min(d, spNow * dt);
    if (d > 1e-6) {
      const ux = (tx - s.mx) / d,
        uy = (ty - s.my) / d;
      const nmx = s.mx + ux * step,
        nmy = s.my + uy * step;
      const rr = 0.22; /* пробы берут габарит плеч и рук: при 0.16 модель визуально проседала в стены на углах */
      const stuckNow = blocked(s, s.mx, s.my) || inBox(s, s.mx, s.my, 0.05);
      /* пробы вынесены в функцию — когда прямая линия упирается в угол стены или
   косяк, кадр шагает по узлу маршрута вместо сброса пути (иначе монстр замирал). */
      const free = (X, Y, UX, UY) =>
        !inBox(s, X, Y, 0.1) &&
        !blocked(s, X + UX * rr, Y + UY * rr) &&
        !blocked(s, X - UY * rr, Y + UX * rr) &&
        !blocked(
          s,
          X + UY * rr,
          Y - UX * rr
        ); /* центральная проба против мебели использует 0.10: при rr полоса вокруг шкафа
   становилась ловушкой (монстр не мог ни войти, ни выйти); стены сохраняют пробы на rr */
      let mvx = 0,
        mvy = 0,
        did = false;
      /* ЗАСТРЯЛ В УГЛУ: скольжение вдоль стены — отклонения курса отсортированы по
   возрастанию |угла|, требуется прогресс в сторону цели (иначе монстр кружил бы). */
      const steer = (UX, UY) => {
        for (const da of [0.35, -0.35, 0.7, -0.7, 1.15, -1.15]) {
          const ca2 = Math.cos(da),
            sa2 = Math.sin(da);
          const vx = UX * ca2 - UY * sa2,
            vy = UX * sa2 + UY * ca2;
          if (vx * UX + vy * UY < 0.25) continue;
          const X = s.mx + vx * step,
            Y = s.my + vy * step;
          if (free(X, Y, vx, vy)) return [X, Y];
        }
        return null;
      };
      if (stuckNow || free(nmx, nmy, ux, uy)) {
        mvx = nmx;
        mvy = nmy;
        did = true;
      } else {
        const st = steer(ux, uy);
        if (st) {
          mvx = st[0];
          mvy = st[1];
          did = true;
        }
      }
      if (did) {
        s.mx = mvx;
        s.my = mvy;
        s.mStuckT = 0;
      } else if (direct) {
        const wx0 = wp.x + 0.5,
          wy0 = wp.y + 0.5,
          d2 = Math.hypot(wx0 - s.mx, wy0 - s.my);
        if (d2 > 1e-6) {
          const u2x = (wx0 - s.mx) / d2,
            u2y = (wy0 - s.my) / d2,
            st2 = Math.min(d2, spNow * dt);
          const X = s.mx + u2x * st2,
            Y = s.my + u2y * st2;
          const st = free(X, Y, u2x, u2y) ? [X, Y] : steer(u2x, u2y);
          if (stuckNow || st) {
            s.mx = st ? st[0] : X;
            s.my = st ? st[1] : Y;
            s.mStuckT = 0;
          } else {
            /* аварийный выход: застревание >0.9 с (прижат к мебели или углу) — шагаем сквозь
   препятствие вместо бесконечного сброса пути */
            s.mStuckT = (s.mStuckT || 0) + dt;
            if (s.mStuckT > 0.9) {
              s.mx = X;
              s.my = Y;
              s.mStuckT = 0;
            } else {
              s.mPath = null;
              s.mSpeedNow = 0;
            }
          }
        } else {
          s.mPath = null;
          s.mSpeedNow = 0;
        }
      } else {
        /* скольжение тоже не помогло: возвращаемся в центр НАШЕГО узла маршрута — из
   центра следующий отрезок почти не цепляет углы. */
        const n0 = s.mPath[0],
          c0x = n0.x + 0.5,
          c0y = n0.y + 0.5;
        const d3 = Math.hypot(c0x - s.mx, c0y - s.my);
        s.mStuckT = (s.mStuckT || 0) + dt;
        if (d3 > 1e-6) {
          const u3x = (c0x - s.mx) / d3,
            u3y = (c0y - s.my) / d3,
            st3 = Math.min(d3, spNow * dt);
          const X = s.mx + u3x * st3,
            Y = s.my + u3y * st3;
          if (stuckNow || s.mStuckT > 0.9 || free(X, Y, u3x, u3y)) {
            s.mx = X;
            s.my = Y;
          } else {
            s.mPath = null;
            s.mSpeedNow = 0;
          }
        } else {
          s.mPath = null;
          s.mSpeedNow = 0;
        }
      }
    }
    s.mSpeedNow = step / Math.max(dt, 1e-4);
    /* фаза шага монстра берётся из ПРОЙДЕННОГО РАССТОЯНИЯ, та же формула, что у
   игрока: K = duty*2π/S [рад/клетка] (вывод в MON_GAIT); опорная нога не
   проскальзывает. */
    const MKG = (typeof window !== 'undefined' && window.MON_GAIT_K) || MON_K_FALLBACK;
    s.mPhase = (s.mPhase || 0) + step * (run ? MKG.run : MKG.walk);
    if (d <= step + 1e-6 && s.mPath.length > 1) s.mPath = s.mPath.slice(1);
    else if (d <= step + 1e-6) {
      s.mPath = null;
      if (s.mMode === 'chase') {
      } else if (s.mMode === 'investigate') startScan(s, 2.2 + s.rndM() * 1.8);
      else if (s.rndM() < 0.72) startScan(s, 1.8 + s.rndM() * 1.8);
      else {
        pickWanderTarget(s);
        s.mGait = 'walk';
      }
    }
  } else {
    s.mSpeedNow = 0;
    s.mGait = s.mMode === 'chase' ? 'run' : 'walk';
  }

  if (s.mPauseT <= 0) {
    const angP = Math.atan2(s.px - s.mx, s.py - s.my);
    let want = null;
    if (seen || s.mMode === 'chase') want = angP;
    else if (s.mPath && s.mPath.length > 1) {
      const wp = s.mPath[1],
        wx = wp.x + 0.5 - s.mx,
        wy = wp.y + 0.5 - s.my;
      if (wx * wx + wy * wy > 1e-4) want = Math.atan2(wx, wy);
    }
    if (want === null && (s.mSpeedNow || 0) > 0.05 && s.mLastX !== undefined) {
      const wx = s.mx - s.mLastX,
        wy = s.my - s.mLastY;
      if (wx * wx + wy * wy > 1e-8) want = Math.atan2(wx, wy);
    }
    if (want !== null) {
      const rate = (s.mMode === 'chase' ? 4.2 : 2.6) * dt;
      s.mYaw = wrapPi(s.mYaw + Math.max(-rate, Math.min(rate, wrapPi(want - s.mYaw))));
    }
    s.mLastX = s.mx;
    s.mLastY = s.my;
  }

  if (s.teleport && !s.won && !s.caught && !seen && s.mPauseT <= 0) {
    s.tpCd -= dt;
    if (s.tpCd <= 0) {
      /* прыжок доступен в ЛЮБОМ режиме. Задержка ставится только ПОСЛЕ успешного
   прыжка; прыгать некуда — короткая пауза (1.2 с) и новая попытка. */
      if (tryShadowJump(s, ev)) s.tpCd = 9 + s.rndM() * 9;
      else s.tpCd = 1.2;
    }
  }
  /* дистанция захвата измеряется ПОСЛЕ перемещения кадра — иначе захват отстаёт на кадр. */
  dP = Math.hypot(s.px - s.mx, s.py - s.my);
  if (!inv && !inSafe && dP < 0.55 && los(s, s.mx, s.my, s.px, s.py)) {
    s.caught = true;
    ev.push('caught');
  } /* для захвата нужна прямая видимость — сквозь стену не ловит */
}

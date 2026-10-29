/* музыкальный движок строится ЗАРАНЕЕ (импульс реверберации и буферы шума —
   тяжело для процессора): на Enter остаётся только старт, звук появляется мгновенно */
function musBuild() {
  if (MUS || !AU.ctx) return;
  try {
    MUS = new MusEng(AU.ctx, (Math.random() * 4294967296) >>> 0, musParams(musFear()));
  } catch (e) {
    MUS = null;
  }
}
async function boot() {
  try {
    LD.set(2, 'настройки');
    loadSettings();
    buildBindsPanel();
    buildGfxPanel();
    $('gfxPreset').value = GFX.preset;
    syncControls();
    applyDevMode();
    menuScreen('main');
    updMazeInfo();
    updMenuHints();
    await LD.tick();
    LD.set(6, 'видеокарта');
    window.LDSTEP = async (f, l) => {
      LD.set(6 + Math.round(f * 80), l);
      await LD.tick();
    };
    await menuBgStart(); /* фоновый лабиринт + GPU.init (прогресс приходит изнутри) + первый кадр */
    window.LDSTEP = null;
    await LD.tick();
    LD.set(90, 'звук');
    auInit();
    musBuild();
    await LD.tick();
  } catch (e) {
    window.LDSTEP = null;
    try {
      console.warn('boot failed:', e);
    } catch (_) {}
  }
  LD.set(100, 'готово');
  LD.lbl.textContent = '';
  $('ldGo').classList.remove('hidden');
  LD.ready = true;
}
boot();
addEventListener('keydown', function ldEnter(e) {
  if (e.code !== 'Enter' || !LD.ready || LD.done) return;
  LD.done = true;
  removeEventListener('keydown', ldEnter);
  $('loader').classList.add('hidden');
  show('menu', true);
  AU.unlocked = true;
  musMenu(true); /* жест: контекст оживает, и музыка стартует в тот же миг */
});

let last = performance.now();
/* кэш записей HUD: одинаковые значения повторно в DOM не пишутся
   (textContent/style — это мутации и пересчёты, даже когда значение не изменилось) */
const _hudC = {};
function setTxt(id, v) {
  if (_hudC['t' + id] === v) return;
  _hudC['t' + id] = v;
  const e = $(id);
  if (e) e.textContent = v;
}
function setSty(id, k, v) {
  const key = id + '.' + k;
  if (_hudC[key] === v) return;
  _hudC[key] = v;
  const e = $(id);
  if (e) e.style[k] = v;
}
/* ==== ГЛАВНЫЙ ЦИКЛ ==== */
function frame(now) {
  requestAnimationFrame(frame);
  const dtRaw = Math.min(0.05, (now - last) / 1000);
  last = now;
  /* FPS — кадры, которые GPU честно завершил за окно ~0.5 с. Ни герцовка монитора,
   ни частота тиков rAF на это число больше не влияют. */
  if (started && S && !paused && !gpuBusy) {
    if (!fpsT0) {
      fpsT0 = now;
      fpsN0 = GPU.framesDone | 0;
    } else if (now - fpsT0 >= 500) {
      const fps = (((GPU.framesDone | 0) - fpsN0) * 1000) / (now - fpsT0);
      fpsT0 = now;
      fpsN0 = GPU.framesDone | 0;
      const fe = $('fpsLbl');
      if (fe && fps >= 0) {
        const fv = Math.min(999, Math.round(fps));
        fe.textContent = '' + fv;
        fe.className = fv >= 50 ? 'fg' : fv >= 30 ? 'fm' : 'fb';
      }
    }
  } else fpsT0 = 0;
  if (!started || !S) {
    if (!started && menuS && GPU.ready && !gpuBusy) {
      menuTick(dtRaw);
      GPU.frame(menuS, dtRaw);
    }
    return;
  }
  const dt = dtRaw;
  if (screaming) {
    screamT += dtRaw;
    if (GPU.ready && !gpuBusy) GPU.frame(S, dtRaw);
    drawScreamer(screamT);
    if (screamT > 1.9) {
      screaming = false;
      fxcv.style.transform = '';
      fxc.clearRect(0, 0, fxcv.width, fxcv.height);
      if (screamFatal) endScreen(false);
    }
    return;
  }
  if (paused) return;
  if (!locked && lockRetryAt && now >= lockRetryAt) {
    lockRetryAt = 0;
    requestLook(false);
  }
  if (actLock > 0) actLock = Math.max(0, actLock - dt);
  if (swPulse >= 0) {
    const sl = swPulse;
    swPulse = -1;
    if (!(S.fl.rl > 0) && !S.sw) {
      const cur = S.sel >= 0 ? S.inv[S.sel] : null;
      if (!cur && !S.inv[sl]) S.sel = sl; /* пусто→пусто: рука не меняется, анимации нет */
      else if (invSwapTo(S, sl, false)) actLock = Math.max(actLock, SW_DUR);
    }
  }
  if (dropPulse) {
    dropPulse = 0; /* G — бросить предмет из руки на пол */
    if (!(S.fl.rl > 0) && !S.sw && S.sel >= 0 && S.inv[S.sel] && invSwapTo(S, S.sel, false, true))
      actLock = Math.max(actLock, SW_DUR);
  }
  const inp = botMode
    ? botInput(S)
    : {
        fwd: kd('fwd'),
        back: kd('back'),
        left: kd('left'),
        right: kd('right'),
        turnL: keys.ArrowLeft ? 1 : 0,
        turnR: keys.ArrowRight ? 1 : 0,
        interact: interactPulse,
        run: kd('run'),
        crouch: crouchTog ? 1 : 0,
        flash: flashPulse,
        reload: reloadPulse
      };
  interactPulse = 0;
  flashPulse = 0;
  reloadPulse = 0;
  const ev = update(S, inp, dt);
  /* одноразовый клип «взять/толкнуть» и блокировка ввода — только если E сработал:
   холостое нажатие не должно ни анимироваться, ни блокировать другие действия */
  if (inp.interact && S.actDid) {
    S.pShot = S.pActKind === 'door' ? 'push' : 'interact';
    S.pShotT0 = S.time;
    actLock = Math.max(actLock, S.pActKind === 'door' ? 0.9 : PK_DUR);
  }
  if (ev.includes('reload_start')) actLock = Math.max(actLock, RL_DUR + 0.1);
  if (ev.includes('flash_on') || ev.includes('flash_off') || ev.includes('flash_dead_try'))
    actLock = Math.max(actLock, TG_DUR);
  /* runK — с ограничением скорости (резкие 0↔1 рвут стойку руки вьюмодели за
   кадр); цель — НАСТОЯЩИЙ бег (S.runNow из update: Shift && движется && не
   присел && есть выносливость), а не просто зажатый Shift. */
  S.runK =
    (S.runK || 0) + Math.max(-dt / 0.22, Math.min(dt / 0.22, (S.runNow ? 1 : 0) - (S.runK || 0)));
  if (ev.length) {
    window.__EV = (window.__EV || []).concat(ev).slice(-40);
  }
  for (const e of ev) {
    evMsg(e);
    if (e === 'win') endScreen(true);
    if (e === 'caught') {
      screaming = true;
      screamFatal = true;
      screamT = 0;
      sizeFx();
      scrRng = xsStream(S.seedState, XS_SCR).rnd;
      auScream();
    } else auEvent(e);
  }
  auFrame(S, dt);
  if (GPU.ready && !gpuBusy) GPU.frame(S, dt);
  setTxt('timeLbl', fmtDur(S.time));
  setTxt('stepLbl', fmtDist(S.steps * CELL_M)); /* клетки → метры */
  /* заряд фонаря (цвет как у выносливости: зелёный → жёлтый → красный) + инвентарь */
  {
    const fw = $('flWrap');
    if (S.fl.owned) {
      fw.classList.remove('hidden');
      const e = Math.max(0, Math.min(1, S.fl.e));
      const col = 'hsl(' + Math.round(130 * e) + ',75%,' + Math.round(42 + 14 * e) + '%)';
      setTxt('flPct', Math.round(e * 100) + '%');
      setSty('flPct', 'color', col);
      setSty('flBar', 'width', (e * 100).toFixed(0) + '%');
      setSty('flBar', 'background', col);
    } else fw.classList.add('hidden');
    updInvHud(S);
  }
  const pctW = (Math.max(0, Math.min(1, S.stam)) * 100).toFixed(0) + '%';
  /* подпись выносливости красится как её полоса (зелёный → жёлтый → красный), как у фонаря */
  const sCol =
    'hsl(' +
    Math.round(130 * Math.max(0, Math.min(1, S.stam))) +
    ',75%,' +
    Math.round(42 + 14 * S.stam) +
    '%)';
  setSty('stamBar', 'width', pctW);
  setSty('stamBar', 'background', sCol);
  setTxt('stPct', Math.round(S.stam * 100) + '%');
  setSty('stPct', 'color', sCol);
  /* прицел: точка; ладонь — когда взгляд на цели (скрыт на финише и при автопилоте) */
  {
    const cr = $('cross'),
      live = !S.won && !S.caught;
    cr.classList.toggle('hidden', !live);
    cr.classList.toggle('on', live && !botMode && !!S.aimT);
  }
  drawMinimap();
}
requestAnimationFrame(frame);

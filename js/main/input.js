/* ==== ВВОД: ЗАХВАТ КУРСОРА, МЫШЬ, КЛАВИАТУРА ==== */
let lockEl = null,
  lockRetryAt = 0,
  lockHinted = false,
  autoTries = 0;
function lockTarget() {
  return view;
}
function requestLook(byUser) {
  if (!started || paused || !S || S.won || S.caught) return;
  const el = lockTarget();
  lockEl = el;
  const again = () => {
    if (byUser || autoTries < 3) {
      autoTries++;
      lockRetryAt = performance.now() + 1300;
    }
  };
  try {
    const p = el.requestPointerLock && el.requestPointerLock();
    if (p && p.catch) p.catch(again);
  } catch (e) {
    again();
  }
}
document.addEventListener('pointerlockchange', () => {
  const wasLocked = locked;
  locked = !!document.pointerLockElement && document.pointerLockElement === lockEl;
  if (locked) {
    lockHinted = false;
    autoTries = 0;
    lockRetryAt = 0;
  }
  if (!started || !S || S.won || S.caught) return;
  if (wasLocked && !locked) setPaused(true);
});
document.addEventListener('pointerlockerror', () => {
  locked = false;
  lockRetryAt = performance.now() + 1300;
  if (started && !paused && !lockHinted) {
    lockHinted = true;
    setMsg('Кликните по игре, чтобы вернуть мышь', '#ffa94d');
  }
});
document.addEventListener('mousemove', e => {
  if (!started || !S || paused) return;
  if (locked) {
    S.ang += e.movementX * 0.0016 * (S.sens || 1.4);
    S.pitch = Math.max(
      -1.1,
      Math.min(1.1, (S.pitch || 0) - e.movementY * 0.0016 * (S.sens || 1.4))
    );
  } else if (drag) ((S.ang += (e.clientX - lastX) * 0.004 * (S.sens || 1.4)), (lastX = e.clientX));
});
view.addEventListener('pointerdown', e => {
  if (!locked && !paused) {
    drag = true;
    lastX = e.clientX;
  }
});
addEventListener('pointerup', () => (drag = false));
addEventListener('blur', clearKeys);
/* ==== ПОТЕРЯ ВКЛАДКИ: ПОЛНАЯ ПАУЗА ====
   В игре автоматически ставится пауза; в меню все звуки затухают и замирают
   (context suspend: запланированные события не играют и не съезжают по времени).
   Общее затухание — через шину AU.duck (см. auInit). */
let visSusp = false,
  visT = 0;
function audioDuck(on) {
  if (!AU.ctx || !AU.duck) return;
  const t = AU.ctx.currentTime;
  clearTimeout(visT);
  try {
    AU.duck.gain.cancelScheduledValues(t);
    AU.duck.gain.setTargetAtTime(on ? 0.0001 : 1, t, on ? 0.06 : 0.09);
  } catch (e) {}
  if (on) {
    /* даём звуку затухнуть, и только потом замораживаем контекст */
    visT = setTimeout(() => {
      if (document.hidden && visSusp && AU.ctx && AU.ctx.state === 'running')
        AU.ctx.suspend().catch(() => {});
    }, 280);
  } else if (AU.ctx.state === 'suspended' && AU.unlocked) AU.ctx.resume().catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    visSusp = true;
    if (started && !paused && !screaming) setPaused(true); /* игра — на паузу */
    audioDuck(true);
  } else if (visSusp) {
    visSusp = false;
    audioDuck(false);
  }
});
const keys = {};
let interactPulse = 0,
  flashPulse = 0,
  reloadPulse = 0,
  swPulse = -1;
/* приседание — ПЕРЕКЛЮЧАТЕЛЬ: одно нажатие привязки «Присесть» сажает (глубоко,
   на корточки), второе встаёт. */
let crouchTog = false;
/* БЛОКИРОВКА ВВОДА: пока идёт анимация действия, остальные клавиши действий
   игнорируются — нажатия не прерывают и не ускоряют друг друга. Движение, мышь,
   M и пауза не блокируются. */
let actLock = 0,
  dropPulse = 0;
const ACT_CROUCH = 0.55; /* приседание: длительность блокировки остальных действий */
/* СБРОС ВВОДА: каждое переключение контекста (пауза, меню, экран финала, новый
   раунд, потеря фокуса) сбрасывает все флаги клавиш и ожидающие импульсы. keyup
   может проглотить браузер — ESC освобождает захват курсора, а Chromium подавляет
   клавиатурные события во время этого перехода, — поэтому клавиша движения,
   отпущенная при открытом меню, иначе осталась бы нажатой и игрок сам шёл бы
   после возврата. */
function clearKeys() {
  for (const k in keys) keys[k] = 0;
  interactPulse = 0;
  flashPulse = 0;
  reloadPulse = 0;
  dropPulse = 0;
  swPulse = -1;
  drag = false;
}

addEventListener('keydown', e => {
  if (!started) return;
  const a = actOf(e.code);
  /* панель настроек открыта поверх паузы: клавиша паузы возвращает в паузу, любая
   другая клавиша остаётся внутри панели (у захвата привязок свой слушатель) */
  if (setFromPause) {
    if (a === 'pause' && !bindCapture) {
      e.preventDefault();
      closeSettings();
    }
    return;
  }
  if (a === 'pause') {
    /* Esc при захвате мыши съедает браузер (он выходит из захвата курсора) — паузу
   открывает обработчик pointerlockchange; здесь не переключаем, иначе дважды */
    if (e.code === 'Escape' && locked) return;
    if (!S.won && !S.caught) {
      setPaused(!paused);
      e.preventDefault();
    }
    return;
  }
  if (paused) return;
  keys[e.code] = 1;
  if (!e.repeat && actLock <= 0) {
    if (a === 'crouch') {
      crouchTog = !crouchTog;
      actLock = ACT_CROUCH;
    } else if (a === 'interact') interactPulse = 1;
    else if (a === 'flash') flashPulse = 1; /* фонарь вкл/выкл */
    else if (a === 'reload') reloadPulse = 1; /* замена батарейки */
    else if (a === 'drop') dropPulse = 1; /* бросить предмет */
    else if (a && a.indexOf('slot') === 0) swPulse = +a.charAt(4) - 1;
  }
  if (e.code === 'KeyM' && !e.repeat && cfg.map && cfg.map.on !== false) showMap = !showMap;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => {
  keys[e.code] = 0;
});
/* инвентарь — привязки слотов (1-4 по умолчанию): запрос уходит в swPulse и
   применяется в главном цикле (invSwapTo + actLock — защита от спама). */

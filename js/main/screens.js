/* Экраны-оверлеи: мануал, настройки, открытые из паузы (с живой пересборкой GPU),
   копирование сида и обвязка кнопок паузы, финала и меню. */
let manualFrom = 'menu';
function openManual(from) {
  manualFrom = from || 'menu';
  if (from === 'game' && !paused) setPaused(true);
  show('manual', true);
}
function closeManual() {
  show('manual', false);
}
$('miMan').onclick = () => openManual('menu');
$('pauseManBtn').onclick = () => openManual('pause');
/* смена графики не выходя из раунда: пресет или «свой» профиль. Вызывается,
   когда панель настроек, открытая из паузы, закрывается. Графику переключает
   ТОЛЬКО игрок — никакой автоматики по FPS здесь нет и не будет. */
async function applyGfxNow() {
  if (!started || !S) return;
  Q = buildQ();
  const sig = gpuSigOf(S.seed, S.W, S.H);
  let ok = GPU.ready && GPU.sig === sig && !gpuPend;
  if (!ok) {
    try {
      ok = await gpuInitQ(view, S);
    } catch (e) {
      ok = false;
    }
    GPU.ok = !!ok;
  }
  if (ok) {
    gameResize();
    view.classList.toggle('pixelated', !!Q.pixelated);
    if (!gpuBusy) {
      try {
        GPU.frame(S, 0);
      } catch (e) {}
    } /* сразу показываем новый профиль */
  } else setMsg('Рендер не пересобрался — вернитесь в меню и начните заново', '#ff6b6b');
}
/* ==== НАСТРОЙКИ ИЗ ПАУЗЫ ====
   Ровно та же панель, что и в главном меню (узел #msSet просто показывается
   поверх игры), поэтому привязки, чувствительность И любая ручка графики
   редактируются посреди раунда. Привязки и чувствительность читаются на лету;
   графике нужна пересборка GPU, а она тяжёлая — поэтому происходит один раз при
   закрытии панели, а не на каждый тик ползунка. */
function openSettings(fromPause) {
  setFromPause = !!fromPause;
  gfxDirty = false;
  $('gfxPreset').value = GFX.preset;
  buildGfxPanel();
  if (setFromPause)
    show(
      'pause',
      false
    ); /* аккордеоны НЕ раскрываются принудительно: игрок открывает то, что ему нужно */
  show('menu', true);
  menuScreen('set');
}
function closeSettings() {
  if (!setFromPause) {
    menuScreen('main');
    return;
  }
  setFromPause = false;
  show('menu', false);
  show('pause', true);
  if (S) S.sens = SENS;
  if (gfxDirty) {
    gfxDirty = false;
    applyGfxNow();
  }
}
$('pauseSetBtn').onclick = () => {
  if (paused) openSettings(true);
};
$('stBack').onclick = closeSettings;
$('setDone').onclick = closeSettings;

/* ==== СИД В ПАУЗЕ ====
   512-битный сид не влезает в HUD, поэтому живёт здесь: обрезается по ширине
   окна, а ЛКМ копирует ВСЮ строку — так раунд повторяется в точности (вставьте её
   в «Игра → Лабиринт → Сид»). */
const SEED_HINT =
  'ЛКМ по сиду — скопировать целиком (512 бит) и вставить в «Игра → Лабиринт → Сид»';
function setPauseSeed() {
  if (!S) return;
  const el = $('pauseSeed');
  if (el) {
    el.classList.remove('full');
    el.textContent = 'Сид: ' + (S.seedText || '—');
  }
  const h = $('pauseSeedHint');
  if (h) {
    h.classList.remove('ok');
    h.textContent = SEED_HINT;
  }
}
/* буфер обмена: сначала асинхронный API, затем классический execCommand
   (file://, iframe, старые браузеры); если оба отказали — сид разворачивается на
   месте, и его можно выделить */
async function copyText(t) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}
let seedHintT = 0;
function seedHint(txt, ok) {
  const h = $('pauseSeedHint');
  if (!h) return;
  h.textContent = txt;
  h.classList.toggle('ok', !!ok);
  clearTimeout(seedHintT);
  seedHintT = setTimeout(setPauseSeed, 1800);
}
$('pauseSeed').onclick = async () => {
  if (!S || !S.seedText) return;
  if (await copyText(S.seedText)) seedHint('Сид скопирован в буфер обмена ✓', true);
  else {
    $('pauseSeed').classList.add('full');
    seedHint('Буфер недоступен — сид раскрыт целиком, выделите его вручную', false);
  }
};
$('manClose').onclick = () => closeManual();
$('startBtn').onclick = () => {
  show('manual', false);
  startGame(startCfg());
};
$('resumeBtn').onclick = () => {
  setPaused(false);
  autoTries = 0;
  requestLook(true);
};
$('pauseMenuBtn').onclick = toMenu;
$('endMenuBtn').onclick = toMenu;
$('againBtn').onclick = () =>
  startGame(Object.assign({}, cfg, { seedBytes: S.seedBytes, seedText: S.seedText }));
$('nextBtn').onclick = () => startGame(Object.assign({}, cfg, { seedBytes: null, seedText: '' }));
$('botBtn').onclick = e => {
  botMode = !botMode;
  if (botMode && S) enableBot(S);
  e.target.textContent = botMode ? 'Автопилот: ВКЛ' : 'Автопилот';
};

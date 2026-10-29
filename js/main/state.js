/* Общее состояние основного слоя: ссылки на DOM, живой забег (S), флаги
   интерфейса и режима. */
const view = document.getElementById('view');
const mm = document.getElementById('minimap'),
  mctx = mm.getContext('2d');
const fxcv = document.getElementById('fx'),
  fxc = fxcv.getContext('2d');
const $ = id => document.getElementById(id);
let S = null,
  started = false,
  locked = false,
  drag = false,
  lastX = 0,
  showMap = true,
  msgTimer = 0,
  botMode = false;
let paused = false,
  screaming = false,
  screamT = 0,
  screamFatal = false;
/* панель настроек, открытая ИЗ ПАУЗЫ (та же, что в главном меню):
   setFromPause — она открыта поверх игры; gfxDirty — графику там изменили, и при
   закрытии панели ещё нужна одна пересборка GPU */
let setFromPause = false,
  gfxDirty = false;
let scrRng = xsFromU32(0x5ceef4ce).rnd;
let cfg = {};

/* ==== ЭКРАН ЗАГРУЗКИ: настоящие шаги инициализации, ENTER — начать ====
   Прогресс честный: полоса двигается, когда очередной тяжёлый шаг (настройки,
   видеокарта, текстуры, геометрия, конвейеры, первый кадр, звуковой движок)
   действительно завершён — скорость зависит от машины. Вход только по Enter:
   нажатие клавиши — жест, разблокирующий звук (политика автозапуска), поэтому
   меню озвучивается в тот же миг, не дожидаясь первого клика. */
const LD = {
  p: -1,
  ready: false,
  done: false,
  el: null,
  pct: null,
  lbl: null,
  init() {
    this.el = $('ldFill');
    this.pct = $('ldPct');
    this.lbl = $('ldLbl');
  },
  set(p, l) {
    p = Math.max(0, Math.min(100, p | 0));
    if (p !== this.p) {
      this.p = p;
      this.el.style.width = p + '%';
      this.pct.textContent = p + '%';
    }
    if (l !== undefined && this.lbl.textContent !== l) this.lbl.textContent = l;
  },
  tick() {
    return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  }
};
LD.init();
/* переходный загрузчик: тот же экран для «Начать игру» и «Вернуться в меню».
   Завершается САМ (без Enter) — Enter остаётся только на первой загрузке, где
   нажатие клавиши разблокирует аудиоконтекст. */
let ldBusy = false;
const ldWait = ms => new Promise(r => setTimeout(r, ms));
function ldShow(label) {
  LD.p = -1;
  LD.el.style.width = '0%';
  LD.pct.textContent = '0%';
  LD.lbl.textContent = label || '';
  $('ldGo').classList.add('hidden');
  $('loader').classList.remove('hidden');
}
function ldTrack(base, span) {
  window.LDSTEP = async (f, l) => {
    LD.set(base + Math.round(f * span), l);
    await LD.tick();
  };
}
async function ldHide() {
  LD.set(100, '');
  await LD.tick();
  await ldWait(140);
  $('loader').classList.add('hidden');
}

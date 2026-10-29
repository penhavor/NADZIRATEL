/* =============== РЕЕСТР СОБЫТИЙ ================
   По одной записи на событие: msg — текст всплывающего сообщения [строка, цвет],
   snd — звук. Новые события добавляются только здесь. Победа и захват — в
   frame() (экраны). */
/* звук от источника: панорама и приглушение стенами — по его позиции */
function spT(p, f0, f1, dur, type, vol) {
  auTone(f0, f1, dur, type, vol * p.att, p.pan, p.muf);
}
function spN(p, dur, f, q, vol) {
  auNoise(dur, f, q, vol * p.att, p.pan, p.muf);
}
const sndDoorMove = () => {
  auTone(150, 95, 0.45, 'triangle', 0.26, 0);
  auNoise(0.3, 800, 2.2, 0.38, 0);
  auTone(70, 48, 0.14, 'square', 0.2, 0);
};
const sndDeny = () => {
  auTone(95, 60, 0.22, 'square', 0.2, 0);
  auNoise(0.14, 500, 1.5, 0.3, 0);
};
const sndBatt = () => {
  auTone(1250, 900, 0.09, 'square', 0.16, 0);
  auNoise(0.06, 2600, 1.2, 0.2, 0);
};
const sndErr = () => auTone(150, 110, 0.12, 'square', 0.12, 0);
const EVT = {
  pickup_key: {
    msg: ['Ключ у вас! У двери держите его в руке (1-4).', '#ffd43b'],
    snd: () => {
      auTone(880, 1320, 0.5, 'sine', 0.36, 0);
      auTone(1760, 1760, 0.35, 'sine', 0.15, 0);
    }
  },
  drop_item: { snd: auRustle },
  door_locked: {
    msg: ['Заперто. Ключ где-то в лабиринте.', '#ff6b6b'],
    snd: () => spT(posOf('door'), 120, 80, 0.3, 'square', 0.26)
  },
  door_needhand: {
    msg: ['Ключ в инвентаре: возьмите его в руку (1-4).', '#ffa94d'],
    snd: () => spT(posOf('door'), 150, 95, 0.34, 'square', 0.24)
  },
  door_unlock: {
    msg: ['Вентиль повёрнут — дверь разблокирована. E — толкнуть полотно.', '#63e6be'],
    snd: () => {
      const p = posOf('door');
      spT(p, 150, 215, 1.15, 'square', 0.17);
      spN(p, 1.1, 750, 1.3, 0.45);
    }
  },
  door_open: {
    msg: ['Дверь открыта! Вперёд.', '#63e6be'],
    snd: () => {
      const p = posOf('door');
      spT(p, 220, 140, 1.2, 'sawtooth', 0.2);
      spN(p, 0.9, 500, 1.5, 0.55);
    }
  },
  monster_seen: {
    msg: ['Надзиратель видит вас!', '#ff6b6b'],
    snd: () => {
      const p = posOf('shadow');
      auSeen(p.pan, p.muf);
    }
  },
  monster_heard: {
    msg: ['Он услышал шум — бежит проверить!', '#ffa94d'],
    snd: () => {
      const p = posOf('shadow');
      spT(p, 170, 110, 0.5, 'sawtooth', 0.2);
      spN(p, 0.4, 240, 1.6, 0.55);
    }
  },
  shadow_teleport: {
    msg: ['Темнота за спиной шевельнулась…', '#ffa94d'],
    snd: () => {
      const p = posOf('shadow');
      spN(p, 0.7, 140, 0.8, 0.8);
      spT(p, 300, 60, 0.8, 'sine', 0.3);
    }
  },
  safe_open: { msg: ['Дверь открыта. Сейф-комната не защищает.', '#ffa94d'], snd: sndDoorMove },
  safe_close: { msg: ['Дверь закрыта. Здесь вас не достать.', '#63e6be'], snd: sndDoorMove },
  safe_denied: { msg: ['Не закрыть: вы стоите в проёме.', '#ffa94d'], snd: sndDeny },
  safe_forced: { msg: ['Дверь распахнулась: не стойте в проёме!', '#ffa94d'], snd: sndDeny },
  safe_denied_mon: {
    msg: ['Не закрыть: Надзиратель внутри сейф-комнаты!', '#ff6b6b'],
    snd: sndDeny
  },
  safe_forced_mon: {
    msg: ['Надзиратель распирает дверь — запереть его не выйдет!', '#ff6b6b'],
    snd: sndDeny
  },
  exhausted: { msg: ['Выдохлись. Шаг — и стамина вернётся.', '#ffa94d'] },
  win: {
    snd: () =>
      [523, 659, 784, 1046].forEach((f, k) =>
        setTimeout(() => auTone(f, f, 0.7, 'sine', 0.3, 0), k * 140)
      )
  },
  flash_on: { snd: () => auClick(0.55, 0, true) },
  flash_off: { snd: () => auClick(0.45, 0, false) },
  flash_needhand: { msg: ['Фонарик не в руке — возьмите его (1-4).', '#ffa94d'], snd: sndErr },
  flash_none: { msg: ['Фонарика нет. Он лежит на столе в сейф-комнате.', '#ffa94d'], snd: sndErr },
  pickup_flash: {
    msg: ['Фонарик взят. F — свет, R — замена батарейки.', '#ffd43b'],
    snd: () => {
      auNoise(0.1, 900, 1.4, 0.3, 0);
      auClick(0.5, 0, false);
    }
  },
  flash_dead: {
    msg: ['Фонарь погас! R — заменить батарейку.', '#ff6b6b'],
    snd: () => {
      auTone(240, 42, 0.7, 'sawtooth', 0.2, 0);
      auClick(0.45, 0, false);
    }
  },
  flash_dead_try: {
    msg: ['Батарейка мертва. R — заменить.', '#ff6b6b'],
    snd: () => auClick(0.55, 0, false)
  },
  no_batt: { msg: ['Нет запасных батареек — ищите в тумбочках.', '#ff6b6b'], snd: sndErr },
  batt_fresh: { msg: ['Батарейка ещё свежая — менять рано.', '#ffa94d'], snd: sndErr },
  batt_in: { snd: auBattIn },
  reload_done: {
    msg: ['Батарейка заменена.', '#63e6be'],
    snd: () => auNoise(0.16, 620, 0.9, 0.16, 0)
  } /* щелчка выключателя нет: крышка уже навинчена — тихий шорох руки */,
  pickup_batt: { msg: ['Батарейка (+1).', '#63e6be'], snd: sndBatt },
  inv_full: {
    msg: ['Инвентарь полон: 4 слота, батарейки стакаются до 4.', '#ffa94d'],
    snd: sndErr
  },
  hands_busy: { msg: ['Руки заняты — сначала закончите с батарейкой.', '#ffa94d'], snd: sndErr },
  cab_open: { snd: () => auDrawer(true) },
  cab_close: { snd: () => auDrawer(false) }
};
function evMsg(e) {
  const r = EVT[e];
  if (r && r.msg) setMsg(r.msg[0], r.msg[1]);
}
function auEvent(e) {
  if (!AU.on) return;
  const r = EVT[e];
  if (r && r.snd) r.snd();
}

const SOUNDS = [
  [
    'Гул ламп (2.5 с)',
    () => {
      if (!AU.on) return;
      const t = AU.ctx.currentTime,
        g = AU.humG.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.22, t + 0.3);
      g.setValueAtTime(0.22, t + 2.0);
      g.linearRampToValueAtTime(0.0001, t + 2.6);
    }
  ],
  ['Треск лампы', () => auCrack(0.75, 0)],
  ['Пещерный стон', () => auCave(0)],
  ['Шёпот', () => auWhisper(0)],
  ['Металлический лязг', () => auClang(0)],
  ['Он вас увидел', () => auSeen(0)],
  ['Портал Надзирателя', () => auEvent('shadow_teleport')],
  ['Щелчок фонарика', () => auClick(0.55, 0, true)],
  ['Ящик тумбочки', () => auDrawer(true)],
  ['Дыхание за спиной', () => auBreath(0.6)],
  ['Царапанье', () => auScratch(-0.5)],
  ['Сердцебиение', () => auHeart(0.45)],
  ['Подбор ключа', () => auEvent('pickup_key')],
  ['Дверь заперта', () => auEvent('door_locked')],
  ['Вентиль двери', () => auEvent('door_unlock')],
  ['Дверь открыта', () => auEvent('door_open')],
  ['Победа', () => auEvent('win')],
  ['СКРИМЕР', () => auScream()]
];
function buildSndLab() {
  const box = $('sndBtns');
  box.innerHTML = '';
  for (const [lab, fn] of SOUNDS) {
    const b = document.createElement('button');
    b.textContent = lab;
    b.onclick = () => {
      auInit();
      if (AU.ctx && AU.ctx.state === 'suspended') AU.ctx.resume();
      auSetMute(false);
      fn();
    };
    box.appendChild(b);
  }
}
buildSndLab();
$('sndClose').onclick = () => {
  show('sndlab', false);
  if (!started) auSetMute(true);
};

/* ==== ЗВУКИ МЕНЮ: наведения и щелчки виджетов ====
   Отдельная шина AU.ui в обход AU.master — в меню мастер заглушён (auSetMute), но
   звуки интерфейса играть обязаны. Контекст создаётся по первому клику (политика
   автозапуска) — до этого меню молчит, как любая игра на входе. */
function uiAudioOn() {
  if (!AU.ctx) auInit();
  if (AU.ctx) {
    /* AU.unlocked: звук уже разблокирован жестом — visibilitychange может
   возобновить контекст без нового жеста */
    if (AU.ctx.state === 'running') AU.unlocked = true;
    else
      AU.ctx
        .resume()
        .then(() => {
          AU.unlocked = true;
          musTry();
        })
        .catch(() => {});
  }
  musTry();
}
function uiSnd(kind) {
  if (!AU.ctx || AU.ctx.state !== 'running') return;
  const c = AU.ctx,
    t = c.currentTime;
  if (!AU.ui) {
    AU.ui = c.createGain();
    AU.ui.gain.value = 0.9;
    AU.ui.connect(AU.duck || c.destination);
  }
  const g = c.createGain();
  g.connect(AU.ui);
  if (kind === 'hover') {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 1620 + Math.random() * 260;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.07);
  } else {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(430, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.24, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.12);
    if (AU.noise) {
      const s = c.createBufferSource();
      s.buffer = AU.noise;
      s.playbackRate.value = 1.5;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2300;
      f.Q.value = 1.0;
      const g2 = c.createGain();
      g2.gain.setValueAtTime(0.13, t);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      s.connect(f);
      f.connect(g2);
      g2.connect(AU.ui);
      s.start(t);
      s.stop(t + 0.06);
    }
  }
}
/* делегирование: кнопки внутри видимых оверлеев (меню, пауза, мануал, экраны).
   В игре оверлеи скрыты — этих звуков нет. */
function uiWidget(e) {
  const b = e.target && e.target.closest ? e.target.closest('button') : null;
  return b && b.closest('.overlay') ? b : null;
}
let uiClickT = 0;
document.addEventListener(
  'pointerdown',
  e => {
    uiAudioOn();
    if (!uiWidget(e)) return;
    uiSnd('click');
    uiClickT = performance.now();
  },
  true
);
document.addEventListener(
  'click',
  e => {
    /* активация с клавиатуры (Enter/Space) */
    if (performance.now() - uiClickT < 500) return;
    if (!uiWidget(e)) return;
    uiAudioOn();
    uiSnd('click');
  },
  true
);
document.addEventListener(
  'pointerover',
  e => {
    const b = uiWidget(e);
    if (!b) return;
    if (e.relatedTarget && b.contains(e.relatedTarget)) return; /* движение внутри кнопки */
    uiSnd('hover');
  },
  true
);

/* ==== СОСТОЯНИЕ НАСТРОЕК (переживает перезагрузку страницы) ==== */
const DEF_BINDS = {
  fwd: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA'],
  right: ['KeyD'],
  run: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC'],
  interact: ['KeyE'],
  flash: ['KeyF'],
  reload: ['KeyR'],
  drop: ['KeyG'],
  pause: ['Escape'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  slot4: ['Digit4']
};
const BIND_DEFS = [
  ['fwd', 'Вперёд'],
  ['back', 'Назад'],
  ['left', 'Влево'],
  ['right', 'Вправо'],
  ['run', 'Бег'],
  ['crouch', 'Присесть'],
  ['interact', 'Взаимодействовать'],
  ['flash', 'Фонарик'],
  ['reload', 'Перезарядка фонарика'],
  ['drop', 'Бросить'],
  ['pause', 'Пауза'],
  ['slot1', '1 слот инвентаря'],
  ['slot2', '2 слот инвентаря'],
  ['slot3', '3 слот инвентаря'],
  ['slot4', '4 слот инвентаря']
];
let binds = JSON.parse(JSON.stringify(DEF_BINDS));
let SENS = 1.4;
/* дефолт = пресет «средний»: первый запуск без сейва должен ему соответствовать */
let PLAY = {
  preset: 'medium',
  seedText: '',
  W: 24,
  H: 24,
  dens: 0.3,
  cabD: 0.05,
  loot: 50,
  mon: true,
  monSp: 15,
  tp: false,
  map: Object.assign({}, PRESETS.medium.map)
};
/* профиль графики: имя пресета + все ручки; правка любой ручки ⇒ пресет «свой» */
const GKEYS = QSIG.filter(k => k !== 'level');
let GFX = { preset: 'ultra', v: null };
function knobsOf(q) {
  const v = {};
  for (const k of GKEYS) v[k] = k === 'res' ? [q.res[0], q.res[1]] : q[k];
  return v;
}
function buildQ() {
  const p = GFX.preset;
  return Object.assign({}, QUALITY.BASE, QUALITY.OFF, GFX.v, {
    level: p,
    name: p === 'custom' ? 'своя' : (QUALITY[p] && QUALITY[p].name) || 'своя'
  });
}
GFX.v = knobsOf(QUALITY.ultra);
const CFG_KEY = 'nadziratel_cfg',
  CFG_KEY_LEGACY = 'sml84'; /* старое имя — только для чтения, нужно для миграции */
function saveSettings() {
  try {
    localStorage.setItem(
      CFG_KEY,
      JSON.stringify({ sens: SENS, binds: binds, gfx: GFX, play: PLAY })
    );
  } catch (e) {}
}
let saveT = 0;
function scheduleSave() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    saveT = 0;
    saveSettings();
  }, 250);
}
/* антидребезг 250 мс: если вкладку закрыли сразу после правки — досылаем остаток */
addEventListener('pagehide', () => {
  if (saveT) {
    clearTimeout(saveT);
    saveT = 0;
    saveSettings();
  }
});
function loadSettings() {
  try {
    let raw = localStorage.getItem(CFG_KEY);
    if (raw === null) raw = localStorage.getItem(CFG_KEY_LEGACY); /* миграция со старого ключа */
    const j = JSON.parse(raw);
    if (!j) return;
    if (typeof j.sens === 'number' && j.sens >= 0.5 && j.sens <= 3) SENS = j.sens;
    if (j.binds)
      for (const k in DEF_BINDS) {
        const b = j.binds[k];
        if (Array.isArray(b) && b.length && b.every(x => typeof x === 'string'))
          binds[k] = b.slice(0, 3);
      }
    if (j.gfx && j.gfx.v) {
      const p = j.gfx.preset === 'custom' || QUALITY[j.gfx.preset] ? j.gfx.preset : 'ultra';
      GFX.preset = p;
      GFX.v = Object.assign(knobsOf(QUALITY[p === 'custom' ? 'ultra' : p]), j.gfx.v);
      for (const k in GFX.v)
        if (GKEYS.indexOf(k) < 0) delete GFX.v[k]; /* старые сохранения: удалённые ручки */
      if (!Array.isArray(GFX.v.res) || GFX.v.res.length !== 2) GFX.v.res = [1600, 1000];
    }
    if (j.play) {
      const pl = j.play;
      if (pl.preset && (PRESETS[pl.preset] || pl.preset === 'custom')) PLAY.preset = pl.preset;
      if (typeof pl.seedText === 'string') PLAY.seedText = pl.seedText.slice(0, 128);
      if (typeof pl.W === 'number' && pl.W >= 1 && pl.W <= 100) PLAY.W = Math.round(pl.W);
      /* старые сохранения хранили один квадратный размер (только W) — глубина
   откатывается к ширине */
      if (typeof pl.H === 'number' && pl.H >= 1 && pl.H <= 100) PLAY.H = Math.round(pl.H);
      else PLAY.H = PLAY.W;
      for (const k of ['dens', 'cabD'])
        if (typeof pl[k] === 'number' && pl[k] >= 0 && pl[k] <= 1)
          PLAY[k] = Math.round(pl[k] * 1e4) / 1e4;
      if (typeof pl.loot === 'number' && pl.loot >= 0 && pl.loot <= 100)
        PLAY.loot = Math.round(pl.loot * 100) / 100;
      if (typeof pl.mon === 'boolean') PLAY.mon = pl.mon;
      if (typeof pl.monSp === 'number' && pl.monSp >= 8 && pl.monSp <= 100)
        PLAY.monSp = Math.round(pl.monSp);
      if (typeof pl.tp === 'boolean') PLAY.tp = pl.tp;
      if (pl.map)
        for (const k in MAP_DEF) if (typeof pl.map[k] === 'boolean') PLAY.map[k] = pl.map[k];
      /* миграция ребаланса: сохранённый ИМЕННОЙ пресет больше не совпадает со своими
   параметрами (пресеты изменились в новой сборке) — восстанавливаем текущие
   значения пресета */
      if (PLAY.preset !== 'custom' && !playMatchesPreset()) applyPresetData(PLAY.preset);
    }
  } catch (e) {}
}

/* ==== НАЗВАНИЯ КЛАВИШ И ПРИВЯЗКИ ==== */
function keyName(c) {
  if (!c) return '—';
  let m;
  if ((m = c.match(/^Key([A-Z])$/))) return m[1];
  if ((m = c.match(/^Digit(\d)$/))) return m[1];
  if ((m = c.match(/^Numpad(\d)$/))) return 'Num' + m[1];
  if ((m = c.match(/^F(\d{1,2})$/))) return c;
  const SP = {
    Escape: 'Esc',
    Space: 'Space',
    Enter: 'Enter',
    NumpadEnter: 'Num↵',
    Tab: 'Tab',
    Backspace: 'Backsp',
    Delete: 'Del',
    Insert: 'Ins',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    AltRight: 'R-Alt',
    MetaLeft: 'L-Win',
    MetaRight: 'R-Win',
    CapsLock: 'Caps',
    PageUp: 'PgUp',
    PageDown: 'PgDn',
    Home: 'Home',
    End: 'End',
    Minus: '−',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: '"',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
    NumpadAdd: 'Num+',
    NumpadSubtract: 'Num−',
    NumpadMultiply: 'Num×',
    NumpadDivide: 'Num/'
  };
  return SP[c] || c;
}
function bindLabel(a) {
  return (binds[a] || []).map(keyName).join(' / ');
}
function actOf(code) {
  for (const a in binds) if (binds[a].indexOf(code) >= 0) return a;
  return null;
}
function kd(a) {
  const b = binds[a];
  if (!b) return 0;
  for (const c of b) if (keys[c]) return 1;
  return 0;
}
let bindCapture = null;
function buildBindsPanel() {
  const host = $('bindRows');
  host.innerHTML = '';
  for (const [k, label] of BIND_DEFS) {
    const row = document.createElement('div');
    row.className = 'srow';
    const lab = document.createElement('label');
    lab.textContent = label;
    const btn = document.createElement('button');
    btn.className = 'kbdBtn';
    btn.type = 'button';
    btn.textContent = bindLabel(k);
    btn.onclick = () => {
      bindCapture = k;
      btn.textContent = 'нажми…';
      btn.classList.add('capt');
    };
    row.appendChild(lab);
    row.appendChild(btn);
    host.appendChild(row);
  }
}
/* захват клавиши для привязки: фаза capture, активен только пока ждём нажатия */
addEventListener(
  'keydown',
  e => {
    if (!bindCapture) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (e.code !== 'Escape') {
      for (const a in binds) if (a !== bindCapture) binds[a] = binds[a].filter(c => c !== e.code);
      binds[bindCapture] = [e.code];
    }
    bindCapture = null;
    buildBindsPanel();
    scheduleSave();
    updMenuHints();
  },
  true
);
function bindHint() {
  const n = a => keyName((binds[a] || [])[0]);
  return (
    'Мышь — обзор · ' +
    n('fwd') +
    '/' +
    n('left') +
    '/' +
    n('back') +
    '/' +
    n('right') +
    ' — движение · ' +
    n('run') +
    ' — бег · ' +
    n('interact') +
    ' — взаимодействие · ' +
    n('flash') +
    ' — фонарик · ' +
    n('reload') +
    ' — батарейка · ' +
    n('slot1') +
    '/' +
    n('slot2') +
    '/' +
    n('slot3') +
    '/' +
    n('slot4') +
    ' — инвентарь · ' +
    n('drop') +
    ' — бросить · ' +
    n('crouch') +
    ' — присесть · M — карта · ' +
    n('pause') +
    ' — пауза'
  );
}
function updMenuHints() {
  const el = $('mfootHint');
  if (el) el.textContent = bindHint();
}

/* ==== ПАНЕЛЬ ГРАФИКИ: все ручки пресетов ==== */
const GFX_GROUPS = [
  [
    'Разрешение и фильтрация',
    [
      { k: 'res', t: 'res', label: 'Разрешение рендера' },
      { k: 'aniso', t: 'sel', label: 'Анизотропия', opts: [0, 1, 2, 4, 8, 16] }
    ]
  ],
  [
    'Текстуры и рельеф',
    [
      { k: 'atlas', t: 'int', min: 64, max: 2048, step: 64, label: 'Атлас, px' },
      { k: 'nrmK', t: 'rng', min: 0, max: 1, step: 0.02, label: 'Сила нормалей' },
      { k: 'tbn', t: 'ck', label: 'Тангентные нормали (TBN)' },
      { k: 'detN', t: 'rng', min: 0, max: 1, step: 0.02, label: 'Микродеталь нормалей' },
      { k: 'pom', t: 'int', min: 0, max: 32, step: 1, label: 'Паралакс: шагов' },
      { k: 'pomK', t: 'rng', min: 0, max: 0.05, step: 0.002, label: 'Паралакс: глубина' },
      { k: 'pomRef', t: 'int', min: 0, max: 8, step: 1, label: 'Паралакс в отражениях' }
    ]
  ],
  [
    'Свет и тени',
    [
      { k: 'far', t: 'rng', min: 20, max: 150, step: 5, label: 'Дальность прорисовки' },
      { k: 'propDist', t: 'rng', min: 4, max: 80, step: 1, label: 'Дальность реквизита' },
      { k: 'shSteps', t: 'int', min: 16, max: 512, step: 16, label: 'Карта теней: колонок' },
      { k: 'shRows', t: 'int', min: 8, max: 128, step: 8, label: 'Карта теней: поясов' },
      { k: 'shTaps', t: 'int', min: 1, max: 16, step: 1, label: 'Тени: PCF-тапов' },
      { k: 'shLamps', t: 'int', min: 1, max: 64, step: 1, label: 'Ламп с тенями' },
      { k: 'msaa', t: 'sel', label: 'MSAA', opts: [0, 4] },
      { k: 'ssao', t: 'int', min: 0, max: 24, step: 1, label: 'SSAO: сэмплов (0 — выкл)' },
      { k: 'ssaoR', t: 'rng', min: 0.05, max: 1, step: 0.05, label: 'SSAO: радиус' },
      { k: 'ssaoK', t: 'rng', min: 0, max: 2, step: 0.05, label: 'SSAO: сила' },
      { k: 'vol', t: 'int', min: 0, max: 32, step: 1, label: 'Объёмный свет: шагов (0 — выкл)' },
      { k: 'volK', t: 'rng', min: 0, max: 2, step: 0.05, label: 'Объёмный свет: сила' },
      { k: 'flare', t: 'sel', label: 'Анаморфные блики', opts: [0, 1] },
      { k: 'flareK', t: 'rng', min: 0, max: 2, step: 0.05, label: 'Сила бликов' }
    ]
  ],
  [
    'Отражения и материалы',
    [
      { k: 'reflScale', t: 'rng', min: 0.25, max: 1, step: 0.05, label: 'Разрешение отражений' },
      { k: 'reflTaps', t: 'int', min: 3, max: 16, step: 1, label: 'Сглаживание отражений' },
      { k: 'spec', t: 'ck', label: 'Спекуляры' },
      { k: 'pbr', t: 'ck', label: 'GGX-PBR' }
    ]
  ],
  [
    'Постобработка и цвет',
    [
      { k: 'hdr', t: 'ck', label: 'HDR-буфер' },
      { k: 'bloomLv', t: 'int', min: 0, max: 6, step: 1, label: 'Bloom: уровней' },
      { k: 'sharp', t: 'rng', min: 0, max: 1, step: 0.02, label: 'Резкость' },
      { k: 'grain', t: 'rng', min: 0, max: 0.1, step: 0.002, label: 'Зерно' },
      { k: 'ca', t: 'rng', min: 0, max: 0.01, step: 0.0002, label: 'Хром. аберрации' },
      { k: 'dither', t: 'rng', min: 0, max: 2, step: 0.05, label: 'Дизеринг' }
    ]
  ]
];
function fmtV(r, v) {
  const d = (String(r.step).split('.')[1] || '').length;
  return (+v).toFixed(d);
}
function setGfx(k, val) {
  GFX.v[k] = val;
  if (GFX.preset !== 'custom') {
    GFX.preset = 'custom';
    $('gfxPreset').value = 'custom';
  }
  scheduleSave();
  if (setFromPause) gfxDirty = true;
}
function buildGfxPanel() {
  const host = $('gfxRows');
  host.innerHTML = '';
  for (const [title, rows] of GFX_GROUPS) {
    const h = document.createElement('div');
    h.className = 'ghead';
    h.textContent = title;
    host.appendChild(h);
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'srow';
      const lab = document.createElement('label');
      lab.textContent = r.label;
      row.appendChild(lab);
      const v = GFX.v[r.k];
      if (r.t === 'res') {
        const ctl = document.createElement('span');
        ctl.className = 'ctl';
        const mk = (val, i) => {
          const n = document.createElement('input');
          n.type = 'number';
          n.min = i ? 200 : 320;
          n.max = i ? 4320 : 7680;
          n.step = 8;
          n.value = val;
          n.onchange = () => {
            const res = GFX.v.res.slice();
            res[i] = Math.max(+n.min, Math.min(+n.max, Math.round(+n.value) || val));
            n.value = res[i];
            setGfx('res', res);
          };
          ctl.appendChild(n);
          return n;
        };
        mk(v[0], 0);
        ctl.appendChild(document.createTextNode('×'));
        mk(v[1], 1);
        row.appendChild(ctl);
      } else if (r.t === 'ck') {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!v;
        cb.onchange = () => setGfx(r.k, cb.checked);
        row.appendChild(cb);
      } else if (r.t === 'sel') {
        const se = document.createElement('select');
        se.style.width = '86px';
        for (const o of r.opts) {
          const op = document.createElement('option');
          op.value = o;
          op.textContent = o;
          se.appendChild(op);
        }
        se.value = v;
        se.onchange = () => setGfx(r.k, +se.value);
        row.appendChild(se);
      } else if (r.t === 'rng') {
        const ctl = document.createElement('span');
        ctl.className = 'ctl';
        const rg = document.createElement('input');
        rg.type = 'range';
        rg.min = r.min;
        rg.max = r.max;
        rg.step = r.step;
        rg.value = v;
        const sp = document.createElement('span');
        sp.className = 'val';
        sp.textContent = fmtV(r, v);
        rg.oninput = () => {
          sp.textContent = fmtV(r, rg.value);
          setGfx(r.k, parseFloat(rg.value));
        };
        ctl.appendChild(rg);
        ctl.appendChild(sp);
        row.appendChild(ctl);
      } else {
        const n = document.createElement('input');
        n.type = 'number';
        n.min = r.min;
        n.max = r.max;
        n.step = r.step || 1;
        n.value = v;
        n.onchange = () => {
          let x = Math.round((+n.value || v) / (r.step || 1)) * (r.step || 1);
          x = Math.max(r.min, Math.min(r.max, x));
          n.value = x;
          setGfx(r.k, x);
        };
        row.appendChild(n);
      }
      host.appendChild(row);
    }
  }
}
$('gfxPreset').onchange = e => {
  const p = e.target.value;
  GFX.preset = p;
  if (p !== 'custom') GFX.v = knobsOf(QUALITY[p]);
  buildGfxPanel();
  scheduleSave();
  if (setFromPause) gfxDirty = true;
};

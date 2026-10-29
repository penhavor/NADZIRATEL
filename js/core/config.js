/* NADZIRATEL · WebGPU.
   Масштаб: 1 клетка ~= 2.94 м; герой ровно 1.80 м ростом, потолок 3.5 м, глаза
   на 1.62 м. Скорости задаются в км/ч и переводятся в клетки/с через KMH().
   Шаги игрока и Монитора выводятся из равных чисел Фруда (опорная нога не
   проскальзывает); камера от первого лица следует реальной позе модели.
   Тяжёлые стадии кадра (угловая карта теней, скиннинг, поле облучённости)
   выполняются как compute. Состав: js/core/* = мир/геймплей, js/render/* =
   модели/позы/шейдеры/рендер, js/main/* = звук/ввод/интерфейс/запуск (порядок
   загрузки — в index.html). */
var CELL_M = 2.94225; /* метров на клетку: риг 1.773 * PL_SCALE 0.345 * CELL_M = ровно 1.80 м роста */
var CEIL_H = 3.5 / CELL_M; /* высота потолка и стен в клетках (3.5 м) */
var LAMP_Y = CEIL_H - 0.1; /* лампа висит с потолка (труба крепежа 0.10) */
var DOOR_H = CEIL_H - 0.002; /* дверная створка доходит до потолка (зазора сверху нет) */
function KMH(v) {
  return v / 3.6 / CELL_M;
} /* км/ч → клетки/с */

/* Миникарта: 8 независимых переключателей (вкл/неизведанное/монстр/лампы/шкафы/ключ/старт/выход) */
var MAP_DEF = {
  on: true,
  unexp: true,
  mon: false,
  lamps: true,
  cabs: true,
  key: false,
  spawn: true,
  exit: true
};
function mapCfg(o) {
  return Object.assign({}, MAP_DEF, o);
}
/* cabD = доля открытых клеток, получающих шкаф (1 = каждая клетка);
   loot = % шкафов с содержимым (в одном из них лежит ключ);
   W/H = СГЕНЕРИРОВАННЫЙ размер лабиринта (сетка добавляет вокруг него кольцо
   стен плюс комнаты старта и выхода за пределами кольца) */
var PRESETS = {
  practice: {
    W: 8,
    H: 8,
    monster: false,
    monsterSpeed: KMH(10),
    density: 0.5,
    teleport: false,
    cabD: 0.25,
    loot: 100,
    map: mapCfg({ mon: true, key: true })
  },
  easy: {
    W: 16,
    H: 16,
    monster: true,
    monsterSpeed: KMH(10),
    density: 0.4,
    teleport: false,
    cabD: 0.1,
    loot: 75,
    map: mapCfg({ mon: true, exit: false })
  },
  medium: {
    W: 24,
    H: 24,
    monster: true,
    monsterSpeed: KMH(15),
    density: 0.3,
    teleport: false,
    cabD: 0.05,
    loot: 50,
    map: mapCfg({ unexp: false, lamps: false, cabs: false, exit: false })
  },
  hard: {
    W: 32,
    H: 32,
    monster: true,
    monsterSpeed: KMH(20),
    density: 0.2,
    teleport: true,
    cabD: 0.05,
    loot: 25,
    map: mapCfg({ on: false, unexp: false, lamps: false, cabs: false, spawn: false, exit: false })
  },
  extreme: {
    W: 32,
    H: 32,
    monster: true,
    monsterSpeed: KMH(40),
    density: 0.1,
    teleport: true,
    cabD: 0.16,
    loot: 10,
    map: mapCfg({ on: false, unexp: false, lamps: false, cabs: false, spawn: false, exit: false })
  },
  impossible: {
    W: 64,
    H: 64,
    monster: true,
    monsterSpeed: KMH(100),
    density: 0.0,
    teleport: true,
    cabD: 0.08,
    loot: 4,
    map: mapCfg({ on: false, unexp: false, lamps: false, cabs: false, spawn: false, exit: false })
  }
};
/* НАСТОЯЩАЯ ТЕМНОТА: AMBIENT почти ноль вдали от ламп; DARK_T = порог «тёмной
   клетки» для теневого телепорта монстра */
const AMBIENT = 0.02,
  LAMP_R = 3.2,
  DARK_T = AMBIENT + 0.06;
/* Визуальный пол для непрямого света: в закрытом лабиринте отражения дают
   слабый, но НЕ НУЛЕВОЙ фон. Питает только карту света; игровые s.light и DARK_T
   остаются на AMBIENT */
var SC_FLOOR = 0.055;
var DOOR_BG_K = 1.0; /* albedo двери совпадает с кирпичом, компенсация не нужна (см. doorSides) */

/* Скорости в км/ч: присед 2, шаг 7 (потолок по Фруду V^2/(g*L) = 0.42 против
   0.5 на переходе к бегу), бег 20. Шаг Монитора ВЫВОДИТСЯ из равного числа
   Фруда: L_игрока = 0.9136 м, L_монстра = 0.41 клетки = 1.2063 м =>
   V = 7*sqrt(1.2063/0.9136) = 8.04 км/ч. Геометрия шага живёт в MON_GAIT (render) */
var WALK_SP = KMH(7),
  RUN_SP = KMH(20);
var CROUCH_SP = KMH(2);
var MON_WALK = KMH(8.04); /* вывод выше; не зависит от сложности */
/* страховка порядка загрузки: скрипт рендера публикует window.MON_GAIT_K до первого кадра */
var MON_K_FALLBACK = { walk: 8.3983, run: 5.8798 };

var QUALITY = (function () {
  /* Параметры, общие для всех пресетов. Освещение и цветокор здесь СОЗНАТЕЛЬНО не
   лежат: они одинаковы на любом пресете (античит) — пресеты меняют только
   КАЧЕСТВО */
  const BASE = {
    lamps: 56,
    fog: 0.0022,
    normals: true,
    hfog: true,
    bloomK: 0.82,
    post: true,
    pixelated: false,
    glow: true,
    exposure: 1.02,
    glowK: 0.18,
    aexp: 0,
    grade: 0.45,
    /* Детализация никогда не деградирует с пресетом: процедурные микродетали
   (трещины, грязь, потёки, копоть, паутина) всегда генерируются полностью —
   меняются только разрешение атласа и рендера */
    det: 1,
    micro: 1,
    sdet: 5,
    cav: true,
    ssr: 1
  };
  /* Умолчания «всё выключено»; каждый пресет переопределяет то, что ему нужно */
  const OFF = {
    tbn: false,
    pbr: false,
    detN: 0,
    spec: false,
    hdr: false,
    msaa: 0,
    ssao: 0,
    ssaoR: 0,
    ssaoK: 0,
    vol: 0,
    volK: 0,
    sharp: 0,
    flare: 0,
    flareK: 0,
    reflScale: 0,
    pomRef: 0
  };
  /* Лестница пресетов: каждая ступень вниз заметно дешевле для GPU, но лишь чуть
   проще на глаз. Тени остаются чистыми на ВСЕХ ступенях (16-точечный PCF-диск в
   угловой карте), набор деталей тот же; разрешение рендера и атласа, число
   выборок постобработки и размер карты теней деградируют плавно */
  const P = {
    low: {
      name: 'низкая',
      res: [640, 400],
      atlas: 256,
      aniso: 2,
      dither: 0.8,
      nrmK: 0.18,
      detN: 0.36,
      pom: 6,
      pomK: 0.012,
      pomRef: 0,
      far: 70,
      propDist: 16,
      shSteps: 96,
      shTaps: 5,
      shRows: 48,
      shLamps: 8,
      ssao: 6,
      ssaoR: 0.35,
      ssaoK: 0.7,
      vol: 6,
      volK: 0.9,
      reflScale: 0.35,
      reflTaps: 3,
      bloomLv: 3,
      grain: 0.02,
      ca: 0.0018
    },
    medium: {
      name: 'средняя',
      res: [960, 600],
      atlas: 384,
      aniso: 4,
      dither: 1.0,
      msaa: 4,
      hdr: true,
      tbn: true,
      spec: true,
      pbr: true,
      nrmK: 0.24,
      detN: 0.46,
      pom: 8,
      pomK: 0.016,
      pomRef: 2,
      far: 75,
      propDist: 24,
      shSteps: 160,
      shTaps: 5,
      shRows: 64,
      shLamps: 12,
      ssao: 8,
      ssaoR: 0.4,
      ssaoK: 0.8,
      vol: 8,
      volK: 1.0,
      reflScale: 0.4,
      reflTaps: 4,
      bloomLv: 3,
      sharp: 0.24,
      grain: 0.018,
      ca: 0.002
    },
    high: {
      name: 'высокая',
      res: [1280, 800],
      atlas: 512,
      aniso: 8,
      dither: 1.0,
      msaa: 4,
      hdr: true,
      tbn: true,
      spec: true,
      pbr: true,
      nrmK: 0.3,
      detN: 0.52,
      pom: 12,
      pomK: 0.022,
      pomRef: 3,
      far: 85,
      propDist: 32,
      shSteps: 256,
      shTaps: 5,
      shRows: 96,
      shLamps: 16,
      ssao: 12,
      ssaoR: 0.45,
      ssaoK: 0.85,
      vol: 12,
      volK: 1.05,
      reflScale: 0.5,
      reflTaps: 6,
      bloomLv: 4,
      sharp: 0.32,
      flare: 1,
      flareK: 0.45,
      grain: 0.016,
      ca: 0.0024
    },
    ultra: {
      name: 'эпическая',
      res: [1600, 1000],
      atlas: 1024,
      aniso: 16,
      dither: 1.0,
      msaa: 4,
      hdr: true,
      tbn: true,
      spec: true,
      pbr: true,
      nrmK: 0.38,
      detN: 0.62,
      pom: 20,
      pomK: 0.028,
      pomRef: 4,
      far: 90,
      propDist: 44,
      shSteps: 384,
      shTaps: 5,
      shRows: 112,
      shLamps: 20,
      ssao: 16,
      ssaoR: 0.5,
      ssaoK: 0.95,
      vol: 16,
      volK: 1.1,
      reflScale: 0.65,
      reflTaps: 8,
      bloomLv: 5,
      sharp: 0.4,
      flare: 1,
      flareK: 0.55,
      grain: 0.014,
      ca: 0.0028
    },
    /* экспериментальная ступень: абсолютный максимум вплоть до рендера 8K — для
   скриншотов и замеров, а не для игры (+1% к картинке, -1000% к fps) */
    max: {
      name: 'максимальная',
      res: [7680, 4320],
      atlas: 2048,
      aniso: 16,
      dither: 1.0,
      msaa: 4,
      hdr: true,
      tbn: true,
      spec: true,
      pbr: true,
      nrmK: 0.42,
      detN: 0.7,
      pom: 32,
      pomK: 0.032,
      pomRef: 8,
      far: 120,
      propDist: 64,
      shSteps: 512,
      shTaps: 16,
      shRows: 128,
      shLamps: 32,
      ssao: 24,
      ssaoR: 0.5,
      ssaoK: 1.0,
      vol: 32,
      volK: 1.2,
      reflScale: 1.0,
      reflTaps: 16,
      bloomLv: 6,
      sharp: 0.5,
      flare: 1,
      flareK: 0.6,
      grain: 0.012,
      ca: 0.003
    }
  };
  for (const k in P) P[k] = Object.assign({ level: k }, BASE, OFF, P[k]);
  P.BASE = BASE;
  P.OFF = OFF; /* умолчания конструктора «своего» профиля графики */
  return P;
})();
var FOGC = [0.0078, 0.008, 0.0086];
var DARK_SAT = 0.14;
var DARK_SAT_LO = 0.2;
var Q = QUALITY.ultra;
/* Отпечаток графики: конвейеры и текстуры перестраиваются только когда меняется
   ЛЮБОЙ параметр (включая отдельные ручки «своего» профиля, а не только имя
   пресета). Перечислены только ручки пресетов; константы (освещение, цветокор,
   число ламп, набор деталей) везде одинаковы и исключены */
const QSIG = [
  'res',
  'atlas',
  'aniso',
  'dither',
  'msaa',
  'hdr',
  'tbn',
  'spec',
  'pbr',
  'nrmK',
  'detN',
  'pom',
  'pomK',
  'pomRef',
  'far',
  'propDist',
  'shSteps',
  'shTaps',
  'shRows',
  'shLamps',
  'ssao',
  'ssaoR',
  'ssaoK',
  'vol',
  'volK',
  'reflScale',
  'reflTaps',
  'bloomLv',
  'sharp',
  'flare',
  'flareK',
  'grain',
  'ca'
];
function qSig() {
  return QSIG.map(k => Q[k]).join(',');
}
function gpuSigOf(seed, W, H) {
  return seed + '_' + W + 'x' + H + '_' + qSig();
}

var RUN_NOISE = 7.5;

/* =============== ФОНАРЬ / ИНВЕНТАРЬ / ШКАФЫ ================
   Фонарь — единственный источник света у игрока: прожектор из правой руки строго
   по направлению взгляда. Тёмные клетки вне его конуса — территория Монитора
   (телепорт в stepMonster). */
var FL_CAP = 150; /* секунд непрерывного света от одной батарейки */
var FL_RANGE = 7.0; /* дальность луча, клетки (~20 м — честный ручной фонарь) */
var FL_COS_IN = 0.965; /* косинус ядра конуса (~15°) — яркое пятно */
var FL_COS_OUT = 0.8; /* косинус края конуса (~37°) — боковое рассеяние */
var FL_SPILL_R = 1.8; /* свет «протекает назад»: клетки в этом радиусе от игрока с включённым фонарём
   никогда не считаются тёмными (страховка от телепорта вплотную) */
var FL_INTENSITY = 1.9; /* яркость луча (потолочная лампа даёт I*0.85 ~= 0.85 для сравнения) */
var FL_BOUNCE_K = 0.34; /* доля луча, уходящая в рассеяние от пятна (непрямой свет) */
var FL_BOUNCE_R = 2.6; /* радиус вторичного источника от пятна, клетки (~7.6 м) */
var FL_GI_K = 0.45; /* доля пятна в поле облучённости: непрямой свет фонаря загибается за углы */
var FL_MODEL_K = 1.35; /* модель фонаря слегка укрупнена: голова и корпус лучше читаются в руке */
var FL_HEAD_X =
  0.0958 *
  FL_MODEL_K; /* голова луча вдоль локальной X масштабированной модели (линза лежит в этой плоскости) */
var FL_DIM_AT = 0.2; /* порог плавного спада яркости (20% заряда) */
var RL_DUR = 1.9; /* длительность анимации замены батарейки, с */
var SW_DUR = 0.7; /* смена предмета (1-4): рука вниз со старым, вверх с новым, с */
var PK_APPEAR = 0.34; /* подбор: предмет появляется в руке в верхней точке подъёма, с */
var PK_DUR = 0.75; /* подбор: длительность клипа подъёма правой рукой, с */
var TG_DUR = 0.38; /* длительность анимации нажатия кнопки, с */
var BATT_STACK = 4; /* батареек на слот инвентаря */
var INV_SLOTS = 4;
var DARK_HALLU_T = 10; /* секунд в темноте до первой галлюцинации */
var HALLU_DARK_T =
  AMBIENT + 0.02; /* «настоящая» темнота для галлюцинаций: строже, чем DARK_T телепорта — слегка
   затенённый край света лампы ещё не темнота */
var HALLU_GI_T = 0.05; /* порог рассеянного света: клетка за углом от лампы ещё читается визуально —
   галлюцинации там не начинаются */
/* шкаф (клетки): ширина 0.34 (~1.0 м), глубина 0.18 (~0.53 м), высота 0.30 (~0.88 м) */
var CAB_W = 0.34,
  CAB_D = 0.18,
  CAB_SLIDE = 0.13,
  CAB_H = 0.3;
/* досягаемость взаимодействия (E), метры → клетки: мебель, стол и предметы
   берут радиус до центра объекта; двери — расстояние до плоскости створки */
var REACH_OBJ = 1.5 / CELL_M,
  REACH_DOOR = 2 / CELL_M;
/* стол в безопасной комнате (клетки): 1.24 x 0.70 м, высота 0.75 м */
var TBL_W = 0.42,
  TBL_D = 0.24,
  TBL_H = 0.255;

var MON_FOV = 1.15,
  MON_PERIPH = 0.9;
function wrapPi(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

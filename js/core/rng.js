/* ==== ГСЧ: XOSHIRO512** (Blackman/Vigna, public domain) ====
   Состояние — 512 бит: входит ВЕСЬ вывод SHA3-512, ничего не отбрасывается.
   Параллельные потоки — jump() (2^256 непересекающихся подпоследовательностей):
   каждая подсистема получает свой поток, поэтому расход одного не сдвигает другие. */
const XS_M64 = (1n << 64n) - 1n;
const XS_JUMP = [
  0x33ed89b6e7a353f9n,
  0x760083d7955323ben,
  0x2837f2fbb5f22faen,
  0x4b8c5674d309511cn,
  0xb11ac47a7ba28c25n,
  0xf1be7667092bcc1cn,
  0x53851efdb6df0aafn,
  0x1ebbc8b23eaf25dbn
];
function xsRotl(x, k) {
  return ((x << k) | (x >> (64n - k))) & XS_M64;
}
function xs512(s) {
  const g = { s: s };
  g.nextU64 = function () {
    const S = g.s;
    const res = (xsRotl((S[1] * 5n) & XS_M64, 7n) * 9n) & XS_M64;
    const t = (S[1] << 11n) & XS_M64;
    S[2] ^= S[0];
    S[5] ^= S[1];
    S[1] ^= S[2];
    S[7] ^= S[3];
    S[3] ^= S[4];
    S[4] ^= S[5];
    S[0] ^= S[6];
    S[6] ^= S[7];
    S[6] ^= t;
    S[7] = xsRotl(S[7], 21n);
    return res;
  };
  g.rnd = function () {
    return Number(g.nextU64() >> 11n) * (1 / 9007199254740992);
  }; /* [0,1), 53 бита */
  g.u32 = function () {
    return Number(g.nextU64() & 0xffffffffn);
  };
  return g;
}
function xsJump(s) {
  const g = xs512(s),
    t = new BigUint64Array(8);
  for (let i = 0; i < 8; i++)
    for (let b = 0; b < 64; b++) {
      if ((XS_JUMP[i] >> BigInt(b)) & 1n) for (let w = 0; w < 8; w++) t[w] ^= s[w];
      g.nextU64();
    }
  s.set(t);
}
function xsStream(base, k) {
  const s = BigUint64Array.from(base);
  for (let i = 0; i < k; i++) xsJump(s);
  return xs512(s);
}
function xsSeed(bytes) {
  /* 64 байта (SHA3-512) → состояние, little-endian */
  const s = new BigUint64Array(8);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 8; i++) s[i] = dv.getBigUint64(i * 8, true);
  if (!(s[0] | s[1] | s[2] | s[3] | s[4] | s[5] | s[6] | s[7]))
    s[0] = 1n; /* полностью нулевое состояние запрещено */
  return s;
}
/* развёртка splitmix64 — для фиксированных и меню-сидов, заданных одним словом */
function xsFromU64(x) {
  const s = new BigUint64Array(8);
  let z = BigInt.asUintN(64, x);
  for (let i = 0; i < 8; i++) {
    z = (z + 0x9e3779b97f4a7c15n) & XS_M64;
    let y = z;
    y = ((y ^ (y >> 30n)) * 0xbf58476d1ce4e5b9n) & XS_M64;
    y = ((y ^ (y >> 27n)) * 0x94d049bb133111ebn) & XS_M64;
    s[i] = y ^ (y >> 31n);
  }
  return xs512(s);
}
function xsFromU32(u) {
  return xsFromU64(BigInt(u >>> 0));
}
/* не зависящий от порядка подпоток из ВСЕГО состояния: база XOR счётчик
   splitmix64, ключеванный тегом. Элементы, которые должны совпадать в нескольких
   проходах (кирпич, разрезанный краем атласа; доски двери в albedo И в рельефе),
   получают один тег → одни и те же параметры, независимо от порядка расхода. */
function xsSub(st, tag) {
  const s = new BigUint64Array(8);
  let z = (BigInt(tag >>> 0) | 0x9e3779b97f4a7c15n) & XS_M64;
  for (let j = 0; j < 8; j++) {
    z = (z + 0x9e3779b97f4a7c15n) & XS_M64;
    let y = z;
    y = ((y ^ (y >> 30n)) * 0xbf58476d1ce4e5b9n) & XS_M64;
    y = ((y ^ (y >> 27n)) * 0x94d049bb133111ebn) & XS_M64;
    s[j] = st[j] ^ (y ^ (y >> 31n));
  }
  if (!(s[0] | s[1] | s[2] | s[3] | s[4] | s[5] | s[6] | s[7])) s[0] = 1n;
  return xs512(s);
}
/* массовый белый шум: один u32-тег из основного генератора → дешёвый
   целочисленный хэш на элемент (для буферов на 10⁵-10⁶ отсчётов: импульс
   реверберации, шум, зерно) */
function xsBulk(tag) {
  let i = 0;
  const t = tag | 0;
  return function () {
    i = (i + 1) | 0;
    let h = Math.imul(i ^ t, 0x9e3779b1) | 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) | 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) | 0;
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
/* номера потоков (числа прыжков) — по одному параллельному потоку на подсистему */
const XS_MAZE = 0,
  XS_LAMP = 1,
  XS_MON = 2,
  XS_VIS = 3,
  XS_AUD = 4,
  XS_TEX = 5,
  XS_SKIN = 6,
  XS_PUD = 7,
  XS_SCR = 8,
  XS_TAG = 9;

/* SHA3-512 (FIPS 202, Keccak-p[1600]): сид = любой текст, хеш → 64-байтный ключ */
function sha3_512(msg) {
  const RC = [
    0x0000000000000001n,
    0x0000000000008082n,
    0x800000000000808an,
    0x8000000080008000n,
    0x000000000000808bn,
    0x0000000080000001n,
    0x8000000080008081n,
    0x8000000000008009n,
    0x000000000000008an,
    0x0000000000000088n,
    0x0000000080008009n,
    0x000000008000000an,
    0x000000008000808bn,
    0x800000000000008bn,
    0x8000000000008089n,
    0x8000000000008003n,
    0x8000000000008002n,
    0x8000000000000080n,
    0x000000000000800an,
    0x800000008000000an,
    0x8000000080008081n,
    0x8000000000008080n,
    0x0000000080000001n,
    0x8000000080008008n
  ];
  const ROT = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14]
  ];
  const M = (1n << 64n) - 1n;
  const rl = (x, n) => (n === 0n ? x & M : ((x << n) | (x >> (64n - n))) & M);
  const a = new Array(25).fill(0n);
  function kf() {
    for (let r = 0; r < 24; r++) {
      const C = [];
      for (let x = 0; x < 5; x++) C[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
      for (let x = 0; x < 5; x++) {
        const D = C[(x + 4) % 5] ^ rl(C[(x + 1) % 5], 1n);
        for (let y = 0; y < 25; y += 5) a[y + x] ^= D;
      }
      const b = new Array(25);
      for (let x = 0; x < 5; x++)
        for (let y = 0; y < 5; y++)
          b[y + 5 * ((2 * x + 3 * y) % 5)] = rl(a[x + 5 * y], BigInt(ROT[x][y]));
      for (let y = 0; y < 25; y += 5)
        for (let x = 0; x < 5; x++)
          a[y + x] = b[y + x] ^ (~b[y + ((x + 1) % 5)] & M & b[y + ((x + 2) % 5)]);
      a[0] ^= RC[r];
    }
  }
  const RATE = 72; /* (1600-2*512)/8 */
  const nBl = Math.floor(msg.length / RATE) + 1;
  const buf = new Uint8Array(nBl * RATE);
  buf.set(msg);
  buf[msg.length] = 0x06; /* доменное дополнение SHA3 (не чистый Keccak) */
  buf[buf.length - 1] |= 0x80;
  const dv = new DataView(buf.buffer);
  for (let o = 0; o < buf.length; o += RATE) {
    for (let i = 0; i < RATE / 8; i++)
      a[i] ^= BigInt.asUintN(
        64,
        BigInt(dv.getUint32(o + i * 8, true)) | (BigInt(dv.getUint32(o + i * 8 + 4, true)) << 32n)
      );
    kf();
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 8; i++) {
    let lane = a[i];
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}
/* сид = любой текст → SHA3-512 → 64 байта → Xoshiro512** (все 512 бит, без усечения) */
function seedBytesFromText(str) {
  return sha3_512(new TextEncoder().encode(String(str)));
}
function seedHex(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
function randBytes(n) {
  const b = new Uint8Array(n);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < n; i++) b[i] = (Math.random() * 256) | 0;
  return b;
}
/* пустое поле сида: случайный сид в печатном виде — ВСЕ 512 бит (128
   шестнадцатеричных символов). Он проходит через тот же SHA3-512, что и любой
   введённый текст, и его можно скопировать обратно (экран паузы), чтобы повторить
   раунд в точности */
function randSeedText() {
  return seedHex(randBytes(64));
}

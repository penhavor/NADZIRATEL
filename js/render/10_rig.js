/* ==== РИГ ИГРОКА ==== */
function makeRig() {
  const B = [],
    idx = {},
    names = [];
  const add = (name, parent, off, V) => {
    idx[name] = B.length;
    names.push(name);
    B.push({
      parent: typeof parent === 'string' ? idx[parent] : parent,
      off,
      v: new Float32Array(V),
      n: V.length / 9,
      m: new Float32Array(16)
    });
    return idx[name];
  };
  return {
    B: B,
    idx: idx,
    names: names,
    add: add,
    finish(hideNames) {
      let total = 0;
      for (const b of B) total += b.n;
      const hide = {};
      for (const n of hideNames || []) if (idx[n] !== undefined) hide[idx[n]] = 1;
      return { B: B, idx: idx, names: names, total: total, hide: hide };
    }
  };
}
const puv = (reg, v0, v1) => [
  reg.u0,
  reg.u1,
  v0 === undefined ? 0.06 : v0,
  v1 === undefined ? 0.94 : v1
];

function buildPlayerRig(PREGin) {
  if (PREGin) PREG = PREGin;
  const R = makeRig();
  const add = R.add;
  const AO = (V, a) => partAO(V, a);
  const SK = puv(PREG.skin, 0.06, 0.3); /* шея */
  const JK = puv(PREG.jacket),
    PT = puv(PREG.pants),
    BT = puv(PREG.boot),
    HR = puv(PREG.hair);
  /* UV рукава на плече с перевёрнутой v: сечения перечислены снизу вверх
   (конвенция крышек loftPart), раскладка текстуры обычная. */
  const JK_SH = (() => {
    const j = puv(PREG.jacket);
    return [j[0], j[1], j[3], j[2]];
  })();
  const JK_PLAIN = [0.7324, 0.7732, 0.25, 0.6];
  const JK_ZIP = [0.806, 0.822, 0.3, 0.8];
  const JK_HOOD = [0.776, 0.804, 0.2, 0.7];
  const BT_PLAIN = [0.93, 0.95, 0.55, 0.8];
  const BT_BELT = [0.93, 0.95, 0.15, 0.5];
  const BT_BUCKLE = [0.9386, 0.9457, 0.5, 0.61];
  const BT_BADGE = [0.9512, 0.9558, 0.76, 0.84];
  const SK_HAND = [0.5, 0.6, 0.3, 0.48];
  const tub = (y0, y1, r0, r1, uv, e) =>
    AO(
      loftPart([pr(y0, 0, 0, r0, r0, e || 2.4), pr(y1, 0, 0, r1, r1, e || 2.4)], 10, uv, true),
      0.55
    );
  add('root', -1, [0, 0, 0], []);

  /* таз: штаны + ремень + пряжка (всё заподлицо) */
  add(
    'pel',
    'root',
    [0, PL_HIP, 0],
    AO(
      partCat(
        loftPart(
          [
            pr(-0.08, 0, 0.01, 0.146, 0.11, 2.6),
            pr(-0.02, 0, 0.004, 0.154, 0.116, 2.6),
            pr(0.03, 0, 0, 0.15, 0.112, 2.5),
            pr(0.075, 0, -0.006, 0.136, 0.1, 2.5)
          ],
          14,
          PT,
          true
        ),
        /* ремень — замкнутое кольцо: открытый нижний торец читался бы как дыра в
   отражениях луж */
        loftPart(
          [pr(0.024, 0, 0.002, 0.158, 0.119, 2.5), pr(0.062, 0, -0.004, 0.15, 0.112, 2.5)],
          12,
          BT_BELT,
          true
        ),
        partXf(
          loftPart(
            [pr(-0.012, 0, 0, 0.03, 0.013, 2.2), pr(0.012, 0, 0, 0.03, 0.013, 2.2)],
            8,
            BT_BUCKLE,
            true
          ),
          0,
          0.043,
          -0.116
        )
      ),
      0.35
    )
  );

  /* поясница и живот: куртка */
  add(
    'spn',
    'pel',
    [0, 0.075, 0],
    AO(
      partCat(
        loftPart(
          [
            pr(-0.025, 0, 0.004, 0.142, 0.106, 2.5),
            pr(0.07, 0, -0.002, 0.147, 0.111, 2.5),
            pr(0.155, 0, -0.006, 0.151, 0.115, 2.5)
          ],
          14,
          JK,
          true
        ),
        partXf(
          loftPart(
            [pr(-0.025, 0, -0.1, 0.016, 0.008, 2.2), pr(0.155, 0, -0.09, 0.015, 0.008, 2.2)],
            6,
            JK_ZIP,
            true
          ),
          0,
          0,
          0
        )
      ),
      0.3
    )
  );

  /* грудь: куртка + воротник + молния + карманы + капюшон на спине */
  add(
    'ch',
    'spn',
    [0, 0.15, 0],
    AO(
      partCat(
        loftPart(
          [
            pr(-0.02, 0, -0.004, 0.151, 0.115, 2.5),
            pr(0.05, 0, -0.008, 0.163, 0.123, 2.6),
            pr(0.13, 0, -0.01, 0.169, 0.127, 2.6),
            pr(0.21, 0, -0.006, 0.156, 0.116, 2.5),
            pr(0.262, 0, -0.002, 0.132, 0.097, 2.5),
            pr(0.292, 0, -0.004, 0.096, 0.072, 2.6)
          ],
          16,
          JK,
          true
        ),
        partXf(
          loftPart(
            [pr(0.0, 0, -0.112, 0.017, 0.009, 2.2), pr(0.245, 0, -0.094, 0.015, 0.008, 2.2)],
            6,
            JK_ZIP,
            true
          ),
          0,
          0,
          0
        ),
        /* нагрудные карманы — клапаны заподлицо */
        partXf(
          loftPart(
            [pr(-0.024, 0, 0, 0.04, 0.01, 2.2), pr(0.024, 0, 0, 0.04, 0.01, 2.2)],
            8,
            JK,
            true
          ),
          0.076,
          0.128,
          -0.116
        ),
        partXf(
          loftPart(
            [pr(-0.024, 0, 0, 0.04, 0.01, 2.2), pr(0.024, 0, 0, 0.04, 0.01, 2.2)],
            8,
            JK,
            true
          ),
          -0.076,
          0.128,
          -0.116
        ),
        partXf(
          loftPart(
            [pr(-0.018, 0, 0, 0.024, 0.006, 2.2), pr(0.018, 0, 0, 0.024, 0.006, 2.2)],
            8,
            BT_BADGE,
            true
          ),
          -0.056,
          0.196,
          -0.116
        ),
        /* капюшон: валик на спине и плечах */
        partXf(
          loftPart(
            [
              pr(-0.055, 0, 0, 0.075, 0.045, 2.7),
              pr(-0.005, 0, 0, 0.095, 0.055, 2.8),
              pr(0.05, 0, 0, 0.08, 0.046, 2.7)
            ],
            12,
            JK_HOOD,
            true
          ),
          0,
          0.235,
          0.078
        ),
        tub(-0.045, 0.045, 0.064, 0.053, JK_PLAIN, 2.5),
        partXf(tub(-0.045, 0.045, 0.064, 0.053, JK_PLAIN, 2.5), 0.134, 0.238, 0),
        partXf(tub(-0.045, 0.045, 0.064, 0.053, JK_PLAIN, 2.5), -0.134, 0.238, 0)
      ),
      0.25
    )
  );

  /* шея + воротник */
  add(
    'nk',
    'ch',
    [0, 0.275, 0],
    AO(
      partCat(
        loftPart(
          [
            pr(-0.03, 0, 0, 0.055, 0.05, 2.4),
            pr(0.05, 0, -0.004, 0.05, 0.046, 2.4),
            pr(0.115, 0, -0.006, 0.047, 0.044, 2.4)
          ],
          12,
          SK,
          true
        ),
        loftPart(
          [
            pr(-0.03, 0, 0.002, 0.078, 0.07, 2.4),
            pr(0.012, 0, 0, 0.08, 0.072, 2.5),
            pr(0.036, 0, -0.002, 0.072, 0.065, 2.6)
          ],
          14,
          JK_PLAIN,
          false
        )
      ),
      0.35
    )
  );

  /* голова: череп + глазные яблоки + уши; челюсть — ротовая полость; волосы */
  add('hd', 'nk', [0, 0.115, 0], AO(buildHeadParts(), 0.55));
  add(
    'jaw',
    'hd',
    [0, -0.01, -0.004],
    AO(
      partCat(
        loftPart(
          [pr(-0.02, 0, 0.01, 0.03, 0.034, 2.4), pr(0.01, 0, 0.006, 0.034, 0.038, 2.4)],
          8,
          [0.52, 0.56, 0.52, 0.6],
          true
        )
      ),
      0.9
    )
  );
  add('hr', 'hd', [0, 0, 0], AO(buildHair(HR), 0.6));
  add('earL', 'hd', [0, 0, 0], []);
  add('earR', 'hd', [0, 0, 0], []);

  /* руки */
  const FING = {
    i: [0.03, 0.046, 0.03, 0.024],
    m: [0.01, 0.05, 0.033, 0.026],
    r: [-0.01, 0.044, 0.029, 0.023],
    p: [-0.03, 0.034, 0.023, 0.02]
  };
  const arm = (sg, n) => {
    /* ПЛЕЧИ: рукав — закрытый купол (округлая головка), подол сужается внутрь
   бицепса — ни зазора, ни тёмного «колодца»; 16 сечений. */
    add(
      'sh' + n,
      'ch',
      [0.15 * sg, 0.243, 0],
      AO(
        partCat(
          loftPart(
            [
              pr(-0.134, 0, 0, 0.046, 0.042, 2.3),
              pr(-0.108, 0, 0, 0.053, 0.049, 2.4),
              pr(-0.078, 0, 0, 0.06, 0.056, 2.4),
              pr(-0.04, 0, 0, 0.067, 0.063, 2.5),
              pr(0.0, 0, 0, 0.069, 0.065, 2.5),
              pr(0.03, 0, 0, 0.061, 0.057, 2.5),
              pr(0.05, 0, 0, 0.047, 0.044, 2.6),
              pr(0.062, 0, 0, 0.03, 0.028, 2.6)
            ],
            16,
            JK_SH,
            true
          )
        ),
        0.3
      )
    );
    add(
      'ua' + n,
      'sh' + n,
      [0, -0.02, 0],
      AO(
        partCat(
          loftPart(
            [
              pr(0.0, 0, 0, 0.062, 0.058, 2.4),
              pr(-0.09, 0, -0.003, 0.058, 0.055, 2.4),
              pr(-0.18, 0, -0.002, 0.051, 0.048, 2.3),
              pr(-0.28, 0, 0, 0.045, 0.042, 2.3)
            ],
            12,
            JK,
            true
          ),
          partXf(
            loftPart(
              [pr(-0.026, 0, 0, 0.049, 0.028, 2.3), pr(0.026, 0, 0, 0.047, 0.027, 2.3)],
              8,
              JK,
              true
            ),
            0,
            -0.185,
            0.026
          )
        ),
        0.35
      )
    );
    add(
      'fa' + n,
      'ua' + n,
      [0, -0.28, 0],
      AO(
        partCat(
          loftPart(
            [
              pr(0.0, 0, 0, 0.045, 0.042, 2.3),
              pr(-0.07, 0, -0.003, 0.044, 0.041, 2.3),
              pr(-0.16, 0, -0.004, 0.037, 0.034, 2.3),
              pr(-0.235, 0, -0.002, 0.031, 0.029, 2.3)
            ],
            12,
            JK,
            true
          ),
          /* манжеты — замкнутые трубы: открытый нижний торец дал бы чёрную щель в отражениях */
          loftPart(
            [pr(-0.212, 0, 0, 0.039, 0.036, 2.3), pr(-0.248, 0, 0, 0.037, 0.034, 2.3)],
            10,
            JK_PLAIN,
            true
          ),
          loftPart(
            [pr(-0.248, 0, 0, 0.036, 0.032, 2.3), pr(-0.286, 0, 0, 0.033, 0.029, 2.3)],
            10,
            JK_PLAIN,
            true
          )
        ),
        0.4
      )
    );
    add('ha' + n, 'fa' + n, [0, -0.268, 0], AO(partCat(buildHandParts(sg, SK_HAND)), 0.55));
    /* пальцы: кости */
    for (const f of ['i', 'm', 'r', 'p']) {
      const F = FING[f];
      add(f + '1' + n, 'ha' + n, [-F[0] * sg, -0.098, -0.003], []);
      /* геометрия фаланг висит на собственных костях */
    }
    for (const f of ['i', 'm', 'r', 'p']) {
      const F = FING[f];
      add(f + '2' + n, f + '1' + n, [0, -F[1], 0], []);
      add(f + '3' + n, f + '2' + n, [0, -F[2], 0], []);
    }
    add('t1' + n, 'ha' + n, [-0.03 * sg, -0.024, -0.006], []);
    add('t2' + n, 't1' + n, [0, -0.04, 0], []);
  };
  /* геометрия пальца разнесена по костям: собираем заново вручную */
  const fingerGeo = (sg, n) => {
    const put = (bone, V) => {
      const b = R.B[R.idx[bone]];
      const a = b.v;
      const nv = V;
      const merged = new Float32Array(a.length + nv.length);
      merged.set(a);
      merged.set(nv, a.length);
      b.v = merged;
      b.n = merged.length / 9;
    };
    for (const f of ['i', 'm', 'r', 'p']) {
      const F = FING[f];
      const segs =
        f === 'i'
          ? [
              [F[1], 0.0085, 0.0075],
              [F[2], 0.0075, 0.0065],
              [F[3], 0.0065, 0.0058]
            ]
          : f === 'm'
            ? [
                [0.05, 0.0088, 0.0078],
                [0.033, 0.0078, 0.0068],
                [0.026, 0.0068, 0.006]
              ]
            : f === 'r'
              ? [
                  [0.044, 0.0082, 0.0072],
                  [0.029, 0.0072, 0.0062],
                  [0.023, 0.0062, 0.0055]
                ]
              : [
                  [0.034, 0.0072, 0.0062],
                  [0.023, 0.0062, 0.0054],
                  [0.02, 0.0055, 0.0048]
                ];
      for (let k = 0; k < 3; k++) {
        const L = segs[k];
        const Vv = fingerPart(L[0], L[1], L[2], FING_UV);
        if (k === 0) {
          const kn = [];
          const ns2 = 7,
            nt2 = 5,
            Rr = L[1] * 1.1;
          for (let j = 0; j < nt2; j++) {
            const th = (j / (nt2 - 1)) * Math.PI;
            for (let i2 = 0; i2 < ns2; i2++) {
              const ph = (i2 / ns2) * 2 * Math.PI;
              const d = [
                Math.sin(th) * Math.sin(ph),
                -Math.cos(th),
                Math.sin(th) * Math.cos(ph) * 0.8
              ];
              kn.push(
                d[0] * Rr,
                -0.001 + d[1] * Rr * 0.85,
                d[2] * Rr,
                0.655,
                0.2,
                d[0],
                d[1],
                d[2],
                1
              );
            }
          }
          Vv.push.apply(Vv, gridToTris(kn, ns2, nt2, false));
        }
        put(f + (k + 1) + n, partAO(Vv, 0.55));
      }
    }
    /* большой палец */
    put('t1' + n, partAO(fingerPart(0.04, 0.0105, 0.0092, FING_UV), 0.55));
    put('t2' + n, partAO(fingerPart(0.032, 0.009, 0.0078, FING_UV), 0.55));
  };
  arm(1, 'L');
  arm(-1, 'R');
  fingerGeo(1, 'L');
  fingerGeo(-1, 'R');

  /* ноги */
  const leg = (sg, n) => {
    add(
      'th' + n,
      'pel',
      [0.086 * sg, -0.055, 0],
      AO(
        partCat(
          loftPart(
            [
              pr(0.0, 0, 0, 0.096, 0.09, 2.5),
              pr(-0.111, 0, -0.003, 0.088, 0.082, 2.5),
              pr(-0.222, 0, -0.005, 0.078, 0.072, 2.4),
              pr(-0.333, 0, -0.003, 0.068, 0.063, 2.4),
              pr(-0.46, 0, 0, 0.061, 0.057, 2.3)
            ],
            14,
            PT,
            true
          ) /* x1.1084 = PL_THLEN */
        ),
        0.4
      )
    );
    add(
      'sn' + n,
      'th' + n,
      [0, -PL_THLEN, 0],
      AO(
        partCat(
          loftPart(
            [
              pr(0.0, 0, 0, 0.06, 0.056, 2.3),
              pr(-0.077, 0, 0.008, 0.058, 0.06, 2.4),
              pr(-0.176, 0, 0.004, 0.048, 0.05, 2.4),
              pr(-0.286, 0, 0, 0.042, 0.043, 2.3),
              pr(-0.385, 0, -0.002, 0.038, 0.039, 2.3)
            ],
            14,
            PT,
            true
          )
        ),
        0.45
      )
    ); /* x1.1000 = PL_SNLEN */
    add(
      'ft' + n,
      'sn' + n,
      [0, -PL_SNLEN, 0],
      AO(
        partCat(
          loftPart(
            [
              pr(0.03, 0, 0.004, 0.054, 0.052, 2.4),
              pr(-0.02, 0, 0.002, 0.052, 0.05, 2.4),
              pr(-0.062, 0, -0.004, 0.05, 0.05, 2.4)
            ],
            12,
            BT,
            true
          ),
          loftPart(
            [
              pr(-0.066, 0, 0.016, 0.05, 0.056, 2.5),
              pr(-0.086, 0, -0.012, 0.052, 0.076, 2.6),
              pr(-0.094, 0, -0.052, 0.046, 0.062, 2.6),
              pr(-0.09, 0, -0.092, 0.037, 0.041, 2.4)
            ],
            12,
            BT,
            true
          ),
          /* рант подошвы — закрытый «стакан»: стенка выходит из внутренности ботинка и
   перетекает в лист подошвы. Без него сбоку остаётся сквозная щель — скользящий
   луч зеркального прохода уходит под стопу и даёт чёрную полосу в отражениях луж. */
          loftPart(
            [
              pr(-0.078, 0, 0.0, 0.049, 0.062, 2.4),
              pr(-0.116, 0, -0.012, 0.054, 0.078, 2.4),
              pr(-0.116, 0, 0.03, 0.05, 0.048, 2.4),
              pr(-0.112, 0, -0.07, 0.05, 0.068, 2.3)
            ],
            12,
            BT,
            true
          ),
          partXf(
            loftPart(
              [pr(-0.012, 0, 0, 0.024, 0.009, 2.2), pr(-0.07, 0, 0, 0.022, 0.008, 2.2)],
              6,
              BT_PLAIN,
              true
            ),
            0,
            -0.036,
            -0.046
          )
        ),
        0.55
      )
    );
  };
  leg(1, 'L');
  leg(-1, 'R');
  return R.finish(HIDE_FP_NAMES);
}
/* кисть без пальцев (пальцы висят на собственных костях отдельно) */
function buildHandParts(sg, SK_HAND) {
  /* запястье сужено (из манжеты выходит запястьем, а не дощечкой), тыльная сторона
   кисти выпуклая (центры сечений смещены к ладони) — кисть читается как кисть */
  const palm = loftPart(
    [
      pr(0.022, 0, 0.002, 0.026, 0.016, 2.4),
      pr(-0.018, 0, 0.0, 0.035, 0.021, 2.5),
      pr(-0.055, 0, -0.003, 0.041, 0.024, 2.6),
      pr(-0.088, 0, -0.005, 0.042, 0.024, 2.7),
      pr(-0.102, 0, -0.006, 0.039, 0.02, 2.6)
    ],
    10,
    SK_HAND,
    true
  );
  /* большой палец и тенар (бугор у его основания, прижатый к ладони) — на -X
   локальной оси кисти */
  const thenar = partXf(
    loftPart(
      [
        pr(0, 0, 0, 0.01, 0.008, 2.3),
        pr(-0.024, 0, -0.002, 0.012, 0.009, 2.3),
        pr(-0.04, 0, -0.003, 0.008, 0.006, 2.2)
      ],
      8,
      SK_HAND,
      true
    ),
    -sg * 0.026,
    -0.028,
    -0.004,
    0,
    0,
    -sg * 0.45
  );
  return partCat(palm, thenar);
}
const HIDE_FP_NAMES = ['pel', 'spn', 'ch', 'nk', 'hd', 'jaw', 'hr', 'earL', 'earR', 'shL', 'shR'];

/* ==== опорная кинематика ==== */
/* контрольные точки низа стопы в системе кости ft: подошва, рант, углы носка и
   пятки — честный контакт с полом в любой позе */
/* Контрольные точки подошвы в системе кости ft: [x,y,z], z = -0.138...-0.062 —
   носок (-Z), z = +0.065...+0.078 — пятка, y = -0.116 — плоская подошва,
   -0.066 — верх ранта. Набор соответствует геометрии ботинка. */
const PL_SOLE_PTS = [
  [0, -0.116, 0.078],
  [0, -0.116, -0.043],
  [0, -0.116, -0.089],
  [0, -0.112, -0.138],
  [0, -0.086, 0.065],
  [0, -0.094, -0.115],
  [0, -0.066, 0.073],
  [0, -0.066, -0.073],
  [0, -0.09, -0.094]
];

const PL_SKEL = (function () {
  const B = [];
  const idx = {};
  const A = (n, p, off) => {
    idx[n] = B.length;
    B.push({ p: p, off: off, m: new Float32Array(16), R: new Float32Array(9) });
  };
  A('root', -1, [0, 0, 0]);
  A('pel', 0, [0, PL_HIP, 0]);
  const leg = (sg, n) => {
    A('th' + n, idx.pel, [0.086 * sg, -0.055, 0]);
    A('sn' + n, idx['th' + n], [0, -PL_THLEN, 0]);
    A('ft' + n, idx['sn' + n], [0, -PL_SNLEN, 0]);
  };
  leg(1, 'L');
  leg(-1, 'R');
  return { B: B, idx: idx };
})();
/* rotY(y)*rotX(x)*rotZ(z) — ровно та композиция, что используется в skinRig */
function rotM3(x, y, z) {
  const cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z);
  const a = [cz, -sz, 0, sz, cz, 0, 0, 0, 1]; /* rotZ */
  const b = [1, 0, 0, 0, cx, -sx, 0, sx, cx]; /* rotX */
  const c = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]; /* rotY */
  const ab = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      ab[i * 3 + j] = b[i * 3] * a[j] + b[i * 3 + 1] * a[3 + j] + b[i * 3 + 2] * a[6 + j];
  const o = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      o[i * 3 + j] = c[i * 3] * ab[j] + c[i * 3 + 1] * ab[3 + j] + c[i * 3 + 2] * ab[6 + j];
  return o;
}
function fkSkel(pose) {
  const B = PL_SKEL.B;
  for (let i = 0; i < B.length; i++) {
    const b = B[i],
      rt = (pose && pose[PL_SKEL_NAME[i]]) || [0, 0, 0];
    const R = rotM3(rt[0], rt[1], rt[2]);
    b.R = R;
    if (b.p < 0) {
      b.m[0] = b.off[0];
      b.m[1] = b.off[1];
      b.m[2] = b.off[2];
      continue;
    }
    const P = B[b.p],
      pR = P.R;
    /* мировая позиция = родитель + R_родителя * смещение */
    b.m[0] = P.m[0] + pR[0] * b.off[0] + pR[3] * b.off[1] + pR[6] * b.off[2];
    b.m[1] = P.m[1] + pR[1] * b.off[0] + pR[4] * b.off[1] + pR[7] * b.off[2];
    b.m[2] = P.m[2] + pR[2] * b.off[0] + pR[5] * b.off[1] + pR[8] * b.off[2];
    /* полная ориентация = R_родителя * R_собственная */
    const o = b.R;
    const q = R;
    for (let r2 = 0; r2 < 3; r2++)
      for (let c2 = 0; c2 < 3; c2++)
        o[r2 * 3 + c2] =
          pR[r2 * 3] * q[c2] + pR[r2 * 3 + 1] * q[3 + c2] + pR[r2 * 3 + 2] * q[6 + c2];
  }
}
const PL_SKEL_NAME = (function () {
  const n = [];
  n.length = PL_SKEL.B.length;
  n[PL_SKEL.idx.root] = 'root';
  n[PL_SKEL.idx.pel] = 'pel';
  for (const s of ['L', 'R']) {
    n[PL_SKEL.idx['th' + s]] = 'th' + s;
    n[PL_SKEL.idx['sn' + s]] = 'sn' + s;
    n[PL_SKEL.idx['ft' + s]] = 'ft' + s;
  }
  return n;
})();
/* нижняя точка обеих стоп относительно корня (корень в начале координат) */
function footLowest(pose) {
  fkSkel(pose);
  let lo = 1e9;
  for (const s of ['L', 'R']) {
    const b = PL_SKEL.B[PL_SKEL.idx['ft' + s]],
      R = b.R;
    /* вторая строка полного поворота (с креном стопы) + углы подошвы */
    for (const q of PL_SOLE_PTS) {
      for (const sx of [-0.053, 0.0, 0.053]) {
        const y = b.m[1] + R[3] * sx + R[4] * q[1] + R[5] * q[2];
        if (y < lo) lo = y;
      }
    }
  }
  return lo;
}
/* насколько опустить корень, чтобы опора встала на y=0 */
function groundDY(pose) {
  return -footLowest(pose);
}

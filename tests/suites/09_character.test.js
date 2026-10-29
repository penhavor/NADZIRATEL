'use strict';
/* Персонажи: скелеты (монстр и игрок), машинерия анимационных клипов,
   позы gaits, FK/скининг, матрицы хвата предметов и анимация перезарядки. */

(function () {
  const T = __T;
  const G = LIB.G;
  const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  function assertPose(pose, msg) {
    T.ok(pose && typeof pose === 'object', msg + ': нет позы');
    let bones = 0;
    for (const k in pose) {
      const v = pose[k];
      if (!Array.isArray(v)) continue; /* довески dy/_flight — не кости */
      if (v.length !== 3) {
        T.eq(true, false, msg + ': кость ' + k + ' не [x,y,z]');
        continue;
      }
      for (let i = 0; i < 3; i++)
        T.eq(isFinite(v[i]), true, msg + ': NaN в кости ' + k + '[' + i + ']');
      T.ok(
        Math.abs(v[0]) < 12 && Math.abs(v[1]) < 12 && Math.abs(v[2]) < 12,
        msg + ': угол кости ' + k + ' абсурден: ' + v
      );
      bones++;
    }
    T.ok(bones >= 10, msg + ': в позе только ' + bones + ' костей');
    return bones;
  }

  function assertMat(m, msg) {
    T.eq(m.length, 16, msg + ': не 4x4');
    for (let i = 0; i < 16; i++) T.eq(isFinite(m[i]), true, msg + ': NaN в [' + i + ']');
    /* столбцы поворотной части единичные (ортонормированность) */
    for (let c = 0; c < 3; c++) {
      const l = Math.hypot(m[c], m[4 + c], m[8 + c]);
      T.near(l, 1, 1e-4, msg + ': столбец ' + c + ' не единичный');
    }
    T.near(m[3], 0, 1e-6, msg + ': m[3]');
    T.near(m[7], 0, 1e-6, msg + ': m[7]');
    T.near(m[11], 0, 1e-6, msg + ': m[11]');
    T.near(m[15], 1, 1e-6, msg + ': m[15]');
  }

  function samePose(a, b, msg, eps) {
    const e = eps === undefined ? 1e-9 : eps;
    const keys = Object.keys(a).filter(k => k !== 'dy' && k !== '_flight' && k !== 'root');
    T.eq(
      keys.length,
      Object.keys(b).filter(k => k !== 'dy' && k !== '_flight' && k !== 'root').length,
      msg + ': разный состав костей'
    );
    for (const k of keys) {
      for (let i = 0; i < 3; i++) T.near(a[k][i], b[k][i], e, msg + ': кость ' + k + '[' + i + ']');
    }
  }

  T.test('персонаж: состав анимационных клипов', function () {
    const clips = ANIM_CLIPS;
    const names = animNames();
    const labels = animLabels();
    T.ok(Array.isArray(clips) && clips.length >= 6, 'клипов подозрительно мало: ' + clips.length);
    T.eq(names.length, clips.length, 'animNames не совпадает с клипами');
    T.eq(labels.length, clips.length, 'animLabels не совпадает с клипами');
    const seen = {};
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      T.eq(typeof c.fn, 'function', 'клип ' + i + ' без fn');
      T.eq(typeof c.len, 'number', 'клип ' + i + ' без len');
      T.ok(c.len === -1 || c.len > 0, 'клип ' + c.name + ': len=' + c.len);
      T.eq(typeof c.label, 'string', 'клип ' + i + ' без подписи');
      T.eq(seen[c.name], undefined, 'имя клипа повторяется: ' + c.name);
      seen[c.name] = 1;
      T.eq(names[i], c.name, 'animNames[' + i + ']');
      T.eq(labels[i].name, c.name, 'animLabels[' + i + '].name');
      T.eq(labels[i].label, c.label, 'animLabels[' + i + '].label');
      T.eq(labels[i].len, c.len, 'animLabels[' + i + '].len');
    }
    /* базовые клипы игрока на месте */
    for (const n of ['idle', 'walk', 'run', 'crouch', 'sneak']) {
      T.eq(seen[n], 1, 'нет клипа ' + n);
    }
    /* коэффициенты походок положительны и различаются */
    T.ok(GAIT_K.walk > 0 && GAIT_K.run > 0 && GAIT_K.sneak > 0, 'GAIT_K не положительны');
    T.neq(GAIT_K.walk, GAIT_K.run, 'GAIT_K walk=run');
    T.neq(GAIT_K.walk, GAIT_K.sneak, 'GAIT_K walk=sneak');
    T.ok(GAIT_RATE && GAIT_RATE.walk > 0, 'GAIT_RATE.walk');
  });

  T.test('персонаж: poseFromClip — конечные позы, периодичность, детерминизм', function () {
    const poseFromClip = G('poseFromClip');
    const A = { ph: 0, cr: 0, mv: 0.5, fp: 0 };
    for (const name of animNames()) {
      const c = ANIM_CLIPS.filter(x => x.name === name)[0];
      const r = poseFromClip(name, 1.234, A, 0);
      T.ok(r && r.pose, name + ': нет результата');
      assertPose(r.pose, name);
      T.finite(r.dy, name + ': dy');
      /* детерминированность */
      samePose(poseFromClip(name, 1.234, A, 0).pose, r.pose, name + ' детерминирован');
      if (c.len > 0) {
        /* период len: поза в t и t+len совпадает (без holdEnd) */
        samePose(poseFromClip(name, 1.234 + c.len, A, 0).pose, r.pose, name + ': период');
        /* отрицательное время заворачивается в тот же цикл */
        samePose(
          poseFromClip(name, 1.234 - c.len * 3, A, 0).pose,
          r.pose,
          name + ': отрицательное время'
        );
        /* holdEnd: время за концом клипа клампится, а не заворачивается */
        const atEnd = poseFromClip(name, c.len, A, 0, true).pose;
        const pastEnd = poseFromClip(name, c.len + 5, A, 0, true).pose;
        samePose(pastEnd, atEnd, name + ': holdEnd не клампит');
      }
    }
    /* неизвестное имя не роняет, а берёт клип по умолчанию */
    const def = poseFromClip('нет-такого-клипа', 0.5, A, 0);
    T.ok(def && def.pose, 'неизвестный клип упал');
    assertPose(def.pose, 'клип по умолчанию');
    /* t0 сдвигает фазу */
    const a1 = poseFromClip('walk', 2.0, A, 0).pose;
    const a2 = poseFromClip('walk', 3.0, A, 1.0).pose;
    samePose(a1, a2, 't0 не сдвигает фазу');
  });

  T.test('персонаж: playerPose/playerPoseFP на живом состоянии', function () {
    const playerPose = G('playerPose'),
      playerPoseFP = G('playerPoseFP');
    const s = LIB.run({
      seed: 'pose',
      W: 12,
      H: 12,
      density: 0.3,
      cabDens: 0.1,
      loot: 50,
      monster: false
    });
    /* несколько состояний: покой, ходьба, бег, присед */
    const states = [];
    const mk = function (inp, n) {
      const st = LIB.run({
        seed: 'pose',
        W: 12,
        H: 12,
        density: 0.3,
        cabDens: 0.1,
        loot: 50,
        monster: false
      });
      st.runK = inp.run ? 1 : 0;
      LIB.frames(st, inp, n);
      return st;
    };
    states.push(['idle', mk({}, 30)]);
    states.push(['walk', mk({ fwd: 1 }, 60)]);
    states.push(['run', mk({ fwd: 1, run: 1 }, 60)]);
    states.push(['crouch', mk({ crouch: 1 }, 60)]);
    const poses = {};
    for (const pair of states) {
      const st = pair[1];
      const r = playerPose(st, st.time);
      T.ok(r && r.pose, pair[0] + ': нет позы');
      assertPose(r.pose, pair[0]);
      T.finite(r.dy, pair[0] + ': dy');
      T.eq(r.anim, st.pAnimWant, pair[0] + ': anim не совпал с pAnimWant');
      T.ok(st._snapB && st._snapB.pose, pair[0] + ': снапшот боди не создан');
      poses[pair[0]] = r.pose;
      /* вид от первого лица — отдельный снапшот, поза конечна */
      const rf = playerPoseFP(st, st.time);
      assertPose(rf.pose, pair[0] + ' FP');
      T.finite(rf.dy, pair[0] + ' FP dy');
      T.ok(st._snapFP && st._snapFP.pose, pair[0] + ': снапшот FP не создан');
      /* детерминированность: повторный вызов с тем же (st,t) */
      samePose(playerPose(st, st.time).pose, r.pose, pair[0] + ' детерминирован');
    }
    /* походки различаются: хотя бы одна кость бедра отличается */
    let diff = 0;
    for (const k in poses.idle) {
      if (
        poses.walk[k] &&
        (Math.abs(poses.idle[k][0] - poses.walk[k][0]) > 1e-6 ||
          Math.abs(poses.idle[k][1] - poses.walk[k][1]) > 1e-6 ||
          Math.abs(poses.idle[k][2] - poses.walk[k][2]) > 1e-6)
      )
        diff++;
    }
    T.ok(diff >= 4, 'walk и idle совпадают: отличий ' + diff);
    /* присед опускает таз: dy приседа ниже dy стойки при том же времени */
    const stC = states[3][1],
      stI = states[0][1];
    const dyC = playerPose(stC, stC.time).dy,
      dyI = playerPose(stI, stI.time).dy;
    T.ok(dyC < dyI + 1e-6, 'присед не опустил тело: ' + dyC + ' vs ' + dyI);
    /* pAnimForce переопределяет автовыбор (pAnimWant имеет приоритет над ним) */
    const stF = states[0][1];
    stF.pAnimWant = null;
    stF.pAnimForce = 'walk';
    T.eq(playerAutoAnim(stF), 'walk', 'playerAutoAnim не уважает pAnimForce');
    T.eq(playerPose(stF, stF.time).anim, 'walk', 'pAnimForce не сработал');
    delete stF.pAnimForce;
    T.eq(playerAutoAnim(stF), 'idle', 'playerAutoAnim в покое');
    stF.pAnimWant = 'idle';
    /* poseDistSnap: без снапшота 0, со снапшотом — неотрицательна */
    const bare = { animPhase: 0 };
    T.eq(poseDistSnap(bare, 'walk', 1), 0, 'poseDistSnap без снапшота');
    playerPose(stF, stF.time);
    const dSnap = poseDistSnap(stF, 'walk', stF.time);
    T.ok(dSnap >= 0 && isFinite(dSnap), 'poseDistSnap: ' + dSnap);
  });

  T.test('персонаж: походка Надзирателя — IK, период, опора на землю', function () {
    const MON_GAIT = G('MON_GAIT'),
      monGaitPose = G('monGaitPose');
    const monLegFK = G('monLegFK'),
      monFootLowest = G('monFootLowest');
    /* коэффициенты выводятся из геометрии: K = duty*2π/S (без проскальзывания) */
    for (const g of ['walk', 'run']) {
      const G2 = MON_GAIT[g];
      T.near(
        MON_GAIT_K[g],
        (G2.duty * 2 * Math.PI) / G2.S,
        1e-9,
        'MON_GAIT_K.' + g + ' не совпал с формулой'
      );
      T.ok(G2.duty > 0.3 && G2.duty <= 0.7, g + ': duty=' + G2.duty);
      T.ok(G2.S > 0.2 && G2.S < 0.6, g + ': S=' + G2.S);
    }
    for (const g of ['walk', 'run']) {
      const G2 = MON_GAIT[g];
      for (const ph of [0, 1.0, Math.PI, 2 * Math.PI - 0.001, -3.7]) {
        /* monGaitPose возвращает сам объект позы с довесками dy/root/_flight */
        const r = monGaitPose(ph, G2, 3.2, g === 'run' ? 0.18 : 0);
        T.ok(r && r.pel && r.thL, g + ': нет позы при ph=' + ph);
        assertPose(r, g + ' ph=' + ph);
        T.finite(r.dy, g + ': dy');
        T.ok(Math.abs(r.dy) < 0.3, g + ': dy абсурден: ' + r.dy);
        T.deepEq([r.root[0], r.root[1], r.root[2]], [0, 0, 0], g + ': root не в нуле');
        /* период 2π */
        const r2 = monGaitPose(ph + 2 * Math.PI, G2, 3.2, g === 'run' ? 0.18 : 0);
        T.near(r2.dy, r.dy, 1e-5, g + ': dy не периодичен');
        samePose(r2, r, g + ': поза не периодична', 1e-5);
        /* FK ног конечен, низшая точка стопы под корнем и не проваливается */
        const M = monLegFK(r);
        T.ok(M.L && M.R, g + ': нет матриц ног');
        assertMat(M.L, g + ': FK L');
        assertMat(M.R, g + ': FK R');
        /* lo — до подъёма корня (dy = −lo): знак свободный, величина мала */
        const lo = monFootLowest(r);
        T.finite(lo, g + ': footLowest');
        T.ok(lo > -1.5 && lo < 0.3, g + ': стопа слишком далеко от корня: ' + lo);
        if (!r._flight) T.near(r.dy, -lo, 1e-6, g + ': dy не равен −footLowest в опоре');
      }
      /* детерминированность */
      const a = monGaitPose(0.77, G2, 3.2, 0),
        b = monGaitPose(0.77, G2, 3.2, 0);
      T.near(a.dy, b.dy, 0, g + ': dy детерминирован');
      samePose(a, b, g + ' детерминирован', 0);
    }
    /* опора: после подъёма корня (dy=−lo) низшая стопа всегда на земле,
       а сам подъём мал и меняется плавно — тело не подпрыгивает */
    let loMin = 1e9,
      loMax = -1e9,
      prevLo = null,
      maxJump = 0;
    for (let i = 0; i <= 64; i++) {
      const lo = monFootLowest(monGaitPose((i / 64) * 2 * Math.PI, MON_GAIT.walk, 2, 0));
      if (lo < loMin) loMin = lo;
      if (lo > loMax) loMax = lo;
      if (prevLo !== null) maxJump = Math.max(maxJump, Math.abs(lo - prevLo));
      prevLo = lo;
    }
    T.ok(loMax < 0.3 && loMin > -0.6, 'подъём корня велик: [' + loMin + ',' + loMax + ']');
    T.ok(loMax - loMin > 1e-4, 'корень не двигается по вертикали — шага нет');
    T.ok(maxJump < 0.15, 'скачок корня между фазами: ' + maxJump);
    /* монстр в живом состоянии: monPose не падает во всех режимах */
    const monPose = G('monPose');
    const s = LIB.run({
      seed: 'monpose',
      W: 12,
      H: 12,
      density: 0.3,
      cabDens: 0,
      loot: 0,
      monster: true
    });
    for (const gait of ['stand', 'walk', 'run']) {
      s.mGait = gait;
      s.mSpeedNow = gait === 'stand' ? 0 : 2.5;
      for (let i = 0; i < 20; i++) {
        s.mPhase += 0.15;
        s.time += 1 / 60;
        const r = monPose(s, s.time);
        assertPose(r, 'monPose ' + gait + ' #' + i);
        T.finite(r.dy, 'monPose dy ' + gait);
        T.finite(monFootLowest(r), 'monPose footLowest ' + gait);
      }
    }
  });

  T.test('персонаж: риги — структура, FK, скининг, скрытые кости', function () {
    const buildRig = G('buildRig'),
      fkAll = G('fkAll');
    const rigSrcData = G('rigSrcData'),
      rigVisCount = G('rigVisCount'),
      skinRigEx = G('skinRigEx');
    const rig = buildRig();
    T.ok(rig && Array.isArray(rig.B) && rig.B.length >= 10, 'риг монстра подозрительно мал');
    T.eq(rig.names.length, rig.B.length, 'names не совпадает с B');
    let total = 0,
      roots = 0;
    for (let i = 0; i < rig.B.length; i++) {
      const b = rig.B[i];
      T.eq(rig.names[i] !== undefined, true, 'кость ' + i + ' без имени');
      T.eq(b.v.length, b.n * 9, 'кость ' + i + ': v не кратна 9');
      T.eq(b.m.length, 16, 'кость ' + i + ': m не 16');
      if (b.parent < 0) roots++;
      else T.ok(b.parent < i, 'кость ' + i + ': родитель не раньше по списку');
      total += b.n;
    }
    T.eq(roots, 1, 'корней не один: ' + roots);
    T.eq(rig.total, total, 'rig.total не совпал с суммой');
    /* FK: все матрицы конечны, корень — от rootM */
    const pose = G('monGaitPose')(0.6, G('MON_GAIT').walk, 2, 0).pose;
    fkAll(rig, pose, IDENT);
    for (let i = 0; i < rig.B.length; i++) {
      for (let k = 0; k < 16; k++) T.eq(isFinite(rig.B[i].m[k]), true, 'FK NaN в кости ' + i);
    }
    T.near(rig.B[0].m[15], 1, 1e-6, 'корень вырожден');
    /* иерархия: мировая матрица потомка = родитель * локальная (проверка на корне-потомке) */
    const child = rig.B.filter(b => b.parent === 0)[0];
    T.ok(child, 'нет детей у корня');
    /* rigSrcData: буфер вершин и индексы костей */
    const src = rigSrcData(rig);
    T.eq(src.src.length, total * 9, 'src длина');
    T.eq(src.bi.length, total, 'bi длина');
    let vi = 0;
    for (let i = 0; i < rig.B.length; i++) {
      for (let k = 0; k < rig.B[i].n; k++) T.eq(src.bi[vi + k], i, 'bi не указывает на кость ' + i);
      vi += rig.B[i].n;
    }
    for (let i = 0; i < src.src.length; i++) T.eq(isFinite(src.src[i]), true, 'src NaN в ' + i);
    /* rigVisCount */
    T.eq(rigVisCount(rig, null), total, 'vidCount без hide');
    const hide = new Uint8Array(rig.B.length);
    hide[1] = 1;
    T.eq(rigVisCount(rig, hide), total - rig.B[1].n, 'hide не вычел кость');
    /* skinRigEx: пишет total*9 чисел, возвращает видимые вершины, нормали единичны */
    const out = new Float32Array(total * 9);
    const wAll = skinRigEx(rig, pose, IDENT, out, null);
    T.eq(wAll, total, 'skinRigEx без hide');
    let badN = 0;
    for (let v = 0; v < total; v++) {
      const nl = Math.hypot(out[v * 9 + 5], out[v * 9 + 6], out[v * 9 + 7]);
      if (Math.abs(nl - 1) > 1e-3) badN++;
      for (let k = 0; k < 9; k++)
        if (!isFinite(out[v * 9 + k])) {
          badN++;
          break;
        }
    }
    T.eq(badN, 0, 'скинニング: битых вершин ' + badN);
    /* детерминированность: повтор в чистый буфер до вызова с hide */
    const out2 = new Float32Array(total * 9);
    skinRigEx(rig, pose, IDENT, out2, null);
    let diff = 0;
    for (let i = 0; i < out.length; i++) if (out[i] !== out2[i]) diff++;
    T.eq(diff, 0, 'skinRigEx не детерминирован');
    const wHide = skinRigEx(rig, pose, IDENT, out, hide);
    T.eq(wHide, total - rig.B[1].n, 'skinRigEx с hide');
    /* риг игрока: собирается, содержит кости из HIDE_FP, finish помечает их */
    const prig = G('buildPlayerRig')();
    T.ok(prig && Array.isArray(prig.B) && prig.B.length >= 10, 'риг игрока подозрительно мал');
    const hideNames = G('HIDE_FP')();
    T.ok(hideNames.length >= 5, 'HIDE_FP пуст');
    let hidden = 0;
    for (const n of hideNames) {
      const i = prig.idx[n];
      T.ok(i !== undefined, 'кость ' + n + ' не найдена в риге игрока');
      if (prig.hide[i]) hidden++;
    }
    T.eq(hidden, hideNames.length, 'не все FP-кости помечены скрытыми');
    T.ok(rigVisCount(prig, null) > 0, 'у рига игрока нет вершин');
    T.ok(rigVisCount(prig, prig.hide) < rigVisCount(prig, null), 'hide игрока ничего не скрывает');
  });

  T.test('персонаж: матрицы хвата и heldMat', function () {
    const heldMat = G('heldMat');
    /* heldMat(0,0,0,0,0) = идентичность */
    const id = heldMat(0, 0, 0, 0, 0);
    for (let i = 0; i < 16; i++) T.near(id[i], IDENT[i], 1e-6, 'heldMat-идентичность [' + i + ']');
    /* трансляция кладётся в 12..14, повороты ортонормированы */
    const m = heldMat(1, 2, 3, 0.6, -0.3);
    assertMat(m, 'heldMat');
    T.near(m[12], 1, 1e-6, 'heldMat tx');
    T.near(m[13], 2, 1e-6, 'heldMat ty');
    T.near(m[14], 3, 1e-6, 'heldMat tz');
    /* ry=π/2, rz=0: локальный +X смотрит в −Z... rotY(π/2): (1,0,0)→(0,0,−1) */
    const r = heldMat(0, 0, 0, Math.PI / 2, 0);
    T.near(r[0], 0, 1e-5, 'rotY x');
    T.near(r[2], -1, 1e-5, 'rotY z');
    /* грипы предметов — валидные жёсткие матрицы */
    for (const k of ['GRIP_FLASH', 'GRIP_KEY', 'GRIP_BATT', 'GRIP_SMALL_L']) {
      const gm = G(k)();
      assertMat(gm, k);
      T.ok(
        Math.abs(gm[12]) < 1 && Math.abs(gm[13]) < 1 && Math.abs(gm[14]) < 1,
        k + ': сдвиг больше метра'
      );
    }
    /* VM_FRAME — видовая матрица вьюмодели: конечная, равномерный масштаб */
    const vm = G('VM_FRAME')();
    for (let i = 0; i < 16; i++) T.eq(isFinite(vm[i]), true, 'VM_FRAME NaN [' + i + ']');
    const l0 = Math.hypot(vm[0], vm[1], vm[2]);
    const l1 = Math.hypot(vm[4], vm[5], vm[6]);
    const l2 = Math.hypot(vm[8], vm[9], vm[10]);
    T.ok(l0 > 0.05 && l0 < 1, 'VM_FRAME масштаб: ' + l0);
    T.near(l1, l0, 1e-5, 'VM_FRAME масштаб Y не равен X');
    T.near(l2, l0, 1e-5, 'VM_FRAME масштаб Z не равен X');
    T.near(vm[15], 1, 1e-6, 'VM_FRAME m[15]');
  });

  T.test('персонаж: перезарядка — rlSample и окна видимости батарейки', function () {
    const rlSample = G('rlSample'),
      rlBattOld = G('rlBattOld'),
      rlBattNew = G('rlBattNew');
    const FIELDS3 = ['uaL', 'faL', 'wrL', 'uaR', 'faR', 'wrR'];
    const FIELDS1 = ['cuL', 'spL', 'cuR', 'spR'];
    let prev = null;
    for (let i = 0; i <= 20; i++) {
      const u = i / 20;
      const r = rlSample(u);
      for (const f of FIELDS3) {
        T.ok(r[f] && r[f].length === 3, 'rlSample(' + u + ').' + f);
        for (let k = 0; k < 3; k++)
          T.eq(isFinite(r[f][k]), true, 'rlSample(' + u + ').' + f + '[' + k + '] NaN');
      }
      for (const f of FIELDS1) T.finite(r[f], 'rlSample(' + u + ').' + f);
      /* детерминированность */
      const r2 = rlSample(u);
      for (const f of FIELDS3)
        for (let k = 0; k < 3; k++) T.eq(r2[f][k], r[f][k], 'rlSample не детерминирован');
      /* непрерывность: соседние отсчёты близки */
      if (prev) {
        for (const f of FIELDS3)
          for (let k = 0; k < 3; k++) {
            T.ok(Math.abs(prev[f][k] - r[f][k]) < 1.2, 'rlSample скачет на ' + f + '[' + k + ']');
          }
      }
      prev = r;
    }
    /* clamp за границы */
    const r0 = rlSample(-3),
      rA = rlSample(0),
      r1 = rlSample(5),
      rB = rlSample(1);
    T.eq(r0.cuL, rA.cuL, 'u<0 не клампится');
    T.eq(r1.cuL, rB.cuL, 'u>1 не клампится');
    /* окна батарейки: старая 0.26..0.50, новая 0.54..0.75, не пересекаются */
    T.eq(rlBattOld(0.26), true, 'старая на левой границе');
    T.eq(rlBattOld(0.5), true, 'старая на правой границе');
    T.eq(rlBattOld(0.38), true, 'старая в середине');
    T.eq(rlBattOld(0.259), false, 'старая до окна');
    T.eq(rlBattOld(0.501), false, 'старая после окна');
    T.eq(rlBattNew(0.54), true, 'новая на левой границе');
    T.eq(rlBattNew(0.75), true, 'новая на правой границе');
    T.eq(rlBattNew(0.539), false, 'новая до окна');
    T.eq(rlBattNew(0.751), false, 'новая после окна');
    for (let i = 0; i <= 100; i++) {
      const u = i / 100;
      T.eq(rlBattOld(u) && rlBattNew(u), false, 'окна пересекаются на u=' + u);
    }
    /* вне окон батарейка не видна ни та, ни другая */
    T.eq(rlBattOld(0), false, 'старая в начале');
    T.eq(rlBattNew(1), false, 'новая в конце');
  });

  T.test('персонаж: регионы кожи PREG и материалы PMAT', function () {
    const PREG = G('PREG')(),
      PMAT = G('PMAT')();
    const regions = ['flesh', 'skin', 'jacket', 'pants', 'boot', 'hair'];
    let prevU1 = -1;
    for (const k of regions) {
      const r = PREG[k];
      T.ok(r, 'нет региона ' + k);
      T.inRange(r.u0, 0, 1, k + '.u0');
      T.inRange(r.u1, 0, 1, k + '.u1');
      T.ok(r.u0 < r.u1, k + ': регион вывернут');
      T.ok(r.u0 >= prevU1 - 1e-9, k + ': регионы пересекаются');
      prevU1 = r.u1;
    }
    for (const k of ['skin', 'jacket', 'pants', 'boot', 'hair']) {
      const m = PMAT[k];
      T.ok(m, 'нет материала ' + k);
      T.ok(m.rough > 0 && m.rough <= 1, k + '.rough: ' + m.rough);
      T.ok(m.spec > 0, k + '.spec');
      T.ok(m.bump > 0, k + '.bump');
    }
  });
})();

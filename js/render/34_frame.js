GPU.frame = function (S, dt) {
  if (!GPU.ready || !dev || !T) return;
  const ncell = GPU.mapW * GPU.mapH;
  /* ПОЛЕ ОБЛУЧЁННОСТИ (карта света) считается на GPU (csLmInit/csLmIter/csLmFinal —
   6 итераций Якоби с коэффициентом 0.55). Здесь только упаковка входа: свет и
   затвор по клеткам + состояние карты с битом открытой двери (буфер общий с
   картой теней). Пятно фонаря внедряется в поле в csLmInit (см. PO_V1). */
  if (!GPU.lgStage || GPU.lgStage.length !== ncell * 2) GPU.lgStage = new Float32Array(ncell * 2);
  const lgS = GPU.lgStage;
  for (let i = 0; i < ncell; i++) {
    lgS[i * 2] = S.light[i];
    lgS[i * 2 + 1] = S.gate ? S.gate[i] : 1;
  }
  dev.queue.writeBuffer(bufLG, 0, lgS);
  if (!GPU.gridStage || GPU.gridStage.length !== ncell) GPU.gridStage = new Uint32Array(ncell);
  collectGridU32(S, GPU.gridStage);
  dev.queue.writeBuffer(bufGrid, 0, GPU.gridStage);
  lampsArr.fill(0);
  const nL = collectLamps(S, lampsArr);
  /* маска ламп на клетку — fsWorld перебирает только лампы своей клетки */
  if (!GPU.clMask || GPU.clMask.length !== ncell * 2) GPU.clMask = new Uint32Array(ncell * 2);
  buildCellLightMask(S, lampsArr, nL, GPU.clMask);
  dev.queue.writeBuffer(bufCellLit, 0, GPU.clMask);
  const shW = Math.max(16, Math.min(SHW_MAX, Q.shSteps | 0));
  const shRowsQ = Math.max(8, Math.min(SH_ROWS_MAX, Q.shRows | 0));
  const nSH = Math.max(
    1,
    Math.min(nL, Q.shLamps | 0 || 64)
  ); /* тень дают только ближайшие лампы — у дальних att≤2%, их и так не видно */
  /* позы тела и монстра считаются ДО теней — капсулы скелета попадают в карту
   теней, поэтому силуэт на стене живой и динамичный. */
  const crK = clp(S.pCrouch || 0, 0, 1);
  /* стойка «фонарь в руке» для третьего лица плавно включается и выключается */
  {
    const flS = S.fl;
    const wantHold =
      flS &&
      flS.owned &&
      !(flS.rl > 0) &&
      S.inv &&
      S.sel >= 0 &&
      S.inv[S.sel] &&
      S.inv[S.sel].kind === 'flash'
        ? 1
        : 0;
    S._holdK =
      (S._holdK || 0) + Math.max(-dt / 0.22, Math.min(dt / 0.22, wantHold - (S._holdK || 0)));
  }
  /* стойка щипка (ключ или батарейка в руке) — тот же фильтр скорости, что у фонаря */
  {
    const itP = S.inv && S.sel >= 0 ? S.inv[S.sel] : null;
    const wantPinch =
      itP && (itP.kind === 'key' || itP.kind === 'batt') && !(S.fl && S.fl.rl > 0) ? 1 : 0;
    S._pinchK =
      (S._pinchK || 0) + Math.max(-dt / 0.22, Math.min(dt / 0.22, wantPinch - (S._pinchK || 0)));
  }
  const bodyP = playerPose(S, S.time);
  let mPose = null,
    rootM = null;
  if (S.monster && !S.caught) {
    mPose = monPose(S, S.time);
    rootM = m4mul(m4t(S.mx, S.monDY || 0, S.my), m4rotY(S.mYaw || 0));
  }
  GPU.shCaps = collectShadowCaps(S, bodyP, mPose, rootM);

  const proj = perspW(
    S.thirdPerson ? (62 * Math.PI) / 180 : (75 * Math.PI) / 180,
    RW / RH,
    0.05,
    Q.far
  );
  /* Высота камеры — из ФАКТИЧЕСКОЙ позы модели (dy корня + FK головы + глаза):
   камера и тело — одна поза, отражение в луже не «отстаёт» от взгляда.
   · стоя — глаза на 0.55 клетки (1.62 м; EYE_REF_RIG = 1.7205 — замер FK по позе
   покоя без наклона шеи и головы);
   · ходьба на C — тело и камера поднимаются вместе (таз 0.60 рига);
   · покачивание шага и бега — настоящее, из шага (таз + фаза полёта). */
  /* наклон шеи и головы НЕ входит в высоту камеры: микросакады и «дыхание» взгляда
   уводили бы её на ±1.5 см, а наклон от мыши камера отыгрывает собственным
   наклоном. Высота берётся от торса (таз→позвоночник→грудь). */
  const camPose = Object.assign({}, bodyP.pose, {
    nk: [0, bodyP.pose.nk ? bodyP.pose.nk[1] : 0, 0],
    hd: [0, bodyP.pose.hd ? bodyP.pose.hd[1] : 0, 0]
  });
  const hdM = fkChain(GPU.plRig, camPose, m4t(0, bodyP.dy, 0), ['hd']).hd;
  const eyeRig = hdM[13] + hdM[5] * EYE_HY + hdM[9] * EYE_ZC;
  const eyeY0 = 0.55 + (eyeRig - EYE_REF_RIG) * PL_SCALE;
  const bobAmpX = (0.009 + 0.006 * (S.runK || 0)) * (1 - 0.5 * crK) * S.bobA;
  const bobX = Math.cos(S.animPhase || 0) * bobAmpX;
  /* камера третьего лица — за спиной персонажа, смотрит на него */
  let view, camX, camY, camZ;
  if (S.thirdPerson) {
    /* 3 состояния (1=сзади, 2=спереди); расстояние ближе (1.15→0.90); камера НЕ
   проходит сквозь стены: расстояние зажимается свободным лучом. */
    const back = S.thirdPerson === 1;
    const dWant = 0.9 - 0.08 * crK;
    const dx = Math.cos(S.ang) * (back ? -1 : 1),
      dz = Math.sin(S.ang) * (back ? -1 : 1);
    let dEff = dWant;
    {
      const nstep = Math.max(3, Math.ceil(dWant / 0.04));
      let a2 = 0,
        b2 = 1,
        hit = false;
      for (let q = 1; q <= nstep; q++) {
        const tt = q / nstep;
        if (blocked(S, S.px + dx * dWant * tt, S.py + dz * dWant * tt)) {
          a2 = (q - 1) / nstep;
          b2 = tt;
          hit = true;
          break;
        }
      }
      if (hit) {
        for (let i2 = 0; i2 < 10; i2++) {
          const m2 = (a2 + b2) * 0.5;
          if (blocked(S, S.px + dx * dWant * m2, S.py + dz * dWant * m2)) b2 = m2;
          else a2 = m2;
        }
        dEff = Math.max(0.2, dWant * b2 - 0.1);
      }
    }
    camX = S.px + dx * dEff;
    camZ = S.py + dz * dEff;
    camY =
      0.52 -
      0.16 * crK +
      (1 - clp(dEff / dWant, 0, 1)) * 0.12; /* у стены камера поднимается к голове */
    if (camY > eyeY0 - 0.04) camY = eyeY0 - 0.04;
    const yawT = back ? S.ang : S.ang + Math.PI;
    const pitT = back
      ? (S.pitch || 0) * 0.6 - 0.1 - 0.1 * crK
      : -((S.pitch || 0) * 0.6) - 0.1 - 0.1 * crK;
    view = look(camX, camY, camZ, yawT, pitT);
  } else {
    camX = S.px - Math.sin(S.ang) * bobX;
    camY = eyeY0;
    camZ = S.py + Math.cos(S.ang) * bobX;
    view = look(
      camX,
      camY,
      camZ,
      S.ang,
      (S.pitch || 0) +
        Math.sin((S.camBobPh || 0) + 1.7) * 0.0045 * S.bobA * (1 - 0.35 * (S.runK || 0))
    );
  }
  zA = proj[10];
  zB = proj[14];
  const viewMir = m4mul(view, M4MIR);
  /* зеркальный проход — только если хотя бы одна клетка с лужей попадает во
   вьюпорт: нет луж в кадре ⇒ отражение никто не сэмплирует, и проход (полная
   перерисовка мира зеркальной камерой) пропускается без видимой разницы */
  const reflOn = !!(
    T.reflC &&
    GPU.pudCells &&
    GPU.pudCells.length &&
    frustumPud(m4mul(proj, view), GPU.pudCells, GPU.mapW)
  );

  /* ---- юниформы кадра и список отрисовки мира ---- */
  ubReset();
  const NLQ = Math.max(1, Q.lamps | 0); /* слот фонаря в FrameW — три vec4 сразу за массивом ламп.
   flA = (позиция, яркость), flB = (направление, косинус края конуса),
   flC = (косинус ядра, дальность, слот карты теней, ...), flDv = (цвет, ...). */
  const FO_FLASH = 208 + 16 * Math.max(1, Q.lamps | 0);
  /* яркость и цвет луча — ТЕ ЖЕ функции, что в ядре (flashBright/flashFlick): то,
   что нарисовано, и то, что отгоняет тень, никогда не расходится. */
  function flashState(S) {
    const f = S && S.fl ? S.fl : null;
    const on = !!(f && f.owned && f.on && !(f.rl > 0) && flashBright(f.e) * flashFlick(S) > 0.01);
    if (!on) return { on: false, I: 0, k: 0, col: [1, 0.94, 0.82] };
    const k = flashBright(f.e) * flashFlick(S);
    const I = FL_INTENSITY * k;
    return { on: true, I: I, k: k, col: [1.0, 0.94 - 0.1 * (1 - k), 0.82 - 0.22 * (1 - k)] };
  }
  /* направление луча — ровно туда, куда смотрит игрок (рыскание + наклон) */
  function flashDir(S) {
    const p = Math.max(-1.1, Math.min(1.1, S.pitch || 0)),
      cp = Math.cos(p);
    return [Math.cos(S.ang) * cp, Math.sin(p), Math.sin(S.ang) * cp];
  }
  function frameSlot(PJ, VW, CX, CY, CZ, CLIP, RON, FL) {
    const o = allocFrame(PJ, VW);
    put4(o + FO_CAM, CX, CY, CZ, Q.fog);
    put4(o + FO_FOG, FOGC[0], FOGC[1], FOGC[2], 0);
    put4(o + FO_MAP, GPU.mapW, GPU.mapH, CLIP, RON);
    put4(o + FO_P1, S.time, Q.nrmK, Q.pomK || 0, Q.detN || 0);
    putU(o + FO_I1, (S.seedTag | 0) & 0x7fffffff, 0, 0, 0);
    putF(o + FO_LAMPS, lampsArr.subarray(0, NLQ * 4));
    const F2 = FL || { on: false, I: 0, d: [0, 0, 1], o: [CX, CY, CZ], col: [1, 0.94, 0.82] };
    put4(o + FO_FLASH, F2.o[0], F2.o[1], F2.o[2], F2.on ? F2.I : 0);
    put4(o + FO_FLASH + 16, F2.d[0], F2.d[1], F2.d[2], FL_COS_OUT);
    put4(
      o + FO_FLASH + 32,
      FL_COS_IN,
      FL_RANGE,
      fshSlot,
      0
    ); /* flC.z — слот фонаря в карте теней */
    put4(o + FO_FLASH + 48, F2.col[0], F2.col[1], F2.col[2], 0);
    /* flE — точка попадания луча (вторичный источник рассеяния), flF — цвет+радиус */
    put4(
      o + FO_FLASH + 64,
      F2.b ? F2.b[0] : 0,
      F2.b ? F2.b[1] : 0,
      F2.b ? F2.b[2] : 0,
      F2.b ? F2.b[3] : 0
    );
    put4(o + FO_FLASH + 80, F2.col[0], F2.col[1], F2.col[2], FL_BOUNCE_R);
    return o;
  }
  /* Параметры фонаря на кадр. Начало луча — предварительно «у руки» (камера +
   вперёд 0.19 + вправо 0.045 + вниз 0.024 клетки — замер FK по масштабу
   вьюмодели), уточняется до головы фонаря после скиннинга кисти (put4 ниже).
   Зеркальный слот — начало и направление, отражённые от пола. */
  const flSt = flashState(S);
  const fshSlot =
    flSt.on && nSH < 64 ? nSH : -1; /* слот теней фонаря в texSh — следующий за лампами */
  const flDir = flashDir(S);
  const flR = [-Math.sin(S.ang), 0, Math.cos(S.ang)];
  const FL_MAIN = {
    on: flSt.on,
    I: flSt.I,
    d: flDir,
    col: flSt.col,
    o: [
      camX + flDir[0] * 0.19 + flR[0] * 0.045,
      camY - 0.024 + flDir[1] * 0.19,
      camZ + flDir[2] * 0.19 + flR[2] * 0.045
    ]
  };
  const FL_REFL = {
    on: flSt.on,
    I: flSt.I,
    col: flSt.col,
    d: [flDir[0], -flDir[1], flDir[2]],
    o: [FL_MAIN.o[0], -FL_MAIN.o[1], FL_MAIN.o[2]]
  };
  const fMain = frameSlot(proj, view, camX, camY, camZ, 0.0, reflOn ? 1.0 : 0.0, FL_MAIN);
  /* у вьюмодели своя проекция: near 1.2 см — кисти не «обрезаются» у камеры, fov
   чуть уже мирового — меньше искажений на руках. */
  const projVM = perspW((62 * Math.PI) / 180, RW / RH, 0.012, 6.0);
  const fVM = frameSlot(projVM, view, camX, camY, camZ, 0.0, 0.0, FL_MAIN);
  const fRefl = reflOn ? frameSlot(proj, viewMir, camX, -camY, camZ, 1.0, 0.0, FL_REFL) : 0;

  const WL = wlList;
  wlList.length = 0; /* список отрисовки мира — переиспользуемый массив */
  /* слот отрисовки тела игрока (rim=2) */
  const oVM = allocDraw();
  put4(oVM + DO_F2, 2, 0, 0, 0);
  function chunk(model, opt) {
    const o = allocDraw();
    const p = opt || {};
    putM(o + DO_MODEL, model);
    put4(
      o + DO_EM,
      p.emColor ? p.emColor[0] : 0,
      p.emColor ? p.emColor[1] : 0,
      p.emColor ? p.emColor[2] : 0,
      0
    );
    put4(
      o + DO_FLAT,
      p.flatCol ? p.flatCol[0] : 0,
      p.flatCol ? p.flatCol[1] : 0,
      p.flatCol ? p.flatCol[2] : 0,
      0
    );
    put4(
      o + DO_DOORIO,
      p.doorIn ? p.doorIn[0] : 0,
      p.doorIn ? p.doorIn[1] : 0,
      p.doorOut ? p.doorOut[0] : 0,
      p.doorOut ? p.doorOut[1] : 0
    );
    put4(
      o + DO_AXIS,
      p.doorAxis ? p.doorAxis[0] : 0,
      p.doorAxis ? p.doorAxis[1] : 0,
      p.doorAxis ? p.doorAxis[2] : 0,
      0
    );
    put4(o + DO_F1, p.emissive || 0, p.emMode || 0, p.flat || 0, p.wobble || 0);
    put4(o + DO_F2, p.rim || 0, p.doorMode || 0, p.doorMix || 0, p.dtex || 0);
    put4(
      o + DO_F3,
      p.f3 ? p.f3[0] : 0,
      p.f3 ? p.f3[1] : 0,
      p.f3 ? p.f3[2] : 0,
      p.f3 ? p.f3[3] : 0
    ); /* f3.y — глянец плоских предметов */
    return o;
  }
  /* режим отрисовки: бит 0 — отсекать задние грани; бит 1 (2) — не рисовать в
   зеркальном проходе (пол: отражению он не нужен, а discard в fsWorld стоил бы
   early-z) */
  function add(cull, mesh, off) {
    WL.push(cull, mesh, off);
  }

  const oW = chunk(IDENT);
  add(0, { buf: bufWorld, n: GPU.wCount }, oW);
  if (GPU.wFCount > 0) add(2, { buf: bufWorldFloor, n: GPU.wFCount }, oW);
  const cap = Q.hdr ? 1.35 : 0.8,
    eb = 1;
  for (let i = 0; i < nL; i++) {
    const I = lampsArr[i * 4 + 3];
    if (I <= 0.05) continue;
    const lm = m4t(lampsArr[i * 4], LAMP_Y, lampsArr[i * 4 + 1]);
    add(1, MESH.lampH, chunk(lm));
    add(
      1,
      MESH.lampP,
      chunk(lm, {
        emissive: 1,
        emMode: 4,
        flat: 1,
        emColor: [Math.min(cap, I * eb), Math.min(cap, I * 0.93 * eb), Math.min(cap, I * 0.78 * eb)]
      })
    );
  }
  function leafChunk(D, tmesh, topen, dmat) {
    doorSides(S, D);
    return chunk(dmat || doorModel(D, topen), {
      doorMode: 1,
      doorMix: doorMix(topen),
      doorIn: [D.inL, D.inG],
      doorOut: [D.outL, D.outG],
      doorAxis: [D.ax, 0, D.ay],
      dtex: 1
    });
  }
  add(0, MESH.door, leafChunk(GPU.DR.exit, MESH.door, Math.min(1, S.doorLeafT || 0)));
  for (const sd of GPU.DR.safe) {
    const t = S.doorState ? S.doorState[sd.y * GPU.mapW + sd.x] : 0;
    const dm = doorModel(sd, t);
    add(0, MESH.safe, leafChunk(sd, MESH.safe, t, dm));
    /* фурнитура деревянной двери едет на створке: пояса, заклёпки, ручка */
    add(0, MESH.safeHw, chunk(dm, { flat: 1, flatCol: [0.055, 0.058, 0.066], f3: [0, 0.1, 0, 0] }));
  }
  /* вентиль на створке двери выхода (со стороны игрока): проворачивается, пока его
   крутит ключ (doorT), после — стоит повёрнутым */
  {
    const D = GPU.DR.exit,
      dv = clp(S.doorT || 0, 0, 1),
      aa = dv * dv * (3 - 2 * dv) * Math.PI * 6;
    const vM = m4mul(
      doorModel(D, Math.min(1, S.doorLeafT || 0)),
      m4mul(m4t(0, DOOR_H * 0.525, -0.062), m4mul(m4rotZ(aa), m4sc(1.353)))
    ); /* 1.353 — размер прежнего текстурного вентиля */
    add(0, MESH.valve, chunk(vM, { flat: 1, flatCol: [0.17, 0.18, 0.2], f3: [0, 0.25, 0, 0] }));
  }
  /* МЕБЕЛЬ И МЕЛКИЕ ПРЕДМЕТЫ. Ключ лежит в ящике дальнего шкафа (рисуется вместе
   с ящиком, когда тот открыт). */
  const PROP_D2 = Q.propDist * Q.propDist;
  const sm3 = x => x * x * (3 - 2 * x);
  for (const b of S.batts || []) {
    if (b.taken) continue;
    const bx = b.x + 0.5 - S.px,
      by = b.y + 0.5 - S.py;
    if (bx * bx + by * by > PROP_D2) continue;
    const bM = m4mul(
      m4t(b.x + 0.5, 0.0044, b.y + 0.5),
      m4mul(m4rotY(b.rot * 6.283), m4sc(PL_SCALE))
    );
    add(
      0,
      MESH.battBody,
      chunk(bM, { flat: 1, flatCol: [0.09, 0.09, 0.105], f3: [0, 0.75, 0, 0] })
    );
    add(0, MESH.battBand, chunk(bM, { flat: 1, flatCol: [0.82, 0.62, 0.12], f3: [0, 0.25, 0, 0] }));
  }
  /* предметы, брошенные игроком (G): лежат на полу, подбираются через E */
  for (const d of S.drops || []) {
    const dx0 = d.wx - S.px,
      dy0 = d.wy - S.py;
    if (dx0 * dx0 + dy0 * dy0 > PROP_D2) continue;
    const dM = m4mul(m4t(d.wx, 0.0044, d.wy), m4mul(m4rotY(d.rot), m4sc(PL_SCALE)));
    if (d.kind === 'flash') {
      add(
        0,
        MESH.flash,
        chunk(dM, { flat: 1, flatCol: [0.085, 0.09, 0.105], f3: [0, 0.85, 0, 0] })
      );
      add(
        0,
        MESH.flashLens,
        chunk(dM, { flat: 1, flatCol: [0.14, 0.16, 0.18], f3: [0, 0.55, 0, 0] })
      );
    } else if (d.kind === 'key') {
      add(0, MESH.key, chunk(dM, { flat: 1, flatCol: [0.95, 0.75, 0.25], f3: [0, 0.9, 0, 0] }));
    } else {
      add(
        0,
        MESH.battBody,
        chunk(dM, { flat: 1, flatCol: [0.09, 0.09, 0.105], f3: [0, 0.75, 0, 0] })
      );
      add(
        0,
        MESH.battBand,
        chunk(dM, { flat: 1, flatCol: [0.82, 0.62, 0.12], f3: [0, 0.25, 0, 0] })
      );
    }
  }
  for (const c of S.cabs || []) {
    const cx0 = c.x + 0.5 - S.px,
      cy0 = c.y + 0.5 - S.py;
    if (cx0 * cx0 + cy0 * cy0 > PROP_D2) continue;
    const cM = m4mul(
      m4t(c.x + 0.5 + c.wx * (0.5 - CAB_D / 2), 0, c.y + 0.5 + c.wy * (0.5 - CAB_D / 2)),
      m4rotY(Math.atan2(c.wx, c.wy))
    );
    add(0, MESH.cab, chunk(cM));
    const op = sm3(Math.max(0, Math.min(1, c.open)));
    const dM = m4mul(cM, m4t(0, 0, -op * CAB_SLIDE));
    add(0, MESH.cabDrawer, chunk(dM));
    if (op > 0.3 && !c.looted && c.content) {
      if (c.content === 'key') {
        const iM = m4mul(
          dM,
          m4mul(m4t(0, 0.0755, 0.004), m4mul(m4rotY(c.phase * 6.283), m4sc(PL_SCALE)))
        );
        add(0, MESH.key, chunk(iM, { flat: 1, flatCol: [0.95, 0.75, 0.25], f3: [0, 0.9, 0, 0] }));
      } else {
        const iM = m4mul(
          dM,
          m4mul(m4t(-0.006, 0.0665, 0.004), m4mul(m4rotY(c.phase * 6.283), m4sc(PL_SCALE)))
        );
        add(
          0,
          MESH.battBody,
          chunk(iM, { flat: 1, flatCol: [0.09, 0.09, 0.105], f3: [0, 0.75, 0, 0] })
        );
        add(
          0,
          MESH.battBand,
          chunk(iM, { flat: 1, flatCol: [0.82, 0.62, 0.12], f3: [0, 0.25, 0, 0] })
        );
      }
    }
  }
  /* стол в безопасной комнате + фонарь на нём, пока не забран */
  if (S.table) {
    const t = S.table;
    const tx0 = t.x + 0.5 - S.px,
      ty0 = t.y + 0.5 - S.py;
    if (tx0 * tx0 + ty0 * ty0 <= PROP_D2) {
      const tM = m4mul(
        m4t(t.x + 0.5 + t.wx * (0.5 - TBL_D / 2), 0, t.y + 0.5 + t.wy * (0.5 - TBL_D / 2)),
        m4rotY(Math.atan2(t.wx, t.wy))
      );
      add(0, MESH.table, chunk(tM));
      if (!S.flashTaken) {
        const fM = m4mul(
          tM,
          m4mul(m4t(-0.045, TBL_H + 0.012, -0.005), m4mul(m4rotY(0.55), m4sc(PL_SCALE)))
        );
        add(
          0,
          MESH.flash,
          chunk(fM, { flat: 1, flatCol: [0.085, 0.09, 0.105], f3: [0, 0.85, 0, 0] })
        );
        add(
          0,
          MESH.flashLens,
          chunk(fM, { flat: 1, flatCol: [0.14, 0.16, 0.18], f3: [0, 0.55, 0, 0] })
        );
      }
    }
  }
  if ((S.doorLeafT || 0) > 0.5) {
    const wc = S.winCell || S.door;
    const pm = m4mul(
      m4t(wc.x + 0.5, 0.52, wc.y + 0.5),
      m4mul(m4rotY(GPU.portalYaw), m4rotX(Math.PI / 2))
    );
    const pulse = 0.7 + 0.3 * Math.sin(S.time * 3.1);
    const pb = Q.hdr ? 1.3 : 1;
    add(
      0,
      MESH.portal,
      chunk(pm, {
        emissive: 1,
        emMode: 2,
        flat: 1,
        flatCol: [1, 1, 1],
        emColor: [0.16 * pulse * pb, 0.95 * pulse * pb, 0.45 * pulse * pb]
      })
    );
  }
  if (S.monster && !S.caught) {
    /* поза монстра была посчитана РАНЬШЕ (до карты теней) — капсулы скелета и ткань
   плаща используют те же матрицы костей. */
    fkAll(GPU.rig, mPose, rootM);
    skinUp(SK.mon, null);
    add(
      0,
      { buf: bufRig, n: GPU.rig.total },
      chunk(IDENT, { flat: 1, flatCol: [0.045, 0.038, 0.062], rim: 1 })
    );
    /* плащ — верле-ткань поверх ног */
    skirtSim(S, dt, mPose, GPU.rig, S.mYaw || 0);
    const nSk = skirtBuild(GPU.rig);
    if (nSk > 0) {
      dev.queue.writeBuffer(bufSkirt, 0, GPU.skirtArr.subarray(0, nSk * 9));
      add(
        0,
        { buf: bufSkirt, n: nSk },
        chunk(rootM, { flat: 1, flatCol: [0.045, 0.038, 0.062], rim: 1 })
      );
    }
    const hm = GPU.rig.B[GPU.rig.idx.hd].m;
    const eyeB = Q.hdr ? 1.5 : 1;
    for (const ex of [-0.03, 0.03]) {
      add(
        0,
        MESH.eye,
        chunk(m4mul(hm, m4t(ex, 0.095, 0.06)), {
          emissive: 1,
          emMode: 1,
          flat: 1,
          emColor: [1.0 * eyeB, 0.16 * eyeB, 0.08 * eyeB]
        })
      );
    }
  }
  /* =============== ПЕРСОНАЖ ================
   Тело: мировая матрица (позиция игрока + рыскание + опора на пол).
   Вьюмодель: тот же риг, root = invView·VM_FRAME, торс и голова скрыты.
   Манекен: в стартовой комнате, перебирает клипы, отражается в лужах. */
  /* bodyP уже посчитан выше — для камеры (один вызов playerPose на кадр). dy
   остаётся в единицах рига, в m4t bodyP.dy*PL_SCALE попадает ровно один раз. */
  const bYaw = -(S.pYawVis === undefined ? S.ang : S.pYawVis) - Math.PI / 2;
  fkAll(
    GPU.plRig,
    bodyP.pose,
    m4mul(m4t(S.px, bodyP.dy * PL_SCALE, S.py), m4mul(m4rotY(bYaw), m4sc(PL_SCALE)))
  );
  skinUp(SK.body, null);
  /* кисти тела ДО того, как риг перезапишется вьюмоделью: предметы для отражения и
   третьего лица */
  const bodyMh = Float32Array.from(GPU.plRig.B[GPU.plRig.idx.haL].m);
  const bodyMhl = Float32Array.from(GPU.plRig.B[GPU.plRig.idx.haR].m);
  /* полный буфер рисуется всегда: csSkin схлопывает вершины скрытых костей в
   точку, такие треугольники не растеризуются — набор отрисовки не зависит от
   позы. noVM — фон главного меню: ни тела, ни рук в кадре нет. */
  const nBody = S.noVM ? 0 : GPU.plRig.total;
  /* начало луча — точная голова фонаря из матрицы кисти (после скиннинга);
   предмет в руке: третье лицо — в списке отрисовки мира (отражается в лужах),
   первое лицо — в проходе вьюмодели вместе с руками. */
  function refineFlashOrigin(Mh) {
    if (!flSt.on || !Mh) return;
    const kindNow =
      S.fl && S.fl.rl > 0
        ? 'flash'
        : S.inv && S.sel >= 0 && S.inv[S.sel]
          ? S.inv[S.sel].kind
          : null;
    if (kindNow !== 'flash') return;
    const FM = m4mul(Mh, GRIP_FLASH);
    let hx = FM[12] + FM[0] * FL_HEAD_X,
      hy = FM[13] + FM[1] * FL_HEAD_X,
      hz = FM[14] + FM[2] * FL_HEAD_X;
    /* НАЧАЛО ЛУЧА НЕ ВНУТРИ СТЕНЫ. Голова фонаря могла оказаться в кладке (кисть
   прижали позже головы / руки прижаты к стене / третье лицо у стены) — тогда марш
   окклюзии начинался внутри стены и свет гас ЦЕЛИКОМ. Зажимаем голову вдоль
   свободного луча камера→голова: луч всегда начинается в воздухе. */
    {
      const ddx = hx - camX,
        ddy = hy - camY,
        ddz = hz - camZ;
      const dl = Math.hypot(ddx, ddy, ddz);
      if (dl > 1e-4) {
        const nst = Math.max(2, Math.ceil(dl / 0.02));
        let freeT = 1;
        for (let q = 1; q <= nst; q++) {
          const tt = q / nst;
          if (blocked(S, camX + ddx * tt, camZ + ddz * tt) || camY + ddy * tt < 0.055) {
            freeT = (q - 1) / nst;
            break;
          }
        }
        if (freeT < 1) {
          let lo = freeT,
            hi = Math.min(1, freeT + 1 / nst);
          for (let i = 0; i < 8; i++) {
            const m2 = (lo + hi) * 0.5;
            if (blocked(S, camX + ddx * m2, camZ + ddz * m2) || camY + ddy * m2 < 0.055) hi = m2;
            else lo = m2;
          }
          const k2 = Math.max(0.02, lo * dl - 0.02) / dl;
          hx = camX + ddx * k2;
          hy = camY + ddy * k2;
          hz = camZ + ddz * k2;
        }
      }
    }
    FL_MAIN.o[0] = hx;
    FL_MAIN.o[1] = hy;
    FL_MAIN.o[2] = hz;
    FL_REFL.o[1] = -hy;
    put4(fMain + FO_FLASH, hx, hy, hz, flSt.I);
    put4(fVM + FO_FLASH, hx, hy, hz, flSt.I);
    if (fRefl) put4(fRefl + FO_FLASH, hx, -hy, hz, flSt.I);
  }
  /* РАССЕЯНИЕ СВЕТА ФОНАРЯ: маршируем лучом от головы до попадания
   (стена/пол/потолок); пятно попадания становится вторичным источником
   (flE/flF): непрямой свет заливает зону у пятна — руки, тело, кромки и углы вне
   конуса. Интенсивность — доля FL_BOUNCE_K от яркости луча с квадратичным спадом;
   нет попадания в радиусе — нет источника. Пятно также внедряется в поле
   облучённости (giInj). */
  let giX = 0,
    giZ = 0,
    giInj = 0;
  function refineFlashBounce() {
    let bx = 0,
      by = 0,
      bz = 0,
      bI = 0;
    const kindNow =
      S.fl && S.fl.rl > 0
        ? 'flash'
        : S.inv && S.sel >= 0 && S.inv[S.sel]
          ? S.inv[S.sel].kind
          : null;
    if (flSt.on && kindNow === 'flash') {
      const ox = FL_MAIN.o[0],
        oy = FL_MAIN.o[1],
        oz = FL_MAIN.o[2];
      const dx = flDir[0],
        dy = flDir[1],
        dz = flDir[2];
      const step = 0.06,
        n = Math.ceil(FL_RANGE / step);
      let tHit = -1,
        lo = 0,
        hi = 0;
      const hitAt = t => {
        const px = ox + dx * t,
          py = oy + dy * t,
          pz = oz + dz * t;
        return blocked(S, px, pz) || py < 0.02 || py > CEIL_H;
      };
      for (let q = 1; q <= n; q++) {
        const tt = q * step;
        if (hitAt(tt)) {
          lo = tt - step;
          hi = tt;
          tHit = tt;
          break;
        }
        tHit = -1;
      }
      /* бисекция границы попадания: позиция пятна непрерывна по повороту взгляда —
   непрямой свет не шагает квантом шага марша. */
      if (tHit > 0) {
        for (let i2 = 0; i2 < 12; i2++) {
          const m2 = (lo + hi) * 0.5;
          if (hitAt(m2)) hi = m2;
          else lo = m2;
        }
        tHit = Math.max(0.02, lo);
      }
      /* вблизи стены луч попадает в сантиметрах от головы лампы: грубый порог обрезал
   бы отскок и внедрение в GI СКАЧКОМ (свет резко умирал у стены). Точка пятна
   держится в 1 см от поверхности — источник остаётся непрерывным. */
      if (tHit > 0.015 && tHit < FL_RANGE - 1e-6) {
        const off = Math.min(0.1, Math.max(0, tHit - 0.01));
        bx = ox + dx * (tHit - off);
        by = oy + dy * (tHit - off);
        bz = oz + dz * (tHit - off);
        const an = 1 - tHit / FL_RANGE;
        bI = flSt.I * FL_BOUNCE_K * an * an;
      }
    }
    put4(fMain + FO_FLASH + 64, bx, by, bz, bI);
    put4(fVM + FO_FLASH + 64, bx, by, bz, bI);
    if (fRefl) put4(fRefl + FO_FLASH + 64, bx, -by, bz, bI);
    giX = bx;
    giZ = bz;
    giInj = bI > 0.001 ? bI * FL_GI_K : 0;
  }
  let heldVMList = [];
  let heldReflList = null;
  if (S.thirdPerson && nBody > 0) {
    for (const it of heldDraws(bodyMh, bodyMhl, flSt)) add(0, it[0], chunk(it[1], it[2]));
    refineFlashOrigin(bodyMh);
  } else if (nBody > 0) {
    /* первое лицо: тело отражается в лужах, вьюмодель с предметом — нет; без этого
   руки отражённого тела пусты («воздух в руке»). Предметы тела идут отдельным
   списком только в зеркальный проход — в основном они дублировали бы вьюмодель. */
    heldReflList = heldDraws(bodyMh, bodyMhl, flSt);
  }
  let nVM = 0;
  if (!S.thirdPerson && !S.noVM) {
    /* руки не проходят сквозь стены, двери и пол: для каждой кисти измеряем
   свободное расстояние вдоль луча камера→кисть и подтягиваем руки к телу. */
    if (S.vmTuckL === undefined) {
      S.vmTuckL = 0;
      S.vmTuckR = 0;
    }
    {
      /* Ограничивающий луч измеряется на «спокойной» позе (покачивание и усталость
   выключены, vmTuck=0): иначе подтяг двигал бы ту самую кисть, по которой
   измеряется, — петля обратной связи с усилением ~1/0.08 самовозбуждается (руки
   трясутся у стены). Спокойная поза непрерывна по движению камеры — цель подтяга
   плавная. */
      const cs = S._vmCalm || (S._vmCalm = {});
      const preSt = Object.assign({}, S, {
        vmTuckL: 0,
        vmTuckR: 0,
        bobA: 0,
        stam: 1,
        _exS: 0,
        _calm: 1,
        _actT: cs._actT,
        _actS: cs._actS,
        _grbS: cs._grbS
      });
      const pre = playerPoseFP(preSt, S.time);
      cs._actT = preSt._actT;
      cs._actS = preSt._actS;
      cs._grbS = preSt._grbS;
      const MM = fkChain(GPU.plRig, pre.pose, VM_FRAME, ['haL', 'haR', 'm3L', 'm3R']);
      /* луч измеряется от «спокойной» камеры (без дыхательного покачивания): иначе у
   стены свободное расстояние пульсирует на частоте раскачивания и руки трясутся
   даже стоя вплотную. */
      const iv = m4invView(look(S.px, eyeY0, S.py, S.ang, S.pitch || 0));
      const wp = m => [
        iv[0] * m[12] + iv[4] * m[13] + iv[8] * m[14] + iv[12],
        iv[1] * m[12] + iv[5] * m[13] + iv[9] * m[14] + iv[13],
        iv[2] * m[12] + iv[6] * m[13] + iv[10] * m[14] + iv[14]
      ];
      /* С фонарём в руке ограничивающий луч измеряется до ГОЛОВЫ лампы: труба
   выступает из кулака на ~13 см, и при плотном прижиме к стене начало луча не
   оказывается в кладке. */
      let flashHeadW = null;
      {
        const rlT = !!(S.fl && S.fl.rl > 0);
        const heldT =
          !rlT && !!(S.inv && S.sel >= 0 && S.inv[S.sel] && S.inv[S.sel].kind === 'flash');
        if (heldT && MM['haL']) {
          const HM = m4mul(MM['haL'], GRIP_FLASH);
          const px = iv[0] * HM[12] + iv[4] * HM[13] + iv[8] * HM[14] + iv[12];
          const py = iv[1] * HM[12] + iv[5] * HM[13] + iv[9] * HM[14] + iv[13];
          const pz = iv[2] * HM[12] + iv[6] * HM[13] + iv[10] * HM[14] + iv[14];
          const ax = iv[0] * HM[0] + iv[4] * HM[1] + iv[8] * HM[2];
          const ay = iv[1] * HM[0] + iv[5] * HM[1] + iv[9] * HM[2];
          const az = iv[2] * HM[0] + iv[6] * HM[1] + iv[10] * HM[2];
          const al = Math.hypot(ax, ay, az) || 1;
          flashHeadW = [
            px + (ax / al) * FL_HEAD_X * PL_SCALE,
            py + (ay / al) * FL_HEAD_X * PL_SCALE,
            pz + (az / al) * FL_HEAD_X * PL_SCALE
          ];
        }
      }
      const dtS = Math.min(0.05, Math.max(0.001, dt));
      for (const side of ['L', 'R']) {
        const hb = MM['m3' + side] || MM['ha' + side];
        if (!hb) continue;
        const hw = side === 'L' && flashHeadW ? flashHeadW : wp(hb); /* L — до головы фонаря */
        const dx = hw[0] - S.px,
          dz = hw[2] - S.py,
          dy = hw[1] - eyeY0;
        const dist = Math.hypot(dx, dy, dz);
        let free = dist + 0.5;
        const nstep = Math.max(2, Math.ceil(dist / 0.02));
        let a = 0,
          b = 1,
          hit = false;
        for (let q = 1; q <= nstep; q++) {
          const tt = q / nstep;
          if (blocked(S, S.px + dx * tt, S.py + dz * tt) || eyeY0 + dy * tt < 0.055) {
            a = (q - 1) / nstep;
            b = tt;
            hit = true;
            break;
          }
        }
        if (hit) {
          /* бисекция до 1e-3 — точка пересечения непрерывна по движению камеры и рук,
   поэтому подтяг не квантуется шагами по 2 см */
          for (let i = 0; i < 10; i++) {
            const m2 = (a + b) * 0.5;
            if (blocked(S, S.px + dx * m2, S.py + dz * m2) || eyeY0 + dy * m2 < 0.055) b = m2;
            else a = m2;
          }
          free = dist * b - 0.03;
        }
        const k = clp((free - 0.06) / Math.max(0.08, dist), 0, 1);
        const want = 1 - k;
        const cur = S['vmTuck' + side] || 0;
        /* ФНЧ убирает покадровое мерцание цели на границе, ограничение скорости не даёт
   цели дёргать руки; вместе — плотный прижим без тряски */
        const sk = 'vmTuckS' + side;
        let sm = S[sk] === undefined ? cur : S[sk];
        sm += (want - sm) * Math.min(1, dtS * 10);
        S[sk] = sm;
        S['vmTuck' + side] = cur + clp(sm - cur, -2.5 * dtS, 2.5 * dtS);
      }
    }
    const vmP = playerPoseFP(S, S.time);
    /* смотрим прямо — ноги не нужны (тело стоит ниже камеры); опустили взгляд — ноги
   честно появляются */
    const hideSet = (S.pitch || 0) > -0.35 ? GPU.hideFPl : GPU.plRig.hide;
    fkAll(GPU.plRig, vmP.pose, m4mul(m4invView(view), VM_FRAME));
    skinUp(SK.vm, hideSet);
    nVM = rigVisCount(GPU.plRig, hideSet);
    if (nVM > 0) {
      const Mh = Float32Array.from(GPU.plRig.B[GPU.plRig.idx.haL].m);
      const Mhl = Float32Array.from(GPU.plRig.B[GPU.plRig.idx.haR].m);
      heldVMList = heldDraws(Mh, Mhl, flSt);
      refineFlashOrigin(Mh);
    }
  }
  refineFlashBounce(); /* после уточнения начала луча — точка рассеяния пятна */
  /* ДАННЫЕ КАРТЫ ТЕНЕЙ (строит csShadow в compute ниже). Упаковка — ПОСЛЕ
   уточнения головы луча: марш окклюзии начинается в воздухе, а не в кладке.
   Капсулы: монстр → игрок → реквизит (порядок фиксируют nMon/nPl). */
  let cn = 0;
  for (const C of GPU.shCaps) {
    if (cn >= CAPS_MAX) break;
    const o7 = cn * 7;
    capsArr[o7] = C[0];
    capsArr[o7 + 1] = C[1];
    capsArr[o7 + 2] = C[2];
    capsArr[o7 + 3] = C[3];
    capsArr[o7 + 4] = C[4];
    capsArr[o7 + 5] = C[5];
    capsArr[o7 + 6] = C[6];
    cn++;
  }
  dev.queue.writeBuffer(bufCaps, 0, capsArr, 0, Math.max(7, cn * 7));
  const nMonC = Math.min(GPU.shCaps.nMon || 0, cn);
  const propsStartC = Math.min((GPU.shCaps.nMon || 0) + (GPU.shCaps.nPl || 0), cn);
  const segN = collectDoorSegs(S, segArr);
  dev.queue.writeBuffer(bufSegs, 0, segArr, 0, Math.max(4, segN * 4));
  lshArr.fill(0);
  lshArr.set(lampsArr.subarray(0, Math.min(lampsArr.length, SHL_MAX * 4)));
  lshArr[SHL_MAX * 4] = FL_MAIN.o[0];
  lshArr[SHL_MAX * 4 + 1] = FL_MAIN.o[1];
  lshArr[SHL_MAX * 4 + 2] = FL_MAIN.o[2];
  lshArr[SHL_MAX * 4 + 3] = flSt.I;
  lshArr[SHL_MAX * 4 + 4] = FL_RANGE;
  dev.queue.writeBuffer(bufLampSh, 0, lshArr);
  /* полосы теней: на слот — либо его список капсул (грязно), либо метка «чисто»
   (csShadow пропускает полосу, буфер хранит прошлый кадр) */
  const shAuxN = buildShadowAux(
    S,
    nSH,
    fshSlot,
    cn,
    nMonC,
    propsStartC,
    segN,
    shW,
    shRowsQ,
    FL_MAIN.o,
    flSt.I,
    lampsArr,
    GPU.gridStage,
    ncell
  );
  /* dataOffset/size в writeBuffer указываются В ЭЛЕМЕНТАХ ПРЕДСТАВЛЕНИЯ (не в
   байтах): shAuxN u32, а не shAuxN*4 — иначе на пресетах с shLamps≥16 запись
   уходила за размер буфера (OperationError «bytes to write is too large») */
  dev.queue.writeBuffer(bufShAux, 0, shAuxArr, 0, shAuxN);
  const shRowsTot = (nSH + (fshSlot >= 0 ? 1 : 0)) * shRowsQ;
  let nMan = 0;
  if (manOn && devOn) {
    const clip = mannequinClip(S);
    const mrate = GAIT_RATE[clip.name] || 3.0;
    /* манекен переключает клипы тем же кроссфейдом, что и игрок (0.34 с);
   автоцикл меняет клип каждые 4 с. */
    if (clip.name !== (S._mWant || clip.name)) {
      S._mPrev = S._mWant || clip.name;
      S._mPrevT0 = S._mT0 || S.time;
      S._mWant = clip.name;
      S._mT0 = S.time;
      S._mK = 0;
    } else S._mK = Math.min(1, (S._mK === undefined ? 0 : S._mK) + dt / 0.34);
    const mst = {
      bobA: clip.len < 0 && GAIT_RATE[clip.name] ? 1 : 0,
      animPhase: S.time * mrate,
      runK: clip.name === 'run' ? 1 : 0,
      stam: 1,
      pitch: 0,
      pAnimForce: clip.name,
      pAnimWant: clip.name,
      pAnimPrev: S._mPrev || null,
      pAnimK: S._mK === undefined ? 1 : S._mK,
      pAnimT0: S._mT0 || 0,
      pAnimPrevT0: S._mPrevT0 || 0,
      _snapB: S._mSnap || null
    };
    const mp = playerPose(mst, S.time);
    S._mSnap = mst._snapB || null;
    /* манекен уходит в соседнюю свободную клетку стартовой комнаты: не блокирует
   точку появления, и его удобно рассматривать */
    let mcx = S.start.x,
      mcy = S.start.y,
      mcGot = false;
    /* свободный сосед; комната старта — 1 клетка, иначе её дверной проём */
    for (const want of [0, 3]) {
      if (mcGot) break;
      for (const dd of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const cx2 = S.start.x + dd[0],
          cy2 = S.start.y + dd[1];
        if (
          cx2 >= 0 &&
          cy2 >= 0 &&
          cx2 < GPU.mapW &&
          cy2 < GPU.mapH &&
          S.grid[cy2 * GPU.mapW + cx2] === want
        ) {
          mcx = cx2;
          mcy = cy2;
          mcGot = true;
          break;
        }
      }
    }
    const mx = mcx + 0.5,
      my = mcy + 0.5;
    const mFace = S.time * 0.55; /* медленный поворот: модель видна со всех сторон */
    fkAll(
      GPU.plRig,
      mp.pose,
      m4mul(m4t(mx, mp.dy * PL_SCALE, my), m4mul(m4rotY(mFace), m4sc(PL_SCALE)))
    );
    skinUp(SK.man, null);
    nMan = GPU.plRig.total;
  }
  /* ореолы ламп — один инстанс-дроу на проход */
  glowN = 0;
  if (Q.glow && nL > 0) {
    for (let i = 0; i < nL; i++) {
      const I = lampsArr[i * 4 + 3];
      if (I <= 0.06) continue;
      const lx = lampsArr[i * 4],
        lz = lampsArr[i * 4 + 1];
      const dgx = lx - S.px,
        dgz = lz - S.py;
      const dist2 = dgx * dgx + dgz * dgz;
      if (dist2 > 256) continue;
      /* Ореол не подстраивается под взгляд и не умирает из-за угла: тест глубины сам
   честно обрезает его стеной. */
      const dcam = Math.sqrt(dist2 + 0.137);
      const o = glowN * 8;
      glowArr[o] = lx;
      glowArr[o + 1] = LAMP_Y;
      glowArr[o + 2] = lz;
      glowArr[o + 3] = Math.min(0.26 + 0.26 * I, 0.22 + 0.3 * dcam);
      glowArr[o + 4] = I * 0.6 * Q.glowK;
      glowArr[o + 5] = I * 0.48 * Q.glowK;
      glowArr[o + 6] = I * 0.34 * Q.glowK;
      glowArr[o + 7] = 0;
      glowN++;
    }
    if (glowN > 0) dev.queue.writeBuffer(bufGlowI, 0, glowArr, 0, glowN * 8);
  }
  /* ---- проходы ---- */
  const ENC = dev.createCommandEncoder();
  const fogClear = { r: FOGC[0], g: FOGC[1], b: FOGC[2], a: 1 };
  /* «промах» зеркального прохода (луч ушёл под пол) — мягкая тёмная вода, а не
   почти чёрный цвет тумана: выборки размытия не должны давать чёрный квадрат */
  const reflClear = { r: 0.03, g: 0.033, b: 0.04, a: 1 };

  /* ---------------- COMPUTE: поле света, тени, скиннинг ----------------
   Один проход на всё: диспатчи идут строго в порядке записи, поэтому csLmFinal
   оставляет карту света готовой до первого прохода растеризации, csShadow —
   карту теней, csSkin — вершинные буферы персонажа. */
  {
    const CP = ENC.beginComputePass();
    const ncellW = Math.ceil(ncell / 256);
    const oL = allocPP();
    put4(oL + PO_V0, GPU.mapW, GPU.mapH, AMBIENT, SC_FLOOR);
    put4(oL + PO_V1, giX, giZ, giInj, 0);
    CP.setBindGroup(0, bgCPP, [oL]);
    CP.setPipeline(plLmInit);
    CP.setBindGroup(1, bgLmAB);
    CP.dispatchWorkgroups(ncellW);
    CP.setPipeline(plLmIter);
    for (let it = 0; it < 6; it++) {
      CP.setBindGroup(1, it & 1 ? bgLmBA : bgLmAB);
      CP.dispatchWorkgroups(ncellW);
    }
    CP.setPipeline(plLmFinal);
    CP.setBindGroup(1, bgLmAB);
    CP.dispatchWorkgroups(ncellW);
    const oS = allocPP();
    put4(oS + PO_V0, shW, shRowsQ, nSH, fshSlot);
    put4(oS + PO_V1, LAMP_Y, DOOR_H, SH_EL0, SH_EL0 + SH_EL1);
    put4(oS + PO_V2, GPU.mapW, GPU.mapH, nMonC, propsStartC);
    put4(oS + PO_V3, segN, cn, LAMP_R, 0);
    CP.setBindGroup(0, bgCPP, [oS]);
    CP.setPipeline(plCSh);
    CP.setBindGroup(1, bgShLamp);
    CP.setBindGroup(2, bgShData);
    CP.dispatchWorkgroups(Math.ceil(shW / 8), Math.ceil(shRowsTot / 8));
    /* упаковка f32→биты half (r16float не пишется из compute в ядре WebGPU) */
    const pitchU = (shPitch / 4) | 0;
    const oP = allocPP();
    put4(oP + PO_V0, shW, shRowsTot, pitchU, 0);
    CP.setBindGroup(0, bgCPP, [oP]);
    CP.setPipeline(plPack);
    CP.setBindGroup(1, bgPack);
    CP.dispatchWorkgroups(Math.ceil((pitchU * shRowsTot) / 256));
    CP.setPipeline(plCSkin);
    const wgm = Math.ceil(GPU.rig.total / 256),
      wgp = Math.ceil(GPU.plRig.total / 256);
    if (S.monster && !S.caught) {
      CP.setBindGroup(0, SK.mon.bg);
      CP.dispatchWorkgroups(wgm);
    }
    CP.setBindGroup(0, SK.body.bg);
    CP.dispatchWorkgroups(wgp);
    if (nVM > 0) {
      CP.setBindGroup(0, SK.vm.bg);
      CP.dispatchWorkgroups(wgp);
    }
    if (nMan > 0) {
      CP.setBindGroup(0, SK.man.bg);
      CP.dispatchWorkgroups(wgp);
    }
    CP.end();
    /* биты half → карта теней r16float: шаг кратен 256 (требование копирования),
   копируются только активные строки (лампы + слот фонаря) */
    ENC.copyBufferToTexture(
      { buffer: bufShU16, offset: 0, bytesPerRow: shPitch },
      { texture: texSh },
      { width: shW, height: shRowsTot, depthOrArrayLayers: 1 }
    );
  }

  /* рисуем готовый буфер персонажа (вершины посчитаны csSkin).
   Тот же буфер обслуживает оба прохода: мировая матрица модели не меняется, а
   зеркальная камера прохода отражений сама даёт тело в лужах. */
  function drawRigBuf(pass, buf, count, frameOff, isRefl) {
    if (!GPU.plRig || count <= 0) return;
    const samples = isRefl ? 1 : GPU.msaa || 1;
    const pl = plOf('VM|' + samples + '|' + sceneFmt, {
      layout: worldLayout(),
      vertex: { module: modWorld, entryPoint: 'vsWorld', buffers: VBL_WORLD },
      fragment: { module: modWorld, entryPoint: 'fsWorld', targets: [{ format: sceneFmt }] },
      primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: samples }
    });
    pass.setPipeline(pl);
    pass.setBindGroup(0, bgW0, [frameOff]);
    pass.setBindGroup(1, bgW1, [oVM]);
    pass.setBindGroup(2, isRefl ? bgW2refl : bgW2main);
    pass.setVertexBuffer(0, buf);
    pass.draw(count, 1);
  }
  /* ПРЕДМЕТ В РУКЕ. Список [mesh, model, opt] из матриц костей кисти. Фонарь — в
   правой ('L'), батарейка замены — в левой ('R') в фазах «забрал севшую» и
   «вставляет новую». Матрицы — те самые, по которым скинится риг. */
  function heldDraws(Mh, Mhl, flSt2) {
    const L = [];
    if (!Mh) return L;
    const flS = S.fl;
    const rl = !!(flS && flS.rl > 0);
    const kind = rl ? 'flash' : S.inv && S.sel >= 0 && S.inv[S.sel] ? S.inv[S.sel].kind : null;
    if (kind === 'flash') {
      const fM = m4mul(Mh, GRIP_FLASH);
      L.push([MESH.flash, fM, { flat: 1, flatCol: [0.085, 0.09, 0.105], f3: [0, 0.85, 0, 0] }]);
      const b = flS.on && flSt2.on ? Math.max(0, Math.min(1.15, flSt2.I / FL_INTENSITY)) : 0;
      const cap = Q.hdr ? 1.5 : 0.85;
      if (b > 0.02)
        L.push([
          MESH.flashLens,
          fM,
          {
            emissive: 1,
            emMode: 1,
            flat: 1,
            emColor: [Math.min(cap, 1.25 * b), Math.min(cap, 1.06 * b), Math.min(cap, 0.78 * b)]
          }
        ]);
      else
        L.push([MESH.flashLens, fM, { flat: 1, flatCol: [0.14, 0.16, 0.18], f3: [0, 0.55, 0, 0] }]);
    } else if (kind === 'batt') {
      const sM = m4mul(Mh, GRIP_BATT);
      L.push([MESH.battBody, sM, { flat: 1, flatCol: [0.09, 0.09, 0.105], f3: [0, 0.75, 0, 0] }]);
      L.push([MESH.battBand, sM, { flat: 1, flatCol: [0.82, 0.62, 0.12], f3: [0, 0.25, 0, 0] }]);
    } else if (kind === 'key') {
      L.push([
        MESH.key,
        m4mul(Mh, GRIP_KEY),
        { flat: 1, flatCol: [0.95, 0.75, 0.25], f3: [0, 0.9, 0, 0] }
      ]);
    }
    if (rl && Mhl) {
      const u = (S.time - (flS.rlT0 || 0)) / RL_DUR;
      if (rlBattOld(u) || rlBattNew(u)) {
        const bM = m4mul(Mhl, GRIP_SMALL_L);
        L.push([MESH.battBody, bM, { flat: 1, flatCol: [0.09, 0.09, 0.105], f3: [0, 0.7, 0, 0] }]);
        L.push([MESH.battBand, bM, { flat: 1, flatCol: [0.82, 0.62, 0.12], f3: [0, 0.25, 0, 0] }]);
      }
    }
    return L;
  }
  /* дроу предмета вьюмодели — тот же конвейер, что и у рук (свой проход глубины);
   isRefl — зеркальный проход: 1 выборка и refl-набор текстур мира */
  function drawHeldVM(pass, list, frameOff, isRefl) {
    if (!list.length) return;
    const samples = isRefl ? 1 : GPU.msaa || 1;
    const pl = plOf('VM|' + samples + '|' + sceneFmt, {
      layout: worldLayout(),
      vertex: { module: modWorld, entryPoint: 'vsWorld', buffers: VBL_WORLD },
      fragment: { module: modWorld, entryPoint: 'fsWorld', targets: [{ format: sceneFmt }] },
      primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: samples }
    });
    pass.setPipeline(pl);
    pass.setBindGroup(0, bgW0, [frameOff]);
    pass.setBindGroup(2, isRefl ? bgW2refl : bgW2main);
    for (const it of list) {
      pass.setBindGroup(1, bgW1, [chunk(it[1], it[2])]);
      pass.setVertexBuffer(0, it[0].buf);
      pass.draw(it[0].n, 1);
    }
  }
  /* манекен: какой клип крутить. -1 = автоцикл по всем анимациям. */
  function mannequinClip(S) {
    const L = ANIM_CLIPS.length;
    if (S.manAnim !== undefined && S.manAnim !== null && S.manAnim >= 0)
      return ANIM_CLIPS[S.manAnim % L];
    const idx = Math.floor(S.time / 4.0) % L;
    return ANIM_CLIPS[idx];
  }
  function drawWorld(pass, frameOff, isRefl, frontFace) {
    const samples = isRefl ? 1 : GPU.msaa || 1;
    const plN = plWorld(frontFace, 'none', samples, sceneFmt);
    const plC = plWorld(frontFace, 'back', samples, sceneFmt);
    pass.setBindGroup(0, bgW0, [frameOff]);
    pass.setBindGroup(2, isRefl ? bgW2refl : bgW2main);
    let cur = null;
    for (let i = 0; i < WL.length; i += 3) {
      const mode = WL[i];
      if (isRefl && mode >= 2) continue; /* пол не рисуется в зеркальном проходе */
      const pl = mode & 1 ? plC : plN;
      if (pl !== cur) {
        pass.setPipeline(pl);
        cur = pl;
      }
      pass.setBindGroup(1, bgW1, [WL[i + 2]]);
      pass.setVertexBuffer(0, WL[i + 1].buf);
      pass.draw(WL[i + 1].n, 1);
    }
    if (Q.glow && glowN > 0) {
      const o = allocPP();
      putM(o + PO_M0, proj);
      putM(o + PO_M1, isRefl ? viewMir : view);
      put4(o + PO_V1, 0, 0, 0, Q.fog);
      put4(o + PO_V2, S.px, isRefl ? -camY : camY, S.py, 0);
      const pl = plOf('G|' + samples + '|' + sceneFmt, {
        layout: layoutOf([BGLS.pp, BGLS.glow]),
        vertex: { module: modOf(WGS_GLOW), entryPoint: 'vsG', buffers: VBL_GLOW },
        fragment: {
          module: modOf(WGS_GLOW),
          entryPoint: 'fsG',
          targets: [{ format: sceneFmt, blend: BL_ADD }]
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
        multisample: { count: samples }
      });
      pass.setPipeline(pl);
      pass.setBindGroup(0, bgPP, [o]);
      pass.setBindGroup(1, bgGlowEmpty);
      pass.setVertexBuffer(0, bufGlowQ);
      pass.setVertexBuffer(1, bufGlowI);
      pass.draw(6, glowN);
    }
  }
  /* проход 1 — зеркальная камера ниже пола: даёт лужам честное отражение.
   Пропускается целиком, если во вьюпорте нет луж (reflOn) */
  if (reflOn) {
    const p = ENC.beginRenderPass({
      colorAttachments: [
        { view: T.reflC.v, clearValue: reflClear, loadOp: 'clear', storeOp: 'store' }
      ],
      depthStencilAttachment: {
        view: T.reflD.v,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        depthClearValue: 1
      }
    });
    drawWorld(p, fRefl, true, 'cw');
    /* зеркальный проход: тело и манекен честно отражаются в лужах */
    if (nMan > 0) drawRigBuf(p, bufMan, nMan, fRefl, true);
    if (nBody > 0) drawRigBuf(p, bufPlRig, nBody, fRefl, true);
    if (heldReflList) drawHeldVM(p, heldReflList, fRefl, true); /* предмет в руке тела */
    p.end();
  }
  /* проход 2 — основной */
  const ms = GPU.msaa || 0;
  /* если дальше идёт проход вьюмодели, он сам повторно разрешает msC→scene —
   разрешение после основного прохода было бы лишней полноэкранной копией */
  const vmAfter = !!(ms && !S.thirdPerson && nVM > 0);
  const cd = {
    view: ms ? T.msC.v : T.scene.v,
    clearValue: fogClear,
    loadOp: 'clear',
    storeOp: 'store'
  };
  if (ms && !vmAfter) cd.resolveTarget = T.scene.v;
  const dd = {
    view: ms ? T.msD.v : T.depth.v,
    depthLoadOp: 'clear',
    depthStoreOp: ms ? 'discard' : 'store',
    depthClearValue: 1
  };
  if (ms) {
    dd.depthResolveFilter = 'nearest';
    dd.resolveTarget = T.depth.v;
  }
  const pMain = ENC.beginRenderPass({ colorAttachments: [cd], depthStencilAttachment: dd });
  drawWorld(pMain, fMain, false, 'ccw');
  /* основной проход: манекен + (тело в 3-м лице ИЛИ руки в 1-м) */
  if (nMan > 0) drawRigBuf(pMain, bufMan, nMan, fMain, false);
  if (S.thirdPerson) {
    if (nBody > 0) drawRigBuf(pMain, bufPlRig, nBody, fMain, false);
  }
  pMain.end();
  let volView = null;
  if ((Q.ssao | 0) > 0 && T.ao && ssaoK) {
    const aw = T.ao.w,
      ah = T.ao.h;
    const o = allocPP();
    putM(o + PO_M0, proj);
    put4(o + PO_V0, proj[0], proj[5], aw / 4, ah / 4);
    put4(o + PO_V1, zA, zB, Q.ssaoR || 0.42, 0.03);
    put4(o + PO_V2, (S.time * 7.31) % 1, view[1], view[5], view[9]);
    putF(o + PO_K, ssaoK);
    const bg = bgTexC('ao', BGLS.ao, [
      { binding: 0, resource: T.depth.v },
      { binding: 1, resource: sDep },
      { binding: 2, resource: V.texNoise },
      { binding: 3, resource: sNoise }
    ]);
    const pl = plPost('AO', modSsao, 'fsAO', BGLS.ao, 'r8unorm', null, 1);
    const pa = ENC.beginRenderPass({
      colorAttachments: [
        { view: T.ao.v, clearValue: { r: 1, g: 1, b: 1, a: 1 }, loadOp: 'clear', storeOp: 'store' }
      ]
    });
    fullDraw(pa, pl, o, bg);
    pa.end();
    /* двустороннее размытие с сохранением глубины */
    const o2 = allocPP();
    put4(o2 + PO_V0, 1 / aw, 0, zA, zB);
    const bgH = bgTexC('abH', BGLS.aoB, [
      { binding: 0, resource: T.ao.v },
      { binding: 1, resource: sLin },
      { binding: 2, resource: T.depth.v },
      { binding: 3, resource: sDep }
    ]);
    const pl2 = plPost('AB', WGS_AOBLUR, 'fsAB', BGLS.aoB, 'r8unorm', null, 1);
    const p2 = ENC.beginRenderPass({
      colorAttachments: [
        { view: T.ao2.v, loadOp: 'clear', clearValue: { r: 1, g: 1, b: 1, a: 1 }, storeOp: 'store' }
      ]
    });
    fullDraw(p2, pl2, o2, bgH);
    p2.end();
    const o3 = allocPP();
    put4(o3 + PO_V0, 0, 1 / ah, zA, zB);
    const bgV = bgTexC('abV', BGLS.aoB, [
      { binding: 0, resource: T.ao2.v },
      { binding: 1, resource: sLin },
      { binding: 2, resource: T.depth.v },
      { binding: 3, resource: sDep }
    ]);
    const p3 = ENC.beginRenderPass({
      colorAttachments: [
        { view: T.ao.v, loadOp: 'clear', clearValue: { r: 1, g: 1, b: 1, a: 1 }, storeOp: 'store' }
      ]
    });
    fullDraw(p3, pl2, o3, bgV);
    p3.end();
  }
  if ((Q.vol | 0) > 0 && T.volA) {
    const o = allocPP();
    putM(o + PO_M0, m4invView(view));
    put4(o + PO_V0, GPU.mapW, GPU.mapH, proj[0], proj[5]);
    put4(o + PO_V1, zA, zB, 7.0, (S.time * 3.77) % 1);
    const dw =
      Math.abs(wrapPi(S.ang - (GPU.pyaw === undefined ? S.ang : GPU.pyaw))) +
      Math.abs((S.pitch || 0) - (GPU.pyawp || 0));
    GPU.pyaw = S.ang;
    GPU.pyawp = S.pitch || 0;
    put4(o + PO_V2, Math.min(1, 0.45 + dw * 6), 0.055 * (Q.volK || 1), 0.22 * (Q.volK || 1), 0.02);
    const nv = Math.min(nL, 8);
    volArr.fill(0);
    volArr.set(lampsArr.subarray(0, nv * 4));
    put4(o + PO_V3, S.px, 0.55, S.py, nv);
    /* фонарь в объёмном свете — конус/дальность/яркость */
    put4(o + PO_V4, FL_MAIN.o[0], FL_MAIN.o[1], FL_MAIN.o[2], flSt.on ? flSt.I : 0);
    put4(o + PO_V5, flDir[0], flDir[1], flDir[2], FL_COS_OUT);
    put4(o + PO_V6, FL_COS_IN, FL_RANGE, 0, 0);
    putF(o + PO_K, volArr);
    const bg = bgTexC('vol' + volPhase, BGLS.vol, [
      { binding: 0, resource: T.depth.v },
      { binding: 1, resource: sDep },
      { binding: 2, resource: V.texLM },
      { binding: 3, resource: sLin },
      { binding: 4, resource: T.volB.v }
    ]);
    const pl = plPost('VL', modVol, 'fsV', BGLS.vol, sceneFmt, null, 1);
    const p = ENC.beginRenderPass({
      colorAttachments: [{ view: T.volA.v, loadOp: 'load', storeOp: 'store' }]
    });
    fullDraw(p, pl, o, bg);
    p.end();
    const done = T.volA;
    const swpA = T.volA;
    T.volA = T.volB;
    T.volB = swpA;
    volView = done.v;
    volPhase ^= 1;
  }
  /* проход вьюмодели: своя глубина (очищается) — руки поверх мира, своя проекция —
   не срезаются ближней плоскостью. vmTuck уводит руки от стен. */
  if (!S.thirdPerson && nVM > 0) {
    const pVM = ENC.beginRenderPass({
      colorAttachments: ms
        ? [{ view: T.msC.v, loadOp: 'load', storeOp: 'discard', resolveTarget: T.scene.v }]
        : [{ view: T.scene.v, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: {
        view: ms ? T.msDvm.v : T.vmD.v,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        depthClearValue: 1
      }
    });
    drawRigBuf(
      pVM,
      bufPlRigB,
      GPU.plRig.total,
      fVM,
      false
    ); /* полный буфер: скрытые кости вырождены csSkin */
    drawHeldVM(pVM, heldVMList, fVM, false); /* предмет в руке — поверх мира, как и руки */
    pVM.end();
  }
  let stkView = null,
    expView = null;
  if (Q.post && T.bl.length) {
    const o = allocPP();
    const bg0Entries = [
      { binding: 0, resource: T.scene.v },
      { binding: 1, resource: sLin }
    ];
    if (compB.bindings.vol !== undefined)
      bg0Entries.push({ binding: 2, resource: volView || V.texBlack });
    const bg0 = bgTexC(
      'br' + (compB.bindings.vol !== undefined ? volPhase : 'x'),
      compB.bindings.vol !== undefined ? BGLS.two : BGLS.one,
      bg0Entries
    );
    const pl0 = plPost(
      'BR' + ((Q.vol | 0) > 0 ? 1 : 0),
      modBright,
      'fsB',
      bg0Entries.length > 2 ? BGLS.two : BGLS.one,
      sceneFmt,
      null,
      1
    );
    const p0 = ENC.beginRenderPass({
      colorAttachments: [
        {
          view: T.bl[0].v,
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: 'store'
        }
      ]
    });
    fullDraw(p0, pl0, o, bg0);
    p0.end();
    const plD = plPost('DN', WGS_DOWN, 'fsD', BGLS.one, sceneFmt, null, 1);
    for (let i = 1; i < T.bl.length; i++) {
      const od = allocPP();
      put4(od + PO_V0, 1 / T.bl[i - 1].w, 1 / T.bl[i - 1].h, 0, 0);
      const bgd = bgTexC('dn' + i, BGLS.one, [
        { binding: 0, resource: T.bl[i - 1].v },
        { binding: 1, resource: sLin }
      ]);
      const pd = ENC.beginRenderPass({
        colorAttachments: [
          {
            view: T.bl[i].v,
            loadOp: 'clear',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            storeOp: 'store'
          }
        ]
      });
      fullDraw(pd, plD, od, bgd);
      pd.end();
    }
    const plU = plPost('UP', WGS_UP, 'fsU', BGLS.one, sceneFmt, BL_ADD, 1);
    for (let i = T.bl.length - 2; i >= 0; i--) {
      const ou = allocPP();
      put4(ou + PO_V0, 1 / T.bl[i + 1].w, 1 / T.bl[i + 1].h, 0, 0);
      const bgu = bgTexC('up' + i, BGLS.one, [
        { binding: 0, resource: T.bl[i + 1].v },
        { binding: 1, resource: sLin }
      ]);
      const pu = ENC.beginRenderPass({
        colorAttachments: [{ view: T.bl[i].v, loadOp: 'load', storeOp: 'store' }]
      });
      fullDraw(pu, plU, ou, bgu);
      pu.end();
    }
    if ((Q.flare | 0) > 0 && T.stk) {
      const os = allocPP();
      put4(os + PO_V0, 0.32, 0, 0, 0);
      const bgs = bgTexC('st', BGLS.one, [
        { binding: 0, resource: T.bl[0].v },
        { binding: 1, resource: sLin }
      ]);
      const plS = plPost('ST', WGS_STREAK, 'fsSt', BGLS.one, sceneFmt, null, 1);
      const ps = ENC.beginRenderPass({
        colorAttachments: [
          {
            view: T.stk.v,
            loadOp: 'clear',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            storeOp: 'store'
          }
        ]
      });
      fullDraw(ps, plS, os, bgs);
      ps.end();
      stkView = T.stk.v;
    }
    if (GPU.aexpOn && T.ed) {
      const oe = allocPP();
      put4(oe + PO_V0, 1 / RW, 1 / RH, 0, 0);
      const bge = bgTex(BGLS.one, [
        { binding: 0, resource: T.scene.v },
        { binding: 1, resource: sLin }
      ]);
      const pe = ENC.beginRenderPass({
        colorAttachments: [
          {
            view: T.ed.v,
            loadOp: 'clear',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            storeOp: 'store'
          }
        ]
      });
      fullDraw(pe, plD, oe, bge);
      pe.end();
      const oa = allocPP();
      put4(oa + PO_V0, Math.min(0.1, dt), 0.4, 0, 0);
      const bga = bgTex(BGLS.two, [
        { binding: 0, resource: T.ed.v },
        { binding: 1, resource: sLin },
        { binding: 2, resource: T.eb.v }
      ]);
      const plA = plPost('AD', WGS_ADAPT, 'fsAd', BGLS.two, sceneFmt, null, 1);
      const pa2 = ENC.beginRenderPass({
        colorAttachments: [
          {
            view: T.ea.v,
            loadOp: 'clear',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            storeOp: 'store'
          }
        ]
      });
      fullDraw(pa2, plA, oa, bga);
      pa2.end();
      expView = T.ea.v;
      const sw = T.ea;
      T.ea = T.eb;
      T.eb = sw;
    }
    const B = compB.bindings;
    const oc = allocPP();
    put4(oc + PO_V0, S.monster && S.mMode === 'chase' ? 1 : 0, S.time, Q.exposure, Q.bloomK);
    put4(oc + PO_V1, Q.ca, Q.grain, DARK_SAT, DARK_SAT_LO);
    put4(oc + PO_V2, Q.dither || 0, T.ao ? Q.ssaoK || 0.85 : 0, Q.grade || 0, Q.flareK || 0);
    const ce = [
      { binding: B.scene, resource: T.scene.v },
      { binding: B.bloom, resource: T.bl[0].v }
    ];
    if (B.ao !== undefined) ce.push({ binding: B.ao, resource: T.ao ? T.ao.v : V.texWhite });
    if (B.vol !== undefined) ce.push({ binding: B.vol, resource: volView || V.texBlack });
    if (B.stk !== undefined) ce.push({ binding: B.stk, resource: stkView || V.texBlack });
    if (B.exp !== undefined) ce.push({ binding: B.exp, resource: expView || V.texWhite });
    ce.push({ binding: B.samp, resource: sLin });
    const bgC = bgTexC('cp' + (B.vol !== undefined ? volPhase : 'x'), BGLS.comp, ce);
    const tgtFmt = T.L ? 'rgba8unorm' : ctxFmt;
    const plC = plPost('CP', compB.src, 'fsC', BGLS.comp, tgtFmt, null, 1);
    const pC = ENC.beginRenderPass({
      colorAttachments: [
        {
          view: T.L ? T.L.v : ctx.getCurrentTexture().createView(),
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: 'store'
        }
      ]
    });
    fullDraw(pC, plC, oc, bgC);
    pC.end();
    if (T.L) {
      const os2 = allocPP();
      put4(os2 + PO_V0, 1 / RW, 1 / RH, Q.sharp || 0, 0);
      const bgS = bgTexC('sh', BGLS.one, [
        { binding: 0, resource: T.L.v },
        { binding: 1, resource: sLin }
      ]);
      const plS2 = plPost('SH', WGS_SHARP, 'fsS', BGLS.one, ctxFmt, null, 1);
      const pS = ENC.beginRenderPass({
        colorAttachments: [
          {
            view: ctx.getCurrentTexture().createView(),
            loadOp: 'clear',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            storeOp: 'store'
          }
        ]
      });
      fullDraw(pS, plS2, os2, bgS);
      pS.end();
    }
  } else {
    const ob = allocPP();
    put4(ob + PO_V0, DARK_SAT, DARK_SAT_LO, Q.dither || 0, S.time);
    const bgB = bgTexC('bl', BGLS.one, [
      { binding: 0, resource: T.scene.v },
      { binding: 1, resource: sLin }
    ]);
    const plB = plPost('BL', WGS_BLIT, 'fsBl', BGLS.one, ctxFmt, null, 1);
    const pB = ENC.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: 'store'
        }
      ]
    });
    fullDraw(pB, plB, ob, bgB);
    pB.end();
  }
  ubFlush();
  dev.queue.submit([ENC.finish()]);
  /* счётчик честно отрисованных кадров — основа индикатора FPS (см. frame()) */
  try {
    dev.queue
      .onSubmittedWorkDone()
      .then(() => {
        GPU.framesDone = (GPU.framesDone || 0) + 1;
      })
      .catch(() => {});
  } catch (e) {}
};

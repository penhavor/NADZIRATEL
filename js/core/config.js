/* NADZIRATEL · WebGPU.
   Scale: 1 cell ~= 2.94 m; hero is exactly 1.80 m tall, ceiling 3.5 m, eyes
   at 1.62 m. Speeds are set in km/h and converted to cells/s via KMH().
   Player and Monitor gaits derive from equal Froude numbers (support foot
   does not slip); the first-person camera follows the actual model pose.
   Heavy frame stages (angular shadow map, skinning, irradiance field) run
   as compute. Layout: js/core/* = world/gameplay, js/gpu.js = models/poses/
   shaders/render, js/main/* = sound/input/UI/boot (load order — index.html). */
var CELL_M=2.94225;                     /* meters per cell: 1.773 rig * PL_SCALE 0.345 * CELL_M = exactly 1.80 m height */
var CEIL_H=3.5/CELL_M;                  /* ceiling/wall height in cells (3.5 m) */
var LAMP_Y=CEIL_H-0.10;                 /* lamp hangs from the ceiling (fixture pipe 0.10) */
var DOOR_H=CEIL_H-0.002;                /* door leaf reaches the ceiling (no gap above) */
function KMH(v){return v/3.6/CELL_M}   /* km/h -> cells/s */

/* Minimap: 8 independent toggles (on/unexp/mon/lamps/cabs/key/spawn/exit) */
var MAP_DEF={on:true,unexp:true,mon:false,lamps:true,cabs:true,key:false,spawn:true,exit:true};
function mapCfg(o){return Object.assign({},MAP_DEF,o)}
/* cabD = share of open cells that get a cabinet (1 = every cell);
   loot = % of cabinets with contents (the key occupies one of them);
   W/H = the GENERATED maze size (the grid adds the wall ring around it
   plus the spawn/exit rooms outside the ring) */
var PRESETS={
practice:  {W:8, H:8, monster:false,monsterSpeed:KMH(10),density:0.50,teleport:false,cabD:0.25,loot:100,map:mapCfg({mon:true,key:true})},
easy:      {W:16,H:16,monster:true, monsterSpeed:KMH(10),density:0.40,teleport:false,cabD:0.10,loot:75,map:mapCfg({mon:true,exit:false})},
medium:    {W:24,H:24,monster:true, monsterSpeed:KMH(15),density:0.30,teleport:false,cabD:0.05,loot:50,map:mapCfg({unexp:false,lamps:false,cabs:false,exit:false})},
hard:      {W:32,H:32,monster:true, monsterSpeed:KMH(20),density:0.20,teleport:true, cabD:0.05,loot:25,map:mapCfg({on:false,unexp:false,lamps:false,cabs:false,spawn:false,exit:false})},
extreme:   {W:32,H:32,monster:true, monsterSpeed:KMH(40),density:0.10,teleport:true, cabD:0.16,loot:10,map:mapCfg({on:false,unexp:false,lamps:false,cabs:false,spawn:false,exit:false})},
impossible:{W:64,H:64,monster:true, monsterSpeed:KMH(100),density:0.00,teleport:true,cabD:0.08,loot:4,map:mapCfg({on:false,unexp:false,lamps:false,cabs:false,spawn:false,exit:false})}};
/* TRUE DARKNESS: AMBIENT is nearly zero away from lamps; DARK_T = the
   "dark cell" threshold for the monster's shadow teleport */
const AMBIENT=0.02, LAMP_R=3.2, DARK_T=AMBIENT+0.06;
/* Visual floor for indirect light: in a closed maze bounces give a faint but
   NON-ZERO background. Feeds the lightmap only; gameplay s.light and DARK_T
   stay at AMBIENT */
var SC_FLOOR=0.055;
var DOOR_BG_K=1.0;      /* door albedo matches brick, no compensation needed (see doorSides) */

/* Speeds in km/h: crouch 2, walk 7 (Froude ceiling V^2/(g*L) = 0.42 vs 0.5
   at the run break), run 20. Monitor walk DERIVES from an equal Froude
   number: L_player = 0.9136 m, L_monster = 0.41 cells = 1.2063 m =>
   V = 7*sqrt(1.2063/0.9136) = 8.04 km/h. Gait geometry lives in MON_GAIT (gpu) */
var WALK_SP=KMH(7), RUN_SP=KMH(20);
var CROUCH_SP=KMH(2);
var MON_WALK=KMH(8.04);              /* derivation above; difficulty-independent */
/* load-order guard: the gpu script publishes window.MON_GAIT_K before the first frame */
var MON_K_FALLBACK={walk:8.3983,run:5.8798};

var QUALITY=(function(){
/* Params shared by all presets. Lighting and color grade are deliberately
   NOT here: identical on every preset (anti-cheat) — presets change QUALITY only */
const BASE={lamps:56,fog:0.0022,normals:true,hfog:true,bloomK:0.82,post:true,
pixelated:false,glow:true,exposure:1.02,glowK:0.18,aexp:0,grade:0.45,
/* Detail never degrades with the preset: procedural microdetails (cracks,
   dirt, streaks, soot, cobwebs) are always generated in full — only atlas
   and render resolution change */
det:1,micro:1,sdet:5,cav:true,ssr:1};
/* "Everything off" defaults; each preset overrides what it needs */
const OFF={tbn:false,pbr:false,detN:0,spec:false,hdr:false,msaa:0,
ssao:0,ssaoR:0,ssaoK:0,vol:0,volK:0,sharp:0,flare:0,flareK:0,
reflScale:0,pomRef:0};
/* Preset ladder: each step down is markedly cheaper for the GPU yet only
   slightly simpler to the eye. Shadows stay clean on ALL steps (16-tap PCF
   disk in the angular map) and the detail set is the same; render/atlas
   resolution, post sample counts and shadow map size degrade smoothly */
const P={
low:{name:'низкая',res:[640,400],atlas:256,aniso:2,dither:0.8,
nrmK:0.18,detN:0.36,pom:6,pomK:0.012,pomRef:0,far:70,propDist:16,
shSteps:96,shTaps:5,shRows:48,shLamps:8,
ssao:6,ssaoR:0.35,ssaoK:0.70,vol:6,volK:0.90,reflScale:0.35,reflTaps:3,
bloomLv:3,grain:0.020,ca:0.0018},
medium:{name:'средняя',res:[960,600],atlas:384,aniso:4,dither:1.0,msaa:4,hdr:true,
tbn:true,spec:true,pbr:true,nrmK:0.24,detN:0.46,pom:8,pomK:0.016,pomRef:2,
far:75,propDist:24,shSteps:160,shTaps:5,shRows:64,shLamps:12,
ssao:8,ssaoR:0.40,ssaoK:0.80,vol:8,volK:1.0,reflScale:0.40,reflTaps:4,
bloomLv:3,sharp:0.24,grain:0.018,ca:0.0020},
high:{name:'высокая',res:[1280,800],atlas:512,aniso:8,dither:1.0,msaa:4,hdr:true,
tbn:true,spec:true,pbr:true,nrmK:0.30,detN:0.52,pom:12,pomK:0.022,pomRef:3,
far:85,propDist:32,shSteps:256,shTaps:5,shRows:96,shLamps:16,
ssao:12,ssaoR:0.45,ssaoK:0.85,vol:12,volK:1.05,reflScale:0.50,reflTaps:6,
bloomLv:4,sharp:0.32,flare:1,flareK:0.45,grain:0.016,ca:0.0024},
ultra:{name:'эпическая',res:[1600,1000],atlas:1024,aniso:16,dither:1.0,msaa:4,hdr:true,
tbn:true,spec:true,pbr:true,nrmK:0.38,detN:0.62,pom:20,pomK:0.028,pomRef:4,
far:90,propDist:44,shSteps:384,shTaps:5,shRows:112,shLamps:20,
ssao:16,ssaoR:0.50,ssaoK:0.95,vol:16,volK:1.10,reflScale:0.65,reflTaps:8,
bloomLv:5,sharp:0.40,flare:1,flareK:0.55,grain:0.014,ca:0.0028},
/* experimental step: absolute maximum up to 8K render — for screenshots and
   benchmarks, not for playing (+1% picture, -1000% fps) */
max:{name:'максимальная',res:[7680,4320],atlas:2048,aniso:16,dither:1.0,msaa:4,hdr:true,
tbn:true,spec:true,pbr:true,nrmK:0.42,detN:0.70,pom:32,pomK:0.032,pomRef:8,
far:120,propDist:64,shSteps:512,shTaps:16,shRows:128,shLamps:32,
ssao:24,ssaoR:0.50,ssaoK:1.0,vol:32,volK:1.20,reflScale:1.0,reflTaps:16,
bloomLv:6,sharp:0.50,flare:1,flareK:0.60,grain:0.012,ca:0.0030}};
for(const k in P)P[k]=Object.assign({level:k},BASE,OFF,P[k]);
P.BASE=BASE;P.OFF=OFF;   /* defaults for the "custom" graphics profile constructor */
return P})();
var FOGC=[0.0078,0.0080,0.0086];
var DARK_SAT=0.14;
var DARK_SAT_LO=0.20;
var Q=QUALITY.ultra;
/* Graphics fingerprint: pipelines/textures rebuild only when ANY parameter
   changes (including individual knobs of the "custom" profile, not just the
   preset name). Only preset knobs are listed; constants (lighting, grade,
   lamp count, detail set) are identical everywhere and excluded */
const QSIG=['res','atlas','aniso','dither','msaa','hdr','tbn','spec','pbr','nrmK','detN','pom','pomK','pomRef','far','propDist','shSteps','shTaps','shRows','shLamps','ssao','ssaoR','ssaoK','vol','volK','reflScale','reflTaps','bloomLv','sharp','flare','flareK','grain','ca'];
function qSig(){return QSIG.map(k=>Q[k]).join(',')}
function gpuSigOf(seed,W,H){return seed+'_'+W+'x'+H+'_'+qSig()}

var RUN_NOISE=7.5;

/* ================ FLASHLIGHT / INVENTORY / CABINETS ================
 The flashlight is the player's only light source: a spotlight from the right
 hand strictly along the view. Dark cells outside its cone are the Monitor's
 territory (teleport in stepMonster). */
var FL_CAP=150;         /* seconds of continuous light per battery */
var FL_RANGE=7.0;        /* beam range, cells (~20 m — an honest handheld flashlight) */
var FL_COS_IN=0.965;     /* cone core cosine (~15°) — hotspot */
var FL_COS_OUT=0.80;     /* cone edge cosine (~37°) — side spill */
var FL_SPILL_R=1.8;      /* light "leaks backwards": cells within this radius of the player with the
 flashlight on are never counted dark (guards against point-blank teleport) */
var FL_INTENSITY=1.9;    /* beam brightness (a ceiling lamp gives I*0.85 ~= 0.85 for comparison) */
var FL_BOUNCE_K=0.34;    /* share of the beam turned into scatter off the spot (indirect light) */
var FL_BOUNCE_R=2.6;     /* secondary source radius from the spot, cells (~7.6 m) */
var FL_GI_K=0.45;        /* spot's share in the irradiance field: indirect flashlight light bends around corners */
var FL_MODEL_K=1.35;     /* flashlight model slightly oversized: head and body read better in hand */
var FL_HEAD_X=0.0958*FL_MODEL_K;   /* beam head along the scaled model's local X (lens lies in that plane) */
var FL_DIM_AT=0.20;      /* smooth brightness falloff threshold (20% charge) */
var RL_DUR=1.9;          /* battery swap animation duration, s */
var SW_DUR=0.70;         /* item switch (1-4): hand down with the old item, up with the new, s */
var PK_APPEAR=0.34;      /* pickup: item appears in hand at the pull apex, s */
var PK_DUR=0.75;         /* pickup: right-hand pull clip duration, s */
var TG_DUR=0.38;         /* button press animation duration, s */
var BATT_STACK=4;        /* batteries per inventory slot */
var INV_SLOTS=4;
var DARK_HALLU_T=10;     /* seconds in darkness before the first hallucination */
var HALLU_DARK_T=AMBIENT+0.02; /* "true" darkness for hallucinations: stricter than the teleport DARK_T —
 a slightly shaded lamp edge is not darkness yet */
var HALLU_GI_T=0.05;     /* diffuse-light threshold: a cell around the corner from a lamp still reads
 visually — hallucinations don't start there */
/* cabinet (cells): width 0.34 (~1.0 m), depth 0.18 (~0.53 m), height 0.30 (~0.88 m) */
var CAB_W=0.34, CAB_D=0.18, CAB_SLIDE=0.13, CAB_H=0.30;
/* interaction reach (E), meters -> cells: furniture/table/items use the
 radius to the object center; doors — distance to the leaf plane */
var REACH_OBJ=1.5/CELL_M, REACH_DOOR=2/CELL_M;
/* safe-room table (cells): 1.24 x 0.70 m, 0.75 m tall */
var TBL_W=0.42, TBL_D=0.24, TBL_H=0.255;

var MON_FOV=1.15, MON_PERIPH=0.9;
function wrapPi(a){while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a}

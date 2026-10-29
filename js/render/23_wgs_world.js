/* --- модуль мира: вершинный и фрагментный шейдеры в одном модуле --- */
function wgslWorld(QQ) {
  const NL = Math.max(1, QQ.lamps | 0);
  const SD = QQ.sdet | 0;
  const POM = (QQ.pom | 0) > 0 ? QQ.pom | 0 : 0;
  const REF = QQ.pomRef | 0;
  const TBN = !!QQ.tbn && !!QQ.normals;
  const SPEC = !!QQ.spec;
  const PBR = SPEC && !!QQ.pbr;
  const CAV = !!QQ.cav;
  const DET = SD >= 1;
  const NEEDMAT = SPEC;
  const SHW = QQ.shSteps | 0;
  const SHT = QQ.shTaps | 0;
  /* Геометрия карты теней из пресета: полосы подъёма, теневые лампы. Ширина
   полутени НЕ из пресета — она физическая (контактное уплотнение по расстоянию
   до блокера от карты) и одинаковая везде. */
  const SHROWS = Math.max(8, Math.min(SH_ROWS_MAX, QQ.shRows | 0));
  const SHTEXH = 64 * SHROWS;
  const SHL = Math.max(1, Math.min(64, QQ.shLamps | 0));
  const SPANX = SH_EL0 + SH_EL1;
  const RT = Math.max(3, QQ.reflTaps | 0);
  return `
${WGS_HELPERS}
struct FrameW{
proj:mat4x4<f32>,
view:mat4x4<f32>,
cam:vec4<f32>,
fogCol:vec4<f32>,
mapSize:vec4<f32>,
p1:vec4<f32>,
i1:vec4<u32>,
lamps:array<vec4<f32>,${NL}>,
flA:vec4<f32>,
flB:vec4<f32>,
flC:vec4<f32>,
flDv:vec4<f32>,
flE:vec4<f32>,
flF:vec4<f32>,
};
struct DrawW{
model:mat4x4<f32>,
emColor:vec4<f32>,
flatCol:vec4<f32>,
doorIO:vec4<f32>,
doorAxis:vec4<f32>,
f1:vec4<f32>,
f2:vec4<f32>,
f3:vec4<f32>,
pad:array<vec4<f32>,5>,
};
@group(0) @binding(0) var<uniform> F:FrameW;
@group(1) @binding(0) var<uniform> D:DrawW;
@group(2) @binding(0) var tTex:texture_2d<f32>;
@group(2) @binding(1) var tNrm:texture_2d<f32>;
@group(2) @binding(2) var tLM:texture_2d<f32>;
@group(2) @binding(3) var tHgt:texture_2d<f32>;
@group(2) @binding(4) var tPud:texture_2d<f32>;
@group(2) @binding(5) var tSh:texture_2d<f32>;
@group(2) @binding(6) var tRefl:texture_2d<f32>;
@group(2) @binding(7) var sAtl:sampler;
@group(2) @binding(8) var sLin:sampler;
@group(2) @binding(9) var sSh:sampler;
@group(2) @binding(10) var tSkin:texture_2d<f32>;
/* битовая маска ламп на клетку (2×u32): какие слоты F.lamps достают до клетки по
   радиусу — см. buildCellLightMask (CPU) */
@group(2) @binding(11) var<storage,read> CLT:array<vec2<u32>>;
var<private> gDx:vec2<f32>;
var<private> gDy:vec2<f32>;
var<private> gWx:vec3<f32>;
var<private> gWy:vec3<f32>;
fn sL(t:texture_2d<f32>,s:sampler,uv:vec2<f32>)->vec4<f32>{return textureSampleLevel(t,s,uv,0.0);}
fn sD(t:texture_depth_2d,s:sampler,uv:vec2<f32>)->f32{return textureSampleLevel(t,s,uv,0);}
fn sA(t:texture_2d<f32>,s:sampler,uv:vec2<f32>)->vec4<f32>{return textureSampleGrad(t,s,uv,gDx,gDy);}
struct VIn{ @location(0) aPos:vec3<f32>, @location(1) aUV:vec2<f32>, @location(2) aNrm:vec3<f32>, @location(3) aAO:f32 };
struct VOut{ @builtin(position) clip:vec4<f32>, @location(0) vW:vec3<f32>, @location(1) vUV:vec2<f32>,
@location(2) vN:vec3<f32>, @location(3) vAO:f32, @location(4) vClip:vec4<f32> };
@vertex fn vsWorld(i:VIn)->VOut{
var p=i.aPos;
if(D.f1.w>0.5){ p+=i.aNrm*sin(F.p1.x*2.3+i.aPos.y*5.0+i.aPos.x*3.0+i.aPos.z*3.0)*0.022*(0.35+i.aPos.y); }
let w=D.model*vec4<f32>(p,1.0);
let m3=mat3x3<f32>(D.model[0].xyz,D.model[1].xyz,D.model[2].xyz);
var o:VOut;
o.vW=w.xyz; o.vUV=i.aUV; o.vN=normalize(m3*i.aNrm); o.vAO=i.aAO;
o.clip=F.proj*F.view*w; o.vClip=o.clip;
return o; }
${DET ? sdWgsl(SD) : ''}
${NEEDMAT ? MAT_WGSL : ''}
${
  POM
    ? `
/* parallax occlusion: ray vs height-map intersection by a linear walk (${POM}
 steps) + interpolation. A flat surface (height = 1) is not displaced at all,
 so cell seams don't "ride off". UV is hard-clamped to its atlas square. */
fn pomUv(uv0:vec2<f32>,Vt:vec3<f32>,dAdd:f32)->vec2<f32>{
let qs=vec2<f32>(4.0,4.0);   /* сетка атласа 4×4: луч POM никогда не покидает свою плитку */
let lo=(floor(uv0*qs)+0.010)/qs;
let hi=(floor(uv0*qs)+0.990)/qs;
let Pm=clamp(Vt.xy/max(abs(Vt.z),0.25)*F.p1.z,vec2<f32>(-0.035),vec2<f32>(0.035));
let NN=${POM}.0;
let dUv=Pm/NN; let dD=1.0/NN;
var cuv=uv0; var cd=0.0;
var hv=sA(tHgt,sAtl,cuv).r-dAdd;
var ph=hv; var pd=0.0; var puv=cuv;
for(var i=0;i<${POM};i=i+1){
if(cd>=(1.0-hv)){break;}
ph=hv; pd=cd; puv=cuv;
cuv-=dUv; cd+=dD;
hv=sA(tHgt,sAtl,clamp(cuv,lo,hi)).r-dAdd;
}
${
  REF
    ? `for(var i=0;i<${REF};i=i+1){
let muv=(puv+cuv)*0.5; let md=(pd+cd)*0.5;
let mh=sA(tHgt,sAtl,clamp(muv,lo,hi)).r-dAdd;
if((1.0-mh)-md>0.0){puv=muv;pd=md;ph=mh;}else{cuv=muv;cd=md;hv=mh;}
}`
    : ''
}
let before=(1.0-ph)-pd; let after=(1.0-hv)-cd;
let den=before-after;
var t=0.0; if(den>1e-6){ t=clamp(before/den,0.0,1.0); }
return clamp(mix(puv,cuv,t),lo,hi);
}`
    : ''
}
${
  SHW
    ? `
/* lamp shadows — the HEIGHT angular map (r16float: ${SHW} columns × ${SHROWS}
 elevation bands per lamp). Depth — the HORIZONTAL distance to the occluder
 at 16-bit precision (in R8 the 3.7 cm quantum read as steps inside the
 penumbra). The penumbra is physical, grows with the blocker distance; on
 high/epic — PCF with a rotating golden-angle disk, disk radius = penumbra
 width. The v coordinate is clamped to the band of ITS OWN lamp — taps don't
 climb into the neighbor. */
fn shTap(uv:vec2<f32>,dxz:f32,pen:f32,RR:f32)->f32{
 return clamp((sL(tSh,sSh,uv).r*RR-dxz)/pen+1.0,0.0,1.0); }
fn shVisCore(pw:vec3<f32>,Lpos:vec3<f32>,RR:f32,li:f32,pix:vec2<f32>,srcR:f32)->f32{
let d3=Lpos-pw;
let dist=length(d3);
var u=atan2(d3.z,d3.x)*0.15915494+0.5;
let el=asin(clamp((pw.y-Lpos.y)/max(dist,1e-5),-1.0,1.0));   /* подъём луча источник->точка */
/* координата полосы НЕПРЕРЫВНА: тексел i соответствует в своём центре rf=i+0.5,
   поэтому rv ниже интерполирует между полосами билинейно (привязка к центру
   тексела убила бы вертикальный линейный фильтр и дала бы ступени на силуэте
   тени). */
let rf=clamp((el+${SH_EL0})*${(SHROWS / SPANX).toFixed(6)},0.5,${(SHROWS - 0.5).toFixed(1)});
let vLo=(li*${SHROWS}.0+0.5)/${SHTEXH}.0;
let vHi=(li*${SHROWS}.0+${(SHROWS - 0.5).toFixed(1)})/${SHTEXH}.0;
let rv=clamp((li*${SHROWS}.0+rf)/${SHTEXH}.0,vLo,vHi);
let dxz=length(d3.xz);   /* карта горизонтальная */
/* ФИЗИЧЕСКАЯ ПОЛУТЕНЬ — контактное уплотнение по расстоянию до блокера: карта
   хранит расстояние до окклюдера (bd0), gap = насколько точка дальше; pen =
   R_light·gap/bd0, R_light = 0.16 клетки — радиус рассеивателя (~47 см), честный
   протяжённый источник. На контакте тень почти резкая, вдали полутень растёт
   линейно. Пол AA (1.25 тексела + 2 см) не даёт краю крошиться. Одна физика на
   все пресеты. */
let bd0=sL(tSh,sSh,vec2<f32>(u,rv)).r*RR;
let gap=max(dxz-bd0,0.0);
let penAA=6.2831853*max(dxz,0.05)/${SHW}.0*1.25+0.007;
var pen=max(srcR*gap/max(bd0,0.20),penAA);
var vis=shTap(vec2<f32>(u,rv),dxz,pen,RR);
${
  SHT >= 5
    ? `let fA=1.0/${SHW}.0; let fR=1.0/${SHTEXH}.0;
/* 16-выборочный диск на всех пресетах: край тени честно усредняется по площади
   колонки карты (меньше выборок читается крапинками вдалеке). Радиус никогда не
   меньше 2 текселов: диск обязан перекрывать границу колонки карты. */
let radU=clamp(pen/max(6.2831853*max(dxz,0.05)*fA,1e-6),2.0,12.0)*fA;
let radV=clamp(pen/max(dist*${(SPANX / SHROWS).toFixed(6)},1e-6),1.5,8.0)*fR;
let rot=dhash21(pix)*6.2831853;
var acc=vis*0.24;
for(var k=0;k<16;k=k+1){
 let a=rot+f32(k)*2.3999632;
 let rr2=sqrt((f32(k)+0.5)/16.0);
 acc+=shTap(vec2<f32>(u+cos(a)*rr2*radU,clamp(rv+sin(a)*rr2*radV,vLo,vHi)),dxz,pen,RR)*0.0475;
}
vis=acc;`
    : SHT >= 3
      ? `let fA=1.0/${SHW}.0; let fR=1.0/${SHTEXH}.0;
let radU=clamp(pen/max(6.2831853*max(dxz,0.05)*fA,1e-6),2.0,9.0)*fA;
let radV=clamp(pen/max(dist*${(SPANX / SHROWS).toFixed(6)},1e-6),1.5,6.0)*fR;
let rot=dhash21(pix)*6.2831853;
var acc=vis*0.34;
for(var k=0;k<6;k=k+1){
 let a=rot+f32(k)*2.3999632;
 let rr2=sqrt((f32(k)+0.5)/6.0);
 acc+=shTap(vec2<f32>(u+cos(a)*rr2*radU,clamp(rv+sin(a)*rr2*radV,vLo,vHi)),dxz,pen,RR)*0.11;
}
vis=acc;`
      : SHT > 1
        ? `let du=clamp(pen/max(6.2831853*max(dxz,0.05)/${SHW}.0,1e-6),2.0,4.0)/${SHW}.0;
vis=vis*0.5+shTap(vec2<f32>(u-du,rv),dxz,pen,RR)*0.25+shTap(vec2<f32>(u+du,rv),dxz,pen,RR)*0.25;`
        : ''
}
return vis; }
fn lampVis(pw:vec3<f32>,Lp:vec4<f32>,li:f32,pix:vec2<f32>)->f32{
return shVisCore(pw,vec3<f32>(Lp.x,${LAMP_Y},Lp.y),Lp.z,li,pix,0.16); }
/* тень фонаря — ТА ЖЕ карта высот, что у ламп (слот в flC.z), источник на высоте
   головы луча (бинарный марш по карте света съел бы углы и полосил скользящие
   стены). */
fn flShVis(pw:vec3<f32>,pix:vec2<f32>)->f32{
if(F.flC.z<0.0){return 1.0;}
return shVisCore(pw,F.flA.xyz,F.flC.y,F.flC.z,pix,0.05); }
`
    : ''
}
/* ФОНАРЬ ИГРОКА — прожектор из руки строго вдоль взгляда.
   flA = (позиция, яркость), flB = (направление, косинус края конуса),
   flC = (косинус ядра, дальность, слот тени), flDv = (цвет). Яркость и мерцание
   считает CPU (flA.w); окклюзия — та же карта теней, что у ламп. */
/* профиль конуса ВМЕСТЕ с короной рассеяния: линза не режет луч резко — за краем
   конуса широкий разлив, вблизи стена залита пятном с мягким спадом. На оси
   профиль = 1 — вид вдаль не меняется. */
fn flProf(cs:f32)->f32{
let csm=max(cs,0.0);
let cone=sstep(F.flB.w,F.flC.x,csm);
let ring=0.16*sstep(F.flB.w*0.93,F.flB.w,csm);
let spill=0.58*csm*csm*csm*(1.0-cone);
/* свечение линзы и кольца головки: линза светит немного ВБОК и слабо назад-вбок
   (cs<0) — рука и стена у самого фонаря не чёрные. */
let leak=0.12*sstep(-0.25,0.05,cs)*(1.0-cone);
/* слабый всенаправленный свет (линза/корпус): за игроком остаётся тусклый свет,
   гаснущий с расстоянием как у лампы — без ступеней. */
let omni=0.07*(1.0-cone);
return 0.10+0.90*cone+ring+spill+leak+omni;
}
fn flashAtt(pw:vec3<f32>)->f32{
if(F.flA.w<=0.001){return 0.0;}
let dv=pw-F.flA.xyz;
let dist=length(dv);
if(dist>F.flC.y){return 0.0;}
let cs=dot(dv/max(dist,1e-4),F.flB.xyz);
var att=1.0-dist/F.flC.y; att*=att;
att*=dist/(dist+0.45);   /* спад вблизи: не выбеливает в упор, после 3 м −<13% */
return F.flA.w*att*flProf(cs);
}
/* РАССЕЯНИЕ СВЕТА ФОНАРЯ: пятно попадания луча — вторичный источник,
   flE=(позиция, яркость), flF=(цвет, радиус), затухание квадратичное к радиусу.
   Без него вблизи стены рука и края луча тонули в черноте. Окклюзия обоих
   источников — общая карта теней фонаря (flShVis). */
fn flBounceAtt(pw:vec3<f32>)->f32{
if(F.flE.w<=0.001){return 0.0;}
let dv=pw-F.flE.xyz;
let dist=length(dv);
if(dist>F.flF.w){return 0.0;}
var a=1.0-dist/F.flF.w; a*=a;
return F.flE.w*a; }
@fragment fn fsWorld(in:VOut)->@location(0) vec4<f32>{
/* производные берутся ДО любых ветвлений: dpdx/dpdy в WGSL разрешены только в
   однородном потоке управления */
gDx=dpdx(in.vUV); gDy=dpdy(in.vUV);
gWx=dpdx(in.vW); gWy=dpdy(in.vW);
let uTime=F.p1.x; let uNrmK=F.p1.y; let uDetN=F.p1.w;
let uSeedI=F.i1.x;
let uCam=F.cam.xyz; let uFogDen=F.cam.w; let uFogCol=F.fogCol.xyz; let uMapSize=F.mapSize.xy;
let uEmissive=D.f1.x; let uEmMode=D.f1.y; let uFlat=D.f1.z;
let uRim=D.f2.x; let uDoorMode=D.f2.y; let uDoorMix=D.f2.z; let uDoorTex=D.f2.w;
let uReflOn=F.mapSize.w;
let uDoorIn=D.doorIO.xy; let uDoorOut=D.doorIO.zw; let uDoorAxis=D.doorAxis.xyz;
let vW=in.vW; let vUV=in.vUV; let vAO=in.vAO;
var Ng=normalize(in.vN);
/* створка рисуется без отсечения: видимая сторона ВСЕГДА со стороны камеры.
   На обратной грани нормаль переворачивается, иначе грань берёт карту света
   другой стороны и её вентиль по стороне гасит каждую реальную лампу — створка
   читается чёрной в освещённой комнате */
if(uDoorMode>0.5&&dot(Ng,uCam-vW)<0.0){Ng=-Ng;}
/* ЛАМПЫ КЛЕТКИ: вместо перебора всех слотов F.lamps — только те, чей радиус света
   достаёт до клетки пикселя (CPU строит маску раз в кадр). Для лампы вне маски
   dist>L.z в любой точке клетки — старый цикл всё равно её пропускал, поэтому свет
   идентичен, а итераций в разы меньше. */
var litL:array<i32,64>; var nLit=0u;
{
let ci=clamp(vec2<i32>(floor(vW.xz)),vec2<i32>(0),vec2<i32>(uMapSize)-vec2<i32>(1));
let mk=CLT[ci.y*i32(uMapSize.x)+ci.x];
var mw=mk.x;
while(mw!=0u&&nLit<64u){let b=countTrailingZeros(mw);mw=mw&(mw-1u);litL[nLit]=i32(b);nLit=nLit+1u;}
mw=mk.y;
while(mw!=0u&&nLit<64u){let b=countTrailingZeros(mw);mw=mw&(mw-1u);litL[nLit]=i32(b)+32;nLit=nLit+1u;}
}
/* грань стены берёт свет из клетки ПЕРЕД собой (сдвиг вдоль нормали) */
var lmP=vW.xz;
if(abs(Ng.y)<0.5){lmP+=Ng.xz*0.5;}
var lms=sL(tLM,sLin,clamp(lmP/uMapSize,vec2<f32>(0.001),vec2<f32>(0.999))).rg;
/* створка двери освещается по стороне: внешняя грань берёт свет коридора,
   внутренняя — свет комнаты. Смешивается uDoorMix: закрыта = 1, открыта = 0. */
var sideF=0.5;
if(uDoorMode>0.5){
let sd=dot(Ng,uDoorAxis);
if(sd>0.02){sideF=1.0;}else{ if(sd<-0.02){sideF=0.0;}else{sideF=0.5;} }
var dv=(uDoorIn+uDoorOut)*0.5;
if(sideF>0.75){dv=uDoorOut;}else{ if(sideF<0.25){dv=uDoorIn;} }
lms=mix(lms,dv,uDoorMix);
}
let gate=lms.g;
var col=vec3<f32>(0.0);
if(uRim>0.5){
/* Плоть Монитора (rim=1) и тело игрока (rim=2): альбедо из текстуры кожи +
   микрорельеф в мировом пространстве из её альфы (высота), потный блик, френель. */
let V=normalize(uCam-vW);
let sk4=sA(tSkin,sAtl,in.vUV);
let h0=sk4.a;
let hx=sA(tSkin,sAtl,in.vUV+gDx).a-h0;
let hy=sA(tSkin,sAtl,in.vUV+gDy).a-h0;
/* материалы тела игрока определяются u-зоной атласа кожи: кожа / куртка /
   штаны / ботинки / волосы — своя шероховатость, блик и рельеф. */
var mr=0.40; var ms=0.85; var mb=7.0;
let uu=in.vUV.x;
if(uu>0.700&&uu<0.848){mr=0.88;ms=0.22;mb=5.0;}
else if(uu>=0.848&&uu<0.918){mr=0.92;ms=0.16;mb=4.5;}
else if(uu>=0.918&&uu<0.968){mr=0.48;ms=0.70;mb=6.0;}
else if(uu>=0.968){mr=0.36;ms=1.05;mb=8.0;}
let isP=min(max(uRim-1.0,0.0),1.0);
let vAOx=mix(vAO,1.0,isP);   /* игрок не использует AO костей */
let Nb=normalize(Ng-(gWx*hx+gWy*hy)*mix(9.0,mb,isP));
let f=1.0-max(dot(Nb,V),0.0);
let fres=f*f*f;
/* Монитор — тёмный силуэт: иссохшая плоть почти чёрная, бледная кость
   (череп/зубы/кисти) по маске AO; текстура модулирует оба тона. */
let flesh=vec3<f32>(0.036,0.032,0.038)*(0.35+1.15*sk4.rgb);
let bone=vec3<f32>(0.36,0.32,0.26)*(0.50+0.95*sk4.rgb);
let skinM=mix(flesh,bone,sstep(0.50,0.85,vAO));
let skin=mix(skinM,sk4.rgb,isP);
/* тело светится ТАК ЖЕ, как мир: окружение карты света + прямой свет ламп */
col=skin*lms.r*0.20*vAOx;
if(isP>0.5){
/* персонаж не проваливается в черноту: полусферический заполняющий свет +
   мягкий свет со стороны камеры (лицо и кисти читаются в тёмном коридоре). */
col+=skin*vec3<f32>(0.052,0.060,0.078)*(0.55+0.45*Nb.y)*vAOx;
col+=skin*vec3<f32>(0.040,0.043,0.052)*max(dot(Nb,V),0.0)*vAOx;
col+=skin*lms.r*0.10*vAOx;
}
for(var jL=0u;jL<nLit;jL=jL+1){
let iL=litL[jL];
let L=F.lamps[iL];
if(L.w<=0.001){continue;}
let dl=vec3<f32>(L.x-vW.x,${LAMP_Y}-vW.y,L.y-vW.z);
let dist=length(dl);
if(dist>L.z){continue;}
var att=1.0-dist/L.z; att*=att;
let Ld=dl/dist;
let ndl=max(dot(Nb,Ld),0.0);
var lvS=1.0;
if(f32(iL)<${SHL}.5){lvS=lampVis(vW,L,f32(iL),in.clip.xy);}   /* и на теле — честная тень */
else{
/* тело не освещается сквозь стены дальними лампами */
let dqm=(vec2<f32>(L.x,L.y)-vW.xz)*(1.0/6.0);
for(var sm=1;sm<=5;sm=sm+1){
if(sL(tLM,sLin,clamp((vW.xz+dqm*f32(sm))/uMapSize,vec2<f32>(0.002),vec2<f32>(0.998))).b>0.5){lvS=0.0;break;}
}
}
col+=skin*L.w*att*(0.22+0.78*ndl)*vec3<f32>(1.0,0.90,0.74)*0.80*vAOx*lvS;
}
col+=vec3<f32>(0.20,0.22,0.27)*fres*mix(0.55,0.22,isP)*mix(1.0,0.45+ms,isP);
col+=vec3<f32>(0.34,0.04,0.03)*fres*fres*mix(0.50,0.10,isP);
let Hh=normalize(Nb+V+vec3<f32>(0.0,0.55,0.0));
col+=lms.r*pow(max(dot(Nb,Hh),0.0),mix(26.0,mix(90.0,14.0,mr),isP))*mix(0.10,0.10+0.30*ms,isP);
/* луч фонаря освещает тело/Монитора так же честно, как лампы — именно так его и
   находят в темноте (диффуз + потный блик) */
let flAt1=flashAtt(vW);
if(flAt1>0.001){
let flV1=flShVis(vW,in.clip.xy);
if(flV1>0.001){
let Lt1=normalize(F.flA.xyz-vW+vec3<f32>(1e-5,1e-5,1e-5));
let fnd1=max(dot(Nb,Lt1),0.0);
col+=skin*flAt1*flV1*(0.22+0.78*fnd1)*F.flDv.xyz*0.90*vAOx;
let Hh2=normalize(Nb+Lt1+vec3<f32>(1e-6,1e-6,1e-6));
col+=flAt1*flV1*pow(max(dot(Nb,Hh2),0.0),mix(26.0,mix(90.0,14.0,mr),isP))*mix(0.10,0.10+0.30*ms,isP)*F.flDv.xyz;
}
}
/* рассеяние пятна фонаря освещает тело/кисти: вблизи стены кисти получают мягкий
   непрямой свет. */
let bAt1=flBounceAtt(vW);
if(bAt1>0.001){
let bV1=flShVis(vW,in.clip.xy);
if(bV1>0.001){
let Lb1=normalize(F.flE.xyz-vW+vec3<f32>(1e-5,1e-5,1e-5));
let bnd1=max(dot(Nb,Lb1),0.0);
col+=skin*bAt1*bV1*(0.22+0.78*bnd1)*F.flF.xyz*0.90*vAOx;
}
}
}else{
/* текстурированный материал мира: не плоский цвет, не эмиссив, не створка двери */
let texMat=(uFlat<0.5&&uEmissive<0.5&&uDoorMode<0.5);
/* створки дверей (дерево и железо): рельеф (TBN+параллакс+полости) как у мира,
   но без детализации стен и луж — флаг ставит JS на leafChunk. */
let dtx=uDoorTex>0.5&&uFlat<0.5&&uEmissive<0.5;
${
  DET
    ? `var sdDet=SDOut(vec3<f32>(1.0),0.0,0.0,vec2<f32>(0.0),0.0,0.0);
if(texMat){sdDet=surfDetail(vW,Ng,vUV,uSeedI);}`
    : ''
}
var uv=vUV;
var N=Ng;
${
  TBN || POM
    ? `var T=vec3<f32>(0.0); var B=vec3<f32>(0.0);
if(texMat||dtx){
let dp1=gWx; let dp2=gWy;
let du1=gDx; let du2=gDy;
let det=du1.x*du2.y-du1.y*du2.x;
if(abs(det)>1e-9){
let iv=1.0/det;
T=(dp1*du2.y-dp2*du1.y)*iv;
B=(dp2*du1.x-dp1*du2.x)*iv;
let tl2=length(T); let bl2=length(B);
if(tl2>1e-4&&bl2>1e-4){T/=tl2;B/=bl2;}else{T=vec3<f32>(0.0);B=vec3<f32>(0.0);}
}
}`
    : ''
}
${
  POM
    ? `var uvC=uv; var nmS=vec3<f32>(0.0,0.0,1.0); var hS=0.0;
let Vw0=normalize(uCam-vW);
if((texMat||dtx)&&dot(T,T)>0.5){
let Vt=vec3<f32>(dot(Vw0,T),dot(Vw0,B),dot(Vw0,Ng));
if(Vt.z>0.02){uv=pomUv(vUV,Vt${DET ? ',sdDet.dep' : ',0.0'});}
/* Сторона рельефа (торец кирпича, стенка скола) — это крутой перепад высоты на
   тексел атласа: луч POM попадает в узкую краевую полосу, и её цвет растягивается
   вниз по стороне размытыми полосами. Крутые текселы берут цвет по развёрнутому
   UV: от края вверх по склону на глубину точки — плотность текселов совпадает с
   лицевой гранью. */
nmS=sA(tNrm,sAtl,uv).rgb*2.0-1.0;
hS=sA(tHgt,sAtl,uv).r;
let steep=smoothstep(0.30,0.62,dot(nmS.xy,nmS.xy));
if(steep>0.001){
let dUp=-nmS.xy/max(length(nmS.xy),1e-4);
let qS=vec2<f32>(4.0,4.0);
uvC=clamp(mix(uv,uv+dUp*(clamp(1.0-hS,0.0,1.0)*F.p1.z),steep),
(floor(uv*qS)+0.010)/qS,(floor(uv*qS)+0.990)/qS);
}
}
`
    : ''
}
var base=mix(sA(tTex,sAtl,${POM ? 'uvC' : 'uv'}).rgb,D.flatCol.xyz,uFlat);
var roughA=0.0;
var cav=1.0;
var rough=0.0; var f0=0.0; var metal=0.0; var specGate=0.0;
${
  DET
    ? `if(texMat){
let sd=sdDet;
base*=sd.colMul;
base*=mix(1.0,0.86,clamp(-sd.hgt,0.0,1.0));   /* полость (скол, разбитый кирпич) затемняет альбедо */
/* крошка внутри полости: множитель поверх базы (темнее поверхности, с зерном) —
   сохраняет тон грязи и окружения, не выскакивает ярким пятном */
base=mix(base,base*vec3<f32>(0.55,0.50,0.43)*(0.55+0.75*sdNoise(vec2<f32>(vW.x*91.0+vW.z*83.0+vW.y*57.0,vW.x*47.0+vW.z*59.0+vW.y*101.0),uSeedI+9513u)),clamp(sd.cav,0.0,1.0)*0.92);
roughA=sd.rough;
${
  TBN
    ? `if(dot(sd.sgrad,sd.sgrad)>1e-8){
var gW=vec3<f32>(0.0);
if(abs(Ng.y)>0.5){gW=vec3<f32>(sd.sgrad.x,0.0,sd.sgrad.y);}
else{ if(abs(Ng.x)>0.5){gW=vec3<f32>(0.0,sd.sgrad.y,sd.sgrad.x);}else{gW=vec3<f32>(sd.sgrad.x,sd.sgrad.y,0.0);} }
N=normalize(N-gW*uDetN);
}`
    : ''
}
}`
    : ''
}
${CAV ? `if(texMat||dtx){ ${POM ? `var hC=0.0; if(dot(T,T)>0.5){hC=hS;}else{hC=sA(tHgt,sAtl,uv).r;}` : `let hC=sA(tHgt,sAtl,uv).r;`} cav=mix(0.70,1.0,clamp(hC,0.0,1.0)); }` : ''}
${
  QQ.normals
    ? `if(uFlat<0.5){
${POM ? `var nm=vec3<f32>(0.0,0.0,1.0); if((texMat||dtx)&&dot(T,T)>0.5){nm=nmS;}else{nm=sA(tNrm,sAtl,uv).rgb*2.0-1.0;}` : `let nm=sA(tNrm,sAtl,uv).rgb*2.0-1.0;`}
${
  TBN
    ? `if(dot(T,T)>0.5){
let nmk=vec3<f32>(nm.xy*(uNrmK*3.2),nm.z);
N=normalize(T*nmk.x+B*nmk.y+N*max(nmk.z,0.05));
}else{ N=normalize(N+nm*uNrmK); }`
    : `N=normalize(N+nm*uNrmK);`
}
}`
    : ''
}
let Vv=normalize(uCam-vW);
/* край тени чистый на всех пресетах: вращающийся 16-выборочный диск PCF
   усредняет видимость по площади колонки угловой карты; меньше выборок квантуют
   край в видимые крапинки */
/* ЛУЖИ. Маска — отдельная «карта луж», генерируется по сиду, только пол. Вода
   tемнее бетона, зеркально уплощает нормаль + живая двухмасштабная рябь. Край
   лужи органический: маска слегка искажена процедурным шумом. */
var pud=0.0;
var wetRim=0.0;
if(texMat&&Ng.y>0.5&&vW.y<0.06){   /* лужи только на полу: стол и шкафы всегда сухие */
var pudUv=clamp(vW.xz/uMapSize,vec2<f32>(0.001),vec2<f32>(0.999));
${DET ? `pudUv+=(vec2<f32>(sdNoise(vW.xz*7.31+13.7,uSeedI+911u),sdNoise(vW.xz*7.97+71.3,uSeedI+977u))-0.5)*(0.12/uMapSize);` : ''}
let praw=sL(tPud,sLin,pudUv).r;
pud=sstep(0.18,0.42,praw);
if(praw>0.004){
let rim=sstep(0.02,0.14,praw)*(1.0-sstep(0.18,0.42,praw));
wetRim=rim;
let depW=clamp((praw-0.18)*2.4,0.0,1.0);            /* псевдоглубина воды */
base*=1.0-0.34*rim;                    /* мокрое кольцо темнее сухого пола */
base*=mix(1.0,mix(0.34,0.20,depW),pud);/* вода гасит диффуз: глубже — темнее */
base=mix(base,base*vec3<f32>(0.76,0.88,1.06),pud*(0.45+0.30*depW));   /* холодный оттенок, плотнее с глубиной */
roughA=mix(roughA,0.0,pud);
N=normalize(mix(N,vec3<f32>(0.0,1.0,0.0),0.94*pud));
/* живая вода: медленное зыбление + мелкая капиллярная волна (шесть волн на
   эпике). Амплитуда растёт с глубиной и гаснет у края — спокойный мениск. */
let wAmp=(0.026+0.040*depW)*pud*sstep(0.20,0.44,praw);
var sl=vec2<f32>(0.0);
sl+=vec2<f32>( 0.62, 0.78)*cos(vW.x*3.10+vW.z*2.20+uTime*1.05)*0.55;
sl+=vec2<f32>(-0.74, 0.31)*cos(vW.x*1.70-vW.z*4.30-uTime*0.78)*0.40;
sl+=vec2<f32>( 0.22,-0.94)*cos(vW.x*5.90+vW.z*1.30+uTime*1.62)*0.30;
sl+=vec2<f32>( 0.91, 0.44)*cos(vW.x*8.70-vW.z*7.10-uTime*2.10)*0.20;
${
  (QQ.sdet | 0) >= 5
    ? `sl+=vec2<f32>(-0.53, 0.85)*cos(vW.x*13.30+vW.z*11.70+uTime*2.70)*0.12;
sl+=vec2<f32>( 0.77,-0.64)*cos(vW.x*17.10-vW.z*14.90-uTime*3.15)*0.08;`
    : ''
}
N=normalize(N+vec3<f32>(sl.x,0.0,sl.y)*wAmp);
}
}
${
  PBR
    ? `let mp=matOf(uv);
rough=clamp(mp.x+roughA*0.55,0.06,1.0);
f0=mp.y; metal=mp.z;
/* зеркальный блик физически есть только у металла, воды и мокрого бетона по лужам */
specGate=max(metal,max(pud,wetRim*0.5));
rough=mix(rough,0.06,pud);   /* гладкая как зеркало вода */
rough=mix(rough,0.26,wetRim*0.55);   /* мокрый бетон блестит шире */
f0=mix(f0,0.021,pud);
f0=mix(f0,0.03,wetRim*0.4);`
    : ''
}
${
  PBR
    ? `col=base*lms.r*0.20*vAO*cav*(1.0-0.55*metal);
{ /* френель окружения — слабая «плёнка» на скользящих углах (металл оживает) */
var frA=clamp(1.0-max(dot(N,Vv),0.0),0.0,1.0); frA*=frA; frA*=frA*frA;
col+=mix(vec3<f32>(f0),base*0.55+0.45,metal)*frA*lms.r*0.40*vAO*specGate; }`
    : `col=base*lms.r*0.20*vAO*cav;`
}
for(var jL=0u;jL<nLit;jL=jL+1){
let i=litL[jL];
let L=F.lamps[i];
if(L.w<=0.001){continue;}
let d=vec3<f32>(L.x-vW.x,${LAMP_Y}-vW.y,L.y-vW.z);
let dist=length(d);
if(dist>L.z){continue;}
var att=1.0-dist/L.z; att*=att;
let Ld=d/dist;
var g=gate;
if(uDoorMode>0.5&&uDoorMix>0.01){
/* лампа по другую сторону закрытой двери не освещает эту грань */
let ls=dot(vec3<f32>(L.x-vW.x,0.0,L.y-vW.z),uDoorAxis);
var onOut=0.0; if(ls>0.0){onOut=1.0;}
var okf=0.0;
if(abs(sideF-0.5)<0.01){okf=1.0;}else{ if(abs(onOut-sideF)<0.01){okf=1.0;} }
g*=mix(1.0,okf,uDoorMix);
}
if(f32(i)<${SHL}.5){g*=lampVis(vW,L,f32(i),in.clip.xy);}   /* тень бросают только ближние лампы — дальние (att≤2%) её всё равно не прочли бы */
else if(g>0.001){
/* Дальние лампы (без угловой карты пресета): честный марш с 5 выборками по
   каналу стен карты света (.b). Выборки внутри своей клетки пропускаются:
   створка двери стоит внутри сплошной клетки и иначе затеняла бы сама себя. */
let dqm=(vec2<f32>(L.x,L.y)-vW.xz)*(1.0/6.0);
let fcI=vec2<i32>(floor(vW.xz));
for(var sm=1;sm<=5;sm=sm+1){
let sp=vW.xz+dqm*f32(sm);
if(all(vec2<i32>(floor(sp))==fcI)){continue;}
if(sL(tLM,sLin,clamp(sp/uMapSize,vec2<f32>(0.002),vec2<f32>(0.998))).b>0.5){g=0.0;break;}
}
}
if(g<=0.001){continue;}
let nd=max(dot(N,Ld),0.0);
col+=base*L.w*att*(0.22+0.78*nd)*vec3<f32>(1.0,0.90,0.74)*0.80*g*vAO*cav${PBR ? '*(1.0-0.72*metal)' : ''};
/* плоские предметы (фонарь/батарейка/ключ в руке, на столе) получают честный
   узкий блик по D.f3.y — тёмный металл оживает под лампами */
if(uFlat>0.5&&D.f3.y>0.001){
let Hfl=normalize(Ld+Vv+vec3<f32>(1e-6,1e-6,1e-6));
col+=L.w*att*pow(max(dot(N,Hfl),0.0),96.0)*D.f3.y*1.1*g*vec3<f32>(1.0,0.93,0.82);
}
${
  PBR
    ? `{
/* честный микрофасет GGX: D — распределение, GV — коррелированная видимость
   Смита (точная, особенно на скользящих углах), F — френель Шлика */
let H=normalize(Ld+Vv+vec3<f32>(1e-6,1e-6,1e-6));   /* исключаем normalize(0)=NaN */
let nh=max(dot(N,H),0.0);
let nv=max(dot(N,Vv),1e-4);
var A=rough*rough; A*=A;
let DD=A/(3.14159265*pow(nh*nh*(A-1.0)+1.0,2.0)+1e-7);
let GV=2.0/max(nd*sqrt(nv*nv*(1.0-A)+A)+nv*sqrt(nd*nd*(1.0-A)+A),1e-5);
let hv=max(dot(H,Vv),0.0);
let om=1.0-hv; let om2=om*om;
let F0v=mix(vec3<f32>(f0),base*0.55+0.45,metal);
let FF=F0v+(vec3<f32>(1.0)-F0v)*(om2*om2*om);
col+=L.w*att*(DD*GV*nd)*FF*vec3<f32>(1.0,0.93,0.82)*g*vAO*specGate${CAV ? '*mix(1.0,cav,0.7)' : ''};
}`
    : ''
}
}
/* ФОНАРЬ — прожектор игрока: конус с мягким краем, спад по расстоянию, окклюзия
   стенами/закрытыми дверями через марш, вентиль по стороне створки (как у ламп),
   диффуз + блик по ветке материала. */
var flAt=flashAtt(vW);
if(flAt>0.001){
var flG=1.0;
if(uDoorMode>0.5&&uDoorMix>0.01){
let ls2=dot(vec3<f32>(F.flA.x-vW.x,0.0,F.flA.z-vW.z),uDoorAxis);
var onO2=0.0; if(ls2>0.0){onO2=1.0;}
var okf2=0.0;
if(abs(sideF-0.5)<0.01){okf2=1.0;}else{ if(abs(onO2-sideF)<0.01){okf2=1.0;} }
flG*=mix(1.0,okf2,uDoorMix);
}
if(flG>0.001){flG*=flShVis(vW,in.clip.xy);}
if(flG>0.001){
let Lt=normalize(F.flA.xyz-vW+vec3<f32>(1e-5,1e-5,1e-5));
let fnd=max(dot(N,Lt),0.0);
let fcl=F.flDv.xyz;
col+=base*flAt*flG*(0.25+0.75*fnd)*fcl*vAO*cav${PBR ? '*(1.0-0.72*metal)' : ''};
${
  PBR
    ? `{
let H3=normalize(Lt+Vv+vec3<f32>(1e-6,1e-6,1e-6));
let nh3=max(dot(N,H3),0.0);
let nv3=max(dot(N,Vv),1e-4);
var A3=rough*rough; A3*=A3;
let DD3=A3/(3.14159265*pow(nh3*nh3*(A3-1.0)+1.0,2.0)+1e-7);
let GV3=2.0/max(fnd*sqrt(nv3*nv3*(1.0-A3)+A3)+nv3*sqrt(fnd*fnd*(1.0-A3)+A3),1e-5);
let hv3=max(dot(H3,Vv),0.0);
let om3=1.0-hv3; let om32=om3*om3;
let F03=mix(vec3<f32>(f0),base*0.55+0.45,metal);
let FF3=F03+(vec3<f32>(1.0)-F03)*(om32*om32*om3);
col+=flAt*flG*(DD3*GV3*fnd)*FF3*fcl*specGate${CAV ? '*mix(1.0,cav,0.7)' : ''};
}`
    : ''
}
if(uFlat>0.5&&D.f3.y>0.001){
let Hf2=normalize(Lt+Vv+vec3<f32>(1e-6,1e-6,1e-6));
col+=flAt*flG*pow(max(dot(N,Hf2),0.0),96.0)*D.f3.y*1.25*fcl;
}
}
}
/* РАССЕЯНИЕ СВЕТА: пятно фонаря — вторичный источник; углы, кромки и стены вне
   конуса рядом с пятном получают мягкий непрямой свет. */
let bAt=flBounceAtt(vW);
if(bAt>0.001){
/* непрямой свет пятна не блокируется наглухо тенью луча: пол под столом и
   дверные проёмы получают мягкую подсветку, тень остаётся глубокой, но не чёрной
   дырой */
let bV=max(flShVis(vW,in.clip.xy),0.30);
if(bV>0.001){
let Lb=normalize(F.flE.xyz-vW+vec3<f32>(1e-5,1e-5,1e-5));
let bnd=max(dot(N,Lb),0.0);
col+=base*bAt*bV*(0.22+0.78*bnd)*F.flF.xyz*vAO*cav${PBR ? '*(1.0-0.72*metal)' : ''};
if(uFlat>0.5&&D.f3.y>0.001){
let Hb2=normalize(Lb+Vv+vec3<f32>(1e-6,1e-6,1e-6));
col+=bAt*bV*pow(max(dot(N,Hb2),0.0),96.0)*D.f3.y*0.9*F.flF.xyz;
}
}
}
/* лужа отражает окружение без тяжёлого SSR: френель по скользящему углу + свет
   потолка/ламп из карты света. Вне луж (pud=0) вклад строго нулевой. Френель
   считается от РЯБИ (блики дрожат), но заякорен на геометрический (смесь 50/50 +
   минимум 0.04) — лужа не может «растаять в сухой пол». */
if(pud>0.004){
let nvv=max(dot(N,Vv),0.0);
let nvv0=max(Vv.y,0.0);
/* НИКАКОГО pow с базой, которая может уйти в минус от округления (скалярное
   произведение нормированных векторов даёт 1+eps → pow(-eps,5) = NaN, а NaN в
   hdr-сцене отравляет мипы блума). Пятая степень считается умножением с
   предварительным зажимом. */
let oR=clamp(1.0-nvv,0.0,1.0); let oG=clamp(1.0-nvv0,0.0,1.0);
let frR=0.020+0.980*oR*oR*oR*oR*oR;
let frG=0.020+0.980*oG*oG*oG*oG*oG;
let frW=mix(frG,frR,0.5)*0.96+0.04;
col+=frW*pud*(0.025+0.12*lms.r)*vec3<f32>(0.70,0.80,0.95)*vAO;
/* плоскостное отражение (зеркальная камера) берётся по экранному UV пикселя —
   схема не зависит от угла обзора, отражение не может «исчезнуть». Рябь искажает
   UV, а дисковое размытие растёт с расстоянием, как на настоящей воде. */
if(uReflOn>0.5){
let ndc=in.vClip.xy/max(in.vClip.w,1e-4);
let ruv0=vec2<f32>(ndc.x*0.5+0.5,0.5-ndc.y*0.5)+N.xz*(0.008+0.026*(1.0-nvv0));
let rdist=distance(uCam,vW);
let rad=0.0010+0.00013*rdist*rdist;
let rot=dhash21(in.clip.xy)*6.2831853;
var rc=sL(tRefl,sLin,clamp(ruv0,vec2<f32>(0.002),vec2<f32>(0.998))).rgb*0.30;
for(var ti=1;ti<${RT};ti=ti+1){
let a=f32(ti)*2.3999632+rot;
let rr=rad*sqrt(f32(ti)/f32(${RT - 1}));
rc+=sL(tRefl,sLin,clamp(ruv0+vec2<f32>(cos(a),sin(a))*rr,vec2<f32>(0.002),vec2<f32>(0.998))).rgb*(0.70/${RT - 1}.0);
}
col+=pud*rc*(frW+0.02);   /* + немного окружения даже «сверху», как у настоящей воды */
}
}
if(uEmissive>0.5){
var m=base.r;
if(uEmMode>3.5){
/* диффузор: две трубки + мягкий край в ноль — силуэт без фасет */
let qe=abs(vUV-0.5)*2.0;
let ee=max(qe.x,qe.y);
var edge=1.0-sstep(0.45,0.99,ee);
edge*=edge;
let tub=exp(-pow((abs(vUV.y-0.5)-0.17)/0.14,2.0));
let hot=exp(-ee*ee*2.2);
m=edge*(0.30+0.92*tub)+0.35*hot*edge;
}else{ if(uEmMode>1.5){
let r=length(vUV-0.5)*2.0;
let ring=sstep(0.55,0.70,r)*(1.0-sstep(0.85,1.0,r));
m=(0.35+0.9*ring)*(0.85+0.15*sin(uTime*2.2))*sstep(1.05,0.9,r);
}else{ if(uEmMode>0.5&&uEmMode<1.5){ m=1.0; } } }
col=D.emColor.xyz*m;
}
}
let dd=distance(uCam,vW);
var fog=1.0-exp(-uFogDen*dd*dd);
${
  QQ.hfog
    ? `if(uRim<0.5&&uEmissive<0.5&&uFlat<0.5){
var yk=1.0-clamp(vW.y,0.0,1.0); yk*=yk;
fog+=0.30*yk*(1.0-exp(-uFogDen*dd*dd*9.0))*(1.0-fog);
}`
    : ''
}
col=mix(col,uFogCol,clamp(fog,0.0,1.0));
return vec4<f32>(col,1.0);
}`;
}

const WGS_HELPERS = `
fn sstep(a:f32,b:f32,x:f32)->f32{ let t=clamp((x-a)/(b-a),0.0,1.0); return t*t*(3.0-2.0*t); }
fn dhash21(p:vec2<f32>)->f32{ return fract(sin(dot(p,vec2<f32>(12.9898,78.233)))*43758.5453); }
`;

/* общий юниформ-блок для всех полноэкранных и инстанс-проходов (по одному на
   конвейер) */
const WGS_PP = `
struct PP{
m0:mat4x4<f32>,
m1:mat4x4<f32>,
v0:vec4<f32>,
v1:vec4<f32>,
v2:vec4<f32>,
v3:vec4<f32>,
v4:vec4<f32>,
v5:vec4<f32>,
v6:vec4<f32>,
v7:vec4<f32>,
k:array<vec4<f32>,24>,
};
@group(0) @binding(0) var<uniform> P:PP;
/* В WGSL textureSample (неявный LOD) разрешён только в однородном потоке
   управления, поэтому везде используем явные варианты: Level для одноуровневых
   текстур и Grad с заранее взятыми градиентами — для атласа с мипами. */
fn sL(t:texture_2d<f32>,s:sampler,uv:vec2<f32>)->vec4<f32>{return textureSampleLevel(t,s,uv,0.0);}
fn sD(t:texture_depth_2d,s:sampler,uv:vec2<f32>)->f32{return textureSampleLevel(t,s,uv,0);}
struct VF{ @builtin(position) pos:vec4<f32>, @location(0) uv:vec2<f32> };
@vertex fn vsFull(@location(0) aP:vec2<f32>)->VF{
var o:VF; o.uv=vec2<f32>(0.5+0.5*aP.x,0.5-0.5*aP.y); o.pos=vec4<f32>(aP,0.0,1.0); return o; }
`;

/* ==== COMPUTE-ШЕЙДЕРЫ ==== */
/* Скиннинг: матрицы FK костей считает CPU (они нужны геймплею: капсулы теней,
   предмет в руке, глаза, высота камеры), GPU преобразует вершины — по потоку на
   вершину. Скрытая кость не удаляет вершины, а схлопывает их в точку:
   треугольник вырождается и не растеризуется — раскладка буфера остаётся
   постоянной. */
const NB_MAX = 64; /* в риге игрока 52 кости — с запасом */
const WGS_SKIN = `
struct Bones{ m:array<mat4x4<f32>,${NB_MAX}>, hide:array<u32,${NB_MAX}> };
@group(0) @binding(0) var<storage,read> BN:Bones;
@group(0) @binding(1) var<storage,read> src:array<f32>;
@group(0) @binding(2) var<storage,read> bidx:array<u32>;
@group(0) @binding(3) var<storage,read_write> dst:array<f32>;
@compute @workgroup_size(256)
fn csSkin(@builtin(global_invocation_id) g:vec3<u32>){
 let n=arrayLength(&src)/9u;
 if(g.x>=n){return;}
 let i=g.x*9u; let b=bidx[g.x];
 if(BN.hide[b]!=0u){
  dst[i]=0.0;dst[i+1u]=0.0;dst[i+2u]=0.0;dst[i+3u]=0.0;dst[i+4u]=0.0;
  dst[i+5u]=0.0;dst[i+6u]=1.0;dst[i+7u]=0.0;dst[i+8u]=0.0; return; }
 let M=BN.m[b];
 let w=M*vec4<f32>(src[i],src[i+1u],src[i+2u],1.0);
 dst[i]=w.x; dst[i+1u]=w.y; dst[i+2u]=w.z;
 dst[i+3u]=src[i+3u]; dst[i+4u]=src[i+4u];
 let lv=mat3x3<f32>(M[0].xyz,M[1].xyz,M[2].xyz)*vec3<f32>(src[i+5u],src[i+6u],src[i+7u]);
 let ll=length(lv);
 if(ll>1e-9){ dst[i+5u]=lv.x/ll; dst[i+6u]=lv.y/ll; dst[i+7u]=lv.z/ll; }
 else{ dst[i+5u]=0.0; dst[i+6u]=0.0; dst[i+7u]=0.0; }
 dst[i+8u]=src[i+8u];
}`;

/* Поле облучённости (карта света): свет ламп диффундирует по открытым клеткам
   (6 итераций Якоби) + пятно фонаря внедряется билинейно по 4 клеткам —
   непрямой свет загибается за углы. Поле в мировом пространстве: яркость стен не
   меняется от поворота камеры. Финал пишет карту света (rgba8). */
const WGS_LM = `
${WGS_PP}
@group(1) @binding(0) var<storage,read> lg:array<f32>;
@group(1) @binding(1) var<storage,read> grid:array<u32>;
@group(1) @binding(2) var<storage,read_write> scA:array<f32>;
@group(1) @binding(3) var<storage,read_write> scB:array<f32>;
@group(1) @binding(4) var outLM:texture_storage_2d<rgba8unorm,write>;
fn cOpen(i:i32,W:i32,H:i32,x:i32,y:i32)->bool{
 if(x<0||y<0||x>=W||y>=H||i<0){return false;}
 let gv=grid[i]; let v=gv&3u;
 return v==0u||(v==3u&&(gv&4u)!=0u); }
@compute @workgroup_size(256)
fn csLmInit(@builtin(global_invocation_id) g:vec3<u32>){
 let W=i32(P.v0.x); let H=i32(P.v0.y);
 if(g.x>=u32(W*H)){return;}
 let i=i32(g.x); let x=i%W; let y=i/W;
 let op=cOpen(i,W,H,x,y);
 var v=0.0;
 if(op){ v=max(0.0,lg[i*2]-P.v0.z); }
 let inj=P.v1.z;
 if(inj>0.0&&op){
  let i0=i32(floor(P.v1.x)); let j0=i32(floor(P.v1.y));
  let fx=P.v1.x-f32(i0); let fz=P.v1.y-f32(j0);
  var w=0.0;
  if(x==i0&&y==j0){w=(1.0-fx)*(1.0-fz);}
  else{ if(x==i0+1&&y==j0){w=fx*(1.0-fz);}
  else{ if(x==i0&&y==j0+1){w=(1.0-fx)*fz;}
  else{ if(x==i0+1&&y==j0+1){w=fx*fz;} } } }
  v+=inj*w; }
 scA[i]=v; }
@compute @workgroup_size(256)
fn csLmIter(@builtin(global_invocation_id) g:vec3<u32>){
 let W=i32(P.v0.x); let H=i32(P.v0.y);
 if(g.x>=u32(W*H)){return;}
 let i=i32(g.x); let x=i%W; let y=i/W;
 if(!cOpen(i,W,H,x,y)){ scB[i]=scA[i]; return; }
 var ssum=0.0;
 if(cOpen(i-1,W,H,x-1,y)){ssum+=scA[i-1];}
 if(cOpen(i+1,W,H,x+1,y)){ssum+=scA[i+1];}
 if(cOpen(i-W,W,H,x,y-1)){ssum+=scA[i-W];}
 if(cOpen(i+W,W,H,x,y+1)){ssum+=scA[i+W];}
 scB[i]=scA[i]+0.55*ssum*0.25; }
@compute @workgroup_size(256)
fn csLmFinal(@builtin(global_invocation_id) g:vec3<u32>){
 let W=i32(P.v0.x); let H=i32(P.v0.y);
 if(g.x>=u32(W*H)){return;}
 let i=i32(g.x); let x=i%W; let y=i/W;
 let op=cOpen(i,W,H,x,y);
 let D0=select(0.0,max(0.0,lg[i*2]-P.v0.z),op);
 var add=0.0;
 if(op){ add=max(0.0,scA[i]-D0)*clamp(1.0-D0/0.20,0.0,1.0); }
 var lv=lg[i*2];
 if(op){ lv=max(P.v0.w,min(1.0,lg[i*2]+add)); }
 else if((grid[i]&3u)==3u){ lv=max(lv,P.v0.w); }   /* косяки ниши берут фон из клетки закрытой двери (грани смещают выборку в неё) —
   без пола ниша чёрная */
 let gv=grid[i]; let v=gv&3u;
 let wB=select(0.0,1.0,(v==1u||v==2u||(v==3u&&(gv&4u)==0u)));
 textureStore(outLM,vec2<i32>(x,y),vec4<f32>(clamp(lv,0.0,1.0),clamp(lg[i*2+1],0.0,1.0),wB,1.0)); }`;

/* Карта теней на GPU: по потоку на тексел (колонка = азимут, строка = полоса
   подъёма своего источника). Марш по стенам — шаг Ri/24 с точным входом в слой;
   дверь — пересечение луча с отрезком створки (с проверкой высоты полосы);
   капсулы — rayCapsule. Фонарь проверяет монстра и реквизит, но НЕ игрока. */
const WGS_SHADOW = `
${WGS_PP}
struct Lamps{ l:array<vec4<f32>,${SHL_MAX}>, fl:vec4<f32>, fl2:vec4<f32> };
@group(1) @binding(0) var<storage,read> LP:Lamps;
/* lamp band: CL2[slot*${CAPS_MAX + 1}u] — 0xFFFFFFFF = "clean" (the input
didn't change since last frame — the thread exits, the buffer keeps the old
distances), else the band's occluder capsule count; then their indices (the
list is built by the CPU — the march doesn't scan all scene capsules, only
its own) */
@group(1) @binding(1) var<storage,read> CL2:array<u32>;
@group(2) @binding(0) var<storage,read> grid:array<u32>;
@group(2) @binding(1) var<storage,read> caps:array<f32>;
@group(2) @binding(2) var<storage,read> segs:array<f32>;
@group(2) @binding(3) var<storage,read_write> shOut:array<f32>;
fn rayCapsule(o:vec3<f32>,d:vec3<f32>,a:vec3<f32>,b:vec3<f32>,r:f32)->f32{
 let va=b-a; let wo=o-a;
 let bb=dot(d,va); let cc=dot(va,va); let d1=dot(d,wo); let e1=dot(va,wo);
 let den=cc-bb*bb;
 var t=0.0; var s=0.0;
 if(den<1e-8){ t=-d1; s=0.0; }
 else{ t=(bb*e1-cc*d1)/den; s=(e1-bb*d1)/den;
  if(s<0.0){s=0.0;t=-d1;}
  else{ if(s>1.0){s=1.0;t=bb-d1;} } }
 let p=o+d*t-(a+va*s);
 let q2=dot(p,p);
 if(q2>=r*r){return -1.0;}
 return t-sqrt(r*r-q2); }
@compute @workgroup_size(8,8,1)
fn csShadow(@builtin(global_invocation_id) g:vec3<u32>){
 let shW=u32(P.v0.x); let shRows=u32(P.v0.y);
 let nLamp=u32(P.v0.z); let flSlot=i32(P.v0.w);
 let rows=shRows*(nLamp+select(0u,1u,flSlot>=0));
 if(g.x>=shW||g.y>=rows){return;}
 let lampY=P.v1.x; let doorH=P.v1.y; let el0=P.v1.z; let span=P.v1.w;
 let mapW=i32(P.v2.x); let mapH=i32(P.v2.y);
 let nMon=u32(P.v2.z); let propsStart=u32(P.v2.w);
 let nSegs=u32(P.v3.x); let rDef=P.v3.z;
 let slot=g.y/shRows; let rI=g.y%shRows;
 let hdr=CL2[slot*${CAPS_MAX + 1}u];
 if(hdr==0xFFFFFFFFu){return;}   /* чистая полоса: буфер хранит расстояния прошлого кадра */
 var lx=0.0; var ly=0.0; var lz=0.0; var Ri=rDef; var srcI=0.0; let isFl=slot>=nLamp;
 if(!isFl){ let L=LP.l[slot]; srcI=L.w; lx=L.x; lz=L.y; ly=lampY;
  if(L.z>0.05){Ri=L.z;} }
 else{ srcI=LP.fl.w; lx=LP.fl.x; ly=LP.fl.y; lz=LP.fl.z; Ri=LP.fl2.x; }
 if(srcI<=0.05){ shOut[g.y*shW+g.x]=1.0; return; }
 let ang=(f32(g.x)+0.5)/f32(shW)*6.2831853;
 let ca=cos(ang); let sa=sin(ang);
 /* --- марш по стенам: фиксированный шаг, вход в клетку — ровно на границе слоя --- */
 var dep=Ri; var t=0.03; let step=Ri/24.0;
 loop{
  t+=step;
  if(t>=Ri){break;}
  let xi=i32(floor(lx+ca*t)); let zi=i32(floor(lz+sa*t));
  if(xi<0||zi<0||xi>=mapW||zi>=mapH){dep=t;break;}
  let gv=grid[zi*mapW+xi]; let v=gv&3u;
  if(v==1u||v==2u||(v==3u&&(gv&4u)==0u)){
   var tE=t-step;
   if(abs(ca)>1e-6){ let tx=(select(f32(xi+1),f32(xi),ca>0.0)-lx)/ca; if(tx>tE){tE=tx;} }
   if(abs(sa)>1e-6){ let tz=(select(f32(zi+1),f32(zi),sa>0.0)-lz)/sa; if(tz>tE){tE=tz;} }
   if(tE<t-step){tE=t-step;}
   if(tE>t){tE=t;}
   var tB=tE;
   if(v!=1u){
    /* дверная створка может стоять у ДАЛЬНЕЙ границы клетки (безопасная дверь
   снаружи): блокировка по ближней плоскости утопила бы створку в собственной
   тени. Клетка двери блокируется на выходе; отрезок даёт точную плоскость
   (dep=min). */
    tB=1e9;
    if(abs(ca)>1e-6){ let tx=(select(f32(xi),f32(xi+1),ca>0.0)-lx)/ca; if(tx<tB){tB=tx;} }
    if(abs(sa)>1e-6){ let tz=(select(f32(zi),f32(zi+1),sa>0.0)-lz)/sa; if(tz<tB){tB=tz;} }
    if(tB>1e8){tB=t;}
    if(tB<tE){tB=tE;}
   }
   dep=tB+0.005; break; }
 }
 /* --- дверная створка --- */
 var dd2=1e9;
 for(var k=0u;k<nSegs;k=k+1u){
  let ax=segs[k*4u]-lx; let az=segs[k*4u+1u]-lz;
  let ex=segs[k*4u+2u]-segs[k*4u]; let ez=segs[k*4u+3u]-segs[k*4u+1u];
  let det=ex*sa-ez*ca;
  if(det>-1e-6&&det<1e-6){continue;}
  /* t2 — расстояние ВДОЛЬ луча (ca,sa): знак числителя важен — ошибка в знаке
   разворачивает отрезок створки за источник и даёт «зеркальную» тень двери */
  let t2=(az*ex-ax*ez)/det; let s2=(ca*az-sa*ax)/det;
  if(s2>=0.0&&s2<=1.0&&t2>0.02&&t2<dd2){dd2=t2;}
 }
 let el=-el0+(f32(rI)+0.5)/f32(shRows)*span;
 let se=sin(el); let ce=cos(el);
 if(dd2<dep){ let h=ly+dd2*tan(el); if(h>0.0&&h<doorH){dep=dd2;} }
 /* --- капсулы скелета, плаща и реквизита: только из списка полосы --- */
 let o=vec3<f32>(lx,ly,lz); let d=vec3<f32>(ce*ca,se,ce*sa);
 for(var k=0u;k<hdr;k=k+1u){
  let c=CL2[slot*${CAPS_MAX + 1}u+1u+k];
  if(isFl&&c>=nMon&&c<propsStart){continue;}
  let A=vec3<f32>(caps[c*7u],caps[c*7u+1u],caps[c*7u+2u]);
  let B=vec3<f32>(caps[c*7u+3u],caps[c*7u+4u],caps[c*7u+5u]);
  let r=caps[c*7u+6u];
  let mid=(A+B)*0.5;
  let crad=r+length(B-A)*0.5;
  let d2=length(vec2<f32>(mid.x-lx,mid.z-lz));
  if(d2>Ri+crad||d2<1e-4){continue;}
  let t0=rayCapsule(o,d,A,B,r);
  let t0x=(t0+0.02)*ce;
  if(t0>0.02&&t0x<dep){dep=t0x;}
 }
 shOut[g.y*shW+g.x]=select(min(dep/Ri,1.0),1.0,dep>=Ri); }`;

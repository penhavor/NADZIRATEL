/* r16float НЕ поддерживает запись через storage в базовом WebGPU (только
   TEXTURE_BINDING): csShadow пишет f32-расстояния в буфер, csPack пакует пары
   текселов в u32 (по 16 бит на тексел), затем copyBufferToTexture в карту
   r16float с шагом строки 256 байт. */
const WGS_PACK = `
${WGS_PP}
@group(1) @binding(0) var<storage,read> src32:array<f32>;
@group(1) @binding(1) var<storage,read_write> dst16:array<u32>;
fn f16pack(x:f32)->u32{
 if(!(x>0.0)){return 0u;}
 if(x>=1.0){return 0x3C00u;}
 let b=bitcast<u32>(x);
 let e=i32((b>>23u)&255u)-112;
 if(e<=0){return 0u;}   /* < 2^-14 — у наших расстояний не бывает */
 return (u32(e)<<10u)+(((b>>13u)&1023u)+((b>>12u)&1u));   /* перенос округления уходит в экспоненту */
}
@compute @workgroup_size(256)
fn csPack(@builtin(global_invocation_id) g:vec3<u32>){
 let shW=u32(P.v0.x); let rows=u32(P.v0.y); let pitchU=u32(P.v0.z);
 if(g.x>=pitchU*rows){return;}
 let row=g.x/pitchU; let c0=(g.x%pitchU)*2u;
 let base=row*shW;
 var h0=0u; var h1=0u;   /* хвост строки до шага — нули, src32 не читается */
 if(c0<shW){ h0=f16pack(clamp(src32[base+c0],0.0,1.0)); }
 if(c0+1u<shW){ h1=f16pack(clamp(src32[base+c0+1u],0.0,1.0)); }
 dst16[g.x]=h0|(h1<<16u);
}`;

/* --- процедурная детализация поверхностей (аналог sdGlsl) --- */
/* ==== WGSL-ШЕЙДЕРЫ ==== */
function sdWgsl(lvl) {
  const L = lvl | 0;
  if (L < 1) return '';
  return `
const BRH_LAT=f32(0.118962);            /* высота ряда кирпича в клетках (CEIL_H/10) */
fn sdHashU(x:u32,y:u32,s:u32)->u32{
var h=u32(x*374761393u+y*668265263u+s);
h=(h^(h>>13u))*1274126177u;
return h^(h>>16u); }
fn sdRand(p:vec2<i32>,s:u32)->f32{
return f32(sdHashU(u32(p.x+32768),u32(p.y+32768),s)&0x00ffffffu)*(1.0/16777215.0); }
fn sdNoise(p:vec2<f32>,s:u32)->f32{
let i=floor(p); let fr=fract(p); let f=fr*fr*(3.0-2.0*fr);
let i0=vec2<i32>(i);
let a=sdRand(i0,s); let b=sdRand(i0+vec2<i32>(1,0),s);
let c=sdRand(i0+vec2<i32>(0,1),s); let d=sdRand(i0+vec2<i32>(1,1),s);
return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
${
  L >= 3
    ? `fn sdFbm(p:vec2<f32>,s:u32)->f32{
return sdNoise(p,s)*0.60+sdNoise(p*2.13+4.7,s+17u)*0.28+sdNoise(p*4.71+9.1,s+31u)*0.12; }
struct SegOut{ d:f32, cp:vec2<f32> };
fn sdSeg(p:vec2<f32>,a:vec2<f32>,b:vec2<f32>)->SegOut{
let pa=p-a; let ba=b-a;
let t=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.0,1.0);
let cp=a+ba*t;
return SegOut(length(p-cp),cp); }
/* Жила трещины: полилиния со случайным блужданием направления; ширина дышит
   шумом вдоль длины, край рвётся тем же шумом, к концу жила сходит на нет —
   трещина читается объёмной, а не «нарисованной маркером». sd — сторона точки
   относительно жилы (для сколотой губы), cp — ближайшая точка жилы. */
struct CrackHit{ d:f32, w:f32, sd:f32, cp:vec2<f32> };
fn sdCrackPath(p:vec2<f32>,cell:vec2<i32>,salt:u32,ph:f32,c0:vec2<f32>,a0:f32,
segLen:f32,wB:f32,nSeg:i32,jag:f32,s:u32)->CrackHit{
var pos=c0; var ang=a0; var acc=0.0;
var best=CrackHit(1e9,wB,0.0,c0);
let tot=segLen*f32(nSeg);
for(var i=0;i<nSeg;i=i+1){
let r1=sdRand(cell*5+vec2<i32>(i*31+7,i*17+3),s+salt+u32(i)*53u);
let r2=sdRand(cell*7+vec2<i32>(i*13+11,i*29+5),s+salt*3u+u32(i)*97u+11u);
let l=segLen*(0.60+0.80*r1);
ang=ang+(r2-0.5)*1.9;
let dir=vec2<f32>(cos(ang),sin(ang));
let b=pos+dir*l;
let sg=sdSeg(p,pos,b);
let nz=sdNoise(sg.cp*(31.0+fract(ph)*9.0)+vec2<f32>(ph*1.7,ph*2.3),s+salt+7u);
let dd=max(sg.d-(nz-0.5)*jag,0.0);
if(dd<best.d){
let tt=clamp((acc+length(sg.cp-pos))/tot,0.0,1.0);
let wv=wB*(0.50+0.85*sdNoise(vec2<f32>(tt*8.3+ph*3.1,ph*2.7+1.9),s+salt+29u))
*sstep(0.0,0.14,tt)*(1.0-sstep(0.68,1.02,tt));
let side=sign(dot(p-sg.cp,vec2<f32>(-dir.y,dir.x)));
best=CrackHit(dd,max(wv,wB*0.18),side,sg.cp); }
acc=acc+l; pos=b; }
return best; }
/* Вклад трещины: умеренно тёмная щель (не чернота), приподнятая сколотая губа с
   одной стороны, градиент для наклона нормали (TBN). */
struct CrackFx{ dark:f32, rough:f32, hgt:f32, tint:vec3<f32>, sgrad:vec2<f32> };
fn sdCrackFx(ch:CrackHit,p:vec2<f32>,aa:f32,dk:f32,rk:f32,gk:f32)->CrackFx{
let core=1.0-sstep(ch.w-aa,ch.w+aa,ch.d);
/* дно щели темнее её стенок: дополнительная тень вдоль центра жилы */
let ctr=1.0-sstep(0.0,ch.w*0.45,ch.d);
let lip=sstep(ch.w*0.9,ch.w*2.2,ch.d)*(1.0-sstep(ch.w*2.6,ch.w*4.6,ch.d))
*(0.25+0.75*step(0.0,ch.sd));
let tint=mix(vec3<f32>(1.0),vec3<f32>(1.05,1.01,0.94),core*0.45)*(1.0+0.14*lip);
var fx=CrackFx(core*dk+ctr*dk*0.35,core*rk+lip*0.04,-core*gk*0.5,tint,vec2<f32>(0.0));
let gd=p-ch.cp; let gl=length(gd);
if(gl>1e-5){ fx.sgrad=gd*(1.0/gl)*(1.0-min(ch.d/(ch.w*3.4),1.0))*gk; }
return fx; }
fn sdFxA(a:CrackFx,b:CrackFx)->CrackFx{
return CrackFx(a.dark+b.dark,a.rough+b.rough,a.hgt+b.hgt,a.tint*b.tint,a.sgrad+b.sgrad); }
/* Точка на грани кирпича мировой сетки: e — грань (0 низ, 1 верх, 2 лево,
   3 право), t — доля вдоль неё, r — (x0,y0,x1,y1) кирпича. */
fn sdEdgePt(e:i32,t:f32,r:vec4<f32>)->vec2<f32>{
if(e==0){return vec2<f32>(mix(r.x,r.z,t),r.y);}
if(e==1){return vec2<f32>(mix(r.x,r.z,t),r.w);}
if(e==2){return vec2<f32>(r.x,mix(r.y,r.w,t));}
return vec2<f32>(r.z,mix(r.y,r.w,t)); }
/* Трещина раскола: полилиния q0→q1→q2→q3, узлы сдвинуты вбок по хешу кирпича —
   в отличие от sdCrackPath (блуждание жилы) гарантированно проходит кирпич
   насквозь. d — расстояние, w — полуширина щели, sd — сторона, t — доля пути. */
struct SpHit{ d:f32, w:f32, sd:f32, cp:vec2<f32>, t:f32 };
fn sdSplitPath(p:vec2<f32>,q0:vec2<f32>,q1:vec2<f32>,q2:vec2<f32>,q3:vec2<f32>,
wB:f32,jag:f32,hv:vec2<f32>,s:u32)->SpHit{
let pts=array<vec2<f32>,4>(q0,q1,q2,q3);
let ls=array<f32,3>(length(q1-q0),length(q2-q1),length(q3-q2));
let tot=max(ls[0]+ls[1]+ls[2],1e-5);
var best=SpHit(1e9,wB,0.0,q0,0.0);
var acc=0.0;
for(var i=0;i<3;i=i+1){
let A=pts[i]; let B=pts[i+1];
let sg=sdSeg(p,A,B);
let nz=sdNoise(sg.cp*181.0+hv*23.0,s+u32(i)*67u+13u);
let dd=max(sg.d-(nz-0.5)*jag,0.0);
if(dd<best.d){
let vs=vec2<f32>(-(B.y-A.y),B.x-A.x)/max(ls[i],1e-6);
let tt=clamp((acc+length(sg.cp-A))/tot,0.0,1.0);
let wv=wB*(0.60+0.80*sdNoise(vec2<f32>(tt*6.3+hv.x*9.1,hv.y*7.7+3.3),s+29u))
*sstep(0.0,0.07,tt)*(1.0-0.40*sstep(0.93,1.01,tt));
best=SpHit(dd,max(wv,wB*0.22),sign(dot(p-sg.cp,vs)),sg.cp,tt); }
acc=acc+ls[i]; }
return best; }
/* Вклад раскола: щель — объёмная канавка, а не линия: освещённая стенка свежей
   глины с одной стороны, затенённая с другой, дно с крошкой (cav в surfDetail),
   фаска края куска вниз и контактная тень под нависанием. */
fn sdSplitFx(ch:SpHit,p:vec2<f32>,aa:f32,lipS:f32,g1:f32,g2:f32)->CrackFx{
let core=1.0-sstep(ch.w-aa,ch.w+aa,ch.d);
let g=clamp(ch.d/max(ch.w,1e-5),0.0,1.0);
let litS=step(0.0,ch.sd*lipS);
let wall=core*(1.0-sstep(0.20,0.92,g));
let litW=wall*litS; let shW=wall*(1.0-litS);
let bot=core*(1.0-sstep(0.0,0.42,g));
let cham=(1.0-core)*(1.0-sstep(ch.w,ch.w*2.7,ch.d));
let cs=sstep(ch.w*1.05,ch.w*1.7,ch.d)*(1.0-sstep(ch.w*2.0,ch.w*3.8,ch.d))*(1.0-litS);
let eh=(1.0-sstep(ch.w*0.30,ch.w*0.85,abs(ch.d-ch.w)))*litS;
let tint=mix(vec3<f32>(1.0),vec3<f32>(1.38,1.27,1.10),litW*0.70*(0.45+0.55*g2))*(1.0+eh*0.14);
var fx=CrackFx(
bot*(0.58+0.18*g1)+shW*0.44+litW*0.08+cham*0.10+cs*0.30,
core*0.30+cham*0.06+cs*0.04,
-bot*0.75-wall*0.45-cham*0.12+eh*0.05,
tint,vec2<f32>(0.0));
let gd=p-ch.cp; let gl=length(gd);
if(gl>1e-5){ fx.sgrad=gd*(1.0/gl)*(wall*1.7+bot*0.6+cham*0.55); }
return fx; }`
    : ''
}
struct SDOut{ colMul:vec3<f32>, hgt:f32, rough:f32, sgrad:vec2<f32>, cav:f32, dep:f32 };
fn surfDetail(wp:vec3<f32>,Ng:vec3<f32>,uv0:vec2<f32>,seed:u32)->SDOut{
var colMul=vec3<f32>(1.0); var hgt=0.0; var rough=0.0; var sgrad=vec2<f32>(0.0); var cavO=0.0; var depO=0.0;
/* координаты плоскости поверхности: пол/потолок — (x,z), стены — (z,y) или (x,y) */
var p=vec2<f32>(0.0); var wallK=0.0; var ceilK=0.0;
if(abs(Ng.y)>0.5){ p=vec2<f32>(wp.x,wp.z); if(Ng.y<0.0){ceilK=1.0;} }
else{ wallK=1.0; if(abs(Ng.x)>0.5){p=vec2<f32>(wp.z,wp.y);}else{p=vec2<f32>(wp.x,wp.y);} }
let tl=vec2<i32>(floor(p));
let f=p-vec2<f32>(tl);
var dark=0.0; var tint=vec3<f32>(1.0);
/* зона материала по квадрату атласа (те же границы, что в matOf): 0 — кирпич,
   1 — бетон пола, 2 — потолок; дерево и железо не трескаются */
var zone=-1;
let qc0=vec2<i32>(floor(clamp(uv0,vec2<f32>(0.0),vec2<f32>(0.9999))*4.0));
if(qc0.y==0){ if(qc0.x==0){zone=0;}else{ if(qc0.x==1){zone=1;} } }
else{ if(qc0.y==1&&qc0.x==0){zone=2;} }
/* пятно пикселя в координатах поверхности — сглаживание краёв */
var dpU=vec2<f32>(0.0); var dpV=vec2<f32>(0.0);
if(abs(Ng.y)>0.5){ dpU=vec2<f32>(gWx.x,gWx.z); dpV=vec2<f32>(gWy.x,gWy.z); }
else{ if(abs(Ng.x)>0.5){ dpU=vec2<f32>(gWx.z,gWx.y); dpV=vec2<f32>(gWy.z,gWy.y); }
else{ dpU=vec2<f32>(gWx.x,gWx.y); dpV=vec2<f32>(gWy.x,gWy.y); } }
let px=max(max(length(dpU),length(dpV)),0.00045);
let aa=max(px*1.15,0.0005);
/* РЕШЁТКА КИРПИЧА в мировых координатах (4 колонки × 10 рядов на клетку,
   нечётные ряды сдвинуты на полкирпича; чётность как в атласе, где ряд клетки
   равен 9-rowI). Решётка НЕПРЕРЫВНА через границы клеток: сколы, разбитые
   кирпичи и жилы едут по кладке, а не по развёртке клетки — швов нет. bSgn —
   направление u-оси квадрата атласа вдоль стены. */
var bSgn=1.0; var bCol=0; var bRow=0; var bOff=0.0;
if(zone==0&&wallK>0.5){
bSgn=select(-1.0,1.0,(Ng.x<-0.5)||(Ng.z>0.5));
bRow=i32(floor(p.y/BRH_LAT));
bOff=select(0.0,0.5,((bRow+1)&1)==1);
bCol=i32(floor(bSgn*p.x*4.0-bOff)); }
/* --- грязь и пыль (все уровни): шум непрерывен в мировых координатах, без
   сдвигов на клетку — иначе тон скачет через шов --- */
let r0=sdRand(tl,seed+11u);
let n1=${L >= 3 ? 'sdFbm(p*1.9,seed+7u)' : 'sdNoise(p*1.9,seed+7u)'};
let dirt=sstep(0.46,0.86,n1)*(0.26+0.46*sdNoise(p*0.63+2.7,seed+101u));
dark+=dirt*0.60;
tint*=mix(vec3<f32>(1.0),vec3<f32>(1.03,0.95,0.82),clamp(dirt*1.4,0.0,1.0));
${
  L >= 2
    ? `/* --- крупные потёки --- */
let n2=sdNoise(p*0.85,seed+22u);
let stain=sstep(0.58,0.95,n2)*0.30*(0.40+0.60*sdNoise(p*0.47+8.2,seed+303u));
dark+=stain*0.55;
tint*=mix(vec3<f32>(1.0),vec3<f32>(0.93,0.96,0.88),clamp(stain*2.0,0.0,1.0));
/* пятнистые сколы по сетке — только бетон и штукатурка: на кирпиче сколы сидят
   по углам решётки кладки (ниже) и никогда не режут кирпич поперёк */
if(zone!=0){
let cg=vec2<i32>(floor(p*11.0)); let hs=sdRand(cg,seed+33u);
if(hs>0.90){
let gc=(vec2<f32>(cg)+0.5)*(1.0/11.0);
let rad=0.016+0.020*(hs-0.90)*10.0;
let chip=(1.0-sstep(0.0,rad,length(p-gc)))*0.55;
dark+=chip*0.85; hgt-=chip*0.18; rough+=chip*0.20; } }
/* --- СКОЛЫ КИРПИЧА: углы решётки, все четыре (верхние И нижние) ---
   выемка на пересечении швов: тёмная полость с тенью в глубине, яркий свежий
   излом вдоль волокон, приподнятый валик, наклон в нормаль. */
if(zone==0&&wallK>0.5){
for(var cy=0;i32(cy)<2;cy=cy+1){
for(var cx=0;i32(cx)<2;cx=cx+1){
/* скол принадлежит ПЕРЕСЕЧЕНИЮ ШВОВ (m,e), а не углу кирпича: иначе четыре
   соседних кирпича затемняли бы одну точку вчетверо */
let mI=bCol+cx; let eI=bRow+cy;
let ch=sdRand(vec2<i32>(mI,eI),seed+911u);
if(ch<0.22){
let ac=(f32(bCol)+bOff+f32(cx))*0.25;
let pc=vec2<f32>(bSgn*ac,(f32(bRow)+f32(cy))*BRH_LAT);
let dvv=p-pc; let dsp0=length(dvv);
let ang=atan2(dvv.y,dvv.x);
/* рваный край: радиус дышит угловым шумом */
let dsp=dsp0*(1.0+(sdNoise(vec2<f32>(ang*3.4+ch*17.0,ch*29.0),seed+8291u)-0.5)*0.50);
let rad=BRH_LAT*(0.09+0.15*sdRand(vec2<i32>(mI,eI),seed+977u));
let aa3=max(px*1.5,0.0008);
let core=1.0-sstep(rad-aa3,rad+aa3,dsp);
let rim=sstep(rad+aa3,rad*1.9,dsp)*(1.0-sstep(rad*2.3,rad*3.4,dsp));
let grain=sdNoise(p*97.0+ch*31.0,seed+8183u);
dark+=core*(0.16+0.20*sstep(rad*0.8,rad*0.25,dsp))+rim*0.07;
tint*=mix(vec3<f32>(1.0),vec3<f32>(1.45,1.34,1.16),core*0.75*(0.35+0.65*grain));
rough+=core*0.28+rim*0.07;
hgt-=core*0.50+rim*0.12;
sgrad+=dvv/max(dsp0,1e-5)*(core*1.10+rim*0.35); }
} }
}
${
  L >= 3
    ? `/* --- РАЗБИТЫЙ КИРПИЧ: целый кирпич выкрошился из стены ---
   Кирпич мировой решётки выбирается по хешу индекса (зависит от сида, не
   повторяется от грани к грани). Полость с рваным краем, зерно крошки, два
   уцелевших угловых остатка, яркий край свежего излома и жила, уходящая в
   кладку. Глубина копится в hgt — fsWorld затемняет альбедо полости. */
if(zone==0&&wallK>0.5){
let bh=sdRand(vec2<i32>(bCol,bRow),seed+9277u);
if(bh<0.040){
let a0b=(f32(bCol)+bOff)*0.25; let a1b=a0b+0.25;
let x0=select(-a1b,a0b,bSgn>0.5); let x1=select(-a0b,a1b,bSgn>0.5);
let y0=f32(bRow)*BRH_LAT; let y1=y0+BRH_LAT;
let m=0.011;
let sA=sdRand(vec2<i32>(bCol,bRow),seed+9617u);
let sB=sdRand(vec2<i32>(bCol,bRow),seed+9719u);
let sC=sdRand(vec2<i32>(bCol,bRow),seed+9823u);
let aa4=max(px*1.6,0.001);
if(sC<0.40){
/* глубокая полость: кирпич выкрошился насквозь, внутри крошка и тень */
let c=vec2<f32>((x0+x1)*0.5,(y0+y1)*0.5);
let hlf=vec2<f32>((x1-x0)*0.5-m,(y1-y0)*0.5-m);
let qq=abs(p-c)-hlf;
let dbox=length(max(qq,vec2<f32>(0.0)))+min(max(qq.x,qq.y),0.0);
let rg=abs(sdNoise(p*57.0+bh*31.0,seed+9311u)*2.0-1.0);
let jag=(rg-0.55)*0.016+(sdNoise(p*151.0+bh*23.0,seed+9417u)-0.5)*0.008
+(sdNoise(p*307.0,seed+9473u)-0.5)*0.004;
let dn=dbox+jag;
let cav=1.0-sstep(-aa4,aa4,dn);
let rimN=0.35+0.95*sdNoise(p*93.0+bh*41.0,seed+9571u);
let rim=(1.0-sstep(aa4,aa4*2.2,abs(dn)))*(1.0-cav*0.55)*rimN;
let rub2=sdNoise(p*127.0+bh*47.0,seed+9619u);
let wA=0.125*(0.30+0.50*sA); let hA=BRH_LAT*0.5*(0.30+0.50*sB);
let wB=0.125*(0.30+0.50*sB); let hB=BRH_LAT*0.5*(0.30+0.50*sA);
let scA=vec2<f32>(select(x0+m*2.0,x1-m*2.0,sA>0.5),select(y0+m*2.0,y1-m*2.0,sA>0.35));
let scB=vec2<f32>(select(x0+m*2.0,x1-m*2.0,sB<0.5),select(y0+m*2.0,y1-m*2.0,sB>0.65));
let dA=max(abs(p.x-scA.x)/wA,abs(p.y-scA.y)/hA);
let dB=max(abs(p.x-scB.x)/wB,abs(p.y-scB.y)/hB);
let stub=max(1.0-sstep(0.75,1.0,dA+jag*18.0),1.0-sstep(0.75,1.0,dB+jag*18.0));
let cavE=cav*(1.0-stub);
cavO=cavE; depO=cavE*0.45;
let cen=1.0-sstep(0.0,min(hlf.x,hlf.y)*0.9,length(p-c));
let topsh=sstep(y0+(y1-y0)*0.55,y1-m,p.y);
dark+=cavE*(cen*0.16+topsh*0.14+0.10*rub2)+rim*0.05;
tint*=mix(vec3<f32>(1.0),vec3<f32>(1.30,1.20,1.05),rim*0.35);
rough+=cavE*0.34+rim*0.10;
hgt-=cavE*0.95+rim*0.08-stub*cav*0.25;
let dvc=p-c; let dvl=max(length(dvc),1e-5);
sgrad+=dvc/dvl*(rim*0.9-cavE*0.30);
if(cavE<0.5){
let fxB=sdCrackFx(sdCrackPath(p,tl,seed+9821u,bh*9.0,c,
bh*6.2831853,0.055+0.05*sA,0.0009+0.0007*sB,3,0.0016,seed),p,aa,0.40,0.16,0.80);
dark+=fxB.dark*(1.0-cavE); rough+=fxB.rough*(1.0-cavE);
hgt+=fxB.hgt*(1.0-cavE); tint*=mix(vec3<f32>(1.0),fxB.tint,1.0-cavE);
sgrad+=fxB.sgrad*(1.0-cavE); }
}else{
/* СКОЛ «АКУЛА»: кусок отслоился от грани и торчит свежим изломом глины, как у
   настоящего кирпича: яркая матовая поверхность, две плоскости скола под разными
   наклонами, поры-ямки, контактная тень под нависающим краем. Треугольник скола
   C-A-B: резы волнистые и зазубренные, а не чертёжные. */
let sD=sdRand(vec2<i32>(bCol,bRow),seed+9827u);
let sE=sdRand(vec2<i32>(bCol,bRow),seed+9829u);
let sF=sdRand(vec2<i32>(bCol,bRow),seed+9833u);
var C=vec2<f32>(0.0); var A=vec2<f32>(0.0); var B=vec2<f32>(0.0);
if(sD<0.30){
/* семейство 1: угол кирпича; резы больше не идут по граням — наклон сида ломает
   прямой угол, пролёт реза короткий */
let cx0=select(x0+m,x1-m,sA>0.5); let cy0=select(y0+m,y1-m,sB>0.5);
let exx=select(x1-m,x0+m,sA>0.5); let eyy=select(y1-m,y0+m,sB>0.5);
C=vec2<f32>(cx0,cy0);
let sxh=select(-1.0,1.0,exx>cx0); let syh=select(-1.0,1.0,eyy>cy0);
let angA=(sE-0.5)*0.60; let angB=(sF-0.5)*0.66;
A=clamp(C+vec2<f32>(sxh*cos(angA),syh*sin(angA))*(abs(exx-cx0)*(0.30+0.42*sB)),
vec2<f32>(x0+m,y0+m),vec2<f32>(x1-m,y1-m));
B=clamp(C+vec2<f32>(sxh*sin(angB),syh*cos(angB))*(abs(eyy-cy0)*(0.26+0.46*sC)),
vec2<f32>(x0+m,y0+m),vec2<f32>(x1-m,y1-m));
}else{
/* семейство 2: клин из случайной точки случайной грани, углы резов от сида */
let eI=i32(sA*4.0); let tE=0.15+0.70*sB;
let bxm=mix(x0+m,x1-m,tE); let bym=mix(y0+m,y1-m,tE);
var base=0.0;
if(eI==0){ C=vec2<f32>(bxm,y0+m); base=1.5708; }else{
if(eI==1){ C=vec2<f32>(bxm,y1-m); base=-1.5708; }else{
if(eI==2){ C=vec2<f32>(x0+m,bym); }else{ C=vec2<f32>(x1-m,bym); base=3.1416; } } }
let a1=base-0.35-0.55*sC; let a2=base+0.35+0.55*sE;
let l1=BRH_LAT*(0.50+0.80*sC); let l2=BRH_LAT*(0.50+0.80*sE);
A=clamp(C+vec2<f32>(cos(a1),sin(a1))*l1,vec2<f32>(x0+m,y0+m),vec2<f32>(x1-m,y1-m));
B=clamp(C+vec2<f32>(cos(a2),sin(a2))*l2,vec2<f32>(x0+m,y0+m),vec2<f32>(x1-m,y1-m));
}
let eA=A-C; let eB=B-C; let eAB=B-A; let mM=(A+B)*0.5-C;
let cr1=(p.x-C.x)*eA.y-(p.y-C.y)*eA.x;
let cr2=(p.x-B.x)*(C.y-B.y)-(p.y-B.y)*(C.x-B.x);
let cr3=(p.x-A.x)*eAB.y-(p.y-A.y)*eAB.x;
let s1=sign((B.x-C.x)*eA.y-(B.y-C.y)*eA.x);
let s2=sign((A.x-B.x)*(C.y-B.y)-(A.y-B.y)*(C.x-B.x));
let s3=sign((C.x-A.x)*eAB.y-(C.y-A.y)*eAB.x);
/* три НЕЗАВИСИМЫХ поля зазубрин: большая волна реза и средняя зазубрина у
   каждого края свои + общее микрозерно — форма скола целиком от сида */
let jm=(sdNoise(p*215.0+bh*37.0,seed+9311u)-0.5)*0.004;
let jA=(sdNoise(p*23.0+bh*41.0,seed+9337u)-0.5)*0.019
+(sdNoise(p*97.0+bh*17.0,seed+9341u)-0.5)*0.006+jm;
let jB=(sdNoise(p*26.0+bh*53.0+3.7,seed+9343u)-0.5)*0.019
+(sdNoise(p*103.0+bh*23.0+1.3,seed+9349u)-0.5)*0.006+jm*0.8;
let jAB=(sdNoise(p*21.0+bh*67.0+7.1,seed+9371u)-0.5)*0.017
+(sdNoise(p*113.0+bh*31.0+5.9,seed+9391u)-0.5)*0.006+jm;
let Ln1=max(length(eA),1e-5); let Ln2=max(length(eB),1e-5); let Ln3=max(length(eAB),1e-5);
/* знаковое расстояние до трёх неровных краёв: положительно внутрь; то же поле
   питает AO, тень края и светлую зазубрину — всё сходится с фактической формой */
let dA1=s1*cr1/Ln1+jA; let dB1=s2*cr2/Ln2+jB; let dAB1=s3*cr3/Ln3+jAB;
let Fc=sstep(-aa4,aa4,dA1)*sstep(-aa4,aa4,dB1)*sstep(-aa4,aa4,dAB1);
depO=Fc*0.30;
if(Fc>0.001){
let facM=step(0.0,(p.x-C.x)*mM.y-(p.y-C.y)*mM.x);
let g1=vec2<f32>(sA-0.5,sB-0.5); let g2=vec2<f32>(sC-0.5,sA-0.35);
/* свежая глина светлее и чище выветренной корки */
dark*=1.0-Fc*0.70;
let pore=sdNoise(p*430.0+bh*71.0,seed+9513u);
let gr2=sdNoise(p*240.0+bh*29.0,seed+9619u);
dark+=Fc*(sstep(0.66,0.80,pore)*0.20+(gr2-0.5)*0.10);
dark+=Fc*(1.0-sstep(0.006,0.026,dAB1))*0.40;   /* тень под нависающим краем: читается как глубина */
/* задняя стенка выемки глубже: маленький треугольник у угла скола — серый бетон */
let A2=C+eA*0.45; let B2=C+eB*0.45; let e2=B2-A2;
let c21=(p.x-C.x)*(A2.y-C.y)-(p.y-C.y)*(A2.x-C.x);
let c22=(p.x-B2.x)*(C.y-B2.y)-(p.y-B2.y)*(C.x-B2.x);
let c23=(p.x-A2.x)*e2.y-(p.y-A2.y)*e2.x;
let s21=sign((B2.x-C.x)*(A2.y-C.y)-(B2.y-C.y)*(A2.x-C.x));
let s22=sign((A2.x-B2.x)*(C.y-B2.y)-(A2.y-B2.y)*(C.x-B2.x));
let s23=sign((C.x-A2.x)*e2.y-(C.y-A2.y)*e2.x);
let Fc2=sstep(-aa4,aa4,s21*c21/max(length(A2-C),1e-5)+jA)
*sstep(-aa4,aa4,s22*c22/max(length(B2-C),1e-5)+jB)
*sstep(-aa4,aa4,s23*c23/max(length(e2),1e-5)+jAB*0.7);
dark+=Fc2*0.22;
tint*=mix(vec3<f32>(1.0),vec3<f32>(0.80,0.78,0.74),Fc2*0.55);
/* AO в углах выемки: темнее у самой границы скола */
let dIn=min(dA1,min(dB1,dAB1));
dark+=Fc*(1.0-sstep(0.002,0.010,dIn))*0.22;
tint*=mix(vec3<f32>(1.0),vec3<f32>(1.40,1.27,1.15),Fc*mix(0.78,0.95,facM));
rough+=Fc*0.26;
/* глубина растёт от края реза к центру скола: градиент тона, наклон плоскости
   излома и зернистая нормаль рваной глины — не декаль */
let mMn=mM/max(length(mM),1e-5);
let gpr=clamp(dot(p-C,mMn)/max(length(mM),1e-5),0.0,1.0);
dark+=Fc*gpr*0.30;
let mn1=sdNoise(p*300.0+bh*53.0,seed+9721u); let mn2=sdNoise(p*310.0+bh*61.0,seed+9723u);
hgt-=Fc*(0.45+0.35*gpr);
let deep=C+mM*0.6;
let dvd=deep-p; let ddl=max(length(dvd),1e-5);
/* вогнутая чаша, как на сколах: нормаль наклоняется к точке глубины — выемка
   читается с любого угла, а не только в параллаксе */
sgrad+=Fc*(dvd/ddl*1.4+mix(g1,g2,facM)*0.4+vec2<f32>(mn1-0.5,mn2-0.5)*0.9);
/* светлая зазубрина на корке вдоль реза — по фактическому неровному краю:
   полоса снаружи каждой проверяемой грани, с окном вдоль её длины */
let tW1=dot(p-C,eA)/max(dot(eA,eA),1e-9);
let tW2=dot(p-B,C-B)/max(dot(C-B,C-B),1e-9);
let tW3=dot(p-A,eAB)/max(dot(eAB,eAB),1e-9);
let be1=sstep(-0.0072,-0.0016,dA1)*(1.0-sstep(-0.0016,0.0014,dA1))
*sstep(-0.25,-0.05,tW1)*(1.0-sstep(1.05,1.25,tW1));
let be2=sstep(-0.0072,-0.0016,dB1)*(1.0-sstep(-0.0016,0.0014,dB1))
*sstep(-0.25,-0.05,tW2)*(1.0-sstep(1.05,1.25,tW2));
let be3=sstep(-0.0072,-0.0016,dAB1)*(1.0-sstep(-0.0016,0.0014,dAB1))
*sstep(-0.25,-0.05,tW3)*(1.0-sstep(1.05,1.25,tW3));
let be=max(be1,max(be2,be3))*(1.0-Fc);
tint*=1.0+be*0.30;
}
/* тонкая жила от угла скола в кладку */
let fxB=sdCrackFx(sdCrackPath(p,tl,seed+9821u,bh*9.0,C,
bh*6.2831853,0.045+0.04*sA,0.0007+0.0005*sB,2,0.0012,seed),p,aa,0.34,0.14,0.70);
dark+=fxB.dark*(1.0-Fc); rough+=fxB.rough*(1.0-Fc);
hgt+=fxB.hgt*(1.0-Fc); tint*=mix(vec3<f32>(1.0),fxB.tint,1.0-Fc);
sgrad+=fxB.sgrad*(1.0-Fc);
}
}else{
/* --- РАСКОЛОТЫЙ КИРПИЧ: целый блок разделён трещинами на 2–4 куска ---
   Не декаль: куски оседают и наклоняются друг к другу (сдвиг по разлому), щель
   уходит вглубь с параллаксом, у неё рваная ширина, зерно крошки на дне и
   светлая губа свежего излома с одной стороны. Сколько кусков и куда идут
   трещины — решает хеш кирпича мировой решётки (сид карты). */
let sp=sdRand(vec2<i32>(bCol,bRow),seed+9839u);
if(sp<0.085){
let a0s=(f32(bCol)+bOff)*0.25; let a1s=a0s+0.25;
let sx0=select(-a1s,a0s,bSgn>0.5); let sx1=select(-a0s,a1s,bSgn>0.5);
let sy0=f32(bRow)*BRH_LAT; let sy1=sy0+BRH_LAT;
let rect=vec4<f32>(sx0,sy0,sx1,sy1);
let k1=sdRand(vec2<i32>(bCol,bRow),seed+9851u);
let k2=sdRand(vec2<i32>(bCol,bRow),seed+9853u);
let k3=sdRand(vec2<i32>(bCol,bRow),seed+9857u);
let k4=sdRand(vec2<i32>(bCol,bRow),seed+9859u);
let k5=sdRand(vec2<i32>(bCol,bRow),seed+9871u);
let k6=sdRand(vec2<i32>(bCol,bRow),seed+9877u);
let k7=sdRand(vec2<i32>(bCol,bRow),seed+9883u);
let k8=sdRand(vec2<i32>(bCol,bRow),seed+9887u);
let k9=sdRand(vec2<i32>(bCol,bRow),seed+9923u);
/* 2 куска — чаще всего, 3 — реже, 4 — совсем редко */
let nP=select(2,select(3,4,k1>=0.87),k1>=0.58);
let aa5=max(px*1.5,0.0007);
/* трещина 1: грань → противоположная грань, средние узлы сдвинуты вбок */
let e1=i32(k2*3.99);
let Pa=sdEdgePt(e1,0.18+0.64*k3,rect);
let Pb=sdEdgePt(e1^1,0.18+0.64*k4,rect);
let d1c=Pb-Pa; let L1c=max(length(d1c),1e-5);
let u1=d1c/L1c; let v1=vec2<f32>(-u1.y,u1.x);
let amp1=L1c*(0.09+0.07*k5);
let q1a=Pa+d1c*0.31+v1*(k6-0.5)*amp1;
let q2a=Pa+d1c*0.67+v1*(k7-0.5)*amp1;
let ch1=sdSplitPath(p,Pa,q1a,q2a,Pb,0.0018+0.0016*k8,0.0024+0.0020*k9,
vec2<f32>(k3*7.1,k4*5.3),seed+9901u);
let fx1=sdSplitFx(ch1,p,aa5,select(-1.0,1.0,k5>0.5),
sdNoise(p*257.0+bh*19.0,seed+9907u),sdNoise(p*93.0+bh*29.0,seed+9911u));
dark+=fx1.dark; rough+=fx1.rough; hgt+=fx1.hgt; tint*=fx1.tint; sgrad+=fx1.sgrad;
let cor1=1.0-sstep(ch1.w-aa5,ch1.w+aa5,ch1.d);
depO+=cor1*0.42;
cavO+=cor1*(1.0-sstep(0.0,ch1.w*0.42,ch1.d))*0.55;   /* крошка на дне канавки */
let fa1=(k6-0.5)*0.55; let ti1=(k7-0.5)*0.95;
var sd2=-1.0; var v2=vec2<f32>(0.0); var fa2=0.0; var ti2=0.0;
if(nP>=3){
var P2s=vec2<f32>(0.0); var P2e=vec2<f32>(0.0);
if(nP==3){
/* T-образный стык: ветвь от узла первой трещины к грани — три куска */
P2s=mix(q1a,q2a,step(0.55,k8));
P2e=sdEdgePt(i32(k9*3.99),0.22+0.56*k2,rect);
}else{
/* две пересекающиеся трещины — четыре куска */
P2s=sdEdgePt((e1+2)&3,0.20+0.60*k5,rect);
P2e=sdEdgePt(((e1+2)&3)^1,0.20+0.60*k6,rect);
}
let d2c=P2e-P2s; let L2c=max(length(d2c),1e-5);
let u2=d2c/L2c; v2=vec2<f32>(-u2.y,u2.x);
let amp2=L2c*(0.09+0.07*k3);
let q1b=P2s+d2c*0.31+v2*(k4-0.5)*amp2;
let q2b=P2s+d2c*0.67+v2*(k9-0.5)*amp2;
let ch2=sdSplitPath(p,P2s,q1b,q2b,P2e,0.0018+0.0016*k7,0.0022+0.0018*k8,
vec2<f32>(k5*8.3,k6*4.7),seed+9931u);
let fx2=sdSplitFx(ch2,p,aa5,select(-1.0,1.0,k2>0.5),
sdNoise(p*263.0+bh*23.0,seed+9941u),sdNoise(p*89.0+bh*41.0,seed+9949u));
dark+=fx2.dark; rough+=fx2.rough; hgt+=fx2.hgt; tint*=fx2.tint; sgrad+=fx2.sgrad;
let cor2=1.0-sstep(ch2.w-aa5,ch2.w+aa5,ch2.d);
depO+=cor2*0.36;
cavO+=cor2*(1.0-sstep(0.0,ch2.w*0.42,ch2.d))*0.50;
fa2=(k4-0.5)*0.50; ti2=(k9-0.5)*0.85;
if(nP==3){
/* с другой стороны первой трещины ветвь не режет кирпич: там её знак стороны
   приглушён, иначе граница куска нарисовала бы фантомную линию */
sd2=mix(-1.0,ch2.sd,step(0.0,ch1.sd*sign(dot(P2e-P2s,v1))));
}else{ sd2=ch2.sd; }
}
/* куски: сдвиг по высоте и наклон плиты, у каждого свой тон и шероховатость; у
   края кирпича вклад гаснет — шов кладки не подкрашивается */
let bw=clamp(min(min(p.x-sx0,sx1-p.x)/0.012,min(p.y-sy0,sy1-p.y)/0.010),0.0,1.0);
let pid=select(0,1,ch1.sd>0.0)+select(0,2,sd2>0.0);
let pt=sdRand(vec2<i32>(bCol*8+pid*2+1,bRow*8-pid),seed+9967u);
let pr=sdRand(vec2<i32>(bCol*8-pid,bRow*8+pid*2+3),seed+9973u);
/* кусок — это плита: свой уровень (разлом в hgt и в параллаксе dep), свой
   наклон, тон и шероховатость; у края кирпича вклад гаснет */
let hf=(fa1*ch1.sd+fa2*sd2)*bw;
hgt+=hf*0.50+(pt-0.5)*0.10*bw; depO-=hf*0.70;
sgrad+=(v1*(ti1*ch1.sd)+v2*(ti2*sd2))*bw;
tint*=1.0+(pt-0.5)*0.16*bw;
rough+=(pr-0.5)*0.20*bw;
}
} }
`
    : ''
}
`
    : ''
}${
    L >= 3
      ? `/* --- ТРЕЩИНЫ: три степени разрушения, всё от сида карты — слабая: неглубокие
   тонкие трещины и царапины; средняя: глубокая рваная жила с ветвью; сильная:
   угол кирпича выкрошился целиком (скол с рваным краем, отщеп и жила, уходящая в
   тело кирпича). Трещины живут только на кирпиче, бетоне пола и штукатурке
   потолка: на дереве и железе жил нет. Щель не закрашена в чёрное: умеренно
   тёмное дно, светлая сколотая губа с одной стороны, рваная ширина и
   сглаживание по пятну пикселя — иначе тонкие жилы мерцают вдалеке. */
if(zone>=0){
let sev=sdRand(tl,seed+1234u);
let rk1=sdRand(tl,seed+1301u); let rk2=sdRand(tl,seed+1402u);
let rk3=sdRand(tl,seed+1503u); let rk4=sdRand(tl,seed+1604u);
let rk5=sdRand(tl,seed+1705u); let rk6=sdRand(tl,seed+1806u);
let ph=rk1*7.3;
var sevK=0;
if(zone==0){
if(sev>=0.82){sevK=3;}else{ if(sev>=0.50){sevK=2;}else{ if(sev>=0.20){sevK=1;} } } }
if(zone==1){ if(sev>=0.80){sevK=2;}else{ if(sev>=0.44){sevK=1;} } }
if(zone==2){ if(sev>=0.62){sevK=1;} }
var fx=CrackFx(0.0,0.0,0.0,vec3<f32>(1.0),vec2<f32>(0.0));
if(zone==0&&sevK>0){
/* кирпич: жилы в координатах поверхности грани — согласованы с кладкой 4×10
   (нечётные ряды сдвинуты на полкирпича) */
let a0=rk3*6.2831853;
let c0=vec2<f32>(0.06+0.88*rk1,0.06+0.88*rk2);
if(sevK==1){
fx=sdFxA(fx,sdCrackFx(sdCrackPath(p,tl,seed+7u,ph,c0,a0,0.050+0.055*rk4,
0.00045+0.00045*rk5,3,0.0009,seed),p,aa,0.34,0.10,0.45));
/* сопутствующая царапина: короче и тоньше основной жилы */
fx=sdFxA(fx,sdCrackFx(sdCrackPath(p,tl,seed+1928u,ph+3.1,
vec2<f32>(0.08+0.84*rk5,0.08+0.84*rk6),a0+2.2+(rk6-0.5)*1.4,
0.030+0.030*rk2,0.00035+0.00030*rk4,2,0.0007,seed),p,aa,0.24,0.08,0.30));
}
if(sevK==2){
fx=sdFxA(fx,sdCrackFx(sdCrackPath(p,tl,seed+7u,ph,c0,a0,0.060+0.060*rk4,
0.0011+0.0011*rk5,4,0.0022,seed),p,aa,0.52,0.22,1.00));
${
  L >= 4
    ? `/* ветвь отходит от середины основной жилы под острым углом */
let cB=c0+vec2<f32>(cos(a0),sin(a0))*(0.055+0.05*rk4)*1.6;
fx=sdFxA(fx,sdCrackFx(sdCrackPath(p,tl,seed+3037u,ph+1.7,cB,
a0+select(-1.0,1.0,rk2>0.5)*(0.85+0.5*rk6),0.034+0.030*rk6,
0.0006+0.0005*rk2,2,0.0014,seed),p,aa,0.44,0.16,0.80));`
    : ''
}
fx=sdFxA(fx,sdCrackFx(sdCrackPath(p,tl,seed+4049u,ph+4.3,
vec2<f32>(0.07+0.86*rk6,0.07+0.86*rk3),a0+1.1+(rk4-0.5)*1.7,
0.036+0.04*rk2,0.0004+0.0003*rk5,2,0.0008,seed),p,aa,0.28,0.09,0.35));
}
if(sevK==3){
/* сильная: один угол кирпича на клетку выкрошен — какой кирпич и какой угол,
   решают хеши клетки; координаты — мировая решётка кладки, та же, что у угловых
   сколов, поэтому рисунок разрушения согласован и следует сиду */
let rI=i32(rk4*9.99);
let cW=i32(floor(bSgn*p.x))*4+i32(rk5*3.99);
if(bRow==rI&&bCol==cW){
let kx=select(0.0,1.0,rk6>0.5); let ky=select(0.0,1.0,rk2>0.45);
let cq=vec2<f32>(bSgn*((f32(cW)+bOff+kx)*0.25),(f32(rI)+ky)*BRH_LAT);
let dv=p-cq; let dsp=length(dv);
let angS=atan2(dv.y,dv.x);
/* рваный край скола: радиус модулирован угловым шумом */
let rSp=(0.018+0.024*rk3)*(0.66+0.66*sdNoise(
vec2<f32>(angS*2.9+ph*3.0,ph*5.0+1.7),seed+7071u));
   let aa2=max(px*1.7,0.0009);
   let coreSp=1.0-sstep(rSp-aa2,rSp+aa2,dsp);
   let rimSp=sstep(rSp+aa2,rSp*2.1,dsp)*(1.0-sstep(rSp*2.6,rSp*4.0,dsp));
   /* свежий излом светлее и теплее выветренной грани; в глубине у угла — тень,
   поэтому скол читается даже на тёмном кирпиче */
let grain=sdNoise(p*83.0+ph*11.0,seed+8081u);
let fresh=mix(vec3<f32>(1.60,1.44,1.24),vec3<f32>(2.20,2.00,1.72),grain);
let shade=sstep(rSp*0.85,rSp*0.30,dsp);
tint*=mix(vec3<f32>(1.0),fresh,coreSp*(1.0-shade*0.80));
dark+=coreSp*(0.06+0.46*shade)+rimSp*0.20;
rough+=coreSp*0.34+rimSp*0.10;
hgt-=coreSp*0.80+rimSp*0.22;
sgrad+=dv/max(dsp,1e-5)*(coreSp*1.7+rimSp*0.55);
/* отщеп рядом со сколом */
let dv2=p-(cq+vec2<f32>(cos(angS+2.1),sin(angS+2.1))*rSp*2.4);
let d2s=length(dv2);
let rSp2=rSp*(0.28+0.20*rk1);
let coreS2=1.0-sstep(rSp2-aa2,rSp2+aa2,d2s);
tint*=mix(vec3<f32>(1.0),vec3<f32>(1.55,1.42,1.24),coreS2*0.85);
dark+=coreS2*0.12; rough+=coreS2*0.26; hgt-=coreS2*0.55;
sgrad+=dv2/max(d2s,1e-5)*coreS2*1.1;
/* глубокая жила уходит от скола в тело кирпича */
let dIn=normalize(vec2<f32>((0.5-kx)*0.25+(rk3-0.5)*0.012,(0.5-ky)*0.10));
let aSp=atan2(dIn.y,dIn.x)+(rk5-0.5)*1.1;
fx=sdFxA(fx,sdCrackFx(sdCrackPath(p,tl,seed+5051u,ph+2.3,
cq+vec2<f32>(cos(aSp),sin(aSp))*rSp*0.6,aSp,0.048+0.05*rk6,
0.0013+0.0010*rk1,3,0.0024,seed),p,aa,0.48,0.20,0.95));
}
}
}
if(zone==1&&sevK>0){
/* бетон пола: трещины в координатах клетки, шире и спокойнее кирпичных */
let a0=rk3*6.2831853;
let c0=vec2<f32>(0.05+0.90*rk1,0.05+0.90*rk2);
if(sevK==1){
fx=sdFxA(fx,sdCrackFx(sdCrackPath(f,tl,seed+7u,ph,c0,a0,0.12+0.14*rk4,
0.0007+0.0006*rk5,4,0.0016,seed),f,aa,0.32,0.10,0.50));
}
if(sevK==2){
fx=sdFxA(fx,sdCrackFx(sdCrackPath(f,tl,seed+7u,ph,c0,a0,0.15+0.16*rk4,
0.0016+0.0014*rk5,5,0.0030,seed),f,aa,0.46,0.18,0.95));
${
  L >= 4
    ? `let cB=c0+vec2<f32>(cos(a0),sin(a0))*(0.15+0.16*rk4)*1.7;
fx=sdFxA(fx,sdCrackFx(sdCrackPath(f,tl,seed+3037u,ph+1.7,cB,
a0+select(-1.0,1.0,rk2>0.5)*(0.80+0.5*rk6),0.09+0.07*rk6,
0.0009+0.0007*rk2,3,0.0020,seed),f,aa,0.40,0.14,0.75));`
    : ''
}
}
}
if(zone==2&&sevK>0){
/* штукатурка потолка: редкая сетка тонких трещин */
fx=sdFxA(fx,sdCrackFx(sdCrackPath(f,tl,seed+7u,ph,
vec2<f32>(0.06+0.88*rk2,0.06+0.88*rk1),rk3*6.2831853,0.09+0.10*rk4,
0.0005+0.00045*rk5,3,0.0012,seed),f,aa,0.26,0.08,0.40));
}
dark+=fx.dark; rough+=fx.rough; hgt+=fx.hgt; tint*=fx.tint; sgrad+=fx.sgrad;
}
/* копоть под потолком и сырость у пола — только стены */
${
  L >= 4
    ? `if(wallK>0.5){
let soot=sstep(0.30,1.0,wp.y)*(0.30+0.70*sdNoise(vec2<f32>(p.x*2.7,p.y*0.9),seed+44u));
dark+=soot*0.30; tint*=mix(vec3<f32>(1.0),vec3<f32>(0.95,0.94,0.98),clamp(soot*1.6,0.0,1.0));
let damp=sstep(0.36,0.0,wp.y)*(0.35+0.65*sdNoise(p*2.2+3.1,seed+55u));
dark+=damp*0.22; rough-=damp*0.30;
tint*=mix(vec3<f32>(1.0),vec3<f32>(0.90,0.97,0.87),clamp(damp*1.2,0.0,1.0)); }
`
    : ''
}/* кольцевые пятна на потолке (протечка) */
if(ceilK>0.5){
let lc=vec2<f32>(0.22+0.56*sdRand(tl,seed+606u),0.22+0.56*sdRand(tl,seed+707u));
let rr=length(f-lc);
let ring=sstep(0.14,0.185,rr)*(1.0-sstep(0.20,0.27,rr));
let blob=1.0-sstep(0.09,0.30,rr);
let win=sstep(0.0,0.10,f.x)*sstep(0.0,0.10,1.0-f.x)*sstep(0.0,0.10,f.y)*sstep(0.0,0.10,1.0-f.y);
let leak=(ring*0.55+blob*0.45)*(0.35+0.65*r0)*win;   /* затухание у краёв клетки: пятно не обрезается швом */
dark+=leak*0.45; tint*=mix(vec3<f32>(1.0),vec3<f32>(1.06,0.96,0.76),clamp(leak*1.6,0.0,1.0)); }
`
      : ''
  }${
    L >= 5
      ? `/* --- эпик: тонкая «паутинка», микросколы и зерно --- */
var rn=1.0-abs(sdNoise(p*6.3,seed+66u)*2.0-1.0); rn=pow(rn,7.0);
var rn2=1.0-abs(sdNoise(p*13.7+4.1,seed+77u)*2.0-1.0); rn2=pow(rn2,9.0);
let craze=clamp(rn*0.55+rn2*0.45,0.0,1.0)*0.85;
dark+=craze*0.35; hgt-=craze*0.22; rough+=craze*0.15;
let mg=sdRand(vec2<i32>(floor(p*23.0)),seed+88u);
tint*=1.0+(mg-0.5)*0.10;
`
      : ''
  }dark=clamp(dark,0.0,0.90);
colMul=(1.0-dark)*tint;
rough=clamp(rough,-0.45,0.75);
hgt=clamp(hgt,-1.0,0.15);
return SDOut(colMul,hgt,rough,sgrad,cavO,depO);
}
`;
}

const MAT_WGSL = `
/* свойства материала по квадрату атласа (сетка 4×4): x — шероховатость,
   y — F0, z — металличность */
fn matOf(uv:vec2<f32>)->vec3<f32>{
let qc=vec2<i32>(floor(clamp(uv,vec2<f32>(0.0),vec2<f32>(0.9999))*4.0));
if(qc.y==0){
if(qc.x==1){return vec3<f32>(0.38,0.045,0.0);}   /* пол: бетон */
if(qc.x==2){return vec3<f32>(0.62,0.05,0.0);}    /* дерево безопасной двери */
if(qc.x==0){return vec3<f32>(0.86,0.04,0.0);}    /* кирпич */
return vec3<f32>(0.90,0.04,0.0);
}
if(qc.y==1){
if(qc.x==1){return vec3<f32>(0.55,0.32,0.30);}   /* дверь — крашеная сталь: блик фонаря не выбеливает створку */
if(qc.x==2){return vec3<f32>(0.60,0.30,0.45);}   /* её тыльная сторона: металл под краской местами облупился */
if(qc.x==0){return vec3<f32>(0.94,0.04,0.0);}    /* потолок */
if(qc.x==3){return vec3<f32>(0.66,0.24,0.78);}   /* кованое железо дверной фурнитуры: шершавее полированной стали */
return vec3<f32>(0.90,0.04,0.0);
}
if(qc.y==2){
if(qc.x<3){return vec3<f32>(0.60,0.05,0.0);}     /* шпон шкафа */
if(qc.x==3){return vec3<f32>(0.62,0.25,0.20);}   /* крашеный чугун вентиля: крестовина не зеркалит */
return vec3<f32>(0.90,0.04,0.0);
}
if(qc.x==3){return vec3<f32>(0.55,0.36,0.85);}    /* сталь стяжки стола: шлифованная, не полированная — фонарь не выбеливает её в
   полосу */
if(qc.x<3){return vec3<f32>(0.52,0.05,0.0);}      /* дерево стола */
return vec3<f32>(0.90,0.04,0.0);
}
`;

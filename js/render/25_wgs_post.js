/* --- ореолы ламп: один инстанс-дроу на все лампы --- */
const WGS_GLOW = `
${WGS_HELPERS}
${WGS_PP}
struct GOut{ @builtin(position) pos:vec4<f32>, @location(0) vQ:vec2<f32>, @location(1) vW2:vec3<f32>,
@location(2) vCol:vec3<f32> };
@vertex fn vsG(@location(0) aQ:vec2<f32>,@location(1) iPos:vec3<f32>,@location(2) iSize:f32,
@location(3) iCol:vec3<f32>)->GOut{
let V=P.m1;
let R=vec3<f32>(V[0][0],V[1][0],V[2][0]);
let Up=vec3<f32>(V[0][1],V[1][1],V[2][1]);
let w=iPos+R*(aQ.x*iSize)+Up*(aQ.y*iSize);
var o:GOut; o.vQ=aQ; o.vW2=w; o.vCol=iCol;
o.pos=P.m0*V*vec4<f32>(w,1.0);
return o; }
@fragment fn fsG(i:GOut)->@location(0) vec4<f32>{
let d=length(i.vQ);
/* вне круга — ноль вместо discard: проход аддитивный без записи глубины,
   прибавить ноль равносильно выбросить, но early-z срезает ореолы за стенами до
   шейдера (discard отключал его на весь проход) */
if(d>=1.0){return vec4<f32>(0.0);}
let core=exp(-d*d*5.5);
let edge=1.0-sstep(0.30,0.98,d);     /* ноль на краю квада — граница невидима */
var a=core*edge*edge;
let dd=distance(P.v2.xyz,i.vW2);
a*=exp(-P.v1.w*dd*dd*1.2);           /* дальние лампы не сливаются с туманом */
a*=sstep(0.25,1.15,dd);              /* у самой лампы ореол гаснет */
return vec4<f32>(i.vCol*a,a); }
`;

/* --- постобработка --- */
function wgslBright(QQ) {
  const VOL = (QQ.vol | 0) > 0;
  return `
${WGS_HELPERS}
${WGS_PP}
@group(1) @binding(0) var tS:texture_2d<f32>;
@group(1) @binding(1) var sS:sampler;
${VOL ? '@group(1) @binding(2) var tVol:texture_2d<f32>;' : ''}
@fragment fn fsB(in:VF)->@location(0) vec4<f32>{
var c=sL(tS,sS,in.uv).rgb;${VOL ? ' c+=sL(tVol,sS,in.uv).rgb;' : ''}
c=select(c,vec3<f32>(0.0),(c!=c)|(abs(c)>vec3<f32>(3.0e4)));   /* барьер NaN(x!=x)/Inf для блума: в WGSL нет isFinite */
let l=dot(c,vec3<f32>(0.299,0.587,0.114));
return vec4<f32>(c*sstep(0.40,0.88,l),1.0); }
`;
}

const WGS_DOWN = `
${WGS_HELPERS}
${WGS_PP}
@group(1) @binding(0) var tS:texture_2d<f32>;
@group(1) @binding(1) var sS:sampler;
@fragment fn fsD(in:VF)->@location(0) vec4<f32>{
let h=P.v0.xy*0.5;
let c=(sL(tS,sS,in.uv+vec2<f32>(-h.x,-h.y)).rgb+sL(tS,sS,in.uv+vec2<f32>(h.x,-h.y)).rgb
+sL(tS,sS,in.uv+vec2<f32>(-h.x,h.y)).rgb+sL(tS,sS,in.uv+vec2<f32>(h.x,h.y)).rgb)*0.25;
return vec4<f32>(c,1.0); }
`;

const WGS_UP = `
${WGS_HELPERS}
${WGS_PP}
@group(1) @binding(0) var tS:texture_2d<f32>;
@group(1) @binding(1) var sS:sampler;
@fragment fn fsU(in:VF)->@location(0) vec4<f32>{
let t=P.v0.xy;
var c=sL(tS,sS,in.uv).rgb*4.0;
c+=(sL(tS,sS,in.uv+vec2<f32>(t.x,0.0)).rgb+sL(tS,sS,in.uv-vec2<f32>(t.x,0.0)).rgb
+sL(tS,sS,in.uv+vec2<f32>(0.0,t.y)).rgb+sL(tS,sS,in.uv-vec2<f32>(0.0,t.y)).rgb)*2.0;
c+=sL(tS,sS,in.uv+vec2<f32>(t.x,t.y)).rgb+sL(tS,sS,in.uv+vec2<f32>(-t.x,t.y)).rgb
+sL(tS,sS,in.uv+vec2<f32>(t.x,-t.y)).rgb+sL(tS,sS,in.uv+vec2<f32>(-t.x,-t.y)).rgb;
return vec4<f32>(c/16.0,1.0); }
`;

const WGS_SHARP = `
${WGS_HELPERS}
${WGS_PP}
@group(1) @binding(0) var tS:texture_2d<f32>;
@group(1) @binding(1) var sS:sampler;
@fragment fn fsS(in:VF)->@location(0) vec4<f32>{
let t=P.v0.xy;
let c=sL(tS,sS,in.uv).rgb;
let n=sL(tS,sS,in.uv+vec2<f32>(0.0,t.y)).rgb;
let s=sL(tS,sS,in.uv-vec2<f32>(0.0,t.y)).rgb;
let e=sL(tS,sS,in.uv+vec2<f32>(t.x,0.0)).rgb;
let w=sL(tS,sS,in.uv-vec2<f32>(t.x,0.0)).rgb;
let mn=min(c,min(min(n,s),min(e,w)));
let mx=max(c,max(max(n,s),max(e,w)));
let r=c+(c-(n+s+e+w)*0.25)*P.v0.z;
return vec4<f32>(clamp(r,mn,mx),1.0); }
`;

function wgslComp(QQ) {
  const AO = (QQ.ssao | 0) > 0;
  const VOL = (QQ.vol | 0) > 0;
  const FLR = (QQ.flare | 0) > 0;
  const AEX = !!QQ.aexp;
  let nb = 2;
  const B = {};
  const bind = n => {
    const s = `@group(1) @binding(${n})`;
    return s;
  };
  let decl = `${bind(0)} var tScene:texture_2d<f32>;\n${bind(1)} var tBloom:texture_2d<f32>;\n`;
  B.scene = 0;
  B.bloom = 1;
  if (AO) {
    decl += `${bind(nb)} var tAO:texture_2d<f32>;\n`;
    B.ao = nb++;
  }
  if (VOL) {
    decl += `${bind(nb)} var tVol:texture_2d<f32>;\n`;
    B.vol = nb++;
  }
  if (FLR) {
    decl += `${bind(nb)} var tStk:texture_2d<f32>;\n`;
    B.stk = nb++;
  }
  if (AEX) {
    decl += `${bind(nb)} var tExp:texture_2d<f32>;\n`;
    B.exp = nb++;
  }
  decl += `${bind(nb)} var sS:sampler;\n`;
  B.samp = nb++;
  return {
    src: `
${WGS_HELPERS}
${WGS_PP}
${decl}
fn aces(x:vec3<f32>)->vec3<f32>{
let a=2.51;let b=0.03;let c=2.43;let d=0.59;let e=0.14;
return clamp((x*(a*x+b))/(x*(c*x+d)+e),vec3<f32>(0.0),vec3<f32>(1.0)); }
@fragment fn fsC(in:VF)->@location(0) vec4<f32>{
let uChase=P.v0.x;let uTime=P.v0.y;let uExp=P.v0.z;let uBloomK=P.v0.w;
let uCA=P.v1.x;let uGrain=P.v1.y;let uDarkSat=P.v1.z;let uDarkLo=P.v1.w;
let uDither=P.v2.x;let uAOK=P.v2.y;let uGrade=P.v2.z;
let q=in.uv-0.5;
let ca=uCA*dot(q,q);                   // хроматическая аберрация по краям кадра
var c=vec3<f32>(0.0);
c.r=sL(tScene,sS,in.uv+q*ca).r;
c.g=sL(tScene,sS,in.uv).g;
c.b=sL(tScene,sS,in.uv-q*ca).b;
c=select(c,vec3<f32>(0.0),(c!=c)|(abs(c)>vec3<f32>(3.0e4)));   /* барьер NaN/Inf у композита */
${AO ? 'c*=mix(1.0,sL(tAO,sS,in.uv).r,uAOK);' : ''}
c+=sL(tBloom,sS,in.uv).rgb*uBloomK;
${FLR ? 'c+=sL(tStk,sS,in.uv).rgb*P.v2.w;' : ''}
${VOL ? 'let vol=sL(tVol,sS,in.uv); c=c*vol.a+vol.rgb;' : ''}
${AEX ? 'let ex=clamp(0.18/max(sL(tExp,sS,vec2<f32>(0.5)).r,0.02),0.45,2.6); c*=ex;' : ''}
c=aces(c*uExp);
if(uGrade>0.001){   /* плёночный цветокор — тени в холод, света в тепло */
let lg2=dot(c,vec3<f32>(0.299,0.587,0.114));
c=mix(c,c*vec3<f32>(0.90,0.99,1.10),(1.0-sstep(0.0,0.30,lg2))*uGrade);
c=mix(c,c*vec3<f32>(1.06,1.00,0.93),sstep(0.45,0.90,lg2)*uGrade);
}
c=pow(max(c,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));
c=max(c-0.022,vec3<f32>(0.0))*1.07;           /* темнота настоящая, без «отрицательной» */
/* темнота НЕ подкрашивает текстуры: чем темнее пиксель, тем он нейтральнее */
let lg=dot(c,vec3<f32>(0.299,0.587,0.114));
let sat=uDarkSat+(1.0-uDarkSat)*sstep(0.0,uDarkLo,lg);
c=mix(vec3<f32>(lg),c,sat);
let vig=1.0-0.55*dot(q,q)*1.6;
c*=vig;
let edge=sstep(0.25,0.5,length(q));
c+=vec3<f32>(0.16,0.015,0.015)*edge*uChase*(0.5+0.5*sin(uTime*6.5));
let gr=dhash21(in.uv*vec2<f32>(1234.5,678.9)+uTime);
c+=(gr-0.5)*uGrain*(0.22+0.78*min(1.0,lg*1.7));   /* зерно гаснет в темноте */
c+=(dhash21(in.uv*vec2<f32>(2048.0,1536.0)+fract(uTime)*7.3)-0.5)*(uDither/255.0)*1.7;
return vec4<f32>(clamp(c,vec3<f32>(0.0),vec3<f32>(1.0)),1.0); }
`,
    bindings: B
  };
}

function wgslSsao(QQ) {
  const KN = Math.max(4, QQ.ssao | 0);
  return `
${WGS_HELPERS}
${WGS_PP}
@group(1) @binding(0) var tDep:texture_depth_2d;
@group(1) @binding(1) var sDep:sampler;
@group(1) @binding(2) var tNoise:texture_2d<f32>;
@group(1) @binding(3) var sNoise:sampler;
fn linZ(d:f32)->f32{ return -P.v1.y/(d+P.v1.x); }
fn vpos(uv:vec2<f32>,d:f32)->vec3<f32>{ let vz=linZ(d);
let nd=vec2<f32>(uv.x*2.0-1.0,1.0-uv.y*2.0);
return vec3<f32>(nd.x*(-vz)/P.v0.x,nd.y*(-vz)/P.v0.y,vz); }
@fragment fn fsAO(in:VF)->@location(0) vec4<f32>{
let uRadius=P.v1.z; let uBias=P.v1.w; let uJit=P.v2.x; let uVup=P.v2.yzw;
let uTScale=P.v0.zw;
let d=sD(tDep,sDep,in.uv);
let Pz=vpos(in.uv,d);
let dPdx=dpdx(Pz); let dPdy=dpdy(Pz);
if(d>=0.99995){ return vec4<f32>(1.0); }
var nrm=cross(dPdx,dPdy);
let nl=length(nrm);
if(nl<1e-9){ return vec4<f32>(1.0); }
nrm/=nl;
if(nrm.z<0.0){nrm=-nrm;}   /* в пространстве взгляда нормаль к камере имеет z>0 */
let rv=sL(tNoise,sNoise,in.uv*uTScale+vec2<f32>(uJit*0.371,uJit*0.713)).xyz*2.0-1.0;
var t=rv-nrm*dot(rv,nrm);
var tl=length(t);
if(tl<1e-4){
if(abs(nrm.x)>0.5){ t=vec3<f32>(0.0,1.0,0.0); }else{ t=vec3<f32>(1.0,0.0,0.0); }
t-=nrm*dot(t,nrm); tl=length(t);
}
t/=max(tl,1e-5);
let b=cross(nrm,t);
var occ=0.0; var wsum=0.0;
for(var i=0;i<${KN};i=i+1){
let sp=Pz+(t*P.k[i].x+b*P.k[i].y+nrm*P.k[i].z)*uRadius;
let cl=P.m0*vec4<f32>(sp,1.0);
if(cl.w<=1e-5){continue;}
let ss=vec2<f32>(cl.x/cl.w*0.5+0.5,0.5-cl.y/cl.w*0.5);
if(ss.x<0.0||ss.x>1.0||ss.y<0.0||ss.y>1.0){continue;}
let svz=linZ(sD(tDep,sDep,ss));
if(svz>-0.15){continue;}   /* мусор у ближней плоскости от разрешения глубины не затемняет AO */
wsum+=1.0;   /* считаем только видимые выборки, иначе AO «выцветает» у края кадра */
let rng=sstep(0.0,1.0,uRadius/max(abs(Pz.z-svz),1e-4));
if(svz>sp.z+uBias){occ+=rng;}
}
var ao=clamp(1.0-occ/max(wsum,1.0),0.0,1.0);
var fade=1.0-sstep(18.0,42.0,-Pz.z);   /* вдали AO не нужен — гасим его */
/* SSAO живёт только на горизонтальных поверхностях (пол, потолок, торцы) */
let upn=abs(dot(nrm,uVup));
fade*=sstep(0.30,0.55,upn);
ao=mix(1.0,ao,fade);
/* гасим AO на скользящих углах: иначе стена темнеет и меняет цвет при повороте
   камеры */
let ndv=dot(nrm,normalize(-Pz));
ao=mix(1.0,ao,sstep(0.12,0.34,ndv));
return vec4<f32>(ao,ao,ao,1.0); }
`;
}

const WGS_AOBLUR = `
${WGS_HELPERS}
${WGS_PP}
@group(1) @binding(0) var tS:texture_2d<f32>;
@group(1) @binding(1) var sS:sampler;
@group(1) @binding(2) var tDep:texture_depth_2d;
@group(1) @binding(3) var sDep:sampler;
fn linZb(d:f32)->f32{ return -P.v0.w/(d+P.v0.z); }
@fragment fn fsAB(in:VF)->@location(0) vec4<f32>{
let d0=sD(tDep,sDep,in.uv);
let z0=linZb(d0);
var s=sL(tS,sS,in.uv).r*0.227; var wsum=0.227;
for(var k=0;k<4;k=k+1){
var off=1.384+f32(k)*1.847; var ww=0.316;
if(k>=2){ off=1.384+f32(k-2)*1.847; ww=0.070; }
var uv=in.uv+P.v0.xy*off;
if(k>=2){ uv=in.uv-P.v0.xy*off; }
let f=exp(-abs(linZb(sD(tDep,sDep,uv))-z0)*3.0);
s+=sL(tS,sS,uv).r*ww*f; wsum+=ww*f;
}
let ao=s/max(wsum,1e-4);
return vec4<f32>(ao,ao,ao,1.0); }
`;

function wgslVol(QQ) {
  const NS = Math.max(4, QQ.vol | 0);
  return `
${WGS_HELPERS}
${WGS_PP}
@group(1) @binding(0) var tDep:texture_depth_2d;
@group(1) @binding(1) var sDep:sampler;
@group(1) @binding(2) var tLM:texture_2d<f32>;
@group(1) @binding(3) var sLin:sampler;
@group(1) @binding(4) var tPrev:texture_2d<f32>;
fn linZv(d:f32)->f32{ return -P.v1.y/(d+P.v1.x); }
fn hash21v(p:vec2<f32>)->f32{ return fract(sin(dot(p,vec2<f32>(127.1,311.7)))*43758.5453); }
fn flpP(cs:f32,co:f32,ci:f32)->f32{
if(cs<=0.0){return 0.0;}
let cone=sstep(co,ci,cs);
return 0.10+0.90*cone+0.16*sstep(co*0.93,co,cs)+0.34*cs*cs*cs*(1.0-cone);
}
fn hg(c:f32,g:f32)->f32{ let gg=g*g;
return (1.0-gg)/(4.0*3.14159265*pow(max(1.0+gg-2.0*g*c,1e-4),1.5)); }
@fragment fn fsV(in:VF)->@location(0) vec4<f32>{
let uMapSize=P.v0.xy; let uPF=P.v0.zw;
let uMaxD=P.v1.z; let uJit=P.v1.w;
let uNewW=P.v2.x; let uK1=P.v2.y; let uK2=P.v2.z; let uExt=P.v2.w;
let uCam=P.v3.xyz; let uNLv=i32(P.v3.w);
let d=sD(tDep,sDep,in.uv);
let vz=linZv(d);
let nd=vec2<f32>(in.uv.x*2.0-1.0,1.0-in.uv.y*2.0);
let pv=vec3<f32>(nd.x*(-vz)/uPF.x,nd.y*(-vz)/uPF.y,vz);
let Pw=(P.m0*vec4<f32>(pv,1.0)).xyz;
let v=Pw-uCam;
let full=length(v);
let rd=v/max(full,1e-5);
let L=min(full,uMaxD);
let NN=${NS};
let stp=L/f32(NN);
let jit=hash21v(in.uv*vec2<f32>(91.7,57.3)+vec2<f32>(uJit*13.1,uJit*7.7));
var Sc=vec3<f32>(0.0);
var T=1.0;
for(var i=0;i<NN;i=i+1){
let t=(f32(i)+0.15+0.7*jit)*stp;
let q=uCam+rd*t;
if(q.y<-0.05||q.y>${CEIL_H}+0.2){continue;}
let lm=sL(tLM,sLin,clamp(q.xz/uMapSize,vec2<f32>(0.002),vec2<f32>(0.998)));
if(lm.b>0.5){continue;}                    /* внутри стены — дымки нет */
let haze=0.45+0.55*(1.0-clamp(q.y/${CEIL_H},0.0,1.0));   /* плотнее у пола */
let lit=max(lm.r-0.03,0.0);            /* фоновый AMBIENT не даёт дымки (порог ниже AMBIENT=0.02 — в темноте дымки нет
   вовсе) */
let ins=lit*uK1*haze;                 /* фоновая дымка */
var insL=0.0;                         /* прямой вклад лампы */
for(var j=0;j<8;j=j+1){
if(j>=uNLv){break;}
let L4=P.k[j];
if(L4.w<=0.02){continue;}
let dv=vec3<f32>(L4.x,${LAMP_Y},L4.y)-q;
let dd=length(dv);
if(dd>L4.z){continue;}
if(lm.g<=0.03&&dd>1.0){continue;}        /* клетка ею не освещена — дешёвый ранний выход */
var att=1.0-dd/L4.z; att*=att;
var vis=1.0;                          /* теневой луч к лампе: 6 выборок по ВСЕЙ длине */
let dq=(vec2<f32>(L4.x,L4.y)-q.xz)*(1.0/7.0);
for(var s2=1;s2<=6;s2=s2+1){
let pp=q.xz+dq*f32(s2);
if(sL(tLM,sLin,clamp(pp/uMapSize,vec2<f32>(0.002),vec2<f32>(0.998))).b>0.5){vis=0.0;break;}
}
if(vis<=0.0){continue;}
let cs=dot(rd,dv/max(dd,1e-4));
/* фазовая функция почти изотропна (g=0.32) */
insL+=L4.w*att*hg(cs,0.32)*uK2*(0.55+0.45*haze)*vis;
}
/* объёмный конус ФОНАРЯ — столб пыли в луче (P.v4 = позиция+яркость,
   P.v5 = направление+косинус края, P.v6 = косинус ядра + дальность) */
var insF=0.0;
if(P.v4.w>0.001){
let fo2=P.v4.xyz-q; let fdd=length(fo2);
if(fdd<P.v6.y){
let sd2=(q-P.v4.xyz)/max(fdd,1e-4);
let cn2=flpP(dot(sd2,P.v5.xyz),P.v5.w,P.v6.x)*(1.0-fdd/P.v6.y);
if(cn2>0.003){
var fvis=1.0;
let dq2=(P.v4.xz-q.xz)*(1.0/6.5);
for(var s3=1;s3<=6;s3=s3+1){
let pp2=q.xz+dq2*f32(s3);
if(sL(tLM,sLin,clamp(pp2/uMapSize,vec2<f32>(0.002),vec2<f32>(0.998))).b>0.5){fvis=0.0;break;}
}
if(fvis>0.5){
insF=P.v4.w*cn2*hg(dot(rd,fo2/max(fdd,1e-4)),0.55)*uK2*2.2;
}}}}
/* тёплый оттенок рассеяния — в тон самим лампам */
Sc+=T*stp*(ins*vec3<f32>(1.0,0.84,0.66)+(insL+insF)*vec3<f32>(1.0,0.92,0.78));
T*=exp(-(uExt+(ins+insL+insF)*0.05)*stp);
}
let cur=vec4<f32>(Sc,T);
return mix(sL(tPrev,sLin,in.uv),cur,uNewW);   /* временное накопление */
}
`;
}

const WGS_STREAK = `
${WGS_HELPERS}
${WGS_PP}
@group(1) @binding(0) var tS:texture_2d<f32>;
@group(1) @binding(1) var sS:sampler;
@fragment fn fsSt(in:VF)->@location(0) vec4<f32>{
var c=vec3<f32>(0.0); var wsum=0.0;
for(var i=0;i<24;i=i+1){
let t=f32(i)/23.0-0.5;
let w=exp(-abs(t)*5.5);
let uv=in.uv+vec2<f32>(t*P.v0.x,0.0);
let s=sL(tS,sS,clamp(uv,vec2<f32>(0.0),vec2<f32>(1.0))).rgb;
c+=s*w*mix(vec3<f32>(0.62,0.76,1.0),vec3<f32>(1.0,0.82,0.62),abs(t)*2.0);
wsum+=w;
}
return vec4<f32>(c/max(wsum,1e-4)*0.62,1.0); }
`;

const WGS_ADAPT = `
${WGS_HELPERS}
${WGS_PP}
@group(1) @binding(0) var tS:texture_2d<f32>;
@group(1) @binding(1) var sS:sampler;
@group(1) @binding(2) var tPrev:texture_2d<f32>;
@fragment fn fsAd(in:VF)->@location(0) vec4<f32>{
var l=0.0;
for(var i=0;i<16;i=i+1){
let uv=vec2<f32>(f32(i%4),f32(i/4))/4.0+vec2<f32>(0.125);
let c=sL(tS,sS,uv*0.25+vec2<f32>(0.375)).rgb;
l+=log(dot(c,vec3<f32>(0.299,0.587,0.114))+0.002);
}
l=exp(l/16.0);
let pv=sL(tPrev,sS,vec2<f32>(0.5)).r;
return vec4<f32>(mix(pv,l,1.0-exp(-P.v0.x/max(P.v0.y,0.01))),0.0,0.0,1.0); }
`;

const WGS_BLIT = `
${WGS_HELPERS}
${WGS_PP}
@group(1) @binding(0) var tS:texture_2d<f32>;
@group(1) @binding(1) var sS:sampler;
@fragment fn fsBl(in:VF)->@location(0) vec4<f32>{
let uDarkSat=P.v0.x;let uDarkLo=P.v0.y;let uDither=P.v0.z;let uTime=P.v0.w;
var c=pow(max(sL(tS,sS,in.uv).rgb,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));
c=max(c-0.022,vec3<f32>(0.0))*1.07;
let lg=dot(c,vec3<f32>(0.299,0.587,0.114));
let sat=uDarkSat+(1.0-uDarkSat)*sstep(0.0,uDarkLo,lg);
c=mix(vec3<f32>(lg),c,sat);
c+=(dhash21(in.uv*vec2<f32>(2048.0,1536.0)+fract(uTime)*7.3)-0.5)*(uDither/255.0)*1.7;
return vec4<f32>(clamp(c,vec3<f32>(0.0),vec3<f32>(1.0)),1.0); }
`;

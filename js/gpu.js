const GPU={ok:false,ready:false,framesDone:0};
/* gpuBusy — resources are rebuilding (no drawing meanwhile);
   gpuInitQ — init queue: menu and game never rebuild the GPU simultaneously */
let gpuBusy=false,gpuPend=0,gpuChain=Promise.resolve();
function gpuInitQ(cv,st){gpuPend++;
const r=gpuChain.then(()=>GPU.init(cv,st));
gpuChain=r.then(()=>{gpuPend--},()=>{gpuPend--});
return r}
/* loading-screen hook: LDSTEP is set only during the boot sequence
   (f = 0..1 progress inside GPU.init); yield lets the browser paint the bar */
async function ldStep(f,label){if(window.LDSTEP)await window.LDSTEP(f,label);}
(function(){

/* ==== MATH: matrices, camera ==== */
function look(cx,cy,cz,yaw,pitch){
const cp=Math.cos(pitch),sp=Math.sin(pitch);
const f=[Math.cos(yaw)*cp, sp, Math.sin(yaw)*cp];

let r=[-f[2],0,f[0]];
const rl=Math.hypot(r[0],r[2])||1; r=[r[0]/rl,0,r[2]/rl];

const u=[r[1]*f[2]-r[2]*f[1], r[2]*f[0]-r[0]*f[2], r[0]*f[1]-r[1]*f[0]];
const m=new Float32Array(16);
m[0]=r[0];m[4]=r[1];m[8]=r[2];m[12]=-(r[0]*cx+r[1]*cy+r[2]*cz);
m[1]=u[0];m[5]=u[1];m[9]=u[2];m[13]=-(u[0]*cx+u[1]*cy+u[2]*cz);
m[2]=-f[0];m[6]=-f[1];m[10]=-f[2];m[14]=(f[0]*cx+f[1]*cy+f[2]*cz);
m[3]=0;m[7]=0;m[11]=0;m[15]=1;
return m; }
function m4mul(a,b){ const o=new Float32Array(16);
for(let i=0;i<4;i++)for(let j=0;j<4;j++){ let s=0; for(let k=0;k<4;k++) s+=a[k*4+j]*b[i*4+k]; o[i*4+j]=s; } return o; }
function m4t(x,y,z){ const m=new Float32Array(16); m[0]=1;m[5]=1;m[10]=1;m[15]=1;m[12]=x;m[13]=y;m[14]=z; return m; }
function m4rotY(a){ const c=Math.cos(a),s=Math.sin(a); const m=new Float32Array(16);
m[0]=c;m[2]=-s;m[5]=1;m[8]=s;m[10]=c;m[15]=1; return m; }
function m4rotX(a){ const c=Math.cos(a),s=Math.sin(a); const m=new Float32Array(16);
m[0]=1;m[5]=c;m[6]=s;m[9]=-s;m[10]=c;m[15]=1; return m; }
/* reflection across the floor plane y=0 (for planar reflections) */
const M4MIR=(()=>{ const m=new Float32Array(16); m[0]=1; m[5]=-1; m[10]=1; m[15]=1; return m; })();
function m4rotZ(a){ const c=Math.cos(a),s=Math.sin(a); const m=new Float32Array(16);
m[0]=c;m[1]=s;m[4]=-s;m[5]=c;m[10]=1;m[15]=1; return m; }
const IDENT=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);

let AW=768, AH=512, AQ=256;
/* ==== TEXTURES: atlas and procedural maps ==== */
function rrect(x,px,py,w,h,r){ x.beginPath(); if(x.roundRect){x.roundRect(px,py,w,h,r);return;} x.rect(px,py,w,h); }
function makeTex(fn,w,h){
const c=document.createElement('canvas'); c.width=w; c.height=h;
const x=c.getContext('2d',{willReadFrequently:true}); fn(x,w,h);
return x.getImageData(0,0,w,h); }

function heightToNormal(id,w,h,strength){
const src=id.data;
const n=w*h;
const hh=new Float32Array(n);
for(let i=0,q=0;q<n;i+=4,q++)hh[q]=src[i]*0.0039215686;
const out=new Uint8Array(n*4);
const o32=new Uint32Array(out.buffer);
const wm=w-1,hm=h-1;
let q=0;
for(let y=0;y<h;y++){
const ym=(y>0?y-1:hm)*w, yp=(y<hm?y+1:0)*w, yr=y*w;
for(let x=0;x<w;x++){
const xm=x>0?x-1:wm, xp=x<wm?x+1:0;
const dx=(hh[yr+xp]-hh[yr+xm])*strength;
const dy=(hh[yp+x]-hh[ym+x])*strength;
const il=1/Math.sqrt(dx*dx+dy*dy+1);
const r=((-dx*il)*0.5+0.5)*255;
const g=((-dy*il)*0.5+0.5)*255;
const b=(il*0.5+0.5)*255;
o32[q++]=r|((g<<8)|(b<<16)|(255<<24));
}
}
return out; }

function mirrorSquare(x,sx,sy,dx,dy,size){
const src=x.getImageData(sx,sy,size,size);
const out=x.createImageData(size,size);
const s=new Uint32Array(src.data.buffer,src.data.byteOffset,size*size);
const o=new Uint32Array(out.data.buffer,out.data.byteOffset,size*size);
for(let y=0;y<size;y++){
const sr=y*size;
for(let q2=0;q2<size;q2++)o[sr+(size-1-q2)]=s[sr+q2];
}
x.putImageData(out,dx,dy); }
function noiseInto(x,w,h,amp,rnd){
const id=x.getImageData(0,0,w,h);
const d=id.data;
const half=amp*0.5;
for(let i=0;i<d.length;i+=4){
const n=(rnd()*amp-half)|0;
let r=d[i]+n,g=d[i+1]+n,b=d[i+2]+n;
d[i]=r<0?0:(r>255?255:r);
d[i+1]=g<0?0:(g>255?255:g);
d[i+2]=b<0?0:(b>255?255:b);
}
x.putImageData(id,0,0); }
function quadUV(col,row){
const p=2*(AQ/256);
return {u0:(col*AQ+p)/AW, u1:((col+1)*AQ-p)/AW, v0:(row*AQ+p)/AH, v1:((row+1)*AQ-p)/AH}; }
let UV_WALL,UV_FLOOR,UV_WOOD,UV_CEIL,UV_IRON,UV_IRON2,UV_CAB,UV_CABIN,UV_CAB2;
let UV_TBL_TOP,UV_TBL_EDGE,UV_TBL_LEG,UV_TBL_STRAP;
let EDGE_IRON,EDGE_WOOD;
function applyAtlasQ(aq){
AQ=aq|0;AW=AQ*4;AH=AQ*4;
UV_WALL=quadUV(0,0); UV_FLOOR=quadUV(1,0); UV_WOOD=quadUV(2,0);
UV_CEIL=quadUV(0,1); UV_IRON=quadUV(1,1);
UV_IRON2=quadUV(2,1);
/* row 2 — furniture: cabinet veneer, dark interior, mirrored veneer variant */
UV_CAB=quadUV(0,2); UV_CABIN=quadUV(1,2);
UV_CAB2=quadUV(2,2);
/* row 3 — table: top plank face, edge, leg, steel tie bar. Table tiles are
   separate: in the door wood (UV_WOOD) belts and brackets are drawn in
   relief; on the table they produced layers and rings on the legs. */
UV_TBL_TOP=quadUV(0,3); UV_TBL_EDGE=quadUV(1,3);
UV_TBL_LEG=quadUV(2,3); UV_TBL_STRAP=quadUV(3,3);
EDGE_IRON=[0.875,0.125];   /* end face: matte zone (3,0), no sliding specular on the edge */
EDGE_WOOD=[UV_WOOD.u0+0.010,UV_WOOD.v1-0.014];
}
applyAtlasQ(256);

function buildAtlasData(st,qq){   /* st — the seed state (BigUint64Array), XS_TEX stream */
qq=qq||Q;
const det=Math.max(0.05,Math.min(1,(qq.det===undefined)?1:qq.det));
const micro=Math.max(0,Math.min(1,qq.micro||0));
const G=xsStream(st,XS_TEX);const rnd=G.rnd;
const texTag=G.u32()|0;   /* tag for position hashes (brick-corner hash) */
const rr=(a,b)=>a+rnd()*(b-a);
const k=AQ/256;
const H=256;
const N=(base,extra)=>Math.max(0,Math.round(base*det+(extra||0)*micro));
const P=(p)=>rnd()<p*det+ (micro*0.15);
/* brick corner hash: identical for both halves of a brick cut by the atlas
 square edge (cw4 = column modulo 4) — the halves stay consistent */
const chH=(r,cw4,ci)=>{ let h=Math.imul(r+11,374761393)^Math.imul(cw4+23,668265263)^Math.imul(ci+7,1442695041)^Math.imul((texTag>>>0)+91,2246822519); h=Math.imul(h^(h>>>13),1274126177); return ((h^(h>>>16))>>>0)/4294967296; };
/* big blotches are drawn at 9 (torus) offsets: a blotch crossing the square
 edge continues on the neighbor cell face — the seam is invisible */
const wrap9=(fx,fy,fn)=>{ for(const dy of[-H,0,H])for(const dx of[-H,0,H])fn(fx+dx,fy+dy); };
const col=makeTex((x)=>{
x.scale(k,k);
x.fillStyle='#191c21'; x.fillRect(0,0,1024,1024);   /* background: unused tiles must not be transparent (else mips pull alpha 0);
 dark — the door end-face samples it as albedo */
x.fillStyle='#454a54'; x.fillRect(0,0,H,H);   /* mortar is grey, not black */
const rows=10, bh=H/rows, bw=H/4;

if(micro>0){
for(let i=0;i<N(0,26);i++){
x.fillStyle='rgba('+(rr(24,58)|0)+','+(rr(26,58)|0)+','+(rr(30,60)|0)+','+rr(0.10,0.30).toFixed(2)+')';
const ex=rr(0,H),ey=rr(0,H),e1=rr(6,34),e2=rr(4,20),e3=rr(0,3);
wrap9(ex,ey,(X,Y)=>{x.beginPath();x.ellipse(X,Y,e1,e2,e3,0,7);x.fill();});
}
}
for(let r=0;r<rows;r++) {
const off=(r%2)*(bw/2);
for(let cX=-1;cX<5;cX++) {
const cw4=((cX%4)+4)%4;
const bhsh=(((r*73856093)^((cw4+8)*19349663))>>>0)/4294967296;
const br=xsSub(st,0x1000+r*4+cw4).rnd;   /* keyed by (row, cw4): both halves of a brick cut by the atlas edge stay identical */
const brr=(a,b)=>a+br()*(b-a);
let hue,sat,l;
if(bhsh<0.16){ hue=rr(12,28); sat=rr(10,20)*(0.5+0.5*det); l=rr(25,34); }
else { hue=rr(206,224); sat=rr(5,10)*(0.6+0.4*det); l=rr(20,31)*(1-0.10*(1-det)); }
x.fillStyle='hsl('+hue.toFixed(0)+','+sat.toFixed(0)+'%,'+l.toFixed(0)+'%)';
const bx0=cX*bw+off+2, by0=r*bh+2, bW0=bw-4, bH0=bh-4;
rrect(x,bx0,by0,bW0,bH0,2.6); x.fill();
const g=x.createLinearGradient(0,r*bh,0,r*bh+bh);
g.addColorStop(0,'rgba(255,255,255,0.07)');g.addColorStop(0.55,'rgba(255,255,255,0)');
g.addColorStop(1,'rgba(0,0,0,0.25)');
x.fillStyle=g; rrect(x,bx0,by0,bW0,bH0,2.6); x.fill();

if(micro>0){
const bx=cX*bw+off+2, by=r*bh+2, bW=bw-4, bH=bh-4;
for(let i=0;i<N(0,26);i++){
const a=rr(0.05,0.20)*micro;
x.fillStyle=(br()<0.5?'rgba(255,246,232,':'rgba(10,10,14,')+a.toFixed(3)+')';
x.fillRect(bx+brr(0,bW),by+brr(0,bH),brr(0.8,2.6),brr(0.8,2.6));
}
if(br()<0.30*micro){
const gx=bx+brr(4,bW-8), gw=brr(3,9);
const gs=x.createLinearGradient(0,by+bH*0.35,0,by+bH);
gs.addColorStop(0,'rgba(226,228,220,0)');gs.addColorStop(1,'rgba(226,228,220,'+(0.10*micro).toFixed(3)+')');
x.fillStyle=gs;x.fillRect(gx,by+bH*0.35,gw,bH*0.65);
}
if(br()<0.42){
x.fillStyle='rgba(198,196,186,'+(0.05+0.05*micro).toFixed(3)+')';
x.fillRect(bx,by,bW,brr(0.8,1.8));
}
/* albedo chips: the same corners and radii as in the height map (chH) —
 upper and lower brick corners, halves across the square edge all match */
for(let ci=0;ci<4;ci++){
const mi=cX+((ci===1||ci===3)?1:0), e=r+((ci>=2)?1:0); const mw4=((mi%4)+4)%4;
const hh=chH(mw4,e,0); if(hh<0.30){
const rd=2+chH(mw4,e,64)*2.6, ang=chH(mw4,e,131)*3.1416, ecc=0.70+0.30*chH(mw4,e,197);
const cxp=bx+((ci===1||ci===3)?bW:0), cyp=by+(ci>=2?bH:0);
x.fillStyle='rgba(62,60,56,0.68)'; x.beginPath(); x.ellipse(cxp,cyp,rd,rd*ecc,ang,0,7); x.fill();
x.strokeStyle='rgba(228,216,198,0.38)'; x.lineWidth=1.1;
x.beginPath(); x.ellipse(cxp,cyp,rd*0.72,rd*0.72*ecc,ang,Math.PI*1.02,Math.PI*1.78); x.stroke(); } }
}
}
}
for(let i=0;i<N(6,4);i++){
x.fillStyle='rgba('+(140+rr(0,40)|0)+','+(142+rr(0,40)|0)+','+(135+rr(0,40)|0)+',0.09)';
const ex=rr(0,H),ey=rr(0,H),e1=rr(18,60),e2=rr(12,40),e3=rr(0,3);
wrap9(ex,ey,(X,Y)=>{x.beginPath();x.ellipse(X,Y,e1,e2,e3,0,7);x.fill();});
}
for(let i=0;i<N(12,8);i++){
const gx=rr(0,H),gy=rr(0,H),gr=rr(24,80);
wrap9(gx,gy,(X,Y)=>{
const g=x.createRadialGradient(X,Y,0,X,Y,gr);
g.addColorStop(0,'rgba(0,0,0,0.28)');g.addColorStop(1,'rgba(0,0,0,0)');
x.fillStyle=g;x.fillRect(X-gr,Y-gr,gr*2,gr*2);});
}

x.fillStyle='#2b2e34'; x.fillRect(H,0,H,H);
for(let i=0;i<2;i++)for(let j=0;j<2;j++){
const sx=H+i*H/2, sy=j*H/2;
x.fillStyle='hsl(216,'+rr(4,9).toFixed(0)+'%,'+rr(17,25).toFixed(0)+'%)';
x.fillRect(sx,sy,H/2,H/2);
const g=x.createLinearGradient(sx,sy,sx+H/2,sy+H/2);
g.addColorStop(0,'rgba(255,255,255,0.05)');g.addColorStop(1,'rgba(0,0,0,0.18)');
x.fillStyle=g;x.fillRect(sx,sy,H/2,H/2);
for(let q=0;q<N(240,220);q++){
x.fillStyle='rgba('+(rr(90,150)|0)+','+(rr(95,150)|0)+','+(rr(100,150)|0)+','+rr(0.03,0.10).toFixed(2)+')';
x.fillRect(sx+rr(0,H/2),sy+rr(0,H/2),rr(1,2.4),rr(1,2.4));
}
if(micro>0){
for(let q=0;q<N(0,26);q++){
const px=sx+rr(4,H/2-4),py=sy+rr(4,H/2-4),pr=rr(1.2,3.4);
const gp=x.createRadialGradient(px-pr*0.3,py-pr*0.3,0,px,py,pr);
gp.addColorStop(0,'rgba('+(rr(150,196)|0)+','+(rr(150,196)|0)+','+(rr(152,198)|0)+','+(0.30*micro).toFixed(2)+')');
gp.addColorStop(1,'rgba(60,64,72,'+(0.22*micro).toFixed(2)+')');
x.fillStyle=gp;x.beginPath();x.ellipse(px,py,pr,pr*rr(0.7,1.0),rr(0,3),0,7);x.fill();
}
for(let q=0;q<N(0,7);q++){
const px=sx+rr(6,H/2-6),py=sy+rr(6,H/2-6),pr=rr(8,26);
const gs=x.createRadialGradient(px,py,0,px,py,pr);
gs.addColorStop(0,'rgba(226,232,240,'+(0.055*micro).toFixed(3)+')');
gs.addColorStop(1,'rgba(226,232,240,0)');
x.fillStyle=gs;x.beginPath();x.ellipse(px,py,pr,pr*rr(0.35,0.7),rr(0,3),0,7);x.fill();
}
for(let q=0;q<N(0,10);q++){
x.strokeStyle='rgba(210,216,226,'+(0.03+0.05*micro).toFixed(3)+')';x.lineWidth=rr(0.7,2.0);
const px=sx+rr(2,H/2-2),py=sy+rr(2,H/2-2);
x.beginPath();x.moveTo(px,py);x.lineTo(px+rr(-30,30),py+rr(-30,30));x.stroke();
}
}
}

{
const X=2*H, Y=0;
/* wooden door leaf — clean planks (hardware is volumetric, see
 buildSafeHwData). Relief matches the planks; belts and the handle cast only
 contact shadows: metal is never drawn into the wood albedo. */
const kp=(i)=>{const r=xsSub(st,0x2000+i).rnd;
return {has:r()<0.72,kx:r(),ky:r(),ca:r(),cb:r(),shas:r()<0.6,sx:r(),top:r()<0.5,sl:r()};};
const grJ=(yy,i)=>Math.sin(yy*0.085+i*13.7)*0.7+Math.sin(yy*0.021+i*5.3)*0.55;   /* groove jitter: shared by albedo and relief */
x.fillStyle='#140c05'; x.fillRect(X,Y,H,H);
const planks=5, pw=H/planks;
for(let i=0;i<planks;i++){
const px=X+i*pw, K=kp(i);
const br=xsSub(st,0x3000+i).rnd;
const brr=(a,b)=>a+br()*(b-a);
var hue=brr(19,30)|0, sat=brr(24,36)|0, li=brr(13,21)|0;
if(br()<0.14){hue=brr(24,40)|0;sat=brr(7,13)|0;li=brr(17,24)|0;}   /* grey repair plank */
const gB=x.createLinearGradient(px,0,px+pw,0);
gB.addColorStop(0,'hsl('+hue+','+sat+'%,'+(li+3)+'%)');
gB.addColorStop(0.12,'hsl('+hue+','+sat+'%,'+(li+1)+'%)');
gB.addColorStop(0.55,'hsl('+hue+','+sat+'%,'+li+'%)');
gB.addColorStop(1,'hsl('+(hue-2)+','+sat+'%,'+(li-3)+'%)');
x.fillStyle=gB; x.fillRect(px,Y,pw,H);
x.save(); x.beginPath(); x.rect(px+1.5,Y,pw-3,H); x.clip();
for(let g2=0;g2<N(52,44);g2++){                     /* grain: long wavy two-tone strokes */
const gx=px+brr(2,pw-2), dark=br()<0.62;
x.strokeStyle=dark?'rgba(30,17,7,'+brr(0.05,0.20).toFixed(3)+')':'rgba(170,128,80,'+brr(0.05,0.12).toFixed(3)+')';
x.lineWidth=brr(0.5,1.7);
const ph=brr(0,6.3), am=brr(0.6,2.4), ww=brr(0.015,0.05);
x.beginPath(); x.moveTo(gx,Y);
for(let yy=0;yy<=H;yy+=12)x.lineTo(gx+Math.sin(yy*ww+ph)*am,Y+yy);
x.stroke(); }
if(br()<0.8){                                       /* cathedral figure: nested saw arcs */
const kx=px+pw*brr(0.25,0.75), ky=Y+brr(-0.25,1.25)*H, st=3+(brr(0,3)|0);
for(let q2=1;q2<=st;q2++){
x.strokeStyle='rgba(46,26,12,'+brr(0.10,0.20).toFixed(3)+')'; x.lineWidth=brr(0.9,1.8);
x.beginPath(); x.ellipse(kx,ky,q2*brr(2.6,3.6),q2*brr(7,11),brr(-0.06,0.06),0,7); x.stroke(); } }
if(K.has){                                          /* knot: rings, dark core, radial cracks */
const kx=px+pw*(0.3+0.4*K.kx), ky=Y+H*(0.12+0.76*K.ky);
for(let q2=5;q2>0;q2--){
x.strokeStyle='rgba(24,13,6,'+(0.62-q2*0.09).toFixed(2)+')'; x.lineWidth=1.4;
x.beginPath(); x.ellipse(kx,ky,q2*2.1,q2*3.4,K.ca-0.5,0,7); x.stroke(); }
x.fillStyle='rgba(14,8,3,0.9)'; x.beginPath(); x.ellipse(kx,ky,1.7,2.6,0,0,7); x.fill();
x.strokeStyle='rgba(20,11,5,0.55)'; x.lineWidth=0.9;
x.beginPath(); x.moveTo(kx,ky-3); x.lineTo(kx+(K.ca*4-2),ky-brr(10,26)); x.stroke();
x.beginPath(); x.moveTo(kx,ky+3); x.lineTo(kx+(K.cb*4-2),ky+brr(10,26)); x.stroke(); }
for(let q2=0;q2<N(0,6);q2++){                       /* dents: soft dark spots */
const dx2=px+brr(3,pw-3), dy2=Y+brr(0,H), dr=brr(2,7);
const gD=x.createRadialGradient(dx2,dy2,0,dx2,dy2,dr);
gD.addColorStop(0,'rgba(10,6,3,'+brr(0.10,0.20).toFixed(3)+')'); gD.addColorStop(1,'rgba(10,6,3,0)');
x.fillStyle=gD; x.fillRect(dx2-dr,dy2-dr,dr*2,dr*2); }
if(micro>0){
for(let q2=0;q2<N(0,16);q2++){                      /* light scratches */
x.strokeStyle='rgba(226,198,150,'+(0.04*micro+0.02).toFixed(3)+')'; x.lineWidth=brr(0.4,1.0);
const sx2=px+brr(2,pw-2), sy2=Y+brr(0,H);
x.beginPath(); x.moveTo(sx2,sy2); x.lineTo(sx2+brr(-3,3),sy2+brr(-14,14)); x.stroke(); }
for(let q2=0;q2<N(0,5);q2++){                       /* weathered grey stains */
const wx2=px+brr(0,pw), wy2=Y+brr(0,H), wr=brr(6,20);
const gW=x.createRadialGradient(wx2,wy2,0,wx2,wy2,wr);
gW.addColorStop(0,'rgba(146,140,128,'+(0.07*micro).toFixed(3)+')'); gW.addColorStop(1,'rgba(146,140,128,0)');
x.fillStyle=gW; x.fillRect(wx2-wr,wy2-wr,wr*2,wr*2); } }
x.restore();
x.fillStyle='rgba(232,196,146,0.10)'; x.fillRect(px+1.2,Y,1.6,H);   /* chamfer: light from the left */
x.fillStyle='rgba(0,0,0,0.34)'; x.fillRect(px+pw-2.6,Y,2.2,H);      /* chamfer shadow on the right */
if(K.shas){                                       /* end gap: a wedge from the edge */
const sx2=px+6+(pw-12)*K.sx, len=26+54*K.sl;
x.strokeStyle='rgba(12,7,3,0.75)'; x.lineWidth=1.3;
x.beginPath(); x.moveTo(sx2,K.top?Y:Y+H);
for(let yy=0;yy<=len;yy+=8)x.lineTo(sx2+Math.sin(yy*0.11)*1.2,K.top?Y+yy:Y+H-yy);
x.stroke(); }
}
for(let i=1;i<planks;i++){                        /* groove between planks: uneven gap + edge highlight */
const gx=X+i*pw;
x.strokeStyle='rgba(7,4,2,0.92)'; x.lineWidth=2.4;
x.beginPath(); x.moveTo(gx+grJ(0,i),Y);
for(let yy=0;yy<=H;yy+=16)x.lineTo(gx+grJ(yy,i),Y+yy);
x.stroke();
x.strokeStyle='rgba(214,178,128,0.09)'; x.lineWidth=1.0;
x.beginPath(); x.moveTo(gx-2.4+grJ(0,i),Y);
for(let yy=0;yy<=H;yy+=16)x.lineTo(gx-2.4+grJ(yy,i),Y+yy);
x.stroke(); }
for(const cy of [0.2175,0.7675]){                 /* belt contact shadows (belts are geometry; v is inverted to the leaf y) */
const y0=Y+(cy-0.0463)*H, y1=Y+(cy+0.0463)*H;
for(const e of [[y0,-1],[y1,1]]){
const ye=e[0], sg=e[1];
const gS=x.createLinearGradient(0,ye,0,ye+sg*9);
gS.addColorStop(0,'rgba(0,0,0,0.52)'); gS.addColorStop(1,'rgba(0,0,0,0)');
x.fillStyle=gS; x.fillRect(X,Math.min(ye,ye+sg*9),H,9);
x.fillStyle='rgba(0,0,0,0.30)'; x.fillRect(X,sg<0?ye-1.6:ye,H,1.6); } }
{                                                 /* handle: AO ring around the boss */
const hx2=X+H*0.76, hy2=Y+H*0.58;
const gA=x.createRadialGradient(hx2,hy2,H*0.050,hx2,hy2,H*0.095);
gA.addColorStop(0,'rgba(0,0,0,0.34)'); gA.addColorStop(1,'rgba(0,0,0,0)');
x.fillStyle=gA; x.fillRect(hx2-H*0.09,hy2-H*0.09,H*0.18,H*0.18); }
const wear=x.createLinearGradient(0,Y+H*0.80,0,Y+H);
wear.addColorStop(0,'rgba(0,0,0,0)'); wear.addColorStop(1,'rgba(4,3,1,0.42)');
x.fillStyle=wear; x.fillRect(X,Y+H*0.80,H,H*0.20);
x.fillStyle='rgba(206,196,176,0.05)'; x.fillRect(X,Y,H,H*0.03);
x.strokeStyle='rgba(0,0,0,0.42)'; x.lineWidth=2; x.strokeRect(X+1,Y+1,H-2,H-2);
x.strokeStyle='rgba(255,222,170,0.06)'; x.lineWidth=1; x.strokeRect(X+2.5,Y+2.5,H-5,H-5);
}
x.fillStyle='#191c22'; x.fillRect(0,H,H,H);
for(let i=0;i<N(9,8);i++){
const gx=rr(0,H),gy=H+rr(0,H),gr=rr(14,52);
wrap9(gx,gy,(X,Y)=>{
const g=x.createRadialGradient(X,Y,gr*0.55,X,Y,gr);
g.addColorStop(0,'rgba(70,56,36,0)');g.addColorStop(0.75,'rgba(72,58,38,0.14)');g.addColorStop(1,'rgba(70,56,36,0)');
x.fillStyle=g;x.fillRect(X-gr,Y-gr,gr*2,gr*2);});
}
for(let i=0;i<N(400,420);i++){ x.fillStyle='rgba(255,255,255,'+rr(0.01,0.035).toFixed(3)+')';
x.fillRect(rr(0,H),H+rr(0,H),rr(1,3),rr(1,3)); }
if(micro>0){
for(let i=0;i<N(0,10);i++){
const gx=rr(0,H),gy=H+rr(0,H);
x.fillStyle='rgba('+(rr(120,160)|0)+','+(rr(122,160)|0)+','+(rr(118,152)|0)+','+(0.07*micro).toFixed(3)+')';
const pts=[]; for(let q=0;q<6;q++)pts.push([rr(-16,16),rr(-14,14)]);
wrap9(gx,gy,(X,Y)=>{x.beginPath();x.moveTo(X,Y);
for(const q of pts)x.lineTo(X+q[0],Y+q[1]);
x.closePath();x.fill();});
}
for(let i=0;i<N(0,9);i++){
const gx=rr(0,H),gy=H+rr(0,H),gr=rr(5,18);
wrap9(gx,gy,(X,Y)=>{
const g=x.createRadialGradient(X,Y,0,X,Y,gr);
g.addColorStop(0,'rgba(126,70,32,'+(0.24*micro).toFixed(2)+')');g.addColorStop(1,'rgba(126,70,32,0)');
x.fillStyle=g;x.fillRect(X-gr,Y-gr,gr*2,gr*2);});
}
}

{
const X=H, Y=H;
const g0=x.createLinearGradient(X,Y,X+H,Y+H);
g0.addColorStop(0,'#3f454d');g0.addColorStop(0.5,'#363c44');g0.addColorStop(1,'#2e333a');
x.fillStyle=g0; x.fillRect(X,Y,H,H);
for(let i=0;i<N(420,380);i++){ x.fillStyle='rgba(255,255,255,'+rr(0.012,0.05).toFixed(3)+')';
const lx=X+rr(0,H); x.fillRect(lx,Y,1,H); }
for(let i=0;i<N(150,140);i++){ x.fillStyle='rgba(0,0,0,'+rr(0.02,0.08).toFixed(3)+')';
const lx=X+rr(0,H); x.fillRect(lx,Y,rr(1,2),H); }
x.strokeStyle='rgba(8,10,14,0.92)'; x.lineWidth=9;
x.strokeRect(X+11,Y+11,H-22,H-22);
x.strokeStyle='rgba(196,206,218,0.16)'; x.lineWidth=2;
x.strokeRect(X+16.5,Y+16.5,H-33,H-33);
const panel=(px,py,pw2,ph2)=>{
const g1=x.createLinearGradient(px,py,px,py+ph2);
g1.addColorStop(0,'#272c33');g1.addColorStop(0.5,'#30363e');g1.addColorStop(1,'#23272e');
x.fillStyle=g1;x.fillRect(px,py,pw2,ph2);
x.strokeStyle='rgba(0,0,0,0.85)';x.lineWidth=3;x.strokeRect(px,py,pw2,ph2);
x.strokeStyle='rgba(210,220,232,0.14)';x.lineWidth=1.5;
x.beginPath();x.moveTo(px+2,py+ph2-2);x.lineTo(px+2,py+2);x.lineTo(px+pw2-2,py+2);x.stroke();
x.strokeStyle='rgba(0,0,0,0.5)';
x.beginPath();x.moveTo(px+pw2-2,py+2);x.lineTo(px+pw2-2,py+ph2-2);x.lineTo(px+2,py+ph2-2);x.stroke();
if(micro>0){
x.strokeStyle='rgba(150,160,172,'+(0.10*micro).toFixed(3)+')';x.lineWidth=1.6;
x.setLineDash&&x.setLineDash([3,2.5]);
x.beginPath();x.moveTo(px+8,py+ph2*0.5);x.lineTo(px+pw2-8,py+ph2*0.5);x.stroke();
x.setLineDash&&x.setLineDash([]);
for(let q=0;q<N(0,26);q++){
x.fillStyle='rgba(0,0,0,'+(0.05*micro+0.02).toFixed(3)+')';
x.fillRect(px+rr(4,pw2-6),py+rr(4,ph2-6),rr(2,10),rr(1,4));
}
}
};
panel(X+30,Y+30,H-60,H*0.26);
panel(X+30,Y+H*0.60,H-60,H*0.26);
for(let i=0;i<22;i++){
const t=i/22;
const pts=[[X+21,Y+21+t*(H-42)],[X+H-21,Y+21+t*(H-42)],
[X+21+t*(H-42),Y+21],[X+21+t*(H-42),Y+H-21]];
for(let q=0;q<4;q++){
const ax=pts[q][0],ay=pts[q][1];
const g2=x.createRadialGradient(ax-1,ay-1,0,ax,ay,4.2);
g2.addColorStop(0,'rgba(226,233,242,0.8)');g2.addColorStop(0.6,'rgba(120,130,142,0.5)');
g2.addColorStop(1,'rgba(14,17,21,0.95)');
x.fillStyle=g2;x.beginPath();x.arc(ax,ay,3.3,0,7);x.fill();
}
}
{
const sx=X+H/2-30, sy=Y+30+H*0.13-11;
x.fillStyle='rgba(10,14,12,0.9)';x.fillRect(sx-3,sy-3,66,26);
x.fillStyle='#0d3d24';x.fillRect(sx,sy,60,20);
x.fillStyle='#68ffa8';x.font='bold 13px sans-serif';x.textAlign='center';x.textBaseline='middle';
x.fillText('ВЫХОД',sx+30,sy+11);
x.textAlign='left';x.textBaseline='alphabetic';
if(micro>0){
x.fillStyle='rgba(190,210,200,'+(0.05*micro).toFixed(3)+')';x.fillRect(sx,sy,60,20);
x.strokeStyle='rgba(220,240,230,'+(0.07*micro).toFixed(3)+')';x.lineWidth=0.7;
for(let q=0;q<5;q++){const lx=sx+rr(2,58);x.beginPath();x.moveTo(lx,sy+rr(1,19));x.lineTo(lx+rr(-8,8),sy+rr(1,19));x.stroke()}
}
}
x.save(); x.beginPath(); x.rect(X+30,Y+H*0.895,H-60,H*0.055); x.clip();
for(let i=-6;i<18;i++){
x.fillStyle=(i%2)?'#c2992e':'#10131a';
x.beginPath(); x.moveTo(X+30+i*16,Y+H*0.895); x.lineTo(X+30+i*16+8,Y+H*0.895);
x.lineTo(X+30+i*16+8-H*0.055,Y+H*0.95); x.lineTo(X+30+i*16-H*0.055,Y+H*0.95); x.fill();
}
x.restore();
if(micro>0){
x.save();x.beginPath();x.rect(X+30,Y+H*0.895,H-60,H*0.055);x.clip();
for(let q=0;q<N(0,26);q++){
x.fillStyle='rgba(28,30,34,'+(0.10+0.20*micro).toFixed(2)+')';
x.fillRect(X+30+rr(0,H-60),Y+H*0.895+rr(0,H*0.055),rr(3,16),rr(1,H*0.055));
}
x.restore();
}
for(let i=0;i<N(7,8);i++){
const gx=X+rr(0,H),gy=Y+H*0.55+rr(0,H*0.45),gr=rr(10,34);
const g5=x.createRadialGradient(gx,gy,0,gx,gy,gr);
g5.addColorStop(0,'rgba(122,66,28,0.30)');g5.addColorStop(0.6,'rgba(96,52,22,0.14)');
g5.addColorStop(1,'rgba(80,44,18,0)');
x.fillStyle=g5;x.fillRect(gx-gr,gy-gr,gr*2,gr*2);
}
if(micro>0){
for(let i=0;i<N(0,12);i++){
const gx=X+rr(6,H-6),gy=Y+rr(H*0.35,H-10),gl=rr(10,50);
const g6=x.createLinearGradient(0,gy,0,gy+gl);
g6.addColorStop(0,'rgba(126,66,26,'+(0.24*micro).toFixed(2)+')');g6.addColorStop(1,'rgba(126,66,26,0)');
x.fillStyle=g6;x.fillRect(gx,gy,rr(1.0,2.6),gl);
}
for(let i=0;i<N(0,14);i++){
const gx=X+rr(4,H-8),gy=Y+rr(4,H-8);
x.fillStyle='rgba('+(rr(150,190)|0)+','+(rr(158,196)|0)+','+(rr(166,204)|0)+','+(0.16*micro).toFixed(2)+')';
x.beginPath();x.ellipse(gx,gy,rr(1.5,5),rr(1,3.4),rr(0,3),0,7);x.fill();
}
}
for(let i=0;i<N(12,14);i++){
x.strokeStyle='rgba(200,210,222,'+rr(0.05,0.16).toFixed(2)+')';x.lineWidth=rr(0.5,1.1);
const sx2=X+rr(0,H),sy2=Y+rr(0,H);
x.beginPath();x.moveTo(sx2,sy2);x.lineTo(sx2+rr(-26,26),sy2+rr(-16,16));x.stroke();
}
}

/* ==== the iron door BACK (tile 2,1): the leaf is two-sided, both faces need
albedo. Same hardware language as the front, no sign and no hazard stripe;
the paint has flaked in places (matOf gives this zone metal 0.45). ==== */
{
const X=2*H, Y=H;
const g0=x.createLinearGradient(X,Y+H,X+H,Y);
g0.addColorStop(0,'#383e46');g0.addColorStop(0.5,'#31373f');g0.addColorStop(1,'#2a2f36');
x.fillStyle=g0; x.fillRect(X,Y,H,H);
for(let i=0;i<N(380,340);i++){ x.fillStyle='rgba(255,255,255,'+rr(0.010,0.04).toFixed(3)+')';
const lx=X+rr(0,H); x.fillRect(lx,Y,1,H); }
for(let i=0;i<N(120,110);i++){ x.fillStyle='rgba(0,0,0,'+rr(0.02,0.08).toFixed(3)+')';
const lx=X+rr(0,H); x.fillRect(lx,Y,rr(1,2),H); }
x.strokeStyle='rgba(8,10,14,0.92)'; x.lineWidth=9;
x.strokeRect(X+11,Y+11,H-22,H-22);
x.strokeStyle='rgba(196,206,218,0.14)'; x.lineWidth=2;
x.strokeRect(X+16.5,Y+16.5,H-33,H-33);
const pan=(px,py,pw2,ph2)=>{
const g1=x.createLinearGradient(px,py,px,py+ph2);
g1.addColorStop(0,'#252a31');g1.addColorStop(0.5,'#2d333b');g1.addColorStop(1,'#22262c');
x.fillStyle=g1;x.fillRect(px,py,pw2,ph2);
x.strokeStyle='rgba(0,0,0,0.85)';x.lineWidth=3;x.strokeRect(px,py,pw2,ph2);
x.strokeStyle='rgba(210,220,232,0.12)';x.lineWidth=1.5;
x.beginPath();x.moveTo(px+2,py+ph2-2);x.lineTo(px+2,py+2);x.lineTo(px+pw2-2,py+2);x.stroke();
x.strokeStyle='rgba(0,0,0,0.5)';
x.beginPath();x.moveTo(px+pw2-2,py+2);x.lineTo(px+pw2-2,py+ph2-2);x.lineTo(px+2,py+ph2-2);x.stroke(); };
pan(X+30,Y+30,H-60,H*0.26);
pan(X+30,Y+H*0.60,H-60,H*0.26);
for(let i=0;i<22;i++){
const t=i/22;
const pts=[[X+21,Y+21+t*(H-42)],[X+H-21,Y+21+t*(H-42)],
[X+21+t*(H-42),Y+21],[X+21+t*(H-42),Y+H-21]];
for(let q=0;q<4;q++){
const ax=pts[q][0],ay=pts[q][1];
const g2=x.createRadialGradient(ax-1,ay-1,0,ax,ay,4.2);
g2.addColorStop(0,'rgba(226,233,242,0.75)');g2.addColorStop(0.6,'rgba(120,130,142,0.5)');
g2.addColorStop(1,'rgba(14,17,21,0.95)');
x.fillStyle=g2;x.beginPath();x.arc(ax,ay,3.3,0,7);x.fill();
}
}
/* flaked paint: bare metal core with a rust halo */
for(let i=0;i<N(9,10);i++){
const gx=X+rr(14,H-14),gy=Y+rr(14,H-14),gr=rr(8,30);
const g5=x.createRadialGradient(gx,gy,0,gx,gy,gr);
g5.addColorStop(0,'rgba(122,128,138,0.55)');g5.addColorStop(0.55,'rgba(96,62,30,0.30)');
g5.addColorStop(1,'rgba(80,44,18,0)');
x.fillStyle=g5;x.fillRect(gx-gr,gy-gr,gr*2,gr*2);
}
}

/* ==== ROW 2: cabinet furniture wood. Veneer: grain along V, thin wavy
 fibers and pores along it, tonal blotches. No planks or drawer hoops —
 cabinet hardware is separate. Face cuts take INNER sub-rects of the tiles
 (see cabPartX), so tile edges and mirror-copy seams never land in UV. ==== */
{
const X=0,Y=2*H;
x.fillStyle='#31200e'; x.fillRect(X,Y,H,H);
for(let i=0;i<N(9,7);i++){                     /* veneer tonal blotches */
const gx=rr(0,H),gy=Y+rr(0,H),gr=rr(28,84);
const g=x.createRadialGradient(gx,gy,gr*0.25,gx,gy,gr);
if(rnd()<0.5){g.addColorStop(0,'rgba(98,66,32,0.20)');}else{g.addColorStop(0,'rgba(22,13,6,0.22)');}
g.addColorStop(1,'rgba(0,0,0,0)');
x.fillStyle=g;x.fillRect(gx-gr,gy-gr,gr*2,gr*2);
}
for(let i=0;i<N(6,4);i++){                     /* wide soft bands of veneer tone */
const bx=rr(0,H),bw2=rr(14,60),lt=rnd()<0.5;
const g=x.createLinearGradient(X+bx-bw2,0,X+bx+bw2,0);
g.addColorStop(0,'rgba(0,0,0,0)');
g.addColorStop(0.5,lt?'rgba(126,90,46,0.10)':'rgba(10,6,2,0.13)');
g.addColorStop(1,'rgba(0,0,0,0)');
x.fillStyle=g;x.fillRect(X+bx-bw2,Y,bw2*2,H);
}
for(let i=0;i<N(150,120);i++){                 /* fibers: wavy lines along V */
const gx=rr(1.5,H-1.5),ph=rr(0,6.283),am=rr(0.5,2.4),ww=rr(0.02,0.09);
if(rnd()<0.62)x.strokeStyle='rgba('+(rr(30,58)|0)+','+(rr(18,36)|0)+','+(rr(7,16)|0)+','+rr(0.10,0.30).toFixed(2)+')';
else x.strokeStyle='rgba('+(rr(122,168)|0)+','+(rr(88,120)|0)+','+(rr(48,70)|0)+','+rr(0.05,0.14).toFixed(2)+')';
x.lineWidth=rr(0.5,1.7);
x.beginPath();x.moveTo(gx+Math.sin(ph)*am,Y);
for(let yy=8;yy<=H;yy+=8)x.lineTo(gx+Math.sin(yy*ww+ph)*am,Y+yy);
x.stroke();
}
for(let i=0;i<N(90,70);i++){                   /* pores — short strokes along the grain */
x.fillStyle='rgba(16,9,4,'+rr(0.10,0.26).toFixed(2)+')';
x.fillRect(X+rr(0,H),Y+rr(0,H),rr(0.6,1.4),rr(3,9));
}
const gs=x.createLinearGradient(X,0,X+H,0);    /* soft sheen across the grain */
gs.addColorStop(0,'rgba(255,226,180,0.05)');gs.addColorStop(0.5,'rgba(0,0,0,0)');
gs.addColorStop(1,'rgba(0,0,0,0.10)');
x.fillStyle=gs;x.fillRect(X,Y,H,H);
}
{
const X=H,Y=2*H;                               /* interior: dark raw board */
x.fillStyle='#1c130a'; x.fillRect(X,Y,H,H);
for(let i=0;i<N(8,6);i++){
const gx=rr(0,H),gy=Y+rr(0,H),gr=rr(26,70);
const g=x.createRadialGradient(gx,gy,gr*0.25,gx,gy,gr);
g.addColorStop(0,'rgba(58,38,18,0.16)');g.addColorStop(1,'rgba(0,0,0,0)');
x.fillStyle=g;x.fillRect(gx-gr,gy-gr,gr*2,gr*2);
}
for(let i=0;i<N(170,140);i++){
const gx=rr(1.5,H-1.5),ph=rr(0,6.283),am=rr(0.6,3.2),ww=rr(0.02,0.12);
if(rnd()<0.7)x.strokeStyle='rgba(12,7,3,'+rr(0.14,0.38).toFixed(2)+')';
else x.strokeStyle='rgba(96,68,36,'+rr(0.05,0.12).toFixed(2)+')';
x.lineWidth=rr(0.6,2.2);
x.beginPath();x.moveTo(gx+Math.sin(ph)*am,Y);
for(let yy=8;yy<=H;yy+=8)x.lineTo(gx+Math.sin(yy*ww+ph)*am,Y+yy);
x.stroke();
}
for(let i=0;i<N(110,90);i++){
x.fillStyle='rgba(8,5,2,'+rr(0.12,0.30).toFixed(2)+')';
x.fillRect(X+rr(0,H),Y+rr(0,H),rr(0.7,1.8),rr(3,11));
}
}
{
const Dq=AQ;
mirrorSquare(x,Dq,Dq,2*Dq,Dq,Dq);
mirrorSquare(x,0,2*Dq,2*Dq,2*Dq,Dq);
}
/* ==== ROW 3: table. Plates independent from the door wood: plank face,
 edge, leg, steel tie. Face cuts — inner sub-rects (see tblBox), uniform
 density: TBL_SPAN cells per tile side. ==== */
{
const X=0, Y=3*H, PB=2, PT=144.3, ph=(PT-PB)/4;   /* face cut: v in [0,146.3] */
x.fillStyle='#201609'; x.fillRect(X,Y,H,H);
for(let i=0;i<4;i++){
const py=Y+PB+i*ph;
x.fillStyle='hsl('+rr(25,31).toFixed(0)+','+rr(30,40).toFixed(0)+'%,'+rr(19,27).toFixed(0)+'%)';
x.fillRect(X,py+1.1,H,ph-2.2);
for(let g2=0;g2<N(26,22);g2++){                     /* grain along the board */
if(rnd()<0.62)x.strokeStyle='rgba('+(rr(30,56)|0)+','+(rr(18,34)|0)+','+(rr(8,15)|0)+','+rr(0.10,0.30).toFixed(2)+')';
else x.strokeStyle='rgba('+(rr(148,190)|0)+','+(rr(110,142)|0)+','+(rr(70,96)|0)+','+rr(0.05,0.12).toFixed(2)+')';
x.lineWidth=rr(0.6,1.6);
const gy=py+rr(2.5,ph-2.5),ph2=rr(0,6.283),am=rr(0.5,1.8),ww=rr(0.02,0.08);
x.beginPath();x.moveTo(X,gy);
for(let xx=16;xx<=H;xx+=16)x.lineTo(X+xx,gy+Math.sin(xx*ww+ph2)*am);
x.stroke();}
for(let q=0;q<N(14,10);q++){                        /* pores along the grain */
x.fillStyle='rgba(20,12,5,'+rr(0.12,0.26).toFixed(2)+')';
x.fillRect(X+rr(0,H),py+rr(2,ph-2),rr(2,7),rr(0.6,1.3));}
const gs=x.createLinearGradient(0,py,0,py+ph);      /* board chamfer: light on top, shadow below */
gs.addColorStop(0,'rgba(255,226,180,0.10)');gs.addColorStop(0.25,'rgba(255,226,180,0.0)');
gs.addColorStop(0.8,'rgba(0,0,0,0.06)');gs.addColorStop(1,'rgba(0,0,0,0.22)');
x.fillStyle=gs;x.fillRect(X,py+1.1,H,ph-2.2);
if(P(0.5)){                                         /* knot: rings + core */
const kx=X+rr(30,H-30),ky=py+ph*0.5+rr(-4,4);
for(let q=4;q>0;q--){x.strokeStyle='rgba(24,14,6,'+(0.52-q*0.10).toFixed(2)+')';x.lineWidth=1.4;
x.beginPath();x.ellipse(kx,ky,q*3.2,q*2.0,rr(-0.3,0.3),0,7);x.stroke();}
x.fillStyle='rgba(16,9,4,0.85)';x.beginPath();x.ellipse(kx,ky,2.4,1.6,0,0,7);x.fill();}
}
for(let i=1;i<4;i++){                               /* groove between boards */
const gy=Y+PB+i*ph;
x.fillStyle='rgba(8,5,2,0.90)';x.fillRect(X,gy-1.4,H,2.8);
x.fillStyle='rgba(255,214,160,0.10)';x.fillRect(X,gy+1.4,H,1.0);}
for(let q=0;q<N(10,8);q++){                         /* wear scratches */
x.strokeStyle='rgba(214,186,146,'+rr(0.05,0.13).toFixed(2)+')';x.lineWidth=rr(0.5,1.1);
const sx2=X+rr(6,H-6),sy2=Y+rr(4,PT-4);
x.beginPath();x.moveTo(sx2,sy2);x.lineTo(sx2+rr(-26,26),sy2+rr(-5,5));x.stroke();}
}
{
const X=H, Y=3*H;                                   /* edge: grain along U */
x.fillStyle='hsl(27,36%,21%)'; x.fillRect(X,Y,H,H);
for(let i=0;i<N(46,40);i++){
if(rnd()<0.66)x.strokeStyle='rgba('+(rr(26,50)|0)+','+(rr(16,30)|0)+','+(rr(7,13)|0)+','+rr(0.10,0.32).toFixed(2)+')';
else x.strokeStyle='rgba('+(rr(140,182)|0)+','+(rr(104,136)|0)+','+(rr(66,90)|0)+','+rr(0.05,0.12).toFixed(2)+')';
x.lineWidth=rr(0.7,2.0);
const gy=Y+rr(2,H-2),ph=rr(0,6.283),am=rr(0.8,2.6),ww=rr(0.01,0.05);
x.beginPath();x.moveTo(X,gy);
for(let xx=16;xx<=H;xx+=16)x.lineTo(X+xx,gy+Math.sin(xx*ww+ph)*am);
x.stroke();}
for(let i=0;i<N(5,4);i++){
x.fillStyle='rgba(12,7,3,'+rr(0.08,0.16).toFixed(2)+')';
x.fillRect(X,Y+rr(4,H-8),H,rr(2,6));}
for(let q=0;q<N(30,24);q++){
x.fillStyle='rgba(18,11,5,'+rr(0.12,0.28).toFixed(2)+')';
x.fillRect(X+rr(0,H),Y+rr(0,H),rr(2,8),rr(0.6,1.4));}
}
{
const X=2*H, Y=3*H;                                 /* leg: grain along V */
x.fillStyle='hsl(26,34%,20%)'; x.fillRect(X,Y,H,H);
for(let i=0;i<N(46,40);i++){
if(rnd()<0.66)x.strokeStyle='rgba('+(rr(26,50)|0)+','+(rr(16,30)|0)+','+(rr(7,13)|0)+','+rr(0.10,0.32).toFixed(2)+')';
else x.strokeStyle='rgba('+(rr(140,182)|0)+','+(rr(104,136)|0)+','+(rr(66,90)|0)+','+rr(0.05,0.12).toFixed(2)+')';
x.lineWidth=rr(0.7,2.0);
const gx=X+rr(2,H-2),ph=rr(0,6.283),am=rr(0.8,2.6),ww=rr(0.01,0.05);
x.beginPath();x.moveTo(gx,Y);
for(let yy=16;yy<=H;yy+=16)x.lineTo(gx+Math.sin(yy*ww+ph)*am,Y+yy);
x.stroke();}
for(let i=0;i<N(6,5);i++){
const gx=X+rr(0,H),gy=Y+rr(0,H),gr=rr(20,60);
const g=x.createRadialGradient(gx,gy,gr*0.2,gx,gy,gr);
g.addColorStop(0,rnd()<0.5?'rgba(96,64,30,0.14)':'rgba(16,10,4,0.16)');
g.addColorStop(1,'rgba(0,0,0,0)');
x.fillStyle=g;x.fillRect(gx-gr,gy-gr,gr*2,gr*2);}
for(let q=0;q<N(30,24);q++){
x.fillStyle='rgba(18,11,5,'+rr(0.12,0.28).toFixed(2)+')';
x.fillRect(X+rr(0,H),Y+rr(0,H),rr(0.6,1.4),rr(2,8));}
}
{
const X=3*H, Y=3*H;                                 /* tie bar: brushed steel, rivets along the bands */
const g0=x.createLinearGradient(0,Y,0,Y+H);
g0.addColorStop(0,'#70767e');g0.addColorStop(0.5,'#565c64');g0.addColorStop(1,'#3f444b');
x.fillStyle=g0; x.fillRect(X,Y,H,H);
for(let i=0;i<N(150,120);i++){                      /* brushing strokes along U */
x.fillStyle=(rnd()<0.5?'rgba(210,220,232,':'rgba(18,22,28,')+rr(0.03,0.09).toFixed(2)+')';
x.fillRect(X+rr(0,H*0.7),Y+rr(0,H),rr(40,256),rr(0.6,1.4));}
const dome=(cx,cy,r)=>{
const g=x.createRadialGradient(cx-r*0.35,cy-r*0.35,0,cx,cy,r);
g.addColorStop(0,'rgba(232,238,246,0.95)');g.addColorStop(0.7,'rgba(148,156,166,0.9)');
g.addColorStop(1,'rgba(52,58,66,0.95)');
x.fillStyle=g;x.beginPath();x.arc(cx,cy,r,0,7);x.fill();
x.strokeStyle='rgba(10,12,16,0.8)';x.lineWidth=1.2;x.beginPath();x.arc(cx,cy,r+0.7,0,7);x.stroke();};
for(const s of[0.10,0.28,0.50,0.72,0.90])dome(X+s*H,Y+0.12*H,4.6);      /* band A: rivets */
x.fillStyle='rgba(15,18,22,0.55)';x.fillRect(X,Y+0.226*H,H,2.4);
for(const s of[0.10,0.28,0.50,0.72,0.90]){dome(X+s*H,Y+0.40*H,3.2);     /* band B: screws */
x.strokeStyle='rgba(8,10,12,0.85)';x.lineWidth=1.0;
x.beginPath();x.moveTo(X+s*H-2.1,Y+0.40*H);x.lineTo(X+s*H+2.1,Y+0.40*H);x.stroke();}
x.fillStyle='rgba(15,18,22,0.55)';x.fillRect(X,Y+0.506*H,H,2.4);x.fillRect(X,Y+0.566*H,H,2.4);
}
noiseInto(x,AW,AH,Math.round(6+8*det),rnd);

},AW,AH);

const hgt=makeTex((x)=>{
x.scale(k,k);
x.fillStyle='#808080'; x.fillRect(0,0,1024,1024);
const H2=256, rows=10, bh=H2/rows, bw=H2/4;
x.fillStyle='#3c3c3c';
x.fillRect(0,0,H2,H2);
for(let r=0;r<rows;r++){ const off=(r%2)*(bw/2);
for(let cX=-1;cX<5;cX++){
const cw4=((cX%4)+4)%4;
const hs=(((r*73856093)^((cw4+8)*19349663))>>>0)/4294967296;
const bx=cX*bw+off+2,by=r*bh+2,bW=bw-4,bH=bh-4;
const base=198+(hs-0.5)*30;
const gd=x.createRadialGradient(bx+bW*0.5,by+bH*0.5,1,bx+bW*0.5,by+bH*0.5,bW*0.62);
gd.addColorStop(0,'rgb('+((base+12)|0)+','+((base+12)|0)+','+((base+12)|0)+')');
gd.addColorStop(0.72,'rgb('+(base|0)+','+(base|0)+','+(base|0)+')');
gd.addColorStop(1,'rgb('+((base-26)|0)+','+((base-26)|0)+','+((base-26)|0)+')');
x.fillStyle=gd; rrect(x,bx,by,bW,bH,2.6); x.fill();
const gb=x.createLinearGradient(0,by,0,by+bH);
gb.addColorStop(0,'rgba(255,255,255,0.16)');gb.addColorStop(0.35,'rgba(255,255,255,0)');
gb.addColorStop(1,'rgba(0,0,0,0.22)');
x.fillStyle=gb; rrect(x,bx,by,bW,bH,2.6); x.fill();
for(let ci=0;ci<4;ci++){
const mi=cX+((ci===1||ci===3)?1:0), e=r+((ci>=2)?1:0); const mw4=((mi%4)+4)%4;
const hh=chH(mw4,e,0); if(hh<0.30){
const rd=2+chH(mw4,e,64)*2.6, ang=chH(mw4,e,131)*3.1416, ecc=0.70+0.30*chH(mw4,e,197);
const cxp=bx+((ci===1||ci===3)?bW:0), cyp=by+(ci>=2?bH:0);
x.fillStyle='#3c3c3c';
x.beginPath(); x.ellipse(cxp,cyp,rd,rd*ecc,ang,0,7); x.fill(); } }
} }
for(let i=0;i<N(120,150);i++){
x.fillStyle='rgba('+(rr(96,176)|0)+','+(rr(96,176)|0)+','+(rr(96,176)|0)+',0.35)';
x.fillRect(rr(0,H2),rr(0,H2),rr(0.8,2.2),rr(0.8,2.2));
}
for(let i=0;i<2;i++)for(let j=0;j<2;j++){
const tb=194+((i*2+j)*37%3)*5;
x.fillStyle='rgb('+tb+','+tb+','+tb+')';
x.fillRect(H2+i*H2/2,j*H2/2,H2/2,H2/2); }
if(micro>0){
for(let i=0;i<N(0,110);i++){
x.fillStyle='rgba('+(rr(110,186)|0)+','+(rr(110,186)|0)+','+(rr(110,186)|0)+',0.30)';
const px=H2+rr(3,H2-3),py=rr(3,H2-3);
x.beginPath();x.ellipse(px,py,rr(0.9,2.6),rr(0.9,2.2),rr(0,3),0,7);x.fill();
}
}
{
const X=2*H2, Y=0, planks=5, pw=H2/planks;
/* leaf relief: planks with chamfers and grooves (grJ and kp same as albedo),
 no belts or handle — those are volumetric. Surface ~0.85, groove ~0.4. */
const grJ=(yy,i)=>Math.sin(yy*0.085+i*13.7)*0.7+Math.sin(yy*0.021+i*5.3)*0.55;
for(let i=0;i<planks;i++){
const px=X+i*pw;
const K=(()=>{const r=xsSub(st,0x2000+i).rnd;   /* same tag as the albedo kp — knots coincide */
return {has:r()<0.72,kx:r(),ky:r(),ca:r(),cb:r(),shas:r()<0.6,sx:r(),top:r()<0.5,sl:r()};})();
const br=xsSub(st,0x3000+i).rnd;   /* same tag as the albedo grain */
const brr=(a,b)=>a+br()*(b-a);
const tb=(110+((i*37)%12))|0;
x.fillStyle='rgb('+tb+','+tb+','+tb+')'; x.fillRect(px,Y,pw,H2);
x.save(); x.beginPath(); x.rect(px+1.5,Y,pw-3,H2); x.clip();
for(let g2=0;g2<N(34,30);g2++){                    /* grain in relief — texture */
const gx=px+brr(2,pw-2), dk=br()<0.55;
x.strokeStyle=dk?'rgba(96,96,96,'+brr(0.18,0.36).toFixed(2)+')':'rgba(128,128,128,'+brr(0.14,0.30).toFixed(2)+')';
x.lineWidth=brr(0.5,1.6);
const ph=brr(0,6.3), am=brr(0.5,2.0), ww=brr(0.015,0.05);
x.beginPath(); x.moveTo(gx,Y);
for(let yy=0;yy<=H2;yy+=12)x.lineTo(gx+Math.sin(yy*ww+ph)*am,Y+yy);
x.stroke(); }
if(K.has){                                         /* knot: a bowl with a bead */
const kx=px+pw*(0.3+0.4*K.kx), ky=Y+H2*(0.12+0.76*K.ky);
x.fillStyle='rgb(92,92,92)'; x.beginPath(); x.ellipse(kx,ky,5.5,8.0,K.ca-0.5,0,7); x.fill();
x.strokeStyle='rgba(134,134,134,0.8)'; x.lineWidth=1.6;
x.beginPath(); x.ellipse(kx,ky,7.0,9.5,K.ca-0.5,0,7); x.stroke(); }
for(let q2=0;q2<N(0,6);q2++){                      /* dents */
const dx2=px+brr(3,pw-3), dy2=Y+brr(0,H2), dr=brr(2,7);
const gD=x.createRadialGradient(dx2,dy2,0,dx2,dy2,dr);
gD.addColorStop(0,'rgba(88,88,88,'+brr(0.35,0.6).toFixed(2)+')'); gD.addColorStop(1,'rgba(88,88,88,0)');
x.fillStyle=gD; x.fillRect(dx2-dr,dy2-dr,dr*2,dr*2); }
if(K.shas){                                        /* end gap */
const sx2=px+6+(pw-12)*K.sx, len=26+54*K.sl;
x.strokeStyle='rgba(70,70,70,0.85)'; x.lineWidth=1.4;
x.beginPath(); x.moveTo(sx2,K.top?Y:Y+H2);
for(let yy=0;yy<=len;yy+=8)x.lineTo(sx2+Math.sin(yy*0.11)*1.2,K.top?Y+yy:Y+H2-yy);
x.stroke(); }
x.restore();
x.fillStyle='rgb(126,126,126)'; x.fillRect(px+1.2,Y,1.6,H2);   /* left chamfer rides higher */
x.fillStyle='rgb(96,96,96)'; x.fillRect(px+pw-2.6,Y,2.2,H2);   /* right chamfer sits lower */
}
for(let i=1;i<planks;i++){                         /* groove: wide slope + narrow bottom */
const gx=X+i*pw;
x.strokeStyle='rgba(86,86,86,0.9)'; x.lineWidth=5;
x.beginPath(); x.moveTo(gx+grJ(0,i),Y);
for(let yy=0;yy<=H2;yy+=16)x.lineTo(gx+grJ(yy,i),Y+yy);
x.stroke();
x.strokeStyle='rgba(52,52,52,0.95)'; x.lineWidth=2.6;
x.beginPath(); x.moveTo(gx+grJ(0,i),Y);
for(let yy=0;yy<=H2;yy+=16)x.lineTo(gx+grJ(yy,i),Y+yy);
x.stroke(); }
{
const gW=x.createLinearGradient(0,Y+H2*0.80,0,Y+H2);
gW.addColorStop(0,'rgba(0,0,0,0)'); gW.addColorStop(1,'rgba(0,0,0,0.22)');
x.fillStyle=gW; x.fillRect(X,Y+H2*0.80,H2,H2*0.20);
x.strokeStyle='rgba(92,92,92,1)'; x.lineWidth=2; x.strokeRect(X+1,Y+1,H2-2,H2-2); }
}
{
const X=H2, Y=H2;
x.fillStyle='#6e6e6e'; x.fillRect(X,Y,H2,H2);   /* sheet base level: a 0 background would read as a pit under parallax */
for(let i=0;i<N(110,90);i++){                    /* brushing in the relief */
const gx=X+rr(1.5,H2-1.5);
const g0=(rnd()<0.6?rr(96,116):rr(126,146))|0;
x.strokeStyle='rgba('+g0+','+g0+','+g0+','+rr(0.15,0.35).toFixed(2)+')';
x.lineWidth=rr(0.5,1.4);
x.beginPath();x.moveTo(gx,Y);x.lineTo(gx+rr(-1.5,1.5),Y+H2);x.stroke(); }
x.strokeStyle='#a4a4a4'; x.lineWidth=6; x.strokeRect(X+11,Y+11,H2-22,H2-22);
x.fillStyle='#7a7a7a';
x.fillRect(X+30,Y+30,H2-60,H2*0.26); x.fillRect(X+30,Y+H2*0.60,H2-60,H2*0.26);
x.strokeStyle='#b0b0b0'; x.lineWidth=2;
x.strokeRect(X+30,Y+30,H2-60,H2*0.26); x.strokeRect(X+30,Y+H2*0.60,H2-60,H2*0.26);
x.fillStyle='#dcdcdc';
for(let i=0;i<22;i++){ const t=i/22;
const pts=[[X+21,Y+21+t*(H2-42)],[X+H2-21,Y+21+t*(H2-42)],
[X+21+t*(H2-42),Y+21],[X+21+t*(H2-42),Y+H2-21]];
for(let q=0;q<4;q++){ x.beginPath();x.arc(pts[q][0],pts[q][1],2.8,0,7);x.fill(); } }
x.fillStyle='#9a9a9a';
x.fillRect(X+H2/2-30,Y+30+H2*0.13-11,60,20);
if(micro>0){
x.fillStyle='#c4c4c4';
x.fillRect(X+38,Y+30+H2*0.13-1,H2-76,2);
x.fillRect(X+38,Y+H2*0.60+H2*0.13-1,H2-76,2);
}
}
{
const X=2*H2, Y=H2;                            /* iron door back: panels and rivets of the front, no sign bump */
x.fillStyle='#6e6e6e'; x.fillRect(X,Y,H2,H2);
for(let i=0;i<N(90,80);i++){
const gx=X+rr(1.5,H2-1.5);
const g0=(rnd()<0.6?rr(96,116):rr(126,146))|0;
x.strokeStyle='rgba('+g0+','+g0+','+g0+','+rr(0.15,0.35).toFixed(2)+')';
x.lineWidth=rr(0.5,1.4);
x.beginPath();x.moveTo(gx,Y);x.lineTo(gx+rr(-1.5,1.5),Y+H2);x.stroke(); }
x.strokeStyle='#a4a4a4'; x.lineWidth=6; x.strokeRect(X+11,Y+11,H2-22,H2-22);
x.fillStyle='#7a7a7a';
x.fillRect(X+30,Y+30,H2-60,H2*0.26); x.fillRect(X+30,Y+H2*0.60,H2-60,H2*0.26);
x.strokeStyle='#b0b0b0'; x.lineWidth=2;
x.strokeRect(X+30,Y+30,H2-60,H2*0.26); x.strokeRect(X+30,Y+H2*0.60,H2-60,H2*0.26);
x.fillStyle='#dcdcdc';
for(let i=0;i<22;i++){ const t=i/22;
const pts=[[X+21,Y+21+t*(H2-42)],[X+H2-21,Y+21+t*(H2-42)],
[X+21+t*(H2-42),Y+21],[X+21+t*(H2-42),Y+H2-21]];
for(let q=0;q<4;q++){ x.beginPath();x.arc(pts[q][0],pts[q][1],2.8,0,7);x.fill(); } }
}
{
const X=0,Y=2*H2;                              /* veneer relief: grain grooves */
x.fillStyle='#808080'; x.fillRect(X,Y,H2,H2);
for(let i=0;i<N(150,120);i++){
const gx=rr(1.5,H2-1.5),ph=rr(0,6.283),am=rr(0.5,2.4),ww=rr(0.02,0.09);
const g0=(rnd()<0.62?rr(96,118):rr(140,168))|0;
x.strokeStyle='rgba('+g0+','+g0+','+g0+','+rr(0.16,0.42).toFixed(2)+')';
x.lineWidth=rr(0.5,1.7);
x.beginPath();x.moveTo(gx+Math.sin(ph)*am,Y);
for(let yy=8;yy<=H2;yy+=8)x.lineTo(gx+Math.sin(yy*ww+ph)*am,Y+yy);
x.stroke();
}
for(let i=0;i<N(90,70);i++){
const g0=(rr(88,104)|0);
x.fillStyle='rgba('+g0+','+g0+','+g0+',0.5)';
x.fillRect(X+rr(0,H2),Y+rr(0,H2),rr(0.6,1.4),rr(3,9));
}
}
{
const X=H2,Y=2*H2;                             /* interior: coarser relief */
x.fillStyle='#787878'; x.fillRect(X,Y,H2,H2);
for(let i=0;i<N(170,140);i++){
const gx=rr(1.5,H2-1.5),ph=rr(0,6.283),am=rr(0.6,3.2),ww=rr(0.02,0.12);
const g0=(rnd()<0.7?rr(84,104):rr(140,170))|0;
x.strokeStyle='rgba('+g0+','+g0+','+g0+','+rr(0.2,0.5).toFixed(2)+')';
x.lineWidth=rr(0.6,2.2);
x.beginPath();x.moveTo(gx+Math.sin(ph)*am,Y);
for(let yy=8;yy<=H2;yy+=8)x.lineTo(gx+Math.sin(yy*ww+ph)*am,Y+yy);
x.stroke();
}
for(let i=0;i<N(110,90);i++){
const g0=(rr(80,96)|0);
x.fillStyle='rgba('+g0+','+g0+','+g0+',0.55)';
x.fillRect(X+rr(0,H2),Y+rr(0,H2),rr(0.7,1.8),rr(3,11));
}
}
{
const Dq=AQ;
mirrorSquare(x,Dq,Dq,2*Dq,Dq,Dq);
mirrorSquare(x,0,2*Dq,2*Dq,2*Dq,Dq);
}
/* row 3: table relief. Board grooves and rivets match the albedo layout;
 random grain is independent (in relief it's just texture). */
{
const X=0, Y=3*H2, PB=2, PT=144.3, ph=(PT-PB)/4;
x.fillStyle='#7d7d7d'; x.fillRect(X,Y,H2,H2);
for(let i=0;i<4;i++){
const tb=(150+((i*53)%3)*6)|0;
x.fillStyle='rgb('+tb+','+tb+','+tb+')';
x.fillRect(X,Y+PB+i*ph+1.2,H2,ph-2.4);}
for(let i=0;i<N(60,50);i++){
const g0=(rr(120,172)|0);
x.strokeStyle='rgba('+g0+','+g0+','+g0+',0.25)';x.lineWidth=rr(0.6,1.4);
const gy=Y+rr(PB+2,PT-2),ph2=rr(0,6.283),am=rr(0.4,1.5),ww=rr(0.02,0.08);
x.beginPath();x.moveTo(X,gy);
for(let xx=16;xx<=H2;xx+=16)x.lineTo(X+xx,gy+Math.sin(xx*ww+ph2)*am);
x.stroke();}
for(let i=1;i<4;i++){
const gy=Y+PB+i*ph;
x.fillStyle='#303030';x.fillRect(X,gy-1.4,H2,2.8);
x.fillStyle='#c8c8c8';x.fillRect(X,gy+1.4,H2,1.0);}
x.fillStyle='#6a6a6a';x.fillRect(X,Y,H2,PB);x.fillRect(X,Y+PT-2,H2,H2-PT+2);
}
{
const X=H2, Y=3*H2;
x.fillStyle='#8a8a8a'; x.fillRect(X,Y,H2,H2);
for(let i=0;i<N(70,60);i++){
const g0=(rnd()<0.5?rr(112,150):rr(150,186))|0;
x.strokeStyle='rgba('+g0+','+g0+','+g0+',0.28)';x.lineWidth=rr(0.6,1.8);
const gy=Y+rr(2,H2-2),ph=rr(0,6.283),am=rr(0.6,2.2),ww=rr(0.01,0.05);
x.beginPath();x.moveTo(X,gy);
for(let xx=16;xx<=H2;xx+=16)x.lineTo(X+xx,gy+Math.sin(xx*ww+ph)*am);
x.stroke();}
}
{
const X=2*H2, Y=3*H2;
x.fillStyle='#8a8a8a'; x.fillRect(X,Y,H2,H2);
for(let i=0;i<N(70,60);i++){
const g0=(rnd()<0.5?rr(112,150):rr(150,186))|0;
x.strokeStyle='rgba('+g0+','+g0+','+g0+',0.28)';x.lineWidth=rr(0.6,1.8);
const gx=X+rr(2,H2-2),ph=rr(0,6.283),am=rr(0.6,2.2),ww=rr(0.01,0.05);
x.beginPath();x.moveTo(gx,Y);
for(let yy=16;yy<=H2;yy+=16)x.lineTo(gx+Math.sin(yy*ww+ph)*am,Y+yy);
x.stroke();}
}
{
const X=3*H2, Y=3*H2;
x.fillStyle='#909090'; x.fillRect(X,Y,H2,H2);
for(let i=0;i<N(120,100);i++){
const g0=(rnd()<0.5?rr(128,160):rr(160,196))|0;
x.fillStyle='rgba('+g0+','+g0+','+g0+',0.30)';
x.fillRect(X+rr(0,H2*0.7),Y+rr(0,H2),rr(40,256),rr(0.6,1.4));}
for(const s of[0.10,0.28,0.50,0.72,0.90]){
let g=x.createRadialGradient(X+s*H2-1.6,Y+0.12*H2-1.6,0,X+s*H2,Y+0.12*H2,4.6);
g.addColorStop(0,'#f2f2f2');g.addColorStop(1,'#8f8f8f');
x.fillStyle=g;x.beginPath();x.arc(X+s*H2,Y+0.12*H2,4.6,0,7);x.fill();
g=x.createRadialGradient(X+s*H2-1.1,Y+0.40*H2-1.1,0,X+s*H2,Y+0.40*H2,3.2);
g.addColorStop(0,'#e0e0e0');g.addColorStop(1,'#8f8f8f');
x.fillStyle=g;x.beginPath();x.arc(X+s*H2,Y+0.40*H2,3.2,0,7);x.fill();}
x.fillStyle='#4a4a4a';x.fillRect(X,Y+0.226*H2,H2,2.4);
x.fillRect(X,Y+0.506*H2,H2,2.4);x.fillRect(X,Y+0.566*H2,H2,2.4);
}
noiseInto(x,AW,AH,Math.round(9+9*det),rnd);
},AW,AH);

const hd=hgt.data, hh=new Uint8Array(AW*AH);
for(let i=0,p=0;i<hd.length;i+=4,p++){
let v=255-(128-hd[i])*2.2;
hh[p]=v<0?0:(v>255?255:v);
}
return {col:col,nrm:heightToNormal(hgt,AW,AH,2.6+1.2*det+0.8*micro),hgt:hh,w:AW,h:AH}; }

const ATL={sig:null,data:null};
function getAtlas(S){

const sig='atlas_'+S.seed+'_'+Q.level+'_'+(Q.atlas|0)+'_'+Q.det+'_'+Q.micro;
if(ATL.sig!==sig){ applyAtlasQ(Q.atlas|0); ATL.data=buildAtlasData(S.seedState,Q); ATL.sig=sig; }
return ATL.data; }

/* ==== WORLD GEOMETRY: walls, floor, ceiling ====
   The floor is a SEPARATE buffer: the mirror pass simply doesn't draw it
   (before, the floor was cut by discard in fsWorld, and discard disabled
   early-z for the whole world pass — every occluded pixel was honestly
   shaded). The main pass draws both buffers — same picture, the depth test
   cuts overdraw before the shader. */
function buildWorldData(S){
const V=[];      /* walls + ceilings */
const VF=[];     /* floors (excluded from the mirror pass) */
const pushTo=(A,px,py,pz,u,v,nx,ny,nz,ao)=>{ A.push(px,py,pz,u,v,nx,ny,nz,ao); };
const push=(px,py,pz,u,v,nx,ny,nz,ao)=>{ V.push(px,py,pz,u,v,nx,ny,nz,ao); };
const quadTo=(A,a,b,c,d,uvs,n,aos)=>{
pushTo(A,a[0],a[1],a[2],uvs[0],uvs[1],n[0],n[1],n[2],aos[0]);
pushTo(A,b[0],b[1],b[2],uvs[2],uvs[3],n[0],n[1],n[2],aos[1]);
pushTo(A,c[0],c[1],c[2],uvs[4],uvs[5],n[0],n[1],n[2],aos[2]);
pushTo(A,a[0],a[1],a[2],uvs[0],uvs[1],n[0],n[1],n[2],aos[0]);
pushTo(A,c[0],c[1],c[2],uvs[4],uvs[5],n[0],n[1],n[2],aos[2]);
pushTo(A,d[0],d[1],d[2],uvs[6],uvs[7],n[0],n[1],n[2],aos[3]); };
const quad=(a,b,c,d,uvs,n,aos)=>quadTo(V,a,b,c,d,uvs,n,aos);
const quadF=(a,b,c,d,uvs,n,aos)=>quadTo(VF,a,b,c,d,uvs,n,aos);

const QU=(qx,qy)=>{ const q=(qx===1&&qy===0)?UV_FLOOR:UV_CEIL;
return [q.u0,q.v0, q.u1,q.v0, q.u1,q.v1, q.u0,q.v1]; };
const QW=()=>{ const q=UV_WALL;

return [q.u0,q.v1, q.u0,q.v0, q.u1,q.v0, q.u1,q.v1]; };
const solid=(x,z)=> x<0||z<0||x>=S.W||z>=S.H||S.grid[z*S.W+x]===1;
const cornerAO=(gx,gz)=>{ let k=0;
if(solid(gx-1,gz-1))k++; if(solid(gx,gz-1))k++; if(solid(gx-1,gz))k++; if(solid(gx,gz))k++;
return 1-0.10*k; };
const wallAO=y=>{ const t=Math.min(1,y/(0.38*CEIL_H)); const top=y>0.82*CEIL_H?0.86:1;   /* ceiling at 3.5 m */
return (0.55+0.45*t*(2-t))*top; };
/* one virtual wall ring AROUND the grid: the spawn/exit rooms sit on the outer
   belt, and their out-of-grid side had no wall cell to emit the face from —
   the room looked into a black void (a virtual cell draws exactly one quad:
   the face towards the room, all its other neighbours are solid) */
for(let z=-1;z<=S.H;z++)for(let x=-1;x<=S.W;x++){
const g=(x<0||z<0||x>=S.W||z>=S.H)?1:S.grid[z*S.W+x];
if(g===1){
const q=QW();
const CH=CEIL_H;   /* walls up to the ceiling (3.5 m) */
if(!solid(x-1,z)) quad([x,0,z],[x,CH,z],[x,CH,z+1],[x,0,z+1],q,[-1,0,0],
[wallAO(0),wallAO(CH),wallAO(CH),wallAO(0)]);
if(!solid(x+1,z)) quad([x+1,0,z+1],[x+1,CH,z+1],[x+1,CH,z],[x+1,0,z],q,[1,0,0],
[wallAO(0),wallAO(CH),wallAO(CH),wallAO(0)]);
if(!solid(x,z-1)) quad([x+1,0,z],[x+1,CH,z],[x,CH,z],[x,0,z],q,[0,0,-1],
[wallAO(0),wallAO(CH),wallAO(CH),wallAO(0)]);
if(!solid(x,z+1)) quad([x,0,z+1],[x,CH,z+1],[x+1,CH,z+1],[x+1,0,z+1],q,[0,0,1],
[wallAO(0),wallAO(CH),wallAO(CH),wallAO(0)]);
quad([x,CH,z],[x,CH,z+1],[x+1,CH,z+1],[x+1,CH,z],QU(0,1),[0,1,0],
[cornerAO(x,z)*0.72,cornerAO(x,z+1)*0.72,cornerAO(x+1,z+1)*0.72,cornerAO(x+1,z)*0.72]);
} else {

quadF([x,0,z+1],[x+1,0,z+1],[x+1,0,z],[x,0,z],QU(1,0),[0,1,0],
[cornerAO(x,z+1),cornerAO(x+1,z+1),cornerAO(x+1,z),cornerAO(x,z)]);
quad([x,CEIL_H,z],[x+1,CEIL_H,z],[x+1,CEIL_H,z+1],[x,CEIL_H,z+1],QU(0,1),[0,-1,0],
[cornerAO(x,z)*0.72,cornerAO(x+1,z)*0.72,cornerAO(x+1,z+1)*0.72,cornerAO(x,z+1)*0.72]);
}
}
return {arr:new Float32Array(V),n:V.length/9,arrF:new Float32Array(VF),nF:VF.length/9,W:S.W,H:S.H}; }
const WCACHE={sig:'',data:null};
function worldData(S){
const sig=S.seed+'_'+S.W+'x'+S.H+'_'+AQ;
if(WCACHE.sig!==sig){ WCACHE.data=buildWorldData(S); WCACHE.sig=sig; }
return WCACHE.data; }
function boxMeshData(w,h,d){
const V=[]; const q=(a,b,c,d2,n)=>{ for(const tri of [[0,1,2],[0,2,3]]) for(const i of tri){ const p=[a,b,c,d2][i]; V.push(p[0],p[1],p[2],0.5,0.5,n[0],n[1],n[2], p[1]<=0.001?0.85:1); } };
q([-w,0,-d],[w,0,-d],[w,h,-d],[-w,h,-d],[0,0,-1]);
q([w,0,d],[-w,0,d],[-w,h,d],[w,h,d],[0,0,1]);
q([w,0,-d],[w,0,d],[w,h,d],[w,h,-d],[1,0,0]);
q([-w,0,d],[-w,0,-d],[-w,h,-d],[-w,h,d],[-1,0,0]);
q([-w,h,d],[w,h,d],[w,h,-d],[-w,h,-d],[0,1,0]);
return {arr:new Float32Array(V),n:V.length/9}; }
function discMeshData(r,seg){
const V=[];
for(let i=0;i<seg;i++){
const a0=i/seg*Math.PI*2,a1=(i+1)/seg*Math.PI*2;
V.push(0,0,0,0.5,0.5,0,1,0,1);
V.push(Math.cos(a0)*r,0,Math.sin(a0)*r,0.5+Math.cos(a0)*0.5,0.5+Math.sin(a0)*0.5,0,1,0,0.9);
V.push(Math.cos(a1)*r,0,Math.sin(a1)*r,0.5+Math.cos(a1)*0.5,0.5+Math.sin(a1)*0.5,0,1,0,0.9);
}
return {arr:new Float32Array(V),n:V.length/9}; }

function leafMeshData(w,h,d,rect,edgeUV,rectBack){
const V=[];
const q=(a,b,c,d2,n,uvA,uvB,uvC,uvD,ao)=>{
const uvs=[uvA,uvB,uvC,uvD];
const pts=[a,b,c,d2];
for(const tri of [[0,1,2],[0,2,3]]) for(const i of tri){
const p=pts[i],uv=uvs[i];
V.push(p[0],p[1],p[2],uv[0],uv[1],n[0],n[1],n[2],ao===undefined?1:ao); } };
const u0=rect.u0,v0=rect.v0,u1=rect.u1,v1=rect.v1;
const rb=rectBack||rect, b0=rb.u0,bv0=rb.v0,b1=rb.u1,bv1=rb.v1;
q([-w,0,-d],[w,0,-d],[w,h,-d],[-w,h,-d],[0,0,-1],
[b0,bv1],[b1,bv1],[b1,bv0],[b0,bv0]);
q([w,0,d],[-w,0,d],[-w,h,d],[w,h,d],[0,0,1],
[u1,v1],[u0,v1],[u0,v0],[u1,v0]);
const E=[edgeUV[0],edgeUV[1]];
q([w,0,-d],[w,0,d],[w,h,d],[w,h,-d],[1,0,0],E,E,E,E,0.55);
q([-w,0,d],[-w,0,-d],[-w,h,-d],[-w,h,d],[-1,0,0],E,E,E,E,0.55);
q([-w,h,d],[w,h,d],[w,h,-d],[-w,h,-d],[0,1,0],E,E,E,E,0.55);
q([-w,0,-d],[w,0,-d],[w,0,d],[-w,0,d],[0,-1,0],E,E,E,E,0.55);
return {arr:new Float32Array(V),n:V.length/9}; }

function buildKeyMeshData(){
const V=[];
const push=(p,n)=>{V.push(p[0],p[1],p[2],0.5,0.5,n[0],n[1],n[2],1)};
const quad=(a,b,c,d,n)=>{for(const tri of [[0,1,2],[0,2,3]])for(const i of tri)push([a,b,c,d][i],n)};
const box=(cx,cy,cz,w,h,d)=>{
quad([cx-w,cy-h,cz-d],[cx+w,cy-h,cz-d],[cx+w,cy+h,cz-d],[cx-w,cy+h,cz-d],[0,0,-1]);
quad([cx+w,cy-h,cz+d],[cx-w,cy-h,cz+d],[cx-w,cy+h,cz+d],[cx+w,cy+h,cz+d],[0,0,1]);
quad([cx+w,cy-h,cz-d],[cx+w,cy-h,cz+d],[cx+w,cy+h,cz+d],[cx+w,cy+h,cz-d],[1,0,0]);
quad([cx-w,cy-h,cz+d],[cx-w,cy-h,cz-d],[cx-w,cy+h,cz-d],[cx-w,cy+h,cz+d],[-1,0,0]);
quad([cx-w,cy+h,cz+d],[cx+w,cy+h,cz+d],[cx+w,cy+h,cz-d],[cx-w,cy+h,cz-d],[0,1,0]);
quad([cx-w,cy-h,cz-d],[cx+w,cy-h,cz-d],[cx+w,cy-h,cz+d],[cx-w,cy-h,cz+d],[0,-1,0]);
};
const R=0.075,r=0.020,seg=16,ring=8,cy=0.315;
for(let i=0;i<seg;i++)for(let j=0;j<ring;j++){
const u0=i/seg*Math.PI*2,u1=(i+1)/seg*Math.PI*2;
const v0=j/ring*Math.PI*2,v1=(j+1)/ring*Math.PI*2;
const P=(u,v)=>[(R+r*Math.cos(v))*Math.cos(u),cy+(R+r*Math.cos(v))*Math.sin(u),r*Math.sin(v)];
const N=(u,v)=>[Math.cos(v)*Math.cos(u),Math.cos(v)*Math.sin(u),Math.sin(v)];
const ps=[P(u0,v0),P(u1,v0),P(u1,v1),P(u0,v1)],ns=[N(u0,v0),N(u1,v0),N(u1,v1),N(u0,v1)];
for(const tri of [[0,1,2],[0,2,3]])for(const k of tri)push(ps[k],ns[k]);
}
const hr=0.015,hs=6;
for(let i=0;i<hs;i++){
const a0=i/hs*Math.PI*2,a1=(i+1)/hs*Math.PI*2;
const x0=Math.cos(a0)*hr,z0=Math.sin(a0)*hr,x1=Math.cos(a1)*hr,z1=Math.sin(a1)*hr;
const nx=Math.cos((a0+a1)/2),nz=Math.sin((a0+a1)/2);
quad([x0,0.0,z0],[x1,0.0,z1],[x1,0.255,z1],[x0,0.255,z0],[nx,0,nz]);
}
box(0.030,0.045,0,0.030,0.013,0.013);
box(0.024,0.088,0,0.024,0.011,0.013);
box(0.0,0.245,0,0.024,0.010,0.024);
/* The key is ~13 cm — fits a cabinet drawer and a fist; the bit runs along +X
 — same axis convention as the flashlight/battery (single grip and fixup). */
const KS=0.135/0.33;   /* final key length ~= 0.135 rig units ~= 13.7 cm */
for(let i=0;i<V.length;i+=9){
const x=V[i]*KS,y=V[i+1]*KS,nx=V[i+5],ny=V[i+6];
V[i]=y;V[i+1]=-x;V[i+2]=V[i+2]*KS;
V[i+5]=ny;V[i+6]=-nx;
}
return {arr:new Float32Array(V),n:V.length/9}; }

/* EXIT DOOR VALVE: torus rim, four spokes, hub. Axis = local Z; mounted on
 the leaf from the inside, turns while the key rotates it (doorT). */
function buildValveData(){
const V=[];
const push=(p,n)=>{V.push(p[0],p[1],p[2],0.875,0.625,n[0],n[1],n[2],1)};   /* uv: painted-cast-iron zone (3,2) of matOf */
const quad=(a,b,c,d,n)=>{for(const tri of [[0,1,2],[0,2,3]])for(const i of tri)push([a,b,c,d][i],n)};
const box=(cx,cy,cz,w,h,d)=>{
quad([cx-w,cy-h,cz-d],[cx+w,cy-h,cz-d],[cx+w,cy+h,cz-d],[cx-w,cy+h,cz-d],[0,0,-1]);
quad([cx+w,cy-h,cz+d],[cx-w,cy-h,cz+d],[cx-w,cy+h,cz+d],[cx+w,cy+h,cz+d],[0,0,1]);
quad([cx+w,cy-h,cz-d],[cx+w,cy-h,cz+d],[cx+w,cy+h,cz+d],[cx+w,cy+h,cz-d],[1,0,0]);
quad([cx-w,cy-h,cz+d],[cx-w,cy-h,cz-d],[cx-w,cy+h,cz-d],[cx-w,cy+h,cz+d],[-1,0,0]);
quad([cx-w,cy+h,cz+d],[cx+w,cy+h,cz+d],[cx+w,cy+h,cz-d],[cx-w,cy+h,cz-d],[0,1,0]);
quad([cx-w,cy-h,cz-d],[cx+w,cy-h,cz-d],[cx+w,cy-h,cz+d],[cx-w,cy-h,cz+d],[0,-1,0]);
};
const R=0.068,r=0.0075,seg=18,ring=6;
for(let i=0;i<seg;i++)for(let j=0;j<ring;j++){
const u0=i/seg*Math.PI*2,u1=(i+1)/seg*Math.PI*2;
const v0=j/ring*Math.PI*2,v1=(j+1)/ring*Math.PI*2;
const P=(u,v)=>[(R+r*Math.cos(v))*Math.cos(u),(R+r*Math.cos(v))*Math.sin(u),r*Math.sin(v)];
const N=(u,v)=>[Math.cos(v)*Math.cos(u),Math.cos(v)*Math.sin(u),Math.sin(v)];
const ps=[P(u0,v0),P(u1,v0),P(u1,v1),P(u0,v1)],ns=[N(u0,v0),N(u1,v0),N(u1,v1),N(u0,v1)];
for(const tri of [[0,1,2],[0,2,3]])for(const k of tri)push(ps[k],ns[k]);
}
box(0.036,0,0,0.036,0.006,0.006); box(-0.036,0,0,0.036,0.006,0.006);
box(0,0.036,0,0.006,0.036,0.006); box(0,-0.036,0,0.006,0.036,0.006);
const hr=0.016,hs=8;
for(let i=0;i<hs;i++){
const a0=i/hs*Math.PI*2,a1=(i+1)/hs*Math.PI*2;
const x0=Math.cos(a0)*hr,y0=Math.sin(a0)*hr,x1=Math.cos(a1)*hr,y1=Math.sin(a1)*hr;
const nx=Math.cos((a0+a1)/2),ny=Math.sin((a0+a1)/2);
quad([x0,y0,-0.014],[x1,y1,-0.014],[x1,y1,0.018],[x0,y0,0.018],[nx,ny,0]);
}
return {arr:new Float32Array(V),n:V.length/9}; }

/* WOODEN DOOR HARDWARE: local space matches leafMeshData (x = width, y = up,
 z = leaf thickness). Belts wrap the leaf through, rivets are domes on the
 faces, the handle is a boss + ring on a ball pivot. UV — constants in the
 steel square of matOf (metal/rough). */
function buildSafeHwData(w,h,d){
const V=[];
const push=(p,n)=>{V.push(p[0],p[1],p[2],0.875,0.375,n[0],n[1],n[2],1)};   /* uv in matOf zone (3,1) */
const pushS=(p,n)=>push(p,n);   /* smoothed quad: its own normal per vertex */
const quadS=(a,na,b,nb,c,nc,d2,nd)=>{for(const tri of [[0,1,2],[0,2,3]])for(const i of tri){
const P=[a,b,c,d2][i],Nn=[na,nb,nc,nd][i];pushS(P,Nn);}};
const quad=(a,b,c,dd,n)=>{for(const tri of [[0,1,2],[0,2,3]])for(const i of tri)push([a,b,c,dd][i],n);};
const box=(cx,cy,cz,sx,sy,sz)=>{
quad([cx-sx,cy-sy,cz-sz],[cx+sx,cy-sy,cz-sz],[cx+sx,cy+sy,cz-sz],[cx-sx,cy+sy,cz-sz],[0,0,-1]);
quad([cx+sx,cy-sy,cz+sz],[cx-sx,cy-sy,cz+sz],[cx-sx,cy+sy,cz+sz],[cx+sx,cy+sy,cz+sz],[0,0,1]);
quad([cx+sx,cy-sy,cz-sz],[cx+sx,cy-sy,cz+sz],[cx+sx,cy+sy,cz+sz],[cx+sx,cy+sy,cz-sz],[1,0,0]);
quad([cx-sx,cy-sy,cz+sz],[cx-sx,cy-sy,cz-sz],[cx-sx,cy+sy,cz-sz],[cx-sx,cy+sy,cz+sz],[-1,0,0]);
quad([cx-sx,cy+sy,cz+sz],[cx+sx,cy+sy,cz+sz],[cx+sx,cy+sy,cz-sz],[cx-sx,cy+sy,cz-sz],[0,1,0]);
quad([cx-sx,cy-sy,cz-sz],[cx+sx,cy-sy,cz-sz],[cx+sx,cy-sy,cz+sz],[cx-sx,cy-sy,cz+sz],[0,-1,0]); };
/* rivet dome: the base is sunk into the belt — coplanar with the face is impossible */
const dome=(cx,cy,cz,r,sq,side,SEG,RG)=>{
for(let j=0;j<RG;j++){
const v0=j/RG*Math.PI*0.5, v1=(j+1)/RG*Math.PI*0.5;
for(let i=0;i<SEG;i++){
const u0=i/SEG*Math.PI*2, u1=(i+1)/SEG*Math.PI*2;
const P=(u,v)=>[cx+r*Math.sin(v)*Math.cos(u), cy+r*Math.sin(v)*Math.sin(u), cz+side*r*sq*Math.cos(v)];
const N=(u,v)=>[Math.sin(v)*Math.cos(u), Math.sin(v)*Math.sin(u), side*Math.cos(v)];
const a=P(u0,v1),b=P(u1,v1),c=P(u1,v0),e=P(u0,v0);
if(j===RG-1){quadS(a,N(u0,v1),b,N(u1,v1),c,N(u1,v1),c,N(u1,v1));}
else{quadS(a,N(u0,v1),b,N(u1,v1),c,N(u1,v0),e,N(u0,v0));}
} } };
const torus=(cx,cy,cz,R,r,seg,ring)=>{
for(let i=0;i<seg;i++)for(let j=0;j<ring;j++){
const u0=i/seg*Math.PI*2,u1=(i+1)/seg*Math.PI*2;
const v0=j/ring*Math.PI*2,v1=(j+1)/ring*Math.PI*2;
const P=(u,v)=>[cx+(R+r*Math.cos(v))*Math.cos(u), cy+(R+r*Math.cos(v))*Math.sin(u), cz+r*Math.sin(v)];
const N=(u,v)=>[Math.cos(v)*Math.cos(u), Math.cos(v)*Math.sin(u), Math.sin(v)];
quadS(P(u0,v0),N(u0,v0),P(u1,v0),N(u1,v0),P(u1,v1),N(u1,v1),P(u0,v1),N(u0,v1)); } };
const sphere=(cx,cy,cz,r,seg,ring)=>{
for(let i=0;i<seg;i++)for(let j=0;j<ring;j++){
const u0=i/seg*Math.PI*2,u1=(i+1)/seg*Math.PI*2;
const v0=j/ring*Math.PI-Math.PI*0.5, v1=(j+1)/ring*Math.PI-Math.PI*0.5;
const P=(u,v)=>[cx+r*Math.cos(v)*Math.cos(u), cy+r*Math.cos(v)*Math.sin(u), cz+r*Math.sin(v)];
const N=(u,v)=>[Math.cos(v)*Math.cos(u), Math.cos(v)*Math.sin(u), Math.sin(v)];
const a=P(u0,v0),b=P(u1,v0),c=P(u1,v1),e=P(u0,v1);
if(j===0){quadS(a,N(u0,v0),b,N(u1,v0),c,N(u1,v0),e,N(u0,v0));}
else if(j===ring-1){quadS(a,N(u0,v0),b,N(u1,v0),c,N(u1,v1),e,N(u0,v1));}
else{quadS(a,N(u0,v0),b,N(u1,v0),c,N(u1,v1),e,N(u0,v1));}
} };
const ZT=d+0.016;                    /* the belt sticks 1.6 cm out of the leaf */
const SH=0.055;                      /* belt half-height */
for(const cy of [h*0.2325,h*0.7825]){
box(0,cy,0,w-0.002,SH,ZT);
for(let rv=0;rv<6;rv++){
const rx=-0.44+rv*0.176;
dome(rx,cy, ZT-0.004,0.017,0.8, 1,8,2);
dome(rx,cy,-ZT+0.004,0.017,0.8,-1,8,2); } }
const hx=0.26, hy=h*0.42;   /* ring above the belts: ~1.5 m from the ground */
for(const side of [1,-1]){
dome(hx,hy,side*0.048,0.055,0.42,side,14,4);   /* a dome instead of a flat washer: the highlight is not a disc */
sphere(hx,hy+0.045,side*0.062,0.014,8,4);
torus(hx,hy-0.017,side*0.070,0.062,0.009,16,6); }   /* the ring hangs on the pivot */
return {arr:new Float32Array(V),n:V.length/9}; }

/* ================ PROPS ================
 Small items are built IN RIG UNITS (~meters): used as-is in hand, in the
 world — with the PL_SCALE multiplier. Item axis = +X (the flashlight "head"),
 a single grip fixup. Furniture is built directly IN CELLS — world-only. */
const FL_UV=()=>{const q=UV_IRON;const w=(q.u1-q.u0),h=(q.v1-q.v0);
return [q.u0+w*0.10,q.u0+w*0.34,q.v0+h*0.12,q.v0+h*0.36]};
/* FLASHLIGHT (~20 cm): brass profile along Y -> turned into +X. Dark
 anodized aluminum, knurled rings, head-reflector, bezel. */
function buildFlashlightData(){
const uv=FL_UV();
let V=loftPart([
pr(-0.106,0,0,0.0095,0.0095,2.2),
pr(-0.099,0,0,0.0135,0.0135,2.2),
pr(-0.089,0,0,0.0165,0.0165,2.2),
pr(-0.081,0,0,0.0175,0.0175,2.2),
pr(-0.058,0,0,0.0175,0.0175,2.2),
pr(-0.054,0,0,0.0192,0.0192,2.2),
pr(-0.048,0,0,0.0192,0.0192,2.2),
pr(-0.044,0,0,0.0175,0.0175,2.2),
pr(-0.016,0,0,0.0175,0.0175,2.2),
pr(-0.012,0,0,0.0192,0.0192,2.2),
pr(-0.006,0,0,0.0192,0.0192,2.2),
pr(-0.002,0,0,0.0178,0.0178,2.2),
pr( 0.018,0,0,0.0185,0.0185,2.3),
pr( 0.024,0,0,0.0215,0.0215,2.3),
pr( 0.036,0,0,0.0265,0.0265,2.4),
pr( 0.060,0,0,0.0295,0.0295,2.4),
pr( 0.082,0,0,0.0300,0.0300,2.4),
pr( 0.088,0,0,0.0325,0.0325,2.3),
pr( 0.094,0,0,0.0315,0.0315,2.3),
pr( 0.0975,0,0,0.0280,0.0280,2.3)],14,uv,true);
/* end-cap button (pressed by the thumb in the toggle animation) */
V=partCat(V,partAO(loftPart([pr(-0.112,0,0,0.0055,0.0055,2.2),pr(-0.1055,0,0,0.0075,0.0075,2.2)],10,uv,true),0.8));
V=partXf(V,0,0,0,0,0,-Math.PI/2);   /* axis Y -> +X: the head looks forward */
/* bigger: body and head across — whole, head along X — from the grip axis
 (the button tail stays put — the thumb animation doesn't ride off). */
for(let i=0;i<V.length;i+=9){V[i+1]*=FL_MODEL_K;V[i+2]*=FL_MODEL_K;if(V[i]>0.005)V[i]*=FL_MODEL_K;}
return {arr:new Float32Array(V),n:V.length/9}; }
/* flashlight lens (a disc in the head plane; emissive when on) */
function buildFlashLensData(){
const d=discMeshData(0.0268,20);
const a=d.arr,V=[];
for(let i=0;i<a.length;i+=9){
/* the disc is built in XZ (normal +Y) — set into the head's YZ plane, normal +X */
V.push(FL_HEAD_X,a[i+2]*FL_MODEL_K,-a[i]*FL_MODEL_K,a[i+3],a[i+4],1,0,0,a[i+8]);
}
return {arr:new Float32Array(V),n:V.length/9}; }
/* BATTERY (AA type, x1.6 real size — otherwise unreadable): 8 cm, dark steel
 sleeve + yellow label (two draws) + plus contact. */
function buildBatteryBodyData(){
const uv=FL_UV();
let V=loftPart([
pr(-0.040,0,0,0.0112,0.0112,2.2),
pr(-0.038,0,0,0.0118,0.0118,2.2),
pr( 0.030,0,0,0.0118,0.0118,2.2),
pr( 0.033,0,0,0.0108,0.0108,2.2),
pr( 0.035,0,0,0.0100,0.0100,2.2),
pr( 0.0395,0,0,0.0048,0.0048,2.2),
pr( 0.0415,0,0,0.0042,0.0042,2.2)],12,uv,true);
V=partXf(V,0,0,0,0,0,-Math.PI/2);
return {arr:new Float32Array(V),n:V.length/9}; }
function buildBatteryBandData(){
const uv=FL_UV();
let V=loftPart([
pr(-0.028,0,0,0.0122,0.0122,2.2),
pr( 0.020,0,0,0.0122,0.0122,2.2)],12,uv,false);
V=partXf(V,0,0,0,0,0,-Math.PI/2);
return {arr:new Float32Array(V),n:V.length/9}; }
/* CABINET (in cells; facade looks toward -Z, placed to the wall by a rotY
 matrix). Body: sides/bottom/top with an overhanging edge, dark drawer cavity.
 All part joints overlap or keep a gap: no coplanar pairs, so z-fighting is
 excluded; the plinth is sunk under the floor. Drawer/cavity gap 4 mm. */
/* Furniture UV: the inner cut of a tile at UNIFORM density (CAB_SPAN cells
 per tile side) — narrow edges don't stretch the texture; V runs along the
 grain: vertical on ±X faces, across on the rest; off = per-part cut offset so
 the veneer doesn't duplicate on neighbor faces. */
var CAB_SPAN=0.42;
function cabPartX(x0,x1,y0,y1,z0,z1,uv,off,ao){
const V=[];const U0=uv[0],U1=uv[1],V0=uv[2],V1=uv[3],UW=U1-U0,VH=V1-V0;
const su=s=>(off[0]+s/CAB_SPAN)*UW, sv=t=>(off[1]+t/CAB_SPAN)*VH;
const q=(pts,n,co)=>{for(const tri of [[0,1,2],[0,2,3]])for(const i of tri){const p=pts[i],c=co[i];
V.push(p[0],p[1],p[2],U0+su(c[0]),V0+sv(c[1]),n[0],n[1],n[2],ao===undefined?1:ao);}};
const sx=x1-x0,sy=y1-y0,sz=z1-z0;
q([[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]],[0,0,-1],[[0,0],[0,sx],[sy,sx],[sy,0]]);
q([[x1,y0,z1],[x0,y0,z1],[x0,y1,z1],[x1,y1,z1]],[0,0,1],[[0,sx],[0,0],[sy,0],[sy,sx]]);
q([[x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0]],[1,0,0],[[0,0],[sz,0],[sz,sy],[0,sy]]);
q([[x0,y0,z1],[x0,y0,z0],[x0,y1,z0],[x0,y1,z1]],[-1,0,0],[[0,0],[sz,0],[sz,sy],[0,sy]]);
q([[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]],[0,1,0],[[0,0],[0,sx],[sz,sx],[sz,0]]);
q([[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]],[0,-1,0],[[0,0],[0,sx],[sz,sx],[sz,0]]);
return V; }
function buildCabinetData(){
const w=[UV_CAB.u0,UV_CAB.u1,UV_CAB.v0,UV_CAB.v1];
const w2=[UV_CAB2.u0,UV_CAB2.u1,UV_CAB2.v0,UV_CAB2.v1];
const wi=[UV_CABIN.u0,UV_CABIN.u1,UV_CABIN.v0,UV_CABIN.v1];
const V=partCat(
cabPartX(-0.17,-0.152,0.02,0.285,-0.09,0.09,w,[0.00,0.02],0.85),
cabPartX( 0.152,0.17,0.02,0.285,-0.09,0.09,w,[0.10,0.00],0.85),
/* back and bottom overlap the sides (±0.156 inside them): end faces don't coincide */
cabPartX(-0.156,0.156,0.030,0.285,0.072,0.086,w2,[0.02,0.00],0.8),
cabPartX(-0.156,0.156,0.024,0.044,-0.086,0.076,wi,[0.00,0.05],0.9),
cabPartX(-0.18,0.18,0.283,0.302,-0.098,0.098,w,[0.03,0.10],1.0),
cabPartX(-0.145,0.145,-0.02,0.024,-0.07,0.075,w2,[0.06,0.04],0.5),
/* cavity (visible with the drawer open) — dark interior */
cabPartX(-0.156,-0.144,0.040,0.242,-0.088,0.076,wi,[0.08,0.00],0.35),
cabPartX( 0.144,0.156,0.040,0.242,-0.088,0.076,wi,[0.08,0.06],0.35),
cabPartX(-0.148,0.148,0.238,0.246,-0.084,0.076,wi,[0.02,0.08],0.30),
cabPartX(-0.148,0.148,0.042,0.050,-0.084,0.076,wi,[0.05,0.02],0.38));
return {arr:new Float32Array(V),n:V.length/9}; }
/* cabinet drawer: paneled facade, sides, bottom, back, knob handle */
function buildCabinetDrawerData(){
const w=[UV_CAB.u0,UV_CAB.u1,UV_CAB.v0,UV_CAB.v1];
const wi=[UV_CABIN.u0,UV_CABIN.u1,UV_CABIN.v0,UV_CABIN.v1];
const q=UV_IRON,iw=q.u1-q.u0,ih=q.v1-q.v0;
/* smooth zone of the iron door (between panels) — no rivets, no plate */
const ir=[q.u0+iw*0.30,q.u0+iw*0.62,q.v0+ih*0.40,q.v0+ih*0.58];
const V=partCat(
cabPartX(-0.146,0.146,0.052,0.234,-0.098,-0.082,w,[0.00,0.06],1.0),
cabPartX(-0.126,0.126,0.072,0.212,-0.1005,-0.094,w,[0.06,0.00],0.92),
cabPartX(-0.140,-0.130,0.058,0.222,-0.086,0.055,wi,[0.10,0.02],0.55),
cabPartX( 0.130,0.140,0.058,0.222,-0.086,0.055,wi,[0.10,0.08],0.55),
cabPartX(-0.134,0.134,0.056,0.062,-0.086,0.050,wi,[0.02,0.10],0.5),
cabPartX(-0.134,0.134,0.058,0.218,0.045,0.053,wi,[0.06,0.06],0.5),
/* knob: brass, axis Y -> -Z (sticks out of the facade) */
partXf(partAO(loftPart([pr(0,0,0,0.011,0.011,2.2),pr(0.013,0,0,0.0135,0.0135,2.2),
pr(0.020,0,0,0.0085,0.0085,2.2)],10,ir,true),0.9),0,0.143,-0.098,-Math.PI/2,0,0));
return {arr:new Float32Array(V),n:V.length/9}; }
/* SAFE-ROOM TABLE (in cells): 1.24x0.70 m top on four legs. UV — tile cuts at
 uniform density (TBL_SPAN cells per side), each face has its own tile by
 grain direction: face/edge/leg, so nothing stretches. Part joints overlap
 only (legs and apron sunk into the top/each other) — no coplanar faces, no
 shimmer. Steel ties — volumetric belts around the top (not a texture drawing). */
var TBL_SPAN=0.42;
function tblRect(uv,ou,ov,lu,lv){
const uw=uv.u1-uv.u0,vh=uv.v1-uv.v0;
return [uv.u0+ou/TBL_SPAN*uw,uv.u0+(ou+lu)/TBL_SPAN*uw,uv.v0+ov/TBL_SPAN*vh,uv.v0+(ov+lv)/TBL_SPAN*vh]; }
/* quad by 4 corners with arbitrary st (0..1 tile fractions) */
function tblQuadST(a,b,c,d,n,uv,st,ao){
const V=[],pts=[a,b,c,d];
for(const tri of [[0,1,2],[0,2,3]])for(const i of tri){const p=pts[i],s=st[i];
V.push(p[0],p[1],p[2],uv.u0+(uv.u1-uv.u0)*s[0],uv.v0+(uv.v1-uv.v0)*s[1],n[0],n[1],n[2],ao);}
return V; }
/* same by an absolute rect [u0,u1,v0,v1] */
function tblQuadRC(a,b,c,d,n,r,ao){
const V=[],pts=[a,b,c,d],st=[[0,0],[1,0],[1,1],[0,1]];
for(const tri of [[0,1,2],[0,2,3]])for(const i of tri){const p=pts[i],s=st[i];
V.push(p[0],p[1],p[2],r[0]+(r[1]-r[0])*s[0],r[2]+(r[3]-r[2])*s[1],n[0],n[1],n[2],ao);}
return V; }
/* box: ±Y cut from uvY (u along X, v along Z), sides — from uvS (u along the
 face horizontal, v along Y); o* — per-face cut offsets in cells (never leave
 the tile: off+len <= TBL_SPAN) */
function tblBox(x0,x1,y0,y1,z0,z1,uvY,uvS,oY,oY2,oZ,oZ2,oX,oX2,ao){
const V=[],sx=x1-x0,sy=y1-y0,sz=z1-z0;
const q=(a,b,c,d,n,uv,o,l)=>{V.push.apply(V,tblQuadRC(a,b,c,d,n,tblRect(uv,o[0],o[1],l[0],l[1]),ao));};
q([x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[0,0,-1],uvS,oZ,[sx,sy]);
q([x1,y0,z1],[x0,y0,z1],[x0,y1,z1],[x1,y1,z1],[0,0,1],uvS,oZ2,[sx,sy]);
q([x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0],[1,0,0],uvS,oX,[sz,sy]);
q([x0,y0,z1],[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],[-1,0,0],uvS,oX2,[sz,sy]);
q([x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],[0,1,0],uvY,oY,[sx,sz]);
q([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0],uvY,oY2,[sx,sz]);
return V; }
/* steel tie: a belt around the top with a 1.5 mm standoff (a gap instead of
 coplanar). Tile bands: A — face with rivets, B — skirt with screws, C — back. */
function tblStrap(cz,ao){
const x0=-0.2115,x1=0.2115,y0=0.2365,y1=0.2575,z0=cz-0.012,z1=cz+0.012;
const uv=UV_TBL_STRAP,V=[];
const sZ=z=>0.03+0.94*(z-z0)/(z1-z0), sX=x=>0.02+0.20*(x-x0)/(x1-x0);
const sXe=x=>0.58+0.40*(x-x0)/(x1-x0), sY=y=>0.30+0.20*(y-y0)/(y1-y0);
const sYe=y=>0.58+0.40*(y-y0)/(y1-y0), sXc=x=>0.03+0.94*(x-x0)/(x1-x0);
V.push.apply(V,tblQuadST([x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1],[0,1,0],uv,
 [[sZ(z0),sX(x0)],[sZ(z0),sX(x1)],[sZ(z1),sX(x1)],[sZ(z1),sX(x0)]],ao));
V.push.apply(V,tblQuadST([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0],uv,
 [[sZ(z0),sXe(x0)],[sZ(z0),sXe(x1)],[sZ(z1),sXe(x1)],[sZ(z1),sXe(x0)]],ao));
V.push.apply(V,tblQuadST([x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0],[1,0,0],uv,
 [[sZ(z0),sY(y0)],[sZ(z1),sY(y0)],[sZ(z1),sY(y1)],[sZ(z0),sY(y1)]],ao));
V.push.apply(V,tblQuadST([x0,y0,z1],[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],[-1,0,0],uv,
 [[sZ(z1),sY(y0)],[sZ(z0),sY(y0)],[sZ(z0),sY(y1)],[sZ(z1),sY(y1)]],ao));
V.push.apply(V,tblQuadST([x1,y0,z1],[x0,y0,z1],[x0,y1,z1],[x1,y1,z1],[0,0,1],uv,
 [[sXc(x1),sYe(y0)],[sXc(x0),sYe(y0)],[sXc(x0),sYe(y1)],[sXc(x1),sYe(y1)]],ao));
V.push.apply(V,tblQuadST([x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[0,0,-1],uv,
 [[sXc(x0),sYe(y0)],[sXc(x1),sYe(y0)],[sXc(x1),sYe(y1)],[sXc(x0),sYe(y1)]],ao));
return V; }
function buildTableData(){
const T=UV_TBL_TOP,E=UV_TBL_EDGE,L=UV_TBL_LEG;
const V=partCat(
tblBox(-0.21,0.21,0.238,0.256,-0.12,0.12,T,E,[0,0],[0,0],[0,0.30],[0,0.36],[0.16,0.30],[0.16,0.34],1.0),
/* legs are sunk into the top down to y=0.246 (overlap, no coplanar) */
tblBox(-0.195,-0.175,0.0,0.246,-0.105,-0.085,L,L,[0.10,0.10],[0.10,0.15],[0,0],[0.06,0.05],[0.05,0],[0.09,0.05],0.8),
tblBox( 0.175,0.195,0.0,0.246,-0.105,-0.085,L,L,[0.10,0.10],[0.10,0.15],[0.12,0],[0.18,0.05],[0.14,0],[0.18,0.05],0.8),
tblBox(-0.195,-0.175,0.0,0.246, 0.085,0.105,L,L,[0.16,0.10],[0.16,0.15],[0.24,0],[0.30,0.05],[0.23,0],[0.27,0.05],0.8),
tblBox( 0.175,0.195,0.0,0.246, 0.085,0.105,L,L,[0.16,0.10],[0.16,0.15],[0.36,0],[0.02,0.05],[0.32,0],[0.36,0.05],0.8),
/* the apron is sunk into the legs along X (overlap) */
tblBox(-0.186,0.186,0.10,0.115,-0.098,-0.088,E,E,[0.02,0.38],[0.02,0.40],[0.02,0.30],[0.02,0.34],[0.30,0.30],[0.34,0.30],0.6),
tblStrap(-0.066,0.95),
tblStrap( 0.066,0.95));
return {arr:new Float32Array(V),n:V.length/9}; }

function tboxPart(y0,y1,w0,w1,d0,d1){
const V=[];const push=(p,n)=>{V.push(p[0],p[1],p[2],0.5,0.5,n[0],n[1],n[2],1)};
const quad=(a,b,c,d,n)=>{for(const tri of [[0,1,2],[0,2,3]])for(const i of tri)push([a,b,c,d][i],n)};
quad([-w0,y0,-d0],[w0,y0,-d0],[w1,y1,-d1],[-w1,y1,-d1],[0,0,-1]);
quad([w0,y0,d0],[-w0,y0,d0],[-w1,y1,d1],[w1,y1,d1],[0,0,1]);
quad([w0,y0,-d0],[w0,y0,d0],[w1,y1,d1],[w1,y1,-d1],[1,0,0]);
quad([-w0,y0,d0],[-w0,y0,-d0],[-w1,y1,-d1],[-w1,y1,d1],[-1,0,0]);
quad([-w1,y1,d1],[w1,y1,d1],[w1,y1,-d1],[-w1,y1,-d1],[0,1,0]);
quad([-w0,y0,-d0],[w0,y0,-d0],[w0,y0,d0],[-w0,y0,d0],[0,-1,0]);
return V; }

/* ================ PLAYER CHARACTER ================
 One rig for four tasks: puddle reflection, third person, first-person
 viewmodel (root = invView*VM_FRAME, torso/head hidden) and the mannequin.
 The rig is in WORLD space: +Y up, face and toes toward local -Z. Atlas
 materials live in disjoint u-zones with guard columns; alpha = height for
 bump. Poses — ANIM_CLIPS clips: gaits are solved by 2-bone IK over the foot
 trajectory, root height — from support kinematics, in flight — a ballistic
 arc. Contracts: buildPlayerRig, genSkinTex(seed), PREG/PMAT, fkAll + csSkin.
 Clips write pitches in the +Z convention, the rig looks toward -Z — signs
 flip at the "clip->pose" boundary (PL_FLIP). */


/* ---- geometry ---- */
function partAO(V,ao){ for(let i=8;i<V.length;i+=9)V[i]=ao; return V; }
function partCat(){ const out=[]; for(const a of arguments)for(let i=0;i<a.length;i++)out.push(a[i]); return out; }
function partXf(V,dx,dy,dz,rx,ry,rz){
const cX=Math.cos(rx||0),sX=Math.sin(rx||0),cY=Math.cos(ry||0),sY=Math.sin(ry||0),cZ=Math.cos(rz||0),sZ=Math.sin(rz||0);
const m=[cY*cZ+sY*sX*sZ, -cY*sZ+sY*sX*cZ, sY*cX,
         cX*sZ,          cX*cZ,           -sX,
         -sY*cZ+cY*sX*sZ, sY*sZ+cY*sX*cZ,  cY*cX];
const o=[];
for(let k=0;k<V.length;k+=9){
 const x=V[k],y=V[k+1],z=V[k+2];
 o.push(m[0]*x+m[1]*y+m[2]*z+dx, m[3]*x+m[4]*y+m[5]*z+dy, m[6]*x+m[7]*y+m[8]*z+dz, V[k+3],V[k+4]);
 const nx=V[k+5],ny=V[k+6],nz=V[k+7];
 const lx=m[0]*nx+m[1]*ny+m[2]*nz,ly=m[3]*nx+m[4]*ny+m[5]*nz,lz=m[6]*nx+m[7]*ny+m[8]*nz;
 const l=Math.hypot(lx,ly,lz)||1;o.push(lx/l,ly/l,lz/l,V[k+8]);
}
return o; }
function partShift(V,dx,dy,dz){ for(let i=0;i<V.length;i+=9){V[i]+=dx;V[i+1]+=dy;V[i+2]+=dz} return V; }
const pr=(y,cx,cz,w,d,e)=>[y,cx||0,cz||0,w,d,e||2.4];
/* smooth loft: a sequence of superelliptic sections, bridged by quads with
 smoothed normals. ring=[y,cx,cz,w,d,exp]. */
function loftPart(rings,seg,uv,caps){
const NR=rings.length,V=[];const P=[];
for(let ri=0;ri<NR;ri++){const R=rings[ri],row=[];
for(let si=0;si<seg;si++){const a=(si/seg)*Math.PI*2,c=Math.cos(a),s2=Math.sin(a),ex=R[5]||2.2;
const x=Math.sign(c)*Math.pow(Math.abs(c),2/ex)*R[3],z=Math.sign(s2)*Math.pow(Math.abs(s2),2/ex)*R[4];
row.push([x+(R[1]||0),R[0],z+(R[2]||0)]);}
P.push(row);}
const NG=[];
for(let ri=0;ri<NR;ri++){const row=[];
for(let si=0;si<seg;si++){
const pu=P[ri][(si+1)%seg],pd=P[ri][(si-1+seg)%seg];
const up=P[Math.min(NR-1,ri+1)][si],dn=P[Math.max(0,ri-1)][si];
const t1=[pu[0]-pd[0],pu[1]-pd[1],pu[2]-pd[2]],t2=[up[0]-dn[0],up[1]-dn[1],up[2]-dn[2]];
let n=[t1[1]*t2[2]-t1[2]*t2[1],t1[2]*t2[0]-t1[0]*t2[2],t1[0]*t2[1]-t1[1]*t2[0]];
const l=Math.hypot(n[0],n[1],n[2])||1;n=[n[0]/l,n[1]/l,n[2]/l];
const cx2=P[ri][si][0]-(rings[ri][1]||0),cz2=P[ri][si][2]-(rings[ri][2]||0);
if(n[0]*cx2+n[2]*cz2<0)n=[-n[0],-n[1],-n[2]];
row.push(n);}
NG.push(row);}
const push=(pt,n,u,v)=>{V.push(pt[0],pt[1],pt[2],u,v,n[0],n[1],n[2],1)};
const U=x=>uv[0]+(uv[1]-uv[0])*x,W=x=>uv[2]+(uv[3]-uv[2])*x;
for(let ri=0;ri<NR-1;ri++)for(let si=0;si<seg;si++){const sj=(si+1)%seg;
const uB=(si===seg-1)?uv[1]:U((si+1)/seg);
const a=P[ri][si],b=P[ri][sj],c=P[ri+1][sj],d=P[ri+1][si];
push(a,NG[ri][si],U(si/seg),W(ri/(NR-1)));push(b,NG[ri][sj],uB,W(ri/(NR-1)));push(c,NG[ri+1][sj],uB,W((ri+1)/(NR-1)));
push(a,NG[ri][si],U(si/seg),W(ri/(NR-1)));push(c,NG[ri+1][sj],uB,W((ri+1)/(NR-1)));push(d,NG[ri+1][si],U(si/seg),W((ri+1)/(NR-1)));}
if(caps){for(let si=0;si<seg;si++){const sj=(si+1)%seg;
push([rings[0][1]||0,rings[0][0],rings[0][2]||0],[0,-1,0],U(si/seg),W(0));push(P[0][sj],[0,-1,0],U((si+1)/seg),W(0));push(P[0][si],[0,-1,0],U(si/seg),W(0));
push([rings[NR-1][1]||0,rings[NR-1][0],rings[NR-1][2]||0],[0,1,0],U(si/seg),W(1));push(P[NR-1][si],[0,1,0],U(si/seg),W(1));push(P[NR-1][sj],[0,1,0],U((si+1)/seg),W(1));}}
return V; }
function clawPart(len,r0,seg,uvv){ return loftPart([[0,0,0,r0,r0,2.0],[-len*0.45,0,-len*0.10,r0*0.62,r0*0.62,2.0],[-len,0,-len*0.34,r0*0.10,r0*0.10,2.0]],seg,uvv||[0.02,0.48,0.02,0.98],true); }

/* smoothed mesh normals (nu x nv, stride 9), wrapU — closed over i */
function smoothGridNormals(V,nu,nv,wrapU){
const N=new Float32Array(V.length/9*3);
const idx=(i,j)=>j*nu+i;
const P=k=>[V[k*9],V[k*9+1],V[k*9+2]];
const addN=(k,n)=>{N[k*3]+=n[0];N[k*3+1]+=n[1];N[k*3+2]+=n[2];};
const imax=wrapU?nu:nu-1;
for(let j=0;j<nv-1;j++)for(let i=0;i<imax;i++){
 const i2=wrapU?(i+1)%nu:i+1;
 const a=P(idx(i,j)),b=P(idx(i2,j)),c=P(idx(i2,j+1)),d=P(idx(i,j+1));
 const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[d[0]-a[0],d[1]-a[1],d[2]-a[2]];
 let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
 const l=Math.hypot(n[0],n[1],n[2])||1;n=[n[0]/l,n[1]/l,n[2]/l];
 addN(idx(i,j),n);addN(idx(i2,j),n);addN(idx(i2,j+1),n);addN(idx(i,j+1),n);
}
for(let k=0;k<V.length/9;k++){
 const l=Math.hypot(N[k*3],N[k*3+1],N[k*3+2])||1;
 V[k*9+5]=N[k*3]/l;V[k*9+6]=N[k*3+1]/l;V[k*9+7]=N[k*3+2]/l;
}
return V; }
function gridToTris(V,nu,nv,wrapU){
const out=[];const push=k=>{for(let q=0;q<9;q++)out.push(V[k*9+q]);};
const idx=(i,j)=>j*nu+i;const imax=wrapU?nu:nu-1;
for(let j=0;j<nv-1;j++)for(let i=0;i<imax;i++){
 const i2=wrapU?(i+1)%nu:i+1;
 const a=idx(i,j),b=idx(i2,j),c=idx(i2,j+1),d=idx(i,j+1);
 push(a);push(b);push(c);push(a);push(c);push(d);
}
return out; }
/* turn normals outward from the head axis (0,y,cz(y)) */
function normalsOutward(V,centerFn){
for(let k=0;k<V.length/9;k++){
 const x=V[k*9],y=V[k*9+1],z=V[k*9+2],c=centerFn(y);
 const rx=x-c[0],rz=z-c[1];
 const nx=V[k*9+5],nz=V[k*9+7];
 if(nx*rx+nz*rz<0){V[k*9+5]=-nx;V[k*9+6]=-V[k*9+6];V[k*9+7]=-nz;}
}
return V; }
const cl01=v=>v<0?0:(v>1?1:v);
const clp=(v,a,b)=>v<a?a:(v>b?b:v);
const smk=k=>k*k*(3-2*k);

/* ==== HEAD. phi=0 — face (local -Z), ±π — nape. y — up from the hd bone. ==== */
const HEAD_Y0=-0.040, HEAD_Y1=0.203;
const HEAD_PROF=[
[-0.040,0.034,0.038,-0.026,2.1],
[-0.022,0.050,0.056,-0.021,2.2],
[ 0.000,0.060,0.069,-0.014,2.3],
[ 0.024,0.066,0.077,-0.009,2.4],
[ 0.052,0.070,0.083,-0.005,2.5],
[ 0.086,0.074,0.087,-0.003,2.6],
[ 0.118,0.078,0.091,-0.001,2.7],
[ 0.152,0.076,0.089, 0.001,2.7],
[ 0.178,0.066,0.079, 0.004,2.6],
[ 0.203,0.014,0.020, 0.008,2.4]];
function hermite(t){return t*t*(3-2*t);}
function profAt(y){
const P=HEAD_PROF;
y=clp(y,P[0][0],P[P.length-1][0]);
let i=0;while(i<P.length-2&&y>P[i+1][0])i++;
const t=hermite(cl01((y-P[i][0])/(P[i+1][0]-P[i][0])));
const o=[y];for(let k=1;k<5;k++)o[k]=P[i][k]+(P[i+1][k]-P[i][k])*t;
return o; }
const HEAD_BUMPS=[
[ 0.42,0.088,-0.0080,0.26,0.030],[-0.42,0.088,-0.0080,0.26,0.030],  /* eye sockets */
[ 0.36,0.124, 0.0075,0.30,0.016],[-0.36,0.124, 0.0075,0.30,0.016],  /* brow ridges */
[ 0.82,0.070, 0.0060,0.32,0.028],[-0.82,0.070, 0.0060,0.32,0.028],  /* cheekbones */
[ 1.25,0.132,-0.0045,0.30,0.040],[-1.25,0.132,-0.0045,0.30,0.040],  /* temples */
[ 1.50,0.012, 0.0050,0.32,0.034],[-1.50,0.012, 0.0050,0.32,0.034],  /* jaw angles */
[ 0.00,-0.032, 0.0090,0.32,0.024],                                   /* chin */
[ 0.00, 0.006,-0.0055,0.40,0.018],                                   /* mouth hollow */
[ Math.PI,0.020,0.0070,0.60,0.050],                                  /* nape */
[ 0.00, 0.152, 0.0035,0.50,0.034],                                   /* forehead */
[ 0.00, 0.064,-0.0035,0.15,0.018],                                   /* nose bridge */
[ 0.55,0.045, 0.0040,0.30,0.030],[-0.55,0.045, 0.0040,0.30,0.030],  /* cheeks */
[ 0.55,-0.014,-0.0028,0.28,0.020],[-0.55,-0.014,-0.0028,0.28,0.020] /* under the cheekbones */
];
function headSurf(phi,y){
const p=profAt(y);
const c=Math.cos(phi),s=Math.sin(phi),e=p[4];
const x=Math.sign(s)*Math.pow(Math.abs(s),2/e)*p[1];
const z=-Math.sign(c)*Math.pow(Math.abs(c),2/e)*p[2]+p[3];
let r=0;
for(const b of HEAD_BUMPS){
 let d=phi-b[0]; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI;
 r+=b[2]*Math.exp(-(d*d)/(2*b[3]*b[3])-((y-b[1])*(y-b[1]))/(2*b[4]*b[4]));
}
const rx=x,rz=z-p[3],rl=Math.hypot(rx,rz)||1;
return [x+rx/rl*r, y, z+rz/rl*r];
}
function headNorm(phi,y){
const e=0.0035;
const p=headSurf(phi,y),pu=headSurf(phi+e,y),pv=headSurf(phi,y+e);
const u=[pu[0]-p[0],pu[1]-p[1],pu[2]-p[2]],v=[pv[0]-p[0],pv[1]-p[1],pv[2]-p[2]];
let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
const l=Math.hypot(n[0],n[1],n[2])||1;n=[n[0]/l,n[1]/l,n[2]/l];
const c=profAt(y)[3];
if(n[0]*p[0]+n[2]*(p[2]-c)<0)n=[-n[0],-n[1],-n[2]];
return n; }
/* head UV: the face (|phi|<60°) gets ~62% of the skin zone width */
const HEAD_U0=0.500,HEAD_U1=0.700,HEAD_V0=0.500,HEAD_V1=0.985;
const HEAD_WP=0.435;
function headU(phi){
const a=clp(phi/(2*Math.PI),-0.5,0.5);
const d=Math.min(1,Math.abs(a)*2);
return HEAD_U0+(HEAD_U1-HEAD_U0)*(0.5+Math.sign(a)*0.5*Math.pow(d,HEAD_WP));
}
function headV(y){ return HEAD_V0+(HEAD_V1-HEAD_V0)*cl01((y-HEAD_Y0)/(HEAD_Y1-HEAD_Y0)); }
function headUV(phi,y){ return [headU(phi),headV(y)]; }
function invHeadU(u){
const q=cl01((u-HEAD_U0)/(HEAD_U1-HEAD_U0));
return Math.sign(q-0.5)*Math.pow(Math.abs(q-0.5)*2,1/HEAD_WP)*Math.PI;
}
function invHeadV(v){ return HEAD_Y0+(HEAD_Y1-HEAD_Y0)*cl01((v-HEAD_V0)/(HEAD_V1-HEAD_V0)); }
/* eye: a separate UV window in the service strip under the chin */
const EYE_U0=0.502,EYE_U1=0.698,EYE_V0=0.482,EYE_V1=0.498;

/* ================ FACIAL FEATURES ================
 Baked right into the skull surface (single mesh, no seams). Sizes are in arc
 meters: hx — along the face horizontal, hy — height. */
const EYE_HX=0.0315, EYE_HY=0.0880;      /* eye centers (x,y) */
const EYE_R=0.0135, EYE_ZC=-0.0602;      /* eyeball radius and center depth */
const EYE_AX=0.0075, EYE_AY=0.0052;      /* eye-slit half-axes */
function faceFeat(hx,hy){
let h=0;
for(const sg of [1,-1]){
 const dx=hx-sg*EYE_HX;
 /* brow */
 const arc=0.117+0.011*(1-cl01(Math.abs(dx)/0.048)*(Math.abs(dx)/0.048));
 const bt=smk(cl01(1-Math.pow(Math.abs(dx)/0.046,2)));
 h+=0.0052*Math.exp(-Math.pow((hy-arc)/0.0080,2))*bt;
}
/* nose */
const bridge=0.0075*Math.exp(-Math.pow(hx/0.0082,2))*smk(cl01((hy-0.030)/0.048));
const tip=0.0165*Math.exp(-Math.pow(hx/0.0078,2))*Math.exp(-Math.pow((hy-0.047)/0.0128,2));
const ala=0.0062*Math.exp(-Math.pow((Math.abs(hx)-0.0170)/0.0062,2))*Math.exp(-Math.pow((hy-0.037)/0.0112,2));
const nostril=-0.0050*Math.exp(-Math.pow((Math.abs(hx)-0.0108)/0.0040,2))*Math.exp(-Math.pow((hy-0.0245)/0.0048,2));
h+=Math.max(0,bridge+tip+ala)+nostril;
h-=0.0012*Math.exp(-Math.pow(hx/0.0040,2))*Math.exp(-Math.pow((hy-0.0250)/0.0060,2)); /* philtrum */
/* mouth */
const tm=smk(cl01(1-Math.pow(Math.abs(hx)/0.0265,2)));
const upper=0.0060*Math.exp(-Math.pow((hy-0.0165)/0.0088,2))*(0.80+0.20*Math.exp(-Math.pow((Math.abs(hx)-0.010)/0.008,2)));
const lower=0.0072*Math.exp(-Math.pow((hy-0.0035)/0.0098,2))*(0.85+0.15*Math.exp(-Math.pow(hx/0.010,2)));
const line=-0.0052*Math.exp(-Math.pow((hy-0.0110)/0.0030,2));
const corner=-0.0028*Math.exp(-Math.pow((Math.abs(hx)-0.0245)/0.0040,2))*Math.exp(-Math.pow((hy-0.011)/0.008,2));
h+=(upper+lower+line+corner)*tm;
/* chin and nasolabial folds */
h-=0.0018*Math.exp(-Math.pow((hy+0.014)/0.0060,2))*Math.exp(-Math.pow(hx/0.012,2));
h-=0.0012*Math.exp(-Math.pow((Math.abs(hx)-0.020)/0.005,2))*Math.exp(-Math.pow((hy-0.030)/0.012,2));
return h;
}
function headSurfF(phi,y){
const p=headSurf(phi,y);
if(Math.abs(phi)>1.85)return p;                 /* features only on the face/cheekbones */
const hx=phi*0.075;
const n=headNorm(phi,y);
const h=faceFeat(hx,y);
let q=[p[0]+n[0]*h,p[1]+n[1]*h,p[2]+n[2]*h];
/* lids as a shell around the eyeball + the eye slit */
for(const sg of [1,-1]){
 const dx=q[0]-sg*EYE_HX, dy=q[1]-EYE_HY;
 const off=Math.hypot(dx,dy);
 if(off>EYE_R*1.25)continue;
 const zz=Math.sqrt(Math.max(EYE_R*EYE_R-off*off,1e-8));
 const ex=dx/EYE_AX, ey=dy/EYE_AY;
 const rho=Math.hypot(ex,ey);
 let z;
 if(rho<1.0)z=EYE_ZC-zz+0.0012;                                   /* slit: behind the cornea */
 else if(rho<1.45)z=EYE_ZC-zz-0.0018-0.0010*smk(cl01((rho-1.0)/0.45)); /* lid rim */
 else z=EYE_ZC-zz-0.0028;                                         /* lid on the eyeball */
 /* blending with the face surface */
 const k=smk(cl01((off-EYE_R*0.95)/(EYE_R*0.30)));
 q[2]=z+(q[2]-z)*k;
}
return q;
}
/* non-uniform sampling: more rows and columns for the face */
function phiAt(q){ const d=(q-0.5)*2; return Math.sign(d)*Math.pow(Math.abs(d),1.30)*Math.PI; }
function yAt(t){ return HEAD_Y0+(HEAD_Y1-HEAD_Y0)*(t-0.30*Math.sin(2*Math.PI*(t-0.42))/(2*Math.PI)); }

function headGrid(nu,nv){
const V=[];
for(let j=0;j<nv;j++){
 /* yAt on the last row "overshoots" the crown (0.2096 instead of 0.203), so y
 is clamped to HEAD_Y1 — otherwise the skull's end ring sticks through the
 hair like a bright collar. The skull needs no cap. */
 const y=Math.min(HEAD_Y1,yAt(j/(nv-1)));
 for(let i=0;i<nu;i++){
  const phi=phiAt(i/nu);
  const p=headSurfF(phi,y),uv=headUV(phi,y);
  V.push(p[0],p[1],p[2],uv[0],uv[1],0,0,0,1);
 }
}
smoothGridNormals(V,nu,nv,true);
normalsOutward(V,y=>[0,profAt(y)[3]]);
const tris=gridToTris(V,nu,nv,true);
const cz=profAt(HEAD_Y1)[3];
const top=[0,HEAD_Y1+0.0006,cz];
for(let i=0;i<nu;i++){
 const ka=((nv-1)*nu+i)*9, kb=((nv-1)*nu+(i+1)%nu)*9;
 tris.push(top[0],top[1],top[2],0.6,0.98,0,0.97,0.2,1);
 for(const k of [ka,kb])for(let q=0;q<9;q++)tris.push(V[k+q]);
}
return tris;
}
/* eyeball: a sphere, view axis -Z; UV: u — meridian, v — polar angle */
function eyeball(cx,cy,cz,R){
const ns=12,nt=9,V=[];
for(let j=0;j<nt;j++){
 const th=(j/(nt-1))*1.35;
 for(let i=0;i<ns;i++){
  const ph=(i/ns)*2*Math.PI;
  const d=[Math.sin(th)*Math.sin(ph),Math.sin(th)*Math.cos(ph),-Math.cos(th)];
  const x=cx+R*d[0],y=cy+R*d[1]*0.96,z=cz+R*d[2];
  const u=EYE_U0+(EYE_U1-EYE_U0)*(i/ns), v=EYE_V0+(EYE_V1-EYE_V0)*(th/1.35);
  V.push(x,y,z,u,v,d[0],d[1],d[2],1);
 }
}
return gridToTris(V,ns,nt,true);
}
/* ear: a flattened ellipsoid with a concha, root sunk into the skull */
function earPart(sg){
const ns=14,nt=12,V=[];
const CX=sg*0.0705,CY=0.070,CZ=0.012;      /* ear center */
const RX=0.010,RY=0.032,RZ=0.021;          /* half-axes: thickness, height, depth */
const tilt=0.16*sg, yaw=0.35*sg;           /* tilted back and outward */
for(let j=0;j<nt;j++){
 const th=(j/(nt-1))*Math.PI;              /* 0..π top to bottom */
 for(let i=0;i<ns;i++){
  const ph=(i/ns)*2*Math.PI;              /* around the ear */
  let dx=Math.sin(th)*Math.sin(ph)*RX, dy=Math.cos(th)*RY, dz=Math.sin(th)*Math.cos(ph)*RZ;
  /* concha: a hollow on the outer side, front-bottom */
  const conch=Math.exp(-Math.pow((ph-Math.PI*0.5)/1.1,2)-Math.pow((th-Math.PI*0.55)/0.75,2));
  dx-=sg*conch*0.0045;
  /* helix: a ridge along the rim */
  const rim=Math.exp(-Math.pow((Math.hypot(Math.sin(ph)*1.0,Math.cos(th)*1.0)-0.92)/0.30,2));
  dx+=sg*rim*0.0022;
  /* tilt */
  const y2=dy*Math.cos(tilt)-dz*Math.sin(tilt), z2=dy*Math.sin(tilt)+dz*Math.cos(tilt);
  const x3=dx*Math.cos(yaw)+z2*Math.sin(yaw), z3=-dx*Math.sin(yaw)+z2*Math.cos(yaw);
  const u=0.50+0.20*(i/ns), v=0.30+0.18*(j/(nt-1));
  V.push(CX+x3,CY+y2,CZ+z3,u,v,sg,0,0,1);
 }
}
smoothGridNormals(V,ns,nt,true);
return gridToTris(V,ns,nt,true);
}

/* ---- head parts assembly ---- */
function buildHeadParts(){
return partCat(
 partAO(headGrid(44,38),0.55),
 partAO(eyeball( EYE_HX,EYE_HY,EYE_ZC,EYE_R),0.66),
 partAO(eyeball(-EYE_HX,EYE_HY,EYE_ZC,EYE_R),0.66),
 partAO(earPart(1),0.58),
 partAO(earPart(-1),0.58));
}

/* ==== BODY. Bone names/offsets are fixed by the clips and support kinematics. ==== */
/* Leg proportions: thigh 0.460 + shin 0.385 = 0.845 rig (0.85 m reach).
 Reach is the hard step ceiling: (S/2)^2 + (hipBase - ankle)^2 <= (L1+L2-0.008)^2.
 Crown at 1.773 rig; CELL_M is chosen so 1.773*PL_SCALE*CELL_M = 1.80 m. */
const PL_HIP=0.955, PL_THLEN=0.460, PL_SNLEN=0.385;

/* ---- hair ---- */
function hairLine(phi){
const a=Math.abs(phi);
if(a<0.55)return 0.126-0.008*smk(cl01(a/0.55));
if(a<1.05)return 0.118-0.018*smk(cl01((a-0.55)/0.50));
if(a<1.45)return 0.108-0.055*smk(cl01((a-1.05)/0.40));
if(a<2.05)return 0.053-0.020*smk(cl01((a-1.45)/0.60));
return 0.033-0.012*smk(cl01((a-2.05)/1.10));
}
function buildHair(HR){
/* THE CROWN IS CLOSED: the last hair-grid row is the pole (collapsed
 vertex), the mesh is stitched with a fan. An open ring at t=1 let the bright
 skull cap show through. */
const nu=32,nv=12,V=[];
for(let j=0;j<nv;j++){
 const t=j/(nv-1);
 for(let i=0;i<nu;i++){
  const phi=(i/nu-0.5)*2*Math.PI;
  if(t>0.999){   /* crown pole: all i collapse to one point */
   const uu=HR[0]+(HR[1]-HR[0])*0.5, vv=HR[3];
   V.push(0,HEAD_Y1+0.005,profAt(HEAD_Y1)[3],uu,vv,0,0,0,1);
   continue;
  }
  const y0=hairLine(phi), y=y0+(HEAD_Y1+0.006-y0)*t;
  const p=headSurfF(phi,Math.min(y,HEAD_Y1));
  const n=headNorm(phi,Math.min(y,HEAD_Y1));
  const thick=0.007+0.008*Math.sin(Math.PI*cl01(t))* (0.7+0.3*Math.sin(phi*7.0));
  const strand=0.0012*Math.sin(phi*23.0+t*9.0)+0.0008*Math.sin(phi*41.0-t*5.0);
  const h=thick+strand+(t<0.12?0.003*(1-t/0.12):0);
  const uu=HR[0]+(HR[1]-HR[0])*(i/nu), vv=HR[2]+(HR[3]-HR[2])*t;
  V.push(p[0]+n[0]*h,p[1]+n[1]*h,p[2]+n[2]*h,uu,vv,0,0,0,1);
 }
}
smoothGridNormals(V,nu,nv,true);
normalsOutward(V,y=>[0,profAt(y)[3]]);
/* at the hair-dome apex smoothing can point normals down — the crown shaded
 as a "black dot". In the top zone force the vertical component up: the dome
 is always lit from above. */
for(let k=1;k<V.length;k+=9){ if(V[k]>HEAD_Y1-0.015&&V[k+5]<0)V[k+5]=-V[k+5]; }
const out=gridToTris(V,nu,nv,true);
/* fringe: a couple of strands over the forehead for the silhouette */
for(const sg of [1,-1]){
 out.push.apply(out,partAO(partXf(loftPart([
  pr(0,0,0,0.020,0.010,2.2),pr(-0.030,0,-0.004,0.016,0.008,2.2),pr(-0.055,0,-0.008,0.008,0.005,2.0)],7,HR,true),
  sg*0.030,0.150,-0.070, -0.5, sg*0.35, sg*0.5),0.6));
}
return out;
}

/* ---- hand with fingers ---- */
/* by UV windows: palm [0.500..0.600]x[0.30..0.48], fingers [0.600..0.700]x[0.06..0.30] */
const FING_UV=[0.600,0.700,0.060,0.300];
function fingerPart(len,r0,r1,uv){
return loftPart([pr(0,0,0,r0,r0*0.82,2.3),pr(-len*0.45,0,-0.001,r0*0.92,r0*0.80,2.3),
                 pr(-len,0,-0.002,r1,r1*0.85,2.2)],6,uv,true);
}

/* ==== PLAYER RIG ==== */
function makeRig(){
const B=[],idx={},names=[];
const add=(name,parent,off,V)=>{idx[name]=B.length;names.push(name);
B.push({parent:(typeof parent==='string')?idx[parent]:parent,off,v:new Float32Array(V),n:V.length/9,m:new Float32Array(16)});
return idx[name]};
return {B:B,idx:idx,names:names,add:add,
 finish(hideNames){let total=0;for(const b of B)total+=b.n;
  const hide={};for(const n of (hideNames||[]))if(idx[n]!==undefined)hide[idx[n]]=1;
  return {B:B,idx:idx,names:names,total:total,hide:hide};}};
}
const puv=(reg,v0,v1)=>[reg.u0,reg.u1,v0===undefined?0.06:v0,v1===undefined?0.94:v1];

function buildPlayerRig(PREGin){
if(PREGin)PREG=PREGin;
const R=makeRig();const add=R.add;
const AO=(V,a)=>partAO(V,a);
const SK=puv(PREG.skin,0.06,0.30);          /* neck */
const JK=puv(PREG.jacket),PT=puv(PREG.pants),BT=puv(PREG.boot),HR=puv(PREG.hair);
/* shoulder sleeve UV with flipped v: sections are listed bottom-up (the
 loftPart cap convention), the texture layout is normal. */
const JK_SH=(()=>{const j=puv(PREG.jacket);return [j[0],j[1],j[3],j[2]];})();
const JK_PLAIN=[0.7324,0.7732,0.25,0.60];
const JK_ZIP  =[0.8060,0.8220,0.30,0.80];
const JK_HOOD =[0.7760,0.8040,0.20,0.70];
const BT_PLAIN=[0.9300,0.9500,0.55,0.80];
const BT_BELT =[0.9300,0.9500,0.15,0.50];
const BT_BUCKLE=[0.9386,0.9457,0.50,0.61];
const BT_BADGE=[0.9512,0.9558,0.76,0.84];
const SK_HAND=[0.500,0.600,0.300,0.480];
const tub=(y0,y1,r0,r1,uv,e)=>AO(loftPart([pr(y0,0,0,r0,r0,e||2.4),pr(y1,0,0,r1,r1,e||2.4)],10,uv,true),0.55);
add('root',-1,[0,0,0],[]);

/* pelvis: pants + belt + buckle (all flush) */
add('pel','root',[0,PL_HIP,0],AO(partCat(
loftPart([pr(-0.080,0,0.010,0.146,0.110,2.6),pr(-0.020,0,0.004,0.154,0.116,2.6),
          pr( 0.030,0,0,0.150,0.112,2.5),pr( 0.075,0,-0.006,0.136,0.100,2.5)],14,PT,true),
/* the belt is a closed ring: an open bottom end reads as a hole in puddle reflections */
loftPart([pr(0.024,0,0.002,0.158,0.119,2.5),pr(0.062,0,-0.004,0.150,0.112,2.5)],12,BT_BELT,true),
partXf(loftPart([pr(-0.012,0,0,0.030,0.013,2.2),pr(0.012,0,0,0.030,0.013,2.2)],8,BT_BUCKLE,true),0,0.043,-0.116)),0.35));

/* lower back/belly: jacket */
add('spn','pel',[0,0.075,0],AO(partCat(
loftPart([pr(-0.025,0,0.004,0.142,0.106,2.5),pr(0.070,0,-0.002,0.147,0.111,2.5),
          pr(0.155,0,-0.006,0.151,0.115,2.5)],14,JK,true),
partXf(loftPart([pr(-0.025,0,-0.100,0.016,0.008,2.2),pr(0.155,0,-0.090,0.015,0.008,2.2)],6,JK_ZIP,true),0,0,0)),0.30));

/* chest: jacket + collar + zipper + pockets + hood on the back */
add('ch','spn',[0,0.150,0],AO(partCat(
loftPart([pr(-0.02,0,-0.004,0.151,0.115,2.5),pr(0.05,0,-0.008,0.163,0.123,2.6),
          pr(0.13,0,-0.010,0.169,0.127,2.6),pr(0.21,0,-0.006,0.156,0.116,2.5),
          pr(0.262,0,-0.002,0.132,0.097,2.5),pr(0.292,0,-0.004,0.096,0.072,2.6)],16,JK,true),
partXf(loftPart([pr(0.00,0,-0.112,0.017,0.009,2.2),pr(0.245,0,-0.094,0.015,0.008,2.2)],6,JK_ZIP,true),0,0,0),
/* breast pockets — flaps flush */
partXf(loftPart([pr(-0.024,0,0,0.040,0.010,2.2),pr(0.024,0,0,0.040,0.010,2.2)],8,JK,true),0.076,0.128,-0.116),
partXf(loftPart([pr(-0.024,0,0,0.040,0.010,2.2),pr(0.024,0,0,0.040,0.010,2.2)],8,JK,true),-0.076,0.128,-0.116),
partXf(loftPart([pr(-0.018,0,0,0.024,0.006,2.2),pr(0.018,0,0,0.024,0.006,2.2)],8,BT_BADGE,true),-0.056,0.196,-0.116),
/* hood: a roll on the back/shoulders */
partXf(loftPart([pr(-0.055,0,0,0.075,0.045,2.7),pr(-0.005,0,0,0.095,0.055,2.8),
                 pr(0.050,0,0,0.080,0.046,2.7)],12,JK_HOOD,true),0,0.235,0.078),
tub(-0.045,0.045,0.064,0.053,JK_PLAIN,2.5), partXf(tub(-0.045,0.045,0.064,0.053,JK_PLAIN,2.5),0.134,0.238,0),partXf(tub(-0.045,0.045,0.064,0.053,JK_PLAIN,2.5),-0.134,0.238,0)),0.25));

/* neck + collar */
add('nk','ch',[0,0.275,0],AO(partCat(
loftPart([pr(-0.030,0,0,0.055,0.050,2.4),pr(0.050,0,-0.004,0.050,0.046,2.4),
          pr(0.115,0,-0.006,0.047,0.044,2.4)],12,SK,true),
loftPart([pr(-0.030,0,0.002,0.078,0.070,2.4),pr(0.012,0,0,0.080,0.072,2.5),
          pr(0.036,0,-0.002,0.072,0.065,2.6)],14,JK_PLAIN,false)),0.35));

/* head: skull + eyeballs + ears; jaw — the mouth cavity; hair */
add('hd','nk',[0,0.115,0],AO(buildHeadParts(),0.55));
add('jaw','hd',[0,-0.010,-0.004],AO(partCat(
loftPart([pr(-0.020,0,0.010,0.030,0.034,2.4),pr(0.010,0,0.006,0.034,0.038,2.4)],8,[0.52,0.56,0.52,0.60],true)),0.9));
add('hr','hd',[0,0,0],AO(buildHair(HR),0.60));
add('earL','hd',[0,0,0],[]); add('earR','hd',[0,0,0],[]);

/* arms */
const FING={i:[0.030,0.046,0.030,0.024],m:[0.010,0.050,0.033,0.026],
            r:[-0.010,0.044,0.029,0.023],p:[-0.030,0.034,0.023,0.020]};
const arm=(sg,n)=>{
/* SHOULDERS: the sleeve is a closed dome (rounded head), the hem tapers
 inside the biceps — no gap, no dark "well"; 16 sections. */
add('sh'+n,'ch',[0.150*sg,0.243,0],AO(partCat(
loftPart([pr(-0.134,0,0,0.046,0.042,2.3),pr(-0.108,0,0,0.053,0.049,2.4),pr(-0.078,0,0,0.060,0.056,2.4),
          pr(-0.040,0,0,0.067,0.063,2.5),pr(0.000,0,0,0.069,0.065,2.5),pr(0.030,0,0,0.061,0.057,2.5),
          pr(0.050,0,0,0.047,0.044,2.6),pr(0.062,0,0,0.030,0.028,2.6)],16,JK_SH,true)),0.30));
add('ua'+n,'sh'+n,[0,-0.020,0],AO(partCat(
loftPart([pr(0.000,0,0,0.062,0.058,2.4),pr(-0.090,0,-0.003,0.058,0.055,2.4),
          pr(-0.180,0,-0.002,0.051,0.048,2.3),pr(-0.280,0,0,0.045,0.042,2.3)],12,JK,true),
partXf(loftPart([pr(-0.026,0,0,0.049,0.028,2.3),pr(0.026,0,0,0.047,0.027,2.3)],8,JK,true),0,-0.185,0.026)),0.35));
add('fa'+n,'ua'+n,[0,-0.280,0],AO(partCat(
loftPart([pr(0.000,0,0,0.045,0.042,2.3),pr(-0.070,0,-0.003,0.044,0.041,2.3),
          pr(-0.160,0,-0.004,0.037,0.034,2.3),pr(-0.235,0,-0.002,0.031,0.029,2.3)],12,JK,true),
/* cuffs are closed tubes: an open bottom end would give a black slit in reflections */
loftPart([pr(-0.212,0,0,0.039,0.036,2.3),pr(-0.248,0,0,0.037,0.034,2.3)],10,JK_PLAIN,true),
loftPart([pr(-0.248,0,0,0.036,0.032,2.3),pr(-0.286,0,0,0.033,0.029,2.3)],10,JK_PLAIN,true)),0.40));
add('ha'+n,'fa'+n,[0,-0.268,0],AO(partCat(
 buildHandParts(sg,SK_HAND)),0.55));
/* fingers: bones */
for(const f of ['i','m','r','p']){
 const F=FING[f];
 add(f+'1'+n,'ha'+n,[-F[0]*sg,-0.098,-0.003],[]);
 /* phalanx geometry hangs on its own bones */
}
for(const f of ['i','m','r','p']){
 const F=FING[f];
 add(f+'2'+n,f+'1'+n,[0,-F[1],0],[]);
 add(f+'3'+n,f+'2'+n,[0,-F[2],0],[]);
}
add('t1'+n,'ha'+n,[-0.030*sg,-0.024,-0.006],[]);
add('t2'+n,'t1'+n,[0,-0.040,0],[]);
};
/* finger geometry is spread over bones: reassembling by hand */
const fingerGeo=(sg,n)=>{
 const put=(bone,V)=>{const b=R.B[R.idx[bone]];const a=b.v;const nv=V;
  const merged=new Float32Array(a.length+nv.length);merged.set(a);merged.set(nv,a.length);
  b.v=merged;b.n=merged.length/9;};
 for(const f of ['i','m','r','p']){
  const F=FING[f];
  const segs=f==='i'?[[F[1],0.0085,0.0075],[F[2],0.0075,0.0065],[F[3],0.0065,0.0058]]
   :f==='m'?[[0.050,0.0088,0.0078],[0.033,0.0078,0.0068],[0.026,0.0068,0.0060]]
   :f==='r'?[[0.044,0.0082,0.0072],[0.029,0.0072,0.0062],[0.023,0.0062,0.0055]]
   :[[0.034,0.0072,0.0062],[0.023,0.0062,0.0054],[0.020,0.0055,0.0048]];
  for(let k=0;k<3;k++){
   const L=segs[k];
   const Vv=fingerPart(L[0],L[1],L[2],FING_UV);
   if(k===0){
    const kn=[];const ns2=7,nt2=5,Rr=L[1]*1.10;
    for(let j=0;j<nt2;j++){const th=(j/(nt2-1))*Math.PI;
     for(let i2=0;i2<ns2;i2++){const ph=(i2/ns2)*2*Math.PI;
      const d=[Math.sin(th)*Math.sin(ph),-Math.cos(th),Math.sin(th)*Math.cos(ph)*0.8];
      kn.push(d[0]*Rr,-0.001+d[1]*Rr*0.85,d[2]*Rr,0.655,0.20,d[0],d[1],d[2],1);}
    }
    Vv.push.apply(Vv,gridToTris(kn,ns2,nt2,false));
   }
   put(f+(k+1)+n,partAO(Vv,0.55));
  }
 }
 /* thumb */
 put('t1'+n,partAO(fingerPart(0.040,0.0105,0.0092,FING_UV),0.55));
 put('t2'+n,partAO(fingerPart(0.032,0.0090,0.0078,FING_UV),0.55));
};
arm(1,'L');arm(-1,'R');
fingerGeo(1,'L');fingerGeo(-1,'R');

/* legs */
const leg=(sg,n)=>{
add('th'+n,'pel',[0.086*sg,-0.055,0],AO(partCat(
loftPart([pr(0.000,0,0,0.096,0.090,2.5),pr(-0.111,0,-0.003,0.088,0.082,2.5),
          pr(-0.222,0,-0.005,0.078,0.072,2.4),pr(-0.333,0,-0.003,0.068,0.063,2.4),
          pr(-0.460,0,0,0.061,0.057,2.3)],14,PT,true),   /* x1.1084 = PL_THLEN */
),0.40));
add('sn'+n,'th'+n,[0,-PL_THLEN,0],AO(partCat(
loftPart([pr(0.000,0,0,0.060,0.056,2.3),pr(-0.077,0,0.008,0.058,0.060,2.4),
          pr(-0.176,0,0.004,0.048,0.050,2.4),pr(-0.286,0,0,0.042,0.043,2.3),
          pr(-0.385,0,-0.002,0.038,0.039,2.3)],14,PT,true)),0.45));   /* x1.1000 = PL_SNLEN */
add('ft'+n,'sn'+n,[0,-PL_SNLEN,0],AO(partCat(
loftPart([pr(0.030,0,0.004,0.054,0.052,2.4),pr(-0.020,0,0.002,0.052,0.050,2.4),
          pr(-0.062,0,-0.004,0.050,0.050,2.4)],12,BT,true),
loftPart([pr(-0.066,0,0.016,0.050,0.056,2.5),pr(-0.086,0,-0.012,0.052,0.076,2.6),
          pr(-0.094,0,-0.052,0.046,0.062,2.6),pr(-0.090,0,-0.092,0.037,0.041,2.4)],12,BT,true),
/* the sole welt is a closed "cup": the wall comes out of the boot interior
 and flows into the sole sheet. Without it a through-slit stays on the side —
 the mirror pass's sliding ray goes under the foot and gives a black band in
 puddle reflections. */
loftPart([pr(-0.078,0,0.000,0.049,0.062,2.4),pr(-0.116,0,-0.012,0.054,0.078,2.4),
          pr(-0.116,0,0.030,0.050,0.048,2.4),pr(-0.112,0,-0.070,0.050,0.068,2.3)],12,BT,true),
partXf(loftPart([pr(-0.012,0,0,0.024,0.009,2.2),pr(-0.070,0,0,0.022,0.008,2.2)],6,BT_PLAIN,true),0,-0.036,-0.046)),0.55));
};
leg(1,'L');leg(-1,'R');
return R.finish(HIDE_FP_NAMES);
}
/* hand without fingers (fingers hang on their own bones separately) */
function buildHandParts(sg,SK_HAND){
/* the wrist is tapered (it exits the cuff as a wrist, not a board), the back
 of the hand is convex (section centers shifted toward the palm) — the hand
 reads as a hand */
const palm=loftPart([
 pr(0.022,0,0.002,0.026,0.016,2.4),
 pr(-0.018,0,0.000,0.035,0.021,2.5),
 pr(-0.055,0,-0.003,0.041,0.024,2.6),
 pr(-0.088,0,-0.005,0.042,0.024,2.7),
 pr(-0.102,0,-0.006,0.039,0.020,2.6)],10,SK_HAND,true);
/* thumb and thenar (the mound at its base, pressed to the palm) — on -X of the hand's local axis */
const thenar=partXf(loftPart([pr(0,0,0,0.010,0.008,2.3),pr(-0.024,0,-0.002,0.012,0.009,2.3),pr(-0.040,0,-0.003,0.008,0.006,2.2)],8,SK_HAND,true),
 -sg*0.026,-0.028,-0.004, 0,0,-sg*0.45);
return partCat(palm,thenar);
}
const HIDE_FP_NAMES=['pel','spn','ch','nk','hd','jaw','hr','earL','earR','shL','shR'];

/* ==== support kinematics ==== */
/* foot-bottom control points in the ft bone frame: sole, welt, toe and heel
 corners — honest floor contact in any pose */
/* Sole control points in the ft bone frame: [x,y,z], z = -0.138...-0.062 —
 toe (-Z), z = +0.065...+0.078 — heel, y = -0.116 — flat sole, -0.066 — welt
 top. The set matches the boot geometry. */
const PL_SOLE_PTS=[[0,-0.116,0.078],[0,-0.116,-0.043],[0,-0.116,-0.089],[0,-0.112,-0.138],
[0,-0.086,0.065],[0,-0.094,-0.115],[0,-0.066,0.073],[0,-0.066,-0.073],[0,-0.090,-0.094]];

const PL_SKEL=(function(){
 const B=[];const idx={};
 const A=(n,p,off)=>{idx[n]=B.length;B.push({p:p,off:off,m:new Float32Array(16),R:new Float32Array(9)})};
 A('root',-1,[0,0,0]);
 A('pel',0,[0,PL_HIP,0]);
 const leg=(sg,n)=>{
  A('th'+n,idx.pel,[0.086*sg,-0.055,0]);
  A('sn'+n,idx['th'+n],[0,-PL_THLEN,0]);
  A('ft'+n,idx['sn'+n],[0,-PL_SNLEN,0]);
 };
 leg(1,'L');leg(-1,'R');
 return {B:B,idx:idx};
})();
/* rotY(y)*rotX(x)*rotZ(z) — exactly the composition used in skinRig */
function rotM3(x,y,z){
 const cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
 const a=[cz,-sz,0, sz,cz,0, 0,0,1];                    /* rotZ */
 const b=[1,0,0, 0,cx,-sx, 0,sx,cx];                     /* rotX */
 const c=[cy,0,sy, 0,1,0, -sy,0,cy];                     /* rotY */
 const ab=[0,0,0,0,0,0,0,0,0];
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)ab[i*3+j]=b[i*3]*a[j]+b[i*3+1]*a[3+j]+b[i*3+2]*a[6+j];
 const o=[0,0,0,0,0,0,0,0,0];
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)o[i*3+j]=c[i*3]*ab[j]+c[i*3+1]*ab[3+j]+c[i*3+2]*ab[6+j];
 return o;
}
function fkSkel(pose){
 const B=PL_SKEL.B;
 for(let i=0;i<B.length;i++){
  const b=B[i],rt=(pose&&pose[PL_SKEL_NAME[i]])||[0,0,0];
  const R=rotM3(rt[0],rt[1],rt[2]);b.R=R;
  if(b.p<0){b.m[0]=b.off[0];b.m[1]=b.off[1];b.m[2]=b.off[2];continue}
  const P=B[b.p],pR=P.R;
  /* world position = parent + R_parent * offset */
  b.m[0]=P.m[0]+pR[0]*b.off[0]+pR[3]*b.off[1]+pR[6]*b.off[2];
  b.m[1]=P.m[1]+pR[1]*b.off[0]+pR[4]*b.off[1]+pR[7]*b.off[2];
  b.m[2]=P.m[2]+pR[2]*b.off[0]+pR[5]*b.off[1]+pR[8]*b.off[2];
  /* full orientation = R_parent * R_own */
  const o=b.R;const q=R;
  for(let r2=0;r2<3;r2++)for(let c2=0;c2<3;c2++)o[r2*3+c2]=pR[r2*3]*q[c2]+pR[r2*3+1]*q[3+c2]+pR[r2*3+2]*q[6+c2];
 }
}
const PL_SKEL_NAME=(function(){
 const n=[];n.length=PL_SKEL.B.length;
 n[PL_SKEL.idx.root]='root';n[PL_SKEL.idx.pel]='pel';
 for(const s of ['L','R']){n[PL_SKEL.idx['th'+s]]='th'+s;n[PL_SKEL.idx['sn'+s]]='sn'+s;n[PL_SKEL.idx['ft'+s]]='ft'+s}
 return n;
})();
/* lowest point of both feet relative to the root (root at origin) */
function footLowest(pose){
 fkSkel(pose);
 let lo=1e9;
 for(const s of ['L','R']){
  const b=PL_SKEL.B[PL_SKEL.idx['ft'+s]],R=b.R;
  /* second row of the full rotation (with the foot roll) + sole angles */
  for(const q of PL_SOLE_PTS){
   for(const sx of [-0.053,0.0,0.053]){
    const y=b.m[1]+R[3]*sx+R[4]*q[1]+R[5]*q[2];
    if(y<lo)lo=y;
   }
  }
 }
 return lo;
}
/* how far to drop the root so the support stands at y=0 */
function groundDY(pose){ return -footLowest(pose); }

/* ==== ANIMATION ==== */
/* ==== POSES ==== */
const PZERO={root:[0,0,0],pel:[0,0,0],spn:[0,0,0],ch:[0,0,0],nk:[0,0,0],hd:[0,0,0],jaw:[0,0,0],hr:[0,0,0],
shL:[0,0,0],uaL:[0,0,0],faL:[0,0,0],haL:[0,0,0],
i1L:[0,0,0],i2L:[0,0,0],i3L:[0,0,0],m1L:[0,0,0],m2L:[0,0,0],m3L:[0,0,0],
r1L:[0,0,0],r2L:[0,0,0],r3L:[0,0,0],p1L:[0,0,0],p2L:[0,0,0],p3L:[0,0,0],t1L:[0,0,0],t2L:[0,0,0],
shR:[0,0,0],uaR:[0,0,0],faR:[0,0,0],haR:[0,0,0],
i1R:[0,0,0],i2R:[0,0,0],i3R:[0,0,0],m1R:[0,0,0],m2R:[0,0,0],m3R:[0,0,0],
r1R:[0,0,0],r2R:[0,0,0],r3R:[0,0,0],p1R:[0,0,0],p2R:[0,0,0],p3R:[0,0,0],t1R:[0,0,0],t2R:[0,0,0],
thL:[0,0,0],snL:[0,0,0],ftL:[0,0,0],thR:[0,0,0],snR:[0,0,0],ftR:[0,0,0]};
const PKEYS=Object.keys(PZERO);
/* pcl copies the hand's virtual keys (fg/thb) too, so clips layered over the
 base pose (interact/push) keep its fingers — else the hand opens on pickup
 and fingers jump at the blend border. */
const VKEYS=['fgL','fgR','thbL','thbR'];
const pcl=o=>{const r={};for(const k of PKEYS){const a=o[k]||PZERO[k];r[k]=[a[0],a[1],a[2]]}
for(const k of VKEYS){const a=o[k];if(a)r[k]=[a[0],a[1],a[2]]}return r};
const sm=k=>k*k*(3-2*k);
/* ================ GAIT: HONEST SUPPORT ================
 Legs — 2-bone IK over the foot trajectory:
 · ψ ∈ [0, duty·2π) — support: the sole contact point STANDS (the root passes
   exactly as much as the foot travels back); [duty·2π, 2π) — swing;
 · pelvis vertical b(ψ) = +B·cos(2ψ) — π-periodic (minimum at mid-support);
 · running has duty < 0.5 — flight phase, the root goes ballistic (h = g·Tf²/8);
 · phase accumulates from TRAVELLED DISTANCE (GAIT_K rad/cell) — no slipping.
 Clip space (before PL_FLIP): forward = −Z, thigh "forward" = negative pitch,
 sn > 0 = knee bend, ft: + = toe up.
 IMPORTANT: L/R names are mirrored to the viewer — bone 'L' is visible ON THE RIGHT. */
const HIPJ=PL_HIP-0.055;                       /* hip joint above the root */
const SOLE_CAND=PL_SOLE_PTS.map(q=>[q[2],q[1]]);
const SOLE_SX=[-0.053,0.0,0.053];       /* lateral standoff — same as in footLowest */
/* Sole contact: hA — ankle height over the floor, zrel — longitudinal contact
 offset (in the zf frame "forward" = −Z). The foot model is FULL: points turn
 by the same rotM3(phi,yaw,roll) as the rig, minimum over the same 9×3
 positions as footLowest — otherwise IK aims at a "flat" foot.
 hA is the EXACT minimum (else the foot hangs), zrel is a softmin (else it
 jerks on the heel→toe roll). */
function soleContactGen(phi,roll,yaw,SX,PTS,EPS){
const R=rotM3(phi,yaw||0,roll||0);      /* rotY(yaw)·rotX(phi)·rotZ(roll) — as in the rig */
const r3=R[3],r4=R[4],r5=R[5],r6=R[6],r7=R[7],r8=R[8];
let ymin=1e9;const ys=[],zr=[];
for(let si=0;si<SX.length;si++){const sx=SX[si];
 for(let qi=0;qi<PTS.length;qi++){const q=PTS[qi];
  const y=r3*sx+r4*q[1]+r5*q[0];       /* point height above the ankle */
  ys.push(y); zr.push(r6*sx+r7*q[1]+r8*q[0]);
  if(y<ymin)ymin=y;
 }
}
let sw2=0;const ws=[];
for(let i=0;i<ys.length;i++){const w=Math.exp(-(ys[i]-ymin)/EPS);ws.push(w);sw2+=w}
let hz=0;for(let i=0;i<ys.length;i++)hz+=ws[i]/sw2*zr[i];
return {hA:-ymin,zrel:hz};
}
function soleContact(phi,roll,yaw){return soleContactGen(phi,roll,yaw,SOLE_SX,SOLE_CAND,0.010)}
/* 2-bone leg IK (sagittal). zf — foot AHEAD of the joint (+), yd — depth
 below the joint (+), toeOff — absolute foot pitch (+ = toe up). Returns
 ABSOLUTE angles [thigh, knee, footAbs]; local = minus the pelvis pitch. */
function legIKGen(zf,yd,L1,L2,dmax,dmin){
let d=Math.hypot(zf,yd),clamped=false;
if(d>dmax){const k=dmax/d;zf*=k;yd*=k;d=dmax;clamped=true}
else if(d<dmin){const k=dmin/Math.max(d,1e-6);zf*=k;yd*=k;d=dmin;clamped=true}
const gam=Math.atan2(zf,yd);
const beta=Math.acos(clp((L1*L1+d*d-L2*L2)/(2*L1*d),-1,1));
const a1=-(gam+beta);
const sn=Math.PI-Math.acos(clp((L1*L1+L2*L2-d*d)/(2*L1*L2),-1,1));
return [a1,sn,clamped,d];
}
function legIK(zf,yd,toeOff){
const r=legIKGen(zf,yd,PL_THLEN,PL_SNLEN,PL_THLEN+PL_SNLEN-0.008,Math.abs(PL_THLEN-PL_SNLEN)+0.035);
return [r[0],r[1],toeOff];
}
/* foot plan onto the local phase ψ∈[0,2π): ψ=0 — touchdown.
 sg = ±1 — side: sign of the foot roll (kneeOut) and yaw (toeOut). */
function footPlan(psi,G,sg){
if(sg===undefined)sg=1;
const TAU=Math.PI*2, arc=G.duty*TAU;
const C=HIPJ-G.hipBase;                        /* pelvis "drop" of this gait */
/* π-periodic pelvis bob: the pelvis is an "inverted pendulum" — lowest at
 MID-support (leg vertical), highest at double support (ψ=0 and ψ=π). Hence
 the +B·cos(2ψ) sign: antiphase would give a "bouncing" gait. */
const b=G.bob*Math.cos(2*psi);
let zfC,phi,clearance,u;
if(psi<arc){
 u=psi/arc;
 zfC=G.S*(0.5-u);                               /* the contact travels back LINEARLY = stands still */
 if(u<G.hsEnd)phi=G.hs*(1-u/G.hsEnd);          /* heel: toe slightly up */
 else if(u<0.62)phi=0;                          /* flat support, roll-over */
 else phi=-G.po*sm((u-0.62)/0.38);              /* toe push-off */
 clearance=0;
}else{
 u=(psi-arc)/(TAU-arc);
 const e=u*u*(3-2*u);
 zfC=-G.S*0.5+G.S*(0.22*u+0.78*e);              /* swing forward, leading the touchdown */
 if(u<0.25)phi=-G.po+(G.po+G.hs*0.85)*sm(u/0.25);
 else if(u<0.70)phi=G.hs*0.85;
 else phi=G.hs*0.85+(G.hs-G.hs*0.85)*sm((u-0.70)/0.30);
 clearance=G.lift*Math.sin(Math.PI*Math.pow(u,0.80));
}
const c=soleContact(phi,G.kneeOut*sg,G.toeOut*sg);
const soleRoot=C+b+clearance;
/* Ankle IK target: zfC (longitudinal) + zrel(φ) — where the contact patch
 lands at this pitch. The "zero" zrel compensation is NOT needed here:
 measurement showed it drags the ankle and grows the slip (−5 cm → −10 cm). */
return {zf:zfC+c.zrel,zfC:zfC,phi:phi,stance:psi<arc,soleRoot:soleRoot,u:u};
}
/* Gait parameters. S — contact travel relative to the pelvis PER SUPPORT
 (rig units), duty — support share of the cycle, hipBase — pelvis height.
 (a) "SUPPORT STANDS": per support the root passes duty·2π/K cells, the foot
 travels S·PL_SCALE ⇒ K = duty·2π/(S·PL_SCALE) [rad/cell]; hence
 f = V·duty/(S·RM), stride = S·RM/(2·duty), RM = PL_SCALE·CELL_M. World scale,
 height and cadence are linked. Pick S: S ≈ root travel per support, else the
 foot creeps.
 (b) Anatomy: the knee at mid-support bends by 2·asin((S/2)/(L1+L2)) —
 an UPPER bound on S.
 References: walk 7 km/h — 135–145/min, stride 0.80–0.87 m, knee 35–45°;
 run 20 km/h — 240–320/min; sneak — 80–110/min. */
const GAIT={
walk:{S:0.854,duty:0.52,hipBase:0.88,bob:0.030,hs:0.07,hsEnd:0.20,po:0.26,lift:0.10,
 kneeOut:0.035,toeOut:0.05,lean:0.06,leanOsc:0.015,pelRoll:0.045,pelYaw:0.10,chestBob:0.022,
 armX:0.42,armBack:0.05,armZ:0.13,elbowFix:0.42,armBend:0.34,curl:0.32,headBob:0.02,flightH:0},
run:{S:0.821,duty:0.35,hipBase:0.85,bob:0.040,hs:0.04,hsEnd:0.14,po:0.45,lift:0.25,
 kneeOut:0.05,toeOut:0.03,lean:0.30,leanOsc:0.03,pelRoll:0.05,pelYaw:0.13,chestBob:0.03,
 armX:0.78,armBack:0.10,armZ:0.20,elbowFix:0.95,armBend:0.50,curl:0.55,headBob:0.03,flightH:0.063},   /* the hop follows from vertical VELOCITY continuity at takeoff:
 v = 2·B·ω·|sin(2·arc)| ≈ 1.0 m/s, h = v²/(2g) = 5.1 cm. Was 0.021 at duty
 0.18; with a wrong H the pelvis "clicks" at takeoff. */
sneak:{S:0.52,duty:0.70,hipBase:0.60,bob:0.018,hs:0.02,hsEnd:0.18,po:0.16,lift:0.07,
 kneeOut:0.13,toeOut:0.13,lean:0.18,leanOsc:0.01,pelRoll:0.035,pelYaw:0.07,chestBob:0.014,
 armX:0.16,armBack:0.30,armZ:0.24,elbowFix:0.62,armBend:0.18,curl:0.40,headBob:0.012,flightH:0}};
/* PL_SCALE is declared below at the viewmodel, but gaitK needs it here — so
 the value is duplicated as a separate constant (change both together). */
const PL_SCALE_GAIT=0.345;
/* GAIT_K is computed from the gait geometry, so it stays correct if S, duty,
 PL_SCALE or CELL_M change (via RM in GAIT_RATE). */
/* K = duty·2π/(S·PL_SCALE) [rad/cell] — derivation in condition (a) above.
 Hence f = V·duty/(S·RM) and stride = S·RM/(2·duty), RM = PL_SCALE·CELL_M. */
function gaitK(G){ return G.duty*2*Math.PI/(G.S*PL_SCALE_GAIT); }
const GAIT_K={walk:gaitK(GAIT.walk),run:gaitK(GAIT.run),sneak:gaitK(GAIT.sneak)};
/* GAIT_RATE — the same phase but in rad/s: needed by clips and the mannequin,
 where phase comes from time, not distance. Taken at the gait's nominal speed. */
const GAIT_NOM={walk:7,sneak:2,run:20};                /* km/h */
function gaitRate(kmh,G){ return (kmh/3.6/CELL_M)*gaitK(G); }
const GAIT_RATE={walk:gaitRate(GAIT_NOM.walk,GAIT.walk),
                 run:gaitRate(GAIT_NOM.run,GAIT.run),
                 sneak:gaitRate(GAIT_NOM.sneak,GAIT.sneak)};
/* gait pose + root dy. Upper body — procedural biomechanics: arm/leg
 antiphase, pelvis/chest counter-rotation, head stabilization, weight transfer. */
function gaitPoseIK(p,ph,G){
const TAU=Math.PI*2;
const psiL=((ph%TAU)+TAU)%TAU;
const psiR=(((ph+Math.PI)%TAU)+TAU)%TAU;
const arc=G.duty*TAU;
/* bone 'L' is on the viewer's RIGHT: its kneeOut/toeOut are positive, 'R' — negative */
const fL=footPlan(psiL,G,1),fR=footPlan(psiR,G,-1);
const swEnv=fp=>fp.stance?0:Math.sin(Math.PI*fp.u);
const eL=swEnv(fL),eR=swEnv(fR);
/* pelvis — BEFORE legs (IK targets in the root frame) */
const rollA=G.pelRoll*(eR-eL);
const yawA=G.pelYaw*Math.cos(psiL);
const pitA=G.lean+G.leanOsc*Math.sin(psiL*2+0.6);
p.pel=[pitA,yawA,rollA];
const Rp=rotM3(pitA,yawA,rollA);
const hipY=sg=>PL_HIP+Rp[1]*(0.086*sg)+Rp[4]*(-0.055);
const hipZs=sg=>Rp[2]*(0.086*sg)+Rp[5]*(-0.055);
const solveLeg=(f,sg)=>{
 /* Full foot rotation = pelvis tilt (rollA/yawA) + knee (kneeOut) + foot
 (toeOut); the pelvis gives up to 0.045 rad roll and 0.10 rad yaw — the
 contact model must account for it, else it diverges from footLowest and the
 support leg hangs. */
 const roll=G.kneeOut*sg+rollA, yaw=G.toeOut*sg+yawA;
 const zfRel=f.zf-(-hipZs(sg));
 /* TWO-PASS SOLUTION: hA depends on the foot pitch, the pitch is clamped by the
 stop, the stop depends on the IK solution, which depends on hA. One pass
 gives a pelvis "click" at the support→flight border; the second converges
 (<1e-6 rad). */
 let phi=f.phi,a=null,shinAbs=0,phi2=f.phi;
 for(let it=0;it<2;it++){
  const c=soleContact(phi,roll,yaw);
  const ankleY=f.soleRoot+c.hA;
  a=legIK(zfRel,hipY(sg)-ankleY,phi);
  /* ankle stop: relative to the shin the foot lives in [−54° plantar …
 +31° dorsal]. In deep poses a "flat" foot would exceed the limit — the heel
 honestly lifts. */
  shinAbs=a[0]+a[1];
  phi2=clp(f.phi,shinAbs-0.95,shinAbs+0.55);
  if(Math.abs(phi2-phi)<1e-6)break;
  phi=phi2;
 }
 return [a[0]-pitA,a[1],phi2-shinAbs];
};
const ikL=solveLeg(fL,1),ikR=solveLeg(fR,-1);
p.thL=[ikL[0],0,G.kneeOut]; p.snL=[ikL[1],0,0]; p.ftL=[ikL[2],G.toeOut,0];
p.thR=[ikR[0],0,-G.kneeOut]; p.snR=[ikR[1],0,0]; p.ftR=[ikR[2],-G.toeOut,0];
/* spine: counter-rotation against the pelvis, chest vertical bob 2ψ */
p.spn=[G.lean*0.55-G.bob*0.35*Math.sin(psiL*2),-yawA*1.5,-rollA*0.55];
p.ch=[G.lean*0.5+G.chestBob*Math.sin(psiL*2+Math.PI*0.5),-yawA*1.1,-rollA*0.85+G.chestBob*Math.sin(psiL*2)*0.3];
/* arms — antiphase to their own legs; the elbow winds up on the forward swing */
const swL=Math.sin(psiL),swR=Math.sin(psiR);
const armF=sw=>[sw*G.armX-G.armBack,-(G.elbowFix+G.armBend*Math.max(0,-sw))];
const aL=armF(swL),aR=armF(swR);
p.uaL=[aL[0],0,G.armZ]; p.faL=[aL[1],0,0.05];
p.uaR=[aR[0],0,-G.armZ]; p.faR=[aR[1],0,-0.05];
p.shL=[-0.03*Math.max(0,-swL),0,0.03+0.02*Math.max(0,-swL)];
p.shR=[-0.03*Math.max(0,-swR),0,-0.03-0.02*Math.max(0,-swR)];
p.haL=[-0.08+0.10*Math.sin(psiL-0.9),0,0]; p.haR=[-0.08+0.10*Math.sin(psiR-0.9),0,0];
/* fingers: fg>0 = curl (see expandHands); the hand loosens a bit on the arm swing */
p.fgL=[G.curl+0.12*Math.max(0,-swL),0,0.06*Math.max(0,-swL)];
p.fgR=[G.curl+0.12*Math.max(0,-swR),0,0.06*Math.max(0,-swR)];
p.thbL=[0,0,0.30]; p.thbR=[0,0,-0.30];
/* the head stabilizes the gaze against the torso tilt/rotation */
p.nk=[-G.lean*0.45+0.02*Math.sin(psiL*2+2.0),-yawA*0.5,rollA*0.5];
p.hd=[-G.lean*0.35+G.headBob*Math.sin(psiL*2+1.2),-yawA*0.35+0.02*swL,rollA*0.3];
p.jaw=[0,0,0]; p.hr=[0,0,0];
/* dy: support — footLowest; flight — ballistics (window borders continuous:
 clearance(0)=clearance(1)=0, b is π-periodic) */
let flight=0,ftau=0;
if(G.duty<0.5){
 if(psiL>=arc&&psiL<Math.PI){flight=1;ftau=(psiL-arc)/(Math.PI-arc)}
 else if(psiL>=arc+Math.PI){flight=1;ftau=(psiL-arc-Math.PI)/(Math.PI-arc)}
}
let dy=groundDY(p);
if(flight){
 const dyBase=-((HIPJ-G.hipBase)+G.bob*Math.cos(2*psiL));   /* same bob sign as in footPlan — else the pelvis clicks at the support→flight joint */
 dy=dyBase+G.flightH*4*ftau*(1-ftau);
}
return {pose:p,dy:dy};
}

/* E while crouched plays ON HAUNCHES: pelvis, spine, head and legs blend in
 from the 'crouch' clip by the crouch factor (A.cr), the arm pull — from the
 action clip. dy is recomputed from the final pose: the feet stand on the floor. */
function crouchify(p,A,t){
 if(A&&A.fp)return;   /* the viewmodel doesn't inherit the crouch torso — the arms don't "fall off" */
 const crk=(A&&A.cr!==undefined)?A.cr:0;
 if(crk<=0.001)return;
 const k=sm(clp((crk-0.30)/0.30,0,1));
 if(k<=0.001)return;
 const cp=ANIM_CLIPS[animIndex('crouch')].fn(t).pose;
 for(const key of ['pel','spn','ch','nk','hd','thL','thR','snL','snR','ftL','ftR']){
  const a=p[key],b=cp[key];
  if(a&&b){a[0]+=(b[0]-a[0])*k;a[1]+=(b[1]-a[1])*k;a[2]+=(b[2]-a[2])*k;}
 }
}
/* Clips: fn(t,A) -> {pose,dy}. len<0 — a looping clip (t isn't wrapped).
 Bone 'L' is on the viewer's RIGHT — the "working" right arm is *L. */
const ANIM_CLIPS=[
{name:'idle',label:'Покой',len:-1,fn(t,A){
 /* the look-around dies with the start of movement (A.mv) — the head doesn't jerk into the first step */
 const lk=1-clp((A&&A.mv)||0,0,1);
 /* LIVING IDLE: breathing at two frequencies, weight transfer between feet,
 micro-saccades, rare swallowing, lagging elbows and hair. The frequencies
 are incommensurate — the pose never repeats noticeably, yet doesn't jitter. */
 const br=Math.sin(t*1.35),br2=Math.sin(t*0.61+0.7),sh=Math.sin(t*0.43);
 const wf=Math.sin(t*0.37),wf2=Math.sin(t*0.23+1.3);
 const sx=Math.sin(t*0.53)*0.55+Math.sin(t*1.31+2.1)*0.30+Math.sin(t*2.77+0.6)*0.12;
 const sy=Math.sin(t*0.47+1.7)*0.40+Math.sin(t*1.13)*0.25;
 const swal=Math.pow(Math.max(0,Math.sin(t*0.31)),24);
 const wL=Math.max(0,wf),wR=Math.max(0,-wf);
 const p=pcl(PZERO);
 p.pel=[-0.020+br*0.010, 0.045*wf2, 0.030*wf];
 p.spn=[-0.016+br2*0.010, -0.030*wf2, -0.018*wf];
 p.ch =[-0.010+br*0.018, -0.022*wf2, -0.026*wf+br2*0.008];
 p.nk =[br2*0.04+sy*0.10*lk, sh*0.06+sx*0.14*lk, -br2*0.02];
 p.hd =[br*0.026+0.02+sy*0.16*lk, sh*0.10*lk+sx*0.24*lk, br2*0.03-sx*0.04*lk];
 p.jaw=[-0.012-0.05*swal-Math.max(0,Math.sin(t*0.7))*0.010,0,0];
 p.hr =[br*0.02+wf*0.01,-sh*0.03,0];
 p.shL=[0.010*br,0, 0.020+0.015*br+0.010*wf]; p.shR=[0.010*br,0,-0.020-0.015*br-0.010*wf];
 p.uaL=[-0.055+br*0.016+0.030*sh, 0, 0.150+0.012*wf];
 p.uaR=[-0.050-br*0.016-0.030*sh, 0,-0.150+0.012*wf];
 p.faL=[-0.30-br*0.05-0.04*Math.sin(t*0.90-0.6),0, 0.070];
 p.faR=[-0.28+br*0.05-0.04*Math.sin(t*0.90-0.9),0,-0.070];
 p.haL=[-0.10+0.05*Math.sin(t*0.80-1.2),0,0]; p.haR=[-0.10+0.05*Math.sin(t*0.80-1.5),0,0];
 p.fgL=[0.28+br*0.05,0,0]; p.fgR=[0.28-br*0.05,0,0];
 p.thbL=[0,0,0.24]; p.thbR=[0,0,-0.24];
 /* legs: weight on one foot — the support straightens, the free one relaxes,
 the pelvis tilts toward the support side (contrapposto) */
 p.thL=[-0.045+sh*0.030-0.035*wL+0.020*wR,0,0.032];
 p.thR=[ 0.052-sh*0.030-0.035*wR+0.020*wL,0,0.032];
 p.snL=[0.085-sh*0.020-0.035*wL+0.060*wR,0,0];
 p.snR=[0.055+sh*0.020-0.035*wR+0.060*wL,0,0];
 p.ftL=[-0.05+0.010*wL+0.045*wR,0,0];
 p.ftR=[-0.05+0.010*wR+0.045*wL,0,0];
 return {pose:p,dy:groundDY(p)};
}},
{name:'walk',label:'Шаг',len:-1,fn(t,A){
 const ph=(A&&A.ph!==undefined)?A.ph:t*GAIT_RATE.walk;
 const r=gaitPoseIK(pcl(PZERO),ph,GAIT.walk);
 const p=r.pose;
 const psi=((ph%(Math.PI*2))+(Math.PI*2))%(Math.PI*2);
 p.nk=[p.nk[0]+0.012,p.nk[1],p.nk[2]];
 p.hd=[p.hd[0]+0.030+Math.sin(psi*2)*0.012,p.hd[1]+Math.sin(psi)*0.030,p.hd[2]];
 p.jaw=[-0.014,0,0];
 p.hr=[Math.sin(psi-0.8)*0.025,0,0];
 return r;
}},
{name:'run',label:'Бег',len:-1,fn(t,A){
 const ph=(A&&A.ph!==undefined)?A.ph:t*GAIT_RATE.run;
 const r=gaitPoseIK(pcl(PZERO),ph,GAIT.run);
 const p=r.pose;
 const psi=((ph%(Math.PI*2))+(Math.PI*2))%(Math.PI*2);
 /* gaze over the tilt, mouth breathing in step rhythm, hair tossed back */
 p.nk=[p.nk[0]-0.06,p.nk[1],p.nk[2]];
 p.hd=[p.hd[0]+0.14+Math.sin(psi*2)*0.020,p.hd[1]+Math.sin(psi)*0.050,p.hd[2]];
 p.jaw=[-0.10-Math.max(0,Math.sin(psi*2))*0.10,0,0];
 p.hr=[0.05+0.04*Math.sin(psi+2.2),0,0];
 return r;
}},
{name:'sneak',label:'Крадущийся шаг',len:-1,fn(t,A){
 const ph=(A&&A.ph!==undefined)?A.ph:t*GAIT_RATE.sneak;
 const r=gaitPoseIK(pcl(PZERO),ph,GAIT.sneak);
 const p=r.pose;
 /* head raised (tracks over the tilt), slow wary scanning */
 p.nk=[p.nk[0]+0.05,p.nk[1],p.nk[2]];
 p.hd=[p.hd[0]+0.06+Math.sin(t*0.9)*0.02,p.hd[1]+Math.sin(t*0.7)*0.06,p.hd[2]];
 p.jaw=[-0.02,0,0];
 p.hr=[0.03,0,0];
 return r;
}},
{name:'crouch',label:'Присед',len:-1,fn(t){
 /* DEEP squat-hold (toggle C): glutes at heels, knees apart, feet flat,
 forearms on thighs. Legs — honest IK (thigh ~95°, knee ~135°, ankle heavily
 dorsiflexed). */
 const br=Math.sin(t*1.15),br2=Math.sin(t*0.83+2.0);
 const sw=Math.sin(t*0.31),sw2=Math.sin(t*0.19+0.8);
 const sx=Math.sin(t*0.41)*0.40+Math.sin(t*0.97+1.3)*0.20;
 const sy=Math.sin(t*0.33+0.5)*0.30;
 const p=pcl(PZERO);
 const pelP=0.34+0.015*br, pelY=0.030*sw2, pelR=0.020*sw;
 p.pel=[pelP,pelY,pelR];
 p.spn=[0.10+0.012*br,-pelY*0.5,-pelR*0.5];
 p.ch =[0.16+0.020*br+0.008*br2,-pelY*0.8,-pelR*0.7];
 p.nk=[-0.24-0.012*br+sy*0.06,sx*0.12-pelY*0.3,-pelR*0.4];
 p.hd=[-0.18-0.010*br+sy*0.10,sx*0.18,0.02*sw];
 p.jaw=[-0.02-Math.max(0,Math.sin(t*0.55))*0.012,0,0];
 p.hr=[0.02*br,0,0];
 /* arms: forearms on thighs, hands hung loose */
 p.shL=[0.05,0,0.03]; p.shR=[0.05,0,-0.03];
 p.uaL=[-0.52+0.02*br,0,0.16]; p.uaR=[-0.52-0.02*br,0,-0.16];
 p.faL=[-0.92-0.03*br2,0,0.05]; p.faR=[-0.92+0.03*br2,0,-0.05];
 p.haL=[-0.16+0.04*br,0,0]; p.haR=[-0.16-0.04*br,0,0];
 p.fgL=[0.40+0.05*br,0,0]; p.fgR=[0.40-0.05*br,0,0];
 p.thbL=[0,0,0.30]; p.thbR=[0,0,-0.30];
 /* legs: deep-squat IK (pelvis 0.36 above the floor, ankle forward) */
 const Rp=rotM3(pelP,pelY,pelR);
 const ankleY=(HIPJ-0.36)+0.116+0.004*br;
 for(const sg of [1,-1]){
  const hy=PL_HIP+Rp[1]*(0.086*sg)+Rp[4]*(-0.055);
  const hz=Rp[2]*(0.086*sg)+Rp[5]*(-0.055);
  const a=legIK(0.19-(-hz),hy-ankleY,0);
  const th=a[0]-pelP, sn=a[1], ft=0-a[0]-a[1];
  if(sg>0){p.thL=[th,0,0.24];p.snL=[sn,0,0];p.ftL=[ft,0.20,0];}
  else    {p.thR=[th,0,-0.24];p.snR=[sn,0,0];p.ftR=[ft,-0.20,0];}
 }
 return {pose:p,dy:groundDY(p)};
}},
{name:'interact',label:'Взять предмет',len:0.75,fn(t,A){
 /* An everyday 0.75 s action: short windup → the RIGHT arm (bones *L) reaches
 FORWARD along Z → fingers grab → return. The torso leans after it, the head
 escorts the arm, the left arm counterbalances. */
 const c=clp(t/0.75,0,1);
 const wind =sm(clp(c/0.10,0,1))*(1-sm(clp((c-0.10)/0.14,0,1)));
 const reach=sm(clp((c-0.06)/0.30,0,1));
 const grab =sm(clp((c-0.40)/0.13,0,1));
 const back =sm(clp((c-0.58)/0.42,0,1));
 const ext=reach*(1-back), gr=grab*(1-back*0.9);
 const p=pcl(ANIM_CLIPS[0].fn(t).pose);
 crouchify(p,A,t);   /* the crouch is blended BEFORE the action deltas: the torso tilt reads even on haunches */
 p.uaL=[-0.055+0.12*wind-0.80*ext+0.18*gr, 0, 0.150-0.05*ext];
 p.faL=[-0.30-0.30*wind+0.20*ext-0.16*gr, 0, 0.070];
 p.haL=[-0.10+0.10*wind+0.18*ext-0.30*gr,0,0];
 /* hand: opens toward the item (fingers apart), clenches at the touch moment
 (thumb in opposition), carries the loot away */
 const open=ext*(1-grab);
 p.fgL=[0.30-0.26*open+1.02*gr*(1-back*0.55)-0.0,0,0.42*open-0.30*gr];
 p.thbL=[0,0,0.24+0.10*open+0.42*gr];
 p.shL=[-0.04*ext,0,0.020-0.05*ext];
 p.spn=[p.spn[0]+0.05*ext-0.03*gr,p.spn[1]+0.03*ext,p.spn[2]];
 p.ch =[p.ch[0]+0.10*ext-0.05*gr,p.ch[1]-0.05*ext,p.ch[2]];
 p.nk=[p.nk[0]-0.10*ext+0.06*gr,p.nk[1],0];
 p.hd=[p.hd[0]-0.16*ext+0.10*gr,p.hd[1]-0.04*ext,0];
 p.pel=[p.pel[0]+0.04*ext,p.pel[1],p.pel[2]];
 p.uaR=[p.uaR[0]+0.07*ext,0,p.uaR[2]];
 p.faR=[p.faR[0]-0.05*ext,0,p.faR[2]];
 return {pose:p,dy:groundDY(p)};
}},
{name:'push',label:'Толкнуть дверь',len:0.9,fn(t,A){
 /* Door push with both palms, 0.9 s: stance → palms to the chest → arms
 straighten with the torso lean → a short effort tremor → return. Feet stay put. */
 const c=clp(t/0.9,0,1);
 const wind  =sm(clp(c/0.16,0,1))*(1-sm(clp((c-0.16)/0.16,0,1)));
 const thrust=sm(clp((c-0.14)/0.22,0,1));
 const settle=sm(clp((c-0.50)/0.50,0,1));
 const E=thrust*(1-settle);
 const shake=Math.sin(c*26)*0.007*sm(clp((c-0.34)/0.06,0,1))*(1-sm(clp((c-0.46)/0.16,0,1)));   /* three times quieter and three times rarer — no body/camera shake */
 const p=pcl(ANIM_CLIPS[0].fn(t).pose);
 crouchify(p,A,t);   /* crouch BEFORE the push deltas */
 /* legs: weight forward, knees softer, heels up — no step (the root doesn't ride) */
 p.thL=[p.thL[0]-0.14*E,p.thL[1],p.thL[2]];
 p.thR=[p.thR[0]-0.14*E,p.thR[1],p.thR[2]];
 p.snL=[p.snL[0]+0.06*E,0,0]; p.snR=[p.snR[0]+0.06*E,0,0];
 p.ftL=[p.ftL[0]-0.30*E,p.ftL[1],0]; p.ftR=[p.ftR[0]-0.30*E,p.ftR[1],0];
 p.pel=[p.pel[0]+0.16*E-0.05*wind+shake*0.15,p.pel[1],p.pel[2]];
 p.spn=[p.spn[0]+0.12*E-0.06*wind+shake*0.25,p.spn[1],p.spn[2]];
 p.ch =[p.ch[0]+0.22*E-0.08*wind+shake*0.45,p.ch[1],p.ch[2]];
 p.nk=[p.nk[0]-0.10*E+0.04*wind,p.nk[1],0];
 p.hd=[p.hd[0]-0.14*E+0.06*wind,p.hd[1],0];
 p.shL=[-0.05*E,0,p.shL[2]+0.04*E]; p.shR=[-0.05*E,0,p.shR[2]-0.04*E];
 p.uaL=[-0.055+0.28*wind-1.02*E, 0, 0.150-0.13*E];
 p.uaR=[-0.050+0.28*wind-1.02*E, 0,-0.150+0.13*E];
 p.faL=[-0.30-0.85*wind+0.30*E, 0, 0.070-0.09*E];
 p.faR=[-0.28-0.85*wind+0.30*E, 0,-0.070+0.09*E];
 p.haL=[-0.10+0.22*E,0,0]; p.haR=[-0.10+0.22*E,0,0];
 /* palms: fingers spread and open to the door, tense at the effort peak */
 p.fgL=[0.30-0.28*E-0.06*wind+0.55*Math.abs(shake),0,0.30*E];
 p.fgR=[0.30-0.28*E-0.06*wind+0.55*Math.abs(shake),0,0.30*E];
 p.thbL=[0,0,0.24+0.16*E]; p.thbR=[0,0,-0.24-0.16*E];
 return {pose:p,dy:groundDY(p)};
}}
];
/* ================ HAND EXPANSION ================
 Clips write the "old" keys fgL/fgR (curl) and thbL/thbR (abduction); here
 they unfold into real fingers. Plus the base palm turn. */
function expandHands(p,sg){
for(const S of ['L','R']){
 const s=S==='L'?1:-1;
 const fg=p['fg'+S]||[0,0,0], thb=p['thb'+S]||[0,0,0], ha=p['ha'+S]||[0,0,0];
 const curl=Math.max(-0.2,fg[0]);            /* >0 — curl */
 const sprd=fg[2]||0;
 /* palm: base inward turn + clip deltas */
 p['ha'+S]=[ha[0], -s*1.18+ha[1], ha[2]-s*0.10];
 const F={i:0.92,m:1.0,r:0.94,p:0.80};
 const ph={i:0.0,m:0.35,r:0.7,p:1.05};
 for(const f of ['i','m','r','p']){
  const c=curl*F[f], sp=sprd+ph[f]*0.10;
  p[f+'1'+S]=[ -c*0.34, 0, s*sp*0.5 ];
  p[f+'2'+S]=[ -c*0.42, 0, 0 ];
  p[f+'3'+S]=[ -c*0.28, 0, 0 ];
 }
 p['t1'+S]=[ -0.25-curl*0.30, 0, -s*(0.55+thb[2]*0.8) ];
 p['t2'+S]=[ -0.18-curl*0.35, 0, 0 ];
}
return p;
}
const ANIM_MAP=(()=>{const m={};ANIM_CLIPS.forEach((c,i)=>{m[c.name]=i});return m})();
function animIndex(n){const i=ANIM_MAP[n];return i===undefined?0:i}
function animNames(){return ANIM_CLIPS.map(c=>c.name)}
function animLabels(){return ANIM_CLIPS.map(c=>({name:c.name,label:c.label,len:c.len}))}
function poseFromClip(name,t,A,t0,holdEnd){
 const c=ANIM_CLIPS[animIndex(name)]||ANIM_CLIPS[0];
 /* finite clips start at zero of their own scale when enabled (t0), not at a random phase of absolute time */
 let lt;
 if(c.len>0){
  /* holdEnd: the outgoing clip in a blend is NOT wrapped by len: the modulo at
 the clip-end border gave a source-pose jump exactly on the switch frame */
  lt=holdEnd?clp(t-(t0||0),0,c.len):(((t-(t0||0))%c.len)+c.len)%c.len;
 } else lt=t;
 return c.fn(lt,A)||{pose:pcl(PZERO),dy:0};
}
/* sum of |deltas| of angles between the body pose snapshot and the clip pose: a measure of pose "distance" */
function poseDistSnap(st,name,t){
 const SB=st._snapB;
 if(!SB||!SB.pose)return 0;
 const wp=poseFromClip(name,t,{ph:st.animPhase||0},st.pAnimT0).pose;
 for(const bn in PL_FLIP){const a=wp[bn];if(a)a[0]=-a[0];}
 let d=0;
 for(const k in wp){const a=SB.pose[k],b=wp[k];
  if(a&&b)d+=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);}
 return d;
}
function playerAutoAnim(st){
 if(st.pAnimForce)return st.pAnimForce;
 /* ONE-SHOT ACTIONS PLAY OUT: interact/push run their whole len (0.75/0.9 s)
 from the E press while the player stands; movement (bobA) interrupts them
 with a blend — while walking, only the arm pull works in the viewmodel. */
 if(st.pShot){const c=ANIM_CLIPS[animIndex(st.pShot)];
  const tn=(st.time===undefined)?(st.pShotT0||0):st.time;
  /* the crouch doesn't block a one-shot — crouchify holds legs/pelvis from 'crouch' */
  if(c&&c.len>0&&tn-(st.pShotT0||0)<c.len&&(st.bobA||0)<0.28)return st.pShot;}
 const cr=(st.pCrouch||0)>0.42;
 const mv=Math.min(1,st.bobA||0);
 if(cr)return mv>0.30?'sneak':'crouch';
 if(mv>0.28)return (st.runK||0)>0.5?'run':'walk';
 return 'idle';
}
/* BIOMECHANICAL INVERSION: clips write pitches in the +Z convention, the rig
 looks toward −Z — the sign is inverted here, at the "clip→pose" border. The
 viewmodel already writes angles in the new convention; fingers/jaw match the
 geometry. */
const PL_FLIP={pel:1,spn:1,ch:1,nk:1,hd:1,shL:1,shR:1,uaL:1,uaR:1,faL:1,faR:1,
               haL:1,haR:1,thL:1,thR:1,snL:1,snR:1,ftL:1,ftR:1};
const cpPose=q=>{const o={};for(const k in q){const v=q[k];if(v&&v.length===3)o[k]=[v[0],v[1],v[2]];}return o;};
function playerPose(st,t,slot){
 st=st||{};
 const auto=playerAutoAnim(st);
 const want=st.pAnimWant||auto;
 const k=(st.pAnimK===undefined)?1:st.pAnimK;
 const A={ph:st.animPhase||0,cr:(st.crC!==undefined?st.crC:(st.pCrouch||0)),mv:Math.min(1,st.bobA||0),fp:slot==='fp'?1:0};   /* cr — crouchify; mv — decay the look; fp — viewmodel; cr is smoothed (crC) */
 /* BLEND FROM A POSE SNAPSHOT: source = the snapshot at the switch moment PLUS
 the movement delta of the previous clip along its own scale — pose and
 velocity stay continuous. Snapshots are separate for body and viewmodel
 (slot), else the FP arm stance would blend into the body. */
 const SB=st[(slot==='fp')?'_snapFP':'_snapB']||(st[(slot==='fp')?'_snapFP':'_snapB']={});
 const wres=poseFromClip(want,t,A,st.pAnimT0);
 const wp=wres.pose;
 for(const bn in PL_FLIP){const a=wp[bn];if(a)a[0]=-a[0];}   /* clip → the new convention */
 let p,dy;
 if(SB.pose&&k<1){
  const e=sm(k);
  const bk=(st.pAnimPrev||'')+'@'+(st.pAnimPrevT0||0);
  const prNow=poseFromClip(st.pAnimPrev,t,A,st.pAnimPrevT0,true);
  if(SB.bsKey!==bk){SB.bsKey=bk;SB.bsPose=prNow.pose;SB.bsDy=prNow.dy;
   SB.bsSnap=SB.pose;SB.bsSnapDy=SB.dy;}
  const d0=prNow.pose,b0=SB.bsPose,s0=SB.bsSnap,keys={};
  for(const q in d0)keys[q]=1;for(const q in b0)keys[q]=1;for(const q in s0)keys[q]=1;
  const src={};
  for(const key in keys){const s=s0[key];if(!s||s.length!==3)continue;
   const d=d0[key],b=b0[key];
   const dx=((d&&d.length===3)?d[0]:0)-((b&&b.length===3)?b[0]:0);
   const dyv=((d&&d.length===3)?d[1]:0)-((b&&b.length===3)?b[1]:0);
   const dz=((d&&d.length===3)?d[2]:0)-((b&&b.length===3)?b[2]:0);
   const fx=PL_FLIP[key]?-1:1;   /* the pitch delta — into the final pose convention */
   src[key]=[s[0]+dx*fx,s[1]+dyv,s[2]+dz];}
  const srcDy=SB.bsSnapDy+(prNow.dy-SB.bsDy);
  p={};
  for(const key in keys){const a2=src[key],b2=wp[key];
   const av=a2||b2,bv=b2||a2;if(!av)continue;   /* a one-sided key — hold it constant, don't fade to zero */
   p[key]=[av[0]+(bv[0]-av[0])*e,av[1]+(bv[1]-av[1])*e,av[2]+(bv[2]-av[2])*e];}
  dy=srcDy+(wres.dy-srcDy)*e;
 } else { p=wp; dy=wres.dy; }
 const lp=clp(st.pitch||0,-1.1,1.1), ly=clp(st.pLookYaw||0,-0.9,0.9);
 /* additive pitch signs are matched to the geometry (look up raises the face) */
 p.nk=[p.nk[0]+lp*0.30,p.nk[1]+ly*0.30,p.nk[2]];
 p.hd=[p.hd[0]+lp*0.55,p.hd[1]+ly*0.55,p.hd[2]-ly*0.12];
 /* FACE GUARANTEE: the total head+neck turn relative to the chest is limited
 to the human range (yaw ≤ ±46°, tilt −29°…+46°) — the side the arms curl to
 can never turn out to be the nape, in any clip and any blend. */
 {
  const yawNet=p.ch[1]+p.nk[1]+p.hd[1], YL=0.80;
  if(yawNet>YL||yawNet<-YL){const d=yawNet-clp(yawNet,-YL,YL);p.nk[1]-=d*0.35;p.hd[1]-=d*0.65;}
  const pitNet=p.spn[0]+p.ch[0]+p.nk[0]+p.hd[0], PD=-0.80, PU=0.50;
  if(pitNet<PD||pitNet>PU){const d=pitNet-clp(pitNet,PD,PU);p.nk[0]-=d*0.35;p.hd[0]-=d*0.65;}
 }
 /* FATIGUE WITHOUT SHAKING: a smooth envelope, heavy breathing ~0.3 Hz of low
 amplitude, jaw clatter and amplitude ×2 on exhausted, slouch. */
 const exT=clp(1-(st.stam===undefined?1:st.stam),0,1)*(st.exhausted?1:0.50);
 const dte=clp(t-(st._exT===undefined?t:st._exT),0,0.1); st._exT=t;
 const ex=(st._exS===undefined?0:st._exS)+((exT-(st._exS||0))*Math.min(1,dte*1.6));
 st._exS=ex;
 /* THE BREATHING PHASE ACCUMULATES (∫ω·dt): the 0.27…0.4 Hz frequency changes
 smoothly, the phase is continuous — on an ex jump (stamina borders,
 exhausted) breathing doesn't degenerate into a high-frequency tremor. */
 st._exPh=(st._exPh||0)+dte*(1.7+0.8*ex);
 if(ex>0.02){
  const br=Math.sin(st._exPh);
  const exh=Math.max(0,br)*Math.max(0,br);
  p.ch=[p.ch[0]+0.020*ex*br,p.ch[1],p.ch[2]];
  p.spn=[p.spn[0]+0.010*ex*br-0.055*ex,p.spn[1],p.spn[2]];
  p.hd=[p.hd[0]-0.010*ex*br-0.045*ex,p.hd[1],p.hd[2]];
  p.jaw=[p.jaw[0]-0.045*ex*exh,0,0];
  p.uaL=[p.uaL[0]+0.035*ex*br,0,p.uaL[2]+0.10*ex];
  p.uaR=[p.uaR[0]+0.035*ex*br,0,p.uaR[2]-0.10*ex];
  p.shL=[0,0,0.05*ex]; p.shR=[0,0,-0.05*ex];
 }
 /* GROUNDING FIXUP: clip dy is computed in clip space (before PL_FLIP), the
 drawn pose is after the inversion; for asymmetric feet footLowest(rig) ≠
 footLowest(clip). The delta of the two measurements on the final pose is
 added to dy. */
 {
  const uf={};
  for(const k of ['pel','thL','snL','ftL','thR','snR','ftR']){
   const a=p[k]; uf[k]=a?[-a[0],a[1],a[2]]:[0,0,0];
  }
  dy+=footLowest(uf)-footLowest(p);
 }
 SB.pose=cpPose(p); SB.dy=dy;   /* blend source for the next frame; the snapshot is BEFORE expandHands: it adds
 the palm turn ADDITIVELY to haL — a snapshot after it would double the turn. */
 expandHands(p);
 /* THIRD PERSON: with the flashlight the right arm is raised (the beam ~10°
 forward-down), during the battery swap both hands are before the body.
 _holdK is slewed in GPU.frame, and the blend snapshot is taken BEFORE those
 deltas — enabling the stance is smooth. */
 if(st.fl&&st.fl.owned){
  const rlNow=st.fl.rl>0;
  const L2=(a,b,k)=>a+(b-a)*k;
  if(!rlNow){
   const hk=clp(st._holdK||0,0,1);
   if(hk>0.001){
    p.shL=[0,0,L2(p.shL[2],0.10,hk)];
    p.uaL=[L2(p.uaL[0],0.70,hk),L2(p.uaL[1],-0.10,hk),L2(p.uaL[2],0.22,hk)];
    p.faL=[L2(p.faL[0],1.45,hk),L2(p.faL[1],0.30,hk),L2(p.faL[2],-0.10,hk)];
    gripHand(p,'L',[L2(p.haL[0],-0.34,hk),L2(p.haL[1],-1.04,hk),L2(p.haL[2],-1.01,hk)],
      0.9+(3.06-0.9)*hk,0.02,GRIP_THUMB,hk);   /* fist axis along the beam, ~10° forward-down */
   }
  }else{
   const u=clp((t-(st.fl.rlT0||0))/RL_DUR,0,1);
   const env=Math.sin(Math.PI*Math.min(1,u*1.05));
   const k=0.85*env;
   p.shL=[0,0,L2(p.shL[2],0.12,k)];p.shR=[0,0,L2(p.shR[2],-0.12,k)];
   p.uaL=[L2(p.uaL[0],0.85,k),L2(p.uaL[1],-0.15,k),L2(p.uaL[2],0.25,k)];
   p.faL=[L2(p.faL[0],1.60,k),L2(p.faL[1],0.32,k),L2(p.faL[2],-0.15,k)];
   p.uaR=[L2(p.uaR[0],0.80,k),L2(p.uaR[1],0.15,k),L2(p.uaR[2],-0.28,k)];
   p.faR=[L2(p.faR[0],1.65,k),L2(p.faR[1],-0.34,k),L2(p.faR[2],0.16,k)];
   gripHand(p,'L',[L2(p.haL[0],0.10,k),L2(p.haL[1],-0.50,k),L2(p.haL[2],-0.30,k)],1.08,0.02);
   gripHand(p,'R',[L2(p.haR[0],0.10,k),L2(p.haR[1],0.50,k),L2(p.haR[2],0.30,k)],0.95,0.10);
  }
 }
 /* THIRD PERSON, pinch: key/battery in the right hand — the arm is raised to
 the chest, fingers in PINCH_POSE (the item is held by the same GRIP as in
 first person) */
 {
  const hk2=clp(st._pinchK||0,0,1);
  if(hk2>0.001&&!(st.fl&&st.fl.rl>0)){
   const L2=(a,b,k)=>a+(b-a)*k;
   p.shL=[0,0,L2(p.shL[2],0.08,hk2)];
   p.uaL=[L2(p.uaL[0],0.78,hk2),L2(p.uaL[1],-0.12,hk2),L2(p.uaL[2],0.20,hk2)];
   p.faL=[L2(p.faL[0],1.55,hk2),L2(p.faL[1],0.30,hk2),L2(p.faL[2],-0.10,hk2)];
   p.haL=[L2(p.haL[0],-0.45,hk2),L2(p.haL[1],-1.20,hk2),L2(p.haL[2],0.10,hk2)];
   for(const q in PINCH_POSE){const b=q+'L',T=PINCH_POSE[q];
    p[b]=[L2(p[b][0],T[0],hk2),L2(p[b][1],T[1],hk2),L2(p[b][2],T[2],hk2)];}
  }
 }
 /* ITEM SWITCH (st.sw): the body replays the viewmodel "hand down — up" dip
 (see playerPoseFP). Without it the item teleports into the hand in the puddle
 reflection and in 3rd person with no covering animation. Applied AFTER the
 grip poses — during the dip they don't override the hand lowering. */
 if(slot!=='fp'&&st.sw&&st.sw.dur>0){
  const dipB=Math.sin(Math.PI*clp((t-st.sw.t0)/st.sw.dur,0,1));
  if(dipB>0.001){
   const L2=(a,b,k)=>a+(b-a)*k;
   p.shL=[p.shL[0],p.shL[1],L2(p.shL[2],0.05,dipB)];
   p.uaL=[L2(p.uaL[0],-0.30,dipB),L2(p.uaL[1],0.10,dipB),L2(p.uaL[2],0.20,dipB)];
   p.faL=[L2(p.faL[0],-0.12,dipB),L2(p.faL[1],0.02,dipB),L2(p.faL[2],0.10,dipB)];
  }
 }
 return {pose:p,dy:dy,anim:want};
}
function skinRigEx(rig,pose,rootM,out,hide){
let o=0;
for(let i=0;i<rig.B.length;i++){
 const b=rig.B[i],rt=(pose&&pose[rig.names[i]])||[0,0,0];
 const local=m4mul(m4t(b.off[0],b.off[1],b.off[2]),
  m4mul(m4rotY(rt[1]),m4mul(m4rotX(rt[0]),m4rotZ(rt[2]))));
 b.m=b.parent<0?m4mul(rootM,local):m4mul(rig.B[b.parent].m,local);
 /* IMPORTANT: the root must not be degenerated — descendants are computed from
 its matrix. A hidden bone writes no vertices but keeps its matrix, otherwise
 the hierarchy below "zeroes out" (arms, if the torso is hidden). */
 if(hide&&hide[i]){ if(b.parent>=0)continue; }
 const M=b.m,v=b.v;
 for(let k=0;k<v.length;k+=9){
  const x=v[k],y=v[k+1],z=v[k+2];
  out[o++]=M[0]*x+M[4]*y+M[8]*z+M[12];
  out[o++]=M[1]*x+M[5]*y+M[9]*z+M[13];
  out[o++]=M[2]*x+M[6]*y+M[10]*z+M[14];
  out[o++]=v[k+3];out[o++]=v[k+4];
  const nx=v[k+5],ny=v[k+6],nz=v[k+7];
  const lx=M[0]*nx+M[4]*ny+M[8]*nz,ly=M[1]*nx+M[5]*ny+M[9]*nz,lz=M[2]*nx+M[6]*ny+M[10]*nz;
  const ll=Math.hypot(lx,ly,lz)||1;
  out[o++]=lx/ll;out[o++]=ly/ll;out[o++]=lz/ll;
  out[o++]=v[k+8];
 }
}
return (o/9)|0;
}

/* ================ GPU SKINNING ================
 skinRigEx stays for dev tests; the frame uses fkAll (bone matrices on CPU —
 needed by shadow capsules, the held item, eyes and camera height) + compute
 csSkin (vertex transform on GPU, see WGS_SKIN). */
function fkAll(rig,pose,rootM){
for(let i=0;i<rig.B.length;i++){
 const b=rig.B[i],rt=(pose&&pose[rig.names[i]])||[0,0,0];
 const local=m4mul(m4t(b.off[0],b.off[1],b.off[2]),
  m4mul(m4rotY(rt[1]),m4mul(m4rotX(rt[0]),m4rotZ(rt[2]))));
 b.m=b.parent<0?m4mul(rootM,local):m4mul(rig.B[b.parent].m,local);
} }
/* static rig data for csSkin: vertices in one buffer + bone index */
function rigSrcData(rig){
const src=new Float32Array(rig.total*9),bi=new Uint32Array(rig.total);
let o=0,vi=0;
for(let i=0;i<rig.B.length;i++){const b=rig.B[i];src.set(b.v,o);
for(let k=0;k<b.n;k++)bi[vi+k]=i;o+=b.n*9;vi+=b.n;}
return {src:src,bi:bi}; }
function rigVisCount(rig,hide){
if(!hide)return rig.total;
let n=0;for(let i=0;i<rig.B.length;i++)if(!hide[i])n+=rig.B[i].n;return n; }
/* packing bone matrices and hide flags into staging + writeBuffer;
   the csSkin dispatch itself runs in the frame's compute pass (after all uniform writes) */
function skinUp(I,hide){
const B=I.rig.B,f=I.f32,u=I.u32;
f.fill(0);u.fill(0);
for(let i=0;i<B.length;i++){f.set(B[i].m,i*16);u[i]=(hide&&hide[i])?1:0;}
dev.queue.writeBuffer(I.bones,0,I.bb); }

/* ==== MATERIAL MAP ==== */
let PREG={
flesh :{u0:0.015,u1:0.485},
skin  :{u0:0.500,u1:0.700},
jacket:{u0:0.712,u1:0.848},
pants :{u0:0.858,u1:0.918},
boot  :{u0:0.926,u1:0.968},
hair  :{u0:0.974,u1:0.998}
};
const PMAT={
skin  :{rough:0.40,spec:0.85,bump:7.0},
jacket:{rough:0.88,spec:0.20,bump:5.0},
pants :{rough:0.92,spec:0.14,bump:4.5},
boot  :{rough:0.48,spec:0.70,bump:6.0},
hair  :{rough:0.36,spec:1.05,bump:8.0}
};

/* ==== SKIN TEXTURE ==== */
function genSkinTex(st){   /* st — the seed state, XS_SKIN stream */
const SZ=1024,data=new Uint8Array(SZ*SZ*4);
const G=xsStream(st,XS_SKIN);
const seed=G.u32()|0;   /* 32-bit tag for the per-pixel position hashes (fbm zones) */
const H=(x,y,s)=>pudHash(x|0,y|0,s|0);
const VN=(x,y,s)=>pudVnoise(x,y,s);
const fb=(x,y,s)=>VN(x,y,s)*0.56+VN(x*2.03+17.1,y*2.03+5.3,s+101)*0.29+VN(x*4.31+91.7,y*4.31+3.9,s+211)*0.15;
const fb2=(x,y,s)=>VN(x,y,s)*0.62+VN(x*2.71+3.3,y*2.71+11.9,s+57)*0.26+VN(x*6.13+41.1,y*6.13+7.7,s+131)*0.12;
const rid=(x,y,s)=>{const n=fb(x,y,s);return 1-Math.abs(2*n-1)};
const cl=(v,a,b)=>v<a?a:(v>b?b:v);

/* ---- zone 1: the Monitor's flesh ---- */
const FX1=Math.round(PREG.flesh.u1*SZ);
for(let y=0;y<SZ;y++)for(let x=0;x<FX1;x++){
const m=fb(x*0.018,y*0.018,seed+11), m2=fb(x*0.05+40,y*0.05,seed+77);
const ve=rid(x*0.030,y*0.030,seed+33), ve2=rid(x*0.013+9,y*0.013,seed+55);
const po=H(x,y,seed+7)&15;
const base=0.30+0.26*m;
let r=base*1.06,g=base*0.88,b=base*0.78;
const vm=Math.max(ve*ve,ve2*ve2*0.8);
const vk=Math.max(0,vm-0.55)*2.2;
r=r*(1-vk*0.55)+0.16*vk; g=g*(1-vk*0.62)+0.07*vk; b=b*(1-vk*0.60)+0.08*vk;
const sc=Math.max(0,rid(x*0.008+3,y*0.045,seed+91)-0.80)*5;
r+=sc*0.16;g+=sc*0.14;b+=sc*0.12;
const pk=(po/15-0.5)*0.10*(0.4+m2);
r+=pk;g+=pk*0.9;b+=pk*0.8;
const h=0.35*m+0.30*vk+0.20*(po/15)+0.15*m2;
const o=(y*SZ+x)*4;
data[o]=cl(r*255,0,255)|0;data[o+1]=cl(g*255,0,255)|0;data[o+2]=cl(b*255,0,255)|0;data[o+3]=cl(h*255,0,255)|0;
}

/* ---- common zone "printer": u — around the bone, v — along the bone ---- */
function fill(reg,fn){
const x0=Math.round(reg.u0*SZ),x1=Math.round(reg.u1*SZ),w=x1-x0;
for(let y=0;y<SZ;y++){
const v=(y+0.5)/SZ;   /* row y ↔ v=y/SZ (as WebGPU samples it after upload) */
for(let x=x0;x<x1;x++){
const u=(x+0.5-x0)/w;
const c=fn(u,v,x,y);
const o=(y*SZ+x)*4;
data[o]=cl(c[0]*255,0,255)|0;data[o+1]=cl(c[1]*255,0,255)|0;
data[o+2]=cl(c[2]*255,0,255)|0;data[o+3]=cl(c[3]*255,0,255)|0;
}}
/* guard columns: the zone's edge texels are duplicated so filtering doesn't
 pull the neighbor material (especially important for mips and anisotropy) */
for(let y=0;y<SZ;y++){
const o=(y*SZ+x0)*4,o2=(y*SZ+x0+1)*4;
data[o]=data[o2];data[o+1]=data[o2+1];data[o+2]=data[o2+2];data[o+3]=data[o2+3];
const p=(y*SZ+x1-1)*4,p2=(y*SZ+x1-2)*4;
data[p]=data[p2];data[p+1]=data[p2+1];data[p+2]=data[p2+2];data[p+3]=data[p2+3];}
}
const wstrip=(u,k,ph)=>{const d=Math.abs((((u*k+ph)%1)+1)%1-0.5);return 1-cl((d-0.40)/0.10,0,1)};

/* --- skin: the skin zone is split into windows: neck / palm / fingers / face --- */
const browArc=hx=>0.117+0.011*(1-cl01(Math.abs(hx)/0.048)*cl01(Math.abs(hx)/0.048));
fill(PREG.skin,(u,v,x,y)=>{
/* u here is LOCAL to the zone (0..1); absolute is needed for the head/hand windows */
const ua=PREG.skin.u0+u*(PREG.skin.u1-PREG.skin.u0);
const p=fb2(x*0.55+31,y*0.55+7,seed+5);
const q=fb2(x*0.13+91,y*0.13+17,seed+23);
const pore=H(x,y,seed+13);
let base=0.360+0.085*q+0.050*p-0.032*pore*pore;
const cap=Math.max(0,rid(x*0.055+3,y*0.055,seed+44)-0.80)*4.2;
const blot=Math.max(0,fb(x*0.021+61,y*0.021+3,seed+71)-0.60)*1.4;
let r=base*1.20,g=base*0.935,b=base*0.815;
r+=cap*0.075+blot*0.045; g-=cap*0.012; b-=cap*0.022;
r+=blot*0.030;g+=blot*0.010;
if(H(x>>2,y>>2,seed+97)>0.966){r+=0.036;g+=0.013;b-=0.011}
let h=0.50+0.28*pore+0.16*p-0.10*blot+0.10*cap;
/* ---- neck: shadow from the jaw ---- */
if(v<0.300&&ua<0.600&&v>0.14){
 const k=smk(cl01((v-0.16)/0.14));
 const sh=0.38*(1-k);
 r*=1-sh;g*=1-sh*1.02;b*=1-sh*0.98; h-=0.10*(1-k);
}
/* ---- palm / back of the hand ---- */
if(v>=0.300&&v<0.480&&ua<0.600){
 const du=(ua-0.500)/0.100, dv=(v-0.300)/0.180;
 const palmS=smk(cl01((du-0.50)/0.10))*(1-smk(cl01((du-0.95)/0.05)));
 const c1=Math.exp(-Math.pow((dv-0.55-0.10*Math.sin(du*6.0))/0.030,2))*palmS;
 const c2=Math.exp(-Math.pow((dv-0.74-0.08*Math.sin(du*5.0+1.0))/0.026,2))*palmS;
 const thc=Math.exp(-(Math.pow((du-0.50)/0.07,2)+Math.pow((dv-0.34)/0.20,2)));
 const cc=Math.max(Math.max(c1,c2),thc*0.8);
 r*=1-0.20*cc;g*=1-0.20*cc;b*=1-0.19*cc; h-=0.30*cc;
 /* pads: lighter and more embossed */
 r+=0.030*palmS;g+=0.020*palmS;b+=0.014*palmS; h+=0.10*palmS;
 /* back: tendons and veins */
 const back=1-palmS;
 const tend=Math.exp(-Math.pow((du-0.25)/0.045,2))*Math.exp(-Math.pow((dv-0.55)/0.30,2));
 r+=0.020*tend*back;g+=0.018*tend*back;b+=0.016*tend*back;
 const vein=Math.max(0,rid(du*7.0,dv*3.5,seed+77)-0.82)*5*back;
 r-=vein*0.010;g+=vein*0.004;b+=vein*0.012;
 const kn=Math.exp(-Math.pow((dv-0.94)/0.05,2))*(0.5+0.5*Math.sin(du*46.0));
 r*=1-0.10*kn;g*=1-0.10*kn;b*=1-0.10*kn; h-=0.15*kn;
}
/* ---- fingers: nail, creases, pad ---- */
if(v>=0.060&&v<0.300&&ua>=0.600){
 const du=(ua-0.600)/0.100, dv=(v-0.060)/0.240;
 const nail=smk(cl01(1-Math.pow((du-0.25)/0.11,2)))*smk(cl01((dv-0.52)/0.10))*(1-smk(cl01((dv-0.96)/0.03)));
 if(nail>0.01){
  const lun=smk(cl01((0.70-dv)/0.10));
  const free=smk(cl01((dv-0.88)/0.06));
  let nr=0.575+0.10*lun+0.14*free, ng=0.465+0.10*lun+0.13*free, nb=0.410+0.09*lun+0.12*free;
  const ridge=0.012*Math.sin(du*90.0+dv*8.0);
  r=r*(1-nail)+ (nr+ridge)*nail; g=g*(1-nail)+(ng+ridge)*nail; b=b*(1-nail)+(nb+ridge)*nail;
  h=h*(1-nail)+(0.78-0.10*free)*nail;
 }
 const kc=Math.exp(-Math.pow((dv-0.10)/0.055,2))*(0.55+0.45*Math.sin(du*40.0+1.3));
 const kc2=Math.exp(-Math.pow((dv-0.50)/0.040,2))*(0.5+0.5*Math.sin(du*36.0))*0.6;
 const kk=Math.max(kc,kc2);
 r*=1-0.13*kk;g*=1-0.13*kk;b*=1-0.12*kk; h-=0.22*kk;
 const pad=smk(cl01((du-0.55)/0.15))*(1-smk(cl01((du-0.98)/0.05)))*smk(cl01((dv-0.70)/0.15));
 const fr=0.020*Math.sin(dv*230.0)*pad;
 r+=0.028*pad+fr;g+=0.018*pad+fr;b+=0.013*pad+fr; h+=0.12*pad;
}
/* ---- FACE: arc coordinates ---- */
if(v>=0.500){
 const phi=invHeadU(ua), hy=invHeadV(v), hx=phi*0.075;
 /* socket shadows */
 for(const sgn of [1,-1]){
  const dx=hx-sgn*0.0315, dy=hy-0.0880;
  const ex=dx/0.0075, ey=dy/0.0052, rho=Math.hypot(ex,ey);
  const ao=Math.exp(-Math.pow(rho/2.3,2))*0.13;
  r*=1-ao;g*=1-ao*1.05;b*=1-ao*0.95;
  if(rho>0.90&&rho<1.20&&ey<0){ r=r*0.25+0.030;g=g*0.25+0.026;b=b*0.25+0.024; h-=0.20; }   /* lash line */
  else if(rho>0.95&&rho<1.16&&ey>0){ r*=0.55;g*=0.52;b*=0.50; h-=0.10; }
  else if(rho>1.42&&rho<1.78&&ey<0){ r*=0.88;g*=0.87;b*=0.87; h-=0.06; }                   /* lid crease */
 }
 /* brows: strokes */
 const ba=browArc(hx), db=hy-ba;
 const bm=Math.exp(-Math.pow(db/0.0062,2))*smk(cl01(1-Math.pow(Math.abs(hx)/0.049,2)))*smk(cl01((Math.abs(hx)-0.008)/0.006));
 const st=Math.sin(hx*1500+fb(x*0.35,y*0.35,seed+51)*7.0+db*300);
 if(bm>0.02&&st>-0.1){
  const k=bm*smk(cl01((st+0.1)/0.7))*0.85;
  r=r*(1-k)+0.085*k; g=g*(1-k)+0.062*k; b=b*(1-k)+0.045*k; h-=0.12*k;
 }
 /* stubble */
 const lipM=Math.exp(-Math.pow((hy-0.010)/0.014,2))*smk(cl01(1-Math.pow(hx/0.028,2)));
 const stb=smk(cl01((0.045-hy)/0.022))*smk(cl01((0.088-Math.abs(hx))/0.030))*(1-lipM);
 const sd=H(x,y,seed+141);
 if(stb>0.02&&sd>0.42){
  const k=stb*(0.30+0.45*sd);
  r*=1-0.16*k;g*=1-0.15*k;b*=1-0.12*k; h-=0.06*k;
 }
 /* lips */
 const lm=smk(cl01(1-Math.pow(Math.abs(hx)/0.0265,2)))*Math.exp(-Math.pow((hy-0.010)/0.0135,2));
 if(lm>0.01){
  const k=lm*0.80;
  r=r*(1-k)+0.400*k; g=g*(1-k)+0.185*k; b=b*(1-k)+0.165*k;
  h=h*(1-lm)+0.44*lm;
 }
 const ml=Math.exp(-Math.pow((hy-0.0110)/0.0016,2))*lm;
 if(ml>0.01){ r=r*(1-ml)+0.115*ml; g=g*(1-ml)+0.068*ml; b=b*(1-ml)+0.060*ml; h+=0.18*ml; }
 const lh=Math.exp(-Math.pow((hy-0.0015)/0.0040,2))*lm;
 r+=0.045*lh;g+=0.026*lh;b+=0.022*lh;
 /* nostrils and wings */
 const nd=Math.exp(-(Math.pow((Math.abs(hx)-0.0075)/0.0021,2)+Math.pow((hy-0.0372)/0.0022,2)));
 if(nd>0.01){ const k=nd*0.55; r=r*(1-k)+0.085*k; g=g*(1-k)+0.068*k; b=b*(1-k)+0.062*k; h-=0.22*nd; }
 /* nose-base shadow (from below) — instead of black dots in front */
 const ush=Math.exp(-(Math.pow(hx/0.0125,2)+Math.pow((hy-0.0300)/0.0045,2)));
 r*=1-0.22*ush;g*=1-0.22*ush;b*=1-0.20*ush; h-=0.10*ush;
 const ac=Math.exp(-(Math.pow((Math.abs(hx)-0.0180)/0.0026,2)+Math.pow((hy-0.0400)/0.0080,2)));
 r*=1-0.12*ac;g*=1-0.12*ac;b*=1-0.11*ac;
 /* blush and the T-zone */
 const bl=Math.exp(-(Math.pow((Math.abs(hx)-0.0330)/0.016,2)+Math.pow((hy-0.0580)/0.015,2)));
 r+=0.030*bl;g+=0.008*bl;b+=0.004*bl;
 /* ear: concha shadow */
 const es=Math.exp(-(Math.pow((Math.abs(phi)-1.72)/0.30,2)+Math.pow((hy-0.070)/0.032,2)));
 r*=1-0.30*es;g*=1-0.30*es;b*=1-0.28*es; h-=0.15*es;
}
/* skin micro-relief: a finest wrinkle mesh + neck folds.
 Amplitudes are tiny; facial features (eyes/lips/brows) don't shift. */
const mic=fb2(x*1.9+13,y*1.9+29,seed+151)-0.5;
const mic2=fb2(x*3.7+57,y*3.7+11,seed+241)-0.5;
r+=mic*0.010+mic2*0.005; g+=mic*0.009+mic2*0.004; b+=mic*0.008+mic2*0.004;
h+=mic*0.10+mic2*0.06;
if(v<0.300&&v>0.14&&ua<0.600){
 const nl=0.5+0.5*Math.sin(v*150+fb(x*0.06,y*0.06,seed+251)*3.0);
 const nk2=cl((nl-0.75)*4,0,1)*0.5;
 r-=nk2*0.012;g-=nk2*0.012;b-=nk2*0.011; h-=nk2*0.10;
}
return [r,g,b,h];
});
/* ---- eye window: iris/pupil/sclera ---- */
{
const x0=Math.round(EYE_U0*SZ),x1=Math.round(EYE_U1*SZ);
const y0=Math.round(EYE_V0*SZ),y1=Math.round(EYE_V1*SZ);
for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
 const u=(x+0.5)/SZ, v=(y+0.5)/SZ;
 const t=cl01((v-EYE_V0)/(EYE_V1-EYE_V0));
 const ang=((u-EYE_U0)/(EYE_U1-EYE_U0))*Math.PI*2;
 let r,g,b,h;
 if(t<0.115){ r=0.020;g=0.018;b=0.017;h=0.30; }                       /* pupil */
 else if(t<0.315){                                                    /* iris */
  const q=(t-0.115)/0.20;
  const stri=0.5+0.5*Math.sin(ang*26+fb(x*0.9,y*0.9,seed+61)*9);
  const stri2=0.5+0.5*Math.sin(ang*61+3.1+fb(x*1.7,y*1.7,seed+67)*5);
  const base=0.115+0.075*stri+0.045*stri2;
  r=base*1.35+0.045*(1-q); g=base*1.05+0.030*(1-q); b=base*0.72+0.018*(1-q);
  const col=Math.exp(-Math.pow((q-0.35)/0.22,2))*0.06;                 /* collarette */
  r+=col;g+=col*0.85;b+=col*0.6;
  if(q>0.86){ const k=(q-0.86)/0.14; r*=1-0.75*k;g*=1-0.75*k;b*=1-0.72*k; }  /* limbus */
  h=0.62;
 } else {                                                             /* sclera */
  const q=(t-0.315)/0.685;
  let s=0.60-0.16*smk(cl01(q/0.45));
  const vein=Math.max(0,rid(ang*3.0+7,q*6.0,seed+71)-0.80)*4;
  r=s+vein*0.055; g=s*0.985+vein*0.012; b=s*0.96+vein*0.010;
  r+=0.02*Math.sin(ang*3+1.0)*q;
  h=0.55;
 }
 const o=(y*SZ+x)*4;
 data[o]=cl(r*255,0,255)|0;data[o+1]=cl(g*255,0,255)|0;data[o+2]=cl(b*255,0,255)|0;data[o+3]=cl(h*255,0,255)|0;
}
}

/* --- jacket: twill, pattern panels, stitched seams, zipper, wear --- */
fill(PREG.jacket,(u,v,x,y)=>{
/* the fabric is denser and "pricier": two-thread twill (coarse + fine),
 yarn nubs, drape folds along the bone, double seam stitching. */
const tw=0.5+0.22*Math.sin(x*1.35+y*0.55)+0.14*Math.sin(x*0.55-y*1.35)
        +0.10*Math.sin(x*2.85-y*2.30)+0.06*Math.sin(x*4.7+y*3.9);
const thr=fb2(x*0.95+7,y*0.95+23,seed+141);            /* thread grain */
const m=fb2(x*0.085+11,y*0.085+29,seed+9);
const coarse=fb(x*0.021+5,y*0.021+41,seed+31);
const fold=Math.max(0,Math.sin(v*23+fb(x*0.02,y*0.02,seed+91)*4.5));  /* drape */
const fk=cl((fold-0.52)*2.2,0,1);
let base=0.200+0.055*m+0.030*(tw-0.5)+0.028*(coarse-0.5)+0.014*(thr-0.5)
        -0.020*fk+0.010*Math.max(0,Math.sin(v*23+2.2+fb(x*0.02,y*0.02,seed+91)*4.5)-0.6);
let r=base*0.90,g=base*1.00,b=base*0.94;
const pan=((u*4)%1+1)%1, seam=Math.min(pan,1-pan);
const sLine=1-cl(seam/0.030,0,1);
r-=sLine*0.058;g-=sLine*0.052;b-=sLine*0.050;
/* double stitch: two rows of stitches on both sides of the seam + a shadow groove */
const stA=Math.exp(-Math.pow((seam-0.042)/0.006,2))+Math.exp(-Math.pow((seam-0.058)/0.006,2));
const dash=0.5+0.5*Math.sin(v*300);
const stit=stA*cl((dash-0.35)/0.3,0,1);
r+=stit*0.052;g+=stit*0.050;b+=stit*0.044;
if(seam<0.055&&Math.sin(u*4*Math.PI*28)>0.55){r+=0.030;g+=0.030;b+=0.026}
/* front zipper: u=0.75 is local -Z, the model's "face" */
const zip=1-cl(Math.abs(u-0.75)/0.011,0,1);
if(zip>0){const t2=Math.sin(v*200)*0.5+0.5;
r=r*(1-zip*0.55)+zip*(0.125+0.155*t2);g=g*(1-zip*0.55)+zip*(0.130+0.160*t2);b=b*(1-zip*0.55)+zip*(0.140+0.175*t2)}
const wear=Math.max(0,fb(x*0.035+77,y*0.035+13,seed+53)-0.62)*2.4;
r+=wear*0.055;g+=wear*0.058;b+=wear*0.050;
/* sheen on fold ridges — the fabric lives */
r+=fk*0.016;g+=fk*0.017;b+=fk*0.015;
/* reflective stripe — it also reads as the sleeve */
const hv=1-cl(Math.abs(v-0.30)/0.020,0,1), hu=wstrip(u,4,0.12);
if(hv*hu>0.01){const k=hv*hu;r+=k*0.105;g+=k*0.105;b+=k*0.078}
const h=0.44+0.18*(tw-0.5)+0.18*m+0.30*sLine+0.34*zip-0.12*wear
       +0.10*fk+0.08*(thr-0.5)+0.22*stit-0.10*stA;
return [r,g,b,cl(h,0,1)];
});

/* --- pants: fine twill, side seam, knee folds --- */
fill(PREG.pants,(u,v,x,y)=>{
/* trouser fabric is finer: a thin two-thread weave, transverse folds at the
 knee and seat, side-seam stitching, nap micro-noise. */
const tw=0.5+0.20*Math.sin(x*1.70+y*0.70)+0.12*Math.sin(x*0.70-y*1.70)
        +0.09*Math.sin(x*3.3+y*2.6)+0.05*Math.sin(x*5.6-y*4.8);
const thr=fb2(x*1.1+31,y*1.1+17,seed+161);
const m=fb2(x*0.095+53,y*0.095+19,seed+15);
const fold=Math.max(0,Math.sin(v*44+fb(x*0.03,y*0.03,seed+71)*5));
const fk=cl((fold-0.55)*2.4,0,1)*0.6;
const crease=Math.max(0,Math.sin(v*13+fb(x*0.015,y*0.05,seed+171)*3.0));  /* big creases */
const crk=cl((crease-0.72)*3.0,0,1);
let base=0.132+0.040*m+0.026*(tw-0.5)+0.012*(thr-0.5)-0.016*crk+0.010*fk;
let r=base*0.93,g=base*1.00,b=base*1.15;
const side=1-cl(Math.abs(((u*2)%1)-0.5)/0.040,0,1);
r-=side*0.030;g-=side*0.030;b-=side*0.026;
/* stitching along the side seam */
const stB=Math.exp(-Math.pow((Math.abs(((u*2)%1)-0.5)-0.055)/0.006,2))*cl((0.5+0.5*Math.sin(v*320)-0.35)/0.3,0,1);
r+=stB*0.040;g+=stB*0.040;b+=stB*0.036;
r+=fk*0.020;g+=fk*0.020;b+=fk*0.022;
const h=0.46+0.16*(tw-0.5)+0.20*m+0.24*fk+0.08*(thr-0.5)+0.18*stB-0.14*crk;
return [r,g,b,cl(h,0,1)];
});

/* --- boots and belt: leather grain, cracks, welt, lacing --- */
fill(PREG.boot,(u,v,x,y)=>{
/* leather with pores and fine cracks, a welt with stitching around the sole,
 wear at the flexes — the boot looks "adult". */
const g1=fb2(x*0.42+5,y*0.42+61,seed+27);
const g2=fb(x*0.075+3,y*0.075+83,seed+39);
const pore=H(x,y,seed+181);
const grain=fb2(x*1.3+61,y*1.3+7,seed+191);
const crack=Math.max(0,rid(x*0.16+21,y*0.16+9,seed+61)-0.86)*6.5
            +Math.max(0,rid(x*0.34+5,y*0.34+77,seed+201)-0.90)*4.0;
const crease=Math.max(0,Math.sin(v*52+fb(x*0.05,y*0.05,seed+211)*4.0));  /* leather flex creases */
const crk=cl((crease-0.78)*3.4,0,1);
let base=0.086+0.045*g2+0.030*(g1-0.5)+0.016*(grain-0.5)-0.010*(pore>0.93?1:0)
        -0.014*crk+0.010*Math.max(0,crease-0.5);
let r=base*1.02,g=base*0.95,b=base*0.90;
r-=crack*0.030;g-=crack*0.030;b-=crack*0.028;
const sole=1-cl(Math.abs(v-0.06)/0.05,0,1);
r-=sole*0.045;g-=sole*0.045;b-=sole*0.045;
/* welt: a band + dashed stitching above the sole */
const welt=1-cl(Math.abs(v-0.135)/0.018,0,1);
const wst=welt*cl((0.5+0.5*Math.sin(u*220)-0.30)/0.4,0,1);
r+=welt*0.030+wst*0.045;g+=welt*0.028+wst*0.042;b+=welt*0.024+wst*0.036;
const lac=Math.sin(v*34)*0.5+0.5, lz=1-cl(Math.abs(u-0.75)/0.070,0,1);
if(lz*lac>0.05){const k=lz*lac*0.85;r+=k*0.055;g+=k*0.052;b+=k*0.048}
const h=0.42+0.24*g1+0.16*g2-0.34*crack+0.30*lz*lac
       +0.10*(grain-0.5)+0.30*wst+0.16*welt-0.20*crk-0.10*(pore>0.93?1:0);
return [r,g,b,cl(h,0,1)];
});

/* --- hair: strands along v, parting --- */
fill(PREG.hair,(u,v,x,y)=>{
/* strands at two scales + rare glossy locks, dark roots at the parting/edge —
 the hair stops being a uniform "curtain". */
const strand=0.5+0.5*Math.sin(u*320+fb(x*0.05,y*0.05,seed+83)*7);
const fine=0.5+0.5*Math.sin(u*760+fb(x*0.12,y*0.12,seed+221)*9);
const gloss=Math.max(0,Math.sin(u*47+fb(x*0.02,y*0.02,seed+231)*3.0));
const gl=cl((gloss-0.86)*7,0,1)*cl((v-0.25)/0.5,0,1);
const m=fb2(x*0.11+71,y*0.11+3,seed+19);
let base=0.054+0.034*m+0.030*(strand-0.5)+0.014*(fine-0.5)+0.045*gl;
const root=cl((0.16-v)/0.16,0,1);
base-=root*0.016;
let r=base*1.12,g=base*0.94,b=base*0.84;
const part=1-cl(Math.abs(u-0.25)/0.018,0,1);
r-=part*0.020;g-=part*0.018;b-=part*0.016;
const h=0.40+0.32*strand+0.20*m+0.12*fine-0.18*root+0.10*gl;
return [r,g,b,cl(h,0,1)];
});

/* --- metal hardware over the boot zone: belt buckle and dog tag --- */
{
const reg=PREG.boot,x0=Math.round(reg.u0*SZ),w=Math.round((reg.u1-reg.u0)*SZ);
const put=(u0,v0,uu,vv,kind)=>{
 const wi=Math.max(2,Math.round(uu*w)),hi=Math.max(2,Math.round(vv*SZ));
 for(let j=0;j<hi;j++)for(let i=0;i<wi;i++){
  const x=x0+Math.round(u0*w)+i, y=Math.round((v0+j/SZ)*SZ);
  if(x<0||x>=SZ||y<0||y>=SZ)continue;
  const lu=i/(wi-1),lv=j/(hi-1);
  let r,g,b,h;
  if(kind===1){
   const edge=Math.min(Math.min(lu,1-lu),Math.min(lv,1-lv));
   const fr=1-cl(edge/0.11,0,1);
   const br=0.28+0.36*Math.pow(cl(1-Math.abs(lu-0.34)*2.2,0,1),1.6);
   r=0.28+br*0.55+fr*0.10;g=0.25+br*0.50+fr*0.09;b=0.19+br*0.36+fr*0.07;
   h=0.52+0.38*fr-0.22*(1-fr);
  }else{
   const dx=(lu-0.5)*1.7,dy=lv-0.5,rr=dx*dx+dy*dy*2.4;
   const br=0.20+0.42*Math.pow(cl(1-Math.abs(lu-0.30)*2.0,0,1),1.4);
   if(rr<0.62){r=0.15+br*0.30;g=0.16+br*0.32;b=0.19+br*0.36;h=0.82}
   else{r=0.072;g=0.070;b=0.068;h=0.34}
   if(rr<0.62&&lv>0.58&&lv<0.70){r+=0.11;g+=0.035;b+=0.02}
  }
  const o=(y*SZ+x)*4;
  data[o]=cl(r*255,0,255)|0;data[o+1]=cl(g*255,0,255)|0;data[o+2]=cl(b*255,0,255)|0;data[o+3]=cl(h*255,0,255)|0;
 }};
put(0.30,0.50,0.17,0.11,1);
put(0.60,0.76,0.11,0.08,2);
}
/* overall grain so the zones don't look "digital" */
const gr=xsBulk(G.u32());   /* bulk expansion: 10⁶ draws from the BigInt generator would be too slow */
for(let i=0;i<data.length;i+=4){
const n=(gr()-0.5)*0.018*255;
data[i]=cl(data[i]+n,0,255)|0;data[i+1]=cl(data[i+1]+n,0,255)|0;data[i+2]=cl(data[i+2]+n,0,255)|0;
}
return data;
}
/* ================ FIRST-PERSON VIEWMODEL ================
 Arms: shoulder below the frame, elbow bent ~95°, forearm up-forward-inward,
 hands ~0.35 m before the camera, palms toward each other. Plus wall "constraint". */
function m4sc(s){const m=new Float32Array(16);m[0]=s;m[5]=s;m[10]=s;m[15]=1;return m;}
const VM_YAW=0.0;
const VM_DROP=-1.62, VM_FWD=-0.18;   /* in rig units; in cells — via PL_SCALE */
const PL_SCALE=0.345;
/* The viewmodel is uniformly scaled around the camera (VM_SCALE): the
 projection doesn't change (points stay on the same rays), but the arms, the
 lamp and the beam start honestly ~0.58 m from the eyes — the beam doesn't
 start behind a near wall. */
const VM_SCALE=PL_SCALE;
/* eye height of the calm stance in rig units (FK measurement over idle: bone
 hd + eye centers EYE_HY/EYE_ZC). First-person camera = 0.55 cells +
 (current − this)·PL_SCALE. */
const EYE_REF_RIG=1.7205;
const VM_FRAME=(function(){
 return m4mul(m4t(0,VM_DROP*PL_SCALE,VM_FWD*PL_SCALE),m4mul(m4rotY(VM_YAW),m4sc(VM_SCALE)));
})();

/* ITEM IN HAND. Item axis — local +X; mount fixups are solved NUMERICALLY
 over the rig FK, one for FP and TP (error angle < 1.5°). Key/battery —
 GRIP_KEY/GRIP_BATT (pinch PINCH_POSE). Flashlight: the hand turns with the
 fist axis along the beam, the fixup is a PURE TRANSFER of the grip center
 (local x=-0.070) onto the fist axis; phalanges close around the tube
 (2.0–3.1 cm at a 1.9 cm radius). */
function heldMat(dx,dy,dz,ry,rz){return m4mul(m4t(dx,dy,dz),m4mul(m4rotZ(rz),m4rotY(ry)));}
const GRIP_FLASH=m4t(0.070,-0.095,0.026);
/* thumb rest on the end button (t1,t2), solved over FK */
const GRIP_THUMB=[[-0.369,0.146,-0.090],[-0.196,0,0]];
/* PINCH: the index hovers over the item, the thumb goes AROUND the hand
 OUTSIDE (no penetration into the palm) and presses from the other side.
 ha angles — the viewmodel stance. */
const PINCH_POSE={i1:[-1.13,0,0.008],i2:[-1.75,0,0],i3:[-0.26,0,0],
m1:[-0.96,0,0.036],m2:[-1.4,0,0],m3:[-0.27,0,0],
r1:[-0.932,0,0.064],r2:[-1.1392,0,0],r3:[-0.7767,0,0],
p1:[-0.8567,0,0.092],p2:[-1.047,0,0],p3:[-0.7139,0,0],
t1:[-0.66,-0.62,-0.02],t2:[-0.56,0,0]};
const PINCH_HA=[-0.52,-1.28,0.16];
/* Small-item grip: the item axis lies in the finger-ring plane (the end faces
 the camera), the key bit/battery plus sticks out PAST the fingertips. Solved
 over the FK of the full arm chain, point P — between the pads. */
const GRIP_KEY=(()=>{const m=new Float32Array([0.1744,0.9845,0.0182,0, 0.1038,0,-0.9946,0, -0.9792,0.1754,-0.1022,0, -0.0568,-0.1579,0.0143,1]);return m})();
const GRIP_BATT=(()=>{const m=new Float32Array([-0.1744,-0.9845,-0.0182,0, -0.1038,0,0.9946,0, -0.9792,0.1754,-0.1022,0, -0.0429,-0.0509,0.0223,1]);return m})();
const GRIP_SMALL_L=heldMat(0.004,-0.085,0.015,-1.316,-2.91);
/* direct grip: hand + fingers (fpHand analog, but ha is set explicitly) */
function gripHand(p,S,wr,cu,sp,thO,thK){
const s=S==='L'?1:-1;
p['ha'+S]=[wr[0],wr[1],wr[2]];
const F={i:0.94,m:1.0,r:0.95,p:0.82}, ph={i:0.0,m:0.34,r:0.68,p:1.02};
for(const f of ['i','m','r','p']){
const c=cu*F[f]+0.10, spp=(sp+ph[f]*0.5)*0.16;
p[f+'1'+S]=[-c*0.36,0,s*spp];
p[f+'2'+S]=[-c*0.44,0,0];
p[f+'3'+S]=[-c*0.30,0,0];
}
p['t1'+S]=[-0.30-cu*0.25,0,-s*(0.42+sp*0.10)];
p['t2'+S]=[-0.22-cu*0.30,0,0];
/* the thumb is ON THE END BUTTON (solved numerically over FK: the pad at the
 button edge, the F impulse always presses it) */
if(thO&&thK>0.001){
 for(let i=0;i<3;i++){
  p['t1'+S][i]=p['t1'+S][i]+(thO[0][i]-p['t1'+S][i])*thK;
  p['t2'+S][i]=p['t2'+S][i]+(thO[1][i]-p['t2'+S][i])*thK;
 }
}
}
/* BATTERY SWAP — keyframes of both hands (FP). Channels: ua/fa, wr, cu/sp.
 u = t/RL_DUR, smoothstep between frames. Story: bring to the chest → the left
 intercepts the barrel → the right unscrews the cap → the left carries the dead
 one away → inserts the new one → screws the cap home. */
const RL_KEYS=[
{u:0.00,uaL:[1.00,-0.10,0.50],faL:[2.20,0.10,-0.10],wrL:[-0.42,-1.02,0.20],cuL:1.05,spL:0.02,
       uaR:[1.00, 0.10,-0.50],faR:[2.20,-0.10,0.10],wrR:[-0.42,1.02,-0.20],cuR:0.95,spR:0.10},
{u:0.10,uaL:[0.98,-0.24,0.30],faL:[1.98,0.30,-0.38],wrL:[-0.34,-0.80,0.48],cuL:1.10,spL:0.02,
       uaR:[1.14, 0.30,-0.28],faR:[2.42,-0.44,0.24],wrR:[-0.36,0.86,-0.30],cuR:0.42,spR:0.55},
{u:0.24,uaL:[0.90,-0.28,0.22],faL:[1.85,0.34,-0.50],wrL:[-0.25,-0.55,0.85],cuL:1.10,spL:0.00,
       uaR:[1.05, 0.35,-0.22],faR:[2.20,-0.55,0.22],wrR:[-0.34,0.75,-0.26],cuR:1.00,spR:0.05},
{u:0.40,uaL:[0.90,-0.28,0.22],faL:[1.85,0.34,-0.50],wrL:[-0.18,-0.50,0.95],cuL:1.10,spL:0.00,
       uaR:[0.92, 0.12,-0.48],faR:[1.98,-0.22,0.44],wrR:[-0.50,0.70,-0.55],cuR:1.05,spR:0.02},
{u:0.56,uaL:[0.90,-0.28,0.22],faL:[1.85,0.34,-0.50],wrL:[-0.18,-0.50,0.95],cuL:1.10,spL:0.00,
       uaR:[0.80, 0.05,-0.60],faR:[1.75,-0.15,0.50],wrR:[-0.58,0.66,-0.62],cuR:0.70,spR:0.30},
{u:0.70,uaL:[0.90,-0.28,0.22],faL:[1.85,0.34,-0.50],wrL:[-0.25,-0.55,0.85],cuL:1.10,spL:0.00,
       uaR:[1.05, 0.35,-0.22],faR:[2.20,-0.55,0.22],wrR:[-0.34,0.75,-0.26],cuR:1.02,spR:0.04},
{u:0.84,uaL:[0.95,-0.22,0.30],faL:[2.00,0.28,-0.36],wrL:[-0.32,-0.78,0.50],cuL:1.08,spL:0.01,
       uaR:[1.08, 0.22,-0.32],faR:[2.32,-0.32,0.20],wrR:[-0.38,0.84,-0.26],cuR:0.60,spR:0.35},
{u:1.00,uaL:[1.00,-0.10,0.50],faL:[2.20,0.10,-0.10],wrL:[-0.42,-1.02,0.20],cuL:1.05,spL:0.02,
       uaR:[1.00, 0.10,-0.50],faR:[2.20,-0.10,0.10],wrR:[-0.42,1.02,-0.20],cuR:0.95,spR:0.10}];
function rlSample(u){
const K=RL_KEYS,n=K.length;
u=Math.max(0,Math.min(1,u));
let i=0;while(i<n-2&&u>K[i+1].u)i++;
const A=K[i],B=K[i+1];
const span=Math.max(1e-6,B.u-A.u);
const f0=Math.max(0,Math.min(1,(u-A.u)/span)),f=f0*f0*(3-2*f0);
const mix3=(a,b)=>[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f];
return {uaL:mix3(A.uaL,B.uaL),faL:mix3(A.faL,B.faL),wrL:mix3(A.wrL,B.wrL),
cuL:A.cuL+(B.cuL-A.cuL)*f,spL:A.spL+(B.spL-A.spL)*f,
uaR:mix3(A.uaR,B.uaR),faR:mix3(A.faR,B.faR),wrR:mix3(A.wrR,B.wrR),
cuR:A.cuR+(B.cuR-A.cuR)*f,spR:A.spR+(B.spR-A.spR)*f};
}
/* battery visibility window in the LEFT hand during the swap (u):
 dead — took out and dropped (0.26…0.50), new — from pocket into barrel (0.54…0.75) */
function rlBattOld(u){return u>=0.26&&u<=0.50}
function rlBattNew(u){return u>=0.54&&u<=0.75}

/* hand pose for the viewmodel: curl, spread, adduction */
function fpHand(p,S,curl,spread,palmYaw,palmRoll,wrist){
for(const n of ['L','R']){
 const s=S==='L'?1:-1;
 p['ha'+S]=[wrist[0], palmYaw*s+wrist[1], palmRoll*s+wrist[2]];
 const F={i:0.94,m:1.0,r:0.95,p:0.82}, ph={i:0.0,m:0.34,r:0.68,p:1.02};
 for(const f of ['i','m','r','p']){
  const c=curl*F[f]+0.10, sp=(spread+ph[f]*0.5)*0.16;
  p[f+'1'+S]=[-c*0.36,0,s*sp];
  p[f+'2'+S]=[-c*0.44,0,0];
  p[f+'3'+S]=[-c*0.30,0,0];
 }
 p['t1'+S]=[-0.30-curl*0.25,0,-s*(0.42+spread*0.10)];
 p['t2'+S]=[-0.22-curl*0.30,0,0];
}
return p;
}
function playerPoseFP(st,t){
const r=playerPose(st,t,'fp');
const p=r.pose;
t=t||0;
/* the "calm" pose (st._calm) — for the arm-constraint ray: the breathing sway
 of the hands must not pulse the wall-clamp target. */
const ib=(st._calm?0:1)*(Math.sin(t*1.30)*0.010+Math.sin(t*2.17)*0.004);
const mv=Math.min(1,st.bobA||0);
const sw=Math.sin(st.animPhase||0)*mv;
const ex=clp(1-(st.stam===undefined?1:st.stam),0,1);
const runK=st.runK||0;
/* the viewmodel torso does NOT inherit the crouch/run tilt from clips: the
 shoulder joint stays put relative to the camera — the arms hold near the body
 and the shoulder "stumps" at the frame edges are gone. */
const crT=clp(st.pCrouch||0,0,1);
p.pel=[0.10*crT+0.05*runK,(p.pel?p.pel[1]:0)*0.25,(p.pel?p.pel[2]:0)*0.25];
p.spn=[0.05*crT+0.04*runK,0,0];
p.ch=[0.07*crT+0.06*runK,0,0];
p.nk=[-0.06*crT-0.04*runK,0,0];
p.hd=[-0.04*crT-0.03*runK,0,0];
/* fatigue in the viewmodel — a SMOOTH arm sway: the smoothed envelope st._exS
 and continuous phase st._exPh from playerPose (~0.3 Hz + ~0.16 Hz drift,
 amplitude ~1°) — eyes don't tire of such sway. */
const exS=clp(st._exS||0,0,1), exPh=st._exPh||0;
const fb1=Math.sin(exPh), fb2=Math.sin(exPh*0.53+1.7);
const swExL=exS*(0.016*fb1+0.009*fb2), swExR=exS*(0.016*fb1-0.009*fb2);
/* wall constraint: 0 — free, 1 — arms pressed to the body */
const tkL=clp(st.vmTuckL||0,0,1), tkR=clp(st.vmTuckR||0,0,1);
const tk=Math.max(tkL,tkR);
/* flashlight in the right hand (not reloading) — a special grip */
const rlNow0=!!(st.fl&&st.fl.rl>0);
const holdFl=!rlNow0&&!!(st.inv&&st.sel>=0&&st.inv[st.sel]&&st.inv[st.sel].kind==='flash');
/* the right hand is busy with ANY item — then interact pulls the left arm */
const selIt0=(st.inv&&st.sel>=0)?st.inv[st.sel]:null;
const heldAny=!rlNow0&&!!selIt0;
const pkAct=!!(st.pk);                 /* pickup: the right reaches, item at the apex */
const isKey=(st.pActKind==='key');     /* the final door valve is turned by the right hand */
const holdSm=heldAny&&(selIt0.kind==='key'||selIt0.kind==='batt');
/* base angles: shoulder forward-down-outward, elbow bent */
const uaX=1.00+mv*0.05+runK*0.02-crT*0.10-tk*0.50;   /* run/crouch barely push the arms forward — hands stay near the body */
const uaZ=0.50-mv*0.03-runK*0.06-crT*0.06-tk*0.12;   /* elbows closer to the torso */
const faX=2.20-sw*0.08*mv-runK*0.02+crT*0.10+tk*0.55;
const faZ=-0.10+tk*0.06;
p.uaL=[ uaX+sw*0.10*mv+ib+swExL, -0.10-tk*0.10,  uaZ];
p.uaR=[ uaX-sw*0.10*mv-ib+swExR,  0.10+tk*0.10, -uaZ];
p.faL=[ faX+swExL*0.6, 0.10, faZ];
p.faR=[ faX+swExR*0.6, -0.10, -faZ];
p.shL=[0,0,0.06+tk*0.10]; p.shR=[0,0,-0.06-tk*0.10];
/* hands: palms inward, slightly down; at a wall — palm flat forward */
const palmY=-1.02+tk*0.85, palmR=0.30-tk*0.25;
const wrist=[-0.42+tk*0.75+ib*1.5, 0, -0.10+sw*0.06*mv];
fpHand(p,'L',0.95+runK*0.25+tk*0.10,0.1+tk*1.6,palmY,palmR,wrist);
fpHand(p,'R',0.95+runK*0.25+tk*0.10,0.1+tk*1.6,palmY,palmR,[wrist[0],-wrist[1],-wrist[2]]);
/* the E action follows the clip timeline (pShotT0), not the impulse:
 interact 0.75 s — the RIGHT arm (bone 'L', the rig is mirrored) reaches
 FORWARD and grabs; push 0.9 s — both palms go flat forward and push. */
const isPush=(st.pActKind==='door');
const actLen=isPush?0.9:0.75;
let cA=1.5;
if((st.pShot==='interact'||st.pShot==='push')&&st.pShotT0!==undefined)cA=(t-st.pShotT0)/actLen;
cA=clp(cA,0,1.5);
let ext=0,grb=0;
if(cA<=1){
 if(isPush){ ext=sm(clp(cA/0.34,0,1))*(1-sm(clp((cA-0.52)/0.44,0,1))); }
 else{ ext=sm(clp((cA-0.05)/0.32,0,1))*(1-sm(clp((cA-0.58)/0.40,0,1)));
       grb=sm(clp((cA-0.38)/0.14,0,1))*(1-sm(clp((cA-0.62)/0.30,0,1))); }
}
/* slew filter against one-frame seams (clip switches, pause) */
const dta=clp(t-(st._actT===undefined?t:st._actT),0,0.1); st._actT=t;
const act=(st._actS||0)+clp(ext-(st._actS||0),-dta*6.0,dta*6.0); st._actS=act;
const grbS=(st._grbS||0)+clp(grb-(st._grbS||0),-dta*6.0,dta*6.0); st._grbS=grbS;
if(act>0.002||grbS>0.002){
 const c0=0.95+runK*0.25+tk*0.10, s0=0.1+tk*1.6;
 if(isPush){
  /* both arms forward, palms flat to the door, fingers spread */
  p.uaL=[p.uaL[0]+act*0.45,p.uaL[1],p.uaL[2]-act*0.10];
  p.uaR=[p.uaR[0]+act*0.45,p.uaR[1],p.uaR[2]+act*0.10];
  p.faL=[p.faL[0]-act*1.60,p.faL[1],p.faL[2]];
  p.faR=[p.faR[0]-act*1.60,p.faR[1],p.faR[2]];
  const wp=[wrist[0]+act*0.16,wrist[1],wrist[2]-act*0.06];
  fpHand(p,'L',c0-act*0.62,s0+act*1.10,palmY+act*0.78,palmR-act*0.22,wp);
  fpHand(p,'R',c0-act*0.62,s0+act*1.10,palmY+act*0.78,palmR-act*0.22,[wp[0],-wp[1],-wp[2]]);
 }else if(heldAny&&!isKey&&!pkAct){
  /* the right is busy with the item — the LEFT (bone 'R') reaches, the right keeps the grip */
  p.uaR=[p.uaR[0]+act*0.42-0.08*grbS,p.uaR[1],p.uaR[2]+act*0.06];
  p.faR=[p.faR[0]-act*1.55+grbS*0.35,p.faR[1],p.faR[2]];
  fpHand(p,'R',c0-act*0.58+grbS*0.90,s0+act*0.95-grbS*0.55,palmY+act*0.58-grbS*0.30,palmR,
   [wrist[0]+act*0.12-grbS*0.06,-wrist[1],-(wrist[2]-act*0.10+grbS*0.04)]);
  /* the right (visible) pulls back a bit — counterbalance */
  p.uaL=[p.uaL[0]-act*0.05,p.uaL[1],p.uaL[2]];
 }else{
  /* right: shoulder forward-up, elbow straightens, the hand travels forward
 along Z; on the grab the fingers clench, the elbow tucks (item raised) */
  p.uaL=[p.uaL[0]+act*0.42-0.08*grbS,p.uaL[1],p.uaL[2]-act*0.06];
  p.faL=[p.faL[0]-act*1.55+grbS*0.35,p.faL[1],p.faL[2]];
  fpHand(p,'L',c0-act*0.58+grbS*0.90,s0+act*0.95-grbS*0.55,palmY+act*0.58-grbS*0.30,palmR,
   [wrist[0]+act*0.12-grbS*0.06,wrist[1],wrist[2]-act*0.10+grbS*0.04]);
  /* the left (visible) pulls back a bit — counterbalance */
  p.uaR=[p.uaR[0]-act*0.05,p.uaR[1],p.uaR[2]];
 }
}
/* FLASHLIGHT GRIP: tube axis = fist axis = view direction (by FK:
 (0,-0.09,-0.996) in view-space), fingers close around the tube (curl 3.06),
 the thumb — on the end button. During the arm pull (E) the grip blends in
 partially — the arm reaches but doesn't "drop" the item. */
if(holdFl){
 /* the grip breaks only on push (both hands); on the RIGHT pull (pickup) it
 blends back as the arm returns — else the hand teleports into the stance. */
 const gK=1-clp(act,0,1)*((pkAct||isKey)?1:(isPush?0.85:0));
 const L3=(a,b,k)=>a+(b-a)*k;
 const HB=['haL','i1L','i2L','i3L','m1L','m2L','m3L','r1L','r2L','r3L','p1L','p2L','p3L','t1L','t2L'];
 const pre={};for(const k of HB)pre[k]=p[k].slice();
 const preUA=p.uaL.slice(), preFA=p.faL.slice();
 p.uaL=[0.9432+mv*0.05+runK*0.02-crT*0.10+sw*0.10*mv+ib+swExL-tk*0.40,0.2111-tk*0.10,0.048-tk*0.06];
 p.faL=[2.2753-sw*0.08*mv-runK*0.02+crT*0.10+swExL*0.6+tk*0.45,0.0102,0.2504+tk*0.06];
 fpHand(p,'L',3.06,0.12,-1.3043+tk*0.30,0.1469-tk*0.08,[-0.0991+tk*0.28+ib*1.5,0,0]);
 /* the thumb by the button — in the same blend (the F impulse finishes the press) */
 p.t1L=GRIP_THUMB[0].slice();p.t2L=GRIP_THUMB[1].slice();
 if(gK<0.999){
  for(const k of HB){const a=pre[k],b2=p[k];p[k]=[L3(a[0],b2[0],gK),L3(a[1],b2[1],gK),L3(a[2],b2[2],gK)];}
  p.uaL=[L3(preUA[0],p.uaL[0],gK),L3(preUA[1],p.uaL[1],gK),L3(preUA[2],p.uaL[2],gK)];
  p.faL=[L3(preFA[0],p.faL[0],gK),L3(preFA[1],p.faL[1],gK),L3(preFA[2],p.faL[2],gK)];
 }
}
/* PINCH: key/battery between the pads of the index and thumb (PINCH_POSE
 solved by FK together with GRIP_KEY/GRIP_BATT). Enabled by the st._pinchK
 slew; on push it blends partially. */
if(holdSm){
 const kF=clp(st._pinchK===undefined?1:st._pinchK,0,1)*(1-(isPush?clp(act,0,1)*0.85:0));
 /* fingers keep the pinch even in the pull, but the ARM follows the pull
 (else the pinch stance eats the right-arm E animation: valve, pickup) */
 const kA=kF*((isKey||pkAct)?1-clp(act,0,1):1);
 if(kF>0.001){
  const L3=(a,b,kk)=>a+(b-a)*kk;
  const HB=['haL','i1L','i2L','i3L','m1L','m2L','m3L','r1L','r2L','r3L','p1L','p2L','p3L','t1L','t2L'];
  const pre={};for(const q of HB)pre[q]=p[q].slice();
  const preUA=p.uaL.slice(),preFA=p.faL.slice();
  p.uaL=[0.9432+mv*0.05+runK*0.02-crT*0.10+sw*0.10*mv+ib+swExL-tk*0.40,0.2111-tk*0.10,0.048-tk*0.06];
  p.faL=[2.2753-sw*0.08*mv-runK*0.02+crT*0.10+swExL*0.6+tk*0.45,0.0102,0.2504+tk*0.06];
  p.haL=[PINCH_HA[0]+tk*0.20,PINCH_HA[1]+tk*0.20,PINCH_HA[2]];
  for(const q of HB.slice(1))p[q]=PINCH_POSE[q.slice(0,2)].slice();
  for(const q of HB){const a=pre[q],b2=p[q];p[q]=[L3(a[0],b2[0],kF),L3(a[1],b2[1],kF),L3(a[2],b2[2],kF)];}
  p.uaL=[L3(preUA[0],p.uaL[0],kA),L3(preUA[1],p.uaL[1],kA),L3(preUA[2],p.uaL[2],kA)];
  p.faL=[L3(preFA[0],p.faL[0],kA),L3(preFA[1],p.faL[1],kA),L3(preFA[2],p.faL[2],kA)];
 }
}
/* ================ HELD ITEM / BUTTON / BATTERY SWAP ================
 Priority: battery swap > button press > base stance with the grip. */
{
const flS=st.fl;
const reloading=!!(flS&&flS.rl>0);
const selKind=(st.inv&&st.sel>=0&&st.inv[st.sel])?st.inv[st.sel].kind:null;
const heldKind=reloading?'flash':selKind;
if(!reloading&&heldKind&&!holdSm){
 /* fingers squeeze the item: flashlight — full wrap, small items — lighter */
 const add=heldKind==='flash'?0.0:0.07;   /* the grip is already closed (curl 3.06) */
 for(const f of ['i','m','r','p']){
  if(p[f+'1L'])p[f+'1L'][0]-=add*0.36;
  if(p[f+'2L'])p[f+'2L'][0]-=add*0.44;
  if(p[f+'3L'])p[f+'3L'][0]-=add*0.30;
 }
 if(p.t1L)p.t1L[0]-=add*0.25;
}
if(reloading){
 const u=clp((t-(flS.rlT0||0))/RL_DUR,0,1);
 const K=rlSample(u);
 p.shL=[0,0,0.06];p.shR=[0,0,-0.06];
 p.uaL=K.uaL.slice();p.faL=K.faL.slice();
 p.uaR=K.uaR.slice();p.faR=K.faR.slice();
 gripHand(p,'L',K.wrL,K.cuL,K.spL);
 gripHand(p,'R',K.wrR,K.cuR,K.spR);
 /* CROSSFADE AT THE BORDERS: the u=1 key doesn't equal the grip stance, so on
 the rl-end frame the pose jumped. Key weights 0 at u=0 and u=1, 1 in the
 middle — the pose is continuous with the grip BEFORE and AFTER the swap; the
 battery windows (0.26…0.75) are untouched. */
 const w=sm(clp(u/0.10,0,1))*(1-sm(clp((u-0.90)/0.10,0,1)));
 if(w<0.999){
  const q={};
  fpHand(q,'L',3.06,0.12,-1.3043+tk*0.30,0.1469-tk*0.08,[-0.0991+tk*0.28+ib*1.5,0,0]);
  q.t1L=GRIP_THUMB[0].slice();q.t2L=GRIP_THUMB[1].slice();
  fpHand(q,'R',0.95+runK*0.25+tk*0.10,0.1+tk*1.6,palmY,palmR,[wrist[0],-wrist[1],-wrist[2]]);
  q.shL=[0,0,0.06+tk*0.10];q.shR=[0,0,-0.06-tk*0.10];
  q.uaL=[0.9432+mv*0.05+runK*0.02-crT*0.10+sw*0.10*mv+ib+swExL-tk*0.40,0.2111-tk*0.10,0.048-tk*0.06];
  q.faL=[2.2753-sw*0.08*mv-runK*0.02+crT*0.10+swExL*0.6+tk*0.45,0.0102,0.2504+tk*0.06];
  q.uaR=[uaX-sw*0.10*mv-ib+swExR,0.10+tk*0.10,-uaZ];
  q.faR=[faX+swExR*0.6,-0.10,-faZ];
  const LB=(a,b,k)=>a+(b-a)*k;
  for(const b of ['shL','shR','uaL','faL','uaR','faR',
  'haL','i1L','i2L','i3L','m1L','m2L','m3L','r1L','r2L','r3L','p1L','p2L','p3L','t1L','t2L',
  'haR','i1R','i2R','i3R','m1R','m2R','m3R','r1R','r2R','r3R','p1R','p2R','p3R','t1R','t2R']){
   if(q[b]&&p[b])p[b]=[LB(q[b][0],p[b][0],w),LB(q[b][1],p[b][1],w),LB(q[b][2],p[b][2],w)];
  }
 }
}else if(flS&&heldKind==='flash'&&flS.tgT!==undefined&&flS.tgT>=0){
 /* F — the thumb presses the end button: a forearm jab, the hand pecks, the
 finger pushes the button through and releases (a sin^0.8 impulse) */
 const tu=(t-flS.tgT)/TG_DUR;
 if(tu>=0&&tu<=1){
  const pr2=Math.pow(Math.sin(Math.PI*Math.min(1,tu/0.9)),0.8);
  p.uaL=[p.uaL[0]+0.035*pr2,p.uaL[1],p.uaL[2]];
  p.faL=[p.faL[0]+0.06*pr2,p.faL[1],p.faL[2]-0.03*pr2];
  p.haL=[p.haL[0]-0.10*pr2,p.haL[1],p.haL[2]+0.05*pr2];
  if(p.t1L)p.t1L=[p.t1L[0]-0.34*pr2,p.t1L[1],p.t1L[2]];
  if(p.t2L)p.t2L=[p.t2L[0]-0.44*pr2,p.t2L[1],p.t2L[2]];
 }
}
}
/* item switch (1-4): the right arm goes below the frame with the old item and
 rises with the new one. The dip is applied AFTER all overlays (grips/button)
 so they don't override the lowering. */
if(st.sw){const dip=Math.sin(Math.PI*clp((t-st.sw.t0)/st.sw.dur,0,1));
if(dip>0.001){const L3=(a,b,k)=>a+(b-a)*k;
p.uaL=[L3(p.uaL[0],0.12,dip),L3(p.uaL[1],0.10,dip),L3(p.uaL[2],0.30,dip)];
p.faL=[L3(p.faL[0],1.05,dip),L3(p.faL[1],0.05,dip),L3(p.faL[2],0.10,dip)];}}
return r;
}
/* cheap FK of a bone chain (for arm collisions): returns world matrices */
function fkChain(rig,pose,rootM,names){
const idx=rig.idx,B=rig.B;
const have=names.filter(n=>idx[n]!==undefined);
const need={};for(const n of have){let i=idx[n];while(i!==undefined&&i>=0){need[i]=1;i=B[i].parent;}}
for(let i=0;i<B.length;i++){
 if(!need[i])continue;
 const b=B[i],rt=(pose&&pose[rig.names[i]])||[0,0,0];
 const local=m4mul(m4t(b.off[0],b.off[1],b.off[2]),
  m4mul(m4rotY(rt[1]),m4mul(m4rotX(rt[0]),m4rotZ(rt[2]))));
 b.m=b.parent<0?m4mul(rootM,local):m4mul(B[b.parent].m,local);
}
const o={};for(const n of have)o[n]=B[idx[n]].m;
return o;
}

/* ================ MONITOR GAIT ================
 The same physics as the player's (see GAIT) on his rig. The rig is built
 DIRECTLY IN CELLS (no PL_SCALE): pelvis 0.46, joint M_HIP = 0.41 cells =
 1.2063 m. Walk 8.04 km/h — from equal Froude numbers; K = duty·2π/S: walk
 duty 0.52, S 0.38904, K 8.3983; run duty 0.35, S 0.37401, K 5.8798. Hunched
 silhouette: +0.40 chest pitch and a hump, crown ≈2.9 m (lamp 3.21, ceiling
 3.5). Monster rig conventions: forward = +Z, "thigh forward" = NEGATIVE
 pitch, foot ft: POSITIVE pitch = toe DOWN (opposite of the player). */
const M_PEL_Y=0.52, M_HIP=0.47;                 /* pelvis higher — legs longer */
const M_THLEN=0.26, M_SNLEN=0.22;
const M_HIP_OFF=[0.060,-0.05,0];                /* th offset from pel (×sg on X) */
/* Sole points [z,y] at the ft bone — by the buildRig loft geometry: the heel
 is tall and short, ball/toes low — digitigrade. Claws do NOT enter contact
 (they visually "cut" the floor). */
const M_SOLE_PTS=[[-0.024,-0.030],[0.000,-0.042],[0.030,-0.046],[0.060,-0.049],[0.090,-0.050],[0.110,-0.047]];
const M_SOLE_SX=[-0.026,0,0.026];               /* lateral standoff — as in monFootLowest */
/* Sole contact — the same scheme as the player's soleContact: hA the exact
 minimum, zrel — a softmin against jerks on the roll-over. */
function monSoleContact(phi,roll,yaw){return soleContactGen(phi,roll,yaw,M_SOLE_SX,M_SOLE_PTS,0.006)}
/* Monster 2-bone leg IK — the same law of cosines as the player's legIK, but
 toeAbs is the ABSOLUTE foot pitch (+ = toe down). Returns [th,sn,ftLocal,
 clamped,d]. */
function monLegIK(zf,yd,toeAbs){
const r=legIKGen(zf,yd,M_THLEN,M_SNLEN,M_THLEN+M_SNLEN-0.004,Math.abs(M_THLEN-M_SNLEN)+0.012);
return [r[0],r[1],toeAbs,r[2],r[3]];
}
/* Foot plan on ψ∈[0,2π): ψ=0 — touchdown. bias=0.55 — the foot lands slightly
 ahead of mid (a digitigrade creature reaches with the toe). Pitch signs are
 mirrored vs the player: toe up = NEGATIVE phi. */
function monFootPlan(psi,G,sg){
const TAU=Math.PI*2, arc=G.duty*TAU;
const C=M_HIP-G.hipBase;                        /* pelvis "drop" of this gait */
const b=G.bob*Math.cos(2*psi);                  /* π-periodic pelvis bob (the same sign as the player's) */
let zfC,phi,clearance,u;
if(psi<arc){
 u=psi/arc;
 zfC=G.S*(G.bias-u);                             /* the contact travels back LINEARLY = stands */
 if(u<G.hsEnd)phi=-G.hs*(1-u/G.hsEnd);          /* touchdown: toe slightly up */
 else if(u<0.62)phi=0;                           /* flat support, roll-over */
 else phi=G.po*sm((u-0.62)/0.38);                /* toe push-off (toe down) */
 clearance=0;
}else{
 u=(psi-arc)/(TAU-arc);
 const e=u*u*(3-2*u);
 zfC=-G.S*(1-G.bias)+G.S*(0.22*u+0.78*e);        /* swing forward, leading the touchdown */
 if(u<0.25)phi=G.po-(G.po+G.hs*0.85)*sm(u/0.25);
 else if(u<0.70)phi=-G.hs*0.85;
 else phi=-G.hs*0.85+(-G.hs+G.hs*0.85)*sm((u-0.70)/0.30);
 clearance=G.lift*Math.sin(Math.PI*Math.pow(u,0.80));
}
const c=monSoleContact(phi,G.kneeOut*sg,G.toeOut*sg);
const soleRoot=C+b+clearance;
/* ankle IK target: the contact at zfC, the contact patch at zrel AHEAD of the
 ankle ⇒ the ankle at zfC − zrel. */
return {zf:zfC-c.zrel,zfC:zfC,phi:phi,stance:psi<arc,soleRoot:soleRoot,u:u};
}
/* Monster leg FK (root at origin, WITHOUT dy): ft bone matrices. Offsets —
 from buildRig: pel [0,0.50,0], th [±0.060,−0.05,0], sn [0,−M_THLEN,0], ft [0,−M_SNLEN,0]. */
function monLegFK(pose){
const out={};
const zero=[0,0,0];
const pel=(pose&&pose.pel)||zero;
const Mp=m4mul(m4t(0,M_PEL_Y,0),m4mul(m4rotY(pel[1]),m4mul(m4rotX(pel[0]),m4rotZ(pel[2]))));
for(const s of ['L','R']){
 const sg=s==='L'?1:-1;
 const th=(pose&&pose['th'+s])||zero, sn=(pose&&pose['sn'+s])||zero, ft=(pose&&pose['ft'+s])||zero;
 const Mt=m4mul(Mp,m4mul(m4t(M_HIP_OFF[0]*sg,M_HIP_OFF[1],M_HIP_OFF[2]),
   m4mul(m4rotY(th[1]),m4mul(m4rotX(th[0]),m4rotZ(th[2])))));
 const Ms=m4mul(Mt,m4mul(m4t(0,-M_THLEN,0),
   m4mul(m4rotY(sn[1]),m4mul(m4rotX(sn[0]),m4rotZ(sn[2])))));
 out[s]=m4mul(Ms,m4mul(m4t(0,-M_SNLEN,0),
   m4mul(m4rotY(ft[1]),m4mul(m4rotX(ft[0]),m4rotZ(ft[2])))));
}
return out;
}
/* lowest point of the soles relative to the root (monster) — the player's footLowest analog */
function monFootLowest(pose){
const M=monLegFK(pose);
let lo=1e9;
for(const s of ['L','R']){const F=M[s];
 for(const q of M_SOLE_PTS)for(const sx of M_SOLE_SX){
  const y=F[1]*sx+F[5]*q[1]+F[9]*q[0]+F[13];
  if(y<lo)lo=y;
 }}
return lo;
}
/* Monster gait parameters — derivation in the block header. The numbers are
 NOT free: S and K are bound by the no-slip equation, stride and cadence — by
 the Froude number. */
const MON_GAIT={
walk:{S:0.38904,duty:0.52,bias:0.55,hipBase:0.46,bob:0.0137,hs:0.10,hsEnd:0.20,po:0.30,lift:0.046,
 kneeOut:0.025,toeOut:0.035,lean:0.10,leanOsc:0.012,pelRoll:0.025,pelYaw:0.05,chestBob:0.015,
 armX:0.40,armBack:0.04,armZ:0.13,elbowFix:0.44,armBend:0.30},
run:{S:0.37401,duty:0.35,bias:0.55,hipBase:0.44,bob:0.0182,hs:0.06,hsEnd:0.14,po:0.45,lift:0.075,
 kneeOut:0.035,toeOut:0.03,lean:0.26,leanOsc:0.02,pelRoll:0.03,pelYaw:0.07,chestBob:0.02,
 armX:0.70,armBack:0.08,armZ:0.16,elbowFix:0.85,armBend:0.45,flightCap:0.075}};
function monGaitK(G){ return G.duty*2*Math.PI/G.S; }
const MON_GAIT_K={walk:monGaitK(MON_GAIT.walk),run:monGaitK(MON_GAIT.run)};
/* monster gait pose + root dy (cells). Structure — a copy of the player's
 gaitPoseIK: pelvis → both-leg IK → chest counter-rotation → antiphase arms →
 dy. omega — phase angular speed [rad/s], needed for an honest flight height. */
function monGaitPose(ph,G,omega,extraLean){
const TAU=Math.PI*2;
const psiL=((ph%TAU)+TAU)%TAU;
const psiR=(((ph+Math.PI)%TAU)+TAU)%TAU;
const arc=G.duty*TAU;
const fL=monFootPlan(psiL,G,1),fR=monFootPlan(psiR,G,-1);
const swEnv=fp=>fp.stance?0:Math.sin(Math.PI*fp.u);
const eL=swEnv(fL),eR=swEnv(fR);
const rollA=G.pelRoll*(eR-eL);
const yawA=G.pelYaw*Math.cos(psiL);
/* extraLean — the hunting lean: INSIDE the IK (the pelvis turns the legs; if
 the lean were added after the solve, the feet would ride into the floor by
 centimeters, especially in flight) */
const xl=(extraLean||0);
const pitA=G.lean*0.6+xl*0.6+G.leanOsc*Math.sin(psiL*2+0.6);
const r={};
r.pel=[pitA,yawA,rollA];
const Rp=rotM3(pitA,yawA,rollA);
const hipY=sg=>M_PEL_Y+Rp[3]*(M_HIP_OFF[0]*sg)+Rp[4]*(M_HIP_OFF[1]);
const hipZ=sg=>Rp[6]*(M_HIP_OFF[0]*sg)+Rp[7]*(M_HIP_OFF[1]);
const solveLeg=(f,sg)=>{
 const roll=G.kneeOut*sg+rollA, yaw=G.toeOut*sg+yawA;
 const zfRel=f.zf-hipZ(sg);
 /* MULTI-PASS SOLUTION (the player uses 2 passes): the ankle stop clamps the
 plan pitch hard on push-off (0.45 → σ−0.55), and hA depends on the pitch
 strongly — converge to 1e-5 within ≤8 iterations, else the support foot at
 the flight border sinks 15 mm into the floor. */
 let phi=f.phi,a=null,shinAbs=0,phi2=f.phi;
 for(let it=0;it<8;it++){
  const c=monSoleContact(phi,roll,yaw);
  const ankleY=f.soleRoot+c.hA;
  a=monLegIK(zfRel,hipY(sg)-ankleY,phi);
  shinAbs=a[0]+a[1];
  /* anatomical ankle stop: relative to the shin the foot lives in
 [−0.55 dorsal … +0.95 plantar] (monster's plus = toe down) */
  phi2=clp(f.phi,shinAbs-0.55,shinAbs+0.95);
  if(Math.abs(phi2-phi)<1e-5)break;
  phi=phi2;
 }
 return [a[0]-pitA,a[1],phi2-shinAbs];
};
const ikL=solveLeg(fL,1),ikR=solveLeg(fR,-1);
r.thL=[ikL[0],0,G.kneeOut]; r.snL=[ikL[1],0,0]; r.ftL=[ikL[2],G.toeOut,0];
r.thR=[ikR[0],0,-G.kneeOut]; r.snR=[ikR[1],0,0]; r.ftR=[ikR[2],-G.toeOut,0];
/* chest: counter-rotation against the pelvis + vertical bob (like the player's spn/ch) */
r.ch=[G.lean*0.4+xl*0.4-G.bob*0.35*Math.sin(psiL*2)+G.chestBob*Math.sin(psiL*2+Math.PI*0.5),-yawA*1.5,-rollA*0.55];
/* arms — antiphase to their own legs, the elbow winds up on the forward swing */
const swL=Math.sin(psiL),swR=Math.sin(psiR);
const armF=sw=>[sw*G.armX-G.armBack,-(G.elbowFix+G.armBend*Math.max(0,-sw))];
const aL=armF(swL),aR=armF(swR);
r.uaL=[aL[0],0,G.armZ]; r.faL=[aL[1],0,0.04];
r.uaR=[aR[0],0,-G.armZ]; r.faR=[aR[1],0,-0.04];
/* dy: support — footLowest; flight (duty<0.5) — ballistics, borders continuous.
 Flight height — from vertical velocity continuity at takeoff, but no steeper
 than 3·v per flight window, else at extreme speeds (ω≈22 rad/s) the parabola clicked. */
let flight=0,ftau=0;
if(G.duty<0.5){
 if(psiL>=arc&&psiL<Math.PI){flight=1;ftau=(psiL-arc)/(Math.PI-arc)}
 else if(psiL>=arc+Math.PI){flight=1;ftau=(psiL-arc-Math.PI)/(Math.PI-arc)}
}
let dy;
if(flight){
 const dyBase=-((M_HIP-G.hipBase)+G.bob*Math.cos(2*psiL));
 const vUp=2*(G.bob*CELL_M)*omega*Math.abs(Math.sin(2*arc));
 const Tf=(Math.PI-arc)/Math.max(omega,1e-6);
 const hM=Math.min(vUp*vUp/(2*9.80665),0.75*vUp*Tf);
 dy=dyBase+(hM/CELL_M)*4*ftau*(1-ftau);
}else{
 dy=-monFootLowest(r);
}
r.root=[0,0,0];
r.dy=dy;
r._flight=flight;   /* monPose: recompute dy after the hunting lean if in support */
return r;
}

/* ==== MONITOR: RIG ==== */
function buildRig(){
const B=[];const idx={};const names=[];
const UV=[0.02,0.48,0.02,0.98];
const add=(name,parent,off,V)=>{idx[name]=B.length;names.push(name);
B.push({parent:(typeof parent==='string')?idx[parent]:parent,off,v:new Float32Array(V),n:V.length/9,m:new Float32Array(16)});
return idx[name]};
const AO=(V,a)=>partAO(V,a);
const teeth=(z0,y0,w0)=>partCat(
partAO(partShift(tboxPart(y0-0.020,y0,0.0055,0.0040,0.005,0.0040),-0.030,0,z0),1.0),
partAO(partShift(tboxPart(y0-0.016,y0,0.0050,0.0035,0.005,0.0035),-0.010,0,z0+0.004),1.0),
partAO(partShift(tboxPart(y0-0.016,y0,0.0050,0.0035,0.005,0.0035), 0.010,0,z0+0.004),1.0),
partAO(partShift(tboxPart(y0-0.020,y0,0.0055,0.0040,0.005,0.0040), 0.030,0,z0),1.0));
add('root',-1,[0,0,0],[]);
/* pelvis: iliac crests */
add('pel','root',[0,M_PEL_Y,0],AO(partCat(
loftPart([[-0.085,0,0,0.088,0.068,2.5],[-0.02,0,0,0.104,0.080,2.5],[0.05,0,0,0.098,0.078,2.5],[0.085,0,0,0.080,0.066,2.5]],12,UV,true),
loftPart([[0.02,0.075,-0.01,0.030,0.045,2.2],[0.075,0.088,-0.005,0.024,0.034,2.2]],8,UV,true),
loftPart([[0.02,-0.075,-0.01,0.030,0.045,2.2],[0.075,-0.088,-0.005,0.024,0.034,2.2]],8,UV,true)),0.20));
/* chest: a ribcage with clavicles and a withers hump */
add('ch','pel',[0,0.08,0],AO(partCat(
loftPart([[0.0,0,0,0.096,0.072,2.5],[0.07,0,-0.004,0.128,0.092,2.5],[0.15,0,-0.008,0.138,0.098,2.5],[0.22,0,-0.004,0.112,0.084,2.5],[0.26,0,0,0.078,0.064,2.5]],14,UV,true),
loftPart([[0.20,0.045,-0.055,0.036,0.030,2.2],[0.245,0.055,-0.045,0.028,0.024,2.2]],8,UV,true),
loftPart([[0.20,-0.045,-0.055,0.036,0.030,2.2],[0.245,-0.055,-0.045,0.028,0.024,2.2]],8,UV,true),
loftPart([[0.22,0,0.075,0.055,0.030,2.2],[0.26,0,0.085,0.040,0.024,2.2]],8,UV,true),
/* HUMP on the back (−Z): a hunched creature with withers, not a "model" */
loftPart([[0.150,0,-0.055,0.062,0.048,2.4],[0.210,0,-0.088,0.082,0.062,2.4],[0.265,0,-0.078,0.055,0.042,2.4]],12,UV,true)),0.20));
/* head: a skull with brow ridges, cheekbones and a nape */
add('hd','ch',[0,0.26,0],AO(partCat(
loftPart([[0.02,0,0.01,0.052,0.052,2.6],[0.07,0,0.005,0.062,0.066,2.6],[0.12,0,0,0.064,0.072,2.6],[0.16,0,-0.005,0.052,0.060,2.6],[0.185,0,-0.01,0.032,0.040,2.6]],14,UV,true),
loftPart([[0.095,0,-0.058,0.048,0.014,2.4],[0.115,0,-0.062,0.044,0.012,2.4]],10,UV,true),
loftPart([[0.06,0.052,-0.030,0.016,0.022,2.2],[0.09,0.056,-0.034,0.013,0.018,2.2]],8,UV,true),
loftPart([[0.06,-0.052,-0.030,0.016,0.022,2.2],[0.09,-0.056,-0.034,0.013,0.018,2.2]],8,UV,true),
teeth(0.062,0.048,0)),0.85));
/* jaw: the lower one, with teeth */
add('jaw','hd',[0,0.028,-0.012],AO(partCat(
loftPart([[-0.048,0,0.010,0.040,0.048,2.5],[-0.020,0,0.016,0.046,0.054,2.5],[0.020,0,0.020,0.042,0.050,2.5]],12,UV,true),
partAO(partShift(tboxPart(-0.030,-0.006,0.005,0.0040,0.005,0.0040),-0.026,0,0.070),1.0),
partAO(partShift(tboxPart(-0.034,-0.006,0.005,0.0035,0.005,0.0035),-0.009,0,0.074),1.0),
partAO(partShift(tboxPart(-0.034,-0.006,0.005,0.0035,0.005,0.0035), 0.009,0,0.074),1.0),
partAO(partShift(tboxPart(-0.030,-0.006,0.005,0.0040,0.005,0.0040), 0.026,0,0.070),1.0)),0.80));
/* the rag bone is left empty for pose compatibility: the cloak isn't bound to
 the pelvis — the cloth is built every frame by a verlet mesh
 (skirtSim/skirtBuild) and pinned to the CHEST (the shoulder line). */
add('sk','pel',[0,0.03,0],[]);
/* HAND: wrist, palm with the metacarpal mass, four claw-fingers (the middle
 ones longer, curved down-forward) and an offset thumb claw. AO is assigned
 per piece SEPARATELY — a common partAO(partCat(...)) would overwrite the
 pale-bone claw material. */
const arm=(sg,nm)=>{
add('ua'+nm,'ch',[0.150*sg,0.205,0],AO(partCat(
loftPart([[0.02,0,0,0.048,0.044,2.3],[-0.06,0.004*sg,0,0.044,0.040,2.3],[-0.14,0.002*sg,0,0.036,0.033,2.3],[-0.22,0,0,0.030,0.028,2.3]],10,UV,true),
loftPart([[-0.04,0.010*sg,-0.008,0.030,0.026,2.2],[-0.09,0.012*sg,-0.010,0.026,0.023,2.2]],8,UV,true)),0.20));
const claw=(len,r0,x,y,z,rx,ry,rz,ao)=>partAO(partXf(clawPart(len,r0,7,UV),x,y,z,rx,ry,rz),ao);
add('fa'+nm,'ua'+nm,[0,-0.22,0],partCat(
/* forearm with the elbow */
AO(loftPart([[0.0,0,0,0.032,0.030,2.3],[-0.05,0,-0.006,0.030,0.028,2.3],[-0.12,0,-0.002,0.024,0.022,2.3],[-0.170,0,0,0.021,0.020,2.3]],10,UV,true),0.20),
/* wrist → palm → metacarpus */
AO(loftPart([[-0.170,0,0,0.021,0.020,2.2],[-0.198,0,0.004,0.038,0.027,2.2],[-0.230,0,0.010,0.045,0.031,2.2],[-0.255,0,0.007,0.034,0.024,2.2]],10,UV,true),0.30),
/* four claw-fingers: middles longer, outer ones shorter and splayed */
claw(0.100,0.0150,-0.034,-0.247,0.015,-0.50,-0.14,0,0.78),
claw(0.122,0.0165,-0.0115,-0.252,0.018,-0.56,-0.045,0,0.80),
claw(0.118,0.0165, 0.0115,-0.252,0.018,-0.56, 0.045,0,0.80),
claw(0.096,0.0150, 0.034,-0.247,0.015,-0.50, 0.14,0,0.78),
/* the thumb claw — inward to the palm (the side depends on the hand) */
claw(0.082,0.0180,-0.041*sg,-0.214,0.012,-0.95,0,-0.38*sg,0.72)));
};
arm(1,'L');arm(-1,'R');
/* legs: thigh with the knee, shin with the calf, foot with claws */
const leg=(sg,nm)=>{
add('th'+nm,'pel',[0.060*sg,-0.05,0],AO(loftPart([[0.025,0,0,0.056,0.052,2.3],[-0.104,0,0.004,0.050,0.046,2.3],[-0.208,0,0.006,0.042,0.040,2.3],[-0.26,0,0.004,0.038,0.036,2.3]],10,UV,true),0.20));   /* thigh longer */
add('sn'+nm,'th'+nm,[0,-M_THLEN,0],AO(partCat(
loftPart([[0.0,0,0,0.036,0.036,2.3],[-0.068,0,-0.010,0.038,0.042,2.3],[-0.158,0,-0.002,0.028,0.028,2.3],[-0.22,0,0,0.023,0.024,2.3]],10,UV,true),
loftPart([[-0.026,0,0.022,0.020,0.016,2.2],[-0.092,0,0.028,0.016,0.014,2.2]],8,UV,true)),0.20));   /* shin longer */
add('ft'+nm,'sn'+nm,[0,-M_SNLEN,0],AO(partCat(
loftPart([[-0.02,0,0.010,0.026,0.040,2.4],[-0.045,0,0.045,0.030,0.062,2.4],[-0.05,0,0.085,0.026,0.045,2.4]],10,UV,true),
partAO(partShift(clawPart(0.055,0.011,6,UV),-0.014,-0.048,0.115),0.30),
partAO(partShift(clawPart(0.060,0.011,6,UV),0.0,-0.050,0.125),0.30),
partAO(partShift(clawPart(0.055,0.011,6,UV),0.014,-0.048,0.115),0.30)),0.20));
};
leg(1,'L');leg(-1,'R');
let total=0;for(const b of B)total+=b.n;
return {B,idx,names,total}; }

/* Monitor pose. Legs/pelvis/chest/arm antiphase — the MON_GAIT walk (the same
 IK as the player's). On top — the "character": gaze at the player in the
 hunt, scanning in place, jaw, rags. The root height is written to S.monDY
 (drawWorld builds rootM from it). */
function monPose(S,t){
const chase=S.mMode==='chase';
const run=S.mGait==='run';
const stand=S.mGait==='stand';
const moving=(S.mSpeedNow||0)>0.05&&!stand;
const p=S.mPhase||0, sw=Math.sin(p), cw=Math.cos(p);
/* smooth stance↔gait transition (~0.25 s): no pelvis "click" on start/stop */
const dtm=Math.max(0,Math.min(0.1,t-(S._mgT===undefined?t:S._mgT)));S._mgT=t;
const gkT=moving?1:0;
S._mgK=(S._mgK===undefined)?gkT:(S._mgK+(gkT-S._mgK)*Math.min(1,dtm*7));
const gk=S._mgK;
const L3=(a,b,k)=>[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k];
/* --- gait: legs, pelvis, chest, arm antiphase, root dy --- */
const G=run?MON_GAIT.run:MON_GAIT.walk;
/* the hunting lean is passed into the gait (extraLean) — IK and dy account for it */
const r=monGaitPose(p,G,(S.mSpeedNow||0)*(run?MON_GAIT_K.run:MON_GAIT_K.walk),chase?0.18:0);
const gaitDY=r.dy;
/* --- stance: slow weight transfer between feet, support via IK --- */
const lag=stand?(S.mScanOff||0):0;
const sh=Math.sin(t*0.65)*0.5+0.5;
const stPel=[0.05+Math.sin(t*1.6)*0.012,Math.sin(t*0.7)*0.016,lag*0.14+Math.sin(t*0.5)*0.022];
/* The stance stands at the same pelvis height as the walk (hipBase walk): the
 stance↔step transition doesn't change the monster's height. */
const stHS=MON_GAIT.walk.hipBase;
const stSolve=(sg,dyY)=>{const roll=0.03*sg,yaw=0.035*sg;let phi=-0.02,a=null,shA=0,phi2=phi;
 for(let it=0;it<6;it++){const c=monSoleContact(phi,roll,yaw);
  a=monLegIK(0.02,stHS+dyY-c.hA,phi);shA=a[0]+a[1];
  phi2=clp(phi,shA-0.55,shA+0.95);if(Math.abs(phi2-phi)<1e-5)break;phi=phi2;}
 return [a[0]-stPel[0],a[1],phi2-shA];};
const ikSL=stSolve(1,0.006+0.006*sh), ikSR=stSolve(-1,0.006+0.006*(1-sh));
const stLegs={thL:[ikSL[0],0,0.03],thR:[ikSR[0],0,-0.03],
snL:[ikSL[1],0,0],snR:[ikSR[1],0,0],
ftL:[ikSL[2],0.02,0],ftR:[ikSR[2],-0.02,0]};
const stCh=[0.05+Math.sin(t*2.1)*0.016,Math.sin(t*1.05)*0.014,lag*0.40];
const tr=Math.sin(t*1.15)*0.05;
const stArm={uaL:[-0.42+tr,0,0.30],faL:[-0.95+tr*2,0,0.16],
uaR:[-0.36-tr,0,-0.28],faR:[-0.85-tr*2,0,-0.14]};
let dy=gaitDY;
if(gk<1){
 r.pel=L3(stPel,r.pel,gk);
 r.thL=L3(stLegs.thL,r.thL,gk); r.thR=L3(stLegs.thR,r.thR,gk);
 r.snL=L3(stLegs.snL,r.snL,gk); r.snR=L3(stLegs.snR,r.snR,gk);
 r.ftL=L3(stLegs.ftL,r.ftL,gk); r.ftR=L3(stLegs.ftR,r.ftR,gk);
 r.ch=L3(stCh,r.ch,gk);
 r.uaL=L3(stArm.uaL,r.uaL,gk); r.faL=L3(stArm.faL,r.faL,gk);
 r.uaR=L3(stArm.uaR,r.uaR,gk); r.faR=L3(stArm.faR,r.faR,gk);
}
/* root height ALWAYS from the final pose's floor contact — both in support and
 in the stance↔gait blend (a blend of leg angles is not a blend of heights:
 the feet punched 2–4 cm through the floor). Flight ballistics — only in the
 pure gait at full blend. */
if(!(gk>0.999&&r._flight))dy=-monFootLowest(r);
if(chase){   /* hunt: the arms reach forward, swinging in step rhythm */
 r.uaL=L3(r.uaL,[-1.35+sw*0.20,0,0.18],gk); r.faL=L3(r.faL,[-0.50+sw*0.14,0,0.10],gk);
 r.uaR=L3(r.uaR,[-1.35-cw*0.20,0,-0.18],gk); r.faR=L3(r.faR,[-0.50-cw*0.14,0,-0.10],gk);
}
/* HUNCH: a constant forward chest tilt (the hump is added by geometry on the
 back). The lower gaze is compensated by the head formula (×0.45) — the face
 looks forward-down while the silhouette stays hunched in any gait. */
r.ch[0]+=0.55;   /* hunch: the hump reads in the silhouette */
S.monDY=dy;
/* --- head/jaw/rags: gaze + stabilization against the tilt --- */
let hdYaw,hdPitch,hdRoll=0;
if(chase){
let da=Math.atan2(S.px-S.mx,S.py-S.my)-(S.mYaw||0);
while(da>Math.PI)da-=2*Math.PI;while(da<-Math.PI)da+=2*Math.PI;
hdYaw=Math.max(-0.55,Math.min(0.55,da));
hdPitch=-0.05;
}else if(stand){
const lc=Math.max(-0.95,Math.min(0.95,lag));
hdYaw=lc*1.05+Math.sin(t*1.3)*0.045;
hdPitch=0.09*Math.sin(t*1.7)+(Math.abs(lag)>1.5?-0.09:0.03);
hdRoll=-lc*0.10+Math.sin(t*0.9)*0.028;
}else{
hdYaw=Math.sin(t*0.6)*0.42*(moving?0.45:1);
hdPitch=-0.02+Math.sin(t*1.4)*0.05+(run?0.10:0);
}
hdPitch-=(r.pel[0]+r.ch[0])*0.45;   /* the gaze doesn't dive after the torso (like the player's nk/hd) */
r.hd=[hdPitch, hdYaw, 0.10*Math.sin(t*0.9)*(stand?0.4:1)+(chase?hdYaw*0.18:0)+hdRoll];
r.jaw=[chase?-0.42-0.10*Math.sin(t*9):
(stand?-0.04-0.06*Math.pow(Math.max(0,Math.sin(t*0.8)),8):
-0.05-0.03*Math.sin(t*1.7)),0,0];
/* fast chaotic head twitching (main-menu background): a beat of incommensurate
 sines gives irregular jerks; yaw amplitude ~90° — a "broken neck" probe
 (pitch and roll proportionally smaller) */
if(S.headJerk>0){const jt=t*24,k=S.headJerk;
r.hd=[r.hd[0]+(Math.sin(jt*2.37)*0.57+Math.sin(jt*5.91+1.3)*0.26)*k,
      r.hd[1]+(Math.sin(jt*3.11+0.7)*1.18+Math.sin(jt*8.23+2.0)*0.39)*k,
      r.hd[2]+(Math.sin(jt*4.53+2.1)*0.43+Math.sin(jt*9.7)*0.17)*k];
r.jaw=[-0.32-0.14*Math.sin(jt*6.71),0,0];}
r.sk=[0.08+(moving?cw*0.04:Math.sin(t*0.9)*0.015),0,Math.sin(t*1.7)*(moving?0.05:0.02)];
r.root=[0,0,0];
return r; }

/* ================ MONITOR CLOAK ================
 Pinned to the CHEST (the shoulder line inherits the hunch and withers tilt),
 the back panel reaches mid-shin, the front one is 48% shorter (the cloak is
 open in front — legs read), the hem has a torn deterministic fringe.
 Physics — a verlet mesh of SKIRT_NU×SKIRT_NV nodes, 2 substeps per frame:
 · constraints: column lengths, circumferential rings and BENDING ones across
   two rows — the cloth keeps the panel shape and doesn't fold into an accordion;
 · collisions: chest, withers, pelvis, thighs/shins, both arms and the floor
   (−monDY in the cloth's local frame); on contact the tangential velocity is
   damped — the cloak drapes on the withers and doesn't slide off;
 · damping per second (pow) — frame-rate independent;
 · root inertia: the cloak lags on acceleration, swings in turns.
 Simulation in the root's local frame (yaw removed); vertices are assembled
 into a triangle-list every frame, normals — from neighbor nodes, AO darkens
 toward the hem. */
const SKIRT_NU=20, SKIRT_NV=9;
const SKIRT_TOP=[0.215,-0.014];         /* ring line in ch bone coords [y,z] */
const SKIRT_LEN=0.75;                   /* back-panel drop from the shoulder line */
const SKIRT_FRONT=0.52;                 /* front panel shorter — the cloak is open in front */
/* half-widths slightly narrower at the ring — the ring SITS on the shoulders
 (shoulder 0.150 + arm radius 0.05 = 0.20), not hanging in air 5 cm away. */
const SKIRT_RX=[0.195,0.170,0.156,0.162,0.182];   /* half-widths by row share t (0..1) */
/* Rest depths hug the body: the back panel — over the withers/lower back/
 thighs, the front one is brought to the chest (the collar doesn't stick out). */
const SKIRT_RZK=[0.80,0.68,0.56,0.52,0.45];       /* depth-to-width ratio */
const SKIRT_JAG=(()=>{const o=[];for(let j=0;j<SKIRT_NU;j++){const h=((j*2654435761)>>>0)%997/997;o.push(0.90+0.14*h);}return o;})();
/* SOFT RETURN to the tailored pose (shape-matching), rate in 1/s by rows:
 shoulders/withers hold the fit stiffly, the hem is nearly free — the cloth
 returns after a gust/step instead of staying a "rag". */
const SKIRT_FIT=(()=>{const o=new Float32Array(SKIRT_NV);
for(let i=1;i<SKIRT_NV;i++){const r=26*Math.pow(0.62,i-1);o[i]=i<=3?r:Math.max(0.04,r*0.08);}return o;})();
const SKIRT_LENJ=new Float32Array(SKIRT_NU);               /* column panel length */
const SKIRT_R0=new Float32Array(SKIRT_NU*SKIRT_NV*3);      /* rest positions (chest coordinates) */
const SKIRT_SEGY=new Float32Array(SKIRT_NU*(SKIRT_NV-1));  /* column segment lengths */
const SKIRT_SEGC=new Float32Array(SKIRT_NU*SKIRT_NV);      /* ring segment lengths */
const SKIRT_SEGB=new Float32Array(SKIRT_NU*(SKIRT_NV-2));  /* bending ones (across two rows) */
const SKIRT_VN=SKIRT_NU*(SKIRT_NV-1)*2*3;   /* triangle-list vertices per frame */
(()=>{
const lerpA=(A,t)=>{const x=t*(A.length-1),i=Math.min(A.length-2,x|0),k=x-i;return A[i]+(A[i+1]-A[i])*k;};
for(let j=0;j<SKIRT_NU;j++){
 const a=j/SKIRT_NU*Math.PI*2, ca=Math.cos(a);
 const back=(1-ca)*0.5;                                  /* 0 — front (+Z), 1 — back */
 SKIRT_LENJ[j]=SKIRT_LEN*(SKIRT_FRONT+(1-SKIRT_FRONT)*Math.pow(back,0.8))*SKIRT_JAG[j];
 for(let i=0;i<SKIRT_NV;i++){
  const t=i/(SKIRT_NV-1), o3=(j*SKIRT_NV+i)*3;
  SKIRT_R0[o3]=lerpA(SKIRT_RX,t)*Math.sin(a);
  SKIRT_R0[o3+1]=SKIRT_TOP[0]-SKIRT_LENJ[j]*t;
  /* back panels are swept BACK in an arc (they go around the glutes/thighs
 outside, not rub them): + a constant back offset + an arc hump in the middle */
  /* the arc is TIGHTENED to the body: the cloak hugs the withers and back
 instead of standing like a tent; the front collar is brought to the chest
 (−0.055 forward at the ring). */
  SKIRT_R0[o3+2]=lerpA(SKIRT_RX,t)*lerpA(SKIRT_RZK,t)*ca+SKIRT_TOP[1]
   -0.016*back-0.022*back*Math.sin(Math.PI*t)
   -0.055*(1-back)*Math.max(0,1-1.2*t);
 }
}
const dR=(a,b)=>Math.hypot(SKIRT_R0[a]-SKIRT_R0[b],SKIRT_R0[a+1]-SKIRT_R0[b+1],SKIRT_R0[a+2]-SKIRT_R0[b+2]);
for(let j=0;j<SKIRT_NU;j++){
 const j2=(j+1)%SKIRT_NU;
 for(let i=0;i<SKIRT_NV-1;i++)SKIRT_SEGY[j*(SKIRT_NV-1)+i]=dR((j*SKIRT_NV+i)*3,(j*SKIRT_NV+i+1)*3);
 for(let i=0;i<SKIRT_NV;i++)SKIRT_SEGC[j*SKIRT_NV+i]=dR((j*SKIRT_NV+i)*3,(j2*SKIRT_NV+i)*3);
 for(let i=0;i<SKIRT_NV-2;i++)SKIRT_SEGB[j*(SKIRT_NV-2)+i]=dR((j*SKIRT_NV+i)*3,(j*SKIRT_NV+i+2)*3);
}
})();
function skirtSim(S,dt,pose,rig,yaw){
const K=GPU.skirt, P=K.p, Q=K.q;
if(K.seed!==S.seed){K.init=0;K.seed=S.seed;}   /* new batch — clean cloth */
const dtc=Math.min(0.033,Math.max(0.004,dt));
/* the CHEST matrix in the root's local frame (yaw removed): the cloak pins sit
 on the shoulder line and inherit the hunch/withers tilt. */
const pr=pose.pel||[0,0,0], cr=pose.ch||[0,0,0];
const Mp=m4mul(m4t(0,M_PEL_Y,0),m4mul(m4rotY(pr[1]),m4mul(m4rotX(pr[0]),m4rotZ(pr[2]))));
const Mc=m4mul(Mp,m4mul(m4t(0,0.08,0),m4mul(m4rotY(cr[1]),m4mul(m4rotX(cr[0]),m4rotZ(cr[2])))));
const PIN=K.pin||(K.pin=new Float32Array(SKIRT_NU*3));
for(let j=0;j<SKIRT_NU;j++){
 const o3=(j*SKIRT_NV)*3, p3=j*3;
 const x=SKIRT_R0[o3],y=SKIRT_R0[o3+1],z=SKIRT_R0[o3+2];
 PIN[p3]=Mc[0]*x+Mc[4]*y+Mc[8]*z+Mc[12];
 PIN[p3+1]=Mc[1]*x+Mc[5]*y+Mc[9]*z+Mc[13];
 PIN[p3+2]=Mc[2]*x+Mc[6]*y+Mc[10]*z+Mc[14];
}
/* tailored pose of ALL nodes (the soft-fit target): pins inherit the chest,
 panels hang from them VERTICALLY (by gravity), the section blends from the
 pin ring to the tailored one around the body axis — the panel hugs the
 withers/back/thighs/calves. A rest pose rotating with the chest dragged the
 hem back — the cloak stood up as a cocoon; the vertical gravity cut doesn't argue. */
const RST=K.rest||(K.rest=new Float32Array(SKIRT_NU*SKIRT_NV*3));
for(let j=0;j<SKIRT_NU;j++){
 const r00=(j*SKIRT_NV)*3, p3=j*3;
 const pinX=PIN[p3],pinY=PIN[p3+1],pinZ=PIN[p3+2];
 for(let i2=0;i2<SKIRT_NV;i2++){
  const o3=(j*SKIRT_NV+i2)*3, t=i2/(SKIRT_NV-1);
  /* w: top rows lie on the pin ring (sit on shoulders/withers), bottom ones
 converge to the tailored section around the body axis; + a light A-line offset */
  const w=Math.pow(t,0.85);
  const hx=pinX+(SKIRT_R0[o3]-SKIRT_R0[r00]), hz=pinZ+(SKIRT_R0[o3+2]-SKIRT_R0[r00+2]);
  RST[o3]=hx+(SKIRT_R0[o3]-hx)*w;
  RST[o3+1]=pinY-SKIRT_LENJ[j]*t*0.985;
  RST[o3+2]=hz+(SKIRT_R0[o3+2]-hz)*w+0.04*t*t;
 }
}
/* inertia: world root acceleration → local (turn by -yaw). HEAVY CLOTH — the
 acceleration passes an LPF (τ=0.14 s): cadence jolts, sharp head turns and
 the finite-difference numeric noise never reach the cloth. */
const cy=Math.cos(-yaw), sy=Math.sin(-yaw);
const vx=(S.mx-K.px)/dtc, vz=(S.my-K.pz)/dtc;
if(!K.init){K.px=S.mx;K.pz=S.my;K.vx=vx;K.vz=vz;K.sax=0;K.saz=0;K.wvx=0;K.wvz=0;}
let ax=(vx-K.vx)/dtc, az=(vz-K.vz)/dtc;
const am=Math.hypot(ax,az); if(am>8){ax*=8/am;az*=8/am;}
const kA=1-Math.exp(-dtc/0.14);
K.sax+=(ax-K.sax)*kA; K.saz+=(az-K.saz)*kA;
const lax=(cy*K.sax-sy*K.saz), laz=(sy*K.sax+cy*K.saz);
K.px=S.mx;K.pz=S.my;K.vx=vx;K.vz=vz;
/* Air drag: the quadratic-by-speed flow is SMOOTHED (τ=0.18 s) and weakened
 (0.22) — walk ≈2°, run ≈15°, extreme >40°: the cloak streams but doesn't clap.
 Clamp 6 cl/s — the monster teleport doesn't "explode" the cloth. */
let lvx=cy*vx-sy*vz, lvz=sy*vx+cy*vz;
const lm=Math.hypot(lvx,lvz); if(lm>6){lvx*=6/lm;lvz*=6/lm;}
const kW=1-Math.exp(-dtc/0.18);
K.wvx+=(lvx-K.wvx)*kW; K.wvz+=(lvz-K.wvz)*kW;
const wK=0.22*Math.hypot(K.wvx,K.wvz);
const wndX=-K.wvx*wK, wndZ=-K.wvz*wK;   /* wnd* names — not to be confused with wx/wz of the capsule block below */
/* collision capsules in the local frame — torso, withers, pelvis, both legs
 WHOLE and both arms (shoulder→elbow→forearm). Bone matrices are world, after
 this frame's skinRig. */
const caps=[];
const cY=Math.cos(yaw), sY=Math.sin(yaw);
const toLp=(x,y,z,out3)=>{const X=x-S.mx, Y=y-(S.monDY||0), Z=z-S.my;
 out3[0]=cY*X-sY*Z; out3[1]=Y; out3[2]=sY*X+cY*Z;};
const A=[0,0,0],Bb=[0,0,0],W0=[0,0,0],W1=[0,0,0];
const BI=n=>rig.B[rig.idx[n]].m;
const off=(m,x,y,z,out3)=>{out3[0]=m[0]*x+m[4]*y+m[8]*z+m[12];out3[1]=m[1]*x+m[5]*y+m[9]*z+m[13];out3[2]=m[2]*x+m[6]*y+m[10]*z+m[14];};
const capP=(p0,p1,r)=>{toLp(p0[0],p0[1],p0[2],A);toLp(p1[0],p1[1],p1[2],Bb);
 caps.push(A[0],A[1],A[2],Bb[0],Bb[1],Bb[2],r);};
const capM=(ma,mb,r)=>capP([ma[12],ma[13],ma[14]],[mb[12],mb[13],mb[14]],r);
const mCh=BI('ch'),mHd=BI('hd'),mPel=BI('pel');
capM(mCh,mHd,0.130);
off(mCh,0,0.150,-0.058,W0); off(mCh,0,0.245,-0.086,W1); capP(W0,W1,0.078);
off(mPel,0,-0.075,0,W0); capP([mPel[12],mPel[13],mPel[14]],W0,0.095);
for(const n of ['L','R']){
 const mTh=BI('th'+n),mSn=BI('sn'+n),mFt=BI('ft'+n),mUa=BI('ua'+n),mFa=BI('fa'+n);
 capM(mTh,mSn,0.064); capM(mSn,mFt,0.056);
 capM(mUa,mFa,0.052);
 off(mFa,0,-0.19,0,W0); capP([mFa[12],mFa[13],mFa[14]],W0,0.042);
}
if(!K.init){   /* first frame: the columns HANG from the pins in the tailored pose RST and
 the fit target is RST, so the start is click-free */
 for(let j=0;j<SKIRT_NU;j++){
  for(let i2=0;i2<SKIRT_NV;i2++){
   const o3=(j*SKIRT_NV+i2)*3;
   P[o3]=RST[o3];P[o3+1]=RST[o3+1];P[o3+2]=RST[o3+2];
   Q[o3]=P[o3];Q[o3+1]=P[o3+1];Q[o3+2]=P[o3+2];
  }
 }
 K.init=1;
}
/* Verlet integration, 2 substeps per frame; damping per second (frame-rate
 independent); gravity honest: 9.81 m/s² = 3.34 cells. HEAVY CLOTH + AIR:
 linear damping 0.055/s plus quadratic drag — in verlet increments
 d·(damp − CDR·|d|), |d| = |v|·h (the term is stable). */
const SUB=2, h=dtc/SUB, h2=h*h;
const damp=Math.pow(0.055,h);
const CDR=1.5;
/* per-substep fit coefficient (frame-rate independent) */
const FITK=K.fk||(K.fk=new Float32Array(SKIRT_NV));
for(let i2=0;i2<SKIRT_NV;i2++)FITK[i2]=1-Math.exp(-SKIRT_FIT[i2]*h);
const g=-3.34;
const floorY=-(S.monDY||0)+0.010;   /* the real floor in the cloth's local frame */
for(let s2=0;s2<SUB;s2++){
 for(let j=0;j<SKIRT_NU;j++)for(let i2=1;i2<SKIRT_NV;i2++){
  const o3=(j*SKIRT_NV+i2)*3;
  const px=P[o3],py=P[o3+1],pz=P[o3+2];
  /* verlet increment with quadratic air drag */
  const dxv=px-Q[o3], dyv=py-Q[o3+1], dzv=pz-Q[o3+2];
  const sp=Math.sqrt(dxv*dxv+dyv*dyv+dzv*dzv);
  const kv=damp-CDR*sp>0?damp-CDR*sp:0;
  P[o3]=px+dxv*kv+(-lax*0.85+wndX)*h2;
  P[o3+1]=py+dyv*kv+g*h2;
  P[o3+2]=pz+dzv*kv+(-laz*0.85+wndZ)*h2;
  /* soft landing to the tailored pose: damps the wobble and returns the panel
 onto the figure after a gust/step; the collisions below have the last word. */
  const kF=FITK[i2];
  if(kF>0){P[o3]+=(RST[o3]-P[o3])*kF;P[o3+1]+=(RST[o3+1]-P[o3+1])*kF;P[o3+2]+=(RST[o3+2]-P[o3+2])*kF;}
  Q[o3]=px;Q[o3+1]=py;Q[o3+2]=pz;
 }
 for(let j=0;j<SKIRT_NU;j++){const o3=(j*SKIRT_NV)*3, p3=j*3;
  P[o3]=PIN[p3];P[o3+1]=PIN[p3+1];P[o3+2]=PIN[p3+2];
  Q[o3]=P[o3];Q[o3+1]=P[o3+1];Q[o3+2]=P[o3+2];
 }
 /* constraints + collisions, 4 iterations */
 for(let it=0;it<4;it++){
  for(let j=0;j<SKIRT_NU;j++){
   /* columns: structural segments (the pin doesn't move — the whole fix goes down) */
   for(let i2=0;i2<SKIRT_NV-1;i2++){
    const a3=(j*SKIRT_NV+i2)*3, b3=a3+3;
    const dx=P[b3]-P[a3],dy=P[b3+1]-P[a3+1],dz=P[b3+2]-P[a3+2];
    const d=Math.hypot(dx,dy,dz)||1e-6, rest=SKIRT_SEGY[j*(SKIRT_NV-1)+i2];
    const kf=(d-rest)/d;
    const wa=i2===0?0:0.42, wb=i2===0?1:0.58;
    P[a3]+=dx*kf*wa;P[a3+1]+=dy*kf*wa;P[a3+2]+=dz*kf*wa;
    P[b3]-=dx*kf*wb;P[b3+1]-=dy*kf*wb;P[b3+2]-=dz*kf*wb;
   }
   /* BENDING across two rows — the panel keeps shape, doesn't crumple into an accordion */
   /* stiffer: the panel holds its plane, less "raggedness" */
   for(let i2=0;i2<SKIRT_NV-2;i2++){
    const a3=(j*SKIRT_NV+i2)*3, b3=a3+6;
    const dx=P[b3]-P[a3],dy=P[b3+1]-P[a3+1],dz=P[b3+2]-P[a3+2];
    const d=Math.hypot(dx,dy,dz)||1e-6, rest=SKIRT_SEGB[j*(SKIRT_NV-2)+i2];
    const kf=(d-rest)/d*0.22;
    const wa=i2===0?0:0.5, wb=i2===0?1:0.5;
    P[a3]+=dx*kf*wa;P[a3+1]+=dy*kf*wa;P[a3+2]+=dz*kf*wa;
    P[b3]-=dx*kf*wb;P[b3+1]-=dy*kf*wb;P[b3+2]-=dz*kf*wb;
   }
   /* circumferential rings (the pinned row doesn't participate) */
   const j2=(j+1)%SKIRT_NU;
   for(let i2=1;i2<SKIRT_NV;i2++){
    const a3=(j*SKIRT_NV+i2)*3, b3=(j2*SKIRT_NV+i2)*3;
    const dx=P[b3]-P[a3],dy=P[b3+1]-P[a3+1],dz=P[b3+2]-P[a3+2];
    const d=Math.hypot(dx,dy,dz)||1e-6, rest=SKIRT_SEGC[j*SKIRT_NV+i2];
    const kf=(d-rest)/d*0.30;
    P[a3]+=dx*kf;P[a3+1]+=dy*kf;P[a3+2]+=dz*kf;
    P[b3]-=dx*kf;P[b3+1]-=dy*kf;P[b3+2]-=dz*kf;
   }
  }
  /* collisions: figure capsules and the floor; WITH FRICTION (the tangential
 velocity is damped): the cloak stays on the shoulders/withers, doesn't slide off */
  for(let j=0;j<SKIRT_NU;j++)for(let i2=1;i2<SKIRT_NV;i2++){
   const o3=(j*SKIRT_NV+i2)*3;
   for(let c2=0;c2<caps.length;c2+=7){
    const ax=caps[c2],ay=caps[c2+1],az=caps[c2+2];
    const ex=caps[c2+3]-ax,ey=caps[c2+4]-ay,ez=caps[c2+5]-az;
    const wx=P[o3]-ax,wy=P[o3+1]-ay,wz=P[o3+2]-az;
    const cc=ex*ex+ey*ey+ez*ez||1e-6;
    let tt=(wx*ex+wy*ey+wz*ez)/cc; tt=tt<0?0:(tt>1?1:tt);
    const qx=wx-ex*tt,qy=wy-ey*tt,qz=wz-ez*tt;
    const dd=Math.hypot(qx,qy,qz), rr=caps[c2+6];
    if(dd<rr&&dd>1e-6){
     const k=(rr-dd)/dd;
     P[o3]+=qx*k;P[o3+1]+=qy*k;P[o3+2]+=qz*k;
     const nx=qx/dd,ny=qy/dd,nz=qz/dd;
     const vx2=P[o3]-Q[o3],vy2=P[o3+1]-Q[o3+1],vz2=P[o3+2]-Q[o3+2];
     const vn=vx2*nx+vy2*ny+vz2*nz;
     Q[o3]+=(vx2-nx*vn)*0.05;Q[o3+1]+=(vy2-ny*vn)*0.05;Q[o3+2]+=(vz2-nz*vn)*0.05;
    }
   }
   if(P[o3+1]<floorY){P[o3+1]=floorY;
    Q[o3]+=(P[o3]-Q[o3])*0.30;Q[o3+2]+=(P[o3+2]-Q[o3+2])*0.30;}
  }
 }
}
return 0; }
function skirtBuild(rig){
/* triangle-list vertices from the nodes; normals — from neighbor nodes over
 the mesh. AO darkens toward the hem — folds of the panel's lower part read as depth. */
const K=GPU.skirt,P=K.p,out=GPU.skirtArr;
let o=0;
const at=(j,i2)=>((j%SKIRT_NU+SKIRT_NU)%SKIRT_NU)*SKIRT_NV+(i2<0?0:(i2>SKIRT_NV-1?SKIRT_NV-1:i2));
const NRM=new Float32Array(SKIRT_NU*SKIRT_NV*3);
for(let j=0;j<SKIRT_NU;j++)for(let i2=0;i2<SKIRT_NV;i2++){
 const a3=at(j,i2)*3,b3=at(j+1,i2)*3,c3=at(j-1,i2)*3,d3=at(j,i2+1)*3,e3=at(j,i2-1)*3;
 const ux=P[b3]-P[c3],uy=P[b3+1]-P[c3+1],uz=P[b3+2]-P[c3+2];
 const vx2=P[d3]-P[e3],vy2=P[d3+1]-P[e3+1],vz2=P[d3+2]-P[e3+2];
 let nx=uy*vz2-uz*vy2, ny=uz*vx2-ux*vz2, nz=ux*vy2-uy*vx2;
 const l=Math.hypot(nx,ny,nz)||1;
 const o3=at(j,i2)*3;
 nx/=l;ny/=l;nz/=l;
 /* outward from the cloak axis (else the cloth would light "from inside") */
 const rx=P[o3],rz=P[o3+2];
 const rl=Math.hypot(rx,rz)||1e-6;
 if(nx*(rx/rl)+nz*(rz/rl)<0){nx=-nx;ny=-ny;nz=-nz;}
 NRM[o3]=nx;NRM[o3+1]=ny;NRM[o3+2]=nz;
}
const push=(j,i2)=>{const a3=at(j,i2)*3;
 out[o++]=P[a3];out[o++]=P[a3+1];out[o++]=P[a3+2];
 out[o++]=0.02+(0.48-0.02)*(j/SKIRT_NU); out[o++]=0.02+(0.98-0.02)*(i2/(SKIRT_NV-1));
 out[o++]=NRM[a3];out[o++]=NRM[a3+1];out[o++]=NRM[a3+2]; out[o++]=0.34-0.12*(i2/(SKIRT_NV-1));};
for(let j=0;j<SKIRT_NU;j++)for(let i2=0;i2<SKIRT_NV-1;i2++){
 push(j,i2);push(j+1,i2);push(j+1,i2+1);
 push(j,i2);push(j+1,i2+1);push(j,i2+1);
}
return o/9; }
/* skeleton capsules for the shadow map: player + Monitor. Radii — 0.85 of the
 visible ones so the self-shadow doesn't "eat" the lit side of the body.
 offA — segment start offset from the bone (the hand from the wrist). The
 monster capsules stand AFTER the player's — nMon/nPl fix the order: the
 flashlight slot takes the monster and props, but not the player body. */
function collectShadowCaps(S,bodyP,mPose,rootM){
const out=[];
const K=0.85;
const cap=(M,a,b,r,offB,offA)=>{const A=M[a];if(!A)return;
 const ox=A[12],oy=A[13],oz=A[14];
 let Ax=ox,Ay=oy,Az=oz;
 if(offA){Ax+=A[0]*offA[0]+A[4]*offA[1]+A[8]*offA[2];
      Ay+=A[1]*offA[0]+A[5]*offA[1]+A[9]*offA[2];
      Az+=A[2]*offA[0]+A[6]*offA[1]+A[10]*offA[2];}
 let Bx,By,Bz;
 if(b){const Bm=M[b];if(!Bm)return;Bx=Bm[12];By=Bm[13];Bz=Bm[14];}
 else if(offB){Bx=ox+A[0]*offB[0]+A[4]*offB[1]+A[8]*offB[2];
      By=oy+A[1]*offB[0]+A[5]*offB[1]+A[9]*offB[2];
      Bz=oz+A[2]*offB[0]+A[6]*offB[1]+A[10]*offB[2];}
 else return;
 out.push([Ax,Ay,Az,Bx,By,Bz,r*K]);};
if(mPose&&GPU.rig){
 const MN=['pel','ch','hd','uaL','faL','uaR','faR','thL','snL','ftL','thR','snR','ftR'];
 const M=fkChain(GPU.rig,mPose,rootM,MN);
 cap(M,'pel','ch',0.105); cap(M,'ch','hd',0.100); cap(M,'hd',null,0.062,[0,0.10,0.03]);
 for(const n of ['L','R']){
  cap(M,'ua'+n,'fa'+n,0.040);
  cap(M,'fa'+n,null,0.028,[0,-0.17,0]);                          /* forearm */
  cap(M,'fa'+n,null,0.036,[0,-0.33,0.055],[0,-0.185,0]);         /* palm + claws */
  cap(M,'th'+n,'sn'+n,0.050); cap(M,'sn'+n,'ft'+n,0.038); cap(M,'ft'+n,null,0.034,[0,0,0.10]);
 }
 /* the cloak casts a shadow — vertical capsules along the side and back panels
 (cloth nodes are root-local → world via rootM) */
 if(GPU.skirt&&GPU.skirt.init&&GPU.skirt.p&&rootM){
  const SP=GPU.skirt.p;
  for(const j of [4,8,10,12,16]){
   const a3=(j*SKIRT_NV+1)*3, b3=(j*SKIRT_NV+SKIRT_NV-2)*3;
   const x0=rootM[0]*SP[a3]+rootM[4]*SP[a3+1]+rootM[8]*SP[a3+2]+rootM[12];
   const y0=rootM[1]*SP[a3]+rootM[5]*SP[a3+1]+rootM[9]*SP[a3+2]+rootM[13];
   const z0=rootM[2]*SP[a3]+rootM[6]*SP[a3+1]+rootM[10]*SP[a3+2]+rootM[14];
   const x1=rootM[0]*SP[b3]+rootM[4]*SP[b3+1]+rootM[8]*SP[b3+2]+rootM[12];
   const y1=rootM[1]*SP[b3]+rootM[5]*SP[b3+1]+rootM[9]*SP[b3+2]+rootM[13];
   const z1=rootM[2]*SP[b3]+rootM[6]*SP[b3+1]+rootM[10]*SP[b3+2]+rootM[14];
   out.push([x0,y0,z0,x1,y1,z1,0.062*K]);
  }
 }
}
out.nMon=out.length;   /* monster capsules come first — flashlight shadows take only them */
if(bodyP&&GPU.plRig){
 const bYaw=-((S.pYawVis===undefined?S.ang:S.pYawVis))-Math.PI/2;
 const prm=m4mul(m4t(S.px,bodyP.dy*PL_SCALE,S.py),m4mul(m4rotY(bYaw),m4sc(PL_SCALE)));
 const PN=['pel','ch','nk','hd','uaL','faL','haL','uaR','faR','haR','thL','snL','ftL','thR','snR','ftR'];
 const M=fkChain(GPU.plRig,bodyP.pose,prm,PN);
 const cp=(a,b,r,offB)=>{const A=M[a];if(!A)return;let Bx,By,Bz;
  if(b){const Bm=M[b];if(!Bm)return;Bx=Bm[12];By=Bm[13];Bz=Bm[14];}
  else if(offB){Bx=A[12]+(A[0]*offB[0]+A[4]*offB[1]+A[8]*offB[2])*PL_SCALE;
       By=A[13]+(A[1]*offB[0]+A[5]*offB[1]+A[9]*offB[2])*PL_SCALE;
       Bz=A[14]+(A[2]*offB[0]+A[6]*offB[1]+A[10]*offB[2])*PL_SCALE;}
  else return;
  out.push([A[12],A[13],A[14],Bx,By,Bz,r*PL_SCALE*K]);};
 cp('pel','ch',0.150); cp('ch','nk',0.130); cp('nk','hd',0.085); cp('hd',null,0.095,[0,0.10,0]);
 for(const n of ['L','R']){
  cp('ua'+n,'fa'+n,0.058); cp('fa'+n,'ha'+n,0.046);
  cp('th'+n,'sn'+n,0.085); cp('sn'+n,'ft'+n,0.062);
  cp('ft'+n,null,0.055,[0,0,-0.09]);
 }
}
out.nPl=out.length-out.nMon;
if(out.length<CAPS_MAX-8){
/* Furniture casts shadows: cabinet/table are approximated by capsules over
 the model bounds (local +Z → (wx,wz) "to the wall", +X → (wz,−wx)). */
const cap=(cx,cz,wx,wz,lx0,ly0,lz0,lx1,ly1,lz1,r)=>{ if(out.length>=CAPS_MAX)return;
 out.push([cx+lx0*wz+lz0*wx, ly0, cz-lx0*wx+lz0*wz,
           cx+lx1*wz+lz1*wx, ly1, cz-lx1*wx+lz1*wz, r]); };

for(const c of (S.cabs||[])){
 if(out.length>=CAPS_MAX-8)break;
 const cx=c.x+0.5+c.wx*(0.5-CAB_D/2), cz=c.y+0.5+c.wy*(0.5-CAB_D/2);
 /* the cabinet body is a THIN-WALLED shell, not a solid box: fat capsules
 blocked the opening and shaded into the open drawer. The facade is closed by
 capsules only while the drawer is shut. Every capsule touches the faces only
 from INSIDE: an end sphere poking past the face plane draws a black disc
 shadow (point "inside the occluder" → vis 0). For the closed core the axis is
 shortened to ±0.004 (spheres up to ±0.144); for the open one — the core is
 tangent to the cavity faces, the tube is recessed. */
 const op=c.open||0;
 cap(cx,cz,c.wx,c.wy,-0.161,0.032,0,-0.161,0.290,0,0.009);
 cap(cx,cz,c.wx,c.wy, 0.161,0.032,0, 0.161,0.290,0,0.009);
 cap(cx,cz,c.wx,c.wy,-0.16,0.2935,0,0.16,0.2935,0,0.0085);
 cap(cx,cz,c.wx,c.wy,-0.145,0.029,0,0.145,0.029,0,0.009);
 if(op<0.3){
  /* closed-body core: the cavity is hidden by the drawer, the poke-through is invisible */
  cap(cx,cz,c.wx,c.wy,-0.004,0.16,0.081,0.004,0.16,0.081,0.14);
  cap(cx,cz,c.wx,c.wy,-0.075,0.060,-0.090,-0.075,0.226,-0.090,0.008);
  cap(cx,cz,c.wx,c.wy, 0.000,0.060,-0.090, 0.000,0.226,-0.090,0.008);
  cap(cx,cz,c.wx,c.wy, 0.075,0.060,-0.090, 0.075,0.226,-0.090,0.008);
 }else{
  /* open-drawer core: the tube is tangent to the cavity faces and recessed into
 the back/side — the cavity air is clean, light enters honestly. */
  cap(cx,cz,c.wx,c.wy,-0.046,0.14,0.17,0.046,0.14,0.17,0.098);
  cap(cx,cz,c.wx,c.wy,-0.135,0.14,0.081,0.135,0.14,0.081,0.009);
 }
}
if(S.table&&out.length<CAPS_MAX-16){
 const t=S.table;
 const cx=t.x+0.5+t.wx*(0.5-TBL_D/2), cz=t.y+0.5+t.wy*(0.5-TBL_D/2);
 /* The table is NOT a solid box: thick boxCaps capsules filled the opening
 under the top ("point inside the occluder" → vis 0): a black hole in the
 opening and a blob shadow instead of a silhouette. The top is a chain of
 overlapping spheres INSIDE the slab (they don't pierce the top: sphere up to
 y=0.247 with the top at 0.256), legs — thin tubes inside the section (don't
 pierce the sides). */
 for(let i=0;i<12;i++){
  const lz=-0.11+0.22*(i/11);
  cap(cx,cz,t.wx,t.wy,-0.19,0.236,lz, 0.19,0.236,lz, 0.011);
 }
 for(const lx of[-0.185,0.185])for(const lz of[-0.095,0.095])
  cap(cx,cz,t.wx,t.wy,lx,0.0095,lz, lx,0.24,lz, 0.009);
}
}
return out; }
function doorRig(S){
const mk=(cx,cy,ax,ay)=>{
const l=Math.hypot(ax,ay)||1; ax/=l; ay/=l;
return {x:cx,y:cy,
hx:cx+0.5+0.5*ax+0.5*ay, hz:cy+0.5+0.5*ay-0.5*ax,
yaw:Math.atan2(-ax,-ay), aOpen:-1.60}; };
let df=S.doorFace;
if(!df){
const nb=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>[S.door.x+dx,S.door.y+dy])
.find(q=>q[0]>=0&&q[1]>=0&&q[0]<S.W&&q[1]<S.H&&S.grid[q[1]*S.W+q[0]]===0);
df=nb?{x:nb[0]-S.door.x,y:nb[1]-S.door.y}:{x:1,y:0};
}
const exit=mk(S.door.x,S.door.y,df.x,df.y);

exit.inX=S.door.x-df.x; exit.inY=S.door.y-df.y;
exit.outX=S.door.x+df.x; exit.outY=S.door.y+df.y;
exit.ax=df.x; exit.ay=df.y;
const safe=(S.safeDoors||[]).map(d=>{
const o=mk(d.x,d.y,S.start.x-d.x,S.start.y-d.y);
o.inX=S.start.x;o.inY=S.start.y;
o.outX=2*d.x-S.start.x;o.outY=2*d.y-S.start.y;
o.ax=d.x-S.start.x;o.ay=d.y-S.start.y;
return o;});
for(const D of [exit].concat(safe)){
const l=Math.hypot(D.ax,D.ay)||1;D.ax/=l;D.ay/=l;
D.inL=0;D.inG=0;D.outL=0;D.outG=0;
}
return {exit:exit,safe:safe}; }

function doorSides(S,D){
const W=S.W,H=S.H;
/* the leaf in darkness gets the same SC_FLOOR as the lightmap of open cells,
 multiplied by DOOR_BG_K (= 1: door albedo matches brick, no background
 compensation); lit cells take their own (max). */
const li=(x,y)=>(x<0||y<0||x>=W||y>=H)?SC_FLOOR*DOOR_BG_K:Math.max(SC_FLOOR*DOOR_BG_K,S.light[y*W+x]||0);
const gi=(x,y)=>(x<0||y<0||x>=W||y>=H)?0:((S.gate?S.gate[y*W+x]:0)||0);
D.inL=li(D.inX,D.inY); D.inG=gi(D.inX,D.inY);
D.outL=li(D.outX,D.outY); D.outG=gi(D.outX,D.outY);
return D; }
const sstep=(a,b,x)=>{const t2=(x-a)/(b-a);const u=t2<0?0:(t2>1?1:t2);return u*u*(3-2*u)};

function doorMix(t){ return 1-sstep(0.12,0.85,t); }
function doorModel(D,open01){
const e=open01<0?0:(open01>1?1:open01);
const ee=e*e*(3-2*e);
return m4mul(m4t(D.hx,0,D.hz),m4mul(m4rotY(D.yaw+D.aOpen*ee),m4t(0.5,0,0))); }

/* ==== ENVIRONMENT: puddles, lamp list ==== */
/* puddle map (R8, 4 texels per cell). Puddles generate from the map seed:
 random oblong patches with a noisy edge, on the floor only. Outside puddles
 the mask is strictly 0 — the floor is not a mirror. */
function pudHash(ix,iy,seed){
let h=(ix*374761393+iy*668265263+seed)|0;
h=Math.imul(h^(h>>>13),1274126177);
h=(h^(h>>>16))>>>0;
return (h&0xffff)/65535; }
function pudVnoise(x,y,seed){
const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
const a=pudHash(ix,iy,seed),b=pudHash(ix+1,iy,seed),c=pudHash(ix,iy+1,seed),d=pudHash(ix+1,iy+1,seed);
return a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy; }
function genPuddleMap(S){
const res=4,w=S.W*res,h=S.H*res;   /* the mask is finer (4 tex/cell) — a sharper edge */
const data=new Uint8Array(w*h);
const rnd=xsStream(S.seedState,XS_PUD).rnd;
const puds=[];
const addP=(cx,cy,rx,ry,ang)=>{ puds.push({cx:cx,cy:cy,ca:Math.cos(ang),sa:Math.sin(ang),rx:rx,ry:ry,ph:rnd()*7.0}); };
const openAt=(x,y)=>x>=0&&y>=0&&x<S.W&&y<S.H&&S.grid[y*S.W+x]===0;
/* WATER LOGIC instead of noise: a puddle = condensate from a leaking fixture —
 the center is under the lamp, and it spreads ALONG the corridor (water
doesn't go through walls). The puddle count is proportional to the lamp count
and floor area — no hard cap. */
const corrAng=(x,y)=>{ const hh=openAt(x+1,y)&&openAt(x-1,y), vv=openAt(x,y+1)&&openAt(x,y-1);
if(vv&&!hh)return Math.PI/2;   /* the corridor runs along Y */
if(hh&&!vv)return 0.0;         /* the corridor runs along X */
return rnd()*Math.PI; };       /* room/crossing: free orientation */
for(const L of S.lamps){
if(rnd()>=0.30)continue;                                  /* not every fixture leaks */
const cx=L.x+0.5+(rnd()-0.5)*0.7, cy=L.y+0.5+(rnd()-0.5)*0.7;
const ang=corrAng(L.x|0,L.y|0);
const along=0.45+rnd()*0.45, across=along*(0.45+rnd()*0.25);
addP(cx,cy,along,across,ang);
if(rnd()<0.45){                                          /* a runoff streamlet along the corridor */
const dir=ang+(rnd()<0.5?0:Math.PI);
const dd=along*(1.1+rnd()*1.6);
addP(cx+Math.cos(dir)*dd,cy+Math.sin(dir)*dd,along*(0.5+rnd()*0.5),across*0.7,ang);
}
const ns=rnd()<0.50?1+((rnd()*2)|0):0;                   /* drips along the edge */
for(let s2=0;s2<ns;s2++){
const da=rnd()*Math.PI*2, dd=along*(0.8+rnd()*0.8);
addP(cx+Math.cos(da)*dd,cy+Math.sin(da)*dd,0.18+rnd()*0.26,0.15+rnd()*0.22,rnd()*Math.PI);
}
}
/* background "lowlands": proportional to floor area, no cap */
const nb=Math.round(S.floors.length*0.012);
for(let k=0;k<nb;k++){
const f=S.floors[(rnd()*S.floors.length)|0];
const cx=(f%S.W)+0.5+(rnd()-0.5)*0.6, cy=(((f/S.W)|0))+0.5+(rnd()-0.5)*0.6;
const ang=corrAng(f%S.W,(f/S.W)|0);
const rx=0.40+rnd()*0.65, ry=rx*(0.5+rnd()*0.3);
addP(cx,cy,rx,ry,ang);
if(rnd()<0.35){
const da=ang+(rnd()<0.5?0:Math.PI), dd=rx*(1.0+rnd()*1.2);
addP(cx+Math.cos(da)*dd,cy+Math.sin(da)*dd,rx*0.55,ry*0.55,ang);
}
}
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
const wx=(x+0.5)/res,wy=(y+0.5)/res;
const gx=Math.floor(wx),gy=Math.floor(wy);
if(gx<0||gy<0||gx>=S.W||gy>=S.H)continue;
if(S.grid[gy*S.W+gx]!==0)continue;
let v=0;
for(const p of puds){
const dx=wx-p.cx,dy=wy-p.cy;
const u=(dx*p.ca+dy*p.sa)/p.rx,t=(-dx*p.sa+dy*p.ca)/p.ry;
const d=Math.sqrt(u*u+t*t);
const n=pudVnoise(wx*2.3+p.ph,wy*2.3-p.ph,1234)*0.62+pudVnoise(wx*5.1,wy*5.1,5678)*0.38;
const dd=d+(n-0.45)*0.62;
const s=1-Math.min(1,Math.max(0,(dd-0.70)/0.30));
if(s>v)v=s;
}
if(v>0){const ss=v*v*(3-2*v);data[y*w+x]=(ss*255)|0;}
}
return {w:w,h:h,data:data};
}

let lampScratch=[];   /* reusable entries: on a 100×100 map there are thousands of lamps — per-frame allocation would only feed the GC */
function collectLamps(S,out){
const near=lampScratch,L=S.lamps.length;
while(near.length<L)near.push({l:null,d:0,r:3.2});
near.length=L;
for(let i=0;i<L;i++){const e=near[i],l=S.lamps[i];
e.l=l;e.d=Math.hypot(l.x-S.px,l.y-S.py);e.r=3.2}
near.sort((a,b)=>a.d-b.d);
const n=Math.min(Q.lamps,L);
for(let i=0;i<n;i++){const e=near[i];
out[i*4]=e.l.x+0.5; out[i*4+1]=e.l.y+0.5; out[i*4+2]=e.r; out[i*4+3]=e.l.I*0.85;}
return n; }

const SHW_MAX=512, SH_ROWS_MAX=128;
/* Height angular shadow map (compute csShadow): each lamp's rays go around
 the circle (shSteps columns) AND over elevation (shRows bands). The map
 stores the HORIZONTAL distance to the occluder (r16float; "no occluder" =
 1.0). Blockers: walls (exact entry at the slab border — else lit walls "bite
 themselves"), the door leaf, skeleton, cloak and prop capsules. */
const SH_EL0=1.3523, SH_EL1=0.6545;     /* low/high of the elevation range (rad, low negative) */
const CAPS_MAX=160, SEGS_MAX=16, SHL_MAX=64;
let capsArr=new Float32Array(CAPS_MAX*7);
let segArr=new Float32Array(SEGS_MAX*4);
let lshArr=new Float32Array(SHL_MAX*4+8);   /* lamps + flashlight for csShadow */
/* door leaf (animated) — segments for the shadow map, every frame */
function collectDoorSegs(S,out){
let n=0;
const addLeaf=(D,open)=>{ if(!D||n>=SEGS_MAX)return;   /* the closed leaf too: the segment gives the shadow map the exact sheet plane */
const e=open>1?1:open, ee=e*e*(3-2*e), a=D.yaw+D.aOpen*ee;
/* leaf direction — literally as in the model: m4rotY maps local +X to
 (cos a, −sin a); the +sin sign turned the open-leaf segment into the wall
 behind the hinge — a phantom vertical shadow. */
out[n*4]=D.hx; out[n*4+1]=D.hz;
out[n*4+2]=D.hx+Math.cos(a); out[n*4+3]=D.hz-Math.sin(a); n++; };
addLeaf(GPU.DR&&GPU.DR.exit,S.doorLeafT||0);
if(GPU.DR){const ds=S.doorState,W=S.W;
for(const sd of GPU.DR.safe)addLeaf(sd,ds?ds[sd.y*W+sd.x]:0);}
return n; }
/* map state in one u32 buffer: cell value + the door-open bit.
   Shared by shadows and the irradiance field; built once per frame (~1k cells). */
function collectGridU32(S,out){
const n=S.W*S.H,g=S.grid,ds=S.doorState;
for(let i=0;i<n;i++){const v=g[i];out[i]=(v|((v===3&&ds&&ds[i]>0.5)?4:0))>>>0;}
return n; }

/* Per-cell lamp mask (2×u32 = up to 64 slots): bit i is set if lamp i's light
   radius reaches the cell (2D distance point→cell square). In fsWorld a pixel
   iterates only its cell's bits — the light set is strictly the same: for
   lamps outside the mask dist>L.z at any cell point (3D distance is only
   bigger than 2D). */
function buildCellLightMask(S,lamps,n,out){
out.fill(0);
const W=S.W,H=S.H;
const nn=Math.min(n,64);
for(let i=0;i<nn;i++){
if(lamps[i*4+3]<=0.001)continue;
const lx=lamps[i*4],lz=lamps[i*4+1],R=lamps[i*4+2],R2=R*R;
const x0=Math.max(0,Math.floor(lx-R)),x1=Math.min(W-1,Math.ceil(lx+R));
const y0=Math.max(0,Math.floor(lz-R)),y1=Math.min(H-1,Math.ceil(lz+R));
const bit=1<<(i&31),word=(i>>5)&1;
for(let y=y0;y<=y1;y++){
const dy=y>lz?y-lz:(lz>y+1?y+1-lz:0),dy2=dy*dy;
if(dy2>R2)continue;
const row=(y*W)*2+word;
for(let x=x0;x<=x1;x++){
const dx=x>lx?x-lx:(lx>x+1?x+1-lx:0);
if(dx*dx+dy2<=R2)out[row+x*2]|=bit;
}}}
return out; }

/* Whether at least one puddle cell lies in the frustum (mvp = proj·view,
   column-major). The p-vertex test over 6 planes — conservative: a false
   "yes" merely returns the mirror pass, a false "no" is impossible. */
const FP_PLANES=new Float64Array(24);
function frustumPud(mvp,cells,W){
const g=r=>[mvp[r],mvp[4+r],mvp[8+r],mvp[12+r]];
const r3=g(3),r2=g(2),r0=g(0),r1=g(1);
for(let k=0;k<6;k++){
let a,b,c,d;
/* left/right/bottom/top = row3 ± row0/row1; near = row2; far = row3 − row2 */
if(k===0){a=r3[0]+r0[0];b=r3[1]+r0[1];c=r3[2]+r0[2];d=r3[3]+r0[3];}
else if(k===1){a=r3[0]-r0[0];b=r3[1]-r0[1];c=r3[2]-r0[2];d=r3[3]-r0[3];}
else if(k===2){a=r3[0]+r1[0];b=r3[1]+r1[1];c=r3[2]+r1[2];d=r3[3]+r1[3];}
else if(k===3){a=r3[0]-r1[0];b=r3[1]-r1[1];c=r3[2]-r1[2];d=r3[3]-r1[3];}
else if(k===4){a=r2[0];b=r2[1];c=r2[2];d=r2[3];}
else{a=r3[0]-r2[0];b=r3[1]-r2[1];c=r3[2]-r2[2];d=r3[3]-r2[3];}
const L=Math.hypot(a,b,c)||1;
FP_PLANES[k*4]=a/L;FP_PLANES[k*4+1]=b/L;FP_PLANES[k*4+2]=c/L;FP_PLANES[k*4+3]=d/L;}
for(let i=0;i<cells.length;i++){
const ci=cells[i],gx=ci%W,gy=(ci/W)|0;
const x0=gx,x1=gx+1,y0=-0.02,y1=0.08,z0=gy,z1=gy+1;
let vis=true;
for(let k=0;k<6;k++){
const a=FP_PLANES[k*4],b=FP_PLANES[k*4+1],c=FP_PLANES[k*4+2],d=FP_PLANES[k*4+3];
const px=a>0?x1:x0,py=b>0?y1:y0,pz=c>0?z1:z0;
if(a*px+b*py+c*pz+d<0){vis=false;break}}
if(vis)return true;}
return false; }

/* SHADOW MAP BANDS: "dirty" ones recompute, "clean" ones skip (the f32 buffer
   keeps last frame's distances — identical, since the inputs didn't change).
   A band is dirty if: the lamp/its brightness in the slot changed, any
   occluder position inside its radius changed (capsules, door leaf, map
   state), or the configuration changed (nSH/flashlight/map) — then all are
   dirty. Slot header: 0xFFFFFFFF = clean; else the band's capsule count, then
   their indices — csShadow marches only its band's capsules (before — all
   scene capsules in every thread). The selection predicate is literally the
   shader's early-out (a sphere around the capsule middle of radius
   r+½|B−A|), the list repeats the old traversal. */
const SHAUX_STR=CAPS_MAX+1;
let shAuxArr=new Uint32Array((SHL_MAX+1)*SHAUX_STR);
function capNear(caps,o7,lx,lz,Ri){
const ax=caps[o7],ay=caps[o7+1],az=caps[o7+2],bx=caps[o7+3],by=caps[o7+4],bz=caps[o7+5];
const mx=(ax+bx)*0.5,mz=(az+bz)*0.5;
const crad=caps[o7+6]+0.5*Math.sqrt((bx-ax)*(bx-ax)+(by-ay)*(by-ay)+(bz-az)*(bz-az));
const dx=mx-lx,dz=mz-lz,d2=Math.sqrt(dx*dx+dz*dz);
return d2<=Ri+crad&&d2>=1e-4; }
function buildShadowAux(S,nSH,fshSlot,cn,nMonC,propsStartC,segN,shW,shRowsQ,flO,flI,lamps,gridU32,ncell){
const aux=shAuxArr;
const flOn=fshSlot>=0;
const nSlots=nSH+(flOn?1:0);
let st=GPU.shTrack;
if(!st||st.seed!==S.seed||st.W!==S.W||st.H!==S.H||st.nSH!==nSH||st.flOn!==flOn||
   st.shW!==shW||st.shRowsQ!==shRowsQ||st.grid.length!==ncell){
st=GPU.shTrack={seed:S.seed,W:S.W,H:S.H,nSH:nSH,flOn:flOn,shW:shW,shRowsQ:shRowsQ,
 lampKey:new Float32Array(SHL_MAX*3),flKey:new Float32Array(4),flSet:false,
 caps:new Float32Array(CAPS_MAX*7),cn:0,nMon:0,propsStart:0,
 seg:new Float32Array(SEGS_MAX*4),segN:0,grid:new Uint32Array(ncell),first:true};}
const allDirty=st.first;
/* world/door geometry/capsule structure — any difference dirties all bands */
let geoDirty=allDirty;
if(!geoDirty){
if(st.cn!==cn||st.nMon!==nMonC||st.propsStart!==propsStartC||st.segN!==segN)geoDirty=true;
else{for(let i=0;i<ncell;i++)if(st.grid[i]!==gridU32[i]){geoDirty=true;break}
if(!geoDirty)for(let i=0,n=segN*4;i<n;i++)if(st.seg[i]!==segArr[i]){geoDirty=true;break}}}
/* changed capsules (indices) — dirty only the bands they reach
   (old OR new position inside Ri+crad — as in the shader) */
let chA=null,chN=0;
if(!geoDirty&&!allDirty){
chA=buildShadowAux._ch||(buildShadowAux._ch=new Int32Array(CAPS_MAX));
for(let c=0;c<cn;c++){const o7=c*7;
let diff=false;
for(let k=0;k<7;k++)if(st.caps[o7+k]!==capsArr[o7+k]){diff=true;break}
if(diff)chA[chN++]=c;}}
for(let s=0;s<nSlots;s++){
const isFl=flOn&&s===fshSlot;
let lx,lz,Ri,I;
if(isFl){lx=flO[0];lz=flO[2];Ri=FL_RANGE;I=flI;}
else{lx=lamps[s*4];lz=lamps[s*4+1];Ri=lamps[s*4+2]>0.05?lamps[s*4+2]:LAMP_R;I=lamps[s*4+3];}
let dirty=geoDirty;
if(!dirty){
if(isFl){const k=st.flKey;dirty=!st.flSet||k[0]!==flO[0]||k[1]!==flO[1]||k[2]!==flO[2]||k[3]!==flI;}
else{const o=s*3,k=st.lampKey;dirty=k[o]!==lx||k[o+1]!==lz||k[o+2]!==I;}}
if(!dirty&&chN){
for(let q=0;q<chN;q++){const c=chA[q],o7=c*7;
if(capNear(capsArr,o7,lx,lz,Ri)||capNear(st.caps,o7,lx,lz,Ri)){dirty=true;break}}}
const base=s*SHAUX_STR;
if(!dirty){aux[base]=0xFFFFFFFF;continue;}
let n=0;
for(let c=0;c<cn&&n<CAPS_MAX;c++){
if(capNear(capsArr,c*7,lx,lz,Ri))aux[base+1+n++]=c;}
aux[base]=n;}
/* save the current as the previous */
for(let s=0;s<nSH;s++){const o=s*3;st.lampKey[o]=lamps[s*4];st.lampKey[o+1]=lamps[s*4+1];st.lampKey[o+2]=lamps[s*4+3];}
if(flOn){st.flKey[0]=flO[0];st.flKey[1]=flO[1];st.flKey[2]=flO[2];st.flKey[3]=flI;st.flSet=true;}
st.caps.set(capsArr.subarray(0,cn*7));st.cn=cn;st.nMon=nMonC;st.propsStart=propsStartC;
st.seg.set(segArr.subarray(0,segN*4));st.segN=segN;
st.grid.set(gridU32.subarray(0,ncell));
st.first=false;
return nSlots*SHAUX_STR; }


const WGS_HELPERS=`
fn sstep(a:f32,b:f32,x:f32)->f32{ let t=clamp((x-a)/(b-a),0.0,1.0); return t*t*(3.0-2.0*t); }
fn dhash21(p:vec2<f32>)->f32{ return fract(sin(dot(p,vec2<f32>(12.9898,78.233)))*43758.5453); }
`;

/* common uniform block for all fullscreen/instance passes (one per pipeline) */
const WGS_PP=`
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
/* In WGSL textureSample (implicit LOD) is allowed only in uniform control
flow, so we use explicit variants everywhere: Level for single-level textures
and Grad with pre-taken gradients — for the mipmapped atlas. */
fn sL(t:texture_2d<f32>,s:sampler,uv:vec2<f32>)->vec4<f32>{return textureSampleLevel(t,s,uv,0.0);}
fn sD(t:texture_depth_2d,s:sampler,uv:vec2<f32>)->f32{return textureSampleLevel(t,s,uv,0);}
struct VF{ @builtin(position) pos:vec4<f32>, @location(0) uv:vec2<f32> };
@vertex fn vsFull(@location(0) aP:vec2<f32>)->VF{
var o:VF; o.uv=vec2<f32>(0.5+0.5*aP.x,0.5-0.5*aP.y); o.pos=vec4<f32>(aP,0.0,1.0); return o; }
`;

/* ==== COMPUTE SHADERS ==== */
/* Skinning: bone FK matrices are computed by the CPU (the gameplay needs
them: shadow capsules, held item, eyes, camera height), the GPU transforms
vertices — one thread per vertex. A hidden bone doesn't delete vertices but
collapses them to a point: the triangle degenerates and isn't rasterized —
the buffer layout stays constant. */
const NB_MAX=64;   /* the player rig has 52 bones — with room to spare */
const WGS_SKIN=`
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

/* Irradiance field (lightmap): lamp light diffuses over open cells (6 Jacobi
iterations) + the flashlight spot is injected bilinearly over 4 cells —
indirect light bends around corners. The field is world-space: wall
brightness doesn't change with camera rotation. The finale writes the
lightmap (rgba8). */
const WGS_LM=`
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
 else if((grid[i]&3u)==3u){ lv=max(lv,P.v0.w); }   /* niche jambs take the background from the closed door cell (the faces bias
the sample into it) — without the floor the niche is black */
 let gv=grid[i]; let v=gv&3u;
 let wB=select(0.0,1.0,(v==1u||v==2u||(v==3u&&(gv&4u)==0u)));
 textureStore(outLM,vec2<i32>(x,y),vec4<f32>(clamp(lv,0.0,1.0),clamp(lg[i*2+1],0.0,1.0),wB,1.0)); }`;

/* Shadow map on GPU: one thread per texel (column = azimuth, row = the
elevation band of its source). Wall march — step Ri/24 with exact slab entry;
door — ray vs leaf segment intersection (with the band's height check);
capsules — rayCapsule. The flashlight tests the monster and props, but NOT
the player. */
const WGS_SHADOW=`
${WGS_PP}
struct Lamps{ l:array<vec4<f32>,${SHL_MAX}>, fl:vec4<f32>, fl2:vec4<f32> };
@group(1) @binding(0) var<storage,read> LP:Lamps;
/* lamp band: CL2[slot*${CAPS_MAX+1}u] — 0xFFFFFFFF = "clean" (the input
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
 let hdr=CL2[slot*${CAPS_MAX+1}u];
 if(hdr==0xFFFFFFFFu){return;}   /* clean band: the buffer holds last frame's distances */
 var lx=0.0; var ly=0.0; var lz=0.0; var Ri=rDef; var srcI=0.0; let isFl=slot>=nLamp;
 if(!isFl){ let L=LP.l[slot]; srcI=L.w; lx=L.x; lz=L.y; ly=lampY;
  if(L.z>0.05){Ri=L.z;} }
 else{ srcI=LP.fl.w; lx=LP.fl.x; ly=LP.fl.y; lz=LP.fl.z; Ri=LP.fl2.x; }
 if(srcI<=0.05){ shOut[g.y*shW+g.x]=1.0; return; }
 let ang=(f32(g.x)+0.5)/f32(shW)*6.2831853;
 let ca=cos(ang); let sa=sin(ang);
 /* --- wall march: fixed step, cell entry — exactly at the slab border --- */
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
    /* the door leaf can stand at the FAR border of the cell (the safe door from
outside): blocking by the near plane would drown the leaf in its own shadow.
The door cell is blocked on exit; the segment gives the exact plane (dep=min). */
    tB=1e9;
    if(abs(ca)>1e-6){ let tx=(select(f32(xi),f32(xi+1),ca>0.0)-lx)/ca; if(tx<tB){tB=tx;} }
    if(abs(sa)>1e-6){ let tz=(select(f32(zi),f32(zi+1),sa>0.0)-lz)/sa; if(tz<tB){tB=tz;} }
    if(tB>1e8){tB=t;}
    if(tB<tE){tB=tE;}
   }
   dep=tB+0.005; break; }
 }
 /* --- door leaf --- */
 var dd2=1e9;
 for(var k=0u;k<nSegs;k=k+1u){
  let ax=segs[k*4u]-lx; let az=segs[k*4u+1u]-lz;
  let ex=segs[k*4u+2u]-segs[k*4u]; let ez=segs[k*4u+3u]-segs[k*4u+1u];
  let det=ex*sa-ez*ca;
  if(det>-1e-6&&det<1e-6){continue;}
  /* t2 — distance ALONG the ray (ca,sa): the numerator sign matters — a sign
error turns the leaf segment behind the source and gives a "mirrored" door shadow */
  let t2=(az*ex-ax*ez)/det; let s2=(ca*az-sa*ax)/det;
  if(s2>=0.0&&s2<=1.0&&t2>0.02&&t2<dd2){dd2=t2;}
 }
 let el=-el0+(f32(rI)+0.5)/f32(shRows)*span;
 let se=sin(el); let ce=cos(el);
 if(dd2<dep){ let h=ly+dd2*tan(el); if(h>0.0&&h<doorH){dep=dd2;} }
 /* --- skeleton, cloak and prop capsules: only from the band's list --- */
 let o=vec3<f32>(lx,ly,lz); let d=vec3<f32>(ce*ca,se,ce*sa);
 for(var k=0u;k<hdr;k=k+1u){
  let c=CL2[slot*${CAPS_MAX+1}u+1u+k];
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

/* r16float does NOT support storage writes in core WebGPU (TEXTURE_BINDING
only): csShadow writes f32 distances to a buffer, csPack packs texel pairs
into u32 (16 bits per texel), then copyBufferToTexture into the r16float map
with a 256-byte row pitch. */
const WGS_PACK=`
${WGS_PP}
@group(1) @binding(0) var<storage,read> src32:array<f32>;
@group(1) @binding(1) var<storage,read_write> dst16:array<u32>;
fn f16pack(x:f32)->u32{
 if(!(x>0.0)){return 0u;}
 if(x>=1.0){return 0x3C00u;}
 let b=bitcast<u32>(x);
 let e=i32((b>>23u)&255u)-112;
 if(e<=0){return 0u;}   /* < 2^-14 — never happens for our distances */
 return (u32(e)<<10u)+(((b>>13u)&1023u)+((b>>12u)&1u));   /* the rounding carry goes into the exponent */
}
@compute @workgroup_size(256)
fn csPack(@builtin(global_invocation_id) g:vec3<u32>){
 let shW=u32(P.v0.x); let rows=u32(P.v0.y); let pitchU=u32(P.v0.z);
 if(g.x>=pitchU*rows){return;}
 let row=g.x/pitchU; let c0=(g.x%pitchU)*2u;
 let base=row*shW;
 var h0=0u; var h1=0u;   /* the row tail up to the pitch — zeros, src32 isn't read */
 if(c0<shW){ h0=f16pack(clamp(src32[base+c0],0.0,1.0)); }
 if(c0+1u<shW){ h1=f16pack(clamp(src32[base+c0+1u],0.0,1.0)); }
 dst16[g.x]=h0|(h1<<16u);
}`;

/* --- procedural surface detail (the sdGlsl analog) --- */
/* ==== WGSL SHADERS ==== */
function sdWgsl(lvl){
const L=lvl|0;
if(L<1)return '';
return `
const BRH_LAT=f32(0.118962);            /* brick row height in cells (CEIL_H/10) */
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
${L>=3?`fn sdFbm(p:vec2<f32>,s:u32)->f32{
return sdNoise(p,s)*0.60+sdNoise(p*2.13+4.7,s+17u)*0.28+sdNoise(p*4.71+9.1,s+31u)*0.12; }
struct SegOut{ d:f32, cp:vec2<f32> };
fn sdSeg(p:vec2<f32>,a:vec2<f32>,b:vec2<f32>)->SegOut{
let pa=p-a; let ba=b-a;
let t=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.0,1.0);
let cp=a+ba*t;
return SegOut(length(p-cp),cp); }
/* Crack vein: a polyline with a random-walk direction; the width breathes
with noise along the length, the edge tears by the same noise, the vein fades
out by the end — the crack reads volumetric, not "marker-drawn". sd — side of
the point relative to the vein (for the chipped lip), cp — nearest vein point. */
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
/* Crack contribution: a moderately dark gap (not blackness), a raised chipped
lip on one side, a gradient for the normal tilt (TBN). */
struct CrackFx{ dark:f32, rough:f32, hgt:f32, tint:vec3<f32>, sgrad:vec2<f32> };
fn sdCrackFx(ch:CrackHit,p:vec2<f32>,aa:f32,dk:f32,rk:f32,gk:f32)->CrackFx{
let core=1.0-sstep(ch.w-aa,ch.w+aa,ch.d);
/* the gap bottom is darker than its walls: extra shadow along the vein center */
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
/* Point on a world-grid brick face: e — face (0 bottom, 1 top, 2 left,
3 right), t — share along it, r — (x0,y0,x1,y1) of the brick. */
fn sdEdgePt(e:i32,t:f32,r:vec4<f32>)->vec2<f32>{
if(e==0){return vec2<f32>(mix(r.x,r.z,t),r.y);}
if(e==1){return vec2<f32>(mix(r.x,r.z,t),r.w);}
if(e==2){return vec2<f32>(r.x,mix(r.y,r.w,t));}
return vec2<f32>(r.z,mix(r.y,r.w,t)); }
/* Split crack: a polyline q0→q1→q2→q3, nodes shifted sideways by the brick
 hash — unlike sdCrackPath (vein wander) it is guaranteed to cross the brick
 through. d — distance, w — gap half-width, sd — side, t — path share. */
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
/* Split contribution: the gap is a volumetric groove, not a line: a lit wall
 of fresh clay on one side, a shadowed wall on the other, a bottom with
 rubble (cav in surfDetail), the piece-edge chamfer down and a contact shadow
 under the overhang. */
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
return fx; }`:''}
struct SDOut{ colMul:vec3<f32>, hgt:f32, rough:f32, sgrad:vec2<f32>, cav:f32, dep:f32 };
fn surfDetail(wp:vec3<f32>,Ng:vec3<f32>,uv0:vec2<f32>,seed:u32)->SDOut{
var colMul=vec3<f32>(1.0); var hgt=0.0; var rough=0.0; var sgrad=vec2<f32>(0.0); var cavO=0.0; var depO=0.0;
/* surface-plane coordinates: floor/ceiling — (x,z), walls — (z,y) or (x,y) */
var p=vec2<f32>(0.0); var wallK=0.0; var ceilK=0.0;
if(abs(Ng.y)>0.5){ p=vec2<f32>(wp.x,wp.z); if(Ng.y<0.0){ceilK=1.0;} }
else{ wallK=1.0; if(abs(Ng.x)>0.5){p=vec2<f32>(wp.z,wp.y);}else{p=vec2<f32>(wp.x,wp.y);} }
let tl=vec2<i32>(floor(p));
let f=p-vec2<f32>(tl);
var dark=0.0; var tint=vec3<f32>(1.0);
/* material zone by atlas square (same borders as matOf):
 0 — brick, 1 — floor concrete, 2 — ceiling; wood and iron don't crack */
var zone=-1;
let qc0=vec2<i32>(floor(clamp(uv0,vec2<f32>(0.0),vec2<f32>(0.9999))*4.0));
if(qc0.y==0){ if(qc0.x==0){zone=0;}else{ if(qc0.x==1){zone=1;} } }
else{ if(qc0.y==1&&qc0.x==0){zone=2;} }
/* pixel footprint in surface coordinates — edge antialiasing */
var dpU=vec2<f32>(0.0); var dpV=vec2<f32>(0.0);
if(abs(Ng.y)>0.5){ dpU=vec2<f32>(gWx.x,gWx.z); dpV=vec2<f32>(gWy.x,gWy.z); }
else{ if(abs(Ng.x)>0.5){ dpU=vec2<f32>(gWx.z,gWx.y); dpV=vec2<f32>(gWy.z,gWy.y); }
else{ dpU=vec2<f32>(gWx.x,gWx.y); dpV=vec2<f32>(gWy.x,gWy.y); } }
let px=max(max(length(dpU),length(dpV)),0.00045);
let aa=max(px*1.15,0.0005);
/* BRICK LATTICE in world coordinates (4 columns × 10 rows per cell, odd rows
 offset by half a brick; parity as in the atlas, where the cell row equals
 9-rowI). The lattice is CONTINUOUS across cell borders: chips, broken bricks
 and veins ride the masonry, not the cell unwrap — no seams.
 bSgn — direction of the atlas-square u-axis along the wall. */
var bSgn=1.0; var bCol=0; var bRow=0; var bOff=0.0;
if(zone==0&&wallK>0.5){
bSgn=select(-1.0,1.0,(Ng.x<-0.5)||(Ng.z>0.5));
bRow=i32(floor(p.y/BRH_LAT));
bOff=select(0.0,0.5,((bRow+1)&1)==1);
bCol=i32(floor(bSgn*p.x*4.0-bOff)); }
/* --- dirt and dust (all levels): the noise is continuous in world
 coordinates, no per-cell offsets — else the tone jumps across the seam --- */
let r0=sdRand(tl,seed+11u);
let n1=${L>=3?'sdFbm(p*1.9,seed+7u)':'sdNoise(p*1.9,seed+7u)'};
let dirt=sstep(0.46,0.86,n1)*(0.26+0.46*sdNoise(p*0.63+2.7,seed+101u));
dark+=dirt*0.60;
tint*=mix(vec3<f32>(1.0),vec3<f32>(1.03,0.95,0.82),clamp(dirt*1.4,0.0,1.0));
${L>=2?`/* --- big streaks --- */
let n2=sdNoise(p*0.85,seed+22u);
let stain=sstep(0.58,0.95,n2)*0.30*(0.40+0.60*sdNoise(p*0.47+8.2,seed+303u));
dark+=stain*0.55;
tint*=mix(vec3<f32>(1.0),vec3<f32>(0.93,0.96,0.88),clamp(stain*2.0,0.0,1.0));
/* spot chips by the grid — concrete and plaster only: on brick the chips sit
 at the masonry lattice corners (below) and never cut the brick across */
if(zone!=0){
let cg=vec2<i32>(floor(p*11.0)); let hs=sdRand(cg,seed+33u);
if(hs>0.90){
let gc=(vec2<f32>(cg)+0.5)*(1.0/11.0);
let rad=0.016+0.020*(hs-0.90)*10.0;
let chip=(1.0-sstep(0.0,rad,length(p-gc)))*0.55;
dark+=chip*0.85; hgt-=chip*0.18; rough+=chip*0.20; } }
/* --- BRICK CHIPS: lattice corners, all four (upper AND lower) ---
 a notch at the seam crossing: a dark cavity with shadow in the depth, a
 bright fresh fracture along the grain, a raised rim, a tilt into the normal. */
if(zone==0&&wallK>0.5){
for(var cy=0;i32(cy)<2;cy=cy+1){
for(var cx=0;i32(cx)<2;cx=cx+1){
/* the chip belongs to the SEAM CROSSING (m,e), not to a brick corner: else
 four neighbor bricks would darken one point fourfold */
let mI=bCol+cx; let eI=bRow+cy;
let ch=sdRand(vec2<i32>(mI,eI),seed+911u);
if(ch<0.22){
let ac=(f32(bCol)+bOff+f32(cx))*0.25;
let pc=vec2<f32>(bSgn*ac,(f32(bRow)+f32(cy))*BRH_LAT);
let dvv=p-pc; let dsp0=length(dvv);
let ang=atan2(dvv.y,dvv.x);
/* torn edge: the radius breathes with angular noise */
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
${L>=3?`/* --- BROKEN BRICK: a whole brick crumbled out of the wall ---
 The world-lattice brick is chosen by its index hash (seed-dependent, doesn't
 repeat face to face). A cavity with a torn edge, rubble grain, two surviving
 corner remnants, a bright fresh-fracture edge and a vein running into the
 masonry. Depth accumulates in hgt — fsWorld darkens the cavity albedo. */
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
/* deep cavity: the brick crumbled through, rubble and shadow inside */
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
/* SHARK CHIP: a piece flaked off the face and fresh clay fracture sticks out,
 like a real brick: a bright matte surface, two chip planes at different
 tilts, pore pits, a contact shadow under the overhanging edge.
 Chip triangle C-A-B: cuts are wavy and jagged, not drafted. */
let sD=sdRand(vec2<i32>(bCol,bRow),seed+9827u);
let sE=sdRand(vec2<i32>(bCol,bRow),seed+9829u);
let sF=sdRand(vec2<i32>(bCol,bRow),seed+9833u);
var C=vec2<f32>(0.0); var A=vec2<f32>(0.0); var B=vec2<f32>(0.0);
if(sD<0.30){
/* family 1: a brick corner; cuts no longer run along the faces — the seed
 tilt breaks the right angle, the cut span is short */
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
/* family 2: a wedge from a random point of a random face, cut angles from the seed */
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
/* three INDEPENDENT jag fields: the big cut wave and the mid chip at each
 edge are their own + the common micrograin — the chip shape is all from the seed */
let jm=(sdNoise(p*215.0+bh*37.0,seed+9311u)-0.5)*0.004;
let jA=(sdNoise(p*23.0+bh*41.0,seed+9337u)-0.5)*0.019
+(sdNoise(p*97.0+bh*17.0,seed+9341u)-0.5)*0.006+jm;
let jB=(sdNoise(p*26.0+bh*53.0+3.7,seed+9343u)-0.5)*0.019
+(sdNoise(p*103.0+bh*23.0+1.3,seed+9349u)-0.5)*0.006+jm*0.8;
let jAB=(sdNoise(p*21.0+bh*67.0+7.1,seed+9371u)-0.5)*0.017
+(sdNoise(p*113.0+bh*31.0+5.9,seed+9391u)-0.5)*0.006+jm;
let Ln1=max(length(eA),1e-5); let Ln2=max(length(eB),1e-5); let Ln3=max(length(eAB),1e-5);
/* signed distance to the three uneven edges: positive inward; the same field
 feeds AO, the edge shadow and the bright jag — everything matches the shape fact */
let dA1=s1*cr1/Ln1+jA; let dB1=s2*cr2/Ln2+jB; let dAB1=s3*cr3/Ln3+jAB;
let Fc=sstep(-aa4,aa4,dA1)*sstep(-aa4,aa4,dB1)*sstep(-aa4,aa4,dAB1);
depO=Fc*0.30;
if(Fc>0.001){
let facM=step(0.0,(p.x-C.x)*mM.y-(p.y-C.y)*mM.x);
let g1=vec2<f32>(sA-0.5,sB-0.5); let g2=vec2<f32>(sC-0.5,sA-0.35);
/* fresh clay is lighter and cleaner than the weathered skin */
dark*=1.0-Fc*0.70;
let pore=sdNoise(p*430.0+bh*71.0,seed+9513u);
let gr2=sdNoise(p*240.0+bh*29.0,seed+9619u);
dark+=Fc*(sstep(0.66,0.80,pore)*0.20+(gr2-0.5)*0.10);
dark+=Fc*(1.0-sstep(0.006,0.026,dAB1))*0.40;   /* shadow under the overhanging edge: reads as depth */
/* the notch back wall is deeper: the small triangle at the chip corner — grey concrete */
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
/* AO in the notch corners: darker right at the chip border */
let dIn=min(dA1,min(dB1,dAB1));
dark+=Fc*(1.0-sstep(0.002,0.010,dIn))*0.22;
tint*=mix(vec3<f32>(1.0),vec3<f32>(1.40,1.27,1.15),Fc*mix(0.78,0.95,facM));
rough+=Fc*0.26;
/* depth grows from the cut edge to the chip center: a tone gradient, the
 fracture-plane tilt and a grainy torn-clay normal — not a decal */
let mMn=mM/max(length(mM),1e-5);
let gpr=clamp(dot(p-C,mMn)/max(length(mM),1e-5),0.0,1.0);
dark+=Fc*gpr*0.30;
let mn1=sdNoise(p*300.0+bh*53.0,seed+9721u); let mn2=sdNoise(p*310.0+bh*61.0,seed+9723u);
hgt-=Fc*(0.45+0.35*gpr);
let deep=C+mM*0.6;
let dvd=deep-p; let ddl=max(length(dvd),1e-5);
/* a concave bowl, like on chips: the normal tilts toward the depth point —
 the notch reads from any angle, not only in parallax */
sgrad+=Fc*(dvd/ddl*1.4+mix(g1,g2,facM)*0.4+vec2<f32>(mn1-0.5,mn2-0.5)*0.9);
/* bright jag on the skin along the cut — by the actual uneven edge:
 a band outside each test face, with a window along its length */
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
/* hairline vein from the chip corner into the masonry */
let fxB=sdCrackFx(sdCrackPath(p,tl,seed+9821u,bh*9.0,C,
bh*6.2831853,0.045+0.04*sA,0.0007+0.0005*sB,2,0.0012,seed),p,aa,0.34,0.14,0.70);
dark+=fxB.dark*(1.0-Fc); rough+=fxB.rough*(1.0-Fc);
hgt+=fxB.hgt*(1.0-Fc); tint*=mix(vec3<f32>(1.0),fxB.tint,1.0-Fc);
sgrad+=fxB.sgrad*(1.0-Fc);
}
}else{
/* --- SPLIT BRICK: a whole block divided by cracks into 2–4 pieces ---
 Not a decal: pieces settle and tilt toward each other (fault shift), the gap
 goes deep with parallax, it has a torn width, rubble grain on the bottom and
 a bright fresh-fracture lip on one side. How many pieces and where the cracks
 go — decided by the world-lattice brick hash (the map seed). */
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
/* 2 pieces — most often, 3 — rarer, 4 — quite rare */
let nP=select(2,select(3,4,k1>=0.87),k1>=0.58);
let aa5=max(px*1.5,0.0007);
/* crack 1: face → opposite face, middle nodes shifted sideways */
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
cavO+=cor1*(1.0-sstep(0.0,ch1.w*0.42,ch1.d))*0.55;   /* rubble on the groove bottom */
let fa1=(k6-0.5)*0.55; let ti1=(k7-0.5)*0.95;
var sd2=-1.0; var v2=vec2<f32>(0.0); var fa2=0.0; var ti2=0.0;
if(nP>=3){
var P2s=vec2<f32>(0.0); var P2e=vec2<f32>(0.0);
if(nP==3){
/* T-joint: a branch from a node of the first crack to a face — three pieces */
P2s=mix(q1a,q2a,step(0.55,k8));
P2e=sdEdgePt(i32(k9*3.99),0.22+0.56*k2,rect);
}else{
/* two crossing cracks — four pieces */
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
/* on the other side of the first crack the branch doesn't cut the brick: its
 side sign is damped there, else the piece border would draw a phantom line */
sd2=mix(-1.0,ch2.sd,step(0.0,ch1.sd*sign(dot(P2e-P2s,v1))));
}else{ sd2=ch2.sd; }
}
/* pieces: a height shift and slab tilt, their own tone and roughness each;
 at the brick edge the contribution fades — the masonry seam doesn't get tinted */
let bw=clamp(min(min(p.x-sx0,sx1-p.x)/0.012,min(p.y-sy0,sy1-p.y)/0.010),0.0,1.0);
let pid=select(0,1,ch1.sd>0.0)+select(0,2,sd2>0.0);
let pt=sdRand(vec2<i32>(bCol*8+pid*2+1,bRow*8-pid),seed+9967u);
let pr=sdRand(vec2<i32>(bCol*8-pid,bRow*8+pid*2+3),seed+9973u);
/* a piece is a slab: its own level (fault in hgt and in the parallax dep),
 its own tilt, tone and roughness; at the brick edge the contribution fades */
let hf=(fa1*ch1.sd+fa2*sd2)*bw;
hgt+=hf*0.50+(pt-0.5)*0.10*bw; depO-=hf*0.70;
sgrad+=(v1*(ti1*ch1.sd)+v2*(ti2*sd2))*bw;
tint*=1.0+(pt-0.5)*0.16*bw;
rough+=(pr-0.5)*0.20*bw;
}
} }
`:''}
`:''}${L>=3?`/* --- CRACKS: three degrees of destruction, all from the map seed —
 weak: shallow hairline cracks and scratches; medium: a deep torn vein with a
 branch; strong: the brick corner crumbled away entirely (a chip with a torn
 edge, a splinter and a vein running into the brick body). Cracks live only
 on brick, floor concrete and ceiling plaster: no veins on wood or iron.
 The gap is not painted black: a moderately dark bottom, a bright chipped lip
 on one side, a torn width and antialiasing by the pixel footprint — else thin
 veins shimmer at distance. */
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
/* brick: veins in the face-surface coordinates — matched to the 4×10 masonry
 (odd rows offset by half a brick) */
let a0=rk3*6.2831853;
let c0=vec2<f32>(0.06+0.88*rk1,0.06+0.88*rk2);
if(sevK==1){
fx=sdFxA(fx,sdCrackFx(sdCrackPath(p,tl,seed+7u,ph,c0,a0,0.050+0.055*rk4,
0.00045+0.00045*rk5,3,0.0009,seed),p,aa,0.34,0.10,0.45));
/* companion scratch: shorter and thinner than the main vein */
fx=sdFxA(fx,sdCrackFx(sdCrackPath(p,tl,seed+1928u,ph+3.1,
vec2<f32>(0.08+0.84*rk5,0.08+0.84*rk6),a0+2.2+(rk6-0.5)*1.4,
0.030+0.030*rk2,0.00035+0.00030*rk4,2,0.0007,seed),p,aa,0.24,0.08,0.30));
}
if(sevK==2){
fx=sdFxA(fx,sdCrackFx(sdCrackPath(p,tl,seed+7u,ph,c0,a0,0.060+0.060*rk4,
0.0011+0.0011*rk5,4,0.0022,seed),p,aa,0.52,0.22,1.00));
${L>=4?`/* the branch leaves the middle of the main vein at an acute angle */
let cB=c0+vec2<f32>(cos(a0),sin(a0))*(0.055+0.05*rk4)*1.6;
fx=sdFxA(fx,sdCrackFx(sdCrackPath(p,tl,seed+3037u,ph+1.7,cB,
a0+select(-1.0,1.0,rk2>0.5)*(0.85+0.5*rk6),0.034+0.030*rk6,
0.0006+0.0005*rk2,2,0.0014,seed),p,aa,0.44,0.16,0.80));`:''}
fx=sdFxA(fx,sdCrackFx(sdCrackPath(p,tl,seed+4049u,ph+4.3,
vec2<f32>(0.07+0.86*rk6,0.07+0.86*rk3),a0+1.1+(rk4-0.5)*1.7,
0.036+0.04*rk2,0.0004+0.0003*rk5,2,0.0008,seed),p,aa,0.28,0.09,0.35));
}
if(sevK==3){
/* strong: one brick corner per cell is crumbled out — which brick and which
 corner, the cell hashes decide; coordinates — the world masonry lattice, the
 same as the corner chips, so the destruction pattern is consistent and
 follows the seed */
let rI=i32(rk4*9.99);
let cW=i32(floor(bSgn*p.x))*4+i32(rk5*3.99);
if(bRow==rI&&bCol==cW){
let kx=select(0.0,1.0,rk6>0.5); let ky=select(0.0,1.0,rk2>0.45);
let cq=vec2<f32>(bSgn*((f32(cW)+bOff+kx)*0.25),(f32(rI)+ky)*BRH_LAT);
let dv=p-cq; let dsp=length(dv);
let angS=atan2(dv.y,dv.x);
/* torn chip edge: the radius is modulated by angular noise */
let rSp=(0.018+0.024*rk3)*(0.66+0.66*sdNoise(
vec2<f32>(angS*2.9+ph*3.0,ph*5.0+1.7),seed+7071u));
   let aa2=max(px*1.7,0.0009);
   let coreSp=1.0-sstep(rSp-aa2,rSp+aa2,dsp);
   let rimSp=sstep(rSp+aa2,rSp*2.1,dsp)*(1.0-sstep(rSp*2.6,rSp*4.0,dsp));
   /* fresh fracture is lighter and warmer than the weathered face; in the depth
 near the corner — shadow, so the chip reads even on a dark brick */
let grain=sdNoise(p*83.0+ph*11.0,seed+8081u);
let fresh=mix(vec3<f32>(1.60,1.44,1.24),vec3<f32>(2.20,2.00,1.72),grain);
let shade=sstep(rSp*0.85,rSp*0.30,dsp);
tint*=mix(vec3<f32>(1.0),fresh,coreSp*(1.0-shade*0.80));
dark+=coreSp*(0.06+0.46*shade)+rimSp*0.20;
rough+=coreSp*0.34+rimSp*0.10;
hgt-=coreSp*0.80+rimSp*0.22;
sgrad+=dv/max(dsp,1e-5)*(coreSp*1.7+rimSp*0.55);
/* a splinter beside the chip */
let dv2=p-(cq+vec2<f32>(cos(angS+2.1),sin(angS+2.1))*rSp*2.4);
let d2s=length(dv2);
let rSp2=rSp*(0.28+0.20*rk1);
let coreS2=1.0-sstep(rSp2-aa2,rSp2+aa2,d2s);
tint*=mix(vec3<f32>(1.0),vec3<f32>(1.55,1.42,1.24),coreS2*0.85);
dark+=coreS2*0.12; rough+=coreS2*0.26; hgt-=coreS2*0.55;
sgrad+=dv2/max(d2s,1e-5)*coreS2*1.1;
/* a deep vein leaves the chip into the brick body */
let dIn=normalize(vec2<f32>((0.5-kx)*0.25+(rk3-0.5)*0.012,(0.5-ky)*0.10));
let aSp=atan2(dIn.y,dIn.x)+(rk5-0.5)*1.1;
fx=sdFxA(fx,sdCrackFx(sdCrackPath(p,tl,seed+5051u,ph+2.3,
cq+vec2<f32>(cos(aSp),sin(aSp))*rSp*0.6,aSp,0.048+0.05*rk6,
0.0013+0.0010*rk1,3,0.0024,seed),p,aa,0.48,0.20,0.95));
}
}
}
if(zone==1&&sevK>0){
/* floor concrete: cracks in cell coordinates, wider and calmer than brick ones */
let a0=rk3*6.2831853;
let c0=vec2<f32>(0.05+0.90*rk1,0.05+0.90*rk2);
if(sevK==1){
fx=sdFxA(fx,sdCrackFx(sdCrackPath(f,tl,seed+7u,ph,c0,a0,0.12+0.14*rk4,
0.0007+0.0006*rk5,4,0.0016,seed),f,aa,0.32,0.10,0.50));
}
if(sevK==2){
fx=sdFxA(fx,sdCrackFx(sdCrackPath(f,tl,seed+7u,ph,c0,a0,0.15+0.16*rk4,
0.0016+0.0014*rk5,5,0.0030,seed),f,aa,0.46,0.18,0.95));
${L>=4?`let cB=c0+vec2<f32>(cos(a0),sin(a0))*(0.15+0.16*rk4)*1.7;
fx=sdFxA(fx,sdCrackFx(sdCrackPath(f,tl,seed+3037u,ph+1.7,cB,
a0+select(-1.0,1.0,rk2>0.5)*(0.80+0.5*rk6),0.09+0.07*rk6,
0.0009+0.0007*rk2,3,0.0020,seed),f,aa,0.40,0.14,0.75));`:''}
}
}
if(zone==2&&sevK>0){
/* ceiling plaster: a sparse hairline net */
fx=sdFxA(fx,sdCrackFx(sdCrackPath(f,tl,seed+7u,ph,
vec2<f32>(0.06+0.88*rk2,0.06+0.88*rk1),rk3*6.2831853,0.09+0.10*rk4,
0.0005+0.00045*rk5,3,0.0012,seed),f,aa,0.26,0.08,0.40));
}
dark+=fx.dark; rough+=fx.rough; hgt+=fx.hgt; tint*=fx.tint; sgrad+=fx.sgrad;
}
/* soot under the ceiling and damp at the floor — walls only */
${L>=4?`if(wallK>0.5){
let soot=sstep(0.30,1.0,wp.y)*(0.30+0.70*sdNoise(vec2<f32>(p.x*2.7,p.y*0.9),seed+44u));
dark+=soot*0.30; tint*=mix(vec3<f32>(1.0),vec3<f32>(0.95,0.94,0.98),clamp(soot*1.6,0.0,1.0));
let damp=sstep(0.36,0.0,wp.y)*(0.35+0.65*sdNoise(p*2.2+3.1,seed+55u));
dark+=damp*0.22; rough-=damp*0.30;
tint*=mix(vec3<f32>(1.0),vec3<f32>(0.90,0.97,0.87),clamp(damp*1.2,0.0,1.0)); }
`:''}/* ring stains on the ceiling (a leak) */
if(ceilK>0.5){
let lc=vec2<f32>(0.22+0.56*sdRand(tl,seed+606u),0.22+0.56*sdRand(tl,seed+707u));
let rr=length(f-lc);
let ring=sstep(0.14,0.185,rr)*(1.0-sstep(0.20,0.27,rr));
let blob=1.0-sstep(0.09,0.30,rr);
let win=sstep(0.0,0.10,f.x)*sstep(0.0,0.10,1.0-f.x)*sstep(0.0,0.10,f.y)*sstep(0.0,0.10,1.0-f.y);
let leak=(ring*0.55+blob*0.45)*(0.35+0.65*r0)*win;   /* fade at the cell edges: the stain isn't cut by the seam */
dark+=leak*0.45; tint*=mix(vec3<f32>(1.0),vec3<f32>(1.06,0.96,0.76),clamp(leak*1.6,0.0,1.0)); }
`:''}${L>=5?`/* --- epic: a fine "cobweb", micro-chips and grain --- */
var rn=1.0-abs(sdNoise(p*6.3,seed+66u)*2.0-1.0); rn=pow(rn,7.0);
var rn2=1.0-abs(sdNoise(p*13.7+4.1,seed+77u)*2.0-1.0); rn2=pow(rn2,9.0);
let craze=clamp(rn*0.55+rn2*0.45,0.0,1.0)*0.85;
dark+=craze*0.35; hgt-=craze*0.22; rough+=craze*0.15;
let mg=sdRand(vec2<i32>(floor(p*23.0)),seed+88u);
tint*=1.0+(mg-0.5)*0.10;
`:''}dark=clamp(dark,0.0,0.90);
colMul=(1.0-dark)*tint;
rough=clamp(rough,-0.45,0.75);
hgt=clamp(hgt,-1.0,0.15);
return SDOut(colMul,hgt,rough,sgrad,cavO,depO);
}
`;
}

const MAT_WGSL=`
/* material properties by atlas square (4×4 grid): x — roughness, y — F0, z — metallic */
fn matOf(uv:vec2<f32>)->vec3<f32>{
let qc=vec2<i32>(floor(clamp(uv,vec2<f32>(0.0),vec2<f32>(0.9999))*4.0));
if(qc.y==0){
if(qc.x==1){return vec3<f32>(0.38,0.045,0.0);}   /* floor: concrete */
if(qc.x==2){return vec3<f32>(0.62,0.05,0.0);}    /* safe door wood */
if(qc.x==0){return vec3<f32>(0.86,0.04,0.0);}    /* brick */
return vec3<f32>(0.90,0.04,0.0);
}
if(qc.y==1){
if(qc.x==1){return vec3<f32>(0.55,0.32,0.30);}   /* door — painted steel: the flashlight specular doesn't bleach the leaf */
if(qc.x==2){return vec3<f32>(0.60,0.30,0.45);}   /* its back: metal under the paint has flaked off in places */
if(qc.x==0){return vec3<f32>(0.94,0.04,0.0);}    /* ceiling */
if(qc.x==3){return vec3<f32>(0.66,0.24,0.78);}   /* forged iron of the door hardware: rougher than polished steel */
return vec3<f32>(0.90,0.04,0.0);
}
if(qc.y==2){
if(qc.x<3){return vec3<f32>(0.60,0.05,0.0);}     /* cabinet veneer */
if(qc.x==3){return vec3<f32>(0.62,0.25,0.20);}   /* painted cast iron of the valve: the cross doesn't mirror */
return vec3<f32>(0.90,0.04,0.0);
}
if(qc.x==3){return vec3<f32>(0.55,0.36,0.85);}    /* table tie steel: brushed, not polished — the flashlight doesn't bleach it into a band */
if(qc.x<3){return vec3<f32>(0.52,0.05,0.0);}      /* table wood */
return vec3<f32>(0.90,0.04,0.0);
}
`;

/* --- world module: vertex + fragment shaders in one module --- */
function wgslWorld(QQ){
const NL=Math.max(1,QQ.lamps|0);
const SD=QQ.sdet|0;
const POM=(QQ.pom|0)>0?(QQ.pom|0):0;
const REF=QQ.pomRef|0;
const TBN=!!QQ.tbn&&!!QQ.normals;
const SPEC=!!QQ.spec;
const PBR=SPEC&&!!QQ.pbr;
const CAV=!!QQ.cav;
const DET=SD>=1;
const NEEDMAT=SPEC;
const SHW=QQ.shSteps|0;
const SHT=QQ.shTaps|0;
/* Shadow-map geometry from the preset: elevation bands, shadow lamps. The
 penumbra width is NOT from the preset — it's physical (contact hardening by
 the blocker distance from the map) and the same everywhere. */
const SHROWS=Math.max(8,Math.min(SH_ROWS_MAX,QQ.shRows|0));
const SHTEXH=64*SHROWS;
const SHL=Math.max(1,Math.min(64,QQ.shLamps|0));
const SPANX=SH_EL0+SH_EL1;
const RT=Math.max(3,QQ.reflTaps|0);
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
/* per-cell lamp bitmask (2×u32): which F.lamps slots reach the cell by
 radius — see buildCellLightMask (CPU) */
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
${DET?sdWgsl(SD):''}
${NEEDMAT?MAT_WGSL:''}
${POM?`
/* parallax occlusion: ray vs height-map intersection by a linear walk (${POM}
 steps) + interpolation. A flat surface (height = 1) is not displaced at all,
 so cell seams don't "ride off". UV is hard-clamped to its atlas square. */
fn pomUv(uv0:vec2<f32>,Vt:vec3<f32>,dAdd:f32)->vec2<f32>{
let qs=vec2<f32>(4.0,4.0);   /* atlas grid 4×4: the POM ray never leaves its tile */
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
${REF?`for(var i=0;i<${REF};i=i+1){
let muv=(puv+cuv)*0.5; let md=(pd+cd)*0.5;
let mh=sA(tHgt,sAtl,clamp(muv,lo,hi)).r-dAdd;
if((1.0-mh)-md>0.0){puv=muv;pd=md;ph=mh;}else{cuv=muv;cd=md;hv=mh;}
}`:''}
let before=(1.0-ph)-pd; let after=(1.0-hv)-cd;
let den=before-after;
var t=0.0; if(den>1e-6){ t=clamp(before/den,0.0,1.0); }
return clamp(mix(puv,cuv,t),lo,hi);
}`:''}
${SHW?`
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
let el=asin(clamp((pw.y-Lpos.y)/max(dist,1e-5),-1.0,1.0));   /* ray elevation source->point */
/* the band coordinate is CONTINUOUS: texel i corresponds at its center to
 rf=i+0.5, so rv below interpolates between bands bilinearly (snapping to a
 texel center would kill the vertical linear filter and stair-step the shadow
 silhouette). */
let rf=clamp((el+${SH_EL0})*${(SHROWS/SPANX).toFixed(6)},0.5,${(SHROWS-0.5).toFixed(1)});
let vLo=(li*${SHROWS}.0+0.5)/${SHTEXH}.0;
let vHi=(li*${SHROWS}.0+${(SHROWS-0.5).toFixed(1)})/${SHTEXH}.0;
let rv=clamp((li*${SHROWS}.0+rf)/${SHTEXH}.0,vLo,vHi);
let dxz=length(d3.xz);   /* the map is horizontal */
/* PHYSICAL PENUMBRA — contact hardening by the blocker distance: the map
 stores the distance to the occluder (bd0), gap = how much farther the point
 is; pen = R_light·gap/bd0, R_light = 0.16 cells — the scatterer radius
 (~47 cm), an honest extended source. At contact the shadow is nearly sharp,
 far away the penumbra grows linearly. The AA floor (1.25 texels + 2 cm)
 keeps the edge from crumbling. One physics for all presets. */
let bd0=sL(tSh,sSh,vec2<f32>(u,rv)).r*RR;
let gap=max(dxz-bd0,0.0);
let penAA=6.2831853*max(dxz,0.05)/${SHW}.0*1.25+0.007;
var pen=max(srcR*gap/max(bd0,0.20),penAA);
var vis=shTap(vec2<f32>(u,rv),dxz,pen,RR);
${SHT>=5?`let fA=1.0/${SHW}.0; let fR=1.0/${SHTEXH}.0;
/* 16-tap disk on all presets: the shadow edge is honestly averaged over the
 column area (fewer taps read as speckles at distance). The radius is never
 below 2 texels: the disk must overlap the map column border. */
let radU=clamp(pen/max(6.2831853*max(dxz,0.05)*fA,1e-6),2.0,12.0)*fA;
let radV=clamp(pen/max(dist*${(SPANX/SHROWS).toFixed(6)},1e-6),1.5,8.0)*fR;
let rot=dhash21(pix)*6.2831853;
var acc=vis*0.24;
for(var k=0;k<16;k=k+1){
 let a=rot+f32(k)*2.3999632;
 let rr2=sqrt((f32(k)+0.5)/16.0);
 acc+=shTap(vec2<f32>(u+cos(a)*rr2*radU,clamp(rv+sin(a)*rr2*radV,vLo,vHi)),dxz,pen,RR)*0.0475;
}
vis=acc;`
:(SHT>=3?`let fA=1.0/${SHW}.0; let fR=1.0/${SHTEXH}.0;
let radU=clamp(pen/max(6.2831853*max(dxz,0.05)*fA,1e-6),2.0,9.0)*fA;
let radV=clamp(pen/max(dist*${(SPANX/SHROWS).toFixed(6)},1e-6),1.5,6.0)*fR;
let rot=dhash21(pix)*6.2831853;
var acc=vis*0.34;
for(var k=0;k<6;k=k+1){
 let a=rot+f32(k)*2.3999632;
 let rr2=sqrt((f32(k)+0.5)/6.0);
 acc+=shTap(vec2<f32>(u+cos(a)*rr2*radU,clamp(rv+sin(a)*rr2*radV,vLo,vHi)),dxz,pen,RR)*0.11;
}
vis=acc;`
:(SHT>1?`let du=clamp(pen/max(6.2831853*max(dxz,0.05)/${SHW}.0,1e-6),2.0,4.0)/${SHW}.0;
vis=vis*0.5+shTap(vec2<f32>(u-du,rv),dxz,pen,RR)*0.25+shTap(vec2<f32>(u+du,rv),dxz,pen,RR)*0.25;`:''))}
return vis; }
fn lampVis(pw:vec3<f32>,Lp:vec4<f32>,li:f32,pix:vec2<f32>)->f32{
return shVisCore(pw,vec3<f32>(Lp.x,${LAMP_Y},Lp.y),Lp.z,li,pix,0.16); }
/* flashlight shadow — the SAME height map as the lamps (the slot in flC.z),
 the source at the beam-head height (a binary lightmap march would eat corners
 and stripe sliding walls). */
fn flShVis(pw:vec3<f32>,pix:vec2<f32>)->f32{
if(F.flC.z<0.0){return 1.0;}
return shVisCore(pw,F.flA.xyz,F.flC.y,F.flC.z,pix,0.05); }
`:''}
/* PLAYER FLASHLIGHT — a spotlight from the hand strictly along the view.
 flA = (position, brightness), flB = (direction, cone-edge cos),
 flC = (core cos, range, shadow slot), flDv = (color). Brightness and flicker
 are computed on the CPU (flA.w); occlusion — the same shadow map as the lamps. */
/* cone profile TOGETHER with the scatter corona: the lens doesn't cut the
 beam hard — beyond the cone edge a wide spill, up close the wall is flooded
 with a spot of soft falloff. On-axis the profile = 1 — the far view doesn't change. */
fn flProf(cs:f32)->f32{
let csm=max(cs,0.0);
let cone=sstep(F.flB.w,F.flC.x,csm);
let ring=0.16*sstep(F.flB.w*0.93,F.flB.w,csm);
let spill=0.58*csm*csm*csm*(1.0-cone);
/* lens and head-ring glow: the lens shines a bit SIDEWAYS and weakly
 back-sideways (cs<0) — the hand and the wall by the flashlight itself are not black. */
let leak=0.12*sstep(-0.25,0.05,cs)*(1.0-cone);
/* a weak omni in all directions (lens/body): behind the player stays a dim
 light, fading with distance like a lamp — no steps. */
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
att*=dist/(dist+0.45);   /* near-rolloff: doesn't bleach point-blank, past 3 m −<13% */
return F.flA.w*att*flProf(cs);
}
/* FLASHLIGHT LIGHT SCATTER: the beam-impact spot is a secondary source,
 flE=(position, brightness), flF=(color, radius), attenuation quadratic toward
 the radius. Without it, close to a wall the hand and beam edges drowned in
 blackness. Occlusion of both sources — the common flashlight shadow map (flShVis). */
fn flBounceAtt(pw:vec3<f32>)->f32{
if(F.flE.w<=0.001){return 0.0;}
let dv=pw-F.flE.xyz;
let dist=length(dv);
if(dist>F.flF.w){return 0.0;}
var a=1.0-dist/F.flF.w; a*=a;
return F.flE.w*a; }
@fragment fn fsWorld(in:VOut)->@location(0) vec4<f32>{
/* derivatives are taken BEFORE any branching: dpdx/dpdy in WGSL are allowed
only in uniform control flow */
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
/* the leaf is drawn without culling: the visible side is ALWAYS the camera one.
On a backface the normal is flipped, else the face takes the other side's light
map and its side-gate kills every real lamp — the leaf reads black in a lit room */
if(uDoorMode>0.5&&dot(Ng,uCam-vW)<0.0){Ng=-Ng;}
/* CELL LAMPS: instead of iterating all F.lamps slots — only those whose light
 radius reaches the pixel's cell (the CPU builds the mask once per frame). For
 a lamp outside the mask dist>L.z at every cell point — the old loop skipped
 it anyway, so the light is identical while iterations are times fewer. */
var litL:array<i32,64>; var nLit=0u;
{
let ci=clamp(vec2<i32>(floor(vW.xz)),vec2<i32>(0),vec2<i32>(uMapSize)-vec2<i32>(1));
let mk=CLT[ci.y*i32(uMapSize.x)+ci.x];
var mw=mk.x;
while(mw!=0u&&nLit<64u){let b=countTrailingZeros(mw);mw=mw&(mw-1u);litL[nLit]=i32(b);nLit=nLit+1u;}
mw=mk.y;
while(mw!=0u&&nLit<64u){let b=countTrailingZeros(mw);mw=mw&(mw-1u);litL[nLit]=i32(b)+32;nLit=nLit+1u;}
}
/* a wall face takes light from the cell IN FRONT of it (offset along the normal) */
var lmP=vW.xz;
if(abs(Ng.y)<0.5){lmP+=Ng.xz*0.5;}
var lms=sL(tLM,sLin,clamp(lmP/uMapSize,vec2<f32>(0.001),vec2<f32>(0.999))).rg;
/* the door leaf is lit by side: the outer face takes the corridor light, the
inner — the room light. Blended by uDoorMix: closed = 1, open = 0. */
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
/* Monitor flesh (rim=1) and the player body (rim=2): albedo from the skin
texture + world-space microrelief from its alpha (height), sweaty specular,
fresnel. */
let V=normalize(uCam-vW);
let sk4=sA(tSkin,sAtl,in.vUV);
let h0=sk4.a;
let hx=sA(tSkin,sAtl,in.vUV+gDx).a-h0;
let hy=sA(tSkin,sAtl,in.vUV+gDy).a-h0;
/* player body materials are defined by the u-zone of the skin atlas:
 skin / jacket / pants / boots / hair — their own roughness, spec and bump. */
var mr=0.40; var ms=0.85; var mb=7.0;
let uu=in.vUV.x;
if(uu>0.700&&uu<0.848){mr=0.88;ms=0.22;mb=5.0;}
else if(uu>=0.848&&uu<0.918){mr=0.92;ms=0.16;mb=4.5;}
else if(uu>=0.918&&uu<0.968){mr=0.48;ms=0.70;mb=6.0;}
else if(uu>=0.968){mr=0.36;ms=1.05;mb=8.0;}
let isP=min(max(uRim-1.0,0.0),1.0);
let vAOx=mix(vAO,1.0,isP);   /* the player doesn't use the bone AO */
let Nb=normalize(Ng-(gWx*hx+gWy*hy)*mix(9.0,mb,isP));
let f=1.0-max(dot(Nb,V),0.0);
let fres=f*f*f;
/* The Monitor is a dark silhouette: desiccated flesh nearly black,
 pale bone (skull/teeth/hands) by the AO mask; the texture modulates both tones. */
let flesh=vec3<f32>(0.036,0.032,0.038)*(0.35+1.15*sk4.rgb);
let bone=vec3<f32>(0.36,0.32,0.26)*(0.50+0.95*sk4.rgb);
let skinM=mix(flesh,bone,sstep(0.50,0.85,vAO));
let skin=mix(skinM,sk4.rgb,isP);
/* the body glows JUST LIKE the world: lightmap ambient + direct lamp light */
col=skin*lms.r*0.20*vAOx;
if(isP>0.5){
/* the character doesn't fall into blackness: a hemispheric fill light +
 a soft camera-side light (the face and hands read in a dark corridor). */
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
if(f32(iL)<${SHL}.5){lvS=lampVis(vW,L,f32(iL),in.clip.xy);}   /* and on the body — an honest shadow */
else{
/* the body isn't lit through walls by distant lamps */
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
/* the flashlight beam lights the body/Monitor as honestly as the lamps —
 that's exactly how he is found in the dark (diffuse + sweaty specular) */
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
/* flashlight spot scatter lights the body/hands: close to a wall the hands
 get soft indirect light. */
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
/* textured world material: not flat color, not emissive, not a door leaf */
let texMat=(uFlat<0.5&&uEmissive<0.5&&uDoorMode<0.5);
/* door leaves (wood and iron): relief (TBN+parallax+cavities) like the world,
 but without wall detail and puddles — the flag is set by JS on leafChunk. */
let dtx=uDoorTex>0.5&&uFlat<0.5&&uEmissive<0.5;
${DET?`var sdDet=SDOut(vec3<f32>(1.0),0.0,0.0,vec2<f32>(0.0),0.0,0.0);
if(texMat){sdDet=surfDetail(vW,Ng,vUV,uSeedI);}`:''}
var uv=vUV;
var N=Ng;
${(TBN||POM)?`var T=vec3<f32>(0.0); var B=vec3<f32>(0.0);
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
}`:''}
${POM?`var uvC=uv; var nmS=vec3<f32>(0.0,0.0,1.0); var hS=0.0;
let Vw0=normalize(uCam-vW);
if((texMat||dtx)&&dot(T,T)>0.5){
let Vt=vec3<f32>(dot(Vw0,T),dot(Vw0,B),dot(Vw0,Ng));
if(Vt.z>0.02){uv=pomUv(vUV,Vt${DET?',sdDet.dep':',0.0'});}
/* The relief side (brick end-face, chip wall) is a steep drop of the height
 by an atlas texel: the POM ray lands in a narrow edge strip, and its color
 stretches down the side in blurred bands. Steep texels take color by the
 unwrapped UV: from the edge up the slope by the point's depth — the texel
 density matches the frontal face. */
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
`:''}
var base=mix(sA(tTex,sAtl,${POM?'uvC':'uv'}).rgb,D.flatCol.xyz,uFlat);
var roughA=0.0;
var cav=1.0;
var rough=0.0; var f0=0.0; var metal=0.0; var specGate=0.0;
${DET?`if(texMat){
let sd=sdDet;
base*=sd.colMul;
base*=mix(1.0,0.86,clamp(-sd.hgt,0.0,1.0));   /* a cavity (chip, broken brick) darkens the albedo */
/* rubble inside the cavity: a multiplier on the base (darker than the
 surface, with grain) — keeps the dirt and environment tone, doesn't pop as a
 bright spot */
base=mix(base,base*vec3<f32>(0.55,0.50,0.43)*(0.55+0.75*sdNoise(vec2<f32>(vW.x*91.0+vW.z*83.0+vW.y*57.0,vW.x*47.0+vW.z*59.0+vW.y*101.0),uSeedI+9513u)),clamp(sd.cav,0.0,1.0)*0.92);
roughA=sd.rough;
${TBN?`if(dot(sd.sgrad,sd.sgrad)>1e-8){
var gW=vec3<f32>(0.0);
if(abs(Ng.y)>0.5){gW=vec3<f32>(sd.sgrad.x,0.0,sd.sgrad.y);}
else{ if(abs(Ng.x)>0.5){gW=vec3<f32>(0.0,sd.sgrad.y,sd.sgrad.x);}else{gW=vec3<f32>(sd.sgrad.x,sd.sgrad.y,0.0);} }
N=normalize(N-gW*uDetN);
}`:''}
}`:''}
${CAV?`if(texMat||dtx){ ${POM?`var hC=0.0; if(dot(T,T)>0.5){hC=hS;}else{hC=sA(tHgt,sAtl,uv).r;}`:`let hC=sA(tHgt,sAtl,uv).r;`} cav=mix(0.70,1.0,clamp(hC,0.0,1.0)); }`:''}
${QQ.normals?`if(uFlat<0.5){
${POM?`var nm=vec3<f32>(0.0,0.0,1.0); if((texMat||dtx)&&dot(T,T)>0.5){nm=nmS;}else{nm=sA(tNrm,sAtl,uv).rgb*2.0-1.0;}`:`let nm=sA(tNrm,sAtl,uv).rgb*2.0-1.0;`}
${TBN?`if(dot(T,T)>0.5){
let nmk=vec3<f32>(nm.xy*(uNrmK*3.2),nm.z);
N=normalize(T*nmk.x+B*nmk.y+N*max(nmk.z,0.05));
}else{ N=normalize(N+nm*uNrmK); }`
:`N=normalize(N+nm*uNrmK);`}
}`:''}
let Vv=normalize(uCam-vW);
/* the shadow edge is clean on all presets: the rotating 16-tap PCF disk
 averages visibility over the angular-map column area; fewer taps quantize
 the edge into visible speckles */
/* PUDDLES. The mask is a separate "puddle map", generated by the seed, floor
only. Water is darker than concrete, specularly flattens the normal + a
living two-scale ripple. The puddle edge is organic: the mask is slightly
warped by procedural noise. */
var pud=0.0;
var wetRim=0.0;
if(texMat&&Ng.y>0.5&&vW.y<0.06){   /* puddles on the floor only: the table and cabinets are always dry */
var pudUv=clamp(vW.xz/uMapSize,vec2<f32>(0.001),vec2<f32>(0.999));
${DET?`pudUv+=(vec2<f32>(sdNoise(vW.xz*7.31+13.7,uSeedI+911u),sdNoise(vW.xz*7.97+71.3,uSeedI+977u))-0.5)*(0.12/uMapSize);`:''}
let praw=sL(tPud,sLin,pudUv).r;
pud=sstep(0.18,0.42,praw);
if(praw>0.004){
let rim=sstep(0.02,0.14,praw)*(1.0-sstep(0.18,0.42,praw));
wetRim=rim;
let depW=clamp((praw-0.18)*2.4,0.0,1.0);            /* water pseudo-depth */
base*=1.0-0.34*rim;                    /* the wet ring is darker than the dry floor */
base*=mix(1.0,mix(0.34,0.20,depW),pud);/* water quenches the diffuse: deeper — darker */
base=mix(base,base*vec3<f32>(0.76,0.88,1.06),pud*(0.45+0.30*depW));   /* a cold tint, denser with depth */
roughA=mix(roughA,0.0,pud);
N=normalize(mix(N,vec3<f32>(0.0,1.0,0.0),0.94*pud));
/* living water: slow swell + fine capillary wave (six waves on epic). The
amplitude grows with depth and dies at the edge — a calm meniscus. */
let wAmp=(0.026+0.040*depW)*pud*sstep(0.20,0.44,praw);
var sl=vec2<f32>(0.0);
sl+=vec2<f32>( 0.62, 0.78)*cos(vW.x*3.10+vW.z*2.20+uTime*1.05)*0.55;
sl+=vec2<f32>(-0.74, 0.31)*cos(vW.x*1.70-vW.z*4.30-uTime*0.78)*0.40;
sl+=vec2<f32>( 0.22,-0.94)*cos(vW.x*5.90+vW.z*1.30+uTime*1.62)*0.30;
sl+=vec2<f32>( 0.91, 0.44)*cos(vW.x*8.70-vW.z*7.10-uTime*2.10)*0.20;
${(QQ.sdet|0)>=5?`sl+=vec2<f32>(-0.53, 0.85)*cos(vW.x*13.30+vW.z*11.70+uTime*2.70)*0.12;
sl+=vec2<f32>( 0.77,-0.64)*cos(vW.x*17.10-vW.z*14.90-uTime*3.15)*0.08;`:''}
N=normalize(N+vec3<f32>(sl.x,0.0,sl.y)*wAmp);
}
}
${PBR?`let mp=matOf(uv);
rough=clamp(mp.x+roughA*0.55,0.06,1.0);
f0=mp.y; metal=mp.z;
/* specular physically exists only for metal, water and wet concrete by puddles */
specGate=max(metal,max(pud,wetRim*0.5));
rough=mix(rough,0.06,pud);   /* mirror-smooth water */
rough=mix(rough,0.26,wetRim*0.55);   /* wet concrete shines wider */
f0=mix(f0,0.021,pud);
f0=mix(f0,0.03,wetRim*0.4);`:''}
${PBR?`col=base*lms.r*0.20*vAO*cav*(1.0-0.55*metal);
{ /* environment fresnel — a weak "film" at grazing angles (metal comes alive) */
var frA=clamp(1.0-max(dot(N,Vv),0.0),0.0,1.0); frA*=frA; frA*=frA*frA;
col+=mix(vec3<f32>(f0),base*0.55+0.45,metal)*frA*lms.r*0.40*vAO*specGate; }`
:`col=base*lms.r*0.20*vAO*cav;`}
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
/* a lamp on the other side of a closed door doesn't light this face */
let ls=dot(vec3<f32>(L.x-vW.x,0.0,L.y-vW.z),uDoorAxis);
var onOut=0.0; if(ls>0.0){onOut=1.0;}
var okf=0.0;
if(abs(sideF-0.5)<0.01){okf=1.0;}else{ if(abs(onOut-sideF)<0.01){okf=1.0;} }
g*=mix(1.0,okf,uDoorMix);
}
if(f32(i)<${SHL}.5){g*=lampVis(vW,L,f32(i),in.clip.xy);}   /* only the nearest lamps cast a shadow — distant ones (att≤2%) wouldn't read it anyway */
else if(g>0.001){
/* Distant lamps (no preset angular map): an honest march with 5 samples over
the lightmap's wall channel (.b). Samples inside the own cell are skipped:
the door leaf stands inside a solid cell and would otherwise shadow itself. */
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
col+=base*L.w*att*(0.22+0.78*nd)*vec3<f32>(1.0,0.90,0.74)*0.80*g*vAO*cav${PBR?'*(1.0-0.72*metal)':''};
/* flat items (flashlight/battery/key in hand, on the table) get an honest
 narrow specular by D.f3.y — dark metal comes alive under lamps */
if(uFlat>0.5&&D.f3.y>0.001){
let Hfl=normalize(Ld+Vv+vec3<f32>(1e-6,1e-6,1e-6));
col+=L.w*att*pow(max(dot(N,Hfl),0.0),96.0)*D.f3.y*1.1*g*vec3<f32>(1.0,0.93,0.82);
}
${PBR?`{
/* honest GGX microfacet: D — distribution, GV — Smith correlated visibility
(exact, especially at grazing angles), F — Schlick fresnel */
let H=normalize(Ld+Vv+vec3<f32>(1e-6,1e-6,1e-6));   /* exclude normalize(0)=NaN */
let nh=max(dot(N,H),0.0);
let nv=max(dot(N,Vv),1e-4);
var A=rough*rough; A*=A;
let DD=A/(3.14159265*pow(nh*nh*(A-1.0)+1.0,2.0)+1e-7);
let GV=2.0/max(nd*sqrt(nv*nv*(1.0-A)+A)+nv*sqrt(nd*nd*(1.0-A)+A),1e-5);
let hv=max(dot(H,Vv),0.0);
let om=1.0-hv; let om2=om*om;
let F0v=mix(vec3<f32>(f0),base*0.55+0.45,metal);
let FF=F0v+(vec3<f32>(1.0)-F0v)*(om2*om2*om);
col+=L.w*att*(DD*GV*nd)*FF*vec3<f32>(1.0,0.93,0.82)*g*vAO*specGate${CAV?'*mix(1.0,cav,0.7)':''};
}`:''}
}
/* FLASHLIGHT — the player spotlight: a cone with a soft edge, distance
 falloff, occlusion by walls/closed doors via march, the door-leaf side gate
 (as with lamps), diffuse + specular by the material branch. */
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
col+=base*flAt*flG*(0.25+0.75*fnd)*fcl*vAO*cav${PBR?'*(1.0-0.72*metal)':''};
${PBR?`{
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
col+=flAt*flG*(DD3*GV3*fnd)*FF3*fcl*specGate${CAV?'*mix(1.0,cav,0.7)':''};
}`:''}
if(uFlat>0.5&&D.f3.y>0.001){
let Hf2=normalize(Lt+Vv+vec3<f32>(1e-6,1e-6,1e-6));
col+=flAt*flG*pow(max(dot(N,Hf2),0.0),96.0)*D.f3.y*1.25*fcl;
}
}
}
/* LIGHT SCATTER: the flashlight spot is a secondary source; corners, edges
 and walls outside the cone near the spot get soft indirect light. */
let bAt=flBounceAtt(vW);
if(bAt>0.001){
/* the spot's indirect light isn't blocked dead by the beam shadow: the floor
 under the table and doorways get a soft fill, the shadow stays deep, not a
 black hole */
let bV=max(flShVis(vW,in.clip.xy),0.30);
if(bV>0.001){
let Lb=normalize(F.flE.xyz-vW+vec3<f32>(1e-5,1e-5,1e-5));
let bnd=max(dot(N,Lb),0.0);
col+=base*bAt*bV*(0.22+0.78*bnd)*F.flF.xyz*vAO*cav${PBR?'*(1.0-0.72*metal)':''};
if(uFlat>0.5&&D.f3.y>0.001){
let Hb2=normalize(Lb+Vv+vec3<f32>(1e-6,1e-6,1e-6));
col+=bAt*bV*pow(max(dot(N,Hb2),0.0),96.0)*D.f3.y*0.9*F.flF.xyz;
}
}
}
/* the puddle reflects the environment without heavy SSR: fresnel by the
grazing angle + ceiling/lamp light from the lightmap. Outside puddles (pud=0)
the contribution is strictly zero. The fresnel is computed from the RIPPLE
(speculars tremble) but anchored to the geometric one (mix 50/50 + min 0.04) —
a puddle cannot "fade into dry floor". */
if(pud>0.004){
let nvv=max(dot(N,Vv),0.0);
let nvv0=max(Vv.y,0.0);
/* NO pow with a base that can go negative from rounding (dot of normalized
vectors gives 1+eps → pow(-eps,5) = NaN, and NaN in an hdr scene poisons the
bloom mips). The 5th power is computed by multiplication with a pre-clamp. */
let oR=clamp(1.0-nvv,0.0,1.0); let oG=clamp(1.0-nvv0,0.0,1.0);
let frR=0.020+0.980*oR*oR*oR*oR*oR;
let frG=0.020+0.980*oG*oG*oG*oG*oG;
let frW=mix(frG,frR,0.5)*0.96+0.04;
col+=frW*pud*(0.025+0.12*lms.r)*vec3<f32>(0.70,0.80,0.95)*vAO;
/* the planar reflection (mirror camera) is taken by the pixel's screen UV —
the scheme is view-angle independent, the reflection cannot "vanish".
The ripple distorts the UV, and the disk blur grows with distance, like on
real water. */
if(uReflOn>0.5){
let ndc=in.vClip.xy/max(in.vClip.w,1e-4);
let ruv0=vec2<f32>(ndc.x*0.5+0.5,0.5-ndc.y*0.5)+N.xz*(0.008+0.026*(1.0-nvv0));
let rdist=distance(uCam,vW);
let rad=0.0010+0.00013*rdist*rdist;
let rot=dhash21(in.clip.xy)*6.2831853;
var rc=sL(tRefl,sLin,clamp(ruv0,vec2<f32>(0.002),vec2<f32>(0.998))).rgb*0.30;
for(var ti=1;ti<${RT};ti=ti+1){
let a=f32(ti)*2.3999632+rot;
let rr=rad*sqrt(f32(ti)/f32(${RT-1}));
rc+=sL(tRefl,sLin,clamp(ruv0+vec2<f32>(cos(a),sin(a))*rr,vec2<f32>(0.002),vec2<f32>(0.998))).rgb*(0.70/${RT-1}.0);
}
col+=pud*rc*(frW+0.02);   /* +a bit of environment even "from above", like real water */
}
}
if(uEmissive>0.5){
var m=base.r;
if(uEmMode>3.5){
/* diffuser: two tubes + a soft edge to zero — a facet-free silhouette */
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
${QQ.hfog?`if(uRim<0.5&&uEmissive<0.5&&uFlat<0.5){
var yk=1.0-clamp(vW.y,0.0,1.0); yk*=yk;
fog+=0.30*yk*(1.0-exp(-uFogDen*dd*dd*9.0))*(1.0-fog);
}`:''}
col=mix(col,uFogCol,clamp(fog,0.0,1.0));
return vec4<f32>(col,1.0);
}`;
}

/* a real ceiling fixture: a solid of revolution (reflector profile), a ring
rim, a pipe to the ceiling and a mounting cup. ~700 triangles, normals smooth
along the profile and around. Local 0 — the diffuser plane. */
function lampFixtureData(R){
const V=[];
const SEG=20;
const push=(px,py,pz,u,v,nx,ny,nz)=>{V.push(px,py,pz,u,v,nx,ny,nz,1);};
const lathe=(prof,uv)=>{
const pn=[];   /* smoothed profile normals: the average of the neighbor segment ones */
for(let i=0;i<prof.length;i++){
let nx=0,ny=0;
if(i>0){const dr=prof[i][0]-prof[i-1][0],dy=prof[i][1]-prof[i-1][1];const l=Math.hypot(dr,dy)||1;nx+=-dy/l;ny+=dr/l;}
if(i<prof.length-1){const dr=prof[i+1][0]-prof[i][0],dy=prof[i+1][1]-prof[i][1];const l=Math.hypot(dr,dy)||1;nx+=-dy/l;ny+=dr/l;}
const l=Math.hypot(nx,ny)||1;pn.push([nx/l,ny/l]);
}
for(let s=0;s<SEG;s++){
const a0=s/SEG*Math.PI*2,a1=(s+1)/SEG*Math.PI*2;
const c0=Math.cos(a0),s0=Math.sin(a0),c1=Math.cos(a1),s1=Math.sin(a1);
const u0=uv.u0+(uv.u1-uv.u0)*(s/SEG),u1=uv.u0+(uv.u1-uv.u0)*((s+1)/SEG);
for(let i=0;i<prof.length-1;i++){
const r0=prof[i][0],y0=prof[i][1],r1=prof[i+1][0],y1=prof[i+1][1];
const v0=uv.v0+(uv.v1-uv.v0)*(i/(prof.length-1)),v1=uv.v0+(uv.v1-uv.v0)*((i+1)/(prof.length-1));
const nA=pn[i],nB=pn[i+1];
const A=[r0*c0,y0,r0*s0,u0,v0,nA[0]*c0,nA[1],nA[0]*s0];
const B=[r1*c0,y1,r1*s0,u0,v1,nB[0]*c0,nB[1],nB[0]*s0];
const C=[r1*c1,y1,r1*s1,u1,v1,nB[0]*c1,nB[1],nB[0]*s1];
const D=[r0*c1,y0,r0*s1,u1,v0,nA[0]*c1,nA[1],nA[0]*s1];
for(const t of [[A,C,B],[A,D,C]])for(const p of t)push(p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7]);
}
}
};
/* outer dome (from the top to the rim) */
lathe([[0.024,0.075],[0.052,0.072],[0.082,0.064],[0.112,0.050],[0.142,0.033],[0.170,0.016],[0.192,0.004],[0.203,-0.004],[0.205,-0.012],[0.198,-0.016]],R.iron);
/* inner reflector (from the rim up): normal down-inward, material — light paint */
lathe([[0.190,-0.004],[0.164,0.010],[0.134,0.026],[0.104,0.040],[0.074,0.052],[0.048,0.060],[0.028,0.065]],R.inner);
/* pipe to the ceiling */
lathe([[0.016,0.100],[0.016,0.068]],R.iron);
/* mounting cup at the ceiling */
lathe([[0.042,0.100],[0.042,0.090],[0.030,0.084],[0.016,0.081]],R.iron);
return {arr:new Float32Array(V),n:V.length/9};
}
function lampPaneData(o,p){
const V=[]; const uv=[[0,0],[1,0],[1,1],[0,1]];
const pts=[[-o,p,-o],[o,p,-o],[o,p,o],[-o,p,o]];
for(const tri of [[0,1,2],[0,2,3]]) for(const i of tri){
const q2=pts[i],t=uv[i];
V.push(q2[0],q2[1],q2[2],t[0],t[1],0,-1,0,1); }
return {arr:new Float32Array(V),n:V.length/9}; }

function ssaoKernel(n){
n=Math.max(4,n|0);
const rnd=xsFromU32(0x55AA00+n).rnd;   /* fixed render asset — identical in every round */
const k=new Float32Array(n*3);
for(let i=0;i<n;i++){
const a=rnd()*Math.PI*2,r=Math.sqrt(rnd());
let x=Math.cos(a)*r,y=Math.sin(a)*r,z=0.15+0.85*rnd();
const l=Math.hypot(x,y,z)||1;
x/=l;y/=l;z/=l;
const sc=0.30+0.70*Math.pow((i+1)/n,1.7);
k[i*3]=x*sc;k[i*3+1]=y*sc;k[i*3+2]=z*sc;
}
return k;
}

function m4invView(v){
const m=new Float32Array(16);
const t0=v[12],t1=v[13],t2=v[14];
m[0]=v[0];m[1]=v[4];m[2]=v[8];m[3]=0;
m[4]=v[1];m[5]=v[5];m[6]=v[9];m[7]=0;
m[8]=v[2];m[9]=v[6];m[10]=v[10];m[11]=0;
m[12]=-(v[0]*t0+v[1]*t1+v[2]*t2);
m[13]=-(v[4]*t0+v[5]*t1+v[6]*t2);
m[14]=-(v[8]*t0+v[9]*t1+v[10]*t2);
m[15]=1;
return m;
}


/* --- lamp halos: one instance draw for all lamps --- */
const WGS_GLOW=`
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
/* outside the circle — zero instead of discard: the pass is additive with no
depth write, adding zero is identical to throwing away, but early-z cuts the
halos behind walls before the shader (discard disabled it for the whole pass) */
if(d>=1.0){return vec4<f32>(0.0);}
let core=exp(-d*d*5.5);
let edge=1.0-sstep(0.30,0.98,d);     /* zero at the quad edge — the border is invisible */
var a=core*edge*edge;
let dd=distance(P.v2.xyz,i.vW2);
a*=exp(-P.v1.w*dd*dd*1.2);           /* distant lamps don't merge into fog */
a*=sstep(0.25,1.15,dd);              /* at the lamp itself the halo dies */
return vec4<f32>(i.vCol*a,a); }
`;

/* --- postprocessing --- */
function wgslBright(QQ){
const VOL=(QQ.vol|0)>0;
return `
${WGS_HELPERS}
${WGS_PP}
@group(1) @binding(0) var tS:texture_2d<f32>;
@group(1) @binding(1) var sS:sampler;
${VOL?'@group(1) @binding(2) var tVol:texture_2d<f32>;':''}
@fragment fn fsB(in:VF)->@location(0) vec4<f32>{
var c=sL(tS,sS,in.uv).rgb;${VOL?' c+=sL(tVol,sS,in.uv).rgb;':''}
c=select(c,vec3<f32>(0.0),(c!=c)|(abs(c)>vec3<f32>(3.0e4)));   /* NaN(x!=x)/Inf firewall for bloom: WGSL has no isFinite */
let l=dot(c,vec3<f32>(0.299,0.587,0.114));
return vec4<f32>(c*sstep(0.40,0.88,l),1.0); }
`;
}

const WGS_DOWN=`
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

const WGS_UP=`
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

const WGS_SHARP=`
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

function wgslComp(QQ){
const AO=(QQ.ssao|0)>0;
const VOL=(QQ.vol|0)>0;
const FLR=(QQ.flare|0)>0;
const AEX=!!QQ.aexp;
let nb=2;
const B={};
const bind=n=>{const s=`@group(1) @binding(${n})`;return s;};
let decl=`${bind(0)} var tScene:texture_2d<f32>;\n${bind(1)} var tBloom:texture_2d<f32>;\n`;
B.scene=0;B.bloom=1;
if(AO){ decl+=`${bind(nb)} var tAO:texture_2d<f32>;\n`; B.ao=nb++; }
if(VOL){ decl+=`${bind(nb)} var tVol:texture_2d<f32>;\n`; B.vol=nb++; }
if(FLR){ decl+=`${bind(nb)} var tStk:texture_2d<f32>;\n`; B.stk=nb++; }
if(AEX){ decl+=`${bind(nb)} var tExp:texture_2d<f32>;\n`; B.exp=nb++; }
decl+=`${bind(nb)} var sS:sampler;\n`; B.samp=nb++;
return {src:`
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
let ca=uCA*dot(q,q);                   // chromatic aberration at the frame edges
var c=vec3<f32>(0.0);
c.r=sL(tScene,sS,in.uv+q*ca).r;
c.g=sL(tScene,sS,in.uv).g;
c.b=sL(tScene,sS,in.uv-q*ca).b;
c=select(c,vec3<f32>(0.0),(c!=c)|(abs(c)>vec3<f32>(3.0e4)));   /* NaN/Inf firewall of the composite */
${AO?'c*=mix(1.0,sL(tAO,sS,in.uv).r,uAOK);':''}
c+=sL(tBloom,sS,in.uv).rgb*uBloomK;
${FLR?'c+=sL(tStk,sS,in.uv).rgb*P.v2.w;':''}
${VOL?'let vol=sL(tVol,sS,in.uv); c=c*vol.a+vol.rgb;':''}
${AEX?'let ex=clamp(0.18/max(sL(tExp,sS,vec2<f32>(0.5)).r,0.02),0.45,2.6); c*=ex;':''}
c=aces(c*uExp);
if(uGrade>0.001){   /* film grade — shadows to cold, highlights to warm */
let lg2=dot(c,vec3<f32>(0.299,0.587,0.114));
c=mix(c,c*vec3<f32>(0.90,0.99,1.10),(1.0-sstep(0.0,0.30,lg2))*uGrade);
c=mix(c,c*vec3<f32>(1.06,1.00,0.93),sstep(0.45,0.90,lg2)*uGrade);
}
c=pow(max(c,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));
c=max(c-0.022,vec3<f32>(0.0))*1.07;           /* darkness is real, no "negative" */
/* darkness does NOT tint textures: the darker the pixel, the more neutral it is */
let lg=dot(c,vec3<f32>(0.299,0.587,0.114));
let sat=uDarkSat+(1.0-uDarkSat)*sstep(0.0,uDarkLo,lg);
c=mix(vec3<f32>(lg),c,sat);
let vig=1.0-0.55*dot(q,q)*1.6;
c*=vig;
let edge=sstep(0.25,0.5,length(q));
c+=vec3<f32>(0.16,0.015,0.015)*edge*uChase*(0.5+0.5*sin(uTime*6.5));
let gr=dhash21(in.uv*vec2<f32>(1234.5,678.9)+uTime);
c+=(gr-0.5)*uGrain*(0.22+0.78*min(1.0,lg*1.7));   /* grain dies in the dark */
c+=(dhash21(in.uv*vec2<f32>(2048.0,1536.0)+fract(uTime)*7.3)-0.5)*(uDither/255.0)*1.7;
return vec4<f32>(clamp(c,vec3<f32>(0.0),vec3<f32>(1.0)),1.0); }
`,bindings:B};
}

function wgslSsao(QQ){
const KN=Math.max(4,QQ.ssao|0);
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
if(nrm.z<0.0){nrm=-nrm;}   /* in view-space the normal toward the camera has z>0 */
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
if(svz>-0.15){continue;}   /* near-plane junk of the depth resolve doesn't darken AO */
wsum+=1.0;   /* count only visible samples, else AO "fades out" at the frame edge */
let rng=sstep(0.0,1.0,uRadius/max(abs(Pz.z-svz),1e-4));
if(svz>sp.z+uBias){occ+=rng;}
}
var ao=clamp(1.0-occ/max(wsum,1.0),0.0,1.0);
var fade=1.0-sstep(18.0,42.0,-Pz.z);   /* AO isn't needed far away — fade it */
/* SSAO lives only on horizontal surfaces (floor/ceiling/end-faces) */
let upn=abs(dot(nrm,uVup));
fade*=sstep(0.30,0.55,upn);
ao=mix(1.0,ao,fade);
/* fade AO at grazing angles: else the wall darkens and changes color when the camera turns */
let ndv=dot(nrm,normalize(-Pz));
ao=mix(1.0,ao,sstep(0.12,0.34,ndv));
return vec4<f32>(ao,ao,ao,1.0); }
`;
}

const WGS_AOBLUR=`
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

function wgslVol(QQ){
const NS=Math.max(4,QQ.vol|0);
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
if(lm.b>0.5){continue;}                    /* inside a wall — no haze */
let haze=0.45+0.55*(1.0-clamp(q.y/${CEIL_H},0.0,1.0));   /* denser at the floor */
let lit=max(lm.r-0.03,0.0);            /* the background AMBIENT gives no haze (the threshold is under AMBIENT=0.02 — no haze in the dark at all) */
let ins=lit*uK1*haze;                 /* background haze */
var insL=0.0;                         /* direct lamp contribution */
for(var j=0;j<8;j=j+1){
if(j>=uNLv){break;}
let L4=P.k[j];
if(L4.w<=0.02){continue;}
let dv=vec3<f32>(L4.x,${LAMP_Y},L4.y)-q;
let dd=length(dv);
if(dd>L4.z){continue;}
if(lm.g<=0.03&&dd>1.0){continue;}        /* the cell isn't lit by it — cheap early-out */
var att=1.0-dd/L4.z; att*=att;
var vis=1.0;                          /* shadow ray to the lamp: 6 taps over the WHOLE length */
let dq=(vec2<f32>(L4.x,L4.y)-q.xz)*(1.0/7.0);
for(var s2=1;s2<=6;s2=s2+1){
let pp=q.xz+dq*f32(s2);
if(sL(tLM,sLin,clamp(pp/uMapSize,vec2<f32>(0.002),vec2<f32>(0.998))).b>0.5){vis=0.0;break;}
}
if(vis<=0.0){continue;}
let cs=dot(rd,dv/max(dd,1e-4));
/* the phase function is nearly isotropic (g=0.32) */
insL+=L4.w*att*hg(cs,0.32)*uK2*(0.55+0.45*haze)*vis;
}
/* the FLASHLIGHT volumetric cone — a dust column in the beam (P.v4 =
 position+brightness, P.v5 = direction+edge cos, P.v6 = core cos + range) */
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
/* a warm scatter tint — in tone with the lamps themselves */
Sc+=T*stp*(ins*vec3<f32>(1.0,0.84,0.66)+(insL+insF)*vec3<f32>(1.0,0.92,0.78));
T*=exp(-(uExt+(ins+insL+insF)*0.05)*stp);
}
let cur=vec4<f32>(Sc,T);
return mix(sL(tPrev,sLin,in.uv),cur,uNewW);   /* temporal accumulation */
}
`;
}

const WGS_STREAK=`
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

const WGS_ADAPT=`
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

const WGS_BLIT=`
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

/* ==== WebGPU: device ==== */
const PP_SIZE=640, DRAW_SIZE=256;
let FW_SIZE=208+16, FW_SLOT=0;
let dev=null,adp=null,ctx=null,ctxFmt='bgra8unorm',gpuCanvas=null,devP=null;
let ub=null,ubStage=null,ubF=null,ubU=null,ubOff=0;
const UB_SIZE=1<<20;
let MODS=new Map(),PLS=new Map(),BGLS={};
let sAtl=null,sLin=null,sSh=null,sDep=null;
let texTex=null,texNrm=null,texHgt=null,texLM=null,texSh=null,texNoise=null;
let texWhite=null,texBlack01=null,texPud=null,texDummyR=null,texSkin=null;
let bufWorld=null,bufRig=null,bufPlRig=null,bufPlRigB=null,bufMan=null,bufPost=null,bufPtQ=null,bufGlowQ=null,bufGlowI=null,bufSkirt=null;
/* compute infrastructure: skinning, shadow map, irradiance field */
let bufGrid=null,bufLG=null,bufScA=null,bufScB=null,bufCaps=null,bufSegs=null,bufLampSh=null;
let bufCellLit=null,bufShAux=null,bufWorldFloor=null;
let bufShF32=null,bufShU16=null,shPitch=256;
let bufSrcMon=null,bufBIdxMon=null,bufSrcPl=null,bufBIdxPl=null;
let SK=null,bgCPP=null,bgLmAB=null,bgLmBA=null,bgShLamp=null,bgShData=null,bgPack=null;
let plCSkin=null,plCSh=null,plPack=null,plLmInit=null,plLmIter=null,plLmFinal=null;
let MESH={};
let bgPP=null,bgW0=null,bgW1=null,bgW2main=null,bgW2refl=null;
let modWorld=null,compB=null;
let V={},sNoise=null;
let modSsao='',modVol='',modBright='';
let bgGlowEmpty=null;
let T=null,sceneFmt='rgba8unorm';
let lampsArr=new Float32Array(64*4);
let volArr=new Float32Array(8*4);
let glowArr=new Float32Array(64*8);
let glowN=0;
let wlList=[];   /* the world draw list: reused between frames */
let RW=832,RH=520,zA=0,zB=0;

function ensureDevice(){
if(!devP)devP=(async()=>{
if(!navigator.gpu)throw new Error('WebGPU недоступен в этом браузере');
const a=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
if(!a)throw new Error('не найден GPU-адаптер');
const d=await a.requestDevice();
d.lost.then(()=>{ GPU.ready=false; });
return {a:a,d:d};
})();
return devP; }
/* the adapter request starts at once, so the device is ready by the "Start" press */
if(typeof navigator!=='undefined'&&navigator.gpu){ ensureDevice().catch(()=>{}); }

/* WebGPU projection: NDC z is [0,1] (unlike WebGL2) */
function perspW(fovy,asp,n,f){ const t=1/Math.tan(fovy/2);
return new Float32Array([t/asp,0,0,0, 0,t,0,0, 0,0,f/(n-f),-1, 0,0,n*f/(n-f),0]); }

/* ---- uniform buffer ---- */
function ubReset(){ ubOff=0; }
function ubAlloc(bytes){ const o=(ubOff+255)&~255; ubOff=o+bytes;
if(ubOff>UB_SIZE)throw new Error('uniform overflow'); return o; }
function ubFlush(){ if(ubOff>0)dev.queue.writeBuffer(ub,0,ubStage,0,ubOff); }

/* offsets inside FrameW */
const FO_PROJ=0,FO_VIEW=64,FO_CAM=128,FO_FOG=144,FO_MAP=160,FO_P1=176,FO_I1=192,FO_LAMPS=208;
/* offsets inside DrawW */
const DO_MODEL=0,DO_EM=64,DO_FLAT=80,DO_DOORIO=96,DO_AXIS=112,DO_F1=128,DO_F2=144,DO_F3=160;
/* offsets inside PP */
const PO_M0=0,PO_M1=64,PO_V0=128,PO_V1=144,PO_V2=160,PO_V3=176,PO_V4=192,PO_V5=208,PO_V6=224,PO_K=256;

function putF(off,arr){ ubF.set(arr,off>>2); }
function putM(off,m){ ubF.set(m,off>>2); }
function put4(off,a,b,c,d){ const i=off>>2; ubF[i]=a;ubF[i+1]=b;ubF[i+2]=c;ubF[i+3]=d; }
function putU(off,a,b,c,d){ const i=off>>2; ubU[i]=a;ubU[i+1]=b;ubU[i+2]=c;ubU[i+3]=d; }

function allocDraw(){
const o=ubAlloc(DRAW_SIZE);
putM(o+DO_MODEL,IDENT);
put4(o+DO_EM,0,0,0,0); put4(o+DO_FLAT,0,0,0,0); put4(o+DO_DOORIO,0,0,0,0); put4(o+DO_AXIS,0,0,0,0);
put4(o+DO_F1,0,0,0,0); put4(o+DO_F2,0,0,0,0); put4(o+DO_F3,0,0,0,0);
return o; }
function allocPP(){ const o=ubAlloc(PP_SIZE);
for(let i=o>>2,n=(o+PP_SIZE)>>2;i<n;i++)ubF[i]=0;
putM(o+PO_M0,IDENT); putM(o+PO_M1,IDENT);
return o; }
function allocFrame(proj,view){ const o=ubAlloc(FW_SLOT);
putM(o+FO_PROJ,proj); putM(o+FO_VIEW,view);
return o; }

/* ---- resources ---- */
const VISVF=()=>GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT;
function mkT(w,h,fmt,usage,mips,samples){
return dev.createTexture({size:{width:w,height:h,depthOrArrayLayers:1},format:fmt,
usage:usage,mipLevelCount:mips||1,sampleCount:samples||1,dimension:'2d'}); }
function mipCount(w,h){ return Math.floor(Math.log2(Math.max(w,h)))+1; }
function uploadMips(tex,data,w,h,ch){
let cw=w,chh=h,src=data;
for(let lv=0;;lv++){
dev.queue.writeTexture({texture:tex,mipLevel:lv},src,
{bytesPerRow:cw*ch,rowsPerImage:chh},{width:cw,height:chh,depthOrArrayLayers:1});
if(cw===1&&chh===1)break;
const nw=Math.max(1,cw>>1),nh=Math.max(1,chh>>1);
const dst=new Uint8Array(nw*nh*ch);
for(let y=0;y<nh;y++){
const y0=Math.min(y*2,chh-1),y1=Math.min(y*2+1,chh-1);
for(let x=0;x<nw;x++){
const x0=Math.min(x*2,cw-1),x1=Math.min(x*2+1,cw-1);
const a=(y0*cw+x0)*ch,b=(y0*cw+x1)*ch,c=(y1*cw+x0)*ch,d=(y1*cw+x1)*ch,o=(y*nw+x)*ch;
for(let k=0;k<ch;k++)dst[o+k]=(src[a+k]+src[b+k]+src[c+k]+src[d+k]+2)>>2;
}}
src=dst;cw=nw;chh=nh;
} }
function mkBuf(bytes,usage,data){
const b=dev.createBuffer({size:Math.max(4,bytes),usage:usage|GPUBufferUsage.COPY_DST});
if(data)dev.queue.writeBuffer(b,0,data);
return b; }
function wrapMesh(m){ return {buf:mkBuf(m.arr.byteLength,GPUBufferUsage.VERTEX,m.arr),n:m.n}; }
function mkSamplers(){
const px=!!Q.pixelated;
sAtl=dev.createSampler({addressModeU:'repeat',addressModeV:'repeat',
magFilter:px?'nearest':'linear',minFilter:px?'nearest':'linear',mipmapFilter:px?'nearest':'linear',
maxAnisotropy:px?1:Math.max(1,Q.aniso|0)});   /* anisotropy via Q.aniso */
sLin=dev.createSampler({addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge',
magFilter:'linear',minFilter:'linear',mipmapFilter:'nearest'});
sSh=dev.createSampler({addressModeU:'repeat',addressModeV:'clamp-to-edge',
magFilter:'linear',minFilter:'linear',mipmapFilter:'nearest'});
sDep=dev.createSampler({addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge',
magFilter:'nearest',minFilter:'nearest',mipmapFilter:'nearest'});
sNoise=dev.createSampler({addressModeU:'repeat',addressModeV:'repeat',
magFilter:'nearest',minFilter:'nearest',mipmapFilter:'nearest'});
}
function texEntry(b){ return {binding:b,visibility:VISVF(),texture:{sampleType:'float'}}; }
function depEntry(b){ return {binding:b,visibility:VISVF(),texture:{sampleType:'depth'}}; }
function sampEntry(b){ return {binding:b,visibility:VISVF(),sampler:{type:'filtering'}}; }
function dsampEntry(b){ return {binding:b,visibility:VISVF(),sampler:{type:'non-filtering'}}; }
function uniEntry(b){ return {binding:b,visibility:VISVF(),buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:0}}; }
/* compute entries: COMPUTE visibility, storage read / read_write / write-only texture */
const VISCS=()=>GPUShaderStage.COMPUTE;
function csUniEntry(b){ return {binding:b,visibility:VISCS(),buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:0}}; }
function csRO(b){ return {binding:b,visibility:VISCS(),buffer:{type:'read-only-storage'}}; }
function csRW(b){ return {binding:b,visibility:VISCS(),buffer:{type:'storage'}}; }
function csST(b,fmt){ return {binding:b,visibility:VISCS(),storageTexture:{access:'write-only',format:fmt,viewDimension:'2d'}}; }

/* ---- pipelines ---- */
function modOf(src){ let m=MODS.get(src); if(!m){ m=dev.createShaderModule({code:src}); MODS.set(src,m); } return m; }
function plOf(key,desc){ let p=PLS.get(key); if(!p){ p=dev.createRenderPipeline(desc); PLS.set(key,p); } return p; }
function plOfC(key,desc){ let p=PLS.get(key); if(!p){ p=dev.createComputePipeline(desc); PLS.set(key,p); } return p; }
function layoutOf(bglArr){ return dev.createPipelineLayout({bindGroupLayouts:bglArr}); }

const VBL_WORLD=[{arrayStride:36,stepMode:'vertex',attributes:[
{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x2'},
{shaderLocation:2,offset:20,format:'float32x3'},{shaderLocation:3,offset:32,format:'float32'}]}];
const VBL_POST=[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}];
const VBL_GLOW=[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]},
{arrayStride:32,stepMode:'instance',attributes:[{shaderLocation:1,offset:0,format:'float32x3'},
{shaderLocation:2,offset:12,format:'float32'},{shaderLocation:3,offset:16,format:'float32x3'}]}];

function worldLayout(){ return layoutOf([BGLS.w0,BGLS.w1,BGLS.w2]); }
function plWorld(frontFace,cullMode,samples,fmt){
const key='W|'+frontFace+'|'+cullMode+'|'+samples+'|'+fmt+'|'+GPU.qlevel;
return plOf(key,{layout:worldLayout(),
vertex:{module:modWorld,entryPoint:'vsWorld',buffers:VBL_WORLD},
fragment:{module:modWorld,entryPoint:'fsWorld',targets:[{format:fmt}]},
primitive:{topology:'triangle-list',frontFace:frontFace,cullMode:cullMode},
depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'},
multisample:{count:samples}}); }
function plPost(key,src,entry,bgl,fmt,blend,samples){
return plOf(key+'|'+fmt+'|'+(blend?1:0)+'|'+(samples||1),{
layout:layoutOf([BGLS.pp,bgl]),
vertex:{module:modOf(src),entryPoint:'vsFull',buffers:VBL_POST},
fragment:{module:modOf(src),entryPoint:entry,targets:[blend?{format:fmt,blend:blend}:{format:fmt}]},
primitive:{topology:'triangle-list'},multisample:{count:samples||1}}); }
const BL_ADD={color:{srcFactor:'one',dstFactor:'one',operation:'add'},
alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}};

/* ---- cleanup ---- */
function destroyList(list){ const seen=new Set();
for(const o of list){ if(o&&o.destroy&&!seen.has(o)){ seen.add(o); try{o.destroy()}catch(e){} } } }
function gpuFreeRes(){
destroyList([texTex,texNrm,texHgt,texLM,texSh,texWhite,texBlack01,texPud,texDummyR,texSkin]);
destroyList([bufWorld,bufWorldFloor,bufRig,bufPlRig,bufPlRigB,bufMan,bufGlowI,bufSkirt,
bufGrid,bufLG,bufScA,bufScB,bufCaps,bufSegs,bufLampSh,bufShF32,bufShU16,bufCellLit,bufShAux,
bufSrcMon,bufBIdxMon,bufSrcPl,bufBIdxPl,
SK&&SK.mon&&SK.mon.bones,SK&&SK.body&&SK.body.bones,SK&&SK.vm&&SK.vm.bones,SK&&SK.man&&SK.man.bones]);
for(const k in MESH)destroyList([MESH[k]&&MESH[k].buf]);
texTex=texNrm=texHgt=texLM=texSh=texWhite=texBlack01=texPud=texDummyR=texSkin=null;
bufWorld=bufWorldFloor=bufRig=bufPlRig=bufPlRigB=bufMan=bufGlowI=null;MESH={};   /* bufPost/bufPtQ/bufGlowQ — device lifetime */
bufSkirt=bufGrid=bufLG=bufScA=bufScB=bufCaps=bufSegs=bufLampSh=null;
bufShF32=bufShU16=null;bufCellLit=null;bufShAux=null;GPU.shTrack=null;GPU.pudCells=null;
bufSrcMon=bufBIdxMon=bufSrcPl=bufBIdxPl=null;SK=null;
bgW0=bgW1=bgW2main=bgW2refl=null;
bgLmAB=bgLmBA=bgShLamp=bgShData=bgPack=null; }   /* bgCPP — device lifetime (like bgPP) */
function freeTargets(){
if(!T)return;
const l=[];
const add=o=>{ if(o&&o.t)l.push(o.t); };
for(const k in T){ const v=T[k];
if(Array.isArray(v)){ for(const b of v)add(b); }else add(v); }
destroyList(l); T=null; bgW2main=bgW2refl=null; }
function gpuFreeProgs(){ PLS.clear(); MODS.clear(); modWorld=null; compB=null; }

/* ==== GPU.init ==== */
GPU.init=async function(canvas,S){
gpuBusy=true;
try{
if(!dev){
const r=await ensureDevice();
adp=r.a; dev=r.d;
ctx=canvas.getContext('webgpu');
if(!ctx)throw new Error('нет webgpu-контекста');
ctxFmt=navigator.gpu.getPreferredCanvasFormat();
gpuCanvas=canvas;
ctx.configure({device:dev,format:ctxFmt,alphaMode:'opaque'});
ubStage=new ArrayBuffer(UB_SIZE); ubF=new Float32Array(ubStage); ubU=new Uint32Array(ubStage);
ub=dev.createBuffer({size:UB_SIZE,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
BGLS.pp=dev.createBindGroupLayout({entries:[uniEntry(0)]});
BGLS.w0=dev.createBindGroupLayout({entries:[uniEntry(0)]});
BGLS.w1=dev.createBindGroupLayout({entries:[uniEntry(0)]});
BGLS.w2=dev.createBindGroupLayout({entries:[texEntry(0),texEntry(1),texEntry(2),texEntry(3),
texEntry(4),texEntry(5),texEntry(6),sampEntry(7),sampEntry(8),sampEntry(9),texEntry(10),
{binding:11,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}}]});
BGLS.glow=dev.createBindGroupLayout({entries:[]});
BGLS.one=dev.createBindGroupLayout({entries:[texEntry(0),sampEntry(1)]});
BGLS.two=dev.createBindGroupLayout({entries:[texEntry(0),sampEntry(1),texEntry(2)]});
BGLS.aoB=dev.createBindGroupLayout({entries:[texEntry(0),sampEntry(1),depEntry(2),dsampEntry(3)]});
BGLS.ao=dev.createBindGroupLayout({entries:[depEntry(0),dsampEntry(1),texEntry(2),dsampEntry(3)]});
BGLS.vol=dev.createBindGroupLayout({entries:[depEntry(0),dsampEntry(1),texEntry(2),sampEntry(3),texEntry(4)]});
/* compute layouts: skinning, irradiance field, shadow map */
BGLS.cUni=dev.createBindGroupLayout({entries:[csUniEntry(0)]});
BGLS.cSkin=dev.createBindGroupLayout({entries:[csRO(0),csRO(1),csRO(2),csRW(3)]});
BGLS.cLm=dev.createBindGroupLayout({entries:[csRO(0),csRO(1),csRW(2),csRW(3),csST(4,'rgba8unorm')]});
BGLS.cLamp=dev.createBindGroupLayout({entries:[csRO(0),csRO(1)]});
BGLS.cSh=dev.createBindGroupLayout({entries:[csRO(0),csRO(1),csRO(2),csRW(3)]});
BGLS.cPack=dev.createBindGroupLayout({entries:[csRO(0),csRW(1)]});
bgPP=dev.createBindGroup({layout:BGLS.pp,entries:[{binding:0,resource:{buffer:ub,offset:0,size:PP_SIZE}}]});
bgCPP=dev.createBindGroup({layout:BGLS.cUni,entries:[{binding:0,resource:{buffer:ub,offset:0,size:PP_SIZE}}]});
bufPost=mkBuf(24,GPUBufferUsage.VERTEX,new Float32Array([-1,-1,3,-1,-1,3]));
bufPtQ=mkBuf(48,GPUBufferUsage.VERTEX,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]));
bufGlowQ=bufPtQ;
await ldStep(0.06,'видеокарта');
}
gpuFreeRes();
FW_SIZE=208+16*Math.max(1,Q.lamps|0)+96;   /* +4 vec4 for the player flashlight; +2 vec4 for the spot scatter (flE/flF) */
FW_SLOT=((FW_SIZE+255)&~255);
if(GPU.qlevel!==qSig()){
gpuFreeProgs();
modWorld=modOf(wgslWorld(Q));
compB=wgslComp(Q);
BGLS.comp=dev.createBindGroupLayout({entries:(()=>{
const e=[];const B=compB.bindings;const n=Object.keys(B).length;
for(const k in B){ if(k==='samp')e.push(sampEntry(B[k])); else e.push(texEntry(B[k])); }
return e; })()});
mkSamplers();
/* noise for SSAO (4×4) */
if((Q.ssao|0)>0){
if(texNoise){try{texNoise.destroy()}catch(e){}}
const ND=new Uint8Array(64),rn=xsFromU32(0x55AA1234).rnd;   /* fixed render asset */
for(let i=0;i<16;i++){ const a=rn()*Math.PI*2;
ND[i*4]=((Math.cos(a)*0.5+0.5)*255)|0;
ND[i*4+1]=((Math.sin(a)*0.5+0.5)*255)|0;
ND[i*4+2]=((0.5+rn()*0.2)*255)|0;
ND[i*4+3]=255; }
texNoise=mkT(4,4,'rgba8unorm',GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST);
dev.queue.writeTexture({texture:texNoise},ND,{bytesPerRow:16,rowsPerImage:4},{width:4,height:4,depthOrArrayLayers:1});
const k3=ssaoKernel(Q.ssao|0),k4=new Float32Array(24*4);
for(let i=0;i*3<k3.length&&i<24;i++){ k4[i*4]=k3[i*3];k4[i*4+1]=k3[i*3+1];k4[i*4+2]=k3[i*3+2];k4[i*4+3]=0; }
ssaoK=k4;
}
modBright=wgslBright(Q);
modSsao=(Q.ssao|0)>0?wgslSsao(Q):'';
modVol=(Q.vol|0)>0?wgslVol(Q):'';
GPU.qlevel=qSig();
}
await ldStep(0.16,'шейдеры');
/* 1×1 stubs */
texWhite=mkT(1,1,'rgba8unorm',GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST);
dev.queue.writeTexture({texture:texWhite},new Uint8Array([255,255,255,255]),{bytesPerRow:4,rowsPerImage:1},{width:1,height:1,depthOrArrayLayers:1});
texBlack01=mkT(1,1,'rgba8unorm',GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST);
dev.queue.writeTexture({texture:texBlack01},new Uint8Array([0,0,0,255]),{bytesPerRow:4,rowsPerImage:1},{width:1,height:1,depthOrArrayLayers:1});
texDummyR=mkT(1,1,'r8unorm',GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST);
dev.queue.writeTexture({texture:texDummyR},new Uint8Array([255]),{bytesPerRow:1,rowsPerImage:1},{width:1,height:1,depthOrArrayLayers:1});

/* atlas: color + normals + heights (mips computed on CPU — WebGPU has no generateMipmap) */
await ldStep(0.22,'текстуры мира');
const atl=getAtlas(S);
const TU=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST;
const aw=atl.w,ah=atl.h,amc=mipCount(aw,ah);
texTex=mkT(aw,ah,'rgba8unorm',TU,amc);
uploadMips(texTex,new Uint8Array(atl.col.data.buffer,atl.col.data.byteOffset,aw*ah*4),aw,ah,4);
texNrm=mkT(aw,ah,'rgba8unorm',TU,amc);
uploadMips(texNrm,atl.nrm,aw,ah,4);
if(Q.pom||Q.cav){ texHgt=mkT(aw,ah,'r8unorm',TU,amc); uploadMips(texHgt,atl.hgt,aw,ah,1); }
else texHgt=texDummyR;
await ldStep(0.50,'текстуры мира');
/* Width = the preset's shSteps (with a fixed SHW_MAX and shSteps<256 the
 azimuth would squeeze into the left part of the map), depth — r16float
 (WebGPU core), 64 lamps × shRows bands. The map is filled by
 csShadow→csPack→copyBufferToTexture: r16float in WebGPU core doesn't support
 storage writes from compute. */
const TUS=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING;
texSh=mkT(Math.max(16,Math.min(SHW_MAX,Q.shSteps|0)),64*Math.max(8,Math.min(SH_ROWS_MAX,Q.shRows|0)),'r16float',TU);
/* skin/body-material atlas — 1024², mips on CPU */
texSkin=mkT(1024,1024,'rgba8unorm',TU,mipCount(1024,1024));
uploadMips(texSkin,genSkinTex(S.seedState),1024,1024,4);
await ldStep(0.60,'материалы');
texLM=mkT(S.W,S.H,'rgba8unorm',TUS);   /* the lightmap is written by compute csLmFinal */
const PM=genPuddleMap(S);
texPud=mkT(PM.w,PM.h,'r8unorm',TU);
dev.queue.writeTexture({texture:texPud},PM.data,{bytesPerRow:PM.w,rowsPerImage:PM.h},{width:PM.w,height:PM.h,depthOrArrayLayers:1});
/* puddle cells (CPU list): if none lands in the frustum — the mirror pass is
 skipped entirely, there's nothing to reflect anyway (the 40/255 threshold is
 below the fsWorld puddle threshold 0.18 — the list safely covers all visible puddles) */
{const res=(PM.w/S.W)|0||4;
const mark=new Uint8Array(S.W*S.H);
for(let y=0;y<PM.h;y++){const ry=((y/res)|0)*S.W;
for(let x=0;x<PM.w;x++)if(PM.data[y*PM.w+x]>=40)mark[ry+((x/res)|0)]=1;}
let cnt=0;for(let i=0;i<mark.length;i++)cnt+=mark[i];
const cl=new Uint16Array(cnt);let k=0;
for(let i=0;i<mark.length;i++)if(mark[i])cl[k++]=i;
GPU.pudCells=cl;}

const wd=worldData(S);
bufWorld=mkBuf(wd.arr.byteLength,GPUBufferUsage.VERTEX,wd.arr);
GPU.wCount=wd.n;
bufWorldFloor=mkBuf(Math.max(4,wd.arrF.byteLength),GPUBufferUsage.VERTEX,wd.arrF.length?wd.arrF:null);
GPU.wFCount=wd.nF;
GPU.rig=buildRig();
await ldStep(0.68,'геометрия');
const VSU=GPUBufferUsage.VERTEX|GPUBufferUsage.STORAGE;   /* csSkin writes the skinning dst */
bufRig=mkBuf(GPU.rig.total*36,VSU);
/* dynamic cloak-cloth buffer (the rag verlet mesh). The cloth stays on CPU:
 180 verlet particles are tens of microseconds, and moving them would change
 the constraint solve order (Gauss-Seidel → Jacobi) and the cloak behavior
 with no gain. */
GPU.skirtArr=new Float32Array(SKIRT_VN*9);
bufSkirt=mkBuf(GPU.skirtArr.byteLength,GPUBufferUsage.VERTEX);
GPU.skirt={p:new Float32Array(SKIRT_NU*SKIRT_NV*3),q:new Float32Array(SKIRT_NU*SKIRT_NV*3),init:0,px:0,pz:0,vx:0,vz:0,sax:0,saz:0,wvx:0,wvz:0};
/* one rig for the whole body; buffers: body (world), arm viewmodel (main+refl
 not needed — the viewmodel isn't reflected), mannequin. The body is drawn
 with ONE buffer in both passes: the model matrix is world, the mirror camera
 itself gives the puddle reflection. */
GPU.plRig=buildPlayerRig();
/* second hide set for the viewmodel — no legs (until the look goes down) */
GPU.hideFPl=Object.assign({},GPU.plRig.hide);
for(const bn of ['thL','snL','ftL','thR','snR','ftR'])GPU.hideFPl[GPU.plRig.idx[bn]]=1;
bufPlRig=mkBuf(GPU.plRig.total*36,VSU);      /* body */
bufPlRigB=mkBuf(GPU.plRig.total*36,VSU);      /* arms (viewmodel) */
bufMan=mkBuf(GPU.plRig.total*36,VSU);        /* mannequin */
MESH.key=wrapMesh(buildKeyMeshData());
MESH.valve=wrapMesh(buildValveData());
/* flashlight, battery, cabinet with drawer, safe-room table */
MESH.flash=wrapMesh(buildFlashlightData());
MESH.flashLens=wrapMesh(buildFlashLensData());
MESH.battBody=wrapMesh(buildBatteryBodyData());
MESH.battBand=wrapMesh(buildBatteryBandData());
MESH.cab=wrapMesh(buildCabinetData());
MESH.cabDrawer=wrapMesh(buildCabinetDrawerData());
MESH.table=wrapMesh(buildTableData());
MESH.portal=wrapMesh(discMeshData(0.42,26));
MESH.lampH=wrapMesh(lampFixtureData({
iron:{u0:UV_IRON.u0+(UV_IRON.u1-UV_IRON.u0)*0.06,u1:UV_IRON.u0+(UV_IRON.u1-UV_IRON.u0)*0.34,
v0:UV_IRON.v0+(UV_IRON.v1-UV_IRON.v0)*0.06,v1:UV_IRON.v0+(UV_IRON.v1-UV_IRON.v0)*0.34},
inner:{u0:UV_CEIL.u0+(UV_CEIL.u1-UV_CEIL.u0)*0.30,u1:UV_CEIL.u0+(UV_CEIL.u1-UV_CEIL.u0)*0.70,
v0:UV_CEIL.v0+(UV_CEIL.v1-UV_CEIL.v0)*0.30,v1:UV_CEIL.v0+(UV_CEIL.v1-UV_CEIL.v0)*0.70}}));
MESH.lampP=wrapMesh(lampPaneData(0.150,-0.006));
MESH.eye=wrapMesh(boxMeshData(0.020,0.020,0.020));
MESH.door=wrapMesh(leafMeshData(0.5,DOOR_H,0.055,UV_IRON,EDGE_IRON,UV_IRON2));   /* to the ceiling */
MESH.safe=wrapMesh(leafMeshData(0.5,DOOR_H,0.05,UV_WOOD,EDGE_WOOD));   /* to the ceiling */
MESH.safeHw=wrapMesh(buildSafeHwData(0.5,DOOR_H,0.05));   /* belts/rivets/handle */
GPU.DR=doorRig(S);
GPU.doorYaw=GPU.DR.exit.yaw;
/* the portal FACES THE ENTERING PLAYER: its disc is perpendicular to the
   door→exit-room axis (the room's single connection in the maze tree), not
   to the door leaf — the room may now attach to the door from any side */
{const wc=S.winCell||S.door,pdx=wc.x-S.door.x,pdy=wc.y-S.door.y;
GPU.portalYaw=(pdx||pdy)?Math.atan2(-pdx,-pdy):GPU.doorYaw;}
bufGlowI=mkBuf(glowArr.byteLength,GPUBufferUsage.VERTEX);
await ldStep(0.80,'модели');
V={texSkin:texSkin.createView(),texTex:texTex.createView(),texNrm:texNrm.createView(),texHgt:texHgt.createView(),
texLM:texLM.createView(),texSh:texSh.createView(),texPud:texPud.createView(),
texWhite:texWhite.createView(),texBlack:texBlack01.createView(),
texNoise:texNoise?texNoise.createView():texBlack01.createView()};
bgGlowEmpty=dev.createBindGroup({layout:BGLS.glow,entries:[]});
/* ---- compute resources: skinning, shadow map, irradiance field ---- */
const ncell=S.W*S.H;
bufGrid=mkBuf(ncell*4,GPUBufferUsage.STORAGE);
bufLG=mkBuf(ncell*8,GPUBufferUsage.STORAGE);
/* per-cell lamp mask (2×u32) — a pixel shades only its own cell's lamps */
bufCellLit=mkBuf(ncell*8,GPUBufferUsage.STORAGE);
/* shadow-map bands: a header (capsule count / 0xFFFFFFFF = "clean") + the
 band's capsule indices — csShadow marches only its own list and skips clean bands */
bufShAux=mkBuf((SHL_MAX+1)*(CAPS_MAX+1)*4,GPUBufferUsage.STORAGE);
GPU.shTrack=null;   /* new distance buffer — the first frame computes all bands */
bufScA=mkBuf(ncell*4,GPUBufferUsage.STORAGE);
bufScB=mkBuf(ncell*4,GPUBufferUsage.STORAGE);
bufCaps=mkBuf(CAPS_MAX*7*4,GPUBufferUsage.STORAGE);
bufSegs=mkBuf(SEGS_MAX*4*4,GPUBufferUsage.STORAGE);
bufLampSh=mkBuf((SHL_MAX*4+8)*4,GPUBufferUsage.STORAGE);
/* shadow-map output: f32 distances (csShadow) → packed half-pairs (csPack)
 → copyBufferToTexture. The row pitch is a multiple of 256 (a copy
 requirement), the height — the max dispatch rows: (shadow lamps +
 flashlight) × preset bands. */
{const shWQ=Math.max(16,Math.min(SHW_MAX,Q.shSteps|0));
const shRQ=Math.max(8,Math.min(SH_ROWS_MAX,Q.shRows|0));
shPitch=Math.max(256,Math.ceil(shWQ*2/256)*256);
const rowsMax=(Math.min(Math.max(1,Q.lamps|0),Math.max(1,Q.shLamps|0||64))+1)*shRQ;
bufShF32=mkBuf(shWQ*rowsMax*4,GPUBufferUsage.STORAGE);
bufShU16=mkBuf(shPitch*rowsMax,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);}
{const dM=rigSrcData(GPU.rig);
bufSrcMon=mkBuf(dM.src.byteLength,GPUBufferUsage.STORAGE,dM.src);
bufBIdxMon=mkBuf(Math.max(4,dM.bi.byteLength),GPUBufferUsage.STORAGE,dM.bi);
const dP=rigSrcData(GPU.plRig);
bufSrcPl=mkBuf(dP.src.byteLength,GPUBufferUsage.STORAGE,dP.src);
bufBIdxPl=mkBuf(Math.max(4,dP.bi.byteLength),GPUBufferUsage.STORAGE,dP.bi);}
const BONES_B=NB_MAX*16*4+NB_MAX*4;
function skinInst(rig,srcB,bidxB,dst){
const bb=new ArrayBuffer(BONES_B);
return {rig:rig,bb:bb,f32:new Float32Array(bb,0,NB_MAX*16),u32:new Uint32Array(bb,NB_MAX*16*4,NB_MAX),
bones:mkBuf(BONES_B,GPUBufferUsage.STORAGE),dst:dst,srcB:srcB,bidxB:bidxB,bg:null}; }
SK={mon:skinInst(GPU.rig,bufSrcMon,bufBIdxMon,bufRig),
body:skinInst(GPU.plRig,bufSrcPl,bufBIdxPl,bufPlRig),
vm:skinInst(GPU.plRig,bufSrcPl,bufBIdxPl,bufPlRigB),
man:skinInst(GPU.plRig,bufSrcPl,bufBIdxPl,bufMan)};
for(const k in SK){const I=SK[k];
I.bg=dev.createBindGroup({layout:BGLS.cSkin,entries:[
{binding:0,resource:{buffer:I.bones}},{binding:1,resource:{buffer:I.srcB}},
{binding:2,resource:{buffer:I.bidxB}},{binding:3,resource:{buffer:I.dst}}]});}
/* the field's Jacobi iterations alternate buffers: AB (scA→scB) and BA
 (scB→scA); after 6 iterations the result is back in scA — csLmFinal reads it. */
bgLmAB=dev.createBindGroup({layout:BGLS.cLm,entries:[
{binding:0,resource:{buffer:bufLG}},{binding:1,resource:{buffer:bufGrid}},
{binding:2,resource:{buffer:bufScA}},{binding:3,resource:{buffer:bufScB}},
{binding:4,resource:V.texLM}]});
bgLmBA=dev.createBindGroup({layout:BGLS.cLm,entries:[
{binding:0,resource:{buffer:bufLG}},{binding:1,resource:{buffer:bufGrid}},
{binding:2,resource:{buffer:bufScB}},{binding:3,resource:{buffer:bufScA}},
{binding:4,resource:V.texLM}]});
bgShLamp=dev.createBindGroup({layout:BGLS.cLamp,entries:[{binding:0,resource:{buffer:bufLampSh}},{binding:1,resource:{buffer:bufShAux}}]});
bgShData=dev.createBindGroup({layout:BGLS.cSh,entries:[
{binding:0,resource:{buffer:bufGrid}},{binding:1,resource:{buffer:bufCaps}},
{binding:2,resource:{buffer:bufSegs}},{binding:3,resource:{buffer:bufShF32}}]});
bgPack=dev.createBindGroup({layout:BGLS.cPack,entries:[
{binding:0,resource:{buffer:bufShF32}},{binding:1,resource:{buffer:bufShU16}}]});
plCSkin=plOfC('CSKIN',{layout:layoutOf([BGLS.cSkin]),compute:{module:modOf(WGS_SKIN),entryPoint:'csSkin'}});
plLmInit=plOfC('CLM0',{layout:layoutOf([BGLS.cUni,BGLS.cLm]),compute:{module:modOf(WGS_LM),entryPoint:'csLmInit'}});
plLmIter=plOfC('CLM1',{layout:layoutOf([BGLS.cUni,BGLS.cLm]),compute:{module:modOf(WGS_LM),entryPoint:'csLmIter'}});
plLmFinal=plOfC('CLM2',{layout:layoutOf([BGLS.cUni,BGLS.cLm]),compute:{module:modOf(WGS_LM),entryPoint:'csLmFinal'}});
plCSh=plOfC('CSH',{layout:layoutOf([BGLS.cUni,BGLS.cLamp,BGLS.cSh]),compute:{module:modOf(WGS_SHADOW),entryPoint:'csShadow'}});
plPack=plOfC('CPK',{layout:layoutOf([BGLS.cUni,BGLS.cPack]),compute:{module:modOf(WGS_PACK),entryPoint:'csPack'}});
await ldStep(0.94,'конвейеры');
GPU.mapW=S.W; GPU.mapH=S.H;
lampsArr=new Float32Array(Math.max(1,Q.lamps)*4);
GPU.hdrOK=true;
GPU.sig=gpuSigOf(S.seed,S.W,S.H);
GPU.ready=true;
try{console.info('NADZIRATEL · '+GAME_VER+' · WebGPU');}catch(e){}
gpuBusy=false;
return true;
}catch(e){ console.warn('GPU init failed: '+(e&&e.message?e.message:e)); GPU.ready=false; GPU.ok=false; gpuBusy=false; return false; }
};

/* ==== GPU.resize ==== */
function mkRT(w,h,fmt,usage,mips){ const t=mkT(w,h,fmt,usage,mips); return {t:t,v:t.createView(),w:w,h:h}; }
/* Frame targets are built with a fallback: if the GPU couldn't allocate the
 preset buffers (8K on weak hardware) — silently halve it and retry until it works. */
function buildTargets(w,h){
freeTargets(); BG_CACHE=null; volPhase=0;
const hdr=!!(Q.hdr&&GPU.hdrOK);
sceneFmt=hdr?'rgba16float':'rgba8unorm';
const CU=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING;
let ms=(Q.msaa|0)>1?(Q.msaa|0):0;
if(ms>4)ms=4;
GPU.msaa=ms;
T={bl:[]};
if(ms>0){
const mc=mkT(w,h,sceneFmt,GPUTextureUsage.RENDER_ATTACHMENT,1,ms);
const md=mkT(w,h,'depth24plus',GPUTextureUsage.RENDER_ATTACHMENT,1,ms);
T.msC={t:mc,v:mc.createView()}; T.msD={t:md,v:md.createView()};
}
if(ms>0){ const mvd=mkT(w,h,'depth24plus',GPUTextureUsage.RENDER_ATTACHMENT,1,ms);
T.msDvm={t:mvd,v:mvd.createView()}; }
else{ T.vmD=mkRT(w,h,'depth24plus',GPUTextureUsage.RENDER_ATTACHMENT); }
T.scene=mkRT(w,h,sceneFmt,CU);
T.depth=mkRT(w,h,'depth24plus',CU);
if((Q.ssao|0)>0){ const aw=Math.max(1,w>>1),ah=Math.max(1,h>>1);
T.ao=mkRT(aw,ah,'r8unorm',CU); T.ao2=mkRT(aw,ah,'r8unorm',CU); }
if((Q.vol|0)>0){ const vw=Math.max(1,w>>1),vh=Math.max(1,h>>1);
T.volA=mkRT(vw,vh,sceneFmt,CU); T.volB=mkRT(vw,vh,sceneFmt,CU); }
if(Q.post&&(Q.bloomLv|0)>0){ let bw=Math.max(1,w>>1),bh=Math.max(1,h>>1);
for(let i=0;i<(Q.bloomLv|0);i++){ T.bl.push(mkRT(bw,bh,sceneFmt,CU));
bw=Math.max(1,bw>>1);bh=Math.max(1,bh>>1);} }
if((Q.sharp||0)>0)T.L=mkRT(w,h,'rgba8unorm',CU);
if((Q.ssr|0)>0){
/* floor planar reflections: the scale is set by the preset (epic — full resolution) */
const rs=Math.min(1.0,Math.max(0.25,Q.reflScale||0.5));
const rw=Math.max(1,Math.round(w*rs)),rh=Math.max(1,Math.round(h*rs));
T.reflC=mkRT(rw,rh,sceneFmt,CU);
T.reflD=mkRT(rw,rh,'depth24plus',GPUTextureUsage.RENDER_ATTACHMENT);
}
if((Q.flare|0)>0)T.stk=mkRT(Math.max(1,w>>2),Math.max(1,h>>2),sceneFmt,CU);
GPU.aexpOn=!!Q.aexp&&!!GPU.hdrOK;
if(GPU.aexpOn){ T.ed=mkRT(Math.max(16,w>>4),Math.max(16,h>>4),sceneFmt,CU);
T.ea=mkRT(1,1,sceneFmt,CU); T.eb=mkRT(1,1,sceneFmt,CU); }
/* world bind groups: group 2 differs only by the planar-reflection texture */
const w2=[{binding:0,resource:V.texTex},{binding:1,resource:V.texNrm},{binding:2,resource:V.texLM},
{binding:3,resource:V.texHgt},{binding:4,resource:V.texPud},{binding:5,resource:V.texSh},
{binding:6,resource:(T.reflC?T.reflC.v:V.texBlack)},{binding:7,resource:sAtl},
{binding:8,resource:sLin},{binding:9,resource:sSh},{binding:10,resource:V.texSkin},
{binding:11,resource:{buffer:bufCellLit}}];
bgW2main=dev.createBindGroup({layout:BGLS.w2,entries:w2});
bgW2refl=dev.createBindGroup({layout:BGLS.w2,entries:w2.map(e=>e.binding===6?{binding:6,resource:V.texBlack}:e)});
bgW0=dev.createBindGroup({layout:BGLS.w0,entries:[{binding:0,resource:{buffer:ub,offset:0,size:FW_SIZE}}]});
bgW1=dev.createBindGroup({layout:BGLS.w1,entries:[{binding:0,resource:{buffer:ub,offset:0,size:DRAW_SIZE}}]});
/* initial contents of the temporal-accumulation targets */
const ini=[];
if(T.volA)ini.push({view:T.volA.v,color:{r:0,g:0,b:0,a:1}});
if(T.volB)ini.push({view:T.volB.v,color:{r:0,g:0,b:0,a:1}});
if(T.ea)ini.push({view:T.ea.v,color:{r:0.18,g:0,b:0,a:1}});
if(T.eb)ini.push({view:T.eb.v,color:{r:0.18,g:0,b:0,a:1}});
if(ini.length){ const e=dev.createCommandEncoder();
for(const c of ini){ const p=e.beginRenderPass({colorAttachments:[{view:c.view,clearValue:c.color,loadOp:'clear',storeOp:'store'}]}); p.end(); }
dev.queue.submit([e.finish()]); }
}
GPU.resize=function(w,h){
if(!dev||!GPU.ready)return;
const maxD=(dev.limits&&dev.limits.maxTextureDimension2D)||8192;
let ww=Math.max(160,Math.min(w|0,maxD)),hh=Math.max(100,Math.min(h|0,maxD));
for(var att=0;att<6;att++){
try{buildTargets(ww,hh);RW=ww;RH=hh;
if(gpuCanvas.width!==ww||gpuCanvas.height!==hh){gpuCanvas.width=ww;gpuCanvas.height=hh;}
return;}catch(e){try{freeTargets()}catch(e2){}
ww=Math.max(160,ww>>1);hh=Math.max(100,hh>>1);}
}
};

/* ==== GPU.frame ==== */
let ssaoK=null;
function bgTex(layout,entries){ return dev.createBindGroup({layout:layout,entries:entries}); }
/* Frame bind-group cache: post-pass resources are unchanged between resizes,
 the only alternation — the volumetric light ping-pong (the phase is in the
 key). A pure CPU win: minus ~12 createBindGroup per frame, zero picture impact. */
let volPhase=0, BG_CACHE=null;
function bgTexC(key,layout,entries){ if(!BG_CACHE)BG_CACHE={};
let g=BG_CACHE[key];
if(!g){ g=dev.createBindGroup({layout:layout,entries:entries}); BG_CACHE[key]=g; }
return g; }
function fullDraw(pass,pl,off,bg){ pass.setPipeline(pl); pass.setBindGroup(0,bgPP,[off]);
pass.setBindGroup(1,bg); pass.setVertexBuffer(0,bufPost); pass.draw(3,1); }

GPU.frame=function(S,dt){
if(!GPU.ready||!dev||!T)return;
const ncell=GPU.mapW*GPU.mapH;
/* The IRRADIANCE FIELD (lightmap) is computed by the GPU (csLmInit/csLmIter/
 csLmFinal — 6 Jacobi iterations with a 0.55 factor). Here only the input
 packing: light and gate by cells + the map state with the door-open bit (a
 buffer shared with the shadow map). The flashlight spot is injected into the
 field in csLmInit (see PO_V1). */
if(!GPU.lgStage||GPU.lgStage.length!==ncell*2)GPU.lgStage=new Float32Array(ncell*2);
const lgS=GPU.lgStage;
for(let i=0;i<ncell;i++){lgS[i*2]=S.light[i];lgS[i*2+1]=S.gate?S.gate[i]:1;}
dev.queue.writeBuffer(bufLG,0,lgS);
if(!GPU.gridStage||GPU.gridStage.length!==ncell)GPU.gridStage=new Uint32Array(ncell);
collectGridU32(S,GPU.gridStage);
dev.queue.writeBuffer(bufGrid,0,GPU.gridStage);
lampsArr.fill(0);
const nL=collectLamps(S,lampsArr);
/* per-cell lamp mask — fsWorld iterates only its own cell's lamps */
if(!GPU.clMask||GPU.clMask.length!==ncell*2)GPU.clMask=new Uint32Array(ncell*2);
buildCellLightMask(S,lampsArr,nL,GPU.clMask);
dev.queue.writeBuffer(bufCellLit,0,GPU.clMask);
const shW=Math.max(16,Math.min(SHW_MAX,Q.shSteps|0));
const shRowsQ=Math.max(8,Math.min(SH_ROWS_MAX,Q.shRows|0));
const nSH=Math.max(1,Math.min(nL,Q.shLamps|0||64));   /* only the nearest lamps cast a shadow — distant ones have att≤2%, invisible anyway */
/* body and monster poses are computed BEFORE the shadows — skeleton capsules
 go into the shadow map, so the silhouette on the wall is alive and dynamic. */
const crK=clp(S.pCrouch||0,0,1);
/* the "flashlight in hand" stance for third person fades in/out smoothly */
{const flS=S.fl;
const wantHold=(flS&&flS.owned&&!(flS.rl>0)&&S.inv&&S.sel>=0&&S.inv[S.sel]&&S.inv[S.sel].kind==='flash')?1:0;
S._holdK=(S._holdK||0)+Math.max(-dt/0.22,Math.min(dt/0.22,wantHold-(S._holdK||0)));}
/* the pinch stance (key/battery in hand) — the same slew as the flashlight's */
{const itP=S.inv&&S.sel>=0?S.inv[S.sel]:null;
const wantPinch=(itP&&(itP.kind==='key'||itP.kind==='batt')&&!(S.fl&&S.fl.rl>0))?1:0;
S._pinchK=(S._pinchK||0)+Math.max(-dt/0.22,Math.min(dt/0.22,wantPinch-(S._pinchK||0)));}
const bodyP=playerPose(S,S.time);
let mPose=null,rootM=null;
if(S.monster&&!S.caught){mPose=monPose(S,S.time);rootM=m4mul(m4t(S.mx,S.monDY||0,S.my),m4rotY(S.mYaw||0));}
GPU.shCaps=collectShadowCaps(S,bodyP,mPose,rootM);

const proj=perspW(S.thirdPerson?62*Math.PI/180:75*Math.PI/180,RW/RH,0.05,Q.far);
/* Camera height — from the ACTUAL model pose (root dy + head FK + eyes):
 camera and body are one pose, the puddle reflection doesn't "lag" the gaze.
 · standing — eyes at 0.55 cells (1.62 m; EYE_REF_RIG = 1.7205 — an FK
   measurement over the idle pose without neck/head pitch);
 · walking on C — body and camera rise together (pelvis 0.60 rig);
 · walk/run bob — real, from the gait (pelvis + flight phase). */
/* neck/head pitch does NOT enter the camera height: micro-saccades and the
 "breathing" of the gaze would drift it by ±1.5 cm, and the mouse tilt the
 camera plays with its own pitch. The height comes from the torso
 (pelvis→spine→chest). */
const camPose=Object.assign({},bodyP.pose,{
 nk:[0,bodyP.pose.nk?bodyP.pose.nk[1]:0,0],
 hd:[0,bodyP.pose.hd?bodyP.pose.hd[1]:0,0]});
const hdM=fkChain(GPU.plRig,camPose,m4t(0,bodyP.dy,0),['hd']).hd;
const eyeRig=hdM[13]+hdM[5]*EYE_HY+hdM[9]*EYE_ZC;
const eyeY0=0.55+(eyeRig-EYE_REF_RIG)*PL_SCALE;
const bobAmpX=(0.009+0.006*(S.runK||0))*(1-0.5*crK)*S.bobA;
const bobX=Math.cos(S.animPhase||0)*bobAmpX;
/* third-person camera — behind the character's back, looking at them */
let view,camX,camY,camZ;
if(S.thirdPerson){
/* 3 states (1=behind, 2=front); the distance is closer (1.15→0.90);
 the camera does NOT pass through walls: the distance is clamped by a free ray. */
const back=S.thirdPerson===1;
const dWant=0.90-0.08*crK;
const dx=Math.cos(S.ang)*(back?-1:1), dz=Math.sin(S.ang)*(back?-1:1);
let dEff=dWant;
{const nstep=Math.max(3,Math.ceil(dWant/0.04));let a2=0,b2=1,hit=false;
 for(let q=1;q<=nstep;q++){const tt=q/nstep;
  if(blocked(S,S.px+dx*dWant*tt,S.py+dz*dWant*tt)){a2=(q-1)/nstep;b2=tt;hit=true;break}}
 if(hit){for(let i2=0;i2<10;i2++){const m2=(a2+b2)*0.5;
  if(blocked(S,S.px+dx*dWant*m2,S.py+dz*dWant*m2))b2=m2;else a2=m2;}
  dEff=Math.max(0.20,dWant*b2-0.10);}
}
camX=S.px+dx*dEff; camZ=S.py+dz*dEff;
camY=0.52-0.16*crK+(1-clp(dEff/dWant,0,1))*0.12;   /* at a wall the camera rises toward the head */
if(camY>eyeY0-0.04)camY=eyeY0-0.04;
const yawT=back?S.ang:S.ang+Math.PI;
const pitT=back?((S.pitch||0)*0.6-0.10-0.10*crK):(-((S.pitch||0)*0.6)-0.10-0.10*crK);
view=look(camX,camY,camZ,yawT,pitT);
}else{
camX=S.px-Math.sin(S.ang)*bobX; camY=eyeY0; camZ=S.py+Math.cos(S.ang)*bobX;
view=look(camX,camY,camZ,S.ang,(S.pitch||0)+Math.sin((S.camBobPh||0)+1.7)*0.0045*S.bobA*(1-0.35*(S.runK||0)));
}
zA=proj[10]; zB=proj[14];
const viewMir=m4mul(view,M4MIR);
/* the mirror pass — only if at least one puddle cell lands in the frustum:
 no puddles in frame ⇒ nobody samples the reflection, and the pass (a full
 world redraw with the mirror camera) is skipped with no visible difference */
const reflOn=!!(T.reflC&&GPU.pudCells&&GPU.pudCells.length&&
frustumPud(m4mul(proj,view),GPU.pudCells,GPU.mapW));

/* ---- frame uniform data and the world draw list ---- */
ubReset();
const NLQ=Math.max(1,Q.lamps|0);/* the flashlight slot in FrameW — three vec4 right after the lamp array.
 flA = (position, brightness), flB = (direction, cone-edge cos),
 flC = (core cos, range, shadow-map slot, ...), flDv = (color, ...). */
const FO_FLASH=208+16*Math.max(1,Q.lamps|0);
/* beam brightness/color — the SAME functions as in core (flashBright/flashFlick):
 what is drawn and what drives the shadow away never diverges. */
function flashState(S){
const f=(S&&S.fl)?S.fl:null;
const on=!!(f&&f.owned&&f.on&&!(f.rl>0)&&flashBright(f.e)*flashFlick(S)>0.01);
if(!on)return {on:false,I:0,k:0,col:[1,0.94,0.82]};
const k=flashBright(f.e)*flashFlick(S);
const I=FL_INTENSITY*k;
return {on:true,I:I,k:k,col:[1.0,0.94-0.10*(1-k),0.82-0.22*(1-k)]};
}
/* beam direction — exactly where the player looks (yaw + pitch) */
function flashDir(S){
const p=Math.max(-1.1,Math.min(1.1,S.pitch||0)),cp=Math.cos(p);
return [Math.cos(S.ang)*cp,Math.sin(p),Math.sin(S.ang)*cp];
}
function frameSlot(PJ,VW,CX,CY,CZ,CLIP,RON,FL){
const o=allocFrame(PJ,VW);
put4(o+FO_CAM,CX,CY,CZ,Q.fog);
put4(o+FO_FOG,FOGC[0],FOGC[1],FOGC[2],0);
put4(o+FO_MAP,GPU.mapW,GPU.mapH,CLIP,RON);
put4(o+FO_P1,S.time,Q.nrmK,Q.pomK||0,Q.detN||0);
putU(o+FO_I1,(S.seedTag|0)&0x7fffffff,0,0,0);
putF(o+FO_LAMPS,lampsArr.subarray(0,NLQ*4));
const F2=FL||{on:false,I:0,d:[0,0,1],o:[CX,CY,CZ],col:[1,0.94,0.82]};
put4(o+FO_FLASH,  F2.o[0],F2.o[1],F2.o[2],F2.on?F2.I:0);
put4(o+FO_FLASH+16,F2.d[0],F2.d[1],F2.d[2],FL_COS_OUT);
put4(o+FO_FLASH+32,FL_COS_IN,FL_RANGE,fshSlot,0);   /* flC.z — the flashlight's shadow-map slot */
put4(o+FO_FLASH+48,F2.col[0],F2.col[1],F2.col[2],0);
/* flE — the beam impact point (the secondary scatter source), flF — color+radius */
put4(o+FO_FLASH+64,F2.b?F2.b[0]:0,F2.b?F2.b[1]:0,F2.b?F2.b[2]:0,F2.b?F2.b[3]:0);
put4(o+FO_FLASH+80,F2.col[0],F2.col[1],F2.col[2],FL_BOUNCE_R);
return o; }
/* Frame flashlight params. The beam start — preliminarily "at the hand"
 (camera + forward 0.19 + right 0.045 + down 0.024 cells — an FK measurement
 over the viewmodel scale), refined to the flashlight head after the hand
 skinning (put4 below). The mirror slot — the start/direction reflected
 across the floor. */
const flSt=flashState(S);
const fshSlot=(flSt.on&&nSH<64)?nSH:-1;   /* the flashlight shadow slot in texSh — the next one after the lamps */
const flDir=flashDir(S);
const flR=[-Math.sin(S.ang),0,Math.cos(S.ang)];
const FL_MAIN={on:flSt.on,I:flSt.I,d:flDir,col:flSt.col,
o:[camX+flDir[0]*0.19+flR[0]*0.045,camY-0.024+flDir[1]*0.19,camZ+flDir[2]*0.19+flR[2]*0.045]};
const FL_REFL={on:flSt.on,I:flSt.I,col:flSt.col,
d:[flDir[0],-flDir[1],flDir[2]],o:[FL_MAIN.o[0],-FL_MAIN.o[1],FL_MAIN.o[2]]};
const fMain=frameSlot(proj,view,camX,camY,camZ,0.0,reflOn?1.0:0.0,FL_MAIN);
/* the viewmodel has its own projection: near 1.2 cm — the hands aren't
 "cropped" at the camera, the fov is slightly narrower than the world's —
 less distortion on the arms. */
const projVM=perspW(62*Math.PI/180,RW/RH,0.012,6.0);
const fVM=frameSlot(projVM,view,camX,camY,camZ,0.0,0.0,FL_MAIN);
const fRefl=reflOn?frameSlot(proj,viewMir,camX,-camY,camZ,1.0,0.0,FL_REFL):0;

const WL=wlList;wlList.length=0;   /* world draw list — a reusable array */
/* player body draw slot (rim=2) */
const oVM=allocDraw(); put4(oVM+DO_F2,2,0,0,0);
function chunk(model,opt){
const o=allocDraw(); const p=opt||{};
putM(o+DO_MODEL,model);
put4(o+DO_EM,p.emColor?p.emColor[0]:0,p.emColor?p.emColor[1]:0,p.emColor?p.emColor[2]:0,0);
put4(o+DO_FLAT,p.flatCol?p.flatCol[0]:0,p.flatCol?p.flatCol[1]:0,p.flatCol?p.flatCol[2]:0,0);
put4(o+DO_DOORIO,p.doorIn?p.doorIn[0]:0,p.doorIn?p.doorIn[1]:0,p.doorOut?p.doorOut[0]:0,p.doorOut?p.doorOut[1]:0);
put4(o+DO_AXIS,p.doorAxis?p.doorAxis[0]:0,p.doorAxis?p.doorAxis[1]:0,p.doorAxis?p.doorAxis[2]:0,0);
put4(o+DO_F1,p.emissive||0,p.emMode||0,p.flat||0,p.wobble||0);
put4(o+DO_F2,p.rim||0,p.doorMode||0,p.doorMix||0,p.dtex||0);
put4(o+DO_F3,p.f3?p.f3[0]:0,p.f3?p.f3[1]:0,p.f3?p.f3[2]:0,p.f3?p.f3[3]:0);   /* f3.y — gloss of flat items */
return o; }
/* draw mode: bit 0 — cull back faces; bit 1 (2) — don't draw in the mirror
 pass (the floor: the reflection doesn't need it, and a discard in fsWorld
 would cost early-z) */
function add(cull,mesh,off){ WL.push(cull,mesh,off); }

const oW=chunk(IDENT);
add(0,{buf:bufWorld,n:GPU.wCount},oW);
if(GPU.wFCount>0)add(2,{buf:bufWorldFloor,n:GPU.wFCount},oW);
const cap=Q.hdr?1.35:0.8, eb=1;
for(let i=0;i<nL;i++){
const I=lampsArr[i*4+3];
if(I<=0.05)continue;
const lm=m4t(lampsArr[i*4],LAMP_Y,lampsArr[i*4+1]);
add(1,MESH.lampH,chunk(lm));
add(1,MESH.lampP,chunk(lm,{emissive:1,emMode:4,flat:1,
emColor:[Math.min(cap,I*eb),Math.min(cap,I*0.93*eb),Math.min(cap,I*0.78*eb)]}));
}
function leafChunk(D,tmesh,topen,dmat){
doorSides(S,D);
return chunk(dmat||doorModel(D,topen),{doorMode:1,doorMix:doorMix(topen),
doorIn:[D.inL,D.inG],doorOut:[D.outL,D.outG],doorAxis:[D.ax,0,D.ay],
dtex:1}); }
add(0,MESH.door,leafChunk(GPU.DR.exit,MESH.door,Math.min(1,S.doorLeafT||0)));
for(const sd of GPU.DR.safe){
const t=S.doorState?S.doorState[sd.y*GPU.mapW+sd.x]:0;
const dm=doorModel(sd,t);
add(0,MESH.safe,leafChunk(sd,MESH.safe,t,dm));
/* wooden-door hardware rides on the leaf: belts, rivets, handle */
add(0,MESH.safeHw,chunk(dm,{flat:1,flatCol:[0.055,0.058,0.066],f3:[0,0.10,0,0]}));
}
/* the valve on the exit door leaf (on the player's side): turns while the key
 rotates it (doorT), after — stands turned */
{const D=GPU.DR.exit,dv=clp(S.doorT||0,0,1),aa=dv*dv*(3-2*dv)*Math.PI*6;
const vM=m4mul(doorModel(D,Math.min(1,S.doorLeafT||0)),
 m4mul(m4t(0,DOOR_H*0.525,-0.062),m4mul(m4rotZ(aa),m4sc(1.353))));  /* 1.353 — the size of the former textured valve */
add(0,MESH.valve,chunk(vM,{flat:1,flatCol:[0.17,0.18,0.20],f3:[0,0.25,0,0]}));}
/* FURNITURE AND SMALL ITEMS. The key lies in the drawer of the far cabinet
 (drawn together with the drawer when it's open). */
const PROP_D2=(Q.propDist)*(Q.propDist);
const sm3=x=>x*x*(3-2*x);
for(const b of (S.batts||[])){
if(b.taken)continue;
const bx=b.x+0.5-S.px, by=b.y+0.5-S.py;
if(bx*bx+by*by>PROP_D2)continue;
const bM=m4mul(m4t(b.x+0.5,0.0044,b.y+0.5),m4mul(m4rotY(b.rot*6.283),m4sc(PL_SCALE)));
add(0,MESH.battBody,chunk(bM,{flat:1,flatCol:[0.09,0.09,0.105],f3:[0,0.75,0,0]}));
add(0,MESH.battBand,chunk(bM,{flat:1,flatCol:[0.82,0.62,0.12],f3:[0,0.25,0,0]}));
}
/* items dropped by the player (G): lie on the floor, picked up with E */
for(const d of (S.drops||[])){
const dx0=d.wx-S.px, dy0=d.wy-S.py;
if(dx0*dx0+dy0*dy0>PROP_D2)continue;
const dM=m4mul(m4t(d.wx,0.0044,d.wy),m4mul(m4rotY(d.rot),m4sc(PL_SCALE)));
if(d.kind==='flash'){
add(0,MESH.flash,chunk(dM,{flat:1,flatCol:[0.085,0.09,0.105],f3:[0,0.85,0,0]}));
add(0,MESH.flashLens,chunk(dM,{flat:1,flatCol:[0.14,0.16,0.18],f3:[0,0.55,0,0]}));
}else if(d.kind==='key'){
add(0,MESH.key,chunk(dM,{flat:1,flatCol:[0.95,0.75,0.25],f3:[0,0.9,0,0]}));
}else{
add(0,MESH.battBody,chunk(dM,{flat:1,flatCol:[0.09,0.09,0.105],f3:[0,0.75,0,0]}));
add(0,MESH.battBand,chunk(dM,{flat:1,flatCol:[0.82,0.62,0.12],f3:[0,0.25,0,0]}));
}
}
for(const c of (S.cabs||[])){
const cx0=c.x+0.5-S.px, cy0=c.y+0.5-S.py;
if(cx0*cx0+cy0*cy0>PROP_D2)continue;
const cM=m4mul(m4t(c.x+0.5+c.wx*(0.5-CAB_D/2),0,c.y+0.5+c.wy*(0.5-CAB_D/2)),m4rotY(Math.atan2(c.wx,c.wy)));
add(0,MESH.cab,chunk(cM));
const op=sm3(Math.max(0,Math.min(1,c.open)));
const dM=m4mul(cM,m4t(0,0,-op*CAB_SLIDE));
add(0,MESH.cabDrawer,chunk(dM));
if(op>0.30&&!c.looted&&c.content){
 if(c.content==='key'){
  const iM=m4mul(dM,m4mul(m4t(0,0.0755,0.004),m4mul(m4rotY(c.phase*6.283),m4sc(PL_SCALE))));
  add(0,MESH.key,chunk(iM,{flat:1,flatCol:[0.95,0.75,0.25],f3:[0,0.9,0,0]}));
 }else{
  const iM=m4mul(dM,m4mul(m4t(-0.006,0.0665,0.004),m4mul(m4rotY(c.phase*6.283),m4sc(PL_SCALE))));
  add(0,MESH.battBody,chunk(iM,{flat:1,flatCol:[0.09,0.09,0.105],f3:[0,0.75,0,0]}));
  add(0,MESH.battBand,chunk(iM,{flat:1,flatCol:[0.82,0.62,0.12],f3:[0,0.25,0,0]}));
 }
}
}
/* safe-room table + the flashlight on it, until taken */
if(S.table){
const t=S.table;
const tx0=t.x+0.5-S.px, ty0=t.y+0.5-S.py;
if(tx0*tx0+ty0*ty0<=PROP_D2){
const tM=m4mul(m4t(t.x+0.5+t.wx*(0.5-TBL_D/2),0,t.y+0.5+t.wy*(0.5-TBL_D/2)),m4rotY(Math.atan2(t.wx,t.wy)));
add(0,MESH.table,chunk(tM));
if(!S.flashTaken){
const fM=m4mul(tM,m4mul(m4t(-0.045,TBL_H+0.012,-0.005),m4mul(m4rotY(0.55),m4sc(PL_SCALE))));
add(0,MESH.flash,chunk(fM,{flat:1,flatCol:[0.085,0.09,0.105],f3:[0,0.85,0,0]}));
add(0,MESH.flashLens,chunk(fM,{flat:1,flatCol:[0.14,0.16,0.18],f3:[0,0.55,0,0]}));
}
}
}
if((S.doorLeafT||0)>0.5){
const wc=S.winCell||S.door;
const pm=m4mul(m4t(wc.x+0.5,0.52,wc.y+0.5),m4mul(m4rotY(GPU.portalYaw),m4rotX(Math.PI/2)));
const pulse=0.7+0.3*Math.sin(S.time*3.1);
const pb=Q.hdr?1.3:1;
add(0,MESH.portal,chunk(pm,{emissive:1,emMode:2,flat:1,flatCol:[1,1,1],
emColor:[0.16*pulse*pb,0.95*pulse*pb,0.45*pulse*pb]}));
}
if(S.monster&&!S.caught){
/* the monster pose was computed EARLIER (before the shadow map) — the
 skeleton capsules and the cloak cloth use the same bone matrices. */
fkAll(GPU.rig,mPose,rootM); skinUp(SK.mon,null);
add(0,{buf:bufRig,n:GPU.rig.total},chunk(IDENT,{flat:1,flatCol:[0.045,0.038,0.062],rim:1}));
/* cloak — verlet cloth over the legs */
skirtSim(S,dt,mPose,GPU.rig,S.mYaw||0);
const nSk=skirtBuild(GPU.rig);
if(nSk>0){dev.queue.writeBuffer(bufSkirt,0,GPU.skirtArr.subarray(0,nSk*9));
add(0,{buf:bufSkirt,n:nSk},chunk(rootM,{flat:1,flatCol:[0.045,0.038,0.062],rim:1}));}
const hm=GPU.rig.B[GPU.rig.idx.hd].m;
const eyeB=Q.hdr?1.5:1;
for(const ex of [-0.030,0.030]){
add(0,MESH.eye,chunk(m4mul(hm,m4t(ex,0.095,0.060)),{emissive:1,emMode:1,flat:1,
emColor:[1.0*eyeB,0.16*eyeB,0.08*eyeB]}));
}
}
/* ================ CHARACTER ================
 Body: the world matrix (player position + yaw + floor support).
 Viewmodel: the same rig, root = invView·VM_FRAME, torso/head hidden.
 Mannequin: in the start room, cycles clips, reflects in puddles. */
/* bodyP was already computed above — for the camera (one playerPose call per
 frame). dy stays in rig units, m4t gets bodyP.dy*PL_SCALE exactly once. */
const bYaw=-((S.pYawVis===undefined?S.ang:S.pYawVis))-Math.PI/2;
fkAll(GPU.plRig,bodyP.pose,
 m4mul(m4t(S.px,bodyP.dy*PL_SCALE,S.py),m4mul(m4rotY(bYaw),m4sc(PL_SCALE))));
skinUp(SK.body,null);
/* body hands BEFORE the rig is overwritten by the viewmodel: items for the
 reflection and 3rd person */
const bodyMh=Float32Array.from(GPU.plRig.B[GPU.plRig.idx.haL].m);
const bodyMhl=Float32Array.from(GPU.plRig.B[GPU.plRig.idx.haR].m);
/* the full buffer is always drawn: csSkin collapses hidden-bone vertices to a
 point, such triangles aren't rasterized — the draw set doesn't depend on the
 pose. noVM — main-menu background: neither body nor arms are in frame. */
const nBody=S.noVM?0:GPU.plRig.total;
/* beam start — the exact flashlight head from the hand matrix (after skinning);
 held items: 3rd person — in the world draw list (reflect in puddles),
 1st person — in the viewmodel pass together with the arms. */
function refineFlashOrigin(Mh){
if(!flSt.on||!Mh)return;
const kindNow=(S.fl&&S.fl.rl>0)?'flash':((S.inv&&S.sel>=0&&S.inv[S.sel])?S.inv[S.sel].kind:null);
if(kindNow!=='flash')return;
const FM=m4mul(Mh,GRIP_FLASH);
let hx=FM[12]+FM[0]*FL_HEAD_X, hy=FM[13]+FM[1]*FL_HEAD_X, hz=FM[14]+FM[2]*FL_HEAD_X;
/* BEAM START NOT INSIDE A WALL. The flashlight head can end up in the masonry
 (the hand clamped later than the head / arms pressed to a wall / third person
 at a wall) — then the occlusion march started inside the wall and the light
 died ENTIRELY. Clamp the head along the free camera→head ray: the beam
 always starts in air. */
{
 const ddx=hx-camX, ddy=hy-camY, ddz=hz-camZ;
 const dl=Math.hypot(ddx,ddy,ddz);
 if(dl>1e-4){
  const nst=Math.max(2,Math.ceil(dl/0.02));
  let freeT=1;
  for(let q=1;q<=nst;q++){const tt=q/nst;
   if(blocked(S,camX+ddx*tt,camZ+ddz*tt)||camY+ddy*tt<0.055){freeT=(q-1)/nst;break}}
  if(freeT<1){
   let lo=freeT, hi=Math.min(1,freeT+1/nst);
   for(let i=0;i<8;i++){const m2=(lo+hi)*0.5;
    if(blocked(S,camX+ddx*m2,camZ+ddz*m2)||camY+ddy*m2<0.055)hi=m2;else lo=m2;}
   const k2=Math.max(0.02,lo*dl-0.02)/dl;
   hx=camX+ddx*k2; hy=camY+ddy*k2; hz=camZ+ddz*k2;
  }
 }
}
FL_MAIN.o[0]=hx;FL_MAIN.o[1]=hy;FL_MAIN.o[2]=hz;
FL_REFL.o[1]=-hy;
put4(fMain+FO_FLASH,hx,hy,hz,flSt.I);
put4(fVM+FO_FLASH,hx,hy,hz,flSt.I);
if(fRefl)put4(fRefl+FO_FLASH,hx,-hy,hz,flSt.I);
}
/* FLASHLIGHT LIGHT SCATTER: march the beam from the head to the impact
 (wall/floor/ceiling); the impact spot becomes a secondary source (flE/flF):
 indirect light floods the zone by the spot — arms, body, edges and corners
 outside the cone. Intensity — the FL_BOUNCE_K share of the beam brightness
 with quadratic falloff; no hit within the radius — no source. The spot is
 also injected into the irradiance field (giInj). */
let giX=0,giZ=0,giInj=0;
function refineFlashBounce(){
let bx=0,by=0,bz=0,bI=0;
const kindNow=(S.fl&&S.fl.rl>0)?'flash':((S.inv&&S.sel>=0&&S.inv[S.sel])?S.inv[S.sel].kind:null);
if(flSt.on&&kindNow==='flash'){
 const ox=FL_MAIN.o[0],oy=FL_MAIN.o[1],oz=FL_MAIN.o[2];
 const dx=flDir[0],dy=flDir[1],dz=flDir[2];
 const step=0.06, n=Math.ceil(FL_RANGE/step);
 let tHit=-1, lo=0, hi=0;
 const hitAt=t=>{const px=ox+dx*t,py=oy+dy*t,pz=oz+dz*t;
  return blocked(S,px,pz)||py<0.02||py>CEIL_H;};
 for(let q=1;q<=n;q++){const tt=q*step;
  if(hitAt(tt)){lo=tt-step;hi=tt;tHit=tt;break;}
  tHit=-1;}
 /* impact-border bisection: the spot position is continuous over the view
 turn — indirect light doesn't step by the march-step quantum. */
 if(tHit>0){for(let i2=0;i2<12;i2++){const m2=(lo+hi)*0.5;
  if(hitAt(m2))hi=m2;else lo=m2;}
  tHit=Math.max(0.02,lo);}
 /* close to a wall the beam hits centimeters from the lamp head: a coarse
 threshold would cut the bounce and gi injection with a JUMP (the light died
 abruptly at the wall). The spot point holds 1 cm off the surface — the
 source stays continuous. */
 if(tHit>0.015&&tHit<FL_RANGE-1e-6){
  const off=Math.min(0.10,Math.max(0,tHit-0.01));
  bx=ox+dx*(tHit-off); by=oy+dy*(tHit-off); bz=oz+dz*(tHit-off);
  const an=1-tHit/FL_RANGE; bI=flSt.I*FL_BOUNCE_K*an*an;
 }
}
put4(fMain+FO_FLASH+64,bx,by,bz,bI);
put4(fVM+FO_FLASH+64,bx,by,bz,bI);
if(fRefl)put4(fRefl+FO_FLASH+64,bx,-by,bz,bI);
giX=bx;giZ=bz;giInj=bI>0.001?bI*FL_GI_K:0;
}
let heldVMList=[];
let heldReflList=null;
if(S.thirdPerson&&nBody>0){
for(const it of heldDraws(bodyMh,bodyMhl,flSt))add(0,it[0],chunk(it[1],it[2]));
refineFlashOrigin(bodyMh);
}else if(nBody>0){
/* 1st person: the body reflects in puddles, the viewmodel with the item —
 not; without this the reflected body hands are empty ("air in hand"). Body
 items go in a separate list only into the mirror pass — in the main one they
 would duplicate the viewmodel. */
heldReflList=heldDraws(bodyMh,bodyMhl,flSt);
}
let nVM=0;
if(!S.thirdPerson&&!S.noVM){
 /* arms don't pass through walls/doors/floor: for each hand we measure the
 free distance along the camera→hand ray and pull the arms to the body. */
 if(S.vmTuckL===undefined){S.vmTuckL=0;S.vmTuckR=0;}
 {
  /* The constraint ray is measured on the "calm" pose (bob/fatigue off,
 vmTuck=0): else the tuck would move the very hand it is measured by — a
 feedback loop with gain ~1/0.08 self-oscillates (the arms shake at the wall).
 The calm pose is continuous over camera motion — the tuck target is smooth. */
  const cs=S._vmCalm||(S._vmCalm={});
  const preSt=Object.assign({},S,{vmTuckL:0,vmTuckR:0,bobA:0,stam:1,_exS:0,_calm:1,
   _actT:cs._actT,_actS:cs._actS,_grbS:cs._grbS});
  const pre=playerPoseFP(preSt,S.time);
  cs._actT=preSt._actT; cs._actS=preSt._actS; cs._grbS=preSt._grbS;
  const MM=fkChain(GPU.plRig,pre.pose,VM_FRAME,['haL','haR','m3L','m3R']);
  /* the ray is measured from the "calm" camera (no breathing bob): else at the
 wall the free distance pulses at the sway frequency and the arms shake even
 standing flush. */
  const iv=m4invView(look(S.px,eyeY0,S.py,S.ang,S.pitch||0));
  const wp=m=>[iv[0]*m[12]+iv[4]*m[13]+iv[8]*m[14]+iv[12],
               iv[1]*m[12]+iv[5]*m[13]+iv[9]*m[14]+iv[13],
               iv[2]*m[12]+iv[6]*m[13]+iv[10]*m[14]+iv[14]];
  /* With the flashlight in hand the constraint ray is measured to the lamp
 HEAD: the tube sticks ~13 cm out of the fist, and flush at a wall the beam
 start doesn't end up in the masonry. */
  let flashHeadW=null;
  {
   const rlT=!!(S.fl&&S.fl.rl>0);
   const heldT=!rlT&&!!(S.inv&&S.sel>=0&&S.inv[S.sel]&&S.inv[S.sel].kind==='flash');
   if(heldT&&MM['haL']){
    const HM=m4mul(MM['haL'],GRIP_FLASH);
    const px=iv[0]*HM[12]+iv[4]*HM[13]+iv[8]*HM[14]+iv[12];
    const py=iv[1]*HM[12]+iv[5]*HM[13]+iv[9]*HM[14]+iv[13];
    const pz=iv[2]*HM[12]+iv[6]*HM[13]+iv[10]*HM[14]+iv[14];
    const ax=iv[0]*HM[0]+iv[4]*HM[1]+iv[8]*HM[2];
    const ay=iv[1]*HM[0]+iv[5]*HM[1]+iv[9]*HM[2];
    const az=iv[2]*HM[0]+iv[6]*HM[1]+iv[10]*HM[2];
    const al=Math.hypot(ax,ay,az)||1;
    flashHeadW=[px+ax/al*FL_HEAD_X*PL_SCALE,py+ay/al*FL_HEAD_X*PL_SCALE,pz+az/al*FL_HEAD_X*PL_SCALE];
   }
  }
  const dtS=Math.min(0.05,Math.max(0.001,dt));
  for(const side of ['L','R']){
   const hb=MM['m3'+side]||MM['ha'+side];
   if(!hb)continue;
   const hw=(side==='L'&&flashHeadW)?flashHeadW:wp(hb);   /* L — to the flashlight head */
   const dx=hw[0]-S.px, dz=hw[2]-S.py, dy=hw[1]-eyeY0;
   const dist=Math.hypot(dx,dy,dz);
   let free=dist+0.5;
   const nstep=Math.max(2,Math.ceil(dist/0.02));
   let a=0,b=1,hit=false;
   for(let q=1;q<=nstep;q++){const tt=q/nstep;
    if(blocked(S,S.px+dx*tt,S.py+dz*tt)||eyeY0+dy*tt<0.055){a=(q-1)/nstep;b=tt;hit=true;break}}
   if(hit){
    /* bisection to 1e-3 — the intersection point is continuous over camera/arm
 motion, so the tuck doesn't quantize in 2 cm steps */
    for(let i=0;i<10;i++){const m2=(a+b)*0.5;
     if(blocked(S,S.px+dx*m2,S.py+dz*m2)||eyeY0+dy*m2<0.055)b=m2;else a=m2;}
    free=dist*b-0.03;
   }
   const k=clp((free-0.06)/Math.max(0.08,dist),0,1);
   const want=1-k;
   const cur=S['vmTuck'+side]||0;
   /* the LPF removes the per-frame flicker of the target at the border, the slew
 limit doesn't let the target jerk the arms; together — a tight press without shaking */
   const sk='vmTuckS'+side;
   let sm=(S[sk]===undefined)?cur:S[sk];
   sm+=(want-sm)*Math.min(1,dtS*10);
   S[sk]=sm;
   S['vmTuck'+side]=cur+clp(sm-cur,-2.5*dtS,2.5*dtS);
  }
 }
 const vmP=playerPoseFP(S,S.time);
 /* looking straight ahead — no legs needed (the body stands below the camera);
 looked down — the legs honestly appear */
 const hideSet=(S.pitch||0)>-0.35?GPU.hideFPl:GPU.plRig.hide;
 fkAll(GPU.plRig,vmP.pose,m4mul(m4invView(view),VM_FRAME));
 skinUp(SK.vm,hideSet);
 nVM=rigVisCount(GPU.plRig,hideSet);
 if(nVM>0){
 const Mh=Float32Array.from(GPU.plRig.B[GPU.plRig.idx.haL].m);
 const Mhl=Float32Array.from(GPU.plRig.B[GPU.plRig.idx.haR].m);
 heldVMList=heldDraws(Mh,Mhl,flSt);
 refineFlashOrigin(Mh);
 }
}
refineFlashBounce();   /* after the beam start is refined — the spot scatter point */
/* SHADOW MAP DATA (built by csShadow in the compute below). Packing — AFTER
 the beam-head refinement: the occlusion march starts in air, not in masonry.
 Capsules: monster → player → props (nMon/nPl fix the order). */
let cn=0;
for(const C of GPU.shCaps){ if(cn>=CAPS_MAX)break;
const o7=cn*7;capsArr[o7]=C[0];capsArr[o7+1]=C[1];capsArr[o7+2]=C[2];
capsArr[o7+3]=C[3];capsArr[o7+4]=C[4];capsArr[o7+5]=C[5];capsArr[o7+6]=C[6];cn++; }
dev.queue.writeBuffer(bufCaps,0,capsArr,0,Math.max(7,cn*7));
const nMonC=Math.min(GPU.shCaps.nMon||0,cn);
const propsStartC=Math.min((GPU.shCaps.nMon||0)+(GPU.shCaps.nPl||0),cn);
const segN=collectDoorSegs(S,segArr);
dev.queue.writeBuffer(bufSegs,0,segArr,0,Math.max(4,segN*4));
lshArr.fill(0);
lshArr.set(lampsArr.subarray(0,Math.min(lampsArr.length,SHL_MAX*4)));
lshArr[SHL_MAX*4]=FL_MAIN.o[0];lshArr[SHL_MAX*4+1]=FL_MAIN.o[1];lshArr[SHL_MAX*4+2]=FL_MAIN.o[2];
lshArr[SHL_MAX*4+3]=flSt.I;lshArr[SHL_MAX*4+4]=FL_RANGE;
dev.queue.writeBuffer(bufLampSh,0,lshArr);
/* shadow bands: per slot — either its capsule list (dirty), or the "clean"
 marker (csShadow skips the band, the buffer keeps the previous frame) */
const shAuxN=buildShadowAux(S,nSH,fshSlot,cn,nMonC,propsStartC,segN,shW,shRowsQ,
FL_MAIN.o,flSt.I,lampsArr,GPU.gridStage,ncell);
/* dataOffset/size in writeBuffer are in VIEW ELEMENTS (not bytes):
 shAuxN u32s, not shAuxN*4 — else on presets with shLamps≥16 the write went
 past the buffer size (OperationError "bytes to write is too large") */
dev.queue.writeBuffer(bufShAux,0,shAuxArr,0,shAuxN);
const shRowsTot=(nSH+(fshSlot>=0?1:0))*shRowsQ;
let nMan=0;
if(manOn&&devOn){
 const clip=mannequinClip(S);
 const mrate=GAIT_RATE[clip.name]||3.0;
 /* the mannequin switches clips by the same crossfade as the player (0.34 s);
 the auto-cycle changes the clip every 4 s. */
 if(clip.name!==(S._mWant||clip.name)){S._mPrev=S._mWant||clip.name;S._mPrevT0=S._mT0||S.time;
  S._mWant=clip.name;S._mT0=S.time;S._mK=0;}
 else S._mK=Math.min(1,(S._mK===undefined?0:S._mK)+dt/0.34);
 const mst={bobA:(clip.len<0&&GAIT_RATE[clip.name])?1:0,animPhase:S.time*mrate,
  runK:clip.name==='run'?1:0,
  stam:1,pitch:0,pAnimForce:clip.name,pAnimWant:clip.name,
  pAnimPrev:S._mPrev||null,pAnimK:(S._mK===undefined?1:S._mK),
  pAnimT0:S._mT0||0,pAnimPrevT0:S._mPrevT0||0,_snapB:S._mSnap||null};
 const mp=playerPose(mst,S.time);
 S._mSnap=mst._snapB||null;
 /* the mannequin goes to a neighbor free cell of the start room:
 it doesn't block the spawn point and is convenient to look at */
 let mcx=S.start.x,mcy=S.start.y,mcGot=false;
 /* a free neighbour; the spawn room is 1 cell — else its doorway */
 for(const want of [0,3]){
 if(mcGot)break;
 for(const dd of [[1,0],[-1,0],[0,1],[0,-1]]){
  const cx2=S.start.x+dd[0],cy2=S.start.y+dd[1];
  if(cx2>=0&&cy2>=0&&cx2<GPU.mapW&&cy2<GPU.mapH&&S.grid[cy2*GPU.mapW+cx2]===want){mcx=cx2;mcy=cy2;mcGot=true;break}
 } }
 const mx=mcx+0.5, my=mcy+0.5;
 const mFace=S.time*0.55;   /* slow turn: the model is seen from all sides */
 fkAll(GPU.plRig,mp.pose,
  m4mul(m4t(mx,mp.dy*PL_SCALE,my),m4mul(m4rotY(mFace),m4sc(PL_SCALE))));
 skinUp(SK.man,null);
 nMan=GPU.plRig.total;
}
/* lamp halos — one instance draw per pass */
glowN=0;
if(Q.glow&&nL>0){
for(let i=0;i<nL;i++){
const I=lampsArr[i*4+3];
if(I<=0.06)continue;
const lx=lampsArr[i*4],lz=lampsArr[i*4+1];
const dgx=lx-S.px,dgz=lz-S.py;
const dist2=dgx*dgx+dgz*dgz;
if(dist2>256)continue;
/* The halo doesn't adapt to the gaze and doesn't die because of a corner:
 the depth-test itself honestly cuts it with the wall. */
const dcam=Math.sqrt(dist2+0.137);
const o=glowN*8;
glowArr[o]=lx;glowArr[o+1]=LAMP_Y;glowArr[o+2]=lz;
glowArr[o+3]=Math.min(0.26+0.26*I,0.22+0.30*dcam);
glowArr[o+4]=I*0.60*Q.glowK;glowArr[o+5]=I*0.48*Q.glowK;glowArr[o+6]=I*0.34*Q.glowK;glowArr[o+7]=0;
glowN++;
}
if(glowN>0)dev.queue.writeBuffer(bufGlowI,0,glowArr,0,glowN*8);
}
/* ---- passes ---- */
const ENC=dev.createCommandEncoder();
const fogClear={r:FOGC[0],g:FOGC[1],b:FOGC[2],a:1};
/* the mirror pass "miss" (the ray went under the floor) — soft dark water,
not the near-black fog color: the blur taps must not give a black square */
const reflClear={r:0.030,g:0.033,b:0.040,a:1};

/* ---------------- COMPUTE: light field, shadows, skinning ----------------
 One pass for everything: the dispatches go strictly in write order, so
 csLmFinal leaves the lightmap ready before the first rasterization pass,
 csShadow — the shadow map, csSkin — the character vertex buffers. */
{
const CP=ENC.beginComputePass();
const ncellW=Math.ceil(ncell/256);
const oL=allocPP();
put4(oL+PO_V0,GPU.mapW,GPU.mapH,AMBIENT,SC_FLOOR);
put4(oL+PO_V1,giX,giZ,giInj,0);
CP.setBindGroup(0,bgCPP,[oL]);
CP.setPipeline(plLmInit); CP.setBindGroup(1,bgLmAB); CP.dispatchWorkgroups(ncellW);
CP.setPipeline(plLmIter);
for(let it=0;it<6;it++){ CP.setBindGroup(1,(it&1)?bgLmBA:bgLmAB); CP.dispatchWorkgroups(ncellW); }
CP.setPipeline(plLmFinal); CP.setBindGroup(1,bgLmAB); CP.dispatchWorkgroups(ncellW);
const oS=allocPP();
put4(oS+PO_V0,shW,shRowsQ,nSH,fshSlot);
put4(oS+PO_V1,LAMP_Y,DOOR_H,SH_EL0,SH_EL0+SH_EL1);
put4(oS+PO_V2,GPU.mapW,GPU.mapH,nMonC,propsStartC);
put4(oS+PO_V3,segN,cn,LAMP_R,0);
CP.setBindGroup(0,bgCPP,[oS]);
CP.setPipeline(plCSh); CP.setBindGroup(1,bgShLamp); CP.setBindGroup(2,bgShData);
CP.dispatchWorkgroups(Math.ceil(shW/8),Math.ceil(shRowsTot/8));
/* packing f32→half bits (r16float isn't written from compute in WebGPU core) */
const pitchU=(shPitch/4)|0;
const oP=allocPP();
put4(oP+PO_V0,shW,shRowsTot,pitchU,0);
CP.setBindGroup(0,bgCPP,[oP]);
CP.setPipeline(plPack); CP.setBindGroup(1,bgPack);
CP.dispatchWorkgroups(Math.ceil(pitchU*shRowsTot/256));
CP.setPipeline(plCSkin);
const wgm=Math.ceil(GPU.rig.total/256), wgp=Math.ceil(GPU.plRig.total/256);
if(S.monster&&!S.caught){ CP.setBindGroup(0,SK.mon.bg); CP.dispatchWorkgroups(wgm); }
CP.setBindGroup(0,SK.body.bg); CP.dispatchWorkgroups(wgp);
if(nVM>0){ CP.setBindGroup(0,SK.vm.bg); CP.dispatchWorkgroups(wgp); }
if(nMan>0){ CP.setBindGroup(0,SK.man.bg); CP.dispatchWorkgroups(wgp); }
CP.end();
/* half bits → the r16float shadow map: the pitch is a multiple of 256 (a copy
 requirement), only active rows are copied (lamps + the flashlight slot) */
ENC.copyBufferToTexture({buffer:bufShU16,offset:0,bytesPerRow:shPitch},
{texture:texSh},{width:shW,height:shRowsTot,depthOrArrayLayers:1});
}

/* drawing a ready character buffer (vertices computed by csSkin).
 The same buffer serves both passes: the model's world matrix doesn't change,
 and the mirror camera of the reflection pass itself gives the body in puddles. */
function drawRigBuf(pass,buf,count,frameOff,isRefl){
if(!GPU.plRig||count<=0)return;
const samples=isRefl?1:(GPU.msaa||1);
const pl=plOf('VM|'+samples+'|'+sceneFmt,{layout:worldLayout(),
vertex:{module:modWorld,entryPoint:'vsWorld',buffers:VBL_WORLD},
fragment:{module:modWorld,entryPoint:'fsWorld',targets:[{format:sceneFmt}]},
primitive:{topology:'triangle-list',frontFace:'ccw',cullMode:'none'},
depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'},
multisample:{count:samples}});
pass.setPipeline(pl);
pass.setBindGroup(0,bgW0,[frameOff]);
pass.setBindGroup(1,bgW1,[oVM]);
pass.setBindGroup(2,isRefl?bgW2refl:bgW2main);
pass.setVertexBuffer(0,buf);
pass.draw(count,1);
}
/* HELD ITEM. A list of [mesh, model, opt] from the hand bone matrices. The
 flashlight — in the right ('L'), the swap battery — in the left ('R') during
 the "took the dead one" / "inserts the new one" phases. The matrices — the
 very ones the rig is skinned with. */
function heldDraws(Mh,Mhl,flSt2){
const L=[];
if(!Mh)return L;
const flS=S.fl;
const rl=!!(flS&&flS.rl>0);
const kind=rl?'flash':((S.inv&&S.sel>=0&&S.inv[S.sel])?S.inv[S.sel].kind:null);
if(kind==='flash'){
const fM=m4mul(Mh,GRIP_FLASH);
L.push([MESH.flash,fM,{flat:1,flatCol:[0.085,0.09,0.105],f3:[0,0.85,0,0]}]);
const b=(flS.on&&flSt2.on)?Math.max(0,Math.min(1.15,flSt2.I/FL_INTENSITY)):0;
const cap=Q.hdr?1.5:0.85;
if(b>0.02)L.push([MESH.flashLens,fM,{emissive:1,emMode:1,flat:1,
emColor:[Math.min(cap,1.25*b),Math.min(cap,1.06*b),Math.min(cap,0.78*b)]}]);
else L.push([MESH.flashLens,fM,{flat:1,flatCol:[0.14,0.16,0.18],f3:[0,0.55,0,0]}]);
}else if(kind==='batt'){
const sM=m4mul(Mh,GRIP_BATT);
L.push([MESH.battBody,sM,{flat:1,flatCol:[0.09,0.09,0.105],f3:[0,0.75,0,0]}]);
L.push([MESH.battBand,sM,{flat:1,flatCol:[0.82,0.62,0.12],f3:[0,0.25,0,0]}]);
}else if(kind==='key'){
L.push([MESH.key,m4mul(Mh,GRIP_KEY),{flat:1,flatCol:[0.95,0.75,0.25],f3:[0,0.9,0,0]}]);
}
if(rl&&Mhl){
const u=(S.time-(flS.rlT0||0))/RL_DUR;
if(rlBattOld(u)||rlBattNew(u)){
const bM=m4mul(Mhl,GRIP_SMALL_L);
L.push([MESH.battBody,bM,{flat:1,flatCol:[0.09,0.09,0.105],f3:[0,0.7,0,0]}]);
L.push([MESH.battBand,bM,{flat:1,flatCol:[0.82,0.62,0.12],f3:[0,0.25,0,0]}]);
}
}
return L;
}
/* viewmodel item draws — the same pipeline as the arms (its own depth pass);
 isRefl — mirror pass: 1 sample and the refl set of world textures */
function drawHeldVM(pass,list,frameOff,isRefl){
if(!list.length)return;
const samples=isRefl?1:(GPU.msaa||1);
const pl=plOf('VM|'+samples+'|'+sceneFmt,{layout:worldLayout(),
vertex:{module:modWorld,entryPoint:'vsWorld',buffers:VBL_WORLD},
fragment:{module:modWorld,entryPoint:'fsWorld',targets:[{format:sceneFmt}]},
primitive:{topology:'triangle-list',frontFace:'ccw',cullMode:'none'},
depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'},
multisample:{count:samples}});
pass.setPipeline(pl);
pass.setBindGroup(0,bgW0,[frameOff]);
pass.setBindGroup(2,isRefl?bgW2refl:bgW2main);
for(const it of list){
pass.setBindGroup(1,bgW1,[chunk(it[1],it[2])]);
pass.setVertexBuffer(0,it[0].buf);
pass.draw(it[0].n,1);
}
}
/* mannequin: which clip to cycle. -1 = auto-cycle over all animations. */
function mannequinClip(S){
const L=ANIM_CLIPS.length;
if(S.manAnim!==undefined&&S.manAnim!==null&&S.manAnim>=0)return ANIM_CLIPS[S.manAnim%L];
const idx=Math.floor(S.time/4.0)%L;
return ANIM_CLIPS[idx];
}
function drawWorld(pass,frameOff,isRefl,frontFace){
const samples=isRefl?1:(GPU.msaa||1);
const plN=plWorld(frontFace,'none',samples,sceneFmt);
const plC=plWorld(frontFace,'back',samples,sceneFmt);
pass.setBindGroup(0,bgW0,[frameOff]);
pass.setBindGroup(2,isRefl?bgW2refl:bgW2main);
let cur=null;
for(let i=0;i<WL.length;i+=3){
const mode=WL[i];
if(isRefl&&mode>=2)continue;   /* the floor isn't drawn in the mirror pass */
const pl=(mode&1)?plC:plN;
if(pl!==cur){pass.setPipeline(pl);cur=pl;}
pass.setBindGroup(1,bgW1,[WL[i+2]]);
pass.setVertexBuffer(0,WL[i+1].buf);
pass.draw(WL[i+1].n,1);
}
if(Q.glow&&glowN>0){
const o=allocPP();
putM(o+PO_M0,proj); putM(o+PO_M1,isRefl?viewMir:view);
put4(o+PO_V1,0,0,0,Q.fog);
put4(o+PO_V2,S.px,isRefl?-camY:camY,S.py,0);
const pl=plOf('G|'+samples+'|'+sceneFmt,{layout:layoutOf([BGLS.pp,BGLS.glow]),
vertex:{module:modOf(WGS_GLOW),entryPoint:'vsG',buffers:VBL_GLOW},
fragment:{module:modOf(WGS_GLOW),entryPoint:'fsG',targets:[{format:sceneFmt,blend:BL_ADD}]},
primitive:{topology:'triangle-list'},
depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'},
multisample:{count:samples}});
pass.setPipeline(pl);
pass.setBindGroup(0,bgPP,[o]);
pass.setBindGroup(1,bgGlowEmpty);
pass.setVertexBuffer(0,bufGlowQ);
pass.setVertexBuffer(1,bufGlowI);
pass.draw(6,glowN);
}
}
/* pass 1 — the mirror camera below the floor: gives puddles an honest
 reflection. Skipped entirely if no puddles are in the frustum (reflOn) */
if(reflOn){
const p=ENC.beginRenderPass({
colorAttachments:[{view:T.reflC.v,clearValue:reflClear,loadOp:'clear',storeOp:'store'}],
depthStencilAttachment:{view:T.reflD.v,depthLoadOp:'clear',depthStoreOp:'discard',depthClearValue:1}});
drawWorld(p,fRefl,true,'cw');
/* mirror pass: body and mannequin reflect in puddles honestly */
if(nMan>0)drawRigBuf(p,bufMan,nMan,fRefl,true);
if(nBody>0)drawRigBuf(p,bufPlRig,nBody,fRefl,true);
if(heldReflList)drawHeldVM(p,heldReflList,fRefl,true);   /* the item in the body's hand */
p.end();
}
/* pass 2 — the main one */
const ms=GPU.msaa||0;
/* if the viewmodel pass follows, it re-resolves msC→scene itself —
 resolving after the main pass would be an extra fullscreen copy */
const vmAfter=!!(ms&&!S.thirdPerson&&nVM>0);
const cd={view:ms?T.msC.v:T.scene.v,clearValue:fogClear,loadOp:'clear',storeOp:'store'};
if(ms&&!vmAfter)cd.resolveTarget=T.scene.v;
const dd={view:ms?T.msD.v:T.depth.v,depthLoadOp:'clear',depthStoreOp:ms?'discard':'store',depthClearValue:1};
if(ms){dd.depthResolveFilter='nearest';dd.resolveTarget=T.depth.v;}
const pMain=ENC.beginRenderPass({colorAttachments:[cd],depthStencilAttachment:dd});
drawWorld(pMain,fMain,false,'ccw');
/* main pass: mannequin + (body in 3rd person OR arms in 1st) */
if(nMan>0)drawRigBuf(pMain,bufMan,nMan,fMain,false);
if(S.thirdPerson){ if(nBody>0)drawRigBuf(pMain,bufPlRig,nBody,fMain,false); }
pMain.end();
let volView=null;
if((Q.ssao|0)>0&&T.ao&&ssaoK){
const aw=T.ao.w,ah=T.ao.h;
const o=allocPP();
putM(o+PO_M0,proj);
put4(o+PO_V0,proj[0],proj[5],aw/4,ah/4);
put4(o+PO_V1,zA,zB,Q.ssaoR||0.42,0.03);
put4(o+PO_V2,(S.time*7.31)%1,view[1],view[5],view[9]);
putF(o+PO_K,ssaoK);
const bg=bgTexC('ao',BGLS.ao,[{binding:0,resource:T.depth.v},{binding:1,resource:sDep},
{binding:2,resource:V.texNoise},{binding:3,resource:sNoise}]);
const pl=plPost('AO',modSsao,'fsAO',BGLS.ao,'r8unorm',null,1);
const pa=ENC.beginRenderPass({colorAttachments:[{view:T.ao.v,clearValue:{r:1,g:1,b:1,a:1},loadOp:'clear',storeOp:'store'}]});
fullDraw(pa,pl,o,bg); pa.end();
/* two-sided blur with depth retention */
const o2=allocPP(); put4(o2+PO_V0,1/aw,0,zA,zB);
const bgH=bgTexC('abH',BGLS.aoB,[{binding:0,resource:T.ao.v},{binding:1,resource:sLin},
{binding:2,resource:T.depth.v},{binding:3,resource:sDep}]);
const pl2=plPost('AB',WGS_AOBLUR,'fsAB',BGLS.aoB,'r8unorm',null,1);
const p2=ENC.beginRenderPass({colorAttachments:[{view:T.ao2.v,loadOp:'clear',clearValue:{r:1,g:1,b:1,a:1},storeOp:'store'}]});
fullDraw(p2,pl2,o2,bgH); p2.end();
const o3=allocPP(); put4(o3+PO_V0,0,1/ah,zA,zB);
const bgV=bgTexC('abV',BGLS.aoB,[{binding:0,resource:T.ao2.v},{binding:1,resource:sLin},
{binding:2,resource:T.depth.v},{binding:3,resource:sDep}]);
const p3=ENC.beginRenderPass({colorAttachments:[{view:T.ao.v,loadOp:'clear',clearValue:{r:1,g:1,b:1,a:1},storeOp:'store'}]});
fullDraw(p3,pl2,o3,bgV); p3.end();
}
if((Q.vol|0)>0&&T.volA){
const o=allocPP();
putM(o+PO_M0,m4invView(view));
put4(o+PO_V0,GPU.mapW,GPU.mapH,proj[0],proj[5]);
put4(o+PO_V1,zA,zB,7.0,(S.time*3.77)%1);
const dw=Math.abs(wrapPi(S.ang-(GPU.pyaw===undefined?S.ang:GPU.pyaw)))+Math.abs((S.pitch||0)-(GPU.pyawp||0));
GPU.pyaw=S.ang; GPU.pyawp=S.pitch||0;
put4(o+PO_V2,Math.min(1,0.45+dw*6),0.055*(Q.volK||1),0.22*(Q.volK||1),0.02);
const nv=Math.min(nL,8);
volArr.fill(0); volArr.set(lampsArr.subarray(0,nv*4));
put4(o+PO_V3,S.px,0.55,S.py,nv);
/* flashlight in the volumetric light — cone/range/brightness */
put4(o+PO_V4,FL_MAIN.o[0],FL_MAIN.o[1],FL_MAIN.o[2],flSt.on?flSt.I:0);
put4(o+PO_V5,flDir[0],flDir[1],flDir[2],FL_COS_OUT);
put4(o+PO_V6,FL_COS_IN,FL_RANGE,0,0);
putF(o+PO_K,volArr);
const bg=bgTexC('vol'+volPhase,BGLS.vol,[{binding:0,resource:T.depth.v},{binding:1,resource:sDep},
{binding:2,resource:V.texLM},{binding:3,resource:sLin},{binding:4,resource:T.volB.v}]);
const pl=plPost('VL',modVol,'fsV',BGLS.vol,sceneFmt,null,1);
const p=ENC.beginRenderPass({colorAttachments:[{view:T.volA.v,loadOp:'load',storeOp:'store'}]});
fullDraw(p,pl,o,bg); p.end();
const done=T.volA;
const swpA=T.volA;T.volA=T.volB;T.volB=swpA;
volView=done.v; volPhase^=1;
}
/* viewmodel pass: its own depth (cleared) — arms over the world, its own
 projection — not cut by the near plane. vmTuck leads the arms off walls. */
if(!S.thirdPerson&&nVM>0){
const pVM=ENC.beginRenderPass({
colorAttachments:ms?[{view:T.msC.v,loadOp:'load',storeOp:'discard',resolveTarget:T.scene.v}]
                   :[{view:T.scene.v,loadOp:'load',storeOp:'store'}],
depthStencilAttachment:{view:ms?T.msDvm.v:T.vmD.v,
 depthLoadOp:'clear',depthStoreOp:'discard',depthClearValue:1}});
drawRigBuf(pVM,bufPlRigB,GPU.plRig.total,fVM,false);   /* full buffer: hidden bones are degenerated by csSkin */
drawHeldVM(pVM,heldVMList,fVM,false);   /* held item — over the world, like the arms */
pVM.end();
}
let stkView=null,expView=null;
if(Q.post&&T.bl.length){
const o=allocPP();
const bg0Entries=[{binding:0,resource:T.scene.v},{binding:1,resource:sLin}];
if(compB.bindings.vol!==undefined)bg0Entries.push({binding:2,resource:volView||V.texBlack});
const bg0=bgTexC('br'+((compB.bindings.vol!==undefined)?volPhase:'x'),(compB.bindings.vol!==undefined)?BGLS.two:BGLS.one,bg0Entries);
const pl0=plPost('BR'+((Q.vol|0)>0?1:0),modBright,'fsB',bg0Entries.length>2?BGLS.two:BGLS.one,sceneFmt,null,1);
const p0=ENC.beginRenderPass({colorAttachments:[{view:T.bl[0].v,loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});
fullDraw(p0,pl0,o,bg0); p0.end();
const plD=plPost('DN',WGS_DOWN,'fsD',BGLS.one,sceneFmt,null,1);
for(let i=1;i<T.bl.length;i++){
const od=allocPP(); put4(od+PO_V0,1/T.bl[i-1].w,1/T.bl[i-1].h,0,0);
const bgd=bgTexC('dn'+i,BGLS.one,[{binding:0,resource:T.bl[i-1].v},{binding:1,resource:sLin}]);
const pd=ENC.beginRenderPass({colorAttachments:[{view:T.bl[i].v,loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});
fullDraw(pd,plD,od,bgd); pd.end();
}
const plU=plPost('UP',WGS_UP,'fsU',BGLS.one,sceneFmt,BL_ADD,1);
for(let i=T.bl.length-2;i>=0;i--){
const ou=allocPP(); put4(ou+PO_V0,1/T.bl[i+1].w,1/T.bl[i+1].h,0,0);
const bgu=bgTexC('up'+i,BGLS.one,[{binding:0,resource:T.bl[i+1].v},{binding:1,resource:sLin}]);
const pu=ENC.beginRenderPass({colorAttachments:[{view:T.bl[i].v,loadOp:'load',storeOp:'store'}]});
fullDraw(pu,plU,ou,bgu); pu.end();
}
if((Q.flare|0)>0&&T.stk){
const os=allocPP(); put4(os+PO_V0,0.32,0,0,0);
const bgs=bgTexC('st',BGLS.one,[{binding:0,resource:T.bl[0].v},{binding:1,resource:sLin}]);
const plS=plPost('ST',WGS_STREAK,'fsSt',BGLS.one,sceneFmt,null,1);
const ps=ENC.beginRenderPass({colorAttachments:[{view:T.stk.v,loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});
fullDraw(ps,plS,os,bgs); ps.end();
stkView=T.stk.v;
}
if(GPU.aexpOn&&T.ed){
const oe=allocPP(); put4(oe+PO_V0,1/RW,1/RH,0,0);
const bge=bgTex(BGLS.one,[{binding:0,resource:T.scene.v},{binding:1,resource:sLin}]);
const pe=ENC.beginRenderPass({colorAttachments:[{view:T.ed.v,loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});
fullDraw(pe,plD,oe,bge); pe.end();
const oa=allocPP(); put4(oa+PO_V0,Math.min(0.1,dt),0.4,0,0);
const bga=bgTex(BGLS.two,[{binding:0,resource:T.ed.v},{binding:1,resource:sLin},{binding:2,resource:T.eb.v}]);
const plA=plPost('AD',WGS_ADAPT,'fsAd',BGLS.two,sceneFmt,null,1);
const pa2=ENC.beginRenderPass({colorAttachments:[{view:T.ea.v,loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});
fullDraw(pa2,plA,oa,bga); pa2.end();
expView=T.ea.v;
const sw=T.ea;T.ea=T.eb;T.eb=sw;
}
const B=compB.bindings;
const oc=allocPP();
put4(oc+PO_V0,(S.monster&&S.mMode==='chase')?1:0,S.time,Q.exposure,Q.bloomK);
put4(oc+PO_V1,Q.ca,Q.grain,DARK_SAT,DARK_SAT_LO);
put4(oc+PO_V2,Q.dither||0,T.ao?(Q.ssaoK||0.85):0,Q.grade||0,Q.flareK||0);
const ce=[{binding:B.scene,resource:T.scene.v},{binding:B.bloom,resource:T.bl[0].v}];
if(B.ao!==undefined)ce.push({binding:B.ao,resource:T.ao?T.ao.v:V.texWhite});
if(B.vol!==undefined)ce.push({binding:B.vol,resource:volView||V.texBlack});
if(B.stk!==undefined)ce.push({binding:B.stk,resource:stkView||V.texBlack});
if(B.exp!==undefined)ce.push({binding:B.exp,resource:expView||V.texWhite});
ce.push({binding:B.samp,resource:sLin});
const bgC=bgTexC('cp'+((B.vol!==undefined)?volPhase:'x'),BGLS.comp,ce);
const tgtFmt=T.L?  'rgba8unorm':ctxFmt;
const plC=plPost('CP',compB.src,'fsC',BGLS.comp,tgtFmt,null,1);
const pC=ENC.beginRenderPass({colorAttachments:[{view:T.L?T.L.v:ctx.getCurrentTexture().createView(),
loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
fullDraw(pC,plC,oc,bgC); pC.end();
if(T.L){
const os2=allocPP(); put4(os2+PO_V0,1/RW,1/RH,Q.sharp||0,0);
const bgS=bgTexC('sh',BGLS.one,[{binding:0,resource:T.L.v},{binding:1,resource:sLin}]);
const plS2=plPost('SH',WGS_SHARP,'fsS',BGLS.one,ctxFmt,null,1);
const pS=ENC.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),
loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
fullDraw(pS,plS2,os2,bgS); pS.end();
}
}else{
const ob=allocPP();
put4(ob+PO_V0,DARK_SAT,DARK_SAT_LO,Q.dither||0,S.time);
const bgB=bgTexC('bl',BGLS.one,[{binding:0,resource:T.scene.v},{binding:1,resource:sLin}]);
const plB=plPost('BL',WGS_BLIT,'fsBl',BGLS.one,ctxFmt,null,1);
const pB=ENC.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),
loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});
fullDraw(pB,plB,ob,bgB); pB.end();
}
ubFlush();
dev.queue.submit([ENC.finish()]);
/* counter of honestly drawn frames — the base of the FPS indicator (see frame()) */
try{ dev.queue.onSubmittedWorkDone().then(()=>{GPU.framesDone=(GPU.framesDone||0)+1}).catch(()=>{}); }catch(e){}
};

GPU.clearBlack=function(){
if(!GPU.ready||!dev||!ctx)return;
try{
const e=dev.createCommandEncoder();
const p=e.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),
clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});
p.end(); dev.queue.submit([e.finish()]);
}catch(err){} };
GPU.look=look;

GPU._test={fsWorldSrc:wgslWorld,doorRig:doorRig,leafMeshData:leafMeshData,buildRig:buildRig,quadUV:quadUV,
collectShadowCaps:collectShadowCaps,collectDoorSegs:collectDoorSegs,collectGridU32:collectGridU32,collectLamps:collectLamps,
fkAll:fkAll,rigSrcData:rigSrcData,rigVisCount:rigVisCount,m4mul:m4mul,m4t:m4t,m4rotY:m4rotY,m4sc:m4sc,
WGS_SKIN:()=>WGS_SKIN,WGS_LM:()=>WGS_LM,WGS_SHADOW:()=>WGS_SHADOW,
genPuddleMap:genPuddleMap,lampFixtureData:lampFixtureData,
boxMeshData:boxMeshData,discMeshData:discMeshData,buildKeyMeshData:buildKeyMeshData,
buildFlashlightData:buildFlashlightData,buildFlashLensData:buildFlashLensData,
buildBatteryBodyData:buildBatteryBodyData,buildBatteryBandData:buildBatteryBandData,
buildCabinetData:buildCabinetData,buildCabinetDrawerData:buildCabinetDrawerData,buildTableData:buildTableData,
GRIP_FLASH:()=>GRIP_FLASH,GRIP_KEY:()=>GRIP_KEY,GRIP_BATT:()=>GRIP_BATT,GRIP_SMALL_L:()=>GRIP_SMALL_L,rlSample:rlSample,
rlBattOld:rlBattOld,rlBattNew:rlBattNew,gripHand:gripHand,heldMat:heldMat,
worldData:worldData,monPose:monPose,monGaitPose:monGaitPose,MON_GAIT:MON_GAIT,MON_GAIT_K:MON_GAIT_K,monFootLowest:monFootLowest,monLegFK:monLegFK,
/* the character is available to dev tools and autotests */
playerRig:()=>GPU.plRig,buildPlayerRig:buildPlayerRig,skinRigEx:skinRigEx,
playerPose:playerPose,playerPoseFP:playerPoseFP,poseFromClip:poseFromClip,
animNames:animNames,animLabels:animLabels,ANIM_CLIPS:ANIM_CLIPS,GAIT_RATE:GAIT_RATE,GAIT_K:GAIT_K,
VM_FRAME:()=>VM_FRAME,HIDE_FP:()=>HIDE_FP_NAMES,genSkinTex:genSkinTex,PREG:()=>PREG,PMAT:()=>PMAT,
getAtlas:getAtlas,buildAtlasData:buildAtlasData,applyAtlasQ:applyAtlasQ,heightToNormal:heightToNormal,
atlasDims:()=>({AQ:AQ,AW:AW,AH:AH}),
uv:()=>({UV_WALL:UV_WALL,UV_FLOOR:UV_FLOOR,UV_WOOD:UV_WOOD,UV_CEIL:UV_CEIL,UV_IRON:UV_IRON,UV_IRON2:UV_IRON2}),
shaders:()=>({VS_WORLD:wgslWorld(Q),VS_POST:WGS_PP,FS_BRIGHT:wgslBright(Q),
FS_DOWN:WGS_DOWN,FS_UP:WGS_UP,FS_SHARP:WGS_SHARP,FS_COMP:compB?compB.src:'',FS_BLIT:WGS_BLIT,
VS_GLOW:WGS_GLOW,FS_GLOW:WGS_GLOW,FS_AOBLUR:WGS_AOBLUR,
FS_SSAO:(Q.ssao|0)>0?wgslSsao(Q):'',FS_VOL:(Q.vol|0)>0?wgslVol(Q):'',
FS_STREAK:WGS_STREAK,FS_ADAPT:WGS_ADAPT,
fsUltra:wgslWorld(QUALITY.ultra),fsHigh:wgslWorld(QUALITY.high),
fsMedium:wgslWorld(QUALITY.medium),fsLow:wgslWorld(QUALITY.low),
fsMax:wgslWorld(QUALITY.max),
fsSsaoUltra:wgslSsao(QUALITY.ultra),fsVolUltra:wgslVol(QUALITY.ultra)}),
ssaoKernel:ssaoKernel,m4invView:m4invView};
/* the character is needed by the core scripts (update) and by the input/dev-panel
 code, but declared inside this IIFE — publish to window */
window.playerAutoAnim=playerAutoAnim; window.poseDistSnap=poseDistSnap; window.ANIM_CLIPS=ANIM_CLIPS;
window.animNames=animNames; window.animLabels=animLabels; window.GAIT_RATE=GAIT_RATE;
window.GAIT_K=GAIT_K;   /* needed by the core scripts (update) — gait phase coefficients */
window.MON_GAIT_K=MON_GAIT_K;   /* same for the monster gait — needed by the core scripts (stepMonster) */
window.playerPose=playerPose; window.playerPoseFP=playerPoseFP;
window.poseFromClip=poseFromClip;
window.buildPlayerRigFn=buildPlayerRig; window.skinRigExFn=skinRigEx;
})();

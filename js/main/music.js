/* ==== PROCEDURAL MAIN-MENU MUSIC (asset-free engine port) ====
   Seamless 32 s loop: frequencies and LFOs are quantized (f·L — an integer),
   the noise buffer length (8 s) divides the loop — the phase converges at the
   seam. Every cycle is laid out with its own grain (seed + index·7919): cycles
   don't repeat, the mood stays stable. The music seed is dynamic and does NOT
   depend on the map seed.
   fear f∈[0..1] — the "scariness" of the current difficulty (the "custom"
   preset is always 0, like practice). f interpolates slowly, the continuous
   layers' gains ride setTargetAtTime — difficulty/slider changes morph the
   mix on the fly, seamlessly. */
const mClamp=(v,a,b)=>v<a?a:(v>b?b:v),mLerp=(a,b,t)=>a+(b-a)*t;
function musCurve(drive){
const n=2048,c=new Float32Array(n),norm=Math.tanh(drive);
for(let i=0;i<n;i++){const x=(i*2)/n-1;c[i]=Math.tanh(drive*x)/norm}
return c;
}
class MusEng{
constructor(ctx,seed,p){
this.ctx=ctx;this.sr=ctx.sampleRate;this.L=32;
this.seed=seed>>>0;this.p=p;this.fear=0;this.fearT=0;
this.running=false;this._cont=[];this._tmp=[];this.fearFn=null;
this.rnd=xsFromU32(this.seed).rnd;
/* a separate PRNG for the noise buffers and the reverb impulse response */
this._nrnd=xsFromU32((this.seed^0x9E3779B9)>>>0).rnd;
this.q=f=>{const k=Math.round(f*this.L);return(k===0?1:k)/this.L};
this._build();this._buffers();
}
_build(){
const c=this.ctx;
this.master=c.createGain();this.master.gain.value=0.0001;
/* static soft limiting — the mix "glue"; doesn't break the seamlessness */
this.shaper=c.createWaveShaper();this.shaper.curve=musCurve(1.25);this.shaper.oversample='2x';
this.out=c.createGain();this.out.gain.value=1;
this.master.connect(this.shaper);this.shaper.connect(this.out);
this.out.connect(AU.duck?AU.duck:c.destination);   /* common bus: duck/limiter */
this.dry=c.createGain();this.dry.gain.value=1;this.dry.connect(this.master);
/* reverberation: a dark long tail (~6 s) */
this.revSend=c.createGain();this.revSend.gain.value=mClamp(this.p.reverb,0,1);
this.conv=c.createConvolver();this.conv.normalize=true;this.conv.buffer=this._makeIR(6.0,2.3);
this.revTone=c.createBiquadFilter();this.revTone.type='lowpass';this.revTone.frequency.value=3200;this.revTone.Q.value=0.5;
this.revHp=c.createBiquadFilter();this.revHp.type='highpass';this.revHp.frequency.value=85;
this.revSend.connect(this.conv);this.conv.connect(this.revTone);
this.revTone.connect(this.revHp);this.revHp.connect(this.master);
/* short echo — "corridor" depth */
this.echoSend=c.createGain();this.echoSend.gain.value=0.55;
this.echo=c.createDelay(2.0);this.echo.delayTime.value=0.42;
this.echoLp=c.createBiquadFilter();this.echoLp.type='lowpass';this.echoLp.frequency.value=1700;
this.echoFb=c.createGain();this.echoFb.gain.value=0.34;
this.echoSend.connect(this.echo);this.echo.connect(this.echoLp);
this.echoLp.connect(this.echoFb);this.echoFb.connect(this.echo);this.echoLp.connect(this.master);
}
_g(v){const n=this.ctx.createGain();n.gain.value=v;return n}
/* voice routing: dry / reverb / echo + stereo */
_route(node,dry,wet,pan,echo){
let src=node;
if(pan){const p=this.ctx.createStereoPanner();p.pan.value=mClamp(pan,-1,1);src.connect(p);src=p}
if(dry>0){const g=this._g(dry);src.connect(g);g.connect(this.dry)}
if(wet>0){const g=this._g(wet);src.connect(g);g.connect(this.revSend)}
if(echo>0){const g=this._g(echo);src.connect(g);g.connect(this.echoSend)}
}
_cyclicNoise(seconds,brown){
const sr=this.sr,len=Math.max(1,Math.floor(seconds*sr)),xf=Math.floor(0.35*sr);
const raw=new Float32Array(len+xf);
const nz=xsBulk((this._nrnd()*4294967296)>>>0);   /* bulk fill — the tag is from the seeded stream */
let last=0;
for(let i=0;i<raw.length;i++){
const w=nz()*2-1;
if(brown){last=(last+0.02*w)/1.02;raw[i]=last*3.2}
else raw[i]=w;
}
const buf=this.ctx.createBuffer(1,len,sr),d=buf.getChannelData(0);
for(let i=0;i<len;i++)d[i]=raw[i];
for(let i=0;i<xf;i++){                       /* stitching the ends → a click-free loop */
const t=i/xf;
d[i]=raw[i]*t+raw[len+i]*(1-t);
}
return buf;
}
_makeIR(seconds,decay){
const sr=this.sr,n=Math.max(1,Math.floor(seconds*sr));
const buf=this.ctx.createBuffer(2,n,sr);
for(let ch=0;ch<2;ch++){
const d=buf.getChannelData(ch);
const nz=xsBulk((this._nrnd()*4294967296)>>>0);   /* own tag per channel */
let lp=0;const a=0.28;
for(let i=0;i<n;i++){
const t=i/n;
const env=Math.pow(1-t,decay)*Math.exp(-2.2*t);
const w=nz()*2-1;
lp+=a*(w-lp);                                /* damping: the tail darkens */
d[i]=lp*env;
}
for(let k=0;k<9;k++){                        /* early reflections */
const pos=Math.floor((0.008+k*0.019+this._nrnd()*0.006)*sr);
if(pos<n)d[pos]+=(k%2?-1:1)*0.55*Math.exp(-k*0.42);
}
}
return buf;
}
_buffers(){
/* the noise buffer length must fit into the loop an integer number of times (8 | 32) */
this.noiseBuf=this._cyclicNoise(8,false);
this.brownBuf=this._cyclicNoise(8,true);
}
_noiseSrc(t,dur){
const s=this.ctx.createBufferSource();
s.buffer=this.noiseBuf;s.loop=true;
s.playbackRate.value=mLerp(0.85,1.15,this.rnd());
const maxOff=Math.max(0.001,this.noiseBuf.duration-dur-0.05);
s.start(t,this.rnd()*maxOff);
s.stop(t+dur);
this._track(s,t+dur);
return s;
}
_track(node,end){node._end=end;this._tmp.push(node);return node}
_prune(){
const now=this.ctx.currentTime;
if(this._tmp.length>400)this._tmp=this._tmp.filter(n=>n._end>now);
}
/* ---------------- continuous layers (drone) ---------------- */
/* Target layer levels — both at start and in applyParams: sliders without jumps */
_levels(){
const p=this.p;
return{
drone:0.44+0.46*p.intensity,
sub:0.75+0.25*p.intensity,
pad:0.45+0.85*p.dread,
choir:0.30+0.75*p.dread,
wind:0.024+0.028*p.intensity,
rumble:0.045+0.055*p.intensity,
shimmer:0.50+1.00*p.dread,
air:0.0075+0.0085*p.intensity,
bus:0.50+0.50*p.intensity};
}
startContinuous(at){
const c=this.ctx,q=this.q,L=this.L;
const LV=this._levels();
const bus=c.createGain();bus.gain.value=0.0001;
const level=c.createGain();level.gain.value=LV.drone;this.droneLevel=level;
bus.connect(level);
level.connect(this.dry);
const wet=this._g(0.42);level.connect(wet);wet.connect(this.revSend);
this.bus=bus;
/* LFOs are quantized to k/L (integer periods per cycle) and spread over k —
 the voices' breathing is decorrelated, and the cycle seam is seamless */
const mk=(type,freq,gain,dest,opt)=>{
opt=opt||{};
const o=c.createOscillator();o.type=type;
const fEff=q(freq*Math.pow(2,(opt.detune||0)/1200));
o.frequency.setValueAtTime(fEff,at);
const g=c.createGain();g.gain.setValueAtTime(gain,at);
if(opt.lfo){
const l=c.createOscillator();l.type='sine';
l.frequency.setValueAtTime(Math.max(opt.lfo.k,1)/L,at);
const lg=c.createGain();lg.gain.setValueAtTime(gain*opt.lfo.depth,at);
l.connect(lg);lg.connect(g.gain);l.start(at);this._cont.push(l);
}
o.connect(g);g.connect(dest);
o.start(at);this._cont.push(o);
return g;
};
/* 1. SUB: E1 + fifth, slow breathing */
const subLp=c.createBiquadFilter();
subLp.type='lowpass';subLp.frequency.value=170;subLp.Q.value=0.6;
subLp.connect(bus);
this.subG=c.createGain();this.subG.gain.value=LV.sub;this.subG.connect(subLp);
mk('sine',41.25,0.19,this.subG,{lfo:{k:2,depth:0.26}});
mk('sine',61.875,0.09,this.subG,{lfo:{k:1,depth:0.40}});
mk('triangle',82.5,0.038,this.subG,{lfo:{k:3,depth:0.50}});
/* 2. DARK PAD: minor seconds and a tritone, floating filter */
const padHp=c.createBiquadFilter();padHp.type='highpass';padHp.frequency.value=68;
const padLp=c.createBiquadFilter();padLp.type='lowpass';
padLp.frequency.setValueAtTime(430,at);padLp.Q.value=1.1;
padHp.connect(padLp);padLp.connect(bus);
const fl=c.createOscillator();fl.type='sine';fl.frequency.setValueAtTime(q(1/32),at);
const flg=c.createGain();flg.gain.setValueAtTime(270,at);
fl.connect(flg);flg.connect(padLp.frequency);fl.start(at);this._cont.push(fl);
this.padG=c.createGain();this.padG.gain.value=LV.pad;
this.padG.connect(padHp);
mk('sawtooth',82.5,0.046,this.padG,{lfo:{k:1,depth:0.45}});
mk('sawtooth',87.308,0.052,this.padG,{detune:-7,lfo:{k:2,depth:0.55}});   /* F2 — a second */
mk('sawtooth',110.0,0.036,this.padG,{lfo:{k:3,depth:0.35}});
mk('sawtooth',116.541,0.034,this.padG,{detune:9,lfo:{k:4,depth:0.50}});    /* Bb2 — a tritone */
/* 3. "CHOIR": a high dissonant cluster, lots of reverb */
const choirLp=c.createBiquadFilter();choirLp.type='lowpass';choirLp.frequency.value=2300;
this.choirG=c.createGain();this.choirG.gain.value=LV.choir;
this.choirG.connect(choirLp);choirLp.connect(bus);
const cwet=this._g(0.55);choirLp.connect(cwet);cwet.connect(this.revSend);
const choirFreqs=[220,233.082,311.127,329.628,440];
for(let i=0;i<choirFreqs.length;i++){
mk(i%2?'triangle':'sawtooth',choirFreqs[i],0.013,this.choirG,
{detune:i%2?8:-8,lfo:{k:i+1,depth:0.65}});
}
/* 4. WIND / DUST */
const wind=c.createBufferSource();wind.buffer=this.noiseBuf;wind.loop=true;
const wbp=c.createBiquadFilter();wbp.type='bandpass';
wbp.frequency.setValueAtTime(900,at);wbp.Q.value=0.7;
const wl=c.createOscillator();wl.type='sine';wl.frequency.setValueAtTime(q(1/32),at);
const wlg=c.createGain();wlg.gain.setValueAtTime(430,at);
wl.connect(wlg);wlg.connect(wbp.frequency);
this.windG=c.createGain();this.windG.gain.setValueAtTime(LV.wind,at);
const wa=c.createOscillator();wa.type='sine';wa.frequency.setValueAtTime(q(2/32),at);
const wag=c.createGain();wag.gain.setValueAtTime(LV.wind*0.55,at);
wa.connect(wag);wag.connect(this.windG.gain);
wind.connect(wbp);wbp.connect(this.windG);this.windG.connect(bus);
wind.start(at);wl.start(at);wa.start(at);
this._cont.push(wind,wl,wa);
/* 5. LOW HUM */
const rum=c.createBufferSource();rum.buffer=this.brownBuf;rum.loop=true;
const rlp=c.createBiquadFilter();rlp.type='lowpass';rlp.frequency.value=130;
this.rumbleG=c.createGain();this.rumbleG.gain.setValueAtTime(LV.rumble,at);
rum.connect(rlp);rlp.connect(this.rumbleG);this.rumbleG.connect(bus);
rum.start(at);this._cont.push(rum);
/* 6. AIR: quiet HF dust — a "room", audible on small speakers */
const air=c.createBufferSource();air.buffer=this.noiseBuf;air.loop=true;
const ahp=c.createBiquadFilter();ahp.type='highpass';ahp.frequency.value=2800;ahp.Q.value=0.5;
const ash=c.createBiquadFilter();ash.type='highshelf';ash.frequency.value=6000;ash.gain.value=-6;
this.airG=c.createGain();this.airG.gain.setValueAtTime(LV.air,at);
const aa=c.createOscillator();aa.type='sine';aa.frequency.setValueAtTime(q(1/32),at);
const aag=c.createGain();aag.gain.setValueAtTime(LV.air*0.45,at);
aa.connect(aag);aag.connect(this.airG.gain);
air.connect(ahp);ahp.connect(ash);ash.connect(this.airG);this.airG.connect(bus);
air.start(at);aa.start(at);
this._cont.push(air,aa);
/* 7. A BARELY AUDIBLE HIGH TONE ("glass") */
const shG=c.createGain();shG.gain.value=LV.shimmer;shG.connect(bus);
this.shimmerG=shG;
mk('sine',1237.5,0.011,shG,{lfo:{k:1,depth:0.70}});
mk('sine',1241.4,0.009,shG,{lfo:{k:2,depth:0.60}});
/* smooth entry (shortened: after Enter the music must be heard at once) */
bus.gain.setValueAtTime(0.0001,at);
bus.gain.exponentialRampToValueAtTime(LV.bus,at+1.8);
}
/* tension curve within the cycle */
_tension(ph){
return mClamp(0.5-0.5*Math.cos(2*Math.PI*ph)+0.12*Math.sin(4*Math.PI*ph),0,1);
}
/* ---------------- one-shot voices ---------------- */
_heartbeat(t,amp){
if(amp<=0.0005)return;
const c=this.ctx,R=()=>this.rnd();
const o=c.createOscillator();o.type='sine';
o.frequency.setValueAtTime(this.q(mLerp(74,88,R())),t);
o.frequency.exponentialRampToValueAtTime(this.q(33),t+0.19);
const g=c.createGain();
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(amp,t+0.014);
g.gain.exponentialRampToValueAtTime(0.0001,t+mLerp(0.34,0.5,R()));
const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=220;lp.Q.value=0.8;
o.connect(g);g.connect(lp);
this._route(lp,1.0,0.10,0,0);
o.start(t);o.stop(t+0.6);
this._track(o,t+0.6);
}
_impact(t,amp,kind){
if(amp<=0.0005)return;
const c=this.ctx,R=()=>this.rnd();
const out=c.createGain();out.gain.value=1;
if(kind==='metal'){
const bp=c.createBiquadFilter();bp.type='bandpass';
bp.frequency.value=mLerp(280,1700,R());bp.Q.value=mLerp(4,15,R());
const nDur=mLerp(0.8,2.4,R());
const n=this._noiseSrc(t,nDur+0.1);
const ng=c.createGain();
ng.gain.setValueAtTime(0.0001,t);
ng.gain.linearRampToValueAtTime(amp*0.85,t+0.006);
ng.gain.exponentialRampToValueAtTime(0.0001,t+nDur);
n.connect(ng);ng.connect(bp);bp.connect(out);
const base=mLerp(140,520,R());
for(let i=0;i<3;i++){
const o=c.createOscillator();o.type=i===0?'triangle':'sine';
o.frequency.setValueAtTime(this.q(base*mLerp(1,2.8,R())*(i+1)*0.7),t);
o.detune.setValueAtTime(mLerp(-30,30,R()),t);
const g=c.createGain();const d=mLerp(1.0,3.2,R());
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(amp*mLerp(0.09,0.26,R()),t+0.008);
g.gain.exponentialRampToValueAtTime(0.0001,t+d);
o.connect(g);g.connect(out);o.start(t);o.stop(t+d+0.05);
this._track(o,t+d+0.05);
}
this._route(out,0.85,0.85,mLerp(-0.65,0.65,R()),0.22);
return;
}
/* boom — a deep low hit */
const o=c.createOscillator();o.type='sine';
o.frequency.setValueAtTime(this.q(mLerp(92,150,R())),t);
o.frequency.exponentialRampToValueAtTime(this.q(27),t+mLerp(0.5,1.2,R()));
const g=c.createGain();const d=mLerp(1.6,3.0,R());
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(amp,t+0.012);
g.gain.exponentialRampToValueAtTime(0.0001,t+d);
o.connect(g);g.connect(out);o.start(t);o.stop(t+d+0.1);
this._track(o,t+d+0.1);
const nd=mLerp(0.30,0.85,R());
const n=this._noiseSrc(t,nd+0.1);
const nf=c.createBiquadFilter();nf.type='lowpass';nf.frequency.value=mLerp(160,520,R());nf.Q.value=0.8;
const ng=c.createGain();
ng.gain.setValueAtTime(0.0001,t);
ng.gain.linearRampToValueAtTime(amp*0.45,t+0.008);
ng.gain.exponentialRampToValueAtTime(0.0001,t+nd);
n.connect(nf);nf.connect(ng);ng.connect(out);
this._route(out,1.0,0.50,mLerp(-0.3,0.3,R()),0);
}
_bell(t,freq,amp,dur){
if(amp<=0.004)return;
const c=this.ctx,R=()=>this.rnd();
const out=c.createGain();out.gain.value=1;
const lp=c.createBiquadFilter();lp.type='lowpass';
lp.frequency.value=Math.min(9500,freq*8+1400);lp.Q.value=0.5;
lp.connect(out);
const parts=[[1,1,'sine',1],[2,0.32,'sine',0.55],[3.01,0.14,'triangle',0.35],[4.02,0.06,'sine',0.25]];
for(let i=0;i<parts.length;i++){
const mult=parts[i][0],lvl=parts[i][1],type=parts[i][2],dScale=parts[i][3];
const o=c.createOscillator();o.type=type;
o.frequency.setValueAtTime(this.q(freq*mult),t);
o.detune.setValueAtTime(mLerp(-9,9,R()),t);
const g=c.createGain();const d=dur*dScale;
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(amp*lvl,t+0.006);
g.gain.exponentialRampToValueAtTime(0.0001,t+d);
o.connect(g);g.connect(lp);o.start(t);o.stop(t+d+0.05);
this._track(o,t+d+0.05);
}
const n=this._noiseSrc(t,0.06);
const hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=2600;
const ng=c.createGain();
ng.gain.setValueAtTime(Math.max(0.0002,amp*0.22),t);
ng.gain.exponentialRampToValueAtTime(0.0001,t+0.045);
n.connect(hp);hp.connect(ng);ng.connect(out);
this._route(out,0.72,0.90,mLerp(-0.5,0.5,R()),0.30);
}
_whisper(t,dur,amp){
if(amp<=0.0005)return;
const c=this.ctx,R=()=>this.rnd();
const n=this._noiseSrc(t,dur+0.3);
const bp=c.createBiquadFilter();bp.type='bandpass';bp.Q.value=mLerp(2.5,7,R());
const f0=mLerp(560,1400,R()),f1=mLerp(1500,3300,R());
bp.frequency.setValueAtTime(f0,t);
bp.frequency.linearRampToValueAtTime(f1,t+dur*0.55);
bp.frequency.linearRampToValueAtTime(Math.max(200,f0*0.8),t+dur);
const hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=420;
const g=c.createGain();
g.gain.setValueAtTime(0.0001,t);
const steps=Math.max(6,Math.round(dur*7));
for(let i=1;i<=steps;i++){
const tt=t+dur*(i/steps);
let v=amp*mLerp(0.18,1.0,R());
if(i===1)v*=0.5;
if(i>steps-2)v*=0.3;
g.gain.linearRampToValueAtTime(Math.max(0.0004,v),tt);
}
g.gain.exponentialRampToValueAtTime(0.0001,t+dur+0.18);
n.connect(bp);bp.connect(hp);hp.connect(g);
this._route(g,0.50,0.95,mLerp(-0.85,0.85,R()),0.35);
}
_swell(t,dur,amp){
if(amp<=0.0005)return;
const c=this.ctx,R=()=>this.rnd();
const n=this._noiseSrc(t,dur+0.8);
const lp=c.createBiquadFilter();lp.type='lowpass';lp.Q.value=mLerp(1.0,3.2,R());
lp.frequency.setValueAtTime(mLerp(120,260,R()),t);
lp.frequency.exponentialRampToValueAtTime(mLerp(2200,5200,R()),t+dur*0.9);
lp.frequency.exponentialRampToValueAtTime(400,t+dur+0.3);
const g=c.createGain();
g.gain.setValueAtTime(0.0001,t);
g.gain.exponentialRampToValueAtTime(amp,t+dur*0.88);
g.gain.exponentialRampToValueAtTime(0.0001,t+dur+0.35);
n.connect(lp);lp.connect(g);
this._route(g,0.80,0.70,mLerp(-0.4,0.4,R()),0);
const o=c.createOscillator();o.type='sawtooth';
const fA=this.q(mLerp(46,72,R()));
o.frequency.setValueAtTime(fA,t);
o.frequency.exponentialRampToValueAtTime(this.q(fA*2),t+dur*0.9);
const olp=c.createBiquadFilter();olp.type='lowpass';olp.frequency.value=620;
const og=c.createGain();
og.gain.setValueAtTime(0.0001,t);
og.gain.exponentialRampToValueAtTime(amp*0.32,t+dur*0.85);
og.gain.exponentialRampToValueAtTime(0.0001,t+dur+0.3);
o.connect(olp);olp.connect(og);o.start(t);o.stop(t+dur+0.4);
this._route(og,0.70,0.80,mLerp(-0.4,0.4,R()),0);
this._track(o,t+dur+0.4);
}
_creak(t,dur,amp){
if(amp<=0.0005)return;
const c=this.ctx,R=()=>this.rnd();
const o=c.createOscillator();o.type='sawtooth';
const f0=mLerp(56,112,R());
o.frequency.setValueAtTime(this.q(f0),t);
o.frequency.linearRampToValueAtTime(this.q(f0*mLerp(1.1,1.65,R())),t+dur*0.5);
o.frequency.linearRampToValueAtTime(this.q(f0*mLerp(0.85,1.05,R())),t+dur);
const bp=c.createBiquadFilter();bp.type='bandpass';
bp.frequency.value=mLerp(480,1500,R());bp.Q.value=mLerp(9,22,R());
const wob=c.createOscillator();wob.type='sine';wob.frequency.value=mLerp(3.5,11,R());
const wg=c.createGain();wg.gain.value=mLerp(80,330,R());
wob.connect(wg);wg.connect(bp.frequency);wob.start(t);wob.stop(t+dur+0.15);
const g=c.createGain();
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(amp,t+dur*0.35);
g.gain.linearRampToValueAtTime(Math.max(0.0002,amp*0.7),t+dur*0.7);
g.gain.exponentialRampToValueAtTime(0.0001,t+dur+0.25);
o.connect(bp);bp.connect(g);o.start(t);o.stop(t+dur+0.3);
this._route(g,0.70,0.95,mLerp(-0.75,0.75,R()),0.28);
this._track(o,t+dur+0.3);this._track(wob,t+dur+0.15);
}
_sting(t,amp){
if(amp<=0.0005)return;
const c=this.ctx,R=()=>this.rnd();
const roots=[196,220,233.082,246.942,174.614];
const root=this.q(roots[Math.floor(R()*roots.length)]);
const dur=mLerp(1.7,3.3,R());
const atk=mLerp(0.02,0.13,R());
const bp=c.createBiquadFilter();bp.type='bandpass';
bp.frequency.value=mLerp(900,2100,R());bp.Q.value=mLerp(0.8,2.2,R());
const g=c.createGain();
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(amp,t+atk);
g.gain.setValueAtTime(amp,t+Math.max(atk+0.05,dur*0.28));
g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
const vib=c.createOscillator();vib.type='sine';vib.frequency.value=mLerp(5.5,9.5,R());
const vg=c.createGain();vg.gain.value=mLerp(10,32,R());
vib.connect(vg);vib.start(t);vib.stop(t+dur+0.2);
const all=[0,1,6,7,10,11];
const count=3+Math.floor(R()*3);
const semis=[];
while(semis.length<count){
const s=all[Math.floor(R()*all.length)];
if(semis.indexOf(s)===-1)semis.push(s);
}
for(let i=0;i<semis.length;i++){
const o=c.createOscillator();o.type=R()<0.5?'sawtooth':'square';
o.frequency.setValueAtTime(this.q(root*Math.pow(2,semis[i]/12)),t);
vg.connect(o.detune);
const og=c.createGain();og.gain.value=1/semis.length;
o.connect(og);og.connect(bp);o.start(t);o.stop(t+dur+0.1);
this._track(o,t+dur+0.1);
}
bp.connect(g);
const n=this._noiseSrc(t,0.4);
const nhp=c.createBiquadFilter();nhp.type='highpass';nhp.frequency.value=1400;
const ng=c.createGain();
ng.gain.setValueAtTime(amp*0.5,t);
ng.gain.exponentialRampToValueAtTime(0.0001,t+0.35);
n.connect(nhp);nhp.connect(ng);
this._route(g,0.85,1.0,mLerp(-0.3,0.3,R()),0.35);
this._route(ng,0.5,0.7,0,0);
this._track(vib,t+dur+0.2);
}
/* ================= music layer: harmony and melody =================
   Progression i–VI–iv–V7 in E minor (4 bars of 8 s). The V7 at the cycle end
   pulls back to the tonic — the seam sounds like a resolution, not a cutoff. */
_chords(){return[[0,7,12,15],[8,12,15,20],[5,12,16,21],[7,11,14,17]]}
_hz(semi,base){return this.q(base*Math.pow(2,semi/12))}
/* PAD per chord: slow attack, the tail overlaps the next chord */
_padChord(t,dur,semis,base,amp){
if(amp<=0.004)return;
const c=this.ctx,R=()=>this.rnd();
const out=c.createGain();out.gain.value=1;
const lp=c.createBiquadFilter();lp.type='lowpass';lp.Q.value=0.9;
const rel=mLerp(1.6,3.0,R()),atk=mLerp(0.9,2.2,R());
lp.frequency.setValueAtTime(mLerp(280,520,R()),t);
lp.frequency.linearRampToValueAtTime(mLerp(700,1500,R()),t+dur*0.55);
lp.frequency.linearRampToValueAtTime(mLerp(260,460,R()),t+dur+rel);
lp.connect(out);
const hold=Math.max(atk+0.1,dur*0.72);
const per=amp/(semis.length*2);
for(let i=0;i<semis.length;i++){
const f=this._hz(semis[i],base);
for(let k=0;k<2;k++){
const o=c.createOscillator();o.type=k?'triangle':'sawtooth';
o.frequency.setValueAtTime(f,t);
o.detune.setValueAtTime(k?mLerp(4,13,R()):mLerp(-13,-4,R()),t);
const g=c.createGain();
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(per,t+atk);
g.gain.setValueAtTime(per,t+hold);
g.gain.exponentialRampToValueAtTime(0.0001,t+dur+rel);
o.connect(g);g.connect(lp);
o.start(t);o.stop(t+dur+rel+0.05);
this._track(o,t+dur+rel+0.05);
}
}
this._route(out,0.70,0.85,mLerp(-0.2,0.2,R()),0.12);
}
/* CHOIR: a formant vocalise (bands ~620/1100/2450 Hz) over the chord */
_choirChord(t,dur,semis,base,amp){
if(amp<=0.003)return;
const c=this.ctx,R=()=>this.rnd();
const out=c.createGain();out.gain.value=1;
const rel=mLerp(1.4,2.6,R()),atk=mLerp(1.2,2.6,R());
const hold=Math.max(atk+0.1,dur*0.6);
const vib=c.createOscillator();vib.type='sine';vib.frequency.value=mLerp(4.4,5.9,R());
const vg=c.createGain();vg.gain.value=mLerp(5,14,R());
vib.connect(vg);vib.start(t);vib.stop(t+dur+rel+0.1);
this._track(vib,t+dur+rel+0.1);
const formants=[[620,6,1.0],[1100,8,0.55],[2450,10,0.28]];
const use=semis.slice(0,3);
for(let i=0;i<use.length;i++){
const f=this._hz(use[i],base);
const o=c.createOscillator();o.type=R()<0.5?'sawtooth':'triangle';
o.frequency.setValueAtTime(f,t);
vg.connect(o.detune);
const g=c.createGain(),lvl=amp/use.length;
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(lvl,t+atk);
g.gain.setValueAtTime(lvl,t+hold);
g.gain.exponentialRampToValueAtTime(0.0001,t+dur+rel);
o.connect(g);
for(let fi=0;fi<formants.length;fi++){
const bp=c.createBiquadFilter();bp.type='bandpass';
bp.frequency.value=formants[fi][0]*mLerp(0.94,1.06,R());
bp.Q.value=formants[fi][1];
const fg=c.createGain();fg.gain.value=formants[fi][2];
g.connect(bp);bp.connect(fg);fg.connect(out);
}
o.start(t);o.stop(t+dur+rel+0.1);
this._track(o,t+dur+rel+0.1);
}
this._route(out,0.45,1.0,mLerp(-0.35,0.35,R()),0.3);
}
/* FELT PIANO: a soft low tone on the chord change — marks the harmony */
_feltNote(t,freq,amp,dur){
if(amp<=0.004)return;
const c=this.ctx,R=()=>this.rnd();
const out=c.createGain();out.gain.value=1;
const lp=c.createBiquadFilter();lp.type='lowpass';
lp.frequency.value=mLerp(900,2200,R());lp.Q.value=0.6;
lp.connect(out);
const parts=[[1,1,'sine'],[2,0.34,'sine'],[3,0.13,'triangle'],[4.02,0.05,'sine']];
for(let i=0;i<parts.length;i++){
const o=c.createOscillator();o.type=parts[i][2];
o.frequency.setValueAtTime(this.q(freq*parts[i][0]),t);
o.detune.setValueAtTime(mLerp(-6,6,R()),t);
const g=c.createGain(),d=dur*(i>1?0.45:1);
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(amp*parts[i][1],t+0.012);
g.gain.exponentialRampToValueAtTime(0.0001,t+d);
o.connect(g);g.connect(lp);
o.start(t);o.stop(t+d+0.05);
this._track(o,t+d+0.05);
}
const n=this._noiseSrc(t,0.05);
const hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=1800;
const ng=c.createGain();
ng.gain.setValueAtTime(Math.max(0.0002,amp*0.12),t);
ng.gain.exponentialRampToValueAtTime(0.0001,t+0.04);
n.connect(hp);hp.connect(ng);ng.connect(out);
this._route(out,0.85,0.55,mLerp(-0.25,0.25,R()),0.15);
}
/* PIZZICATO: a short string pluck */
_pluck(t,freq,amp){
if(amp<=0.004)return;
const c=this.ctx,R=()=>this.rnd();
const out=c.createGain();out.gain.value=1;
const lp=c.createBiquadFilter();lp.type='lowpass';
lp.frequency.setValueAtTime(mLerp(1400,3000,R()),t);
lp.frequency.exponentialRampToValueAtTime(700,t+0.35);
lp.connect(out);
const d=mLerp(0.35,0.9,R());
const specs=[[1,1,'triangle'],[2,0.35,'sine'],[3.01,0.12,'sine']];
for(let i=0;i<specs.length;i++){
const o=c.createOscillator();o.type=specs[i][2];
o.frequency.setValueAtTime(this.q(freq*specs[i][0]),t);
const g=c.createGain();
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(amp*specs[i][1],t+0.005);
g.gain.exponentialRampToValueAtTime(0.0001,t+d*(i?0.5:1));
o.connect(g);g.connect(lp);
o.start(t);o.stop(t+d+0.05);
this._track(o,t+d+0.05);
}
const n=this._noiseSrc(t,0.03);
const hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=2200;
const ng=c.createGain();
ng.gain.setValueAtTime(Math.max(0.0002,amp*0.3),t);
ng.gain.exponentialRampToValueAtTime(0.0001,t+0.025);
n.connect(hp);hp.connect(ng);ng.connect(out);
this._route(out,0.90,0.40,mLerp(-0.55,0.55,R()),0.12);
}
/* MUSIC-BOX MELODY: steps over the current chord's tones — a singable line,
 pauses are mandatory, else it starts to "saw" */
_melodyLine(at,stepLen,steps,bars,chords,base,amp,density){
if(amp<=0.004)return;
const R=()=>this.rnd();
const perBar=Math.max(1,steps/bars);
const jumps=[-4,-3,-2,-1,0,1,2,3,4];
let last=12;
for(let i=0;i<steps;i++){
const bar=Math.floor(i/perBar);
const chord=chords[bar%chords.length];
const beat=i%perBar;
const pr=(beat===0?0.95:(beat===perBar/2?0.70:0.42))*density;
if(R()>pr)continue;
const pool=chord.concat(chord.map(x=>x+12));
const target=last+jumps[Math.floor(R()*jumps.length)];
let best=pool[0],bd=1e9;
for(let k=0;k<pool.length;k++){const dd=Math.abs(pool[k]-target);if(dd<bd){bd=dd;best=pool[k]}}
if(R()<0.10)best+=(R()<0.5?-1:1);           /* a passing tone outside the chord */
last=best;
const accent=beat===0?1:(beat===perBar/2?0.80:0.60);
this._bell(at+i*stepLen+(R()-0.5)*0.035,
base*Math.pow(2,best/12),
amp*accent*mLerp(0.75,1.05,R()),mLerp(2.0,4.2,R()));
}
}
_crackle(t,amp){
if(amp<=0.0005)return;
const c=this.ctx,R=()=>this.rnd();
const d=mLerp(0.008,0.055,R());
const n=this._noiseSrc(t,d+0.03);
const hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=mLerp(1800,6500,R());
const g=c.createGain();
g.gain.setValueAtTime(Math.max(0.0002,amp),t);
g.gain.exponentialRampToValueAtTime(0.0001,t+d);
n.connect(hp);hp.connect(g);
this._route(g,0.75,0.25,mLerp(-0.9,0.9,R()),0);
}
/* ---------------- cycle layout ---------------- */
scheduleLoop(at,index){
const L=this.L,P=this.p,R=()=>this.rnd();
const sc=L/64;                       /* event density normalized to the cycle length */
const cnt=exp=>{const b=Math.floor(exp);return b+(R()<exp-b?1:0)};
this.rnd=xsFromU32((this.seed+(index+1)*7919)>>>0).rnd;   /* every cycle is unique */
this._prune();
const ten=ph=>this._tension(ph);
/* cycle anchor — a deep hit at the border */
this._impact(at,mLerp(0.55,0.95,P.intensity),'boom');
/* heartbeat: accelerates toward the cycle middle */
if(P.heartbeat>0.01){
let t=0.5;
while(t<L-0.9){
const k=ten(t/L);
const bpm=mLerp(38,98,mClamp(k*(0.30+0.70*P.heartbeat),0,1));
const amp=mLerp(0.18,0.80,k)*(0.35+0.75*P.heartbeat)*mLerp(0.8,1.0,R());
this._heartbeat(at+t,amp);
if(R()<0.16+0.32*k)this._heartbeat(at+t+mLerp(0.22,0.30,R()),amp*0.55);
t+=60/bpm+(R()-0.5)*0.05;
}
}
/* metallic hits / distant booms */
const nImp=cnt((1+4*P.intensity)*(0.35+0.9*P.metal)*sc);
for(let i=0;i<nImp;i++){
const tt=mLerp(0.05,0.95,R())*L;
const kind=R()<mClamp(0.25+0.6*P.metal,0,0.9)?'metal':'boom';
this._impact(at+tt,mLerp(0.20,0.66,R())*(0.45+0.65*P.intensity),kind);
}
/* HARMONY: chords, choir, piano */
const chords=this._chords(),bars=4,barLen=L/bars;
const padBase=165.0;                                  /* E3 */
for(let b=0;b<bars;b++){
const bt=at+b*barLen;
const chord=chords[b];
const kTen=this._tension((b*barLen)/L);
this._padChord(bt,barLen,chord,padBase,
mLerp(0.130,0.320,P.intensity)*(0.65+0.5*P.dread)*(0.82+0.3*kTen));
if(R()<0.40+0.6*P.dread){
this._choirChord(bt,barLen,chord,padBase*2,mLerp(0.045,0.140,P.dread)*(0.7+0.5*kTen));
}
if(b%2===0||R()<0.55){
this._feltNote(bt+0.02,this._hz(chord[0],82.5),
mLerp(0.16,0.36,P.intensity)*mLerp(0.7,1.0,R()),mLerp(3.0,5.5,R()));
}
}
/* music-box melody — over the chord tones */
const mSteps=bars*4;
this._melodyLine(at,L/mSteps,mSteps,bars,chords,659.255,
mLerp(0.0,0.40,P.bells),0.30+0.85*P.bells);
/* a pizzicato figure on eighths — movement, but breathing with pauses */
if(P.bells>0.05){
const pSteps=bars*8,pLen=L/pSteps;
for(let i=0;i<pSteps;i++){
const chord=chords[Math.floor(i/8)%chords.length];
if(R()>(0.10+0.30*P.bells)*(0.6+0.7*this._tension((i*pLen)/L)))continue;
this._pluck(at+i*pLen,this._hz(chord[Math.floor(R()*chord.length)],164.814),
mLerp(0.05,0.17,P.bells)*mLerp(0.6,1.1,R()));
}
}
/* whispers */
const nW=cnt((1+4*P.dread)*(0.3+1.0*P.whispers)*sc);
for(let i=0;i<nW;i++){
const tt=mLerp(0.04,0.92,R())*L;
const dur=mLerp(1.2,3.6,R());
this._whisper(at+tt,dur,mLerp(0.08,0.28,R())*(0.35+0.9*ten(tt/L))*(0.3+0.9*P.whispers));
}
/* swells — pull the tension up */
const nS=cnt((1+3*P.intensity)*sc);
for(let i=0;i<nS;i++){
const dur=mLerp(5,11,R());
const tt=R()*Math.max(1,L-dur);
this._swell(at+tt,dur,mLerp(0.05,0.19,R())*(0.5+0.7*P.intensity));
}
/* creaks (doors, pipes, wood) */
const nC=cnt((0.5+3*P.dread)*(0.4+0.8*P.whispers)*sc);
for(let i=0;i<nC;i++){
const dur=mLerp(2,6,R());
this._creak(at+R()*Math.max(1,L-dur),dur,mLerp(0.055,0.17,R())*(0.4+0.7*P.dread));
}
/* dust / film crackle */
const nK=cnt((8+30*P.intensity)*sc);
for(let i=0;i<nK;i++)this._crackle(at+R()*L,mLerp(0.030,0.140,R()));
}
/* a one-shot screamer — the Monitor appearing in the menu (outside the cycle grid) */
stingNow(amp){
const save=this.rnd;
this.rnd=xsFromU32((Math.random()*4294967296)>>>0).rnd;   /* menu stinger — the player doesn't control it */
const t=this.ctx.currentTime+0.02;
this._sting(t,amp);
this._impact(t+0.01,amp*0.5,'boom');
this.rnd=save;
}
/* ---------------- live: start/stop/scheduler ---------------- */
start(){
const c=this.ctx;
const at=c.currentTime+0.09;
this.t0=at;this.nextLoop=0;this.running=true;
this.master.gain.cancelScheduledValues(at);
this.master.gain.setValueAtTime(0.0001,at);
/* fast entry (0.45 s): after Enter on the loading screen the music is heard at once */
this.master.gain.exponentialRampToValueAtTime(Math.max(0.02,this.p.volume),at+0.45);
this.startContinuous(at);
this.scheduleLoop(at,0);
this.nextLoop=1;
this._timer=setInterval(()=>this._pump(),250);
this._pump();
}
_pump(){
if(!this.running)return;
const now=this.ctx.currentTime,L=this.L;
/* the difficulty could be changed on any menu screen — poll the target every pump */
if(this.fearFn)this.fearT=this.fearFn();
/* fear is interpolated (τ≈1.7 s) — the mix morphs without breaks; before t0
 don't touch the params so as not to cancel the start automation of the
 continuous layers */
if(now>=this.t0&&Math.abs(this.fearT-this.fear)>0.001){
this.fear+=(this.fearT-this.fear)*0.14;
if(Math.abs(this.fearT-this.fear)<=0.001)this.fear=this.fearT;
this.p=musParams(this.fear);
this.applyParams();
}
let g=0;
/* missed cycles (a background tab) — skip them, don't play them back in a salvo */
while(this.t0+this.nextLoop*L<now-0.2&&g++<64)this.nextLoop++;
/* horizon ~3 s: the next cycle is scheduled late, so a difficulty parameter
 change lands in the layout almost immediately */
while(this.t0+this.nextLoop*L<now+3&&g<70){this.scheduleLoop(this.t0+this.nextLoop*L,this.nextLoop);this.nextLoop++;g++}
}
stop(fade){
const fd=(fade===undefined?1.1:fade);   /* shorter fade — the loading-screen handoff */
this.running=false;
if(this._timer){clearInterval(this._timer);this._timer=null}
const c=this.ctx,now=c.currentTime;
try{
this.master.gain.cancelScheduledValues(now);
this.master.gain.setValueAtTime(Math.max(0.0002,this.master.gain.value),now);
this.master.gain.exponentialRampToValueAtTime(0.0002,now+fd);
}catch(e){}
const stopAt=now+fd+0.25;
for(let i=0;i<this._cont.length;i++){try{this._cont[i].stop(stopAt)}catch(e){}}
for(let i=0;i<this._tmp.length;i++){try{if(this._tmp[i]._end>now)this._tmp[i].stop(stopAt)}catch(e){}}
this._cont.length=0;this._tmp.length=0;
/* detach the drone subtree when the tail has rung out — else the graph grows from visit to visit */
setTimeout(()=>{try{this.droneLevel.disconnect()}catch(e){}},(fd+0.5)*1000);
}
applyParams(){
const p=this.p,now=this.ctx.currentTime;
const set=(param,v,tc)=>{
if(!param)return;
try{param.cancelScheduledValues(now);param.setTargetAtTime(v,now,tc)}catch(e){}
};
/* master.gain isn't touched here: the volume is constant, and the entry/exit
 fades must not be interrupted */
set(this.revSend.gain,mClamp(p.reverb,0,1),0.25);
const LV=this._levels();
set(this.droneLevel&&this.droneLevel.gain,LV.drone,0.40);
set(this.padG&&this.padG.gain,LV.pad,0.50);
set(this.choirG&&this.choirG.gain,LV.choir,0.50);
set(this.windG&&this.windG.gain,LV.wind,0.60);
set(this.rumbleG&&this.rumbleG.gain,LV.rumble,0.60);
set(this.subG&&this.subG.gain,LV.sub,0.40);
set(this.shimmerG&&this.shimmerG.gain,LV.shimmer,0.60);
set(this.airG&&this.airG.gain,LV.air,0.60);
}
}
/* ==== game binding ==== */
const MUS_VOL=0.85;
/* Difficulty → mix. fear comes from menuMonChance (practice and "custom" are 0):
 easy √.05≈.22, medium √.2≈.45, hard √.5≈.71, extreme √.75≈.87, impossible 1.
 The middle of the scale ≈ the "Menu (balance)" preset. At the top
 the music does NOT degrade: the box/choir/piano stay, they just drown in the
 anxiety (pulse, whispers, metal, dissonance); at the bottom — spacious and calm. */
function musFear(){return Math.sqrt(menuMonChance())}
function musParams(f){
const L=(a,b)=>a+(b-a)*f;
return{volume:MUS_VOL,intensity:L(0.40,0.85),dread:L(0.18,0.98),heartbeat:L(0.00,1.00),
reverb:L(0.74,0.47),metal:L(0.18,1.00),bells:L(0.62,0.32),whispers:L(0.15,1.00)};
}
let MUS=null,musWant=false;
/* start as soon as the context is alive (autoplay policy: not before the first click) */
function musTry(){
if(!musWant||!AU.ctx||AU.ctx.state!=='running')return;
if(!MUS)MUS=new MusEng(AU.ctx,(Math.random()*4294967296)>>>0,musParams(musFear()));
if(!MUS.running){
MUS.seed=(Math.random()*4294967296)>>>0;   /* dynamic seed: the player doesn't control it */
MUS.fearFn=musFear;
MUS.fear=MUS.fearT=musFear();
MUS.p=musParams(MUS.fear);
MUS.start();
}
}
function musMenu(on,fade){
musWant=on;
if(on){
if(AU.ctx&&AU.ctx.state==='suspended')AU.ctx.resume().then(musTry).catch(()=>{});
musTry();
}else if(MUS&&MUS.running)MUS.stop(fade);
}
/* The screamer — only when the monster appears and vanishes (easy…extreme).
 On impossible he's in the menu permanently: the fear is made by the music
 itself, without stingers. Sounds ONLY on the main menu screen: in
 "Play"/"Settings" and over open overlays (manual, lab) the player is
 reading — don't distract. */
function menuOverlayOpen(){
for(const id of['manual','sndlab','bye']){const e=$(id);if(e&&!e.classList.contains('hidden'))return true}
return false;}
function musSting(){
if(menuScr!=='main'||menuOverlayOpen()||document.hidden)return;
if(MUS&&MUS.running&&menuMonChance()<1)MUS.stingNow(0.26+0.16*MUS.fear);
}

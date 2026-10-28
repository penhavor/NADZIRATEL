const MASTER=0.9;

const AU={ctx:null,on:false,rnd:Math.random};

/* ==== PROCEDURAL SOUND (WebAudio) ==== */
function auInit(){
if(AU.ctx)return;
if(AU.rnd===Math.random)AU.rnd=xsFromU32(0xA0D10E23).rnd;
const C=window.AudioContext||window.webkitAudioContext;
if(!C)return;
AU.ctx=new C();
/* common bus of all sound: duck (a smooth fade on tab blur) → a soft limiter
 (insurance against clipping of sums) → output. Menu music (MusEng.out) and
 UI sounds (AU.ui) route here too. */
AU.duck=AU.ctx.createGain();AU.duck.gain.value=1;
AU.comp=AU.ctx.createDynamicsCompressor();
try{AU.comp.threshold.value=-3;AU.comp.knee.value=6;AU.comp.ratio.value=12;
AU.comp.attack.value=0.003;AU.comp.release.value=0.25;}catch(e){}
AU.duck.connect(AU.comp);AU.comp.connect(AU.ctx.destination);
AU.master=AU.ctx.createGain();AU.master.gain.value=MASTER;AU.master.connect(AU.duck);
AU.hum=AU.ctx.createOscillator();AU.hum.type='sawtooth';AU.hum.frequency.value=100;
AU.humF=AU.ctx.createBiquadFilter();AU.humF.type='lowpass';AU.humF.frequency.value=240;
AU.humG=AU.ctx.createGain();AU.humG.gain.value=0;
AU.hum.connect(AU.humF);AU.humF.connect(AU.humG);AU.humG.connect(AU.master);AU.hum.start();

AU.humV=[];
for(let i=0;i<4;i++){
const o=AU.ctx.createOscillator();o.type='sawtooth';
o.frequency.value=100*(1+(i%2?0.006:-0.004)+(i>1?0.002:0));
const f=AU.ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=240;
const g=AU.ctx.createGain();g.gain.value=0;
const p=AU.ctx.createStereoPanner();p.pan.value=0;
o.connect(f);f.connect(g);g.connect(p);p.connect(AU.master);o.start();
AU.humV.push({o:o,f:f,g:g,p:p,lamp:-1,tg:0,tp:0,tf:240});
}
AU.noise=AU.ctx.createBuffer(1,AU.ctx.sampleRate*2,AU.ctx.sampleRate);
const d=AU.noise.getChannelData(0);
{const nz=xsBulk((AU.rnd()*4294967296)>>>0);   /* the tag — from the main generator, the fill — cheap */
for(let i=0;i<d.length;i++)d[i]=nz()*2-1;}
AU.on=true;
}
function auSetMute(m){if(AU.on)AU.master.gain.value=m?0:MASTER}

function auReseedNoise(){
if(!AU.on||!AU.noise)return;
const d=AU.noise.getChannelData(0);
const nz=xsBulk((AU.rnd()*4294967296)>>>0);   /* in game AU.rnd is the seeded stream — the noise is from the seed */
for(let i=0;i<d.length;i++)d[i]=nz()*2-1;
}
function auNoise(dur,f,q,vol,pan,muf){
if(!AU.on)return;
const t=AU.ctx.currentTime;
const src=AU.ctx.createBufferSource();src.buffer=AU.noise;
src.playbackRate.value=0.7+AU.rnd()*0.6;
const f1=AU.ctx.createBiquadFilter();f1.type='bandpass';f1.frequency.value=f;f1.Q.value=q;
const g=AU.ctx.createGain();
g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
const p=AU.ctx.createStereoPanner();p.pan.value=pan||0;
src.connect(f1);f1.connect(g);
if(muf){const lf=AU.ctx.createBiquadFilter();lf.type='lowpass';lf.frequency.value=700;g.connect(lf);lf.connect(p)}
else g.connect(p);
p.connect(AU.master);
src.start(t);src.stop(t+dur+0.05);
}
function auTone(f0,f1,dur,type,vol,pan,muf){
if(!AU.on)return;
const t=AU.ctx.currentTime;
const o=AU.ctx.createOscillator();o.type=type;
o.frequency.setValueAtTime(f0,t);
o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),t+dur);
const g=AU.ctx.createGain();
const atk=Math.min(0.04,dur*0.3);   /* fix: at a short dur the 0.04 attack put envelope events out of chronology —
the oscillator went mute at peak volume (a click) */
g.gain.setValueAtTime(0.0001,t);
g.gain.exponentialRampToValueAtTime(vol,t+atk);
g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
const p=AU.ctx.createStereoPanner();p.pan.value=pan||0;
o.connect(g);
if(muf){const lf=AU.ctx.createBiquadFilter();lf.type='lowpass';lf.frequency.value=700;g.connect(lf);lf.connect(p)}
else g.connect(p);
p.connect(AU.master);
o.start(t);o.stop(t+dur+0.05);
}

function spat(sx,sy){
if(!S)return {d:0,pan:0,muf:false,att:1,occ:1};
const d=Math.hypot(sx-S.px,sy-S.py);
const pan=Math.max(-1,Math.min(1,Math.sin(Math.atan2(sy-S.py,sx-S.px)-S.ang)*1.4));
const vis=los(S,S.px,S.py,sx,sy);

return {d:d,pan:pan,muf:!vis,att:1/(1+d*0.12),occ:occFactor(S,S.px,S.py,sx,sy)};
}

function auCrack(vol,pan,muf){
if(!AU.on)return;
const t=AU.ctx.currentTime;
const n=2+((AU.rnd()*3)|0);
for(let i=0;i<n;i++){
const at=t+i*(0.02+AU.rnd()*0.035);
const src=AU.ctx.createBufferSource();src.buffer=AU.noise;
src.playbackRate.value=1.2+AU.rnd()*0.8;
const hp=AU.ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=2800+AU.rnd()*1500;
const g=AU.ctx.createGain();
g.gain.setValueAtTime(0.0001,at);
g.gain.exponentialRampToValueAtTime(vol*(0.4+AU.rnd()*0.6),at+0.004);
g.gain.exponentialRampToValueAtTime(0.0001,at+0.012+AU.rnd()*0.01);
const p=AU.ctx.createStereoPanner();p.pan.value=pan||0;
src.connect(hp);hp.connect(g);
if(muf){const lf=AU.ctx.createBiquadFilter();lf.type='lowpass';lf.frequency.value=900;g.connect(lf);lf.connect(p)}
else g.connect(p);
p.connect(AU.master);
src.start(at);src.stop(at+0.05);
}
const bz=AU.ctx.createOscillator();bz.type='square';bz.frequency.value=120+AU.rnd()*30;
const bzf=AU.ctx.createBiquadFilter();bzf.type='bandpass';bzf.frequency.value=700;bzf.Q.value=2;
const bzg=AU.ctx.createGain();
bzg.gain.setValueAtTime(0.0001,t);
bzg.gain.exponentialRampToValueAtTime(vol*0.10,t+0.005);
bzg.gain.exponentialRampToValueAtTime(0.0001,t+0.06);
const p2=AU.ctx.createStereoPanner();p2.pan.value=pan||0;
bz.connect(bzf);bzf.connect(bzg);bzg.connect(p2);p2.connect(AU.master);
bz.start(t);bz.stop(t+0.08);
}

function auCave(pan,muf){
if(!AU.on)return;
const t=AU.ctx.currentTime;
const dur=2.6+AU.rnd()*0.9;
const f0=78+AU.rnd()*14,f1=f0*(0.45+AU.rnd()*0.12);
const det=2+AU.rnd()*3;
const chain=(pn,g)=>{ if(muf){const lf=AU.ctx.createBiquadFilter();lf.type='lowpass';lf.frequency.value=700;
g.connect(lf);lf.connect(pn)} else g.connect(pn); pn.connect(AU.master); };
[0,det].forEach((dd,i)=>{
const o=AU.ctx.createOscillator();o.type='sine';
o.frequency.setValueAtTime(f0+dd*i,t);
o.frequency.exponentialRampToValueAtTime(f1+dd*i*0.4,t+dur-0.4);
const g=AU.ctx.createGain();
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(0.42,t+0.9+AU.rnd()*0.3);
g.gain.setValueAtTime(0.42,t+dur*0.55);
g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
const p=AU.ctx.createStereoPanner();p.pan.value=pan;
o.connect(g);chain(p,g);
o.start(t);o.stop(t+dur+0.1);
});
const src=AU.ctx.createBufferSource();src.buffer=AU.noise;src.loop=true;
const bp=AU.ctx.createBiquadFilter();bp.type='bandpass';
bp.frequency.value=180+AU.rnd()*120;bp.Q.value=1.0;
const g2=AU.ctx.createGain();
g2.gain.setValueAtTime(0.0001,t);
g2.gain.linearRampToValueAtTime(0.36,t+0.7);
g2.gain.linearRampToValueAtTime(0.0001,t+dur);
const p2=AU.ctx.createStereoPanner();p2.pan.value=pan;
src.connect(bp);bp.connect(g2);chain(p2,g2);
src.start(t);src.stop(t+dur+0.1);
}

function auWhisper(pan,muf){
if(!AU.on)return;
const t=AU.ctx.currentTime,dur=1.6;
const src=AU.ctx.createBufferSource();src.buffer=AU.noise;src.loop=true;
const bp1=AU.ctx.createBiquadFilter();bp1.type='bandpass';bp1.Q.value=4;
const bp2=AU.ctx.createBiquadFilter();bp2.type='bandpass';bp2.Q.value=5;
bp1.frequency.setValueAtTime(900,t);bp2.frequency.setValueAtTime(2300,t);
const g1=AU.ctx.createGain();g1.gain.value=0.0001;
const g2=AU.ctx.createGain();g2.gain.value=0.0001;
const master=AU.ctx.createGain();
master.gain.setValueAtTime(0.0001,t);
master.gain.linearRampToValueAtTime(1,t+0.12);
master.gain.setValueAtTime(1,t+dur-0.25);
master.gain.linearRampToValueAtTime(0.0001,t+dur);
const p=AU.ctx.createStereoPanner();p.pan.value=pan;
src.connect(bp1);bp1.connect(g1);g1.connect(master);
src.connect(bp2);bp2.connect(g2);g2.connect(master);
if(muf){const lf=AU.ctx.createBiquadFilter();lf.type='lowpass';lf.frequency.value=700;master.connect(lf);lf.connect(p)}
else master.connect(p);
p.connect(AU.master);
let tt=0.1;
while(tt<dur-0.15){
const syl=0.10+AU.rnd()*0.10;
bp1.frequency.setValueAtTime(600+AU.rnd()*700,t+tt);
bp2.frequency.setValueAtTime(1700+AU.rnd()*1500,t+tt);
const a1=0.60*(0.5+AU.rnd()*0.5),a2=0.38*(0.5+AU.rnd()*0.5);
g1.gain.linearRampToValueAtTime(a1,t+tt+syl*0.4);
g1.gain.linearRampToValueAtTime(a1*0.25,t+tt+syl);
g2.gain.linearRampToValueAtTime(a2,t+tt+syl*0.4);
g2.gain.linearRampToValueAtTime(a2*0.25,t+tt+syl);
if(AU.rnd()<0.5){
const bs=AU.ctx.createBufferSource();bs.buffer=AU.noise;
const hp=AU.ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=2500;
const bg=AU.ctx.createGain();
bg.gain.setValueAtTime(0.0001,t+tt);
bg.gain.exponentialRampToValueAtTime(0.18,t+tt+0.004);
bg.gain.exponentialRampToValueAtTime(0.0001,t+tt+0.014);
const bp=AU.ctx.createStereoPanner();bp.pan.value=pan;
bs.connect(hp);hp.connect(bg);bg.connect(bp);bp.connect(AU.master);
bs.start(t+tt);bs.stop(t+tt+0.03);
}
tt+=syl+(AU.rnd()<0.3?0.05:0);
}
src.start(t);src.stop(t+dur+0.1);
}

/* procedural sounds — flashlight mechanics, cabinets and darkness fears */
/* Flashlight switch click: a mechanical "clack" — an ultrashort tick, a body
 snap and a low thud; every press differs a bit. on — a sharp press, off —
 softer, with a spring-return click. */
function auClick(vol,pan,on){
if(!AU.on)return;
const c=AU.ctx,t0=c.currentTime+0.001,R=AU.rnd;
const p=c.createStereoPanner();p.pan.value=pan||0;p.connect(AU.master);
const nb=(t,f,q,dur,v,type)=>{   /* short noise burst */
const s=c.createBufferSource();s.buffer=AU.noise;s.playbackRate.value=0.9+R()*0.3;
const bf=c.createBiquadFilter();bf.type=type;bf.frequency.value=f*(0.9+R()*0.2);bf.Q.value=q;
const g=c.createGain();
g.gain.setValueAtTime(Math.max(0.0002,v),t);
g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
s.connect(bf);bf.connect(g);g.connect(p);
s.start(t,R()*1.4);s.stop(t+dur+0.02);
};
const thud=(t,f,v)=>{            /* low body thud */
const o=c.createOscillator();o.type='triangle';
o.frequency.setValueAtTime(f*(0.94+R()*0.12),t);
o.frequency.exponentialRampToValueAtTime(f*0.55,t+0.03);
const g=c.createGain();
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(v,t+0.002);
g.gain.exponentialRampToValueAtTime(0.0001,t+0.045+R()*0.02);
o.connect(g);g.connect(p);o.start(t);o.stop(t+0.09);
};
if(on){
nb(t0,4200,0.8,0.006+R()*0.004,vol*0.85,'highpass');
nb(t0+0.001,1900,1.3,0.014+R()*0.008,vol*0.80,'bandpass');
thud(t0+0.003,300+R()*60,vol*0.80);
}else{
nb(t0,3600,0.8,0.006+R()*0.004,vol*0.55,'highpass');
nb(t0+0.001,1500,1.3,0.014+R()*0.008,vol*0.50,'bandpass');
thud(t0+0.003,230+R()*50,vol*0.60);
const t2=t0+0.011+R()*0.010;     /* the spring returns — a second, quiet click */
nb(t2,3400,0.9,0.005,vol*0.30,'highpass');
nb(t2,1400,1.2,0.010,vol*0.24,'bandpass');
}
}
function auTwist(){
if(!AU.on)return;
auNoise(0.16,1500,2.2,0.26,0);auTone(210,150,0.14,'triangle',0.14,0);
}
function auRustle(){ if(!AU.on)return; auNoise(0.30,700,0.9,0.30,0); }
function auBattOut(){ if(!AU.on)return; auNoise(0.07,1800,1.6,0.28,0);auTone(520,300,0.07,'triangle',0.13,0); }
/* the battery seats into the flashlight: a dull cell thud against the stop + a contact click */
function auBattIn(){
if(!AU.on)return;
const c=AU.ctx,t=c.currentTime+0.001,R=AU.rnd;
const p=c.createStereoPanner();p.pan.value=0;p.connect(AU.master);
const o=c.createOscillator();o.type='sine';
o.frequency.setValueAtTime(170+R()*50,t);
o.frequency.exponentialRampToValueAtTime(64,t+0.05);
const g=c.createGain();
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(0.45,t+0.003);
g.gain.exponentialRampToValueAtTime(0.0001,t+0.09+R()*0.03);
o.connect(g);g.connect(p);o.start(t);o.stop(t+0.14);
const s=c.createBufferSource();s.buffer=AU.noise;s.playbackRate.value=1;
const bp=c.createBiquadFilter();bp.type='bandpass';bp.frequency.value=2300+R()*700;bp.Q.value=1.6;
const ng=c.createGain();
ng.gain.setValueAtTime(0.24,t);
ng.gain.exponentialRampToValueAtTime(0.0001,t+0.03);
s.connect(bp);bp.connect(ng);ng.connect(p);
s.start(t,R()*1.4);s.stop(t+0.06);
}
function auDrawer(open){
if(!AU.on)return;
auNoise(open?0.45:0.35,open?260:200,1.1,0.34,0);
auTone(open?95:80,open?60:52,open?0.40:0.30,'triangle',0.20,0);
auNoise(0.06,900,1.5,0.16,0);
}
function auBreath(pan){
if(!AU.on)return;const t=AU.ctx.currentTime;
const src=AU.ctx.createBufferSource();src.buffer=AU.noise;src.loop=true;
const bp=AU.ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.value=520;bp.Q.value=0.9;
const g=AU.ctx.createGain();g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(0.30,t+0.45);g.gain.linearRampToValueAtTime(0.0001,t+1.1);
const p=AU.ctx.createStereoPanner();p.pan.value=pan;
src.connect(bp);bp.connect(g);g.connect(p);p.connect(AU.master);
src.start(t);src.stop(t+1.2);
}
function auScratch(pan){
if(!AU.on)return;const t=AU.ctx.currentTime;
for(let i=0;i<3;i++){const at=t+i*(0.16+AU.rnd()*0.1);
const src=AU.ctx.createBufferSource();src.buffer=AU.noise;
src.playbackRate.value=0.9+AU.rnd()*0.4;
const bp=AU.ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.value=1400+AU.rnd()*900;bp.Q.value=3;
const g=AU.ctx.createGain();
g.gain.setValueAtTime(0.0001,at);g.gain.exponentialRampToValueAtTime(0.22,at+0.02);
g.gain.exponentialRampToValueAtTime(0.0001,at+0.13);
const p=AU.ctx.createStereoPanner();p.pan.value=pan;
src.connect(bp);bp.connect(g);g.connect(p);p.connect(AU.master);src.start(at);src.stop(at+0.16);}
}
function auHeart(vol){
if(!AU.on)return;const t=AU.ctx.currentTime;
const th=(at,v)=>{const o=AU.ctx.createOscillator();o.type='sine';
o.frequency.setValueAtTime(58,at);o.frequency.exponentialRampToValueAtTime(34,at+0.10);
const g=AU.ctx.createGain();g.gain.setValueAtTime(0.0001,at);
g.gain.exponentialRampToValueAtTime(v,at+0.014);g.gain.exponentialRampToValueAtTime(0.0001,at+0.16);
o.connect(g);g.connect(AU.master);o.start(at);o.stop(at+0.2);};
th(t,vol);th(t+0.19,vol*0.66);
}

function auClang(pan,muf){
if(!AU.on)return;
const t=AU.ctx.currentTime;
auNoise(0.05,2500,1,0.18,pan);
const parts=[[187,2.6,0.38],[311,2.2,0.29],[467,1.8,0.21],[689,1.4,0.14],[1013,1.0,0.10],[1452,0.7,0.06]];
for(const [f,dec,v] of parts){
for(const dt of [-0.007,0.007]){
const o=AU.ctx.createOscillator();o.type='sine';
o.frequency.setValueAtTime(f*(1+dt),t);
o.frequency.exponentialRampToValueAtTime(f*(1+dt)*0.985,t+dec);
const g=AU.ctx.createGain();
g.gain.setValueAtTime(0.0001,t);
g.gain.exponentialRampToValueAtTime(v*0.6,t+0.012);
g.gain.exponentialRampToValueAtTime(0.0001,t+dec);
const p=AU.ctx.createStereoPanner();p.pan.value=pan;
o.connect(g);
if(muf){const lf=AU.ctx.createBiquadFilter();lf.type='lowpass';lf.frequency.value=700;g.connect(lf);lf.connect(p)}
else g.connect(p);
p.connect(AU.master);
o.start(t);o.stop(t+dec+0.1);
}
}
}

function auScream(){
if(!AU.on)return;
const t=AU.ctx.currentTime;

auNoise(0.15,300,0.7,0.30,0);
auTone(60,24,0.5,'sine',0.26,0);

const o=AU.ctx.createOscillator();o.type='sawtooth';
o.frequency.setValueAtTime(320,t);
let tt=0,f=320;
while(tt<1.1){
tt+=0.05+AU.rnd()*0.05;
f=Math.min(900,Math.max(140,f*(0.85+AU.rnd()*0.4)));
o.frequency.linearRampToValueAtTime(f*(1-tt*0.35),t+tt);
}
const forms=[[700,5,0.5],[1200,6,0.35],[2600,7,0.2]].map(([fr,q,gv])=>{
const bp=AU.ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.value=fr;bp.Q.value=q;
const g=AU.ctx.createGain();g.gain.value=gv;
o.connect(bp);bp.connect(g);
return g;
});
const ws=AU.ctx.createWaveShaper();
const curve=new Float32Array(256);
for(let i=0;i<256;i++){const x=i/128-1;curve[i]=Math.tanh(x*6)}
ws.curve=curve;
const gV=AU.ctx.createGain();
gV.gain.setValueAtTime(0.0001,t);
gV.gain.exponentialRampToValueAtTime(0.30,t+0.02);
gV.gain.setValueAtTime(0.30,t+0.9);
gV.gain.exponentialRampToValueAtTime(0.0001,t+1.3);
const trem=AU.ctx.createOscillator();trem.type='sine';trem.frequency.value=28;
const tremG=AU.ctx.createGain();tremG.gain.value=0.16;
trem.connect(tremG);tremG.connect(gV.gain);
forms.forEach(g=>g.connect(ws));
ws.connect(gV);gV.connect(AU.master);
o.start(t);trem.start(t);o.stop(t+1.35);trem.stop(t+1.35);

const sh=AU.ctx.createOscillator();sh.type='sawtooth';
sh.frequency.setValueAtTime(1800,t);
sh.frequency.exponentialRampToValueAtTime(420,t+1.0);
const lfo=AU.ctx.createOscillator();lfo.type='sine';lfo.frequency.value=31;
const lfoG=AU.ctx.createGain();lfoG.gain.value=140;
lfo.connect(lfoG);lfoG.connect(sh.frequency);
const ws2=AU.ctx.createWaveShaper();ws2.curve=curve;
const gS=AU.ctx.createGain();
gS.gain.setValueAtTime(0.0001,t);
gS.gain.exponentialRampToValueAtTime(0.10,t+0.02);
gS.gain.exponentialRampToValueAtTime(0.0001,t+1.1);
const pS=AU.ctx.createStereoPanner();pS.pan.value=-0.4;
sh.connect(ws2);ws2.connect(gS);gS.connect(pS);pS.connect(AU.master);
sh.start(t);lfo.start(t);sh.stop(t+1.15);lfo.stop(t+1.15);

[220,233,466].forEach(fr=>{
const c=AU.ctx.createOscillator();c.type='sawtooth';c.frequency.value=fr;
const cg=AU.ctx.createGain();
cg.gain.setValueAtTime(0.0001,t);
cg.gain.exponentialRampToValueAtTime(0.08,t+0.015);
cg.gain.exponentialRampToValueAtTime(0.0001,t+0.45);
c.connect(cg);cg.connect(AU.master);
c.start(t);c.stop(t+0.5);
});

const gr=AU.ctx.createOscillator();gr.type='sine';
gr.frequency.setValueAtTime(90,t+0.9);
gr.frequency.exponentialRampToValueAtTime(45,t+2.0);
const gg=AU.ctx.createGain();
gg.gain.setValueAtTime(0.0001,t+0.9);
gg.gain.linearRampToValueAtTime(0.16,t+1.05);
gg.gain.exponentialRampToValueAtTime(0.0001,t+2.1);
const gw=AU.ctx.createOscillator();gw.type='sine';gw.frequency.value=17;
const gwG=AU.ctx.createGain();gwG.gain.value=0.06;
gw.connect(gwG);gwG.connect(gg.gain);
gr.connect(gg);gg.connect(AU.master);
gr.start(t+0.9);gr.stop(t+2.2);gw.start(t+0.9);gw.stop(t+2.2);
}
let auTimers={cave:4,crk:0,hallu:2};
let prevI=null;
let rlStage=0;

function auHumFrame(s,dt){
if(!AU.humV)return;
const cand=[];
for(let i=0;i<s.lamps.length;i++){
const lp=s.lamps[i];
if(lp.I<0.3)continue;
const lx=lp.x+0.5,ly=lp.y+0.5;
const d=Math.hypot(lx-s.px,ly-s.py);
if(d>16)continue;
const occ=occFactor(s,s.px,s.py,lx,ly);
const g=lp.I*0.22/(1+d*d*0.10)*occ;
if(g<0.0006)continue;
const pan=Math.max(-1,Math.min(1,Math.sin(Math.atan2(ly-s.py,lx-s.px)-s.ang)*1.4));
cand.push({i:i,g:g,pan:pan,vis:los(s,s.px,s.py,lx,ly)});
}
cand.sort((a,b)=>b.g-a.g);
const take=cand.slice(0,AU.humV.length);
for(const v of AU.humV){
let c=null;
for(const t of take)if(t.i===v.lamp){c=t;break}
if(!c&&v.g.gain.value<0.0015){
for(const t of take){
let claimed=false;
for(const w of AU.humV)if(w!==v&&w.lamp===t.i)claimed=true;
if(!claimed){c=t;v.lamp=t.i;break}
}
}
if(c){v.lamp=c.i;v.tg=c.g;v.tp=c.pan;v.tf=c.vis?240:95}
else{v.tg=0;if(v.g.gain.value<0.0015&&v.tg===0)v.lamp=-1}
v.g.gain.value+=(v.tg-v.g.gain.value)*Math.min(1,dt*8);
v.p.pan.value+=(v.tp-v.p.pan.value)*Math.min(1,dt*10);
v.f.frequency.value+=(v.tf-v.f.frequency.value)*Math.min(1,dt*6);
}
}
function auFrame(s,dt){
if(!AU.on||!started||!S||paused)return;
auHumFrame(s,dt);
/* battery-swap sounds along the animation timeline (key phases) */
if(s.fl&&s.fl.rl>0){
const u=(s.time-s.fl.rlT0)/RL_DUR;
const stg=[0.10,0.26,0.54,0.86];
while(rlStage<stg.length&&u>=stg[rlStage]){
const k=rlStage++;
if(k===0||k===3)auTwist();
if(k===1)auBattOut();
if(k===2)auRustle();
}
}else rlStage=0;
/* DARKNESS WHISPERS. More than DARK_HALLU_T seconds without light — the hero
 hears things that aren't there: whispers, breathing, scratching, moans, a
 heartbeat. The pan is random and NOT tied to the Monitor — this is fear, not
 a threat. The longer the darkness, the more often. */
if(s.darkT>DARK_HALLU_T){
auTimers.hallu-=dt;
if(auTimers.hallu<=0){
const over=Math.min(1,(s.darkT-DARK_HALLU_T)/30);
auTimers.hallu=(8-4.5*over)*(0.55+AU.rnd()*0.9);
const pan=(AU.rnd()*2-1)*0.92;
const r=AU.rnd();
if(r<0.34)auWhisper(pan,false);
else if(r<0.55)auBreath(pan);
else if(r<0.74)auScratch(pan);
else if(r<0.88)auCave(pan,false);
else auHeart(0.26+0.24*over);
if(over>0.5&&AU.rnd()<0.3)auHeart(0.20+0.28*over);
}
}else auTimers.hallu=1.5;

if(!prevI||prevI.length!==s.lamps.length)prevI=s.lamps.map(l=>l.I);
auTimers.crk-=dt;
if(auTimers.crk<=0){
for(let i=0;i<s.lamps.length;i++){
const lp=s.lamps[i];
const dI=Math.abs(lp.I-prevI[i]);
prevI[i]=lp.I;
if(dI>0.45){
const d=Math.hypot(lp.x+0.5-s.px,lp.y+0.5-s.py);
if(d<6){
const spL=spat(lp.x+0.5,lp.y+0.5);

auCrack(0.75*spL.att*spL.occ,spL.pan,spL.muf);
auTimers.crk=0.07;
}
}
}
}else{
for(let i=0;i<s.lamps.length;i++)prevI[i]=s.lamps[i].I;
}
if(!s.monster)return;
const dM=Math.hypot(s.px-s.mx,s.py-s.my);
auTimers.cave-=dt;
if(dM<7&&auTimers.cave<=0){
auTimers.cave=4+AU.rnd()*6;
const r=AU.rnd();
const spM=spat(s.mx,s.my);
if(r<0.5)auCave(spM.pan,spM.muf);else if(r<0.8)auWhisper(spM.pan,spM.muf);else auClang(spM.pan,spM.muf);
}
}

function auSeen(pan,muf){
if(!AU.on)return;
const t=AU.ctx.currentTime;
const chain=(pn,g)=>{ if(muf){const lf=AU.ctx.createBiquadFilter();lf.type='lowpass';lf.frequency.value=700;
g.connect(lf);lf.connect(pn)} else g.connect(pn); pn.connect(AU.master); };
[[46,0.18],[49,0.18],[65,0.14],[92,0.11],[98,0.11],[131,0.09]].forEach(([f,gv])=>{
const o=AU.ctx.createOscillator();o.type='sine';o.frequency.value=f;
const g=AU.ctx.createGain();
g.gain.setValueAtTime(0.0001,t);
g.gain.linearRampToValueAtTime(gv,t+0.5);
g.gain.setValueAtTime(gv,t+1.6);
g.gain.linearRampToValueAtTime(0.0001,t+2.8);
const p=AU.ctx.createStereoPanner();p.pan.value=pan;
o.connect(g);chain(p,g);
o.start(t);o.stop(t+2.9);
});
const sh=AU.ctx.createOscillator();sh.type='sine';
sh.frequency.setValueAtTime(660,t);
sh.frequency.linearRampToValueAtTime(990,t+2.2);
const trem=AU.ctx.createOscillator();trem.type='sine';trem.frequency.value=6;
const tremG=AU.ctx.createGain();tremG.gain.value=0.035;
const sg=AU.ctx.createGain();sg.gain.setValueAtTime(0.0001,t);
sg.gain.linearRampToValueAtTime(0.12,t+1.4);
sg.gain.linearRampToValueAtTime(0.0001,t+2.6);
trem.connect(tremG);tremG.connect(sg.gain);
const p2=AU.ctx.createStereoPanner();p2.pan.value=pan;
sh.connect(sg);chain(p2,sg);
sh.start(t);trem.start(t);sh.stop(t+2.7);trem.stop(t+2.7);
const src=AU.ctx.createBufferSource();src.buffer=AU.noise;src.loop=true;
const bp=AU.ctx.createBiquadFilter();bp.type='bandpass';bp.Q.value=1.4;
bp.frequency.setValueAtTime(400,t);bp.frequency.linearRampToValueAtTime(1200,t+2.0);
const ng=AU.ctx.createGain();
ng.gain.setValueAtTime(0.0001,t);
ng.gain.linearRampToValueAtTime(0.50,t+1.5);
ng.gain.linearRampToValueAtTime(0.0001,t+2.6);
const p3=AU.ctx.createStereoPanner();p3.pan.value=pan;
src.connect(bp);bp.connect(ng);chain(p3,ng);
src.start(t);src.stop(t+2.7);
}
function posOf(where){
if(!S)return {d:0,pan:0,muf:false,att:1};
const x=where==='door'?S.door.x+0.5:S.mx;
const y=where==='door'?S.door.y+0.5:S.my;
return spat(x,y);
}

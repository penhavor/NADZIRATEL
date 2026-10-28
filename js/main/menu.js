/* ==== "GAME" PANEL ==== */
function mapFields(){return{on:$('plMapOn'),unexp:$('plMapUnexp'),mon:$('plMapMon'),lamps:$('plMapLamps'),
cabs:$('plMapCabs'),key:$('plMapKey'),spawn:$('plMapSpawn'),exit:$('plMapExit')}}
/* conditional rows: no Monitor — no speed/teleport; no minimap — none of its
   8 sub-toggles (the sub-blocks are wrapped in #monSub/#mapSub) */
function updPlayVis(){
$('monSub').classList.toggle('hidden',!PLAY.mon);
$('mapSub').classList.toggle('hidden',PLAY.map.on===false);
}
function syncControls(){
$('plPreset').value=PLAY.preset;
$('plSeed').value=PLAY.seedText;
$('plW').value=PLAY.W;$('plWV').textContent=PLAY.W;
$('plH').value=PLAY.H;$('plHV').textContent=PLAY.H;
$('plDens').value=(PLAY.dens*100).toFixed(2);$('plDensV').textContent=(PLAY.dens*100).toFixed(2)+'%';
$('plCabD').value=(PLAY.cabD*100).toFixed(2);$('plCabDV').textContent=(PLAY.cabD*100).toFixed(2)+'%';
$('plLoot').value=(+PLAY.loot).toFixed(2);$('plLootV').textContent=(+PLAY.loot).toFixed(2)+'%';
$('plMon').checked=PLAY.mon;
$('plMonSp').value=PLAY.monSp;$('plMonSpV').textContent=PLAY.monSp;
$('plTp').checked=PLAY.tp;
const mf=mapFields();for(const k in mf)mf[k].checked=!!PLAY.map[k];
updPlayVis();
$('setSens').value=SENS;$('setSensV').textContent=(+SENS).toFixed(1);
}
function applyPresetData(name){   /* data only — safe to call before the UI is synced */
const p=PRESETS[name];if(!p)return false;
PLAY.preset=name;PLAY.W=p.W;PLAY.H=p.H;PLAY.dens=p.density;PLAY.cabD=p.cabD;PLAY.loot=p.loot;
PLAY.mon=p.monster;PLAY.monSp=Math.round(p.monsterSpeed*3.6*CELL_M);PLAY.tp=p.teleport;
PLAY.map=Object.assign({},p.map);return true;
}
function applyPlayPreset(name){
if(applyPresetData(name)){syncControls();updMazeInfo();scheduleSave()}
}
function playMatchesPreset(){
const p=PRESETS[PLAY.preset];if(!p)return true;
const kmh=Math.round(p.monsterSpeed*3.6*CELL_M);
if(PLAY.W!==p.W||PLAY.H!==p.H||PLAY.mon!==p.monster||PLAY.monSp!==kmh||PLAY.tp!==p.teleport)return false;
if(Math.abs(PLAY.dens-p.density)>1e-9||Math.abs(PLAY.cabD-p.cabD)>1e-9||Math.abs(PLAY.loot-p.loot)>1e-9)return false;
for(const k in MAP_DEF)if(!!PLAY.map[k]!==!!p.map[k])return false;
return true;
}
let mazeT=0;
function touchPlay(){   /* editing any item: fall off the preset, save, recompute the loot */
if(PLAY.preset!=='custom'&&!playMatchesPreset()){PLAY.preset='custom';$('plPreset').value='custom'}
scheduleSave();
clearTimeout(mazeT);mazeT=setTimeout(updMazeInfo,120);   /* debounce: the calc runs the generator 3 times */
}
$('plPreset').onchange=e=>{
if(e.target.value!=='custom')applyPlayPreset(e.target.value);
else{PLAY.preset='custom';scheduleSave()}};
let seedT=0;
$('plSeed').oninput=e=>{PLAY.seedText=e.target.value;scheduleSave();
clearTimeout(seedT);seedT=setTimeout(updMazeInfo,300)};
$('plW').oninput=e=>{PLAY.W=parseInt(e.target.value,10);$('plWV').textContent=PLAY.W;touchPlay()};
$('plH').oninput=e=>{PLAY.H=parseInt(e.target.value,10);$('plHV').textContent=PLAY.H;touchPlay()};
$('plDens').oninput=e=>{PLAY.dens=parseFloat(e.target.value)/100;$('plDensV').textContent=(PLAY.dens*100).toFixed(2)+'%';touchPlay()};
$('plCabD').oninput=e=>{PLAY.cabD=parseFloat(e.target.value)/100;$('plCabDV').textContent=(PLAY.cabD*100).toFixed(2)+'%';touchPlay()};
$('plLoot').oninput=e=>{PLAY.loot=parseFloat(e.target.value);$('plLootV').textContent=(+PLAY.loot).toFixed(2)+'%';touchPlay()};
$('plMon').onchange=e=>{PLAY.mon=e.target.checked;updPlayVis();touchPlay()};
$('plMonSp').oninput=e=>{PLAY.monSp=parseInt(e.target.value,10);$('plMonSpV').textContent=PLAY.monSp;touchPlay()};
$('plTp').onchange=e=>{PLAY.tp=e.target.checked;touchPlay()};
{const mf=mapFields();for(const k in mf)mf[k].onchange=e=>{PLAY.map[k]=e.target.checked;if(k==='on')updPlayVis();touchPlay()};}
$('setSens').oninput=e=>{SENS=parseFloat(e.target.value);$('setSensV').textContent=SENS.toFixed(1);scheduleSave()};

/* Item calc: really run the generator at the current densities. The seed is
 unknown (random) — run it on three fixed ones and take the worst case for the
 warnings. Warn only, never forbid. */
function updMazeInfo(){
const W=PLAY.W,H=PLAY.H;
const txt=PLAY.seedText.trim();
/* the estimate runs the real generator: on the typed seed (the XS_MAZE stream,
   exactly as in game) or on three fixed probe seeds */
const seeds=txt!==''?[xsStream(xsSeed(seedBytesFromText(txt)),XS_MAZE).rnd]
:[xsFromU32(0x51D7).rnd,xsFromU32(0xB00B5).rnd,xsFromU32(0xC0FFEE).rnd];
let wT=1e9,wK=1e9,wB=1e9,sT=0,sK=0,sB=0;
for(const sd of seeds){
const m=genMaze(sd,W,H,{cabDens:PLAY.cabD,loot:PLAY.loot});
let k=0,b=0;
for(const cb of m.cabs){if(cb.content==='key')k++;else if(cb.content)b++}
wT=Math.min(wT,m.cabs.length);wK=Math.min(wK,k);wB=Math.min(wB,b);
sT+=m.cabs.length;sK+=k;sB+=b;
}
const est=seeds.length>1,n=seeds.length;
const T=est?Math.round(sT/n):wT,K=est?Math.round(sK/n):wK,B=est?Math.round(sB/n):wB;
$('mazeInfo').textContent='Расчёт для этой карты — тумбочек: '+(est?'~':'')+T+' · с лутом: '+(est?'~':'')+(K+B)+
' (ключ '+(K?'✓':'✗')+', батарейных: '+(est?'~':'')+B+')';
const iss=[];
if(wT===0)iss.push('тумбочек не будет вовсе — ни лута, ни ключа');
else if(wK===0)iss.push('ключ не сгенерируется — выбраться из лабиринта невозможно');
else if(wB===0)iss.push('батареек не будет нигде');
const warn=iss.length?'⚠ Не все предметы сгенерируются: '+iss.join('; ')+'.'+(wK===0&&wT>0?' Игра станет непроходимой.':''):'';
const w=$('mazeWarn');w.textContent=warn;
w.classList.toggle('hidden',!warn);
w.classList.toggle('bad',wT===0||wK===0||wB===0);
}

/* ==== MENU NAVIGATION ==== */
let menuScr='main';   /* current menu screen: stingers sound only on the main one (see musSting) */
function menuScreen(n){
menuScr=n;
show('msMain',n==='main');show('msPlay',n==='play');show('msSet',n==='set');
/* main screen — widgets on the left over the scene; panels — centered */
$('menu').classList.toggle('onmain',n==='main');
}
$('miPlay').onclick=()=>menuScreen('play');
$('miSet').onclick=()=>openSettings(false);
$('miExit').onclick=()=>{
try{window.close()}catch(e){}
setTimeout(()=>{show('bye',true)},300);   /* the browser didn't release the window — say goodbye */
};
$('byeBack').onclick=()=>show('bye',false);
$('plBack').onclick=()=>menuScreen('main');
document.querySelectorAll('.ahead').forEach(b=>{b.onclick=()=>b.parentElement.classList.toggle('open')});
$('bindReset').onclick=()=>{binds=JSON.parse(JSON.stringify(DEF_BINDS));buildBindsPanel();scheduleSave();updMenuHints()};
/* "Sound lab" — a small widget top-right (dev mode) */
$('sndW').onclick=()=>{AU.rnd=xsFromU32(0xA0D10E23).rnd;
auInit();if(AU.ctx&&AU.ctx.state==='suspended')AU.ctx.resume();
if(AU.humV)for(const v of AU.humV){v.g.gain.value=0;v.lamp=-1;v.tg=0;}
auSetMute(false);show('sndlab',true)};

function startCfg(){return{preset:PLAY.preset,seedText:PLAY.seedText,W:PLAY.W,H:PLAY.H,dens:PLAY.dens,
cabD:PLAY.cabD,loot:PLAY.loot,mon:PLAY.mon,monSpKmh:PLAY.monSp,tp:PLAY.tp,
map:Object.assign({},PLAY.map),sens:SENS}}
async function startGame(c){
if(ldBusy)return;ldBusy=true;
ldShow('мир');
started=false;screaming=false;   /* the old run stops simulating under the loader */
try{
cfg=Object.assign({},c);
menuS=null;view.classList.remove('menubg');
const mp=c.map||MAP_DEF;
/* ?gfx= — debug preset override from the URL */
const qg=new URLSearchParams(location.search).get('gfx');
if(qg&&QUALITY[qg]){GFX.preset=qg;GFX.v=knobsOf(QUALITY[qg])}
Q=buildQ();
/* the round seed: typed text (or a random one in printable form) → SHA3-512 →
   64 bytes → Xoshiro512** WITHOUT truncation; the whole round derives from it */
let seedText,seedBytes;
if(c.seedBytes){seedBytes=c.seedBytes;seedText=c.seedText||seedHex(seedBytes)}   /* replay */
else{
seedText=(c.seedText&&c.seedText.trim()!=='')?c.seedText.trim():randSeedText();
seedBytes=seedBytesFromText(seedText);
}
LD.set(8,'мир');await LD.tick();
S=Object.assign(newState(seedBytes,{W:c.W,H:c.H,monster:c.mon,monsterSpeed:KMH(c.monSpKmh),
density:c.dens,teleport:c.tp,cabDens:c.cabD,loot:c.loot,map:mp}),{sens:c.sens});
S.seedText=seedText;
invSig='~';rlStage=0;auTimers.hallu=2;
const sig=gpuSigOf(S.seed,S.W,S.H);   /* the GRID dims — same key gpuInitQ stores */
if(!(GPU.ready&&GPU.sig===sig&&!gpuPend)){
/* GPU rebuild: first fade the frozen menu/game frame */
if(GPU.ready&&!gpuBusy)GPU.clearBlack();
ldTrack(12,76);
GPU.ok=await gpuInitQ(view,S);
window.LDSTEP=null;
}else GPU.ok=true;
if(!GPU.ok){   /* render didn't come up — back to the menu, not to a black screen */
setMsg('WebGPU недоступен — включите аппаратное ускорение и перезагрузите страницу','#ff6b6b');
await ldHide();
show('menu',true);menuScreen('main');
ldTrack(10,78);await menuBgStart();window.LDSTEP=null;
musMenu(true);
return;
}
LD.set(90,'звук');await LD.tick();
auInit();if(AU.ctx&&AU.ctx.state==='suspended')AU.ctx.resume();
AU.rnd=S.rndA;   /* all randomness, audio included — from the seed */
auReseedNoise();
/* loading is nearly done: the menu music ducks fast-but-smoothly — then the game starts */
LD.set(94,'');
musMenu(false,0.45);
await ldWait(500);
started=true;botMode=false;paused=false;screamT=0;prevI=null;crouchTog=false;setFromPause=false;gfxDirty=false;clearKeys();
showMap=mp.on!==false;
devOn=devMode;show('devPanel',devMode);
{const base={dvNoclip:'noclip',dvInvis:'invisible',dvStam:'∞ стамина',dvMan:'манекен'};
for(const id in base)$(id).textContent=base[id]
$('dvTp').textContent='3-е лицо: '+TP_LABEL[S.thirdPerson|0];}
view.style.transform='';
show('menu',false);show('end',false);show('pause',false);show('bye',false);
show('hud',true);show('minimap',showMap);show('invBar',true);show('cross',true);
$('preLbl').textContent=diffName(c.preset);
$('botBtn').textContent='Автопилот';
gameResize();
view.classList.toggle('pixelated',!!Q.pixelated);
S.pitch=0;
auSetMute(false);
setMsg(c.mon?'Фонарик — на столе. Ключ — в одной из тумбочек. Потом дверь.':'Тренировочный режим: Надзирателя нет. Выучите маршруты.','#63e6be');
await ldHide();
requestLook(true);   /* the gesture is usually still "fresh"; if not — a click on the game captures the mouse */
}catch(e){window.LDSTEP=null;try{console.warn('startGame failed:',e)}catch(_){}
$('loader').classList.add('hidden');}
finally{ldBusy=false}
}
function setPaused(p){
if(!started||!S||S.won||S.caught)return;
/* the tab was hidden / the lock dropped while the settings were open over the
   pause — fold the panel back, the pause must be the topmost screen */
if(p&&setFromPause)closeSettings();
paused=p;
if(p)clearKeys();   /* keys held at the moment of the pause must not survive it */
if(p)setPauseSeed();
show('pause',p);
auSetMute(p);
if(p&&document.pointerLockElement)document.exitPointerLock();
}
async function toMenu(){
if(ldBusy)return;ldBusy=true;
ldShow('меню');
started=false;paused=false;locked=false;screaming=false;setFromPause=false;gfxDirty=false;clearKeys();
show('manual',false);show('end',false);show('pause',false);
devOn=false;show('devPanel',false);
if(document.pointerLockElement)document.exitPointerLock();
if(AU.on&&AU.humG)AU.humG.gain.value=0;
if(AU.humV)for(const v of AU.humV){v.g.gain.value=0;v.lamp=-1;v.tg=0;}
auSetMute(true);
view.style.transform='';
show('menu',false);show('hud',false);show('minimap',false);show('cross',false);show('invBar',false);
mctx.clearRect(0,0,mm.width,mm.height);
fxc.clearRect(0,0,fxcv.width,fxcv.height);
fxcv.style.transform='';
try{
LD.set(8,'меню');await LD.tick();
ldTrack(12,76);
await menuBgStart();   /* a new random background maze on every return to the menu */
window.LDSTEP=null;
/* loading is nearly done: the music swells fast-but-smoothly — then the menu opens */
LD.set(92,'музыка');await LD.tick();
menuScreen('main');show('bye',false);
musMenu(true);
await ldWait(500);
show('menu',true);
await ldHide();
}catch(e){window.LDSTEP=null;show('menu',true);$('loader').classList.add('hidden')}
finally{ldBusy=false}
}
function endScreen(won){
clearKeys();   /* the run is over: a held key must not carry into the next round */
show('end',true);
$('endTitle').textContent=won?'ДВЕРЬ ОТКРЫТА. ВЫ ВЫШЛИ.':'НАДЗИРАТЕЛЬ ДОГНАЛ ВАС';
$('endTitle').className=won?'t':'w';
/* stats as label:value lines; the seed is arbitrary text — rows via textContent */
const es=$('endStats');es.textContent='';
const esRow=(k,v)=>{const d=document.createElement('div'),b=document.createElement('b');
b.textContent=k+': ';d.appendChild(b);d.appendChild(document.createTextNode(v));es.appendChild(d);};
esRow('Сид',S.seedText);
esRow('Размер',(S.W-4)+' × '+(S.H-4));
esRow('Время',fmtDur(S.time));
esRow('Пройденное расстояние',fmtDist(S.steps*CELL_M));
esRow('Сложность',diffName(PLAY.preset));
if(S.monster)esRow('Надзиратель',won?'обманут':'быстрее');
if(document.pointerLockElement)document.exitPointerLock();
}

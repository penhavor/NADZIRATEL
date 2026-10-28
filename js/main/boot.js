/* the music engine is built IN ADVANCE (reverb IR and noise buffers — heavy
 CPU): on Enter only the start remains, the sound appears instantly */
function musBuild(){
if(MUS||!AU.ctx)return;
try{MUS=new MusEng(AU.ctx,(Math.random()*4294967296)>>>0,musParams(musFear()))}catch(e){MUS=null}
}
async function boot(){
try{
LD.set(2,'настройки');
loadSettings();
buildBindsPanel();
buildGfxPanel();
$('gfxPreset').value=GFX.preset;
syncControls();
applyDevMode();
menuScreen('main');
updMazeInfo();
updMenuHints();
await LD.tick();
LD.set(6,'видеокарта');
window.LDSTEP=async(f,l)=>{LD.set(6+Math.round(f*80),l);await LD.tick()};
await menuBgStart();   /* background maze + GPU.init (progress from inside) + the first frame */
window.LDSTEP=null;
await LD.tick();
LD.set(90,'звук');
auInit();
musBuild();
await LD.tick();
}catch(e){window.LDSTEP=null;try{console.warn('boot failed:',e)}catch(_){}}
LD.set(100,'готово');LD.lbl.textContent='';
$('ldGo').classList.remove('hidden');
LD.ready=true;
}
boot();
addEventListener('keydown',function ldEnter(e){
if(e.code!=='Enter'||!LD.ready||LD.done)return;
LD.done=true;
removeEventListener('keydown',ldEnter);
$('loader').classList.add('hidden');
show('menu',true);
AU.unlocked=true;
musMenu(true);   /* gesture: the context comes alive and the music starts the same instant */
});

let last=performance.now();
/* HUD record cache: identical values aren't written to the DOM again
 (textContent/style are mutations and recalcs even when the value didn't change) */
const _hudC={};
function setTxt(id,v){if(_hudC['t'+id]===v)return;_hudC['t'+id]=v;const e=$(id);if(e)e.textContent=v;}
function setSty(id,k,v){const key=id+'.'+k;if(_hudC[key]===v)return;_hudC[key]=v;const e=$(id);if(e)e.style[k]=v;}
/* ==== MAIN LOOP ==== */
function frame(now){
requestAnimationFrame(frame);
const dtRaw=Math.min(0.05,(now-last)/1000);last=now;
/* FPS — frames the GPU honestly completed over a ~0.5 s window. Neither the
 monitor's hertz nor the rAF tick frequency affect this number anymore. */
if(started&&S&&!paused&&!gpuBusy){
if(!fpsT0){fpsT0=now;fpsN0=GPU.framesDone|0}
else if(now-fpsT0>=500){
const fps=((GPU.framesDone|0)-fpsN0)*1000/(now-fpsT0);
fpsT0=now;fpsN0=GPU.framesDone|0;
const fe=$('fpsLbl');
if(fe&&fps>=0){const fv=Math.min(999,Math.round(fps));
fe.textContent=''+fv;fe.className=fv>=50?'fg':(fv>=30?'fm':'fb');}
}
}else fpsT0=0;
if(!started||!S){
if(!started&&menuS&&GPU.ready&&!gpuBusy){menuTick(dtRaw);GPU.frame(menuS,dtRaw)}
return;
}
const dt=dtRaw;
if(screaming){
screamT+=dtRaw;
if(GPU.ready&&!gpuBusy)GPU.frame(S,dtRaw);
drawScreamer(screamT);
if(screamT>1.9){screaming=false;fxcv.style.transform='';fxc.clearRect(0,0,fxcv.width,fxcv.height);if(screamFatal)endScreen(false)}
return;
}
if(paused)return;
if(!locked&&lockRetryAt&&now>=lockRetryAt){lockRetryAt=0;requestLook(false)}
if(actLock>0)actLock=Math.max(0,actLock-dt);
if(swPulse>=0){const sl=swPulse;swPulse=-1;
if(!(S.fl.rl>0)&&!S.sw){
const cur=S.sel>=0?S.inv[S.sel]:null;
if(!cur&&!S.inv[sl])S.sel=sl;   /* empty→empty: the hand doesn't change, no animation */
else if(invSwapTo(S,sl,false))actLock=Math.max(actLock,SW_DUR);}}
if(dropPulse){dropPulse=0;   /* G — drop the item from hand to the floor */
if(!(S.fl.rl>0)&&!S.sw&&S.sel>=0&&S.inv[S.sel]&&invSwapTo(S,S.sel,false,true))actLock=Math.max(actLock,SW_DUR);}
const inp=botMode?botInput(S):{
fwd:kd('fwd'),back:kd('back'),
left:kd('left'),right:kd('right'),
turnL:keys.ArrowLeft?1:0,turnR:keys.ArrowRight?1:0,
interact:interactPulse,run:kd('run'),
crouch:crouchTog?1:0,
flash:flashPulse,reload:reloadPulse};
interactPulse=0;flashPulse=0;reloadPulse=0;
const ev=update(S,inp,dt);
/* the one-shot "take/push" clip and the input lock — only if E worked:
 an empty press must neither animate nor block the other actions */
if(inp.interact&&S.actDid){
S.pShot=(S.pActKind==='door')?'push':'interact';S.pShotT0=S.time;
actLock=Math.max(actLock,(S.pActKind==='door')?0.9:PK_DUR);
}
if(ev.includes('reload_start'))actLock=Math.max(actLock,RL_DUR+0.1);
if(ev.includes('flash_on')||ev.includes('flash_off')||ev.includes('flash_dead_try'))actLock=Math.max(actLock,TG_DUR);
/* runK — with a slew limit (a sharp 0↔1 tears the viewmodel arm stance in a
 frame); the target — ACTUAL running (S.runNow from update: Shift && moving &&
 not crouched && has stamina), not just Shift held. */
S.runK=(S.runK||0)+Math.max(-dt/0.22,Math.min(dt/0.22,(S.runNow?1:0)-(S.runK||0)));
if(ev.length){window.__EV=(window.__EV||[]).concat(ev).slice(-40)}
for(const e of ev){
evMsg(e);
if(e==='win')endScreen(true);
if(e==='caught'){screaming=true;screamFatal=true;screamT=0;sizeFx();
scrRng=xsStream(S.seedState,XS_SCR).rnd;auScream()}
else auEvent(e);
}
auFrame(S,dt);
if(GPU.ready&&!gpuBusy)GPU.frame(S,dt);
setTxt('timeLbl',fmtDur(S.time));
setTxt('stepLbl',fmtDist(S.steps*CELL_M));   /* cells → meters */
/* flashlight charge (the color like stamina: green → yellow → red) + inventory */
{const fw=$('flWrap');
if(S.fl.owned){fw.classList.remove('hidden');
const e=Math.max(0,Math.min(1,S.fl.e));
const col='hsl('+Math.round(130*e)+',75%,'+Math.round(42+14*e)+'%)';
setTxt('flPct',Math.round(e*100)+'%');setSty('flPct','color',col);
setSty('flBar','width',(e*100).toFixed(0)+'%');
setSty('flBar','background',col);
}else fw.classList.add('hidden');
updInvHud(S);}
const pctW=(Math.max(0,Math.min(1,S.stam))*100).toFixed(0)+'%';
/* the stamina label is tinted like its bar (green → yellow → red), same as the flashlight one */
const sCol='hsl('+Math.round(130*Math.max(0,Math.min(1,S.stam)))+',75%,'+Math.round(42+14*S.stam)+'%)';
setSty('stamBar','width',pctW);
setSty('stamBar','background',sCol);
setTxt('stPct',Math.round(S.stam*100)+'%');
setSty('stPct','color',sCol);
/* crosshair: a dot; a palm — when the gaze is on a target (hidden at the finish and with autopilot) */
{const cr=$('cross'),live=!S.won&&!S.caught;
cr.classList.toggle('hidden',!live);
cr.classList.toggle('on',live&&!botMode&&!!S.aimT);}
drawMinimap();
}
requestAnimationFrame(frame);

/* ==== INPUT: POINTER LOCK, MOUSE, KEYBOARD ==== */
let lockEl=null,lockRetryAt=0,lockHinted=false,autoTries=0;
function lockTarget(){return view}
function requestLook(byUser){
if(!started||paused||!S||S.won||S.caught)return;
const el=lockTarget();
lockEl=el;
const again=()=>{if(byUser||autoTries<3){autoTries++;lockRetryAt=performance.now()+1300}};
try{
const p=el.requestPointerLock&&el.requestPointerLock();
if(p&&p.catch)p.catch(again);
}catch(e){again()}
}
document.addEventListener('pointerlockchange',()=>{
const wasLocked=locked;
locked=!!document.pointerLockElement&&document.pointerLockElement===lockEl;
if(locked){lockHinted=false;autoTries=0;lockRetryAt=0}
if(!started||!S||S.won||S.caught)return;
if(wasLocked&&!locked)setPaused(true);
});
document.addEventListener('pointerlockerror',()=>{
locked=false;
lockRetryAt=performance.now()+1300;
if(started&&!paused&&!lockHinted){lockHinted=true;
setMsg('Кликните по игре, чтобы вернуть мышь','#ffa94d')}
});
document.addEventListener('mousemove',e=>{
if(!started||!S||paused)return;
if(locked){S.ang+=e.movementX*0.0016*(S.sens||1.4);
S.pitch=Math.max(-1.1,Math.min(1.1,(S.pitch||0)-e.movementY*0.0016*(S.sens||1.4)));}
else if(drag)S.ang+=(e.clientX-lastX)*0.004*(S.sens||1.4),lastX=e.clientX;
});
view.addEventListener('pointerdown',e=>{if(!locked&&!paused){drag=true;lastX=e.clientX}});
addEventListener('pointerup',()=>drag=false);
addEventListener('blur',clearKeys);
/* ==== TAB LOSS: FULL PAUSE ====
 In game — the pause is set automatically; in the menu — all sounds fade and
 freeze (context suspend: scheduled events neither play nor drift in time).
 The common fade — via the AU.duck bus (see auInit). */
let visSusp=false,visT=0;
function audioDuck(on){
if(!AU.ctx||!AU.duck)return;
const t=AU.ctx.currentTime;
clearTimeout(visT);
try{
AU.duck.gain.cancelScheduledValues(t);
AU.duck.gain.setTargetAtTime(on?0.0001:1,t,on?0.06:0.09);
}catch(e){}
if(on){
/* let the sound fade out, and only then freeze the context */
visT=setTimeout(()=>{if(document.hidden&&visSusp&&AU.ctx&&AU.ctx.state==='running')AU.ctx.suspend().catch(()=>{})},280);
}else if(AU.ctx.state==='suspended'&&AU.unlocked)AU.ctx.resume().catch(()=>{});
}
document.addEventListener('visibilitychange',()=>{
if(document.hidden){
visSusp=true;
if(started&&!paused&&!screaming)setPaused(true);   /* game — to pause */
audioDuck(true);
}else if(visSusp){
visSusp=false;
audioDuck(false);
}
});
const keys={};let interactPulse=0,flashPulse=0,reloadPulse=0,swPulse=-1;
/* crouch is a TOGGLE: one press of the "Crouch" bind seats (deep, on
 haunches), the second stands up. */
let crouchTog=false;
/* INPUT LOCK: while an action animation runs, the other action keys are
 ignored — presses don't interrupt or accelerate each other.
 Movement, mouse, M and pause are not locked. */
let actLock=0,dropPulse=0;
const ACT_CROUCH=0.55;   /* crouch: lock duration of the other actions */
/* INPUT RESET: every context switch (pause, menu, end screen, new round, focus
   loss) drops all key flags and pending pulses. A keyup can be swallowed by the
   browser — ESC releases the pointer lock and Chromium suppresses key events
   during that transition — so a movement key released while a menu is open
   would otherwise stay flagged and the player walks on his own after resume. */
function clearKeys(){for(const k in keys)keys[k]=0;
interactPulse=0;flashPulse=0;reloadPulse=0;dropPulse=0;swPulse=-1;drag=false}

addEventListener('keydown',e=>{
if(!started)return;
const a=actOf(e.code);
/* the settings panel is open over the pause: the pause key returns to the pause,
   every other key stays inside the panel (bind capture has its own listener) */
if(setFromPause){
if(a==='pause'&&!bindCapture){e.preventDefault();closeSettings()}
return;}
if(a==='pause'){
/* Esc under mouse capture is eaten by the browser (it exits the pointer lock) —
 the pause is opened by the pointerlockchange handler; don't toggle here, else double */
if(e.code==='Escape'&&locked)return;
if(!S.won&&!S.caught){setPaused(!paused);e.preventDefault()}
return;
}
if(paused)return;
keys[e.code]=1;
if(!e.repeat&&actLock<=0){
if(a==='crouch'){crouchTog=!crouchTog;actLock=ACT_CROUCH}
else if(a==='interact')interactPulse=1;
else if(a==='flash')flashPulse=1;      /* flashlight on/off */
else if(a==='reload')reloadPulse=1;    /* battery swap */
else if(a==='drop')dropPulse=1;        /* drop the item */
else if(a&&a.indexOf('slot')===0)swPulse=(+a.charAt(4))-1;
}
if(e.code==='KeyM'&&!e.repeat&&cfg.map&&cfg.map.on!==false)showMap=!showMap;
if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code))e.preventDefault();
});
addEventListener('keyup',e=>{keys[e.code]=0});
/* inventory — slot binds (1-4 by default): the request goes to swPulse and is
 applied in the main loop (invSwapTo + actLock — spam protection). */

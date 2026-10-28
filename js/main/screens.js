/* Overlay screens: the manual, settings opened from pause (with the live
   GPU re-apply), seed copy, and the pause/end/menu button wiring. */
let manualFrom='menu';
function openManual(from){
manualFrom=from||'menu';
if(from==='game'&&!paused)setPaused(true);
show('manual',true);
}
function closeManual(){
show('manual',false);
}
$('miMan').onclick=()=>openManual('menu');
$('pauseManBtn').onclick=()=>openManual('pause');
/* graphics change without leaving the round: a preset or the "custom" profile.
 Called when the settings panel opened from the pause closes.
 ONLY the player switches graphics — no FPS automation here, ever. */
async function applyGfxNow(){
if(!started||!S)return;
Q=buildQ();
const sig=gpuSigOf(S.seed,S.W,S.H);
let ok=GPU.ready&&GPU.sig===sig&&!gpuPend;
if(!ok){try{ok=await gpuInitQ(view,S);}catch(e){ok=false;}GPU.ok=!!ok;}
if(ok){gameResize();
view.classList.toggle('pixelated',!!Q.pixelated);
if(!gpuBusy){try{GPU.frame(S,0);}catch(e){}}   /* show the new profile instantly */}
else setMsg('Рендер не пересобрался — вернитесь в меню и начните заново','#ff6b6b');
}
/* ==== SETTINGS FROM THE PAUSE ====
   The very same panel as in the main menu (the #msSet node is simply shown over
   the game), so binds, sensitivity AND every graphics knob are editable mid-round.
   Binds and sensitivity are read live; graphics need a GPU rebuild, which is
   heavy — so it happens once, when the panel closes, not on every slider tick. */
function openSettings(fromPause){
setFromPause=!!fromPause;gfxDirty=false;
$('gfxPreset').value=GFX.preset;buildGfxPanel();
if(setFromPause)show('pause',false);   /* accordions are NOT forced open: the player opens what he needs */
show('menu',true);menuScreen('set');
}
function closeSettings(){
if(!setFromPause){menuScreen('main');return}
setFromPause=false;
show('menu',false);show('pause',true);
if(S)S.sens=SENS;
if(gfxDirty){gfxDirty=false;applyGfxNow()}
}
$('pauseSetBtn').onclick=()=>{if(paused)openSettings(true)};
$('stBack').onclick=closeSettings;
$('setDone').onclick=closeSettings;

/* ==== THE SEED IN THE PAUSE ====
   A 512-bit seed doesn't fit the HUD, so it lives here: clipped to the box
   width, and LMB copies the FULL string — that's how a round is replayed
   exactly (paste it into «Игра → Лабиринт → Сид»). */
const SEED_HINT='ЛКМ по сиду — скопировать целиком (512 бит) и вставить в «Игра → Лабиринт → Сид»';
function setPauseSeed(){
if(!S)return;
const el=$('pauseSeed');if(el){el.classList.remove('full');el.textContent='Сид: '+(S.seedText||'—')}
const h=$('pauseSeedHint');if(h){h.classList.remove('ok');h.textContent=SEED_HINT}
}
/* clipboard: the async API first, then the classic execCommand (file://, iframes,
   older browsers); if both refuse — the seed unfolds in place and can be selected */
async function copyText(t){
try{if(navigator.clipboard&&navigator.clipboard.writeText){
await navigator.clipboard.writeText(t);return true}}catch(e){}
try{const ta=document.createElement('textarea');ta.value=t;ta.setAttribute('readonly','');
ta.style.cssText='position:fixed;top:0;left:-9999px;opacity:0';
document.body.appendChild(ta);ta.focus();ta.select();ta.setSelectionRange(0,ta.value.length);
const ok=document.execCommand('copy');ta.remove();return ok}catch(e){return false}
}
let seedHintT=0;
function seedHint(txt,ok){const h=$('pauseSeedHint');if(!h)return;
h.textContent=txt;h.classList.toggle('ok',!!ok);
clearTimeout(seedHintT);seedHintT=setTimeout(setPauseSeed,1800)}
$('pauseSeed').onclick=async()=>{
if(!S||!S.seedText)return;
if(await copyText(S.seedText))seedHint('Сид скопирован в буфер обмена ✓',true);
else{$('pauseSeed').classList.add('full');
seedHint('Буфер недоступен — сид раскрыт целиком, выделите его вручную',false)}
};
$('manClose').onclick=()=>closeManual();
$('startBtn').onclick=()=>{show('manual',false);startGame(startCfg())};
$('resumeBtn').onclick=()=>{setPaused(false);autoTries=0;requestLook(true)};
$('pauseMenuBtn').onclick=toMenu;$('endMenuBtn').onclick=toMenu;
$('againBtn').onclick=()=>startGame(Object.assign({},cfg,{seedBytes:S.seedBytes,seedText:S.seedText}));
$('nextBtn').onclick=()=>startGame(Object.assign({},cfg,{seedBytes:null,seedText:''}));
$('botBtn').onclick=e=>{botMode=!botMode;if(botMode&&S)enableBot(S);
e.target.textContent=botMode?'Автопилот: ВКЛ':'Автопилот'};

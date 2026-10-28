let devOn=false,fpsT0=0,fpsN0=0,manOn=false;
/* DEV mode — ONLY via the URL parameter ?dev=<password>, never stored anywhere
   (gone on the next page load without the parameter). The password itself is
   not present in the code — only its SHA3-512 digest is compared. */
const DEV_HASH='8e2388dd60fe93a9935078ed6d19eb971e03811033ee19c1efc1b9fd28b18f99852ccac73074ce153c011c31c964340889264b0d16dd47f5d1c9cdbe089cd10f';
let devMode=false;
try{localStorage.removeItem('smlDevMode')}catch(e){}   /* the key from older builds */
try{
const dp=new URLSearchParams(location.search).get('dev');
if(dp!==null){
const hb=sha3_512(new TextEncoder().encode(dp));
devMode=seedHex(hb)===DEV_HASH;
}}catch(e){}
function applyDevMode(){
$('sndW').classList.toggle('hidden',!devMode);
if(!devMode){devOn=false;show('devPanel',false)}
}
function devMark(btn,on){btn.textContent=btn.textContent.replace(/ ·ВКЛ$/,'')+(on?' ·ВКЛ':'')}
addEventListener('keydown',e=>{
if(e.code==='F3'&&started&&devMode&&!e.repeat){devOn=!devOn;show('devPanel',devOn);e.preventDefault()}
if(started&&devMode&&devOn&&manOn&&!e.repeat&&(e.code==='BracketLeft'||e.code==='BracketRight')){
const L=ANIM_CLIPS.length;const d=e.code==='BracketRight'?1:-1;
S.manAnim=((S.manAnim<0?0:S.manAnim)+d+L)%L;
setMsg('Манекен: '+ANIM_CLIPS[S.manAnim].label+'  ( [ ] — листать, 0 — авто)','#d0bfff');e.preventDefault()}
if(started&&devMode&&devOn&&manOn&&!e.repeat&&e.code==='Digit0'){S.manAnim=-1;
setMsg('Манекен: авто-цикл всех анимаций','#d0bfff');e.preventDefault()}
});
$('dvNoclip').onclick=e=>{S.dev.noclip=!S.dev.noclip;devMark(e.target,S.dev.noclip)};
$('dvInvis').onclick=e=>{S.dev.invisible=!S.dev.invisible;devMark(e.target,S.dev.invisible)};
$('dvStam').onclick=e=>{S.dev.infStam=!S.dev.infStam;devMark(e.target,S.dev.infStam)};
$('dvMan').onclick=e=>{manOn=!manOn;devMark(e.currentTarget,manOn);
if(manOn)setMsg('Манекен в стартовой комнате: [ ] — клипы, 0 — авто-цикл','#d0bfff');};
/* the button cycles 3 states: off / behind / front */
const TP_LABEL=['откл','сзади','спереди'];
function setThirdPerson(v,btn){if(!S)return;S.thirdPerson=v|0;
const el=btn||$('dvTp');if(el)el.textContent='3-е лицо: '+TP_LABEL[S.thirdPerson|0];
setMsg('Вид: '+(S.thirdPerson?('третье лицо ('+TP_LABEL[S.thirdPerson|0]+')'):'первое лицо'),'#d0bfff');}
$('dvTp').onclick=e=>{setThirdPerson(((S.thirdPerson|0)+1)%3,e.currentTarget);};
$('dvKey').onclick=()=>{S.px=S.key.x+0.5;S.py=S.key.y+0.5};
$('dvDoor').onclick=()=>{
/* Spawn is ALWAYS outside the locked exit room: doorFace points to the cell on
 the maze side (the parent of the BFS tree from the start). The first free
 neighbor cell could be inside the room — a win without the key. */
const ok=q=>q.x>=0&&q.y>=0&&q.x<S.W&&q.y<S.H&&S.grid[q.y*S.W+q.x]===0;
let n=null;
const df=S.doorFace;
if(df){const q={x:S.door.x+df.x,y:S.door.y+df.y};if(ok(q))n=q;}
if(!n){
 const inRoom=new Set((S.exitRoom||[]).map(c=>c.y*S.W+c.x));
 n=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>({x:S.door.x+dx,y:S.door.y+dy}))
  .find(q=>ok(q)&&!inRoom.has(q.y*S.W+q.x));
}
if(n){S.px=n.x+0.5;S.py=n.y+0.5}};
$('dvSummon').onclick=()=>{
/* The Monitor appears close to the player: the first probe — 0.9 cells before
 the gaze; if a wall — a ring of 12 directions at 0.9 and 1.3; no options —
 any free cell nearby. The middle of the player→point segment is checked too —
 don't spawn behind a wall. */
if(!S||!S.monster)return;
let t=null;
for(const rad of [0.75,1.1,1.5]){
 for(let a=0;a<16&&!t;a++){
  const ang=S.ang+a*Math.PI/8;
  const x=S.px+Math.cos(ang)*rad,y=S.py+Math.sin(ang)*rad;
  if(!blocked(S,x,y)&&!blocked(S,S.px+(x-S.px)*0.5,S.py+(y-S.py)*0.5))t={x:x,y:y};
 }
 if(t)break;
}
if(!t){   /* the player is in a sealed pocket (spawn): the nearest free cell, but NOT
 their own (else the monster spawns exactly in the player) */
 let bd=1e9;
 for(const f of S.floors){
  const x=(f%S.W)+0.5,y=((f/S.W)|0)+0.5;
  const d=Math.hypot(x-S.px,y-S.py);
  if(d>0.3&&d<bd){bd=d;t={x:x,y:y}}
 }
}
if(t){S.mx=t.x;S.my=t.y;S.mPath=null;S.mMode='wander';S.mPauseT=0;S.mScan=null;S.mScanOff=0;S.mGait='walk';
setMsg('Надзиратель призван — он прямо рядом с вами.','#ff6b6b')}
else setMsg('Некуда призвать Надзирателя','#ffa94d')};
$('dvScream').onclick=()=>{if(!screaming){screaming=true;screamFatal=false;screamT=0;sizeFx();
scrRng=S?xsStream(S.seedState,XS_SCR).rnd:xsFromU32(0x5CEEF4CE).rnd;auScream()}};

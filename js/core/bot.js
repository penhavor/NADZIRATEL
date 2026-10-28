/* ==== AUTOPILOT ==== */
function enableBot(s){s.bot=true;s.botPath=null;s.botStage=s.hasKey?'door':'key'}
function botInput(s){

const inp={fwd:0,back:0,left:0,right:0,turnL:0,turnR:0,interact:0,run:s.mMode==='chase'?1:0,flash:0,reload:0};
if(s.won||s.caught)return inp;
if(s.hasKey)s.botStage='door';

for(const d of s.safeDoors){
if(!d.want&&d.t<0.6&&Math.hypot(d.x+0.5-s.px,d.y+0.5-s.py)<1.1){inp.interact=1;return inp}
}

const target=s.botStage==='key'?s.key:(s.doorLeaf?(s.winCell||s.door):s.door);
const cur={x:Math.floor(s.px),y:Math.floor(s.py)};
/* length 1 = the path end is reached: repath for the CURRENT target, else a
   stale one-cell path (e.g. left from the key pickup) steers through walls */
if(!s.botPath||s.botPath.length===0||s.botPath[0].x!==cur.x||s.botPath[0].y!==cur.y||s.botPath.length===1)
s.botPath=bfsPath(s,cur,target);
else if(s.botPath.length>1&&s.botPath[1].x===cur.x&&s.botPath[1].y===cur.y)
s.botPath=s.botPath.slice(1);
if(!s.botPath||!s.botPath.length)return inp;
const wp=s.botPath.length>1?s.botPath[1]:target;
const tx=wp.x+0.5,ty=wp.y+0.5;
const want=Math.atan2(ty-s.py,tx-s.px);
let d=want-s.ang;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;
if(d>0.10)inp.turnR=1;else if(d<-0.10)inp.turnL=1;
const distT=Math.hypot(tx-s.px,ty-s.py);
if(Math.abs(d)<0.5&&distT>0.12)inp.fwd=1;
const dd=Math.hypot(s.door.x+0.5-s.px,s.door.y+0.5-s.py);
if(s.hasKey&&invSelKind(s)!=='key')invSelectKind(s,'key');   /* the valve turns the key IN HAND */
if(s.hasKey&&!s.doorOpen&&dd<1.25)inp.interact=1;
if(s.doorOpen&&s.doorUnlocked&&!s.doorLeaf&&dd<1.25)inp.interact=1;   /* push the leaf */
/* the key lies in a cabinet — autopilot walks up and presses E until it takes
 it (first press opens the drawer, second takes the key) */
if(!s.hasKey&&Math.hypot(s.key.x+0.5-s.px,s.key.y+0.5-s.py)<1.0)inp.interact=1;
return inp;
}

/* ================ INTERACTION (E) ================
 Crosshair only: a ray along the view (projected on the plan, pitch doesn't
 matter — objects are low) looks for the FIRST target: cabinet, table, floor
 item, door. The center dot turns into a palm when a target exists (aimTarget
 is computed every frame in update). Autopilot keeps the old "by proximity"
 logic. Returning true = the action HAPPENED: an empty press plays neither
 animation nor input lock. */
function aimTarget(s){
const dx=Math.cos(s.ang),dy=Math.sin(s.ang);
/* ray from the eyes ALONG THE VIEW (yaw+pitch): the screen dot must really
 stand on the item, not merely match by azimuth. hy = ray height in cells. */
const tanP=Math.tan(Math.max(-1.1,Math.min(1.1,s.pitch||0)));
const eye=0.55-0.18*(s.crC||0);   /* eyes: 1.62 m standing, lower when crouching */
const cands=[];
if(!s.flashTaken&&s.table){const b=boxOf(s.table,TBL_D,TBL_W);
cands.push({b:b,t:'table',max:REACH_OBJ,rx:b.cx,ry:b.cy,h:TBL_H+0.08})}
for(const c of s.cabs){const b=boxOf(c,CAB_D,CAB_W);
cands.push({b:b,t:'cab',max:REACH_OBJ,rx:b.cx,ry:b.cy,h:CAB_H,o:c})}
for(const dr of (s.drops||[]))cands.push({b:{cx:dr.wx,cy:dr.wy,hx:0.26,hz:0.26},t:'drop',max:REACH_OBJ,rx:dr.wx,ry:dr.wy,h:0.08,o:dr});
for(const bt of (s.batts||[]))if(!bt.taken)cands.push({b:{cx:bt.x+0.5,cy:bt.y+0.5,hx:0.26,hz:0.26},t:'batt',max:REACH_OBJ,rx:bt.x+0.5,ry:bt.y+0.5,h:0.08,o:bt});
const pcx=Math.floor(s.px),pcy=Math.floor(s.py);
for(let d=0.02;d<=0.7;d+=0.02){   /* 2 cm step: the reach boundary is never "jumped over" */
const x=s.px+dx*d,y=s.py+dy*d;
const hy=eye+d*tanP;
if(hy>=CEIL_H)return null;   /* looking up: the ray left for the ceiling past all targets */
if(hy<=0)return null;        /* looking at the floor in front of the item */
for(const cd of cands)
if(hy<=cd.h&&Math.abs(x-cd.b.cx)<=cd.b.hx&&Math.abs(y-cd.b.cy)<=cd.b.hz){
/* ray hit the box: the radius is measured to the object center, not the entry point */
const dc=Math.hypot(cd.rx-s.px,cd.ry-s.py);
return dc<=cd.max?{t:cd.t,o:cd.o}:null;}
const cx=Math.floor(x),cy=Math.floor(y);
if(cx<0||cy<0||cx>=s.W||cy>=s.H)return null;
const v=s.grid[cy*s.W+cx];
if(v===1)return null;   /* the wall kills the ray */
if(v===2)return d<=REACH_DOOR?{t:'exit'}:null;
if(v===3){
if(cx===pcx&&cy===pcy)continue;   /* standing in the doorway — the door underfoot is not a target */
for(const q of s.safeDoors)if(q.x===cx&&q.y===cy)return d<=REACH_DOOR?{t:'safe',o:q}:null;
if(!safeOpenAt(s,cx,cy))return null;
}
}
return null;
}
/* autopilot doesn't aim: the old distance-based prioritization */
function botTarget(s){
if(!s.flashTaken&&s.table){const tc=boxCenter(s.table,TBL_D);
if(Math.hypot(tc.x-s.px,tc.y-s.py)<1.05)return{t:'table'}}
const c=nearestCab(s,s.px,s.py,1.05);
if(c&&c.cd<=0)return{t:'cab',o:c};
const dr=nearestDrop(s,s.px,s.py,0.8);
if(dr)return{t:'drop',o:dr};
const b=nearestBatt(s,s.px,s.py,0.8);
if(b)return{t:'batt',o:b};
const fx=Math.floor(s.px+Math.cos(s.ang)*0.8),fy=Math.floor(s.py+Math.sin(s.ang)*0.8);
if(cellAt(s,fx,fy)===2)return{t:'exit'};
let bd=1.15,best=null;
for(const d of s.safeDoors){const dd=Math.hypot(d.x+0.5-s.px,d.y+0.5-s.py);
if(dd<bd){bd=dd;best=d}}
return best?{t:'safe',o:best}:null;
}
function pickUp(s,kind,ev){
const sel0=s.sel,had=sel0>=0&&!!s.inv[sel0];
if(!invAdd(s,kind)){ev.push('inv_full');return false}
if(kind==='flash'){s.fl.owned=true;invSelectKind(s,'flash')}
else if(kind==='key'){s.hasKey=true;invFixSel(s)}
else if(!(sel0>=0&&s.inv[sel0]))s.sel=invSlotOfKind(s,'batt');
pkDefer(s,sel0,kind,had);
ev.push(kind==='batt'?'pickup_batt':'pickup_'+kind);
return true;
}
function interact(s,ev,monInSafe){
if(s.fl.rl>0){ev.push('hands_busy');return false}
s.pActKind='item';
const t=s.bot?botTarget(s):s.aimT;
if(!t)return false;
/* 1) the flashlight on the safe-room table */
if(t.t==='table'){
if(!pickUp(s,'flash',ev))return false;
s.flashTaken=true;s.fl.e=1.0;return true;
}
/* 2) cabinet: pull the drawer -> take contents -> push it back */
if(t.t==='cab'){
const c=t.o;
if(c.cd>0)return false;
c.cd=0.35;
if(c.open<0.5){c.want=1;ev.push('cab_open');return true}
if(!c.content||c.looted){c.want=0;ev.push('cab_close');return true}
const ok=pickUp(s,c.content==='key'?'key':'batt',ev);
if(ok)c.looted=true;
return ok;
}
/* 3) floor item: dropped via G */
if(t.t==='drop'){
const dr=t.o;
if(!pickUp(s,dr.kind,ev))return false;
if(dr.kind==='flash')s.fl.e=dr.e||0;
s.drops.splice(s.drops.indexOf(dr),1);
return true;
}
if(t.t==='batt'){
if(!pickUp(s,'batt',ev))return false;
t.o.taken=true;return true;
}
/* 4) exit iron door: the key IN HAND turns the valve, then E pushes the leaf */
if(t.t==='exit'){
if(!s.doorOpen){
if(invSelKind(s)!=='key'){ev.push(s.hasKey?'door_needhand':'door_locked');return false}
s.doorOpen=true;s.doorT=0;s.pActKind='key';ev.push('door_unlock');return true;
}
if(!s.doorUnlocked||s.doorLeaf)return false;   /* the valve is still turning / already open */
s.pActKind='door';s.doorLeaf=true;s.doorLeafT=0;ev.push('door_open');return true;
}
/* 5) safe-room doors — also a push, not a "pickup" */
if(t.t==='safe'){
const best=t.o;
s.pActKind='door';
if(monInSafe){ev.push('safe_denied_mon');return false}
if(!best.want){best.want=1;ev.push('safe_open');return true}
/* won't close while you stand in the doorway */
const qx=Math.max(best.x,Math.min(best.x+1,s.px)),qy=Math.max(best.y,Math.min(best.y+1,s.py));
if(Math.hypot(s.px-qx,s.py-qy)<0.26&&!(s.dev&&s.dev.noclip)){ev.push('safe_denied');return false}
best.want=0;ev.push('safe_close');return true;
}
return false;
}

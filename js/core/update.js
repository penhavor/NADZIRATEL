/* ==== FRAME SIMULATION ==== */
function update(s,inp,dt){
const ev=[];
s.actDid=false;
if(s.won||s.caught)return ev;
inp=Object.assign({fwd:0,back:0,left:0,right:0,turnL:0,turnR:0,interact:0,run:0,flash:0,reload:0},inp);
s.time+=dt;
updateLamps(s,dt);
s.ang+=(inp.turnR-inp.turnL)*2.7*dt;

const movingIn=(inp.fwd||inp.back||inp.left||inp.right)?1:0;
const inf=s.dev&&s.dev.infStam;
/* no running while crouched; stamina: 15 s of running from full, 30 s of
 recovery from zero (difficulty-independent) */
const wantRun=inp.run&&movingIn&&!inp.crouch&&!s.exhausted&&(inf||s.stam>0);
/* ACTUAL running, not "Shift held": the hand viewmodel stretched forward by
 inp.run, and crouching with Shift held pushed the arms forward as if running. */
s.runNow=wantRun?1:0;
if(wantRun&&!inf)s.stam=Math.max(0,s.stam-dt/15);
else s.stam=Math.min(1,s.stam+dt/30);
if(!inf&&s.stam<=0&&!s.exhausted){s.exhausted=true;ev.push('exhausted')}
if(s.exhausted&&(inf||s.stam>0.25))s.exhausted=false;

const crK=s.pCrouch||0;
const sp=(wantRun?RUN_SP:(WALK_SP+(CROUCH_SP-WALK_SP)*crK))*dt;
let f=(inp.fwd?1:0)-(inp.back?1:0),st=(inp.right?1:0)-(inp.left?1:0);
const fl=Math.hypot(f,st);
if(fl>1){f/=fl;st/=fl}
const dx=(Math.cos(s.ang)*f+Math.cos(s.ang+Math.PI/2)*st)*sp;
const dy=(Math.sin(s.ang)*f+Math.sin(s.ang+Math.PI/2)*st)*sp;
const ox=s.px,oy=s.py;
tryMove(s,dx,0);tryMove(s,0,dy);
resolveBoxes(s);   /* cabinets and the table are physical (the player walks around them) */
clampClear(s);     /* camera: never seep through textures */
const moved=Math.hypot(s.px-ox,s.py-oy);
s.steps+=moved;
s.bobA+=(((moved>1e-4)?1:0)-s.bobA)*Math.min(1,dt*7);
/* gait phase comes from the TRAVELLED DISTANCE: each gait has its own
 coefficient (rad/cell), the support foot stays put. Backward movement gives a
 negative phase (natural step back). */
const Kph=wantRun?GAIT_K.run:(GAIT_K.walk+(GAIT_K.sneak-GAIT_K.walk)*crK);
const proj=(s.px-ox)*Math.cos(s.ang)+(s.py-oy)*Math.sin(s.ang);
const phSgn=(moved>1e-6&&proj<-0.35*moved)?-1:1;
s.animPhase=(s.animPhase||0)+moved*Kph*phSgn;
/* the CAMERA bob phase accumulates separately and runs twice as slow as the
 step phase in a run — first-person sway became rarer and stops strobing. */
s.camBobPh=(s.camBobPh||0)+moved*Kph*phSgn*(1-0.55*(s.runK||0));
{const wantA=playerAutoAnim(s);
if(wantA!==(s.pAnimWant||'idle')){s.pAnimPrev=s.pAnimWant||'idle';s.pAnimK=0;s.pAnimWant=wantA;
s.pAnimPrevT0=s.pAnimT0||0;s.pAnimT0=s.time;
/* crossfade duration scales with pose distance: far poses (crouch, jump) fade
 longer so bone speed stays natural */
s.pAnimDur=0.34+0.40*Math.min(1,Math.max(0,poseDistSnap(s,wantA,s.time)/8));}
else s.pAnimK=Math.min(1,(s.pAnimK===undefined?1:s.pAnimK)+dt/(s.pAnimDur||0.34));}
s.pCrouchT=(inp.crouch)?1:0;
s.pCrouch=(s.pCrouch||0)+((s.pCrouchT)-(s.pCrouch||0))*Math.min(1,dt*8);
/* the crouch factor for crouchify goes through a slew filter (0.74 s): raw
 pCrouch ramps in ~0.15 s, so a crouch right after E would be instant. */
s.crC=(s.crC||0)+Math.max(-dt/0.74,Math.min(dt/0.74,(s.pCrouch)-(s.crC||0)));
s.pYawVis=(s.pYawVis===undefined?s.ang:s.pYawVis+wrapPi(s.ang-s.pYawVis)*Math.min(1,dt*12));

/* ==== FLASHLIGHT / INVENTORY / DARKNESS ==== */
const flS=s.fl, busy=flS.rl>0;
/* item switch: sel and the flashlight blackout happen mid-animation (hand down) */
if(s.sw){const su=(s.time-s.sw.t0)/s.sw.dur;
if(su>=0.5&&!s.sw.applied){s.sw.applied=true;
const nk=s.inv[s.sw.slot]?s.inv[s.sw.slot].kind:null;
if(s.sw.fromKind==='flash'&&nk!=='flash'&&flS.on){flS.on=false;ev.push('flash_off')}
if(s.sw.drop){   /* the item hit the floor: hand is down, it's already out of inventory */
if(s.sw.fromKind==='flash'&&flS.on){flS.on=false;ev.push('flash_off')}
const it=s.inv[s.sw.slot];
if(it){const dx=Math.cos(s.ang),dy=Math.sin(s.ang);
let wx=s.px+dx*0.55,wy=s.py+dy*0.55;
if(blocked(s,wx,wy)){wx=s.px+dx*0.30;wy=s.py+dy*0.30;}
if(blocked(s,wx,wy)){wx=s.px;wy=s.py;}
const dr={kind:it.kind,wx:wx,wy:wy,rot:s.rndV()*6.283};
if(it.kind==='batt'){it.n--;if(it.n<=0)s.inv[s.sw.slot]=null;}
else{if(it.kind==='flash')dr.e=s.fl.e;
s.inv[s.sw.slot]=null;}
s.drops.push(dr);ev.push('drop_item');}
s.sel=s.sw.slot;
}else{
s.sel=s.sw.slot;
if(s.sw.tg&&nk==='flash')flS.tgT=s.time;}
}
if(su>=1)s.sw=null;}
/* pickup: the item goes to hand at the right-hand pull apex */
if(s.pk){const pkT=s.time-s.pk.t0;
if(pkT>=PK_APPEAR&&s.inv[s.pk.slot])s.sel=s.pk.slot;
if(pkT>=PK_DUR)s.pk=null;}
/* F/R — only when the flashlight is IN HAND: they don't switch the slot themselves */
if(inp.flash&&!busy&&!s.sw){
if(!flS.owned)ev.push('flash_none');
else if(invSelKind(s)!=='flash')ev.push('flash_needhand');
else if(flS.e<=0){flS.tgT=s.time;ev.push('flash_dead_try')}
else{flS.on=!flS.on;flS.tgT=s.time;ev.push(flS.on?'flash_on':'flash_off')}
}
if(inp.reload&&!busy){
if(!flS.owned)ev.push('flash_none');
else if(invSelKind(s)!=='flash')ev.push('flash_needhand');
else if(flS.e>=0.995)ev.push('batt_fresh');
else if(invCount(s,'batt')<=0)ev.push('no_batt');
else{invRemoveBatt(s);
flS.rl=RL_DUR;flS.rlT0=s.time;flS._sw=false;flS._wasOn=flS.on;
flS.on=false;   /* the lamp goes out for the swap */
ev.push('reload_start')}
}
if(flS.rl>0){
/* the battery is physically moved during the "install" phase (u~=0.70) */
if(!flS._sw&&flS.rl<=RL_DUR*0.30){flS._sw=true;flS.e=1.0;ev.push('batt_in')}
flS.rl-=dt;
if(flS.rl<=0){flS.rl=0;flS._sw=false;
if(flS._wasOn&&flS.e>0)flS.on=true;   /* was burning before the swap — burns again */
flS._wasOn=false;ev.push('reload_done')}
}
if(flS.owned&&flS.on&&flS.e>0){
flS.e=Math.max(0,flS.e-dt/FL_CAP);
if(flS.e<=0){flS.on=false;ev.push('flash_dead')}
}
/* brightness: full up to FL_DIM_AT, below — smooth degradation (the lamp dims
 and warms), at 0% it's out. The agony flicker (<8%) is flashFlick: used by
 both the render and the shadow-leap protection. */
flS.bri=flashBright(flS.e)*(flS.on?flashFlick(s):0);
/* darkness accumulates; resets instantly in light — no hallucination "inertia" */
s.darkT=playerInDark(s)?(s.darkT||0)+dt:0;
/* cabinets: smooth drawer travel (0.5 s), re-E cooldown */
for(const c of s.cabs){
if(c.cd>0)c.cd-=dt;
const tgt=c.want?1:0;
if(c.open!==tgt){
c.open+=(tgt?dt/0.5:-dt/0.55);
c.open=Math.max(0,Math.min(1,c.open));
}
}

s.noiseR=(moved>1e-4&&wantRun)?RUN_NOISE:0;
if(s.noiseR>0)s.noisePos={x:Math.floor(s.px),y:Math.floor(s.py)};

const cx=Math.floor(s.px),cy=Math.floor(s.py);

const monLive=!!(s.monster&&!(s.dev&&s.dev.invisible));
const mxc=monLive?Math.floor(s.mx):-99, myc=monLive?Math.floor(s.my):-99;
let monInSafe=false;
if(monLive){
monInSafe=(mxc===s.start.x&&myc===s.start.y);
if(!monInSafe)for(const d of s.safeDoors)if(mxc===d.x&&myc===d.y){monInSafe=true;break}
}
s.monInSafe=monInSafe;
let forcedMon=false;
for(const d of s.safeDoors){
const wasOpen=d.t>0.5;
d.t=Math.max(0,Math.min(1,d.t+(d.want?dt/0.45:-dt/0.45)));
s.doorState[d.y*s.W+d.x]=d.t;
if((d.t>0.5)!==wasOpen)for(const lp of s.lamps)lp.cells=null;
if(d.want===0&&!(s.dev&&s.dev.noclip)&&cx===d.x&&cy===d.y){
d.want=1;ev.push('safe_forced');
}
if(d.want===0&&monInSafe){d.want=1;forcedMon=true}
}
if(forcedMon)ev.push('safe_forced_mon');
/* explored — ONLY the cell the player physically stands in: what is behind
   a wall is not seen and must not open up on the map */
if(cx>=0&&cy>=0&&cx<s.W&&cy<s.H)markExp(s,cy*s.W+cx);
s.aimT=aimTarget(s);   /* aim target — for E and for the on-screen dot/palm */
if(inp.interact)s.actDid=interact(s,ev,monInSafe);

if(s.doorOpen){
s.doorT=Math.min(1,s.doorT+dt/1.3);   /* valve turning, the leaf still closed */
if(!s.doorUnlocked&&s.doorT>=1)s.doorUnlocked=true;
}
if(s.doorLeaf){
s.doorLeafT=Math.min(1,s.doorLeafT+dt/0.9);
if(s.doorLeafT>=0.55&&s.grid[s.door.y*s.W+s.door.x]===2){
s.grid[s.door.y*s.W+s.door.x]=0;
for(const lp of s.lamps)lp.cells=null;
const wc=s.winCell;
if(wc&&wc.x>=0&&wc.y>=0&&wc.x<s.W&&wc.y<s.H)markExp(s,wc.y*s.W+wc.x);
}
}

if(s.doorUnlocked&&!s.won){
const wc=s.winCell||s.door;
const pdx=s.px-(wc.x+0.5),pdy=s.py-(wc.y+0.5);
if(pdx*pdx+pdy*pdy<0.55*0.55){s.won=true;ev.push('win')}
}
stepMonster(s,dt,ev);
return ev;
}

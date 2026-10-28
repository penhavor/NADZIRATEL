/* ==== MAIN MENU BACKGROUND: a T-shaped corridor 11×11 ====
 A random maze with a guaranteed "T" shape: the crossbar, lamps (-) at the
 crossing sides, the stem with the camera (^) and a controllable lamp (_) at
 the top. The Monitor stands at the crossing (&): while (_) burns — he's
 absent; (_) goes out — he appears and twitches his head. The seed is purely
 random and set nowhere — the maze rebuilds on every menu entry. */
let menuS=null,menuM=null,menuBusy=false;
function menuMonChance(){
if(!PLAY.mon)return 0;
/* a fixed chance per preset; «своя» — always calm, like practice */
return({practice:0,easy:0.05,medium:0.2,hard:0.5,extreme:0.75,impossible:1})[PLAY.preset]||0;
}
function menuMazeState(){
/* the menu is ALWAYS random and never tied to the player's seed: fresh bytes
   on every menu entry */
const s=newState(randBytes(64),{W:9,H:9,monster:true,monsterSpeed:KMH(8),density:0,
teleport:false,cabDens:0,loot:0,map:mapCfg({on:false})});
/* a T-shaped corridor 11x11 inside the 13x13 grid (grid = walkable maze + the
   wall ring + the room belt): the crossbar, lamps (-) at the crossing sides,
   the stem with the camera (^) and a controllable lamp (_), the iron door
   behind the camera. The grid is rebuilt from scratch — nothing of the
   generator's rooms/doors survives into the menu scene */
const W=s.W,H=s.H,MX=W>>1;
const g=s.grid,ix=(x,y)=>y*W+x;
g.fill(1);
for(let x=2;x<=W-3;x++)g[ix(x,2)]=0;            /* T: the crossbar */
for(let y=2;y<=H-3;y++)g[ix(MX,y)]=0;           /* T: the stem */
g[ix(MX,H-3)]=2;                                 /* the iron door behind the camera */
s.start={x:MX,y:H-4};
s.door={x:MX,y:H-3};s.doorFace={x:0,y:-1};
s.doorState=new Float32Array(W*H);
s.winCell={x:MX,y:H-3};s.exitRoom=[];
s.safeDoors=[];s.cabs=[];s.batts=[];s.drops=[];s.table=null;s.flashTaken=true;
s._boxes=[];
const fl=[];for(let i=0;i<W*H;i++)if(g[i]===0)fl.push(i);
s.floors=fl;s.mazeFloors=fl;
s.lamps=[
/* (-) at the crossing sides: their light REACHES the monster and the wall
 behind him (lamp radius 3.2, distance 2) — the silhouette reads, not "black
 on black". base 0.55: when (_) goes out, the crossing stays dim (~0.4), not
 just as bright — the "light died" moment must be noticeable */
{x:MX-2,y:2,base:0.55,gt:12+Math.random()*30,gOff:0,fl:0,on2:true,I:1},
{x:MX+2,y:2,base:0.55,gt:12+Math.random()*30,gOff:0,fl:0,on2:true,I:1},
{x:MX,y:3,ctl:true,on:true,gt:0,gOff:0,fl:0,on2:true,I:1}];
/* the camera — in the stem three cells from the crossing: from the stem bottom
 the monster would be an 8° smudge; here he is large, and the crossing's light
 spot is in frame */
s.px=MX+0.5;s.py=5.55;s.ang=-Math.PI/2;s.pitch=0;s.pYawVis=s.ang;
s.thirdPerson=0;s.noVM=1;
s.monster=false;s.headJerk=0;
s.mx=MX+0.5;s.my=2.5;s.mYaw=0;s.mMode='wander';s.mGait='stand';
s.mSpeedNow=0;s.mPhase=0;s.mScan=null;s.mScanOff=0;s.mPauseT=0;
s.time=0;s.inv=[null,null,null,null];s.sel=-1;
s.fl={owned:false,on:false,e:1,bri:0,rl:0,rlT0:-99,tgT:-99};
menuLamps(s,0);
return s;
}
/* menu light: (-) burn always (rare dips — like in game), (_) — by the scenario */
function menuLamps(s,dt){
const L=s.light,G=s.gate;
L.fill(AMBIENT);G.fill(0);
for(const lp of s.lamps){
if(lp.ctl)lp.I=lp.on?1:0;
else{
lp.gt-=dt;
if(lp.gt<=0){lp.gOff=0.10+0.06*s.rndL();lp.gt=14+s.rndL()*46}
if(lp.gOff>0){lp.gOff-=dt;lp.I=0.05}else lp.I=lp.base||1;
}
if(lp.I>0.03)applyLamp(s,L,G,lp);
}
}
/* scenario: calm → flick (the lamp blinks) → seen (the monster) → calm.
 The chance is checked once a second and only while "all is calm"; 100% —
 an infinite appearance (no vanish-then-instantly-appear). */
function menuScenario(dt){
const s=menuS,jl=menuM.jl,p=menuMonChance();
if(menuM.phase==='calm'){
jl.on=true;
if(p>=1){menuM.phase='seen';menuM.dur=Infinity;s.monster=true;s.headJerk=1;jl.on=false}
else{menuM.t+=dt;
if(menuM.t>=1){menuM.t-=1;
if(Math.random()<p){menuM.phase='flick';menuM.dur=0.14+Math.random()*0.22}}}
}else if(menuM.phase==='flick'){
jl.on=Math.random()<0.5;
menuM.dur-=dt;
if(menuM.dur<=0){menuM.phase='seen';menuM.dur=0.5+Math.random()*1.5;
s.monster=true;s.headJerk=1;jl.on=false;musSting()}
}else{
jl.on=false;s.monster=true;s.headJerk=1;
if(menuM.dur===Infinity&&p<1)menuM.dur=0.7;   /* the difficulty was lowered right in the menu */
if(menuM.dur!==Infinity){menuM.dur-=dt;
if(menuM.dur<=0){menuM.phase='calm';menuM.t=0;s.monster=false;s.headJerk=0;jl.on=true}}
}
}
function menuTick(dt){
const s=menuS;
s.time+=dt;
menuScenario(dt);
menuLamps(s,dt);
}
/* background render — into the whole window, but at a moderate resolution
 (the scene is under a blur anyway): the window aspect, height ≤620, width ≤1700 */
function menuResize(){
if(!menuS||!GPU.ready||gpuBusy)return;
const a=innerWidth/Math.max(1,innerHeight);
let h=620,w=Math.round(h*a);
if(w>1700){w=1700;h=Math.round(w/a)}
GPU.resize(w,h);
}
/* game render fullscreen: the preset's "pixel budget" is preserved, but the
 aspect is taken from the window — the picture is without stretch and without bars */
function gameResize(){
if(!started||!GPU.ready||gpuBusy)return;
const a=innerWidth/Math.max(1,innerHeight);
const area=(Q.res[0]|0)*(Q.res[1]|0);
const h=Math.max(200,Math.round(Math.sqrt(area/Math.max(0.4,a))));
GPU.resize(Math.round(h*a),h);
}
async function menuBgStart(){
if(menuBusy)return;
menuBusy=true;menuS=null;
try{
Q=buildQ();
const ms=menuMazeState();
view.classList.add('menubg');view.classList.remove('pixelated');
if(GPU.ready&&!gpuBusy)GPU.clearBlack();
if(await gpuInitQ(view,ms)){
menuS=ms;menuM={phase:'calm',t:0,dur:0,jl:ms.lamps[2]};
menuResize();
/* the first frame — the heaviest stage (lazy compilation of all pipelines):
 the loading screen marks it separately */
if(window.LDSTEP)await window.LDSTEP(0.98,'первый кадр');
if(GPU.ready)GPU.frame(menuS,0);
}
}catch(e){}
menuBusy=false;
}

/* ==== WORLD GENERATION: maze, cabinets, exit ====
   W/H is the GENERATED maze size — exactly what the player sets in the menu.
   The spawn room and the exit room are NOT part of it: each is a single cell
   OUTSIDE the maze wall ring, joined by its own door (safe / iron). The grid
   is (W+4)x(H+4): the maze ring spans [1..W+2]x[1..H+2], the outer belt stays
   wall except the two room cells. Hence ANY slider combo (1..100, rectangles
   included) yields an intact structure: rooms and doors can never coincide
   with maze cells or with each other, and the exit is always behind the iron
   door. Maze cells sit at odd coordinates; on an EVEN side the 2-step would
   overshoot the last row/column, so the edge cell merges with its neighbour
   by a 1-step (no divider wall) — the classic parity fix. The carve stays a
   spanning tree: a move requires an uncarved destination. */
function genMaze(rnd,W,H,opts){   /* rnd — the .rnd of the XS_MAZE Xoshiro512** stream */
W=Math.max(1,W|0);H=Math.max(1,H|0);   /* sliders 1..100 — guard against out-of-range input */
const GW=W+4,GH=H+4;
const g=new Uint8Array(GW*GH).fill(1);
const ix=(x,y)=>y*GW+x;
const inA=(x,y)=>x>1&&y>1&&x<GW-2&&y<GH-2;   /* inside the walkable maze box */
const start={x:2,y:2};                       /* maze entrance (the spawn room is outside) */
{
const stack=[[2,2]];g[ix(2,2)]=0;
while(stack.length){
const [cx,cy]=stack[stack.length-1];
const dirs=[[2,0],[-2,0],[0,2],[0,-2]];
for(let i=dirs.length-1;i>0;i--){const j=(rnd()*(i+1))|0;const t=dirs[i];dirs[i]=dirs[j];dirs[j]=t}
let moved=false;
for(const [dx,dy] of dirs){
let nx=cx+dx,ny=cy+dy,mid=1;
if(!inA(nx,ny)){nx=cx+(dx>>1);ny=cy+(dy>>1);mid=0}   /* parity 1-step at the even edge */
if(inA(nx,ny)&&g[ix(nx,ny)]===1){
if(mid)g[ix(cx+(dx>>1),cy+(dy>>1))]=0;
g[ix(nx,ny)]=0;
/* edge cells (the parity 1-step) are terminal leafs — the walk does NOT
   continue from them, else a second lattice would open and eat the walls */
if(mid)stack.push([nx,ny]);
moved=true;break;
}
}
if(!moved)stack.pop();
}
}
/* BFS from the maze entrance over corridors (the rooms are not carved yet) */
const dist=new Int32Array(GW*GH).fill(-1),par=new Int32Array(GW*GH).fill(-1);
const q=[ix(start.x,start.y)];dist[q[0]]=0;
for(let qi=0;qi<q.length;qi++){
const c=q[qi],cx=c%GW,cy=(c/GW)|0;
for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
const nx=cx+dx,ny=cy+dy;
if(nx<0||ny<0||nx>=GW||ny>=GH)continue;
const n=ix(nx,ny);
if(g[n]===0&&dist[n]===-1){dist[n]=dist[c]+1;par[n]=c;q.push(n)}
}
}
let maxD=0;
for(let i=0;i<GW*GH;i++)if(g[i]===0&&dist[i]>maxD)maxD=dist[i];
/* EXIT: the farthest maze cell with a free wall-ring neighbour. The iron door
   takes that ring cell, the exit room — the belt cell beyond it, so the portal
   always lives in its own locked room. Outward dir prefers pointing away from
   the entrance (on a 1x1 maze — opposite the safe door: a straight line). */
const RING=(x,y)=>x>=1&&y>=1&&x<=GW-2&&y<=GH-2&&(x===1||y===1||x===GW-2||y===GH-2);
const DIRS=[[0,1],[1,0],[0,-1],[-1,0]];
const sDoor={x:2,y:1},sRoom={x:2,y:0};   /* safe door in the ring, spawn room beyond */
const ringFree=(x,y)=>RING(x,y)&&g[ix(x,y)]===1&&!(x===sDoor.x&&y===sDoor.y);
let cI=-1;
for(let i=0;i<GW*GH;i++){
if(g[i]!==0||dist[i]<0)continue;
const x=i%GW,y=(i/GW)|0;
if(!DIRS.some(([dx,dy])=>ringFree(x+dx,y+dy)))continue;
if(cI<0||dist[i]>dist[cI])cI=i;
}
if(cI<0)cI=ix(start.x,start.y);   /* micro-maps: the entrance itself */
const ccx=cI%GW,ccy=(cI/GW)|0;
const fd=DIRS.filter(([dx,dy])=>ringFree(ccx+dx,ccy+dy));
fd.sort((a,b)=>(b[0]*(ccx-start.x)+b[1]*(ccy-start.y))-(a[0]*(ccx-start.x)+a[1]*(ccy-start.y)));
const dd=fd.length?fd[0]:[0,1];
const door={x:ccx+dd[0],y:ccy+dd[1]};
const room={x:ccx+2*dd[0],y:ccy+2*dd[1]};
const doorFace={x:-dd[0],y:-dd[1]};
g[ix(door.x,door.y)]=2;
g[ix(room.x,room.y)]=0;
g[ix(sDoor.x,sDoor.y)]=3;
g[ix(sRoom.x,sRoom.y)]=0;
/* startComp — the region reachable from the spawn room without the iron door:
   safe doors count as passable (they open freely), grid 2 does not */
const startComp=new Uint8Array(GW*GH);
{ const q=[ix(sRoom.x,sRoom.y)];startComp[q[0]]=1;
for(let qi=0;qi<q.length;qi++){
const c=q[qi],cx=c%GW,cy=(c/GW)|0;
for(const [dx,dy] of DIRS){
const nx=cx+dx,ny=cy+dy;
if(nx<0||ny<0||nx>=GW||ny>=GH)continue;
const n=ix(nx,ny);
if(g[n]!==1&&g[n]!==2&&!startComp[n]){startComp[n]=1;q.push(n)}
}
} }
const pathSet=new Set();let c0=cI;
while(c0!==-1){pathSet.add(c0);c0=par[c0]}

/* Cabinets along walls (0.18-cell depth keeps corridors passable), table with
 the flashlight. All loot lives in cabinets only. cabDens (0..1) = share of
 open cells that get a cabinet; loot (0..100) = share of cabinets with
 contents: one holds the key, the rest — batteries. loot=0 means no key (the
 menu warns but doesn't forbid playing). All deterministic from the seed. */
const cabD=Math.max(0,Math.min(1,opts&&opts.cabDens!=null?+opts.cabDens:0.04));
const lootP=Math.max(0,Math.min(100,opts&&opts.loot!=null?+opts.loot:50));
const excl=new Uint8Array(GW*GH);
excl[ix(door.x,door.y)]=1;excl[ix(room.x,room.y)]=1;
excl[ix(sDoor.x,sDoor.y)]=1;excl[ix(sRoom.x,sRoom.y)]=1;
excl[ix(start.x,start.y)]=1;
const markAround=(cx,cy)=>{ for(const [dx,dy] of DIRS){
const nx=cx+dx,ny=cy+dy;
if(nx>0&&ny>0&&nx<GW-1&&ny<GH-1)excl[ix(nx,ny)]=1; } };
markAround(door.x,door.y);markAround(start.x,start.y);markAround(sDoor.x,sDoor.y);
/* candidates: floor cells with at least one solid wall (the cabinet backs onto it) */
const wallOf=(i)=>{const x=i%GW,y=(i/GW)|0;
const sol=DIRS.filter(([dx,dy])=>{const nx=x+dx,ny=y+dy;
return nx<0||ny<0||nx>=GW||ny>=GH||g[ny*GW+nx]===1});
return sol.length?sol[(rnd()*sol.length)|0]:null};
let cabCands=[];
for(let i=0;i<GW*GH;i++)if(g[i]===0&&!excl[i]&&wallOf(i))cabCands.push(i);
const nTot=Math.min(cabCands.length,Math.round(cabD*cabCands.length));
let nLoot=Math.floor(nTot*lootP/100);
/* key cabinet — as far from spawn as possible; placed only when loot exists */
let keyI;
if(nTot>0&&nLoot>0){
let keyCands=cabCands.filter(i=>startComp[i]&&dist[i]>=Math.ceil(maxD*0.55)&&!pathSet.has(i));
if(!keyCands.length)keyCands=cabCands.filter(i=>startComp[i]&&dist[i]>=Math.ceil(maxD*0.40));
if(!keyCands.length)keyCands=cabCands.filter(i=>startComp[i]&&dist[i]>2);
if(!keyCands.length)keyCands=cabCands.slice();
keyCands.sort((a,b)=>dist[b]-dist[a]);
if(keyCands.length)keyI=keyCands[(rnd()*Math.max(1,Math.min(keyCands.length,6)))|0];
}
const key={x:(keyI===undefined?door.x:keyI)%GW,y:(keyI===undefined?door.x:keyI)/GW|0};
const cabs=[];
const used=new Set();
if(keyI!==undefined){
const w=wallOf(keyI);
cabs.push({x:keyI%GW,y:(keyI/GW)|0,wx:w[0],wy:w[1],content:'key'});
used.add(keyI);nLoot--;
}
/* remaining cabinets: first nLoot get batteries, then empty ones; spacing
 >= 1.8 cells (relaxed to 0 at high density) */
const rest=cabCands.filter(i=>!used.has(i));
for(let i=rest.length-1;i>0;i--){const j=(rnd()*(i+1))|0;const t=rest[i];rest[i]=rest[j];rest[j]=t}
const nPlace=Math.max(0,nTot-cabs.length);
const far=(i,minD)=>{const x=i%GW,y=(i/GW)|0;
for(const c of cabs)if(Math.hypot(c.x-x,c.y-y)<minD)return false;
return true};
let placed=0;
for(const minD of [1.8,1.0,0.01]){
for(const i of rest){
if(placed>=nPlace)break;
if(used.has(i)||!far(i,minD))continue;
const w=wallOf(i);if(!w)continue;
used.add(i);
cabs.push({x:i%GW,y:(i/GW)|0,wx:w[0],wy:w[1],
content:(placed<nLoot)?'batt':null});   /* a drawer always holds exactly ONE item */
placed++;
}
if(placed>=nPlace)break;
}
/* flashlight table in the spawn room: against one of its solid walls (the
 outer belt counts as wall). The spawn looks toward the key — the table goes
 RIGHT, LEFT or BEHIND the player (the side is chosen by the generator). */
{
const solidAt=(x,y)=>x<0||y<0||x>=GW||y>=GH||g[ix(x,y)]===1;
const fkx=key.x-sRoom.x,fky=key.y-sRoom.y;
const fwd=(Math.abs(fkx)>=Math.abs(fky))?[Math.sign(fkx)||1,0]:[0,Math.sign(fky)||1];
const right=[-fwd[1],fwd[0]];   /* 90° clockwise on a y-down map = the right hand */
const cands=[[right[0],right[1]],[-right[0],-right[1]],[-fwd[0],-fwd[1]]];
const solidWalls=cands.filter(([dx,dy])=>solidAt(sRoom.x+dx,sRoom.y+dy));
let tblW=solidWalls.length?solidWalls[(rnd()*solidWalls.length)|0]:null;
if(!tblW)for(const [dx,dy] of [[-1,0],[0,-1],[1,0],[0,1]]){
if(solidAt(sRoom.x+dx,sRoom.y+dy)){tblW=[dx,dy];break}
}
if(!tblW)tblW=[-1,0];
var table={x:sRoom.x,y:sRoom.y,wx:tblW[0],wy:tblW[1]};
}
const floors=[],mazeFloors=[];
for(let i=0;i<GW*GH;i++)if(g[i]===0){floors.push(i);if(inA(i%GW,(i/GW)|0))mazeFloors.push(i)}
const keyI2=key.y*GW+key.x;
return {grid:g,W:GW,H:GH,start:sRoom,door,key,maxDist:maxD,keyDist:dist[keyI2]>=0?dist[keyI2]:maxD,dist,floors,mazeFloors,safeDoors:[{x:sDoor.x,y:sDoor.y}],exitRoom:[room],doorFace,startComp,cabs:cabs,batts:[],table:table,nCand:cabCands.length};
}

/* ==== LAMPS AND LIGHT MAP ==== */
function genLamps(s,density,rnd){
const d=Math.max(0,Math.min(1,density||0));
const lamps=[];
if(d>0){
const minD=1+(1-d)*2;
const order=(s.mazeFloors||s.floors).slice();
for(let i=order.length-1;i>0;i--){const j=(rnd()*(i+1))|0;const t=order[i];order[i]=order[j];order[j]=t}
for(const f of order){
if(rnd()>=d)continue;
const x=f%s.W,y=(f/s.W)|0;
let ok=true;
for(const L of lamps)if(Math.hypot(L.x-x,L.y-y)<minD){ok=false;break}
if(ok)lamps.push({x,y,gt:10+rnd()*40,gOff:0,fl:0,on2:true,I:1});
}

let nearStart=false;
for(const L of lamps)if(Math.hypot(L.x-s.start.x,L.y-s.start.y)<3)nearStart=true;
if(!nearStart){
let best=s.mazeFloors.length?s.mazeFloors[0]:(s.start.y*s.W+s.start.x),bd=1e9;   /* a micro-map without floors — the lamp hangs at the spawn */
for(const f of s.mazeFloors){
const dd=Math.hypot(f%s.W-s.start.x,((f/s.W)|0)-s.start.y);
if(dd<bd){bd=dd;best=f}
}
lamps.push({x:best%s.W,y:(best/s.W)|0,gt:10+rnd()*40,gOff:0,fl:0,on2:true,I:1});
}
}

lamps.push({x:s.start.x,y:s.start.y,gt:1e9,gOff:0,fl:0,on2:true,I:1,always:1});
if(s.exitRoom&&s.exitRoom.length)
lamps.push({x:s.exitRoom[0].x,y:s.exitRoom[0].y,gt:1e9,gOff:0,fl:0,on2:true,I:1,always:1});
return lamps;
}
function buildLampCells(s,lp){

const R=LAMP_R,cells=[];
const lx=lp.x+0.5,ly=lp.y+0.5;
const y0=Math.max(0,Math.floor(ly-R)),y1=Math.min(s.H-1,Math.ceil(ly+R));
const x0=Math.max(0,Math.floor(lx-R)),x1=Math.min(s.W-1,Math.ceil(lx+R));
for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
const gv0=s.grid[y*s.W+x];
if(gv0===1||gv0===2)continue;
const d=Math.hypot(x+0.5-lx,y+0.5-ly);
if(d>R)continue;
const fall=1-d/R;
const vis=losDoorsOpen(s,lx,ly,x+0.5,y+0.5);

cells.push(y*s.W+x, fall, vis?1:0, vis?Math.min(1,0.25+fall*1.6):0);
}
lp.cells=new Float32Array(cells);
}
function applyLamp(s,L,G,lp){
if(!lp.cells)buildLampCells(s,lp);
const c=lp.cells,I=lp.I;
for(let k=0;k<c.length;k+=4){
const i=c[k];
L[i]=Math.min(1,L[i]+I*c[k+1]*0.95*c[k+2]);
if(G){const gv=c[k+3];if(gv>G[i])G[i]=gv}
}
}
function baseLight(s){
const L=new Float32Array(s.W*s.H).fill(AMBIENT);
for(const lp of s.lamps)applyLamp(s,L,null,lp);
return L;
}

/* exploration marks + version counter: the minimap caches the static cell
 layer and repaints it only when the version changes */
function markExp(s,i){if(!s.explored[i]){s.explored[i]=1;s.expV=(s.expV||0)+1}}

/* ==== COLLISIONS AND LINE OF SIGHT ==== */
function cellAt(s,x,y){
const cx=Math.floor(x),cy=Math.floor(y);
if(cx<0||cy<0||cx>=s.W||cy>=s.H)return 1;
return s.grid[cy*s.W+cx];
}
function safeOpenAt(s,cx,cy){ return s.doorState&&s.doorState[cy*s.W+cx]>0.5 }
function blocked(s,x,y){const cx=Math.floor(x),cy=Math.floor(y);const v=cellAt(s,x,y);
if(v===3)return !safeOpenAt(s,cx,cy);
return v===1||v===2}
/* point inside a furniture AABB with margin r. IMPORTANT: if the monster ends
 up inside anyway (shadow teleport), stuckNow lets it walk out freely — so the
 check runs ONLY in free-step probes, not in blocked. */
function inBox(s,x,y,r){
const B=s._boxes;
if(!B||!B.length)return false;
for(let i=0;i<B.length;i++){const b=B[i];
if(Math.abs(x-b.cx)<b.hx+r&&Math.abs(y-b.cy)<b.hz+r)return true;
}
return false;
}
function tryMove(s,dx,dy){
if(s.dev&&s.dev.noclip){
s.px=Math.min(s.W-0.05,Math.max(0.05,s.px+dx));
s.py=Math.min(s.H-0.05,Math.max(0.05,s.py+dy));
return;
}
/* body radius = half-shoulder ~= 0.26 m (0.09 cells). Collision is
 axis-separated (3 probes per axis), corners don't leak; clampClear sets the
 final clearance. */
const r=0.09;
const nx=s.px+dx;
if(!blocked(s,nx+Math.sign(dx)*r,s.py+r)&&!blocked(s,nx+Math.sign(dx)*r,s.py-r)&&!blocked(s,nx+Math.sign(dx)*r,s.py))s.px=nx;
const ny=s.py+dy;
if(!blocked(s,s.px+r,ny+Math.sign(dy)*r)&&!blocked(s,s.px-r,ny+Math.sign(dy)*r)&&!blocked(s,s.px,ny+Math.sign(dy)*r))s.py=ny;
}
/* THE CAMERA NEVER ENTERS TEXTURES: the visual surface is closer than the cell
 boundary — brick has parallax relief (up to 0.032), door hardware sticks out
 PAST the boundary (half-thickness 0.055 + valve up to 0.086), so the bodily
 0.09 is not enough: the near plane and the viewpoint ended up "inside". After
 all collisions the position is squeezed to the clearance by neighbor cell
 type; open safe doors (doorways) never clamp. Axial resolution: at a convex
 corner both clearances fire. */
var CLR_WALL=0.14, CLR_DOOR=0.18;
function clampClear(s){
if(s.dev&&s.dev.noclip)return;
const cx=Math.floor(s.px),cy=Math.floor(s.py);
const clr=(x,y)=>{const v=cellAt(s,x,y);
if(v===2)return CLR_DOOR;
if(v===3)return safeOpenAt(s,x,y)?0:CLR_DOOR;
return v===1?CLR_WALL:0;};
let c;
c=clr(cx+1,cy);if(c&&cx+1-s.px<c)s.px=cx+1-c;
c=clr(cx-1,cy);if(c&&s.px-cx<c)s.px=cx+c;
c=clr(cx,cy+1);if(c&&cy+1-s.py<c)s.py=cy+1-c;
c=clr(cx,cy-1);if(c&&s.py-cy<c)s.py=cy+c;
}
function los(s,x0,y0,x1,y1){
const d=Math.hypot(x1-x0,y1-y0),n=Math.ceil(d/0.15);
for(let i=1;i<n;i++){const t=i/n;if(blocked(s,x0+(x1-x0)*t,y0+(y1-y0)*t))return false}
return true;
}
/* ray for the BAKED light map: doors count as open. Otherwise a door opens —
 and the cells behind it stay dark forever. Closed-door dynamics come from the
 angular shadow map. */
function losDoorsOpen(s,x0,y0,x1,y1){
const d=Math.hypot(x1-x0,y1-y0),n=Math.ceil(d/0.15);
for(let i=1;i<n;i++){const t=i/n;const v=cellAt(s,x0+(x1-x0)*t,y0+(y1-y0)*t);
if(v===1||v===2)return false}
return true;
}

function wallCrossings(s,x0,y0,x1,y1){
const d=Math.hypot(x1-x0,y1-y0),n=Math.ceil(d/0.12);
let k=0,was=blocked(s,x0,y0);
for(let i=1;i<n;i++){const t=i/n;
const b=blocked(s,x0+(x1-x0)*t,y0+(y1-y0)*t);
if(b&&!was)k++;
was=b}
return k;
}
function occFactor(s,x0,y0,x1,y1){
const k=wallCrossings(s,x0,y0,x1,y1);
return k<=0?1:Math.max(0.015,Math.pow(0.14,k));
}
/* ==== PATHFINDING (BFS) ==== */
function bfsPath(s,from,to){
const W=s.W,H=s.H,ix=(x,y)=>y*W+x;
const prev=new Int32Array(W*H).fill(-2);
const q=[ix(from.x,from.y)];prev[q[0]]=-1;
for(let qi=0;qi<q.length;qi++){
const c=q[qi],cx=c%W,cy=(c/W)|0;
if(cx===to.x&&cy===to.y)break;
for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
const nx=cx+dx,ny=cy+dy;
if(nx<0||ny<0||nx>=W||ny>=H)continue;
const n=ix(nx,ny),v=s.grid[n];
const walk=v===0||(v===2&&nx===to.x&&ny===to.y)||(v===3&&safeOpenAt(s,nx,ny));
if(walk&&prev[n]===-2){prev[n]=c;q.push(n)}
}
}
const t=ix(to.x,to.y);
if(!(t>=0&&t<W*H)||prev[t]===-2)return null;   /* NaN/out-of-range target reads as unreachable (the reconstruction loop would never end) */
const path=[];let c=t;
while(c!==-1){path.push({x:c%W,y:(c/W)|0});c=prev[c]}
return path.reverse();
}

function bfsDist(s,to){
const W=s.W,H=s.H,ix=(x,y)=>y*W+x;
const d=new Int32Array(W*H).fill(-1);
const q=[ix(to.x,to.y)];d[q[0]]=0;
for(let qi=0;qi<q.length;qi++){
const c=q[qi],cx=c%W,cy=(c/W)|0;
for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
const nx=cx+dx,ny=cy+dy;
if(nx<0||ny<0||nx>=W||ny>=H)continue;
const n=ix(nx,ny);
if(s.grid[n]===0&&d[n]===-1){d[n]=d[c]+1;q.push(n)}
}
}
return d;
}

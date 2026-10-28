/* ==== LOADING SCREEN: real init steps, ENTER to start ====
 The progress is honest: the bar moves when the next heavy step (settings,
 graphics card, textures, geometry, pipelines, first frame, sound engine)
 really completes — the speed depends on the machine. Entry by Enter only:
 the keypress is a gesture that unlocks sound (autoplay policy), so the menu
 gets voiced the same instant, without waiting for the first click. */
const LD={p:-1,ready:false,done:false,el:null,pct:null,lbl:null,
init(){this.el=$('ldFill');this.pct=$('ldPct');this.lbl=$('ldLbl')},
set(p,l){p=Math.max(0,Math.min(100,p|0));
if(p!==this.p){this.p=p;this.el.style.width=p+'%';this.pct.textContent=p+'%';}
if(l!==undefined&&this.lbl.textContent!==l)this.lbl.textContent=l;},
tick(){return new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)))}};
LD.init();
/* transition loader: the same screen for "Start game" and "Back to menu".
   It finishes BY ITSELF (no Enter) — Enter stays only on the first boot,
   where the keypress unlocks the audio context. */
let ldBusy=false;
const ldWait=ms=>new Promise(r=>setTimeout(r,ms));
function ldShow(label){LD.p=-1;LD.el.style.width='0%';LD.pct.textContent='0%';
LD.lbl.textContent=label||'';$('ldGo').classList.add('hidden');
$('loader').classList.remove('hidden')}
function ldTrack(base,span){window.LDSTEP=async(f,l)=>{LD.set(base+Math.round(f*span),l);await LD.tick()}}
async function ldHide(){LD.set(100,'');await LD.tick();await ldWait(140);
$('loader').classList.add('hidden')}

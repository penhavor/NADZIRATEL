/* ==== UI: MESSAGES, MENUS, SETTINGS ==== */
function setMsg(t,col){
const m=$('msg');m.textContent=t;m.style.color=col||'#ffd43b';m.style.opacity=1;
clearTimeout(msgTimer);msgTimer=setTimeout(()=>m.style.opacity=0,2100);
}
function show(el,on){$(el).classList.toggle('hidden',!on)}
/* HUD labels: no fractions; seconds, then "1 min, 54 s" / "2 km, 255 m" */
function fmtDur(t){t=Math.floor(t);
const h=(t/3600)|0,m=((t%3600)/60)|0,sec=t%60;
if(h)return h+' ч'+(m?', '+m+' мин':'')+(sec?', '+sec+' с':'');
if(m)return m+' мин'+(sec?', '+sec+' с':'');
return sec+' с'}
function fmtDist(m){m=Math.round(m);
const k=(m/1000)|0,r=m%1000;
return k?(k+' км'+(r?', '+r+' м':'')):(m+' м')}
/* difficulty preset → human name (HUD pause line and the end-screen stats) */
function diffName(p){return {practice:'тренировочная',easy:'лёгкая',medium:'средняя',
hard:'сложная',extreme:'экстремальная',impossible:'невозможная'}[p]||'своя'}

/* Shared main-layer state: DOM handles, the live run (S), UI/mode flags. */
const view=document.getElementById('view');
const mm=document.getElementById('minimap'),mctx=mm.getContext('2d');
const fxcv=document.getElementById('fx'),fxc=fxcv.getContext('2d');
const $=id=>document.getElementById(id);
let S=null,started=false,locked=false,drag=false,lastX=0,showMap=true,msgTimer=0,botMode=false;
let paused=false,screaming=false,screamT=0,screamFatal=false;
/* the settings panel opened FROM THE PAUSE (the same panel as in the main menu):
   setFromPause — it's open over the game; gfxDirty — graphics changed there and
   still need one GPU rebuild when the panel closes */
let setFromPause=false,gfxDirty=false;
let scrRng=xsFromU32(0x5CEEF4CE).rnd;
let cfg={};

/* Single source of the version string: menu line and window title derive from it */
const GAME_VER='v1.0.0 (BUILD 120)';
{const _mv=document.querySelector('.mver');
if(_mv)_mv.textContent=GAME_VER+' · WebGPU';
document.title='NADZIRATEL · '+GAME_VER;}

/* Единственный источник строки версии: из неё берутся строка в меню и заголовок окна */
const GAME_VER = 'v1.0.0 (BUILD 121)';
{
  const _mv = document.querySelector('.mver');
  if (_mv) _mv.textContent = GAME_VER + ' · WebGPU';
  document.title = 'NADZIRATEL · ' + GAME_VER;
}

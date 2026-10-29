'use strict';
/* Смоук: страница вообще загружается, ядро на месте, версия правильная. */

__T.test('смоук: все скрипты страницы загрузились без исключений', function () {
  const errs = __T.loadErrors.filter(e => e.error);
  if (errs.length) {
    throw new Error(
      errs.map(e => e.file + ': ' + ((e.error && e.error.message) || e.error)).join('\n')
    );
  }
});

__T.test('смоук: ядро игры доступно (newState/update/genMaze)', function () {
  __T.eq(typeof newState, 'function', 'newState');
  __T.eq(typeof update, 'function', 'update');
  __T.eq(typeof genMaze, 'function', 'genMaze');
  __T.eq(typeof GPU, 'object', 'GPU');
});

__T.test('смоук: версия v1.0.0 (BUILD 121) в GAME_VER, заголовке и меню', function () {
  __T.eq(GAME_VER, 'v1.0.0 (BUILD 121)');
  __T.eq(__T.doc.title, 'NADZIRATEL · v1.0.0 (BUILD 121)');
  const mv = __T.doc.querySelector('.mver');
  __T.ok(mv, 'нет элемента .mver');
  __T.eq(mv.textContent, 'v1.0.0 (BUILD 121) · WebGPU');
});

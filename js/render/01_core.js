const GPU = { ok: false, ready: false, framesDone: 0 };
/* gpuBusy — ресурсы перестраиваются (в это время не рисуем);
   gpuInitQ — очередь инициализации: меню и игра никогда не перестраивают GPU
   одновременно */
let gpuBusy = false,
  gpuPend = 0,
  gpuChain = Promise.resolve();
function gpuInitQ(cv, st) {
  gpuPend++;
  const r = gpuChain.then(() => GPU.init(cv, st));
  gpuChain = r.then(
    () => {
      gpuPend--;
    },
    () => {
      gpuPend--;
    }
  );
  return r;
}
/* крючок экрана загрузки: LDSTEP задан только во время стартовой
   последовательности (f = прогресс 0..1 внутри GPU.init); yield даёт браузеру
   отрисовать полосу */
async function ldStep(f, label) {
  if (window.LDSTEP) await window.LDSTEP(f, label);
}

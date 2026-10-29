/* ==== GPU.frame ==== */
let ssaoK = null;
function bgTex(layout, entries) {
  return dev.createBindGroup({ layout: layout, entries: entries });
}
/* Кэш bind-групп кадра: ресурсы пост-прохода не меняются между ресайзами,
   единственное чередование — пинг-понг объёмного света (фаза в ключе). Чистый
   выигрыш по CPU: минус ~12 createBindGroup на кадр, на картинку влияния ноль. */
let volPhase = 0,
  BG_CACHE = null;
function bgTexC(key, layout, entries) {
  if (!BG_CACHE) BG_CACHE = {};
  let g = BG_CACHE[key];
  if (!g) {
    g = dev.createBindGroup({ layout: layout, entries: entries });
    BG_CACHE[key] = g;
  }
  return g;
}
function fullDraw(pass, pl, off, bg) {
  pass.setPipeline(pl);
  pass.setBindGroup(0, bgPP, [off]);
  pass.setBindGroup(1, bg);
  pass.setVertexBuffer(0, bufPost);
  pass.draw(3, 1);
}

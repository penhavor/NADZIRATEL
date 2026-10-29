'use strict';
/* Загрузка страницы в VM-контекст: либо исходный проект (index.html + файлы
   скриптов по порядку), либо собранный single-file HTML. Оба пути дают одно и то
   же окружение, поэтому отпечатки поведения можно сравнивать напрямую. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createEnv } = require('./env');
const { Recorder } = require('./recorder');
const { Clock } = require('./clock');
const { Hash, hashSeed } = require('./hash');
const { parseNodes } = require('./dom');

/* скрипты и стили из разметки — в порядке документа */
function collectAssets(htmlText, baseDir) {
  const nodes = parseNodes(htmlText, null);
  const scripts = [];
  const styles = [];
  const walk = list => {
    for (const n of list) {
      if (n.nodeType !== 1) continue;
      const tag = n.localName;
      if (tag === 'script') {
        const src = n.getAttribute('src');
        const type = n.getAttribute('type');
        if (!type || type === 'text/javascript' || type === 'module') {
          if (src) scripts.push({ kind: 'file', href: src, file: path.resolve(baseDir, src) });
          else scripts.push({ kind: 'inline', text: rawText(n) });
        }
      } else if (tag === 'link' && (n.getAttribute('rel') || '').toLowerCase() === 'stylesheet') {
        const href = n.getAttribute('href');
        if (href) styles.push({ kind: 'file', href, file: path.resolve(baseDir, href) });
      } else if (tag === 'style') {
        styles.push({ kind: 'inline', text: rawText(n) });
      }
      if (n.childNodes && n.childNodes.length) walk(n.childNodes);
    }
  };
  walk(nodes);
  return { scripts, styles };
}

function rawText(el) {
  let s = '';
  for (const c of el.childNodes) if (c.nodeType === 3) s += c.data;
  return s;
}

/* «высокие» флаги при маленьком атласе и разрешении: все ветки кода рендерера
   задействованы, но инициализация не считает миллионы пикселей */
const TEST_GFX = {
  res: [640, 400],
  atlas: 256,
  aniso: 4,
  dither: 1.0,
  msaa: 4,
  hdr: true,
  tbn: true,
  spec: true,
  pbr: true,
  nrmK: 0.3,
  detN: 0.52,
  pom: 8,
  pomK: 0.016,
  pomRef: 2,
  far: 70,
  propDist: 24,
  shSteps: 96,
  shTaps: 5,
  shRows: 48,
  shLamps: 8,
  ssao: 8,
  ssaoR: 0.4,
  ssaoK: 0.8,
  vol: 8,
  volK: 1.0,
  reflScale: 0.5,
  reflTaps: 4,
  bloomLv: 3,
  sharp: 0.32,
  flare: 1,
  flareK: 0.45,
  grain: 0.016,
  ca: 0.0024
};
const NAMED_GFX = ['low', 'medium', 'high', 'ultra', 'max'];

function testGfxKnobs(quality) {
  if (typeof quality === 'string' && NAMED_GFX.indexOf(quality) >= 0) return { __preset: quality };
  return TEST_GFX;
}

async function loadPage(opts) {
  const o = opts || {};
  const rec = o.rec || new Recorder('NADZIRATEL');
  const clock = new Clock(0);
  const env = createEnv(Object.assign({}, o, { rec, clock }));
  const ctx = vm.createContext(env.sandbox);
  env.sandbox.__T = null;

  const page = {
    env,
    ctx,
    rec,
    clock,
    loadErrors: [],
    files: [],
    scripts: [],
    styles: [],
    mode: o.mode || 'source',
    root: o.root || process.cwd()
  };

  let htmlText, baseDir, assets;
  /* графический профиль теста: все фичи включены, но атлас и разрешение маленькие —
     иначе инициализация рендерера на ultra считает миллионы пикселей */
  if (o.quality && o.quality !== 'off') {
    const v = testGfxKnobs(o.quality);
    const gfx = v.__preset ? { preset: v.__preset, v: {} } : { preset: 'custom', v: v };
    env.localStorageStore.set('nadziratel_cfg', JSON.stringify({ gfx: gfx }));
  }
  if (o.mode === 'bundle') {
    const file = o.file;
    htmlText = fs.readFileSync(file, 'utf8');
    baseDir = path.dirname(path.resolve(file));
    assets = collectAssets(htmlText, baseDir);
    page.source = { html: file };
  } else {
    const htmlPath = o.html || path.join(page.root, 'index.html');
    htmlText = fs.readFileSync(htmlPath, 'utf8');
    baseDir = path.dirname(path.resolve(htmlPath));
    assets = collectAssets(htmlText, baseDir);
    page.source = { html: htmlPath, dir: baseDir };
  }
  page.scripts = assets.scripts;
  page.styles = assets.styles;
  page.htmlText = htmlText;

  env.setHTML(htmlText);

  /* стили не применяются, но их состав фиксируется */
  for (const st of assets.styles) {
    const text = st.kind === 'file' ? fs.readFileSync(st.file, 'utf8') : st.text;
    st.text = text;
    rec.op('css', st.href || 'inline', text.length, hashSeed(text.slice(0, 4096)));
  }

  for (const s of assets.scripts) {
    let code;
    if (s.kind === 'file') {
      if (!fs.existsSync(s.file)) {
        page.loadErrors.push({ file: s.href, error: new Error('нет файла ' + s.file) });
        continue;
      }
      code = fs.readFileSync(s.file, 'utf8');
      page.files.push(s.href);
    } else code = s.text;
    s.code = code;
    try {
      vm.runInContext(code, ctx, { filename: s.href || '<inline>', lineOffset: 0 });
    } catch (e) {
      page.loadErrors.push({ file: s.href || '<inline>', error: e });
      rec.op('loadError', s.href || 'inline', hashSeed(String(e && e.message)), 0);
    }
  }

  /* дождаться завершения boot() и прочих асинхронных инициализаций */
  page.settle = async function (ms, maxSteps) {
    await clock.run(ms === undefined ? 600 : ms, maxSteps || 50000);
    await clock.drain(2000);
    return page;
  };

  page.eval = function (code, filename) {
    return vm.runInContext(code, ctx, { filename: filename || '<eval>' });
  };

  /* значение глобальной переменной (в т.ч. const/let, которых нет в sandbox) */
  page.get = function (name) {
    try {
      return vm.runInContext('typeof ' + name + '==="undefined"?undefined:' + name, ctx);
    } catch (e) {
      return undefined;
    }
  };

  page.has = function (name) {
    try {
      return vm.runInContext('typeof ' + name + '!=="undefined"', ctx);
    } catch (e) {
      return false;
    }
  };

  /* выполнить файл как скрипт страницы (используется для тестовых наборов) */
  page.loadScriptFile = function (file, name) {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, ctx, { filename: name || file });
    return page;
  };

  return page;
}

module.exports = { loadPage, collectAssets, rawText };

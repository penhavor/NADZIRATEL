'use strict';
/* Точка входа headless-тестов.
   node tests/run.js                     — все наборы по исходникам проекта
   node tests/run.js --fingerprint       — только отпечаток поведения (JSON)
   node tests/run.js --bundle build/x.html --alias-map build/x.map.json
                                         — то же по собранному single-file HTML
   node tests/run.js --suite render -v   — фильтры и подробности */

const fs = require('fs');
const path = require('path');
const { loadPage } = require('./harness/page');
const { Recorder } = require('./harness/recorder');
const { createT } = require('./harness/t');
const { yieldMicro } = require('./harness/clock');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const a = {
    suites: [],
    verbose: false,
    fingerprint: false,
    list: false,
    json: null,
    settle: 400,
    quality: 'test',
    gpu: 'hidden'
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--fingerprint' || k === '-f') a.fingerprint = true;
    else if (k === '--verbose' || k === '-v') a.verbose = true;
    else if (k === '--list' || k === '-l') a.list = true;
    else if (k === '--quiet' || k === '-q') a.quiet = true;
    else if (k === '--bundle' || k === '-b') a.bundle = argv[++i];
    else if (k === '--alias-map' || k === '-m') a.aliasMap = argv[++i];
    else if (k === '--suite' || k === '-s') a.suites.push(argv[++i]);
    else if (k === '--json') a.json = argv[++i];
    else if (k === '--settle') a.settle = parseInt(argv[++i], 10) || 0;
    else if (k === '--quality') a.quality = argv[++i];
    else if (k === '--gpu') a.gpu = argv[++i];
    else if (k === '--help' || k === '-h') a.help = true;
    else if (k.startsWith('--')) {
      console.error('неизвестный флаг: ' + k);
      process.exit(2);
    }
  }
  return a;
}

const HELP = `headless-тесты NADZIRATEL

  node tests/run.js [флаги]

  --fingerprint, -f      вывести JSON-отпечаток поведения и выйти
  --bundle, -b <файл>    проверять собранный single-file HTML вместо исходников
  --alias-map, -m <файл> карта переименований сборки (нужна вместе с --bundle)
  --suite, -s <имя>      запускать только наборы, чьё имя содержит <имя> (можно несколько)
  --settle <мс>          сколько виртуального времени дать загрузке страницы (по умолч. 400)
  --quality <профиль>    графика теста: test (по умолч.), low, medium, high, ultra, max, off
  --gpu <режим>          WebGPU: hidden (по умолч., включается в тестах), on (сразу), off
  --json <файл>          записать результат прогона в файл
  --verbose, -v          печатать каждый тест
  --list, -l             только список тестов
`;

/* имена, которые сборщик переименовал, возвращаются в контекст страницы */
function applyAliasMap(page, mapFile) {
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const lines = ['(function(){'];
  for (const orig of Object.keys(map)) {
    const m = map[orig];
    if (orig === m) continue;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(orig)) continue;
    /* если значение в карте — не имя, а литерал, значит сборщик подставил
       константу: сеттера нет, присваивание константе и в исходниках ошибка */
    const ident = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(m);
    lines.push(
      'try{Object.defineProperty(globalThis,' +
        JSON.stringify(orig) +
        ',' +
        '{configurable:true,get:function(){return ' +
        m +
        '}' +
        (ident ? ',set:function(v){' + m + '=v}' : '') +
        '});}catch(e){}'
    );
  }
  lines.push('})();');
  page.eval(lines.join('\n'), '<alias-map>');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const rec = new Recorder('NADZIRATEL');
  const page = await loadPage({
    root: ROOT,
    mode: args.bundle ? 'bundle' : 'source',
    file: args.bundle,
    rec,
    quality: args.quality,
    gpu: args.gpu,
    search: args.search || ''
  });

  const T = createT(page);
  page.env.sandbox.__T = T;
  page.env.sandbox.__REC = rec;

  if (args.bundle && args.aliasMap) applyAliasMap(page, args.aliasMap);
  else if (args.bundle && !args.aliasMap) {
    /* без карты имён тесты работают только через GPU._test и window.* */
  }

  await page.settle(args.settle);
  await yieldMicro();

  if (args.list) {
    loadSuites(page, args);
    for (const t of T.tests) process.stdout.write(t.name + '\n');
    return 0;
  }

  if (args.fingerprint) {
    page.loadScriptFile(path.join(__dirname, 'sim.js'), 'tests/sim.js');
    page.loadScriptFile(path.join(__dirname, 'fingerprint.js'), 'tests/fingerprint.js');
    const fp = await page.eval('__NADZ_FINGERPRINT__(__T)', 'tests/fingerprint.js');
    const out = {
      mode: page.mode,
      source: args.bundle ? path.basename(args.bundle) : 'source',
      sections: fp.sections,
      total: fp.total,
      notes: fp.notes || {},
      ops: rec.ops
    };
    process.stdout.write(JSON.stringify(out, null, 1) + '\n');
    return 0;
  }

  const loadErrs = page.loadErrors.slice();
  loadSuites(page, args);

  const results = [];
  let pass = 0,
    fail = 0,
    skipped = 0;
  for (const t of T.tests) {
    if (!t.fn) {
      skipped++;
      results.push({ name: t.name, status: 'skip', note: String(t.skip) });
      continue;
    }
    const t0 = Date.now();
    try {
      await t.fn();
      await page.clock.drain(500);
      pass++;
      results.push({ name: t.name, status: 'ok', ms: Date.now() - t0 });
      if (args.verbose) process.stdout.write('  [OK]   ' + t.name + '\n');
    } catch (e) {
      fail++;
      results.push({
        name: t.name,
        status: 'fail',
        error: String((e && e.message) || e),
        stack: e && e.stack
      });
      process.stdout.write('  [FAIL] ' + t.name + '\n');
      process.stdout.write(
        '         ' +
          String((e && e.message) || e)
            .split('\n')
            .join('\n         ') +
          '\n'
      );
      if (args.verbose && e && e.stack)
        process.stdout.write(
          '         ' + String(e.stack).split('\n').slice(1, 6).join('\n         ') + '\n'
        );
    }
  }

  /* ошибки загрузки страницы и обработчиков — тоже провал */
  for (const le of loadErrs) {
    fail++;
    results.push({
      name: 'загрузка ' + le.file,
      status: 'fail',
      error: String((le.error && le.error.message) || le.error)
    });
    process.stdout.write(
      '  [FAIL] загрузка ' + le.file + ': ' + ((le.error && le.error.message) || le.error) + '\n'
    );
  }
  const hErrs = page.env.handlerErrors || [];
  for (const he of hErrs) {
    fail++;
    results.push({
      name: 'обработчик ' + he.where,
      status: 'fail',
      error: String((he.err && he.err.message) || he.err)
    });
    process.stdout.write(
      '  [FAIL] обработчик ' + he.where + ': ' + ((he.err && he.err.message) || he.err) + '\n'
    );
  }

  if (!args.quiet) {
    process.stdout.write(
      '\n  всего: ' +
        results.length +
        '  ok: ' +
        pass +
        '  провалов: ' +
        fail +
        (skipped ? '  пропущено: ' + skipped : '') +
        '\n'
    );
    process.stdout.write(
      '  отпечаток: ' + rec.digest() + '  (операций записано: ' + rec.ops + ')\n'
    );
  }

  if (args.json) {
    fs.writeFileSync(
      args.json,
      JSON.stringify(
        {
          mode: page.mode,
          source: args.bundle || 'source',
          pass,
          fail,
          skipped,
          digest: rec.digest(),
          results,
          loadErrors: loadErrs.map(x => ({
            file: x.file,
            error: String((x.error && x.error.message) || x.error)
          }))
        },
        null,
        1
      )
    );
  }

  return fail ? 1 : 0;
}

function loadSuites(page, args) {
  const dir = path.join(__dirname, 'suites');
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .sort();
  for (const f of files) {
    const name = f.replace(/\.js$/, '');
    /* файлы без суффикса .test — общие помощники, они нужны любому фильтру */
    if (args.suites.length && /\.test\.js$/.test(f) && !args.suites.some(s => name.indexOf(s) >= 0))
      continue;
    page.loadScriptFile(path.join(dir, f), 'tests/suites/' + f);
  }
  page.loadScriptFile(path.join(__dirname, 'sim.js'), 'tests/sim.js');
}

main().then(
  code => {
    process.exitCode = code;
  },
  err => {
    process.stderr.write('сбой прогона тестов: ' + ((err && err.stack) || err) + '\n');
    process.exitCode = 2;
  }
);

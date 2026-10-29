#!/usr/bin/env python3
"""Сборка NADZIRATEL в один HTML-файл.

Двойной клик (или `python3 builder/run.py`): читает версию из исходников,
собирает «NADZIRATEL vX.Y.Z.W (release).html» в одну строку без пробелов,
комментариев и осмысленных имён, затем сверяет отпечаток поведения сборки
с отпечатком исходников. Успех — в консоль печатается OK; провал — рядом
с HTML появляется *.build.log с подробностями.

Вся сборка — этот единственный файл: JS-часть (склейка, минификация,
укорачивание имён) встроена строкой BUNDLE_JS и исполняется Node'ом;
сторонние библиотеки (terser, acorn) лежат рядом в vendor/.

Флаги:
  --ci        не паузить в конце (для CI)
  --out DIR   каталог для готового HTML (по умолчанию папка builder)
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


NODE_HINT = ("Node.js не найден. Установите Node.js LTS (https://nodejs.org, "
             "или: winget install OpenJS.NodeJS.LTS) и запустите снова. "
             "Node нужен сборщику (минификация имён через terser) и самопроверке "
             "(headless-запуск игры); npm и интернет для сборки не требуются.")


VENDOR_FILES = ("terser.bundle.min.js", "acorn.js")

VENDOR_HINT = ("В builder/vendor/ должны лежать " + ", ".join(VENDOR_FILES) +
               " и LICENSES.txt — чужие библиотеки одним файлом каждая. "
               "Скопируйте папку vendor/ из репозитория целиком: npm и интернет "
               "для сборки не нужны, доустанавливать ничего не требуется.")


# JS-СБОРЩИК: исполняется Node'ом, извлекается во временную папку при запуске
BUNDLE_JS = r'''
'use strict';
/* Сборщик NADZIRATEL: index.html + css + все js → один HTML в одну строку.
   Имена верхнего уровня укорачиваются terser'ом; карта orig→mangled пишется
   рядом для автотестов (--map). Содержимое строковых литералов и шаблонов не
   меняется (в шаблонах сырые переводы строк заменяются на эквивалентный \n). */
const fs = require('fs');
const path = require('path');
/* пути передаёт run.py: этот скрипт живёт во временной папке */
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const V = arg('vendor', path.join(__dirname, 'vendor'));
const acorn = require(path.join(V, 'acorn.js'));
/* terser «голым» require тянет acorn и @jridgewell/source-map (второй ему нужен
   только для source map, которых мы не делаем) — отдаём своё, чтобы сборка не
   зависела от чужой раскладки пакетов и поиска в node_modules. */
function noSourceMap() {
  throw new Error('сборка NADZIRATEL не делает source map (terser: sourceMap: false)');
}
const Module = require('module');
const load = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'acorn') return acorn;
  if (req === '@jridgewell/source-map') {
    return { SourceMapGenerator: noSourceMap, SourceMapConsumer: noSourceMap };
  }
  return load.call(this, req, parent, isMain);
};
const { minify } = require(path.join(V, 'terser.bundle.min.js'));

const ROOT = path.resolve(arg('root', process.cwd()));

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
    const v = node[k];
    if (Array.isArray(v)) {
      for (const c of v) walk(c, fn);
    } else if (v && typeof v.type === 'string') walk(v, fn);
  }
}

function topLevelNames(ast) {
  const names = [];
  const add = p => {
    if (!p) return;
    if (p.type === 'Identifier') names.push(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach(pr => add(pr.value || pr.argument));
    else if (p.type === 'ArrayPattern') p.elements.forEach(add);
    else if (p.type === 'AssignmentPattern') add(p.left);
    else if (p.type === 'RestElement') add(p.argument);
  };
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') {
      if (n.id) names.push(n.id.name);
    } else if (n.type === 'VariableDeclaration') n.declarations.forEach(d => add(d.id));
  }
  return [...new Set(names)];
}

/* WGSL: комментарии и повторы пробелов видеокарта игнорирует, поэтому из
   шейдерных шаблонов они вырезаются — значение строки меняется только в
   оформлении. Автотесты сравнивают шейдеры той же нормализацией (wgslNorm в
   tests/harness/hash.js). Шаблон не трогается вовсе, если комментарий
   пересекает подстановку ${…} или строчный комментарий обрывается без
   перевода строки (тогда внутрь комментария попадает подстановка). */
const WGSL_MARK =
  /@group\(|@vertex|@fragment|@compute|@binding\(|var<|workgroup|vec[234]<f32>|:u32|:f32/;

/* «Чистое» выражение: его значение можно выбросить вместе с комментарием,
   внутри которого оно оказалось, — побочных эффектов нет. */
function wgslPure(n) {
  if (!n) return false;
  switch (n.type) {
    case 'Identifier':
    case 'Literal':
      return true;
    case 'TemplateLiteral':
      return n.expressions.every(wgslPure);
    case 'MemberExpression':
      return wgslPure(n.object) && (!n.computed || wgslPure(n.property));
    case 'BinaryExpression':
    case 'LogicalExpression':
      return wgslPure(n.left) && wgslPure(n.right);
    case 'UnaryExpression':
      return n.operator !== 'delete' && wgslPure(n.argument);
    case 'ConditionalExpression':
      return wgslPure(n.test) && wgslPure(n.consequent) && wgslPure(n.alternate);
    default:
      return false;
  }
}

/* Фрагмент с экранированиями («\n» двумя знаками и т.п.): вырезаются только
   блочные комментарии, которые целиком закрыты в этом же фрагменте, не содержат
   «\» и не пересекают строчных комментариев. Пробелы не сжимаются — иначе
   «\» в конце строки склеился бы со следующим знаком. Null — нельзя трогать. */
function wgslStripEscaped(raw) {
  if (raw.indexOf('//') >= 0) return null;
  let out = '',
    i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '\\') {
      out += raw.substr(i, 2);
      i += 2;
      continue;
    }
    if (c === '/' && raw[i + 1] === '*') {
      const e = raw.indexOf('*/', i + 2);
      if (e < 0) return null;
      if (raw.slice(i + 2, e).indexOf('\\') >= 0) return null;
      out += ' ';
      i = e + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/* Один проход по всему шаблону: блочный комментарий умеет начинаться в одном
   фрагменте и закрываться в другом, а между ними стоит подстановка ${…} — она
   попадает внутрь комментария и тоже вырезается (только если выражение чистое).
   Пробелы сжимаются лишь там, где в фрагменте нет экранирований (raw совпадает
   со значением): иначе «\» в конце строки склеился бы со следующим знаком.
   Возвращает правки [начало, конец, замена] или null — шаблон трогать нельзя. */
function wgslStripTemplate(src, node) {
  const edits = [];
  const parts = [];
  let inBlock = false;
  node.quasis.forEach((q, i) => {
    parts.push({ quasi: q });
    if (i < node.expressions.length) parts.push({ expr: node.expressions[i] });
  });
  for (const p of parts) {
    if (p.expr) {
      if (!inBlock) continue;
      if (!wgslPure(p.expr)) return null;
      edits.push([p.expr.start, p.expr.end, "''"]);
      continue;
    }
    const raw = src.slice(p.quasi.start, p.quasi.end);
    const plain = raw === p.quasi.value.raw;
    if (!plain) {
      if (inBlock) return null;
      const t = wgslStripEscaped(raw);
      if (t === null) return null;
      if (t !== raw) edits.push([p.quasi.start, p.quasi.end, t]);
      continue;
    }
    let out = '',
      i = 0;
    while (i < raw.length) {
      if (inBlock) {
        const e = raw.indexOf('*/', i);
        if (e < 0) {
          i = raw.length;
          break;
        }
        inBlock = false;
        i = e + 2;
        continue;
      }
      const b = raw.indexOf('/*', i);
      const l = raw.indexOf('//', i);
      const nx = b >= 0 && (l < 0 || b < l) ? b : l;
      if (nx < 0) {
        out += raw.slice(i);
        break;
      }
      out += raw.slice(i, nx);
      if (b === nx) {
        inBlock = true;
        out += ' ';
        i = nx + 2;
        continue;
      }
      /* строчный комментарий обязан закрыться переводом строки в этом же
         фрагменте — иначе внутрь него попадает подстановка ${…} */
      const nl = raw.indexOf('\n', nx);
      if (nl < 0) return null;
      out += ' ';
      i = nl;
    }
    out = out.replace(/\s+/g, ' ');
    if (out !== raw) edits.push([p.quasi.start, p.quasi.end, out]);
  }
  return inBlock ? null : edits; /* незакрытый комментарий — не трогаем */
}

function stripWgsl(src) {
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 2022 });
  } catch (e) {
    return { src: src, saved: 0 };
  }
  const edits = [];
  const seen = new Set();
  /* Шаблоны внутри подстановок шейдерного шаблона — тоже кусочки шейдера, хотя
     сами по себе WGSL-маркер могут не содержать (${L>=5?`…`:''}). Признак
     наследуется вниз, чужие шаблоны (не из шейдера) не трогаются вовсе. */
  function inner(node, fn) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'TemplateLiteral') {
      fn(node);
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      const v = node[k];
      if (Array.isArray(v)) {
        for (const c of v) inner(c, fn);
      } else inner(v, fn);
    }
  }
  function visit(tl, inherited) {
    if (seen.has(tl)) return;
    seen.add(tl);
    if (!inherited && !WGSL_MARK.test(tl.quasis.map(q => q.value.raw).join('${}'))) return;
    const t = wgslStripTemplate(src, tl);
    if (t) {
      for (const e of t) edits.push(e);
    } else {
      /* запасной проход: шаблон целиком очистить не удалось — чистим хотя бы те
         фрагменты, где комментарии не пересекают подстановок и экранирований */
      for (const q of tl.quasis) {
        const raw = src.slice(q.start, q.end);
        if (raw !== q.value.raw || !wgslSafe(raw)) continue;
        const c = wgslClean(raw);
        if (c !== raw) edits.push([q.start, q.end, c]);
      }
    }
    for (const ex of tl.expressions) inner(ex, x => visit(x, true));
  }
  walk(ast, n => {
    if (n.type === 'TemplateLiteral') visit(n, false);
  });
  /* вложенные шаблоны: правка внешнего перекрывает правки внутреннего */
  const sorted = edits.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  const final = [];
  let last = -1;
  for (const e of sorted) {
    if (e[0] >= last) {
      final.push(e);
      last = e[1];
    }
  }
  let out = src,
    saved = 0;
  for (const [a, b, t] of final.reverse()) {
    saved += b - a - t.length;
    out = out.slice(0, a) + t + out.slice(b);
  }
  if (final.length) {
    try {
      acorn.parse(out, { ecmaVersion: 2022 });
    } catch (e) {
      return { src: src, saved: 0 };
    }
  }
  return { src: out, saved: saved };
}

/* Встроенные объекты браузера переименовать нельзя, но можно один раз присвоить
   короткой переменной — её terser сократит. Делаем это только если имя нигде не
   связывается заново, а в коде нет eval/with/Function: иначе ссылка могла бы
   означать не встроенный объект. Свойства и ключи объектов не трогаются. */
const GLOBALS = [
  'Math',
  'JSON',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Float32Array',
  'Float64Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Uint16Array',
  'Uint32Array',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'BigInt64Array',
  'BigUint64Array',
  'BigInt'
];

function aliasGlobals(code) {
  const none = { code: code, n: 0, names: [] };
  if (/(^|[^\w$.])(eval|with|Function)\s*\(/.test(code)) return none;
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 2022 });
  } catch (e) {
    return none;
  }
  const bound = new Set(),
    notRef = new Set();
  const bind = p =>
    walk(p, x => {
      if (x.type === 'Identifier') bound.add(x.name);
    });
  walk(ast, n => {
    if (n.type === 'VariableDeclarator') bind(n.id);
    else if (
      n.type === 'FunctionDeclaration' ||
      n.type === 'FunctionExpression' ||
      n.type === 'ArrowFunctionExpression' ||
      n.type === 'ClassDeclaration' ||
      n.type === 'ClassExpression'
    ) {
      if (n.id && n.id.type === 'Identifier') bound.add(n.id.name);
      (n.params || []).forEach(bind);
    } else if (n.type === 'CatchClause' && n.param) bind(n.param);
    else if (n.type === 'MemberExpression' && !n.computed) notRef.add(n.property);
    else if (
      (n.type === 'Property' || n.type === 'MethodDefinition' || n.type === 'PropertyDefinition') &&
      !n.computed &&
      n.key.type === 'Identifier'
    ) {
      notRef.add(n.key);
      if (n.value) notRef.add(n.value);
    } else if (
      (n.type === 'LabeledStatement' ||
        n.type === 'BreakStatement' ||
        n.type === 'ContinueStatement') &&
      n.label
    )
      notRef.add(n.label);
  });
  const uses = {};
  walk(ast, n => {
    if (n.type !== 'Identifier' || notRef.has(n) || bound.has(n.name)) return;
    if (GLOBALS.indexOf(n.name) < 0) return;
    (uses[n.name] = uses[n.name] || []).push(n);
  });
  const picks = Object.keys(uses)
    .map(k => [k, uses[k]])
    .filter(([k, v]) => k.length > 2 && (k.length - 1) * v.length >= 60)
    .sort((a, b) => (b[0].length - 1) * b[1].length - (a[0].length - 1) * a[1].length);
  if (!picks.length) return none;
  const edits = [],
    decl = [];
  picks.forEach(([k, v], i) => {
    const a = '__G' + i + '__';
    decl.push(a + '=' + k);
    for (const nd of v) edits.push([nd.start, nd.end, a]);
  });
  let out = code;
  for (const [a, b, t] of edits.sort((x, y) => y[0] - x[0]))
    out = out.slice(0, a) + t + out.slice(b);
  return {
    code: 'const ' + decl.join(',') + ';\n' + out,
    n: picks.length,
    names: picks.map(p => p[0])
  };
}

/* const → let: область видимости и временная мёртвая зона те же, короче на два
   байта. Разница видна только коду, который рассчитывает на ошибку присваивания
   константе — такого в игре нет, а отпечаток поведения это перепроверяет. */
function constToLet(code) {
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 2022 });
  } catch (e) {
    return { code: code, n: 0 };
  }
  const edits = [];
  walk(ast, n => {
    if (n.type === 'VariableDeclaration' && n.kind === 'const') edits.push(n.start);
  });
  let out = code;
  for (const a of edits.sort((x, y) => y - x)) out = out.slice(0, a) + 'let' + out.slice(a + 5);
  return { code: out, n: edits.length };
}

function minCss(css) {
  /* строк с числами и url() в стилях игры нет — простая свёртка безопасна */
  return (
    css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([{}:;,])\s*/g, '$1')
      .replace(/;}/g, '}')
      .replace(/\s*!important/g, '!important')
      /* ведущий ноль у дроби лишний: «0.5» → «.5» (число от этого не меняется) */
      .replace(/(^|[\s(:,])0+(\.\d)/g, '$1$2')
      .trim()
  );
}

/* Пустые элементы HTML: у них «/>» и «>» означают одно и то же. */
const VOID_EL = /^<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)[\s/>]/i;

/* разметка: комментарии долой, пробельные текстовые узлы долой, Runs → один
   пробел; внутри тегов значения атрибутов не трогаются (их хэширует отпечаток) */
function minHtml(doc) {
  function text(t) {
    if (!t) return '';
    const c = t.replace(/\s+/g, ' ');
    return c === ' ' ? '' : c;
  }
  function tag(g) {
    let out = '',
      q = null;
    for (let i = 0; i < g.length; i++) {
      const ch = g[i];
      if (q) {
        out += ch;
        if (ch === q) q = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        q = ch;
        out += ch;
        continue;
      }
      if (/\s/.test(ch)) {
        let j = i;
        while (j < g.length && /\s/.test(g[j])) j++;
        if (j >= g.length - 1) {
          out += '';
        } /* пробелы перед '>' */
        else if (g[j] === '/' && j === g.length - 2) {
          out += '';
        } else {
          out += ' ';
        }
        i = j - 1;
        continue;
      }
      out += ch;
    }
    return out;
  }
  let out = '',
    i = 0;
  const n = doc.length;
  while (i < n) {
    const lt = doc.indexOf('<', i);
    if (lt < 0) {
      out += text(doc.slice(i));
      break;
    }
    out += text(doc.slice(i, lt));
    if (doc.startsWith('<!--', lt)) {
      const e = doc.indexOf('-->', lt);
      i = e < 0 ? n : e + 3;
      continue;
    }
    let j = lt + 1,
      q = null;
    while (j < n) {
      const c = doc[j];
      if (q) {
        if (c === q) q = null;
      } else if (c === '"' || c === "'") q = c;
      else if (c === '>') break;
      j++;
    }
    let piece = tag(doc.slice(lt, j + 1));
    /* у пустых элементов «/>» равносильно «>» — косая черта в релизе лишняя;
       список намеренно узкий: в SVG «/>» закрывает элемент и убирать его нельзя */
    if (VOID_EL.test(piece) && piece.slice(-2) === '/>') piece = piece.slice(0, -2) + '>';
    out += piece;
    i = j + 1;
  }
  return out;
}

async function main() {
  const outPath = arg('out');
  const mapPath = arg('map');
  if (!outPath) throw new Error('нужен --out <файл.html>');

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  /* 1. ассеты из разметки */
  const scripts = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/gi))
    scripts.push({ tag: m[0], file: m[1] });
  const links = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/gi)];
  if (!scripts.length) throw new Error('в index.html нет скриптов');
  if (links.length !== 1)
    throw new Error('ожидался один <link rel=stylesheet>, найдено ' + links.length);
  const cssHref = links[0][0].match(/href="([^"]+)"/)[1];

/* Дырка в сборке: файл, который лежит в папках подключаемого кода, но сам не
     подключён, молча не попал бы в релиз. Папки берутся из путей ассетов, так
     что проверка переживёт перенос и переименование каталогов. */
const used = new Set([...scripts.map(s => s.file), cssHref].map(f => f.split(path.sep).join('/')));
const roots = [
  ...new Set([...used].map(f => f.split('/')[0]).filter(r => !/\.(js|css)$/i.test(r)))
];
const orphan = [];
for (const r of roots) {
  const scan = dir => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const p = dir + '/' + e.name;
      if (e.isDirectory()) scan(p);
      else if (/\.(js|css)$/i.test(e.name) && !used.has(p)) orphan.push(p);
    }
  };
  scan(r);
}
if (orphan.length)
  throw new Error('не подключены к index.html (в релиз не попадут): ' + orphan.join(', '));

  /* 2. WGSL без комментариев → склейка JS → короткие алиасы встроенных объектов */
  const raws = scripts.map(s => fs.readFileSync(path.join(ROOT, s.file), 'utf8'));
  let wgslSaved = 0;
  const codes = raws.map(r => {
    const x = stripWgsl(r);
    wgslSaved += x.saved;
    return x.src;
  });
  const joinedRaw = codes.join('\n;\n');
  const names = topLevelNames(acorn.parse(joinedRaw, { ecmaVersion: 2022 }));
  const al = aliasGlobals(joinedRaw);
  const joined = al.code;

  /* 3. трейлер-проявитель имён: после mangle значения покажут новые имена */
  const trailer = '\n;globalThis.__NADZ_ALIAS__={' + names.map(n => n + ':' + n).join(',') + '};';
  /* Карта алиасов возвращает исходные имена в globalThis; новое короткое имя не
     должно совпасть ни с исходным (иначе prelude затрёт связывание), ни с
     неделимым свойством window. Первые две проблемы решаются итерациями. */
  const DANGER = [
    'name',
    'top',
    'self',
    'parent',
    'window',
    'document',
    'location',
    'frames',
    'closed',
    'opener',
    'status',
    'origin',
    'event',
    'length',
    'navigator',
    'history',
    'screen',
    'localStorage',
    'sessionStorage',
    'performance',
    'console',
    'undefined',
    'NaN',
    'Infinity',
    'globalThis',
    'eval',
    'arguments',
    'this'
  ];
  let reserved = DANGER.slice(),
    code = null,
    map = null,
    passes = 0;
  for (; passes < 8; passes++) {
    const res = await minify(joined + trailer, {
      ecma: 2020,
      /* compress без unsafe-флагов и без toplevel: допущений о встроенных
         объектах не делаем, верхнеуровневые имена игры не выбрасываем */
      compress: { ecma: 2020, passes: 2 },
      mangle: { toplevel: true, reserved: reserved },
      format: { comments: false, ecma: 2020 },
      sourceMap: false
    });
    if (res.error) throw res.error;
    code = res.code;
    /* Карта имён из трейлера + его вырезание. Трейлер всегда последний, но
       compress склеивает операторы запятыми, поэтому ищем само присваивание,
       а не отдельный оператор, и заодно съедаем ведущую запятую. */
    const oast = acorn.parse(code, { ecmaVersion: 2022 });
    let alias = null;
    walk(oast, n => {
      if (
        n.type === 'AssignmentExpression' &&
        n.left.type === 'MemberExpression' &&
        !n.left.computed &&
        n.left.object.type === 'Identifier' &&
        n.left.object.name === 'globalThis' &&
        n.left.property.name === '__NADZ_ALIAS__'
      )
        alias = n;
    });
    if (!alias || alias.right.type !== 'ObjectExpression')
      throw new Error('трейлер имён не найден в выводе terser');
    map = {};
    for (const p of alias.right.properties) {
      const k = p.key.name || p.key.value;
      /* compress подставляет значения констант прямо в трейлер — тогда в карту
         попадает не имя, а исходный текст значения (валидное выражение) */
      map[k] =
        p.value.type === 'Identifier' ? p.value.name : code.slice(p.value.start, p.value.end);
    }
    const cut = code[alias.start - 1] === ',' ? alias.start - 1 : alias.start;
    code = (code.slice(0, cut) + code.slice(alias.end)).replace(/^[;\s]+|[;\s]+$/g, '');
    if (code.indexOf('__NADZ_ALIAS__') >= 0) throw new Error('трейлер имён вырезан не полностью');
    /* Коллизия: короткое имя после mangle совпало с исходным, которое тесты
       возвращают в контекст через globalThis, — такое связывание в сборке
       перекрыло бы доступ к настоящей переменной. Имя уходит в reserved, и
       проход повторяется. Сверяем по дереву вывода, а не по карте: compress
       подставляет константы прямо в трейлер, и часть имён в карту не попадает. */
    const aliased = new Set(Object.keys(map).filter(k => map[k] !== k));
    const outNames = new Set();
    for (const n of oast.body) {
      if (n.type === 'VariableDeclaration') {
        for (const d of n.declarations)
          walk(d.id, x => {
            if (x.type === 'Identifier') outNames.add(x.name);
          });
      } else if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id)
        outNames.add(n.id.name);
    }
    const bad = [...outNames].filter(m => aliased.has(m));
    if (!bad.length) break;
    reserved = reserved.concat(bad);
  }
  if (passes >= 8) throw new Error('не удалось разрешить коллизии имён за 8 проходов');

  const cl = constToLet(code);
  code = cl.code;

  /* 5. переводы строк внутри шаблонов → \n (значение строк не меняется) */
  const tast = acorn.parse(code, { ecmaVersion: 2022 });
  const before = [];
  walk(tast, n => {
    if (n.type === 'TemplateElement') before.push(n.value.cooked);
  });
  const edits = [];
  walk(tast, n => {
    if (n.type === 'TemplateElement') {
      const raw = code.slice(n.start, n.end);
      if (raw.indexOf('\n') >= 0 || raw.indexOf('\r') >= 0)
        edits.push([n.start, n.end, raw.replace(/\r\n/g, '\\n').replace(/[\n\r]/g, '\\n')]);
    }
  });
  for (const [a, b, t] of edits.reverse()) code = code.slice(0, a) + t + code.slice(b);
  /* самопроверка: значения всех литералов совпадают */
  const uast = acorn.parse(code, { ecmaVersion: 2022 });
  const after = [];
  walk(uast, n => {
    if (n.type === 'TemplateElement') after.push(n.value.cooked);
  });
  if (before.length !== after.length || before.some((v, i) => v !== after[i]))
    throw new Error('содержимое шаблонов изменилось');

  if (code.indexOf('\n') >= 0) throw new Error('в коде остались переводы строк');
  if (/<\/script/i.test(code)) throw new Error('в коде встречается </script');

  /* 6. HTML: замена ассетов на инлайн, минификация разметки */
  const cssRaw = fs.readFileSync(path.join(ROOT, cssHref), 'utf8');
  const css = minCss(cssRaw);
  if (/<\/style/i.test(css)) throw new Error('в css встречается </style');
  let doc = html;
  if (doc.indexOf('@@SCRIPT@@') >= 0 || doc.indexOf('@@STYLE@@') >= 0)
    throw new Error('занятый маркер');
  doc = doc.replace(links[0][0], '@@STYLE@@');
  doc = doc.replace(scripts[0].tag, '@@SCRIPT@@');
  for (const s of scripts.slice(1)) doc = doc.replace(s.tag, '');
  /* плейсхолдеры вставляются после минификации разметки, иначе соседний пробел
     из вырезанных тегов остаётся в итоге; функция-заменитель нужна, чтобы «$&»
     внутри кода не раскрылся как ссылка на найденное совпадение */
  doc = minHtml(doc).replace(/\s*@@(STYLE|SCRIPT)@@\s*/g, '@@$1@@');
  doc = doc
    .replace('@@STYLE@@', () => '<style>' + css + '</style>')
    .replace('@@SCRIPT@@', () => '<script>' + code + '</script>');
  if (doc.indexOf('\n') >= 0) throw new Error('итог не в одну строку');

  fs.writeFileSync(outPath, doc, 'utf8');
  if (mapPath) fs.writeFileSync(mapPath, JSON.stringify(map), 'utf8');
  const inBytes = raws.reduce((a, c) => a + c.length, 0) + html.length + cssRaw.length;
  process.stdout.write(
    JSON.stringify({
      ok: true,
      out: outPath,
      bytes: Buffer.byteLength(doc),
      inBytes: inBytes,
      scripts: scripts.length,
      names: Object.keys(map).length,
      renamed: Object.keys(map).filter(k => map[k] !== k).length,
      wgsl: wgslSaved,
      globals: al.names,
      consts: cl.n
    }) + '\n'
  );
}

main().catch(e => {
  process.stderr.write('СБОРКА: ' + ((e && e.stack) || e) + '\n');
  process.exit(1);
});
'''

def find_node():
    node = shutil.which("node")
    if node:
        return node
    cands = []
    if os.name == "nt":
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        local = os.environ.get("LocalAppData", "")
        cands = [os.path.join(pf, "nodejs", "node.exe"),
                 os.path.join(pf86, "nodejs", "node.exe"),
                 os.path.join(local, "Programs", "nodejs", "node.exe")]
    else:
        cands = ["/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node"]
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def log_line(msg):
    print(msg, flush=True)


def fail(out_html, steps):
    """Пишет подробный лог рядом с HTML и закрывает консоль кодом 1."""
    log_path = re.sub(r"\.html$", "", out_html) + ".build.log"
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("СБОРКА NADZIRATEL ПРОВАЛЕНА\n")
        f.write("время: " + time.strftime("%Y-%m-%d %H:%M:%S") + "\n\n")
        for s in steps:
            f.write(s + "\n\n")
    log_line("")
    log_line("ПРОВАЛ. Подробности: " + log_path)
    sys.exit(1)


def run_node(args, steps, what):
    cmd = [NODE] + args
    steps.append("$ " + " ".join(cmd))
    try:
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=3600)
    except FileNotFoundError:
        steps.append("node не найден")
        return None
    except subprocess.TimeoutExpired:
        steps.append("таймаут: " + what)
        return None
    steps.append("--- " + what + " (код " + str(r.returncode) + ") ---")
    if r.stdout:
        steps.append(r.stdout)
    if r.stderr:
        steps.append("stderr:\n" + r.stderr)
    if r.returncode != 0:
        return None
    return r.stdout


def fingerprint(args, steps, what):
    out = run_node(["tests/run.js", "--fingerprint"] + args, steps, what)
    if out is None:
        return None
    try:
        return json.loads(out)
    except ValueError:
        steps.append("не удалось разобрать JSON отпечатка")
        return None


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ci = "--ci" in sys.argv
    out_dir = HERE
    if "--out" in sys.argv:
        out_dir = os.path.abspath(sys.argv[sys.argv.index("--out") + 1])

    global NODE
    NODE = find_node()
    steps = []

    # 1. версия из исходников → имя файла
    ver_path = os.path.join(ROOT, "js", "core", "version.js")
    try:
        with open(ver_path, encoding="utf-8") as f:
            m = re.search(r"GAME_VER\s*=\s*'([^']+)'", f.read())
    except OSError as e:
        m, steps = None, steps + ["не читается version.js: %s" % e]
    if not m:
        fail(os.path.join(out_dir, "NADZIRATEL (release).html"),
             steps + ["в js/core/version.js не найден GAME_VER"])
    nums = re.findall(r"\d+", m.group(1))
    if not nums:
        fail(os.path.join(out_dir, "NADZIRATEL (release).html"),
             steps + ["в GAME_VER нет чисел: " + m.group(1)])
    version = ".".join(nums)
    out_html = os.path.join(out_dir, "NADZIRATEL v%s (release).html" % version)
    alias_map = os.path.join(tempfile.gettempdir(), "nadziratel_alias_map.json")

    if not NODE:
        fail(out_html, steps + [NODE_HINT])
    missing = [n for n in VENDOR_FILES
               if not os.path.isfile(os.path.join(HERE, "vendor", n))]
    if missing:
        fail(out_html, steps + ["в builder/vendor/ не найдено: " + ", ".join(missing),
                                VENDOR_HINT])
    log_line("[1/4] версия: v" + version)

    # 2. сборка (JS-часть живёт строкой в этом файле и раскладывается во tmp)
    tmp = tempfile.mkdtemp(prefix="nadziratel_build_")
    try:
        bp = os.path.join(tmp, "bundle.js")
        with open(bp, "w", encoding="utf-8") as f:
            f.write(BUNDLE_JS)
        out = run_node([bp, "--out", out_html, "--map", alias_map,
                        "--root", ROOT, "--vendor", os.path.join(HERE, "vendor")],
                       steps, "сборка")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if out is None:
        fail(out_html, steps)
    try:
        stats = json.loads(out.strip().splitlines()[-1])
    except ValueError:
        stats = {}
    log_line("[2/4] собрано: %s (%s байт из %s, имён сокращено %s/%s)" % (
        os.path.basename(out_html), stats.get("bytes", "?"), stats.get("inBytes", "?"),
        stats.get("renamed", "?"), stats.get("names", "?")))
    log_line("       сверх того: WGSL без комментариев −%s байт, const→let %s, "
             "встроенных объектов спрятано за алиасы %s%s" % (
                 stats.get("wgsl", "?"), stats.get("consts", "?"),
                 len(stats.get("globals", [])),
                 " (" + ", ".join(stats.get("globals", [])) + ")" if stats.get("globals") else ""))

    # 3. отпечаток исходников
    log_line("[3/4] отпечаток исходников (около минуты)…")
    fp_src = fingerprint([], steps, "отпечаток исходников")
    if fp_src is None:
        fail(out_html, steps)

    # 4. отпечаток сборки и сравнение по секциям
    log_line("[4/4] отпечаток сборки…")
    fp_bun = fingerprint(["--bundle", out_html, "--alias-map", alias_map],
                         steps, "отпечаток сборки")
    if fp_bun is None:
        fail(out_html, steps)

    sec_s, sec_b = fp_src.get("sections", {}), fp_bun.get("sections", {})
    diffs = []
    for k in sorted(set(sec_s) | set(sec_b)):
        if sec_s.get(k) != sec_b.get(k):
            diffs.append("секция %s: исходники %s != сборка %s" % (k, sec_s.get(k), sec_b.get(k)))
    for side, fp in (("исходники", fp_src), ("сборка", fp_bun)):
        for k, v in (fp.get("notes") or {}).items():
            diffs.append("заметка (%s) %s: %s" % (side, k, v))
    steps.append("СРАВНЕНИЕ СЕКЦИЙ\n" + ("\n".join(diffs) if diffs else "секции совпадают"))
    steps.append("отпечаток исходников: " + json.dumps(fp_src, ensure_ascii=False, indent=1))
    steps.append("отпечаток сборки:    " + json.dumps(fp_bun, ensure_ascii=False, indent=1))

    if diffs:
        fail(out_html, steps)

    # лог прошлой неудачи рядом с удачным HTML только путает
    stale = re.sub(r"\.html$", "", out_html) + ".build.log"
    if os.path.isfile(stale):
        os.remove(stale)

    size = os.path.getsize(out_html)
    log_line("")
    log_line("OK")
    log_line("NADZIRATEL v%s (release).html — %d байт, "
             "поведение идентично исходникам" % (version, size))
    if not ci and sys.stdin and sys.stdin.isatty():
        try:
            input("Нажмите Enter, чтобы закрыть…")
        except EOFError:
            pass


if __name__ == "__main__":
    NODE = None
    main()

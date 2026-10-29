'use strict';
/* Сверка отпечатка с эталоном: node tests/check_fingerprint.js <факт.json> [эталон.json] */
const fs = require('fs');
const path = require('path');
const fact = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const base = JSON.parse(
  fs.readFileSync(process.argv[3] || path.join(__dirname, 'baseline.json'), 'utf8')
);
let bad = 0;
const a = fact.sections || {},
  b = base.sections || {};
for (const k of Object.keys(b)) {
  if (a[k] !== b[k]) {
    console.error('секция ' + k + ': ' + b[k] + ' -> ' + (a[k] === undefined ? '(нет)' : a[k]));
    bad++;
  }
}
for (const k of Object.keys(a)) {
  if (!(k in b)) {
    console.error('появилась секция ' + k + ': ' + a[k]);
    bad++;
  }
}
if (fact.total !== base.total) {
  console.error('total: ' + base.total + ' -> ' + fact.total);
  bad++;
}
const notes = Object.keys(fact.notes || {});
if (notes.length) {
  console.error('заметки в отпечатке: ' + notes.join(', '));
  bad++;
}
if (bad) {
  console.error('ОТПЕЧАТОК НЕ СОВПАДАЕТ С ЭТАЛОНОМ (расхождений: ' + bad + ')');
  process.exit(1);
}
console.log('отпечаток совпадает с эталоном: ' + fact.total);

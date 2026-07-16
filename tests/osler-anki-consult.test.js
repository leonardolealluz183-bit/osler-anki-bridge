const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.window = globalThis;
const publishedPath = path.join(__dirname, '../docs/osler-anki-consult.user.js');
const source = fs.readFileSync(publishedPath, 'utf8');
const exporter = require(publishedPath);

test('targets Consulta and loads before SPA navigation', () => {
  assert.match(source, /@name\s+Osler Anki Exporter — Consulta/);
  assert.match(source, /@version\s+1\.2\.1/);
  assert.match(source, /@match\s+https:\/\/oslermedicina\.com\.br\/\*/);
  assert.match(source, /@run-at\s+document-start/);
  assert.match(source, /pushState/);
  assert.match(source, /MutationObserver/);
  assert.doesNotMatch(source, /@require/);
});

test('recognizes the orange answer color', () => {
  assert.equal(exporter.orange([255, 93, 34]), true);
  assert.equal(exporter.orange('rgb(239, 108, 38)'), true);
  assert.equal(exporter.orange([50, 120, 220]), false);
  assert.deepEqual(exporter.parseColor('#ff5d22'), [255, 93, 34]);
});

test('normalizes the deck and exports one TSV row per card', () => {
  assert.equal(exporter.normalizeDeckName('Preventiva::SUS'), 'Preventiva — SUS');
  const cards = [
    { id: '1', type: 'cloze', topic: 'SUS', frontHtml: '<p>[...]</p>', backHtml: 'A', contextHtml: '', explanationHtml: '' },
    { id: '2', type: 'qa', topic: 'SUS', frontHtml: '<p>Q?</p>', backHtml: 'R', contextHtml: '', explanationHtml: '' },
  ];
  const tsv = exporter.buildTsv(cards, 'Princípios do SUS');
  assert.equal((tsv.match(/\t"Princípios do SUS"/g) || []).length, 2);
  assert.match(tsv, /tipo_cloze/);
  assert.match(tsv, /tipo_qa/);
});

test('contains two independent card-discovery strategies and count validation', () => {
  assert.match(source, /function menus\(/);
  assert.match(source, /function frame\(/);
  assert.match(source, /mostrando\\s\+\(\\d\+\)/);
  assert.match(source, /Exportação bloqueada/);
  assert.match(source, /cards\.length===c\.shown/);
});

test('never disables the whole panel and keeps diagnostic recovery available', () => {
  assert.doesNotMatch(source, /querySelectorAll\(['"]button['"]\)\.forEach\([^\n]+disabled=true/);
  assert.match(source, /function enableControls\(/);
  assert.match(source, /data-action="copylog"/);
  assert.match(source, /Copiar diagnóstico/);
});

test('stable hashes distinguish different cards', () => {
  assert.equal(exporter.hash('mesmo'), exporter.hash('mesmo'));
  assert.notEqual(exporter.hash('um'), exporter.hash('dois'));
});

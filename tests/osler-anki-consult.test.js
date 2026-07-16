const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publishedPath = path.join(__dirname, '../docs/osler-anki-consult.user.js');
const source = fs.readFileSync(publishedPath, 'utf8');
const exporter = require(publishedPath);

test('targets the real Consulta mode and loads before SPA navigation', () => {
  assert.match(source, /@name\s+Osler Anki Exporter — Consulta/);
  assert.match(source, /@version\s+1\.1\.0/);
  assert.match(source, /@match\s+https:\/\/oslermedicina\.com\.br\/\*/);
  assert.match(source, /@run-at\s+document-start/);
  assert.match(source, /@grant\s+unsafeWindow/);
  assert.doesNotMatch(source, /Ver todos/);
  assert.doesNotMatch(source, /@require/);
});

test('detects Consulta routes without reloading the page', () => {
  assert.equal(exporter.consultPath('/consult'), true);
  assert.equal(exporter.consultPath('/consulta'), true);
  assert.equal(exporter.consultPath('/flashcards'), false);
  assert.match(source, /pushState/);
  assert.match(source, /replaceState/);
  assert.match(source, /MutationObserver/);
});

test('recognizes the orange answer color shown in Consulta', () => {
  assert.equal(exporter.orange([255, 93, 34]), true);
  assert.equal(exporter.orange([239, 108, 38]), true);
  assert.equal(exporter.orange([50, 120, 220]), false);
  assert.deepEqual(exporter.rgb('#ff5d22'), [255, 93, 34]);
});

test('expands one grouped source with three lacunas into three unique cards', () => {
  const variants = exporter.clozeSpecs(
    'Princípios do SUS',
    'São princípios organizacionais: descentralização e regionalização.',
    ['organizacionais', 'descentralização', 'regionalização'],
  );
  assert.equal(variants.length, 3);
  assert.equal(new Set(variants.map((item) => item.id)).size, 3);
});

test('exports one TSV row per generated card into one explicit deck', () => {
  const cards = [
    { id: '1', type: 'cloze', topic: 'SUS', frontHtml: '<p>[...]</p>', backHtml: 'A', contextHtml: '', explanationHtml: '' },
    { id: '2', type: 'qa', topic: 'SUS', frontHtml: '<p>Q?</p>', backHtml: 'R', contextHtml: '', explanationHtml: '' },
  ];
  const tsv = exporter.buildTsv(cards, 'Princípios do SUS');
  assert.equal((tsv.match(/\t"Princípios do SUS"/g) || []).length, 2);
  assert.match(tsv, /tipo_cloze/);
  assert.match(tsv, /tipo_qa/);
});

test('neutralizes unintended Anki deck hierarchy separators', () => {
  assert.equal(exporter.deckName('Preventiva::SUS'), 'Preventiva — SUS');
});

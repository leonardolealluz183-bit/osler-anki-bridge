const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.window = globalThis;
const exporter = require('../docs/osler-anki-consult.user.js');

function card(id, topic, frontText, backText) {
  return {
    id,
    topic,
    frontText,
    frontHtml: `<p>${frontText}</p>`,
    backText,
    backHtml: backText,
    explanationHtml: '',
  };
}

test('loads on the whole Osler site and activates only on the consult route', () => {
  const published = fs.readFileSync(path.join(__dirname, '../docs/osler-anki-consult.user.js'), 'utf8');
  assert.match(published, /@version\s+1\.0\.1/);
  assert.match(published, /@match\s+https:\/\/oslermedicina\.com\.br\/\*/);
  assert.match(published, /@run-at\s+document-start/);
  assert.match(published, /function onConsultRoute\(\)/);
  assert.match(published, /hookHistory\('pushState'\)/);
  assert.match(published, /setInterval\(routeSync, 500\)/);
  assert.doesNotMatch(published, /@require/);
});

test('recognizes the orange tones used for revealed answers', () => {
  assert.equal(exporter.orangeColor('rgb(255, 93, 34)'), true);
  assert.equal(exporter.orangeColor('rgb(239, 108, 38)'), true);
  assert.equal(exporter.orangeColor('rgb(230, 120, 70)'), true);
  assert.equal(exporter.orangeColor('rgb(255, 255, 255)'), false);
  assert.equal(exporter.orangeColor('rgb(55, 120, 220)'), false);
});

test('uses one explicit deck for every exported card', () => {
  const tsv = exporter.buildTsv([
    card('a', 'Princípios do SUS', 'O modelo [...] é universal.', 'Beveridgiano'),
    card('b', 'Diretrizes do SUS', 'A [...] é uma diretriz.', 'Descentralização'),
  ], 'Princípios do SUS');
  assert.equal((tsv.match(/\t"Princípios do SUS"/g) || []).length, 2);
  assert.doesNotMatch(tsv, /\t"Diretrizes do SUS"\n/);
  assert.match(tsv, /assunto_principios_do_sus/);
  assert.match(tsv, /assunto_diretrizes_do_sus/);
});

test('produces stable ids for equal content and different ids for different content', () => {
  assert.equal(exporter.stableHash('mesmo'), exporter.stableHash('mesmo'));
  assert.notEqual(exporter.stableHash('um'), exporter.stableHash('dois'));
});

test('sanitizes deck hierarchy separators inside TSV output', () => {
  const tsv = exporter.buildTsv([
    card('a', 'SUS', 'Pergunta', 'Resposta'),
  ], 'Preventiva::SUS');
  assert.match(tsv, /\t"Preventiva — SUS"\n/);
});

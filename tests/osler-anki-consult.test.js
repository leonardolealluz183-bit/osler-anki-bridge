const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const exporter = require('../userscript/osler-anki-consult.user.js');

function card(id, topic, frontText, backText) {
  return {
    id,
    topic,
    frontText,
    frontHtml: `<p>${frontText}</p>`,
    backText,
    backHtml: backText,
    explanationHtml: '',
    warnings: [],
  };
}

test('is a single consult-only userscript without dependencies', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-consult.user.js'), 'utf8');
  const published = fs.readFileSync(path.join(__dirname, '../docs/osler-anki-consult.user.js'), 'utf8');
  assert.equal(source, published);
  assert.match(source, /@version\s+1\.0\.0/);
  assert.match(source, /@match\s+https:\/\/oslermedicina\.com\.br\/consult\*/);
  assert.doesNotMatch(source, /@require/);
  assert.doesNotMatch(source, /\/test\*/);
});

test('recognizes the orange tones used for revealed answers', () => {
  assert.equal(exporter.isOrangeRgb([255, 93, 34]), true);
  assert.equal(exporter.isOrangeRgb([239, 108, 38]), true);
  assert.equal(exporter.isOrangeRgb([230, 120, 70]), true);
  assert.equal(exporter.isOrangeRgb([255, 255, 255]), false);
  assert.equal(exporter.isOrangeRgb([55, 120, 220]), false);
});

test('parses rgb and hexadecimal CSS colors', () => {
  assert.deepEqual(exporter.parseCssColor('rgb(255, 93, 34)'), [255, 93, 34]);
  assert.deepEqual(exporter.parseCssColor('#ff5d22'), [255, 93, 34]);
  assert.deepEqual(exporter.parseCssColor('#f62'), [255, 102, 34]);
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

test('deduplicates cards by stable id without deleting different cards', () => {
  const first = card('same', 'SUS', 'A', 'B');
  const second = card('other', 'SUS', 'C', 'D');
  assert.deepEqual(exporter.dedupeCards([first, first, second]).map((item) => item.id), ['same', 'other']);
});

test('sanitizes deck hierarchy separators', () => {
  assert.equal(exporter.safeDeckName('Preventiva::SUS'), 'Preventiva — SUS');
});

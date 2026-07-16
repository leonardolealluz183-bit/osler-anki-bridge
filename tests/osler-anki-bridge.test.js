const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Node = { DOCUMENT_POSITION_FOLLOWING: 4 };
global.location = {
  pathname: '/test',
  href: 'https://oslermedicina.com.br/test',
  origin: 'https://oslermedicina.com.br',
};

const bridge = require('../userscript/osler-anki-bridge.user.js');
const noDom = { createElement() { return null; } };

function card(id, topic, question = 'Pergunta?', answer = 'Resposta') {
  return {
    id,
    question: { text: question, html: question },
    answer: { source: 'question-cloze', text: answer, html: answer },
    explanation: { text: '', html: '' },
    topic: { text: topic, html: topic },
    deck: { text: topic, html: topic },
    url: 'https://oslermedicina.com.br/test',
  };
}

test('is one monolithic v0.4.10 userscript with movable panel', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  const published = fs.readFileSync(path.join(__dirname, '../docs/osler-anki-bridge.user.js'), 'utf8');
  assert.equal(source, published);
  assert.match(source, /@version\s+0\.4\.10/);
  assert.doesNotMatch(source, /@require/);
  assert.match(source, /@grant\s+GM_download/);
  assert.match(source, /@grant\s+GM_setClipboard/);
  assert.match(source, /data-role="drag-handle"/);
  assert.match(source, /data-action="toggle-panel"/);
  assert.match(source, /minimized:\s*true/);
  assert.match(source, /PANEL_STATE_KEY/);
});

test('uses the card topic as the Anki deck', () => {
  assert.equal(bridge.deckNameForCard(card('1', 'Alergia Alimentar')), 'Alergia Alimentar');
  assert.equal(bridge.deckNameForCard(card('2', '')), 'Osler');
  assert.equal(bridge.deckNameForCard(card('3', 'Clínica::Cardiologia')), 'Clínica — Cardiologia');
});

test('merges redundant stores without duplicate card ids', () => {
  const first = card('a', 'A');
  const second = card('b', 'B');
  const merged = bridge.mergeCardArrays([first], [first, second], []);
  assert.deepEqual(merged.map((item) => item.id), ['a', 'b']);
});

test('TSV exports each topic in the deck column', () => {
  const tsv = bridge.buildTsvFromQueue([
    card('a', 'Angioedema'),
    card('b', 'Rastreio de GBS'),
  ], noDom);
  assert.match(tsv, /\t"Angioedema"\n/);
  assert.match(tsv, /\t"Rastreio de GBS"\n/);
  assert.doesNotMatch(tsv, /\t"Osler"\n/);
});

test('reports when the last failed card was captured later', () => {
  const summary = bridge.summarizeLastFailure([
    {
      at: '2026-07-16T00:00:00Z',
      status: 'failed',
      id: 'abc',
      question: 'Rastreio de GBS. Qual o método de escolha?',
      detail: 'resposta vazia',
    },
    {
      at: '2026-07-16T00:00:01Z',
      status: 'added',
      id: 'abc',
      question: 'Rastreio de GBS. Qual o método de escolha?',
    },
  ]);
  assert.equal(summary.exists, true);
  assert.equal(summary.recovered, true);
  assert.match(summary.text, /capturada depois/);
});

test('rejects a list before its hidden answer is revealed', () => {
  const result = bridge.validateCard({
    ...card('x', 'Tema', 'Pergunta', '[...], e Pilhas'),
    answer: {
      source: 'card-body',
      text: '[...], e Pilhas',
      html: '<ul><li>[...]</li><li>Pilhas</li></ul>',
    },
  });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes('resposta ainda não revelada'));
});

test('clamps panel coordinates inside the viewport when no DOM panel exists', () => {
  assert.deepEqual(bridge.clampPanelPosition(500, 500), { left: 12, top: 12 });
});

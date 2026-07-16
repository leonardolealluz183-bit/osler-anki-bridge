const test = require('node:test');
const assert = require('node:assert/strict');

const sessions = require('../userscript/osler-anki-sessions.user.js');

function card(id, topic, question = 'Pergunta?', answer = 'Resposta') {
  return {
    id,
    question: { text: question, html: question },
    answer: { text: answer, html: answer },
    explanation: { text: '', html: '' },
    topic: { text: topic, html: topic },
  };
}

test('normalizes a named export session', () => {
  const state = sessions.normalizeState({
    activeId: 's1',
    sessions: [{ id: 's1', name: ' Hipertensão Arterial Sistêmica ', startedAt: '2026-07-16T00:00:00Z' }],
  });
  assert.equal(state.activeId, 's1');
  assert.equal(state.sessions[0].name, 'Hipertensão Arterial Sistêmica');
});

test('exports only cards assigned to the session', () => {
  const queue = [card('old', 'Angioedema'), card('has1', 'MAPA'), card('has2', 'Crise Hipertensiva')];
  const session = { id: 's', name: 'Hipertensão Arterial Sistêmica', cardIds: ['has1', 'has2'] };
  assert.deepEqual(sessions.cardsForSession(queue, session).map((item) => item.id), ['has1', 'has2']);
});

test('uses one named deck and keeps topics as tags', () => {
  const session = { id: 's', name: 'Hipertensão Arterial Sistêmica', cardIds: ['has1', 'has2'] };
  const tsv = sessions.buildSessionTsv([
    card('has1', 'MAPA'),
    card('has2', 'Crise Hipertensiva'),
  ], session);
  assert.match(tsv, /\t"Hipertensão Arterial Sistêmica"\n/);
  assert.equal((tsv.match(/\t"Hipertensão Arterial Sistêmica"\n/g) || []).length, 2);
  assert.match(tsv, /assunto_mapa/);
  assert.match(tsv, /assunto_crise_hipertensiva/);
  assert.doesNotMatch(tsv, /\t"MAPA"\n/);
});

test('sanitizes Anki hierarchy separators in session deck names', () => {
  assert.equal(sessions.safeDeckName('Clínica::Hipertensão'), 'Clínica — Hipertensão');
});

test('merges queue stores without duplicate ids', () => {
  const merged = sessions.mergeQueues([card('a', 'A')], [card('a', 'A'), card('b', 'B')]);
  assert.deepEqual(merged.map((item) => item.id), ['a', 'b']);
});

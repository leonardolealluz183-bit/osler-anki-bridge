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

const bridge = require('../userscript/osler-anki-bridge-v050.user.js');
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

test('publishes one unified v0.5.0 userscript', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge-v050.user.js'), 'utf8');
  const published = fs.readFileSync(path.join(__dirname, '../docs/osler-anki-bridge-v050.user.js'), 'utf8');
  assert.equal(source, published);
  assert.match(source, /@version\s+0\.5\.0/);
  assert.doesNotMatch(source, /@require/);
  assert.match(source, /SESSION_KEY\s*=\s*'oslerAnkiBridge\.sessions\.v3'/);
  assert.match(source, /assignCardToActiveSession\(storedCard\.id\)/);
  assert.match(source, /data-action="start-session"/);
  assert.match(source, /data-action="prepare"/);
  assert.match(source, /data-role="drag-handle"/);
  assert.match(source, /OLD_SESSION_IDS/);
});

test('does not accept a bibliographic line whose bold text is not at the beginning as the question', () => {
  assert.equal(
    bridge.topicStartsParagraph(
      'Princípios do SUS. O princípio considera as pessoas como um todo.',
      'Princípios do SUS.',
    ),
    true,
  );
  assert.equal(
    bridge.topicStartsParagraph(
      'Princípios e Diretrizes do Sistema Único de Saúde, em Políticas de saúde.',
      'Políticas de saúde',
    ),
    false,
  );
});

test('merges redundant stores without duplicate card ids and rejects invalid cards', () => {
  const first = card('a', 'A');
  const second = card('b', 'B');
  const invalid = card('c', 'C', 'Pergunta', '');
  invalid.answer.html = '';
  const merged = bridge.mergeCardArrays([first, invalid], [first, second], []);
  assert.deepEqual(merged.map((item) => item.id), ['a', 'b']);
});

test('session TSV exports one deck and preserves original topics as tags', () => {
  const session = {
    id: 's1',
    name: 'Princípios do SUS',
    startedAt: '2026-07-16T06:00:00.000Z',
    endedAt: null,
    cardIds: ['a', 'b'],
  };
  const tsv = bridge.buildSessionTsv([
    card('a', 'Universalidade'),
    card('b', 'Equidade'),
  ], session, noDom);
  assert.match(tsv, /\t"Princípios do SUS"\n/);
  assert.equal((tsv.match(/\t"Princípios do SUS"\n/g) || []).length, 2);
  assert.match(tsv, /assunto_universalidade/);
  assert.match(tsv, /assunto_equidade/);
  assert.doesNotMatch(tsv, /\t"Universalidade"\n/);
});

test('sanitizes accidental Anki deck hierarchy', () => {
  assert.equal(bridge.safeDeckName('Clínica::Cardiologia'), 'Clínica — Cardiologia');
});

test('derives session cards from added and duplicate audit events only', () => {
  const ids = bridge.deriveIdsFromAudit([
    { at: '2026-07-16T07:00:01.000Z', status: 'added', id: 'a' },
    { at: '2026-07-16T07:00:02.000Z', status: 'duplicate', id: 'b' },
    { at: '2026-07-16T07:00:03.000Z', status: 'failed', id: 'c' },
    { at: '2026-07-16T07:00:04.000Z', status: 'duplicate', id: 'a' },
  ], '2026-07-16T07:00:00.000Z');
  assert.deepEqual(ids, ['a', 'b']);
});

test('repairs an accidental same-name restart by preserving the prior cards', () => {
  const state = bridge.mergeSessionStates({
    activeId: 'new',
    sessions: [
      {
        id: 'old',
        name: 'Princípios do SUS',
        startedAt: '2026-07-16T06:00:00.000Z',
        endedAt: '2026-07-16T06:30:00.000Z',
        cardIds: ['1', '2', '3'],
      },
      {
        id: 'new',
        name: 'Princípios do SUS',
        startedAt: '2026-07-16T06:31:00.000Z',
        endedAt: null,
        cardIds: ['4'],
      },
    ],
  });
  const repaired = bridge.repairLegacySessions(
    state,
    [],
    Date.parse('2026-07-16T07:00:00.000Z'),
  );
  const active = repaired.sessions.find((session) => session.id === repaired.activeId);
  assert.deepEqual(active.cardIds, ['1', '2', '3', '4']);
  assert.equal(active.startedAt, '2026-07-16T06:00:00.000Z');
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

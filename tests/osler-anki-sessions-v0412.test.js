const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../docs/osler-anki-sessions-v0412.user.js');

test('session includes only successful captures after it starts', () => {
  const session = {
    id: 'sus',
    name: 'Princípios do SUS',
    startedAt: '2026-07-16T05:00:00.000Z',
    endedAt: null,
    cardIds: [],
  };
  const audit = [
    { at: '2026-07-16T04:59:59.000Z', status: 'added', id: 'old-card' },
    { at: '2026-07-16T05:00:01.000Z', status: 'added', id: 'new-card' },
    { at: '2026-07-16T05:00:02.000Z', status: 'duplicate', id: 'existing-card-seen-now' },
    { at: '2026-07-16T05:00:03.000Z', status: 'failed', id: 'failed-card' },
  ];
  assert.deepEqual(
    api.deriveSessionCardIdsFromAudit(audit, session),
    ['new-card', 'existing-card-seen-now'],
  );
});

test('polluted v0.4.11 count can be rebuilt from the audit', () => {
  const session = {
    id: 'sus',
    name: 'Princípios do SUS',
    startedAt: '2026-07-16T05:00:00.000Z',
    endedAt: null,
    cardIds: Array.from({ length: 138 }, (_, index) => `old-${index}`),
  };
  const audit = [
    { at: '2026-07-16T05:01:00.000Z', status: 'added', id: 'sus-1' },
    { at: '2026-07-16T05:02:00.000Z', status: 'added', id: 'sus-2' },
    { at: '2026-07-16T05:03:00.000Z', status: 'added', id: 'sus-3' },
  ];
  assert.deepEqual(api.deriveSessionCardIdsFromAudit(audit, session), ['sus-1', 'sus-2', 'sus-3']);
});

test('TSV keeps one named deck and original topics as tags', () => {
  const session = { id: 'sus', name: 'Princípios do SUS', startedAt: 'x', endedAt: null, cardIds: ['1', '2'] };
  const cards = [
    { id: '1', question: { text: 'Q1' }, answer: { text: 'A1' }, explanation: {}, topic: { text: 'Integralidade' } },
    { id: '2', question: { text: 'Q2' }, answer: { text: 'A2' }, explanation: {}, topic: { text: 'Universalidade' } },
  ];
  const tsv = api.buildSessionTsv(cards, session);
  assert.equal((tsv.match(/"Princípios do SUS"/g) || []).length, 2);
  assert.match(tsv, /assunto_integralidade/);
  assert.match(tsv, /assunto_universalidade/);
});

test('redundant audit copies are deduplicated', () => {
  const event = { at: '2026-07-16T05:01:00.000Z', status: 'added', id: 'a', trigger: 'tecla Errei', detail: 'ok' };
  assert.equal(api.mergeAudits([event], [event]).length, 1);
});

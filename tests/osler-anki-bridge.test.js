const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const patch = require('../userscript/osler-anki-bridge.user.js');

test('parses arrays from permanent storage values', () => {
  assert.deepEqual(patch.parseArray([{ id: 'a' }]), [{ id: 'a' }]);
  assert.deepEqual(patch.parseArray('[{"id":"a"}]'), [{ id: 'a' }]);
  assert.deepEqual(patch.parseArray('not-json'), []);
  assert.deepEqual(patch.parseArray(null), []);
});

test('reports when a failed card was captured later', () => {
  const result = patch.failureSummaryFromEvents([
    {
      status: 'failed',
      id: '',
      question: 'Rastreio de GBS. Qual o método de escolha?',
      detail: 'resposta vazia',
    },
    {
      status: 'added',
      id: 'abc',
      question: 'Rastreio de GBS. Qual o método de escolha?',
    },
  ]);
  assert.match(result, /resposta vazia/);
  assert.match(result, /foi capturado depois/);
});

test('reports when no later capture is confirmed', () => {
  const result = patch.failureSummaryFromEvents([
    {
      status: 'failed',
      id: 'missing',
      question: 'Card ausente',
      detail: 'resposta não apareceu',
    },
    {
      status: 'added',
      id: 'other',
      question: 'Outro card',
    },
  ]);
  assert.match(result, /Não há captura posterior confirmada/);
});

test('reports when there are no failures', () => {
  assert.equal(patch.failureSummaryFromEvents([
    { status: 'added', question: 'Card válido' },
  ]), 'Nenhuma falha registrada.');
});

test('source and published copy are identical at v0.4.8', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  const published = fs.readFileSync(path.join(__dirname, '../docs/osler-anki-bridge.user.js'), 'utf8');
  assert.equal(source, published);
  assert.match(source, /@version\s+0\.4\.8/);
  assert.match(source, /@grant\s+GM_download/);
  assert.match(source, /@grant\s+GM_setClipboard/);
  assert.match(source, /@require\s+https:\/\/raw\.githubusercontent\.com\/leonardolealluz183-bit\/osler-anki-bridge\/d563f7f73a48916ed8e9e0405b7aaa22b7e3939f\/userscript\/osler-anki-bridge\.user\.js/);
  assert.match(source, /ARQUIVO BAIXADO/);
  assert.match(source, /Abrir TSV/);
  assert.match(source, /Copiar log/);
  assert.match(source, /Última falha:/);
  assert.doesNotMatch(source.split('// ==/UserScript==')[1] || '', /\bfetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest/);
});

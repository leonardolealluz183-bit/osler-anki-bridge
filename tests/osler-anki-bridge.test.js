const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bridge = require('../userscript/osler-anki-bridge.user.js');

const noDom = { createElement() { return null; } };

function validCard(id = 'angio') {
  return {
    id,
    url: 'https://oslermedicina.com.br/test?token=secret',
    question: {
      text: 'Angioedema. Em linhas gerais, qual a fisiopatologia?',
      html: '<strong>Angioedema.</strong> Em linhas gerais, qual a fisiopatologia?',
    },
    answer: {
      text: 'Perda da integridade vascular.',
      html: '<strong>Perda da integridade vascular.</strong>',
      items: [],
    },
    explanation: { text: 'Explicação', html: '<p>Explicação</p>' },
    topic: { text: 'Angioedema', html: 'Angioedema.' },
    deck: { text: 'Angioedema', html: 'Angioedema.' },
  };
}

test('version 0.4.2 is published identically', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  const published = fs.readFileSync(path.join(__dirname, '../docs/osler-anki-bridge.user.js'), 'utf8');
  assert.equal(source, published);
  assert.match(source, /@version\s+0\.4\.2/);
});

test('cleans highlight wrappers and sensitive tokens', () => {
  const clean = bridge.sanitizeHtml('<mark class="osler-highlight" data-start-offset="1">Texto</mark><img src="/x?token=secret">', noDom);
  assert.doesNotMatch(clean, /osler-highlight|data-start-offset|token=secret/);
  assert.match(clean, /Texto/);
});

test('accepts the missed angioedema physiology card', () => {
  assert.equal(bridge.validateCard(validCard()).valid, true);
});

test('rejects verdict-only cards without answers', () => {
  const card = validCard();
  card.question = { text: 'Não!', html: 'Não!' };
  card.topic = { text: 'Não', html: 'Não!' };
  card.answer = { text: '', html: '', items: [] };
  assert.equal(bridge.validateCard(card).valid, false);
});

test('TSV contains four columns and strips tokens', () => {
  const originalLocalStorage = global.localStorage;
  global.localStorage = {
    getItem() { return JSON.stringify([validCard()]); },
    setItem() {},
  };
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  assert.doesNotMatch(source.split('// ==/UserScript==')[1] || '', /\bfetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest/);
  global.localStorage = originalLocalStorage;
});

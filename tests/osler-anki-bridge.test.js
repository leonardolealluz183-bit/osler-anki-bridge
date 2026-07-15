const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Node = { DOCUMENT_POSITION_FOLLOWING: 4 };
const bridge = require('../userscript/osler-anki-bridge.user.js');
const noDom = { createElement() { return null; } };

function visible(order, tag, text) {
  return {
    order,
    tagName: tag.toUpperCase(),
    textContent: text,
    hidden: false,
    offsetParent: {},
    parentElement: null,
    innerHTML: text,
    outerHTML: `<${tag}>${text}</${tag}>`,
    getClientRects() { return [1]; },
    getBoundingClientRect() { return { top: 200 }; },
    compareDocumentPosition(other) { return this.order < other.order ? 4 : 2; },
    closest(selector) {
      if (selector.startsWith('#')) return null;
      if (selector === 'div.osler-card-explanation') return null;
      return null;
    },
    contains() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function noExplanationCardDocument() {
  const strong = { textContent: 'Obstrução Intestinal.', innerHTML: 'Obstrução Intestinal.' };
  const question = visible(1, 'p', 'Obstrução Intestinal. Quanto à etiologia, é classificada como:');
  question.innerHTML = '<strong>Obstrução Intestinal.</strong> Quanto à etiologia, é classificada como:';
  question.querySelector = (selector) => selector === 'strong' ? strong : null;
  question.cloneNode = () => ({
    textContent: question.textContent,
    innerHTML: question.innerHTML,
    querySelectorAll() { return []; },
    querySelector(selector) {
      if (selector !== 'strong') return null;
      return { remove() {} };
    },
  });

  const first = visible(2.1, 'li', 'Mecânica, ou');
  const second = visible(2.2, 'li', 'Funcional.');
  const list = visible(2, 'ul', 'Mecânica, ou Funcional.');
  list.innerHTML = '<li>Mecânica, ou</li><li>Funcional.</li>';
  list.outerHTML = `<ul>${list.innerHTML}</ul>`;
  list.querySelectorAll = (selector) => selector === 'li' ? [first, second] : [];

  const citation = visible(3, 'p', 'Etiologies and diagnosis of obstruction in adults, em UpToDate.');
  const root = {
    parentElement: null,
    querySelectorAll(selector) {
      return selector === 'p,ul,ol,table,blockquote' ? [question, list, citation] : [];
    },
  };
  question.parentElement = root;
  list.parentElement = root;
  citation.parentElement = root;

  const documentRef = {
    body: {},
    querySelectorAll(selector) {
      if (selector === 'p') return [question, citation];
      if (selector === 'div.osler-card-explanation') return [];
      return [];
    },
    createElement() { return null; },
    createTextNode(text) { return text; },
  };
  return { documentRef, question };
}

test('extracts list answer when the card has no explanation block', () => {
  const { documentRef, question } = noExplanationCardDocument();
  global.document = documentRef;
  const card = bridge.extractCard(documentRef);
  assert.equal(card.question.text, question.textContent);
  assert.equal(card.answer.source, 'card-body');
  assert.equal(card.answer.text, 'Mecânica, ou\nFuncional.');
  assert.equal(card.explanation.text, '');
  assert.equal(card.topic.text, 'Obstrução Intestinal');
  assert.equal(bridge.validateCard(card).valid, true);
});

test('excludes citation paragraphs from answer candidates', () => {
  assert.equal(bridge.isCitationText('Etiologies and diagnosis, em UpToDate.'), true);
  assert.equal(bridge.isCitationText('Mecânica, ou funcional.'), false);
});

test('cleans highlights and sensitive tokens', () => {
  const clean = bridge.sanitizeHtml('<mark class="osler-highlight" data-start-offset="1">Texto</mark><img src="/x?token=secret">', noDom);
  assert.doesNotMatch(clean, /osler-highlight|data-start-offset|token=secret/);
  assert.match(clean, /Texto/);
});

test('rejects verdict-only cards without answers', () => {
  const result = bridge.validateCard({
    question: { text: 'Não!', html: 'Não!' },
    answer: { text: '', html: '' },
    topic: { text: 'Não' },
  });
  assert.equal(result.valid, false);
});

test('source and published copy are identical at v0.4.3', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  const published = fs.readFileSync(path.join(__dirname, '../docs/osler-anki-bridge.user.js'), 'utf8');
  assert.equal(source, published);
  assert.match(source, /@version\s+0\.4\.3/);
  assert.doesNotMatch(source.split('// ==/UserScript==')[1] || '', /\bfetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest/);
});

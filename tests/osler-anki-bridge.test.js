const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Node = { DOCUMENT_POSITION_FOLLOWING: 4 };
global.innerWidth = 1600;
global.innerHeight = 900;
global.location = {
  pathname: '/test',
  href: 'https://oslermedicina.com.br/test',
  origin: 'https://oslermedicina.com.br',
};

const bridge = require('../userscript/osler-anki-bridge.user.js');
const noDom = { createElement() { return null; } };

function visible(order, tag, text, rect = {}) {
  const box = {
    top: 180,
    left: 100,
    right: 1000,
    bottom: 240,
    width: 900,
    height: 60,
    ...rect,
  };
  return {
    order,
    tagName: tag.toUpperCase(),
    textContent: text,
    hidden: false,
    offsetParent: {},
    parentElement: null,
    innerHTML: text,
    outerHTML: `<${tag}>${text}</${tag}>`,
    getClientRects() { return [box]; },
    getBoundingClientRect() { return box; },
    compareDocumentPosition(other) { return this.order < other.order ? 4 : 2; },
    closest() { return null; },
    contains() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function questionNode(text, topic) {
  const strong = { textContent: `${topic}.`, innerHTML: `${topic}.` };
  const question = visible(1, 'p', text);
  question.innerHTML = `<strong>${topic}.</strong>${text.slice(text.indexOf('.') + 1)}`;
  question.querySelector = (selector) => {
    if (selector === 'strong') return strong;
    return null;
  };
  question.cloneNode = () => {
    const clone = {
      textContent: question.textContent,
      innerHTML: question.innerHTML,
      outerHTML: `<p>${question.innerHTML}</p>`,
      querySelectorAll() { return []; },
      querySelector(selector) {
        if (selector !== 'strong') return null;
        return { remove() {} };
      },
    };
    return clone;
  };
  return question;
}

function noExplanationCardDocument() {
  const question = questionNode(
    'Obstrução Intestinal. Quanto à etiologia, é classificada como:',
    'Obstrução Intestinal',
  );
  const first = visible(2.1, 'li', 'Mecânica, ou');
  const second = visible(2.2, 'li', 'Funcional.');
  const list = visible(2, 'ul', 'Mecânica, ou Funcional.', { top: 260, bottom: 360, height: 100 });
  list.innerHTML = '<li>Mecânica, ou</li><li>Funcional.</li>';
  list.outerHTML = `<ul>${list.innerHTML}</ul>`;
  list.querySelectorAll = (selector) => selector === 'li' ? [first, second] : [];

  const citation = visible(3, 'p', 'Etiologies and diagnosis of obstruction in adults, em UpToDate.', { top: 500, bottom: 540, height: 40 });
  const root = {
    parentElement: null,
    querySelectorAll(selector) {
      if (selector === 'p,ul,ol,table,blockquote') return [question, list, citation];
      return [];
    },
  };
  question.parentElement = root;
  list.parentElement = root;
  citation.parentElement = root;

  const documentRef = {
    body: {},
    documentElement: { clientWidth: 1600, clientHeight: 900 },
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

function bodyClozeDocument(answer) {
  const stem = 'Hipertensão Arterial. Antes de aferir a pressão arterial, deve-se perguntar ao paciente se:';
  const question = questionNode(stem, 'Hipertensão Arterial');
  const cloze = visible(2.2, 'span', answer, { top: 310, bottom: 335, height: 25, width: 300, right: 400 });
  cloze.innerHTML = answer;

  const list = visible(2, 'ul', `Está com a bexiga cheia; ${answer}; Ingeriu café.`, { top: 260, bottom: 390, height: 130 });
  list.innerHTML = `<li>Está com a bexiga cheia</li><li><span class="cloze-answer">${answer}</span></li><li>Ingeriu café</li>`;
  list.outerHTML = `<ul>${list.innerHTML}</ul>`;
  list.contains = (node) => node === cloze;
  list.querySelectorAll = (selector) => selector === 'li' ? [] : [];
  list.cloneNode = () => {
    const clone = {
      textContent: `Está com a bexiga cheia; ${answer}; Ingeriu café.`,
      innerHTML: list.innerHTML,
      outerHTML: list.outerHTML,
      querySelectorAll(selector) {
        if (!selector.includes('cloze-answer')) return [];
        return [{
          replaceWith() {
            clone.textContent = 'Está com a bexiga cheia; [...]; Ingeriu café.';
            clone.innerHTML = '<li>Está com a bexiga cheia</li><li>[...]</li><li>Ingeriu café</li>';
            clone.outerHTML = `<ul>${clone.innerHTML}</ul>`;
          },
        }];
      },
    };
    return clone;
  };

  const citation = visible(3, 'p', 'Diretriz Brasileira de Hipertensão Arterial, em SBC.', { top: 520, bottom: 560, height: 40 });
  const root = {
    parentElement: null,
    querySelectorAll(selector) {
      if (selector === 'p,ul,ol,table,blockquote') return [question, list, citation];
      if (selector.includes('cloze-answer')) return [cloze];
      return [];
    },
  };
  question.parentElement = root;
  list.parentElement = root;
  cloze.parentElement = list;
  citation.parentElement = root;

  const documentRef = {
    body: {},
    documentElement: { clientWidth: 1600, clientHeight: 900 },
    querySelectorAll(selector) {
      if (selector === 'p') return [question, citation];
      if (selector === 'div.osler-card-explanation') return [];
      return [];
    },
    createElement() { return null; },
    createTextNode(text) { return text; },
  };
  return documentRef;
}

test('page modes separate capture from the heavy report screen', () => {
  assert.equal(bridge.pageMode({ pathname: '/test' }), 'test');
  assert.equal(bridge.pageMode({ pathname: '/test/' }), 'test');
  assert.equal(bridge.pageMode({ pathname: '/test/report' }), 'report');
  assert.equal(bridge.pageMode({ pathname: '/test/report/' }), 'report');
  assert.equal(bridge.pageMode({ pathname: '/dashboard' }), 'idle');
});

test('extracts list answer when the card has no explanation block', () => {
  global.location.pathname = '/test';
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

test('body clozes create distinct cards for the same stem', () => {
  global.location.pathname = '/test';
  const firstDocument = bodyClozeDocument('Fumou há menos de 30 minutos');
  global.document = firstDocument;
  const first = bridge.extractCard(firstDocument);

  const secondDocument = bodyClozeDocument('Praticou exercício físico há menos de 90 minutos');
  global.document = secondDocument;
  const second = bridge.extractCard(secondDocument);

  assert.equal(first.answer.source, 'body-cloze');
  assert.equal(second.answer.source, 'body-cloze');
  assert.match(first.question.text, /\[\.\.\.\]/);
  assert.notEqual(first.answer.text, second.answer.text);
  assert.notEqual(first.id, second.id);
});

test('does not scan for cards on the report page', () => {
  global.location.pathname = '/test/report';
  const documentRef = {
    querySelectorAll() { throw new Error('report page must not be scanned'); },
  };
  assert.equal(bridge.extractCard(documentRef), null);
  global.location.pathname = '/test';
});

test('keyboard shortcuts map 1 to Errei and 2 to Difícil', () => {
  const body = { tagName: 'BODY', closest() { return null; } };
  assert.equal(bridge.keyTriggerForEvent({ key: '1', target: body }), 'Errei');
  assert.equal(bridge.keyTriggerForEvent({ key: '2', target: body }), 'Difícil');
  assert.equal(bridge.keyTriggerForEvent({ key: ' ', target: body }), null);
  assert.equal(bridge.keyTriggerForEvent({ key: '1', target: { tagName: 'INPUT' } }), null);
});

test('rejects a placeholder list before the hidden answer is revealed', () => {
  const result = bridge.validateCard({
    question: { text: 'São objetos não pontiagudos cuja ingestão pode ser uma causa:' },
    answer: {
      source: 'card-body',
      text: '[...], e Baterias/pilhas.',
      html: '<ul><li>[...]</li><li>Baterias/pilhas</li></ul>',
    },
    topic: { text: 'Abdome Agudo Perfurativo' },
  });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes('resposta ainda não revelada'));
});

test('accepts a revealed cloze even when the question contains a blank', () => {
  const result = bridge.validateCard({
    question: { text: 'A tríade de [...] é sugestiva de ruptura esofágica.' },
    answer: { source: 'question-cloze', text: 'Mackler', html: 'Mackler' },
    topic: { text: 'Cirurgia Geral' },
  });
  assert.equal(result.valid, true);
});

test('excludes citation paragraphs from answers', () => {
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

test('source and published copy are identical at v0.4.6', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  const published = fs.readFileSync(path.join(__dirname, '../docs/osler-anki-bridge.user.js'), 'utf8');
  assert.equal(source, published);
  assert.match(source, /@version\s+0\.4\.6/);
  assert.match(source, /bloqueado sem avançar/);
  assert.match(source, /Só avança depois de salvar/);
  assert.match(source, /CAPTURE_TIMEOUT_MS = 2200/);
  assert.match(source, /URL\.revokeObjectURL\(url\), 60000/);
  assert.doesNotMatch(source.split('// ==/UserScript==')[1] || '', /\bfetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest/);
});

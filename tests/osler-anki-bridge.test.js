const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bridge = require('../userscript/osler-anki-bridge.user.js');

function fakeDocument(map = {}) {
  return {
    querySelector(selector) { return map[selector] || null; },
    createElement(tag) {
      if (tag === 'template') return { innerHTML: '' };
      return { tagName: String(tag).toUpperCase(), innerHTML: '', textContent: '' };
    },
  };
}

function makeQuestion({ topic = 'Fisiologia Renal.', segments = [] } = {}) {
  const tokens = [
    { type: 'plain', text: `${topic} `, html: `<strong>${topic}</strong> ` },
    ...segments.map((segment) => ({ ...segment })),
  ];
  const strong = { textContent: topic, innerHTML: topic };

  function buildTokenText(token) {
    return token.replacement ?? token.text;
  }

  function buildTokenHtml(token) {
    return token.replacement ?? token.html;
  }

  function buildNode(localTokens) {
    const node = {
      tagName: 'P',
      nodeType: 1,
      classList: ['ContentText-dynamicHash'],
      attributes: [],
      parentElement: null,
      previousElementSibling: null,
      get children() { return []; },
      get textContent() { return localTokens.map(buildTokenText).join(''); },
      get innerHTML() { return localTokens.map(buildTokenHtml).join(''); },
      querySelector(selector) {
        return selector === 'strong' ? strong : null;
      },
      querySelectorAll(selector) {
        if (selector !== '.cloze-answer') return [];
        return localTokens
          .map((token, index) => ({ token, index }))
          .filter(({ token }) => token.type === 'cloze')
          .map(({ token, index }) => ({
            textContent: token.text,
            innerHTML: token.html,
            replaceWith(value) { localTokens[index].replacement = String(value); },
          }));
      },
      cloneNode() {
        return buildNode(localTokens.map((token) => ({ ...token })));
      },
    };
    return node;
  }

  return buildNode(tokens);
}

function makeCardDocument({ topic, className = 'fWJzQ', explanationParagraphs = 4, segments } = {}) {
  const question = makeQuestion({ topic, segments });
  question.classList = [className];
  const paragraphs = Array.from({ length: explanationParagraphs }, (_, index) => `<p><em>Parágrafo ${index + 1}</em></p>`);
  const explanation = {
    tagName: 'DIV',
    nodeType: 1,
    classList: ['osler-card-explanation'],
    attributes: [],
    textContent: paragraphs.map((_, index) => `Parágrafo ${index + 1}`).join(' '),
    innerHTML: paragraphs.join('\n'),
    previousElementSibling: question,
    parentElement: null,
  };
  const parent = { children: [question, explanation] };
  question.parentElement = parent;
  explanation.parentElement = parent;
  return fakeDocument({ 'div.osler-card-explanation': explanation });
}

function defaultSegments() {
  return [
    { type: 'plain', text: 'O rim impede acidose ao ', html: 'O rim impede acidose ao ' },
    { type: 'cloze', text: 'reter HCO3–', html: 'reter HCO<sub>3</sub><sup>–</sup>' },
    { type: 'plain', text: ' e eliminar ', html: ' e eliminar ' },
    { type: 'cloze', text: 'ácidos', html: '<strong>ácidos</strong>' },
    { type: 'plain', text: '.', html: '.' },
  ];
}

test('sanitizes useful HTML while removing scripts and dangerous attributes', () => {
  const sanitized = bridge.sanitizeHtml('<p onclick="x()"><strong>OK</strong><script>alert(1)</script><a href="javascript:bad()">link</a></p>', fakeDocument());
  assert.match(sanitized, /<strong>OK<\/strong>/);
  assert.doesNotMatch(sanitized, /script/i);
  assert.doesNotMatch(sanitized, /onclick/i);
  assert.doesNotMatch(sanitized, /javascript:/i);
});

test('extracts topic from first strong and removes terminal punctuation', () => {
  const card = bridge.extractOslerCard(makeCardDocument({
    topic: 'Fisiologia Renal.',
    segments: defaultSegments(),
  }));
  assert.equal(card.topic.text, 'Fisiologia Renal');
  assert.equal(card.deck.text, 'Fisiologia Renal');
});

test('extracts multiple cloze answers and replaces them with placeholders', () => {
  const card = bridge.extractOslerCard(makeCardDocument({
    topic: 'Fisiologia Renal.',
    segments: defaultSegments(),
  }));
  assert.equal(card.answer.text, 'reter HCO3–; ácidos');
  assert.equal(card.answer.items.length, 2);
  assert.equal(card.question.text, 'Fisiologia Renal. O rim impede acidose ao [...] e eliminar [...].');
  assert.match(card.question.html, /\[\.\.\.\]/);
  assert.equal(card.question.revealedText, 'Fisiologia Renal. O rim impede acidose ao reter HCO3– e eliminar ácidos.');
  assert.match(card.question.revealedHtml, /cloze-answer|reter HCO/);
});

test('captures the complete explanation with four or more paragraphs', () => {
  const card = bridge.extractOslerCard(makeCardDocument({
    topic: 'Ácido-base.',
    segments: defaultSegments(),
    explanationParagraphs: 5,
  }));
  assert.match(card.explanation.text, /Parágrafo 1/);
  assert.match(card.explanation.text, /Parágrafo 5/);
  assert.equal((card.explanation.html.match(/<p>/g) || []).length, 5);
});

test('does not depend on styled-components dynamic classes', () => {
  const first = bridge.extractOslerCard(makeCardDocument({ topic: 'Tema.', className: 'fWJzQ', segments: defaultSegments() }));
  const second = bridge.extractOslerCard(makeCardDocument({ topic: 'Tema.', className: 'SMhPF', segments: defaultSegments() }));
  assert.deepEqual(first.question.text, second.question.text);
  assert.deepEqual(first.answer.text, second.answer.text);
});

test('detects Errei and Difícil by visible text and ignores Acertei', () => {
  assert.equal(bridge.triggerForButton({ textContent: ' Errei ' }), 'botão Errei');
  assert.equal(bridge.triggerForButton({ textContent: 'DIFÍCIL 12 min' }), 'botão Difícil');
  assert.equal(bridge.triggerForButton({ textContent: 'Acertei' }), null);
});

test('captures an automatic card once and ignores duplicates', () => {
  global.location = { href: 'https://oslermedicina.com.br/test' };
  const doc = makeCardDocument({
    topic: 'Deduplicação.',
    segments: defaultSegments(),
  });
  const first = bridge.captureCard('botão Errei', doc);
  const duplicate = bridge.captureCard('botão Difícil', doc);
  assert.equal(first.topic.text, 'Deduplicação');
  assert.equal(first.id, bridge.buildStableId(first));
  assert.equal(duplicate, null);
});

test('userscript header targets Osler and provides update URLs without localhost', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  assert.match(source, /@version\s+0\.3\.0/);
  assert.match(source, /@match\s+https:\/\/oslermedicina\.com\.br\/\*/);
  assert.match(source, /@match\s+https:\/\/\*\.oslermedicina\.com\.br\/\*/);
  assert.match(source, /@updateURL\s+https:\/\/leonardolealluz183-bit\.github\.io\/osler-anki-bridge\/osler-anki-bridge\.user\.js/);
  assert.doesNotMatch(source, /localhost/);
});

test('source contains no network, AnkiDroid, Android Intent, or external sender', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  const executable = source.split('// ==/UserScript==')[1] || '';
  assert.doesNotMatch(executable, /\bfetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest|android intent|ankidroid/i);
});

test('source and GitHub Pages userscripts are identical', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  const published = fs.readFileSync(path.join(__dirname, '../docs/osler-anki-bridge.user.js'), 'utf8');
  assert.equal(source, published);
});

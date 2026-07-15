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
    return {
      tagName: 'P',
      nodeType: 1,
      classList: ['ContentText-dynamicHash'],
      attributes: [],
      parentElement: null,
      previousElementSibling: null,
      get children() { return []; },
      get textContent() { return localTokens.map(buildTokenText).join(''); },
      get innerHTML() { return localTokens.map(buildTokenHtml).join(''); },
      get outerHTML() { return `<p>${this.innerHTML}</p>`; },
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
  }

  return buildNode(tokens);
}

function makeListAnswer(items) {
  const listItems = items.map((item) => ({
    tagName: 'LI',
    textContent: item,
    innerHTML: `<strong>${item}</strong>`,
    outerHTML: `<li><strong>${item}</strong></li>`,
    querySelectorAll() { return []; },
    querySelector() { return null; },
  }));
  return {
    tagName: 'UL',
    nodeType: 1,
    classList: ['AnswerContainer-random'],
    attributes: [],
    textContent: items.join(' '),
    innerHTML: listItems.map((item) => item.outerHTML).join(''),
    outerHTML: `<ul>${listItems.map((item) => item.outerHTML).join('')}</ul>`,
    parentElement: null,
    previousElementSibling: null,
    querySelector() { return null; },
    querySelectorAll(selector) {
      return selector === 'li' ? listItems : [];
    },
  };
}

function makeCardDocument({
  topic,
  className = 'fWJzQ',
  explanationParagraphs = 4,
  segments,
  intermediate = [],
} = {}) {
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
    outerHTML: `<div class="osler-card-explanation">${paragraphs.join('\n')}</div>`,
    previousElementSibling: null,
    parentElement: null,
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const children = [question, ...intermediate, explanation];
  const parent = { children };
  children.forEach((child, index) => {
    child.parentElement = parent;
    child.previousElementSibling = index > 0 ? children[index - 1] : null;
  });
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

test('removes temporary authorization tokens from image URLs', () => {
  global.location = { origin: 'https://oslermedicina.com.br' };
  assert.equal(
    bridge.scrubSensitiveUrl('/api/images/content/card.png?token=secret&width=800'),
    '/api/images/content/card.png?width=800',
  );
  const sanitized = bridge.sanitizeHtml('<img src="/api/images/content/card.png?token=secret">', fakeDocument());
  assert.doesNotMatch(sanitized, /token=|secret/);
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
  assert.equal(card.answer.source, 'cloze');
  assert.equal(card.answer.text, 'reter HCO3–; ácidos');
  assert.equal(card.answer.items.length, 2);
  assert.equal(card.question.text, 'Fisiologia Renal. O rim impede acidose ao [...] e eliminar [...].');
  assert.match(card.question.html, /\[\.\.\.\]/);
  assert.equal(card.question.revealedText, 'Fisiologia Renal. O rim impede acidose ao reter HCO3– e eliminar ácidos.');
});

test('extracts a non-cloze answer block located between question and explanation', () => {
  const answerList = makeListAnswer(['Amniocentese', 'Trauma abdominal', 'Parto']);
  const card = bridge.extractOslerCard(makeCardDocument({
    topic: 'Aloimunização Rh.',
    segments: [
      { type: 'plain', text: 'O sangramento fetomaternal está associado a situações como:', html: 'O sangramento fetomaternal está associado a situações como:' },
    ],
    intermediate: [answerList],
  }));

  assert.equal(card.question.text, 'Aloimunização Rh. O sangramento fetomaternal está associado a situações como:');
  assert.equal(card.answer.source, 'intermediate-block');
  assert.equal(card.answer.text, 'Amniocentese\nTrauma abdominal\nParto');
  assert.equal(card.answer.items.length, 3);
  assert.match(card.answer.html, /<ul>/);
});

test('finds the question by its strong topic even when answer paragraphs are between it and explanation', () => {
  const answerParagraph = {
    tagName: 'P',
    textContent: 'Resposta intermediária',
    innerHTML: 'Resposta intermediária',
    outerHTML: '<p>Resposta intermediária</p>',
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const doc = makeCardDocument({
    topic: 'Tema correto.',
    segments: [{ type: 'plain', text: 'Pergunta real?', html: 'Pergunta real?' }],
    intermediate: [answerParagraph],
  });
  const card = bridge.extractOslerCard(doc);
  assert.equal(card.topic.text, 'Tema correto');
  assert.match(card.question.text, /Pergunta real/);
  assert.equal(card.answer.text, 'Resposta intermediária');
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

test('detects Errei and Difícil from nested button content and ignores Acertei', () => {
  function button(text) {
    const node = {
      tagName: 'BUTTON',
      textContent: text,
      parentElement: null,
      getAttribute() { return null; },
      closest() { return node; },
    };
    return node;
  }
  const wrong = button(' Errei ');
  const hard = button('DIFÍCIL 12 min');
  const correct = button('Acertei');
  const nestedWrong = { closest() { return wrong; } };

  assert.equal(bridge.triggerForButton(bridge.findActionElement(nestedWrong)), 'botão Errei');
  assert.equal(bridge.triggerForButton(hard), 'botão Difícil');
  assert.equal(bridge.triggerForButton(correct), null);
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
  assert.match(source, /@version\s+0\.3\.2/);
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

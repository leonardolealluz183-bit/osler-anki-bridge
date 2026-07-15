const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bridge = require('../userscript/osler-anki-bridge.user.js');

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  };
}

const noDom = { createElement() { return null; } };

function sampleCard(id = 'abc123') {
  return {
    id,
    trigger: 'botão Errei',
    capturedAt: '2026-07-15T08:00:00.000Z',
    url: 'https://oslermedicina.com.br/test?token=secret',
    question: {
      text: 'Fisiologia. Pergunta [...]?',
      html: '<strong><mark class="osler-highlight" data-start-offset="0">Fisiologia</mark>.</strong> Pergunta [...]?',
      revealedText: 'Fisiologia. Pergunta resposta?',
      revealedHtml: '<strong>Fisiologia.</strong> Pergunta <span class="cloze-answer">resposta</span>?',
    },
    answer: {
      source: 'cloze',
      text: 'resposta',
      html: '<mark class="osler-highlight" data-end-offset="10"><strong>resposta</strong></mark>',
      items: [{ text: 'resposta', html: '<strong>resposta</strong>' }],
    },
    explanation: {
      text: 'Explicação',
      html: '<p>Explicação</p><img src="/api/image.png?token=secret">',
    },
    topic: { text: 'Fisiologia', html: 'Fisiologia.' },
    deck: { text: 'Fisiologia', html: 'Fisiologia.' },
  };
}

test('removes calibration highlight wrappers without removing their content', () => {
  const html = '<strong><mark class="osler-highlight" data-start-offset="0" data-end-offset="10">Fisiologia</mark>.</strong>';
  const clean = bridge.sanitizeHtml(html, noDom);
  assert.equal(clean, '<strong>Fisiologia.</strong>');
  assert.doesNotMatch(clean, /osler-highlight|data-start-offset|data-end-offset/);
});

test('rejects a malformed verdict-only card with no answer', () => {
  const invalid = sampleCard('bad');
  invalid.question = { text: 'Não!', html: '<strong>Não!</strong>' };
  invalid.answer = { text: '', html: '', items: [] };
  invalid.topic = { text: 'Não', html: 'Não!' };
  invalid.deck = { text: 'Não', html: 'Não!' };

  const result = bridge.validateCardForExport(invalid);
  assert.equal(result.valid, false);
  assert.match(result.reasons.join(' '), /resposta vazia/);
  assert.match(result.reasons.join(' '), /veredito/);
});

test('repairs a persisted queue by cleaning highlights and removing invalid cards', () => {
  const good = sampleCard('good');
  const bad = sampleCard('bad');
  bad.question = { text: 'Não!', html: '<strong>Não!</strong>' };
  bad.answer = { text: '', html: '', items: [] };
  bad.topic = { text: 'Não', html: 'Não!' };
  bad.deck = { text: 'Não', html: 'Não!' };

  const storage = fakeStorage({
    'oslerAnkiBridge.queue.v1': JSON.stringify([good, bad]),
  });

  const queue = bridge.loadQueue(storage, noDom);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, 'good');
  assert.doesNotMatch(queue[0].question.html, /osler-highlight|data-start-offset/);
  assert.doesNotMatch(queue[0].answer.html, /osler-highlight|data-end-offset/);

  const persisted = JSON.parse(storage.getItem('oslerAnkiBridge.queue.v1'));
  assert.equal(persisted.length, 1);
});

test('does not export invalid cards and produces four TSV columns', () => {
  const good = sampleCard('good');
  const bad = sampleCard('bad');
  bad.question = { text: 'Não!', html: '<strong>Não!</strong>' };
  bad.answer = { text: '', html: '', items: [] };
  bad.topic = { text: 'Não', html: 'Não!' };
  bad.deck = { text: 'Não', html: 'Não!' };

  const tsv = bridge.buildAnkiTsv([good, bad], noDom);
  const dataLines = tsv.replace(/^\uFEFF/, '').split('\n').filter((line) => line && !line.startsWith('#'));
  assert.equal(dataLines.length, 1);
  assert.match(dataLines[0], /osler:good/);
  assert.doesNotMatch(dataLines[0], /osler:bad|osler-highlight|token=secret/);
  assert.equal((dataLines[0].match(/\t/g) || []).length, 3);
});

test('selects the real question instead of a nearby Não verdict paragraph', () => {
  function paragraph(text, strongText = '') {
    const strong = strongText ? { textContent: strongText } : null;
    return {
      tagName: 'P',
      textContent: text,
      previousElementSibling: null,
      querySelector(selector) {
        if (selector === 'strong') return strong;
        if (selector === '.cloze-answer') return null;
        return null;
      },
      cloneNode() {
        return {
          textContent: text,
          querySelector(selector) {
            if (selector !== 'strong' || !strong) return null;
            return { remove() {} };
          },
        };
      },
    };
  }

  const question = paragraph('Síndrome Coronariana Aguda. A aterosclerose é a única causa?', 'Síndrome Coronariana Aguda.');
  const verdict = paragraph('Não!', 'Não!');
  const explanation = { previousElementSibling: verdict };
  verdict.previousElementSibling = question;

  question.cloneNode = () => ({
    textContent: 'A aterosclerose é a única causa?',
    querySelector() { return { remove() {} }; },
  });
  verdict.cloneNode = () => ({
    textContent: '',
    querySelector() { return { remove() {} }; },
  });

  assert.equal(bridge.findQuestionElement(explanation), question);
});

test('recognizes concatenated rating labels', () => {
  assert.equal(bridge.triggerForButton({ textContent: 'Errei7 dias' }), 'botão Errei');
  assert.equal(bridge.triggerForButton({ textContent: 'Difícil12 min' }), 'botão Difícil');
  assert.equal(bridge.triggerForButton({ textContent: 'Acertei4 dias' }), null);
});

test('userscript and published copy are identical and versioned 0.4.1', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  const published = fs.readFileSync(path.join(__dirname, '../docs/osler-anki-bridge.user.js'), 'utf8');
  assert.equal(source, published);
  assert.match(source, /@version\s+0\.4\.1/);
  assert.doesNotMatch(source.split('// ==/UserScript==')[1] || '', /\bfetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest/);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const bridge = require('../userscript/osler-anki-bridge.user.js');

function element({ tagName = 'section', id = '', attrs = {}, text = '', html = '', classes = [] } = {}) {
  return {
    tagName: tagName.toUpperCase(),
    id,
    nodeType: 1,
    textContent: text,
    innerHTML: html || text,
    parentElement: null,
    children: [],
    classList: classes,
    style: {},
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    setAttribute(name, value) { attrs[name] = value; },
    removeAttribute(name) { delete attrs[name]; },
    addEventListener(event, handler, options) { this.listener = { event, handler, options }; },
  };
}

function fakeDocument(map = {}) {
  const listeners = [];
  return {
    title: 'Osler simulado',
    body: { appendChild(node) { this.child = node; } },
    createElement(tag) {
      if (tag === 'template') return { innerHTML: '' };
      return element({ tagName: tag });
    },
    getElementById() { return null; },
    addEventListener(event, handler, options) { listeners.push({ event, handler, options }); },
    querySelector(selector) { return map[selector] || null; },
    querySelectorAll(selector) {
      if (selector === '[data-osler-capture-bound]') return [];
      return Object.values(map).filter(Boolean);
    },
    listeners,
  };
}

function storage() {
  const data = new Map();
  return {
    getItem(key) { return data.get(key) || null; },
    setItem(key, value) { data.set(key, value); },
  };
}

test('sanitizes useful HTML while removing scripts and dangerous attributes', () => {
  const sanitized = bridge.sanitizeHtml('<p onclick="x()"><strong>OK</strong><script>alert(1)</script><a href="javascript:bad()">link</a></p>', fakeDocument());

  assert.match(sanitized, /<strong>OK<\/strong>/);
  assert.doesNotMatch(sanitized, /script/i);
  assert.doesNotMatch(sanitized, /onclick/i);
  assert.doesNotMatch(sanitized, /javascript:/i);
});

test('captures calibrated fields with stable id and ignores duplicates', () => {
  global.location = { href: 'https://osler.test/card/1' };
  const doc = fakeDocument({
    '[data-q]': element({ text: 'Pergunta?', html: '<strong>Pergunta?</strong>' }),
    '[data-a]': element({ text: 'Resposta', html: '<em>Resposta</em>' }),
    '[data-e]': element({ text: 'Explicação', html: '<p>Explicação</p>' }),
    '[data-d]': element({ text: 'Deck' }),
  });

  bridge.saveConfig({ question: '[data-q]', answer: '[data-a]', explanation: '[data-e]', deck: '[data-d]' }, storage());
  const first = bridge.captureCard('botão Errei', doc);
  const duplicate = bridge.captureCard('botão Difícil', doc);

  assert.equal(first.question.text, 'Pergunta?');
  assert.equal(first.answer.html, '<em>Resposta</em>');
  assert.equal(first.deck.text, 'Deck');
  assert.equal(first.id, bridge.buildStableId(first));
  assert.equal(duplicate, null);
});

test('calibration stores selectors for visual selection targets', () => {
  global.localStorage = storage();
  const target = element({ tagName: 'h1', id: 'question-title', text: 'Pergunta' });
  const doc = fakeDocument({ '#question-title': target });

  bridge.startCalibration('question');
  assert.equal(bridge.finishCalibration(target, doc), true);
  const saved = bridge.loadConfig(global.localStorage);

  assert.equal(saved.question, '#question-title');
});

test('binds capture only to Errei and Difícil, not Acertei', () => {
  const wrong = element({ tagName: 'button', text: 'Errei' });
  const hard = element({ tagName: 'button', text: 'Difícil' });
  const correct = element({ tagName: 'button', text: 'Acertei' });
  const doc = fakeDocument({ '[wrong]': wrong, '[hard]': hard, '[correct]': correct });

  bridge.saveConfig({ wrongButton: '[wrong]', hardButton: '[hard]', correctButton: '[correct]' }, storage());
  bridge.bindCaptureButtons(doc);

  assert.equal(wrong.listener.event, 'click');
  assert.equal(wrong.listener.options.capture, true);
  assert.equal(hard.listener.event, 'click');
  assert.equal(hard.listener.options.capture, true);
  assert.equal(correct.listener, undefined);
});

test('public API contains no AnkiDroid, intent, platform blocking, or network sender', () => {
  const apiNames = Object.keys(bridge).join(' ');
  assert.doesNotMatch(apiNames, /anki|intent|android|send|fetch/i);
});


test('userscript header targets the real Osler Medicina domain only', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');

  assert.match(source, /@match\s+https:\/\/oslermedicina\.com\.br\/\*/);
  assert.match(source, /@match\s+https:\/\/\*\.oslermedicina\.com\.br\/\*/);
  assert.doesNotMatch(source, /osler\.app|osler\.com/);
});

test('GitHub Pages artifact includes demo index and installable userscript', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/pages.yml'), 'utf8');
  const demo = fs.readFileSync(path.join(__dirname, '../demo/index.html'), 'utf8');

  assert.match(workflow, /mkdir -p _site/);
  assert.match(workflow, /cp demo\/index\.html _site\/index\.html/);
  assert.match(workflow, /cp userscript\/osler-anki-bridge\.user\.js _site\/osler-anki-bridge\.user\.js/);
  assert.match(workflow, /path: _site/);
  assert.match(demo, /\.\/osler-anki-bridge\.user\.js/);
});

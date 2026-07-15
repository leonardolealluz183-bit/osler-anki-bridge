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

const noDom = {
  createElement() { return null; },
};

function sampleCard(id = 'abc123') {
  return {
    id,
    trigger: 'botão Errei',
    capturedAt: '2026-07-15T08:00:00.000Z',
    url: 'https://oslermedicina.com.br/test?token=secret',
    question: {
      text: 'Tema. Pergunta [...]?',
      html: '<strong>Tema.</strong> Pergunta [...]?',
      revealedText: 'Tema. Pergunta resposta?',
      revealedHtml: '<strong>Tema.</strong> Pergunta <span class="cloze-answer">resposta</span>?',
    },
    answer: {
      source: 'cloze',
      text: 'resposta',
      html: '<strong>resposta</strong>',
      items: [{ text: 'resposta', html: '<strong>resposta</strong>' }],
    },
    explanation: {
      text: 'Explicação',
      html: '<p>Explicação</p><img src="/api/image.png?token=secret">',
    },
    topic: { text: 'Tema', html: 'Tema.' },
    deck: { text: 'Tema', html: 'Tema.' },
  };
}

test('sanitizes scripts, event handlers and temporary URL tokens', () => {
  const html = '<p onclick="x()">OK<script>alert(1)</script><img src="/api/a.png?token=secret&width=10"></p>';
  const sanitized = bridge.sanitizeHtml(html, noDom);
  assert.doesNotMatch(sanitized, /script|onclick|token=|secret/i);
  assert.match(sanitized, /width=10/);
});

test('queue persists across reloads and removes duplicate IDs', () => {
  const storage = fakeStorage({
    'oslerAnkiBridge.queue.v1': JSON.stringify([
      sampleCard('x'),
      sampleCard('x'),
      sampleCard('y'),
    ]),
  });

  const queue = bridge.loadQueue(storage);
  assert.deepEqual(queue.map((card) => card.id), ['x', 'y']);

  bridge.saveQueue(queue, storage);
  assert.equal(JSON.parse(storage.getItem('oslerAnkiBridge.queue.v1')).length, 2);

  bridge.clearQueue(storage);
  assert.equal(storage.getItem('oslerAnkiBridge.queue.v1'), null);
});

test('builds an Anki-compatible TSV with HTML, tags and deck columns', () => {
  const tsv = bridge.buildAnkiTsv([sampleCard()], noDom);

  assert.ok(tsv.startsWith('\uFEFF#separator:Tab'));
  assert.match(tsv, /#html:true/);
  assert.match(tsv, /#columns:Frente\tVerso\tTags\tBaralho/);
  assert.match(tsv, /#tags column:3/);
  assert.match(tsv, /#deck column:4/);
  assert.match(tsv, /display:none/);
  assert.match(tsv, /osler:abc123/);
  assert.match(tsv, /<strong>resposta<\/strong>/);
  assert.match(tsv, /\[Imagem disponível na Osler\]/);
  assert.match(tsv, /"Osler"/);
  assert.doesNotMatch(tsv, /token=secret/);
});

test('escapes tabs, quotes and line breaks in TSV fields', () => {
  assert.equal(bridge.tsvField('a\tb\n"c"'), '"a b<br>""c"""');
});

test('creates an Android-friendly export filename', () => {
  const date = new Date(2026, 6, 15, 7, 5);
  assert.equal(bridge.exportFilename(date), 'osler-anki-2026-07-15-0705.tsv');
});

test('detects Errei and Difícil even when intervals are concatenated', () => {
  assert.equal(bridge.triggerForButton({ textContent: 'Errei7 dias' }), 'botão Errei');
  assert.equal(bridge.triggerForButton({ textContent: 'DIFÍCIL12 min' }), 'botão Difícil');
  assert.equal(bridge.triggerForButton({ textContent: 'Acertei4 dias' }), null);
});

test('falls back to Osler SRS button order when labels are unreadable', () => {
  let wrong;
  let hard;
  let correct;
  const group = {
    querySelectorAll() { return [wrong, hard, correct]; },
  };

  function button() {
    const node = {
      className: 'SRSButton-randomHash',
      textContent: '',
      innerText: '',
      closest(selector) {
        if (selector === 'button,[role="button"]') return node;
        if (selector === '[class*="ButtonsContainer"]') return group;
        if (selector === '[class*="MetacognitionContainer"]') return group;
        return null;
      },
    };
    return node;
  }

  wrong = button();
  hard = button();
  correct = button();

  assert.equal(bridge.triggerFromOslerStructure(wrong), 'botão Errei');
  assert.equal(bridge.triggerFromOslerStructure(hard), 'botão Difícil');
  assert.equal(bridge.triggerFromOslerStructure(correct), null);
});

test('userscript exposes Phase 2 without external network calls', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  const executable = source.split('// ==/UserScript==')[1] || '';

  assert.match(source, /@version\s+0\.4\.0/);
  assert.match(source, /Enviar ao AnkiDroid/);
  assert.match(source, /oslerAnkiBridge\.queue\.v1/);
  assert.match(source, /text\/tab-separated-values/);
  assert.doesNotMatch(executable, /\bfetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest/);
});

test('source and GitHub Pages userscripts are identical', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  const published = fs.readFileSync(path.join(__dirname, '../docs/osler-anki-bridge.user.js'), 'utf8');
  assert.equal(source, published);
});

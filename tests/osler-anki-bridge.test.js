const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bridge = require('../userscript/osler-anki-bridge.user.js');
const { parseDocument } = require('./helpers/mini-dom.js');

const HEADER = `
  <header class="QuietHead-sc-a">
    <div class="QuietTop-sc-b">
      <p class="QuietLine-sc-c">Clínica Médica<span aria-hidden="true" class="QuietPathSep-sc-d"> › </span>Cardiologia<span aria-hidden="true" class="QuietPathSep-sc-d"> › </span>
        <span class="QuietDeck-sc-e">Síncope</span>
      </p>
    </div>
  </header>`;

function article(body) {
  return `<article class="Article-sc-a">${HEADER}<div class="Body-sc-b">${body}</div></article>`;
}

const CLOZE_CARD = article(`
  <div class="FlashcardContentContainer-sc-a">
    <div class="ContentText-sc-b">
      <div data-highlightable="true" class="ContentContainer-sc-c">
        <p><strong>Clínica Médica.</strong> <span class="cloze-answer">Síncope</span> é uma síndrome clínica caracterizada por perda transitória da consciência.<span class="osler-wm" aria-hidden="true" data-wm="ruido">&#8203;&#8204;</span></p>&#8203;&#8204;
        <div class="osler-card-explanation"><p><em>Resulta de uma hipoperfusão cerebral global.</em></p></div>
      </div>
    </div>
    <div class="ReferenceText-sc-d flashcard-reference"><p><em>UpToDate</em></p></div>
  </div>`);

const QA_CARD = article(`
  <div class="FlashcardContentContainer-sc-a">
    <div class="ContentText-sc-b">
      <div data-highlightable="true" class="ContentContainer-sc-c">
        <p><strong>Síncope.</strong> É sinônimo de <u>perda transitória da consciência</u>?</p>
      </div>
    </div>
    <div class="AnswerSection-sc-e">
      <div class="AnswerText-sc-f">
        <div data-highlightable="true" class="ContentContainer-sc-g">
          <p><strong>Não.</strong></p>
          <div class="osler-card-explanation"><p><em>A síncope é apenas uma das muitas causas de perda transitória da consciência.</em></p></div>
        </div>
      </div>
    </div>
    <div class="ReferenceText-sc-d flashcard-reference"><p><em>UpToDate</em></p></div>
  </div>`);

const MULTI_CLOZE_CARD = article(`
  <div class="FlashcardContentContainer-sc-a">
    <div class="ContentText-sc-b">
      <div data-highlightable="true" class="ContentContainer-sc-c">
        <p><strong>Síncope.</strong> Apresenta um pico bimodal, sendo mais comum em:</p>
        <ul>
          <li><span class="cloze-answer">Adultos jovens</span>, e</li>
          <li>Idosos.</li>
        </ul>
        <div class="osler-card-explanation">
          <p><em>O primeiro pico ocorre em adultos jovens.</em></p>
          <div class="image-wrapper"><img src="/api/images/incidencia.png?token=secret&amp;w=1200" alt="incidencia" class="content-image"></div>
        </div>
      </div>
    </div>
    <div class="ReferenceText-sc-d flashcard-reference"><p><em>UpToDate</em></p></div>
  </div>`);

const IMAGE_ONLY_CARD = article(`
  <div class="FlashcardContentContainer-sc-a">
    <div class="ContentText-sc-b">
      <div data-highlightable="true" class="ContentContainer-sc-c">
        <p><strong>Síncope.</strong> Paciente com perda de consciência e tônus postural.</p>
        <p>A primeira conduta é avaliar <span class="cloze-answer">pulso</span> e <span class="cloze-answer">respiração</span>.</p>
        <div class="image-wrapper"><img src="/api/images/algoritmo.png" alt="algoritmo" class="content-image"></div>
      </div>
    </div>
  </div>`);

function makePage(extra = '') {
  return parseDocument(`<!doctype html>
    <html>
      <head></head>
      <body>
        <div class="StickyHeader"><span class="ProgressText-sc-a">Mostrando 50 de 50</span></div>
        <div class="ConsultContent-sc-a">
          <div class="TestsColumn-sc-b">
            ${CLOZE_CARD}
            ${QA_CARD}
            ${MULTI_CLOZE_CARD}
            ${IMAGE_ONLY_CARD}
            ${extra}
          </div>
        </div>
      </body>
    </html>`);
}

function setup() {
  global.location = { href: 'https://oslermedicina.com.br/consulta/sincope' };
  bridge.resetCaptures();
}

test('extrai um card por article, inclusive os que têm pergunta e resposta separadas', () => {
  setup();
  const doc = makePage();
  const cards = bridge.extractCardsFromDocument(doc);

  assert.equal(cards.length, 4);
  assert.deepEqual(cards[0].deckPath, ['Clínica Médica', 'Cardiologia', 'Síncope']);
  assert.equal(cards[0].deckName, 'Osler::Clínica Médica::Cardiologia::Síncope');
  assert.equal(cards[0].topic.text, 'Síncope');
  assert.deepEqual(cards[0].tags, ['osler', 'Clínica_Médica', 'Cardiologia', 'Síncope']);
});

test('card cloze: frente com placeholder, cloze pronto e resposta revelada', () => {
  setup();
  const [card] = bridge.extractCardsFromDocument(makePage());

  assert.equal(card.type, 'cloze');
  assert.equal(card.question.text, 'Clínica Médica. [...] é uma síndrome clínica caracterizada por perda transitória da consciência.');
  assert.equal(card.question.clozeHtml, '<p><strong>Clínica Médica.</strong> {{c1::Síncope}} é uma síndrome clínica caracterizada por perda transitória da consciência.</p>');
  assert.equal(card.question.revealedText, 'Clínica Médica. Síncope é uma síndrome clínica caracterizada por perda transitória da consciência.');
  assert.equal(card.answer.text, 'Síncope');
  assert.match(card.explanation.html, /hipoperfusão cerebral global/);
  assert.match(card.backHtml, /<strong>Síncope<\/strong>/);
});

test('card de pergunta/resposta usa a pergunta do topo e não a resposta como frente', () => {
  setup();
  const cards = bridge.extractCardsFromDocument(makePage());
  const qa = cards[1];

  assert.equal(qa.type, 'basic');
  assert.equal(qa.question.text, 'Síncope. É sinônimo de perda transitória da consciência?');
  assert.equal(qa.answer.text, 'Não.');
  assert.equal(qa.answer.source, 'answer-section');
  assert.match(qa.explanation.text, /muitas causas/);
  assert.doesNotMatch(qa.question.html, /<strong>Não\.<\/strong>/);
});

test('card com cloze em lista e imagem na explicação', () => {
  setup();
  const cards = bridge.extractCardsFromDocument(makePage());
  const multi = cards[2];

  assert.equal(multi.type, 'cloze');
  assert.match(multi.question.revealedText, /Adultos jovens/);
  assert.equal(multi.question.html.includes('{{c1::'), false);
  assert.match(multi.question.clozeHtml, /\{\{c1::Adultos jovens\}\}/);
  assert.match(multi.question.html, /\[\.\.\.\]/);
  assert.match(multi.explanation.html, /<img src="https:\/\/oslermedicina\.com\.br\/api\/images\/incidencia\.png\?token=secret&amp;w=1200"/);
});

test('card só com imagem: imagem vai para o extra, não para a frente', () => {
  setup();
  const cards = bridge.extractCardsFromDocument(makePage());
  const imageOnly = cards[3];

  assert.equal(imageOnly.type, 'cloze');
  assert.doesNotMatch(imageOnly.question.html, /<img/);
  assert.match(imageOnly.extraHtml, /<img src="https:\/\/oslermedicina\.com\.br\/api\/images\/algoritmo\.png"/);
  assert.match(imageOnly.question.clozeHtml, /\{\{c1::pulso\}\}/);
  assert.match(imageOnly.question.clozeHtml, /\{\{c2::respiração\}\}/);
});

test('remove marcas d\'água e caracteres de largura zero', () => {
  setup();
  const [card] = bridge.extractCardsFromDocument(makePage());

  assert.doesNotMatch(card.question.text, /[\u200B-\u200D\uFEFF]/);
  assert.doesNotMatch(card.question.html, /osler-wm/);
  assert.doesNotMatch(card.question.html, /data-wm/);
  assert.doesNotMatch(card.explanation.html, /ruido/);
});

test('mantém o token da imagem no TSV e remove no JSON de diagnóstico', () => {
  setup();
  global.document = makePage();
  bridge.capturePage(global.document);

  const tsv = bridge.buildBasicTsv();
  assert.match(tsv, /token=secret/);

  const json = bridge.panelJson();
  assert.doesNotMatch(json, /token=/);
  assert.doesNotMatch(json, /secret/);
});

test('gera TSV básico com cabeçalho do Anki e uma linha por card', () => {
  setup();
  bridge.capturePage(makePage());
  const tsv = bridge.buildBasicTsv();
  const lines = tsv.trimEnd().split('\n');

  assert.equal(lines[0], '#separator:Tab');
  assert.equal(lines[1], '#html:true');
  assert.equal(lines[2], '#notetype:Basic');
  assert.equal(lines[3], '#tags column:3');
  assert.equal(lines[4], '#deck column:4');
  assert.equal(lines.length, 9);
  lines.slice(5).forEach((line) => {
    const columns = line.split('\t');
    assert.equal(columns.length, 4);
    assert.match(columns[2], /^osler /);
    assert.equal(columns[3], 'Osler::Clínica Médica::Cardiologia::Síncope');
  });
});

test('gera TSV cloze somente com cards cloze', () => {
  setup();
  bridge.capturePage(makePage());
  const tsv = bridge.buildClozeTsv();
  const lines = tsv.trimEnd().split('\n');

  assert.equal(lines[2], '#notetype:Cloze');
  assert.equal(lines.length, 8);
  lines.slice(5).forEach((line) => assert.match(line, /\{\{c\d::/));
});

test('capturar de novo substitui a captura anterior em vez de acumular lixo', () => {
  setup();
  const doc = makePage();
  assert.equal(bridge.capturePage(doc), 4);
  assert.equal(bridge.capturePage(doc), 4);
  assert.equal(bridge.getCapturedCards().length, 4);
});

test('loadAllCards rola a lista até carregar todos os cards', async () => {
  setup();
  const doc = parseDocument(`<!doctype html>
    <html><head></head><body>
      <span class="ProgressText-sc-a">Mostrando 3 de 3</span>
      <div id="main-content-scroll" class="MainContent-sc-a">
        <div class="TestsColumn-sc-b">${CLOZE_CARD}</div>
      </div>
    </body></html>`);

  const scroller = doc.getElementById('main-content-scroll');
  scroller.scrollHeight = 5000;
  scroller.clientHeight = 800;
  const pending = [QA_CARD, MULTI_CLOZE_CARD];
  Object.defineProperty(scroller, 'scrollTop', {
    get() { return 0; },
    set() {
      if (!pending.length) return;
      const holder = doc.createElement('div');
      holder.innerHTML = pending.shift();
      while (holder.children.length) doc.body.appendChild(holder.children[0]);
    },
  });

  const result = await bridge.loadAllCards({
    documentRef: doc,
    wait: async () => {},
    maxMs: 5000,
    quietRounds: 2,
  });

  assert.equal(result.captured, 3);
  assert.equal(result.total, 3);
});

test('cabeçalho do userscript aponta para o Osler e traz versão 0.4.0', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  assert.match(source, /@version\s+0\.4\.0/);
  assert.match(source, /@match\s+https:\/\/oslermedicina\.com\.br\/\*/);
  assert.match(source, /@match\s+https:\/\/\*\.oslermedicina\.com\.br\/\*/);
  assert.match(source, /@updateURL\s+https:\/\/leonardolealluz183-bit\.github\.io\/osler-anki-bridge\/osler-anki-bridge\.user\.js/);
  assert.doesNotMatch(source, /localhost/);
});

test('fonte não contém rede, AnkiDroid, Android Intent ou envio externo', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  const executable = source.split('// ==/UserScript==')[1] || '';
  assert.doesNotMatch(executable, /\bfetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest|android intent|ankidroid/i);
});

test('userscript publicado no GitHub Pages é idêntico ao da fonte', () => {
  const source = fs.readFileSync(path.join(__dirname, '../userscript/osler-anki-bridge.user.js'), 'utf8');
  const published = fs.readFileSync(path.join(__dirname, '../docs/osler-anki-bridge.user.js'), 'utf8');
  assert.equal(source, published);
});

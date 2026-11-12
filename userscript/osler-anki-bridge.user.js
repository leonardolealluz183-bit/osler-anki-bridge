// ==UserScript==
// @name         Osler -> Anki Bridge
// @namespace    https://github.com/osler-anki-bridge/osler-anki-bridge
// @version      0.4.0
// @description  Captura todos os flashcards da pagina de consulta do Osler e exporta TSV pronto para o Anki. Sem rede e sem envio externo.
// @match        https://oslermedicina.com.br/*
// @match        https://*.oslermedicina.com.br/*
// @updateURL    https://leonardolealluz183-bit.github.io/osler-anki-bridge/osler-anki-bridge.user.js
// @downloadURL  https://leonardolealluz183-bit.github.io/osler-anki-bridge/osler-anki-bridge.user.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function bootstrap(global) {
  'use strict';

  const PANEL_ID = 'osler-anki-bridge';
  const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
  const DANGEROUS_ATTR = /^(on|srcdoc$)/i;
  const DANGEROUS_URL = /^\s*(javascript|data):/i;
  const SENSITIVE_QUERY_PARAM = /^(token|access_token|auth|authorization|signature|sig|key|jwt)$/i;
  const SAFE_ATTRS = new Set(['href', 'src', 'alt', 'colspan', 'rowspan', 'start']);
  const DROP_SELECTOR = 'script,style,iframe,object,embed,svg,canvas,button,noscript,link,.osler-wm,.osler-fm,.expand-button';
  const NOISE_SELECTOR = '.osler-card-explanation,.flashcard-reference,button,.expand-button,.osler-wm,.osler-fm';

  let capturedCards = [];
  let panelRefs = null;
  let panelKeeperInstalled = false;
  let lastStatus = '';

  function now() {
    return new Date().toISOString();
  }

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function cleanText(value) {
    return normalizeWhitespace(String(value || '').replace(ZERO_WIDTH, ''));
  }

  function cssEscape(value) {
    if (global.CSS?.escape) return global.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function scrubSensitiveUrl(value) {
    const original = String(value || '').trim();
    if (!original || DANGEROUS_URL.test(original)) return '';

    try {
      const base = global.location?.href || 'https://oslermedicina.com.br';
      const parsed = new URL(original, base);
      Array.from(parsed.searchParams.keys()).forEach((key) => {
        if (SENSITIVE_QUERY_PARAM.test(key)) parsed.searchParams.delete(key);
      });
      const isRelative = !/^[a-z][a-z0-9+.-]*:/i.test(original) && !original.startsWith('//');
      return isRelative
        ? `${parsed.pathname}${parsed.search}${parsed.hash}`
        : parsed.toString();
    } catch (_error) {
      return original
        .replace(/([?&])(token|access_token|auth|authorization|signature|sig|key|jwt)=[^&"'\s>]*/gi, '$1')
        .replace(/[?&]+$/g, '');
    }
  }

  function absolutizeUrl(value) {
    const original = String(value || '').trim();
    if (!original || DANGEROUS_URL.test(original)) return '';
    try {
      return new URL(original, global.location?.href || 'https://oslermedicina.com.br').href;
    } catch (_error) {
      return original;
    }
  }

  function finalizeHtml(html) {
    return String(html || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim();
  }

  function fallbackSanitize(html, { scrubUrls = false } = {}) {
    return finalizeHtml(String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/\s+on[a-z]+=(("[^"]*")|('[^']*')|[^\s>]+)/gi, '')
      .replace(/\s+(?:class|data-[\w-]+|aria-[\w-]+|id|style)=("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s+(href|src|xlink:href|formaction)=("?)\s*(javascript|data):[^\s>]*\2/gi, '')
      .replace(scrubUrls ? /([?&])(token|access_token|auth|authorization|signature|sig|key|jwt)=[^&"'\s>]*/gi : /$^/g, '$1')
      .replace(scrubUrls ? /[?&]+(?=["'\s>])/g : /$^/g, ''));
  }

  function sanitizeHtml(html, documentRef = global.document, options = {}) {
    const { scrubUrls = false, absolutize = false } = options;
    const raw = String(html || '');
    const template = documentRef?.createElement?.('template');
    if (!template || !template.content?.querySelectorAll) return fallbackSanitize(raw, { scrubUrls });

    template.innerHTML = raw;
    template.content.querySelectorAll(DROP_SELECTOR).forEach((node) => node.remove());
    template.content.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes || []).forEach((attr) => {
        const name = String(attr.name || '').toLowerCase();
        if (!SAFE_ATTRS.has(name) || DANGEROUS_ATTR.test(name)) {
          node.removeAttribute(attr.name);
          return;
        }
        if (name !== 'href' && name !== 'src') return;
        let value = attr.value;
        if (absolutize) value = absolutizeUrl(value);
        if (scrubUrls) value = scrubSensitiveUrl(value);
        if (!value) node.removeAttribute(attr.name);
        else node.setAttribute(attr.name, value);
      });
    });
    return finalizeHtml(template.innerHTML);
  }

  function stripTopicPunctuation(value) {
    return normalizeWhitespace(value).replace(/[\s.:;,!?–—-]+$/u, '');
  }

  function stableHash(input) {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function buildStableId(card) {
    return stableHash([
      card.deck?.text || '',
      card.question?.text || '',
      card.answer?.text || '',
      card.explanation?.text || '',
    ].join('\n---\n'));
  }

  function directChildContaining(root, node) {
    let current = node;
    while (current && current.parentNode && current.parentNode !== root) {
      current = current.parentNode;
    }
    return current && current.parentNode === root ? current : null;
  }

  function replaceClozes(root, makeToken) {
    const nodes = Array.from(root?.querySelectorAll?.('.cloze-answer') || []);
    nodes.forEach((node, index) => {
      const token = makeToken(index, cleanText(node.textContent));
      const documentRef = node.ownerDocument || global.document;
      const textNode = documentRef?.createTextNode?.(token);
      if (textNode && typeof node.replaceWith === 'function') {
        node.replaceWith(textNode);
      } else {
        node.textContent = token;
      }
    });
    return nodes.length;
  }

  function splitAfterLastCloze(root) {
    const clozes = Array.from(root?.querySelectorAll?.('.cloze-answer') || []);
    if (!clozes.length) return '';
    const direct = directChildContaining(root, clozes[clozes.length - 1]);
    if (!direct) return '';

    const tail = root.cloneNode(false);
    let node = direct.nextSibling;
    while (node) {
      const next = node.nextSibling;
      tail.appendChild(node);
      node = next;
    }
    return tail.innerHTML;
  }

  function removeNoise(root) {
    Array.from(root?.querySelectorAll?.(NOISE_SELECTOR) || []).forEach((node) => node.remove());
    return root;
  }

  function isVisible(element) {
    if (typeof element?.getClientRects === 'function') {
      return element.getClientRects().length > 0;
    }
    return true;
  }

  function collectArticleElements(documentRef = global.document) {
    const all = Array.from(documentRef?.querySelectorAll?.('article') || []);
    return all.filter((article) => {
      if (!article?.querySelector) return false;
      const hasContent = article.querySelector('[class*="ContentContainer"], [data-highlightable]');
      if (!hasContent) return false;
      return isVisible(article);
    });
  }

  function readDeckPath(article) {
    const line = article?.querySelector?.('[class*="QuietLine"]');
    const text = cleanText(line?.textContent);
    if (text) {
      return text.split('›').map((part) => normalizeWhitespace(part)).filter(Boolean);
    }
    const deck = cleanText(article?.querySelector?.('[class*="QuietDeck"]')?.textContent);
    return deck ? [deck] : [];
  }

  function toTagPart(value) {
    return cleanText(value)
      .replace(/\s+/g, '_')
      .replace(/[^\p{L}\p{N}_-]/gu, '');
  }

  function extractArticle(article, documentRef = global.document) {
    const questionRoot = article?.querySelector?.('[class*="ContentText"] [class*="ContentContainer"]')
      || article?.querySelector?.('[data-highlightable]');
    if (!questionRoot) return null;

    const answerRoot = article.querySelector('[class*="AnswerSection"] [class*="ContentContainer"]');
    const explanationElements = Array.from(article.querySelectorAll('.osler-card-explanation'));
    const referenceElement = article.querySelector('.flashcard-reference');

    const questionClone = removeNoise(questionRoot.cloneNode(true));
    const clozeElements = Array.from(questionClone.querySelectorAll('.cloze-answer'));
    const clozeTexts = clozeElements.map((element) => cleanText(element.textContent));
    const tailHtml = sanitizeHtml(splitAfterLastCloze(questionClone), documentRef, { absolutize: true });

    const placeholderClone = questionClone.cloneNode(true);
    replaceClozes(placeholderClone, () => '[...]');

    const clozeClone = questionClone.cloneNode(true);
    replaceClozes(clozeClone, (index, text) => `{{c${index + 1}::${text}}}`);

    const questionHtml = sanitizeHtml(placeholderClone.innerHTML, documentRef, { absolutize: true });
    const questionClozeHtml = sanitizeHtml(clozeClone.innerHTML, documentRef, { absolutize: true });
    const revealedHtml = sanitizeHtml(questionClone.innerHTML, documentRef, { absolutize: true });
    const questionText = cleanText(placeholderClone.textContent);
    const revealedText = cleanText(questionClone.textContent);

    if (!questionText) return null;

    let answerHtml = '';
    let answerText = '';
    if (answerRoot) {
      const answerClone = removeNoise(answerRoot.cloneNode(true));
      answerHtml = sanitizeHtml(answerClone.innerHTML, documentRef, { absolutize: true });
      answerText = cleanText(answerClone.textContent);
    }
    if (!answerText && clozeTexts.length) {
      answerText = clozeTexts.join('; ');
      answerHtml = clozeTexts.map((text) => `<strong>${text}</strong>`).join(' · ');
    }

    const explanationHtml = sanitizeHtml(
      explanationElements.map((element) => element.innerHTML).join('\n'),
      documentRef,
      { absolutize: true },
    );
    const explanationText = cleanText(explanationElements.map((element) => element.textContent).join('\n'));

    const referenceHtml = referenceElement
      ? sanitizeHtml(referenceElement.innerHTML, documentRef, { absolutize: true })
      : '';
    const referenceText = referenceElement ? cleanText(referenceElement.textContent) : '';

    const deckPath = readDeckPath(article);
    const deckName = ['Osler', ...deckPath].join('::');
    const topic = stripTopicPunctuation(deckPath[deckPath.length - 1] || '');
    const type = clozeTexts.length ? 'cloze' : 'basic';

    const backParts = [answerHtml, explanationHtml, referenceHtml].filter(Boolean).join('<br><br>');
    const extraParts = [tailHtml, answerHtml && !clozeTexts.length ? answerHtml : '', explanationHtml, referenceHtml]
      .filter(Boolean)
      .join('<br><br>');

    const card = {
      id: '',
      type,
      capturedAt: now(),
      url: global.location?.href || '',
      deckPath,
      deckName,
      topic: { text: topic, html: topic },
      deck: { text: deckName, html: deckName },
      tags: ['osler', ...deckPath.map(toTagPart).filter(Boolean)],
      question: {
        text: questionText,
        html: questionHtml,
        clozeHtml: questionClozeHtml,
        revealedText,
        revealedHtml,
      },
      answer: {
        text: answerText,
        html: answerHtml,
        source: clozeTexts.length ? 'cloze' : answerRoot ? 'answer-section' : 'none',
        items: clozeTexts,
      },
      explanation: { text: explanationText, html: explanationHtml },
      reference: { text: referenceText, html: referenceHtml },
      tailHtml,
      backHtml: backParts,
      extraHtml: extraParts,
    };
    card.id = buildStableId(card);
    return card;
  }

  function extractCardsFromDocument(documentRef = global.document) {
    return collectArticleElements(documentRef)
      .map((article) => extractArticle(article, documentRef))
      .filter(Boolean);
  }

  function captureFromDocument(documentRef = global.document) {
    const cards = extractCardsFromDocument(documentRef);
    const known = new Set(capturedCards.map((card) => card.id));
    let added = 0;
    cards.forEach((card) => {
      if (known.has(card.id)) return;
      known.add(card.id);
      capturedCards.push(card);
      added += 1;
    });
    return added;
  }

  function capturePage(documentRef = global.document) {
    capturedCards = [];
    const added = captureFromDocument(documentRef);
    renderPanel();
    return added;
  }

  function resetCaptures() {
    capturedCards = [];
  }

  function getCapturedCards() {
    return capturedCards;
  }

  function readTotal(documentRef = global.document) {
    const element = documentRef?.querySelector?.('[class*="ProgressText"]');
    const text = cleanText(element?.textContent);
    const match = text.match(/(\d+)\s*$/);
    return match ? Number(match[1]) : 0;
  }

  function findScroller(documentRef = global.document) {
    const candidates = [
      documentRef?.querySelector?.('#main-content-scroll'),
      documentRef?.querySelector?.('[class*="ConsultContent"]'),
      documentRef?.querySelector?.('[class*="MainContent"]'),
    ].filter(Boolean);
    for (const element of candidates) {
      if (Number(element.scrollHeight) > Number(element.clientHeight) + 20) return element;
    }
    return documentRef?.scrollingElement || documentRef?.documentElement || null;
  }

  function scrollForward(documentRef = global.document) {
    const scroller = findScroller(documentRef);
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    const view = documentRef?.defaultView;
    if (view && typeof view.scrollTo === 'function') {
      try {
        view.scrollTo(0, documentRef.body?.scrollHeight || 0);
      } catch (_error) {
        /* ignore */
      }
    }
    const endButton = documentRef?.querySelector?.('button[title="Ir para o final"]')
      || documentRef?.querySelector?.('button[aria-label="Ir para o final"]');
    endButton?.click?.();
  }

  function defaultWait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function loadAllCards(options = {}) {
    const documentRef = options.documentRef || global.document;
    const wait = options.wait || defaultWait;
    const maxMs = options.maxMs ?? 45000;
    const quietRounds = options.quietRounds ?? 4;

    capturedCards = [];
    const total = readTotal(documentRef);
    let lastCount = -1;
    let stable = 0;
    const deadline = Date.now() + maxMs;

    while (Date.now() < deadline) {
      captureFromDocument(documentRef);
      setStatus(`Carregando... ${capturedCards.length}${total ? ` de ${total}` : ''} card(s)`);
      if (total && capturedCards.length >= total) break;
      scrollForward(documentRef);
      await wait(400);
      const count = capturedCards.length;
      if (count === lastCount) stable += 1;
      else {
        stable = 0;
        lastCount = count;
      }
      if (stable >= quietRounds) break;
    }

    captureFromDocument(documentRef);
    renderPanel();
    return {
      captured: capturedCards.length,
      total,
    };
  }

  function toField(html) {
    return String(html || '')
      .replace(/\r?\n/g, '')
      .replace(/\t/g, ' ')
      .trim();
  }

  function tsvHeader(noteType) {
    return [
      '#separator:Tab',
      '#html:true',
      `#notetype:${noteType}`,
      '#tags column:3',
      '#deck column:4',
    ].join('\n');
  }

  function buildBasicTsv(cards = capturedCards) {
    if (!cards.length) return '';
    const rows = cards.map((card) => [
      toField(card.question.html),
      toField(card.backHtml),
      card.tags.join(' '),
      card.deckName,
    ].join('\t'));
    return `${tsvHeader('Basic')}\n${rows.join('\n')}\n`;
  }

  function buildClozeTsv(cards = capturedCards) {
    const clozeCards = cards.filter((card) => card.type === 'cloze');
    if (!clozeCards.length) return '';
    const rows = clozeCards.map((card) => [
      toField(card.question.clozeHtml),
      toField(card.extraHtml),
      card.tags.join(' '),
      card.deckName,
    ].join('\t'));
    return `${tsvHeader('Cloze')}\n${rows.join('\n')}\n`;
  }

  function slugify(value) {
    return cleanText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'osler';
  }

  function suggestFileName(cards = capturedCards) {
    const deck = cards[0]?.deckPath?.[cards[0].deckPath.length - 1] || 'osler';
    return `osler-${slugify(deck)}`;
  }

  function panelJson() {
    const cards = capturedCards.map((card) => {
      const copy = { ...card, tags: [...card.tags], deckPath: [...card.deckPath] };
      ['question', 'answer', 'explanation', 'reference'].forEach((field) => {
        if (!copy[field]?.html) return;
        copy[field] = {
          ...copy[field],
          html: sanitizeHtml(copy[field].html, global.document, { scrubUrls: true }),
        };
      });
      ['backHtml', 'extraHtml', 'tailHtml'].forEach((field) => {
        if (copy[field]) copy[field] = sanitizeHtml(copy[field], global.document, { scrubUrls: true });
      });
      return copy;
    });
    return JSON.stringify({
      version: '0.4.0',
      url: global.location?.href || '',
      total: cards.length,
      cards,
    }, null, 2);
  }

  function copyText(text) {
    if (global.navigator?.clipboard?.writeText) return global.navigator.clipboard.writeText(text);
    const textarea = global.document.createElement('textarea');
    textarea.value = text;
    global.document.body.appendChild(textarea);
    textarea.select();
    global.document.execCommand('copy');
    textarea.remove();
    return Promise.resolve();
  }

  function downloadText(filename, text, mime = 'text/tab-separated-values;charset=utf-8') {
    const documentRef = global.document;
    const blob = new global.Blob([text], { type: mime });
    const url = global.URL.createObjectURL(blob);
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    documentRef.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => global.URL.revokeObjectURL(url), 1000);
  }

  function setStatus(text) {
    lastStatus = text;
    if (panelRefs?.status) panelRefs.status.textContent = text;
  }

  function renderPanel() {
    if (!panelRefs) return;
    const pageCount = Number(global.document?.querySelectorAll?.('article')?.length || 0);
    const total = readTotal(global.document);
    const clozeCount = capturedCards.filter((card) => card.type === 'cloze').length;
    const basicCount = capturedCards.length - clozeCount;
    const totalHint = total && capturedCards.length < total ? ` (a pagina mostra ${total}; use "Carregar tudo")` : '';

    panelRefs.badge.textContent = String(capturedCards.length);
    setStatus(`${capturedCards.length} capturado(s) · ${clozeCount} cloze · ${basicCount} basico · ${pageCount} artigo(s) no DOM${totalHint}`);

    if (panelRefs.list) {
      panelRefs.list.textContent = '';
      capturedCards.slice(0, 300).forEach((card) => {
        const item = global.document.createElement('li');
        item.textContent = `${card.type === 'cloze' ? '[cloze]' : '[basico]'} ${card.question.text.slice(0, 110)}`;
        panelRefs.list.appendChild(item);
      });
      if (capturedCards.length > 300) {
        const item = global.document.createElement('li');
        item.textContent = `... e mais ${capturedCards.length - 300}`;
        panelRefs.list.appendChild(item);
      }
    }
    if (panelRefs.output) panelRefs.output.textContent = lastStatus;
  }

  function buttonStyle(element) {
    element.style.cssText = 'appearance:none;border:1px solid #3b4459;background:#232a3a;color:#e9edf7;border-radius:8px;padding:6px 9px;font:12px system-ui,sans-serif;cursor:pointer';
    return element;
  }

  function makeButton(documentRef, label, action) {
    const button = buttonStyle(documentRef.createElement('button'));
    button.type = 'button';
    button.textContent = label;
    button.dataset.action = action;
    return button;
  }

  function createPanel(documentRef = global.document) {
    const root = documentRef.createElement('section');
    root.id = PANEL_ID;
    root.innerHTML = `
      <details open>
        <summary style="cursor:pointer;font:600 13px system-ui,sans-serif">
          Osler -> Anki <span data-role="badge" style="background:#2f6feb;color:#fff;border-radius:999px;padding:0 7px;font-size:11px">0</span>
        </summary>
        <p data-role="status" style="margin:8px 0;font-size:11px;line-height:1.4;color:#c7ceda"></p>
        <div data-role="actions" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px"></div>
        <p data-role="output" style="margin:0;font:11px ui-monospace,monospace;color:#9fb0c7;word-break:break-word"></p>
        <details style="margin-top:8px">
          <summary style="cursor:pointer;font-size:11px;color:#c7ceda">Cards capturados</summary>
          <ol data-role="list" style="margin:6px 0 0 16px;padding:0;font-size:11px;line-height:1.45;max-height:220px;overflow:auto"></ol>
        </details>
      </details>
    `;
    root.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;width:min(380px,calc(100vw - 24px));max-height:72vh;overflow:auto;background:#161b26;color:#e9edf7;border:1px solid #3b4459;border-radius:12px;padding:10px 12px;box-shadow:0 8px 28px rgba(0,0,0,.45);font:12px system-ui,sans-serif';

    const actions = root.querySelector('[data-role="actions"]');
    const primary = makeButton(documentRef, 'Carregar tudo e capturar', 'load-all');
    primary.style.background = '#2f6feb';
    primary.style.borderColor = '#2f6feb';
    actions.appendChild(primary);
    actions.appendChild(makeButton(documentRef, 'Capturar so a tela', 'capture'));
    actions.appendChild(makeButton(documentRef, 'Copiar TSV basico', 'copy-basic'));
    actions.appendChild(makeButton(documentRef, 'Copiar TSV cloze', 'copy-cloze'));
    actions.appendChild(makeButton(documentRef, 'Baixar TSV basico', 'download-basic'));
    actions.appendChild(makeButton(documentRef, 'Baixar TSV cloze', 'download-cloze'));
    actions.appendChild(makeButton(documentRef, 'Baixar JSON', 'download-json'));
    actions.appendChild(makeButton(documentRef, 'Limpar', 'clear'));

    actions.addEventListener('click', async (event) => {
      const action = event.target?.closest?.('button')?.dataset?.action;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();

      if (action === 'load-all') {
        setStatus('Carregando todos os cards...');
        const result = await loadAllCards();
        setStatus(`Pronto: ${result.captured}${result.total ? ` de ${result.total}` : ''} card(s)`);
        return;
      }
      if (action === 'capture') {
        const added = capturePage();
        setStatus(`${added} card(s) capturado(s) na tela atual`);
        return;
      }
      if (action === 'copy-basic') {
        const tsv = buildBasicTsv();
        if (!tsv) return setStatus('Nada capturado ainda');
        await copyText(tsv);
        return setStatus(`${capturedCards.length} card(s) copiados (basico)`);
      }
      if (action === 'copy-cloze') {
        const tsv = buildClozeTsv();
        if (!tsv) return setStatus('Nenhum card cloze capturado');
        await copyText(tsv);
        return setStatus(`${tsv.split('\n').length - 6} card(s) cloze copiados`);
      }
      if (action === 'download-basic') {
        const tsv = buildBasicTsv();
        if (!tsv) return setStatus('Nada capturado ainda');
        downloadText(`${suggestFileName()}-basico.tsv`, tsv);
        return setStatus('TSV basico baixado');
      }
      if (action === 'download-cloze') {
        const tsv = buildClozeTsv();
        if (!tsv) return setStatus('Nenhum card cloze capturado');
        downloadText(`${suggestFileName()}-cloze.tsv`, tsv);
        return setStatus('TSV cloze baixado');
      }
      if (action === 'download-json') {
        downloadText(`${suggestFileName()}.json`, panelJson(), 'application/json;charset=utf-8');
        return setStatus('JSON baixado');
      }
      if (action === 'clear') {
        capturedCards = [];
        renderPanel();
        return setStatus('Capturas limpas');
      }
      return null;
    });

    return root;
  }

  function installPanelKeeper(documentRef = global.document) {
    if (panelKeeperInstalled || !documentRef?.body) return;
    if (typeof global.MutationObserver !== 'function') return;
    const observer = new global.MutationObserver(() => {
      if (!panelRefs?.root) return;
      if (documentRef.body.contains(panelRefs.root)) return;
      documentRef.body.appendChild(panelRefs.root);
    });
    observer.observe(documentRef.body, { childList: true });
    panelKeeperInstalled = true;
  }

  function install(documentRef = global.document) {
    if (!documentRef?.body) return null;
    if (documentRef.getElementById?.(PANEL_ID)) return null;

    const root = createPanel(documentRef);
    documentRef.body.appendChild(root);
    panelRefs = {
      root,
      badge: root.querySelector('[data-role="badge"]'),
      status: root.querySelector('[data-role="status"]'),
      output: root.querySelector('[data-role="output"]'),
      list: root.querySelector('[data-role="list"]'),
    };
    installPanelKeeper(documentRef);
    renderPanel();
    return root;
  }

  const api = {
    buildBasicTsv,
    buildClozeTsv,
    buildStableId,
    captureFromDocument,
    capturePage,
    cleanText,
    collectArticleElements,
    createPanel,
    directChildContaining,
    downloadText,
    extractArticle,
    extractCardsFromDocument,
    findScroller,
    getCapturedCards,
    install,
    isVisible,
    loadAllCards,
    normalizeWhitespace,
    panelJson,
    readDeckPath,
    readTotal,
    removeNoise,
    renderPanel,
    replaceClozes,
    resetCaptures,
    sanitizeHtml,
    scrollForward,
    scrubSensitiveUrl,
    splitAfterLastCloze,
    stableHash,
    stripTopicPunctuation,
    suggestFileName,
    toField,
  };
  global.OslerAnkiBridge = api;
  global.OslerCaptureDiagnostics = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    install();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);

// ==UserScript==
// @name         Osler Anki Bridge
// @namespace    https://github.com/osler-anki-bridge/osler-anki-bridge
// @version      0.4.3
// @description  Captura cards da Osler, mantém fila persistente e exporta TSV para o AnkiDroid.
// @match        https://oslermedicina.com.br/*
// @match        https://*.oslermedicina.com.br/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function bootstrap(global) {
  'use strict';

  const QUEUE_KEY = 'oslerAnkiBridge.queue.v1';
  const EXPORT_DECK = 'Osler';
  const PANEL_ID = 'osler-anki-bridge-v043';
  const SENSITIVE_QUERY_PARAM = /^(token|access_token|auth|authorization|signature|sig|key|jwt)$/i;
  const boundButtons = typeof WeakSet === 'function' ? new WeakSet() : new Set();

  let queue = [];
  let panel = null;
  let latestSnapshot = null;
  let lastGesture = { trigger: '', at: 0 };

  const now = () => new Date().toISOString();
  const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizeText = (value) => normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  function stableHash(input) {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function isVerdictOnly(value) {
    const text = normalizeText(value).replace(/[.!?:;,–—-]+$/g, '').trim();
    return ['sim', 'nao', 'verdadeiro', 'falso', 'correto', 'correta', 'incorreto', 'incorreta'].includes(text);
  }

  function isCitationText(value) {
    const text = normalizeText(value);
    return text.includes('uptodate')
      || text.startsWith('fonte:')
      || text.startsWith('referencia:')
      || text.startsWith('referência:')
      || /\bdoi\b/.test(text);
  }

  function scrubSensitiveUrl(value) {
    const original = String(value || '').trim();
    if (!original || /^\s*(javascript|data):/i.test(original)) return '';
    try {
      const parsed = new URL(original, global.location?.origin || 'https://oslermedicina.com.br');
      Array.from(parsed.searchParams.keys()).forEach((key) => {
        if (SENSITIVE_QUERY_PARAM.test(key)) parsed.searchParams.delete(key);
      });
      const relative = !/^[a-z][a-z0-9+.-]*:/i.test(original) && !original.startsWith('//');
      return relative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
    } catch (_error) {
      return original
        .replace(/([?&])(token|access_token|auth|authorization|signature|sig|key|jwt)=[^&"'\s>]*/gi, '$1')
        .replace(/[?&]+$/g, '');
    }
  }

  function unwrap(node) {
    const parent = node?.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    node.remove();
  }

  function sanitizeHtml(html, documentRef = global.document) {
    const template = documentRef?.createElement?.('template');
    if (!template) {
      return String(html || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\s+on[a-z]+=(("[^"]*")|('[^']*')|[^\s>]+)/gi, '')
        .replace(/<mark\b[^>]*class=("|')[^"']*\bosler-highlight\b[^"']*\1[^>]*>/gi, '')
        .replace(/<\/mark>/gi, '')
        .replace(/\s+data-(start|end)-offset=("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/([?&])(token|access_token|auth|authorization|signature|sig|key|jwt)=[^&"'\s>]*/gi, '$1')
        .trim();
    }

    template.innerHTML = html || '';
    if (!template.content?.querySelectorAll) return template.innerHTML.trim();
    template.content.querySelectorAll('script,iframe,object,embed').forEach((node) => node.remove());
    template.content.querySelectorAll('mark.osler-highlight').forEach(unwrap);
    template.content.querySelectorAll('[data-start-offset],[data-end-offset]').forEach((node) => {
      node.removeAttribute('data-start-offset');
      node.removeAttribute('data-end-offset');
    });
    template.content.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes || []).forEach((attr) => {
        if (/^(on|srcdoc$)/i.test(attr.name)) node.removeAttribute(attr.name);
        if (/^(href|src|xlink:href|formaction)$/i.test(attr.name)) {
          const safe = scrubSensitiveUrl(attr.value);
          if (safe) node.setAttribute(attr.name, safe);
          else node.removeAttribute(attr.name);
        }
      });
    });
    return template.innerHTML.trim();
  }

  function prepareHtmlForAnki(html, documentRef = global.document) {
    const clean = sanitizeHtml(html, documentRef);
    const template = documentRef?.createElement?.('template');
    if (!template) {
      return clean
        .replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, '')
        .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
        .replace(/<img\b[^>]*>/gi, '<div><em>[Imagem disponível na Osler]</em></div>');
    }

    template.innerHTML = clean;
    if (!template.content?.querySelectorAll) return clean;
    template.content.querySelectorAll('button,svg').forEach((node) => node.remove());
    template.content.querySelectorAll('img').forEach((image) => {
      const placeholder = documentRef.createElement('div');
      const alt = normalizeWhitespace(image.getAttribute?.('alt'));
      placeholder.innerHTML = `<em>[Imagem disponível na Osler${alt ? `: ${escapeHtml(alt)}` : ''}]</em>`;
      image.replaceWith(placeholder);
    });
    return template.innerHTML.trim();
  }

  function isVisible(element) {
    if (!element || element.hidden || element.closest?.(`#${PANEL_ID}`)) return false;
    if (typeof element.getClientRects === 'function' && element.getClientRects().length) return true;
    return element.offsetParent !== null;
  }

  function isBefore(first, second) {
    if (!first || !second || first === second || typeof first.compareDocumentPosition !== 'function' || !global.Node) return false;
    return Boolean(first.compareDocumentPosition(second) & global.Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function paragraphRemainder(element) {
    if (!element) return '';
    const strong = element.querySelector?.('strong');
    if (!strong) return normalizeWhitespace(element.textContent);
    const clone = element.cloneNode?.(true);
    clone?.querySelector?.('strong')?.remove?.();
    return normalizeWhitespace(clone?.textContent || String(element.textContent || '').replace(strong.textContent || '', ''));
  }

  function questionScore(element) {
    if (!isVisible(element) || String(element.tagName || '').toLowerCase() !== 'p') return -Infinity;
    if (element.closest?.('div.osler-card-explanation')) return -Infinity;
    const text = normalizeWhitespace(element.textContent);
    if (!text || isVerdictOnly(text) || isCitationText(text)) return -Infinity;
    const strong = element.querySelector?.('strong');
    const topic = normalizeWhitespace(strong?.textContent);
    const remainder = paragraphRemainder(element);
    if (!strong || !topic || isVerdictOnly(topic) || remainder.length < 3) return -Infinity;

    let score = Math.min(text.length, 180) / 20;
    score += 45;
    if (element.querySelector?.('.cloze-answer')) score += 100;
    if (/\?$/.test(text)) score += 20;
    else if (/[:.]$/.test(text)) score += 8;
    const rect = element.getBoundingClientRect?.();
    if (rect && Number.isFinite(rect.top)) score += Math.max(0, 15 - Math.abs(rect.top - (global.innerHeight || 800) / 3) / 80);
    return score;
  }

  function findQuestionElement(documentRef = global.document) {
    const candidates = Array.from(documentRef.querySelectorAll?.('p') || []);
    let best = null;
    let bestScore = -Infinity;
    candidates.forEach((candidate) => {
      const score = questionScore(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
    return best;
  }

  function visibleExplanation(documentRef = global.document) {
    const all = Array.from(documentRef.querySelectorAll?.('div.osler-card-explanation') || []);
    const visible = all.filter(isVisible);
    return (visible.length ? visible : all).at(-1) || null;
  }

  function commonAncestor(first, second) {
    if (!first) return null;
    if (!second) return first.parentElement;
    const parents = new Set();
    let current = first;
    while (current) {
      parents.add(current);
      current = current.parentElement;
    }
    current = second;
    while (current) {
      if (parents.has(current)) return current;
      current = current.parentElement;
    }
    return first.parentElement;
  }

  function answerCandidates(root, question, explanation) {
    if (!root || !question) return [];
    const candidates = Array.from(root.querySelectorAll?.('p,ul,ol,table,blockquote') || []).filter((node) => {
      if (!isVisible(node) || node === question || question.contains?.(node)) return false;
      if (explanation && (node === explanation || explanation.contains?.(node))) return false;
      if (!isBefore(question, node)) return false;
      if (explanation && !isBefore(node, explanation)) return false;
      const text = normalizeWhitespace(node.textContent);
      if (!text && !node.querySelector?.('img')) return false;
      if (isCitationText(text)) return false;
      if (/^(anterior|proximo|próximo|salvar|enterrar|feedback|estatisticas|estatísticas)$/i.test(text)) return false;
      return true;
    });
    return candidates.filter((node) => !candidates.some((other) => other !== node && other.contains?.(node)));
  }

  function chooseRoot(question, explanation) {
    if (explanation) return commonAncestor(question, explanation);
    let current = question?.parentElement;
    let fallback = current;
    for (let depth = 0; current && current !== global.document?.body && depth < 7; depth += 1) {
      fallback = current;
      if (answerCandidates(current, question, null).length) return current;
      current = current.parentElement;
    }
    return fallback;
  }

  function extractAnswer(question, explanation, root, documentRef = global.document) {
    const clozes = Array.from(question.querySelectorAll?.('.cloze-answer') || []);
    if (clozes.length) {
      const items = clozes.map((node) => ({
        text: normalizeWhitespace(node.textContent),
        html: sanitizeHtml(node.innerHTML, documentRef),
      }));
      return {
        source: 'cloze',
        items,
        text: items.map((item) => item.text).join('; '),
        html: items.map((item) => item.html).join('; '),
      };
    }

    const candidates = answerCandidates(root, question, explanation);
    if (!candidates.length) return { source: 'missing', items: [], text: '', html: '' };

    let selected = [];
    const firstList = candidates.find((node) => ['ul', 'ol', 'table'].includes(String(node.tagName || '').toLowerCase()));
    if (firstList) {
      selected = [firstList];
    } else {
      for (const node of candidates) {
        const text = normalizeWhitespace(node.textContent);
        if (isCitationText(text)) break;
        selected.push(node);
        if (selected.length >= 4) break;
      }
    }

    const items = [];
    selected.forEach((block) => {
      const listItems = Array.from(block.querySelectorAll?.('li') || []);
      (listItems.length ? listItems : [block]).forEach((node) => {
        items.push({
          text: normalizeWhitespace(node.textContent),
          html: sanitizeHtml(node.innerHTML, documentRef),
        });
      });
    });

    return {
      source: explanation ? 'intermediate-block' : 'card-body',
      items,
      text: items.map((item) => item.text).filter(Boolean).join('\n'),
      html: selected.map((node) => sanitizeHtml(node.outerHTML || node.innerHTML, documentRef)).join('\n'),
    };
  }

  function extractCard(documentRef = global.document) {
    const question = findQuestionElement(documentRef);
    const explanation = visibleExplanation(documentRef);
    if (!question) return null;

    const root = chooseRoot(question, explanation);
    const clone = question.cloneNode(true);
    Array.from(clone.querySelectorAll?.('.cloze-answer') || []).forEach((node) => {
      node.replaceWith(documentRef.createTextNode('[...]'));
    });

    const topicElement = question.querySelector('strong');
    const topic = normalizeWhitespace(topicElement?.textContent).replace(/[\s.:;,!?–—-]+$/u, '');
    const answer = extractAnswer(question, explanation, root, documentRef);
    const explanationText = explanation ? normalizeWhitespace(explanation.textContent) : '';
    const explanationHtml = explanation ? sanitizeHtml(explanation.innerHTML, documentRef) : '';

    const card = {
      id: '',
      trigger: '',
      capturedAt: now(),
      url: global.location?.href || '',
      question: {
        text: normalizeWhitespace(clone.textContent),
        html: sanitizeHtml(clone.innerHTML, documentRef),
        revealedText: normalizeWhitespace(question.textContent),
        revealedHtml: sanitizeHtml(question.innerHTML, documentRef),
      },
      answer,
      explanation: { text: explanationText, html: explanationHtml },
      topic: { text: topic, html: sanitizeHtml(topicElement?.innerHTML || escapeHtml(topic), documentRef) },
      deck: { text: topic, html: sanitizeHtml(topicElement?.innerHTML || escapeHtml(topic), documentRef) },
    };
    card.id = stableHash([card.topic.text, card.question.revealedText, card.answer.text, card.explanation.text].join('\n---\n'));
    return card;
  }

  function validateCard(card) {
    const question = normalizeWhitespace(card?.question?.text);
    const answer = normalizeWhitespace(card?.answer?.text);
    const topic = normalizeWhitespace(card?.topic?.text);
    const reasons = [];
    if (!question) reasons.push('pergunta vazia');
    if (!answer && !/<(img|li|ul|ol|table)\b/i.test(String(card?.answer?.html || ''))) reasons.push('resposta vazia');
    if (isVerdictOnly(question)) reasons.push('pergunta é só um veredito');
    if (isVerdictOnly(topic)) reasons.push('assunto é só um veredito');
    return { valid: reasons.length === 0, reasons };
  }

  function loadQueue() {
    const raw = (() => {
      try { return JSON.parse(global.localStorage?.getItem?.(QUEUE_KEY) || '[]'); }
      catch (_error) { return []; }
    })();
    const ids = new Set();
    return (Array.isArray(raw) ? raw : []).filter((card) => {
      if (!card?.id || !validateCard(card).valid || ids.has(card.id)) return false;
      ids.add(card.id);
      return true;
    });
  }

  function saveQueue() {
    global.localStorage?.setItem?.(QUEUE_KEY, JSON.stringify(queue));
    renderPanel();
  }

  function setMessage(message) {
    panel?.querySelector?.('[data-role="message"]')?.replaceChildren?.(message);
  }

  function refreshSnapshot(documentRef = global.document) {
    const card = extractCard(documentRef);
    if (card && validateCard(card).valid) latestSnapshot = { card, at: Date.now() };
  }

  function capture(trigger, documentRef = global.document) {
    let card = extractCard(documentRef);
    if ((!card || !validateCard(card).valid) && latestSnapshot && Date.now() - latestSnapshot.at < 15000) {
      card = latestSnapshot.card;
    }
    const validation = validateCard(card);
    if (!validation.valid) {
      setMessage(`Não capturado: ${validation.reasons.join(', ')}`);
      return null;
    }

    card = JSON.parse(JSON.stringify(card));
    card.trigger = trigger;
    card.capturedAt = now();
    if (queue.some((item) => item.id === card.id)) {
      setMessage('Card já estava na fila.');
      return null;
    }
    queue.push(card);
    saveQueue();
    setMessage(`Adicionado: ${card.topic.text}`);
    return card;
  }

  function triggerForButton(element) {
    const text = normalizeText([
      element?.textContent,
      element?.innerText,
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
    ].filter(Boolean).join(' '));
    if (text.includes('acertei')) return null;
    if (text.includes('errei')) return 'botão Errei';
    if (text.includes('dificil')) return 'botão Difícil';
    return null;
  }

  function triggerFromStructure(target) {
    const button = target?.closest?.('button,[role="button"]');
    const group = button?.closest?.('[class*="ButtonsContainer"]');
    if (!button || !group?.querySelectorAll) return null;
    const buttons = Array.from(group.querySelectorAll('button,[role="button"]')).filter((candidate) => {
      return String(candidate.className || '').includes('SRSButton')
        || Boolean(candidate.closest?.('[class*="MetacognitionContainer"]'));
    });
    const index = buttons.indexOf(button);
    if (index === 0) return 'botão Errei';
    if (index === 1) return 'botão Difícil';
    return null;
  }

  function ratingTrigger(target) {
    let current = target?.closest?.('button,[role="button"]') || target;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const trigger = triggerForButton(current) || triggerFromStructure(current);
      if (trigger) return trigger;
      current = current.parentElement;
    }
    return null;
  }

  function captureGesture(trigger, documentRef) {
    const timestamp = Date.now();
    if (lastGesture.trigger === trigger && timestamp - lastGesture.at < 1000) return null;
    lastGesture = { trigger, at: timestamp };
    return capture(trigger, documentRef);
  }

  function bindButtons(documentRef = global.document) {
    Array.from(documentRef.querySelectorAll?.('button,[role="button"]') || []).forEach((button) => {
      const trigger = ratingTrigger(button);
      if (!trigger || boundButtons.has(button)) return;
      boundButtons.add(button);
      const handler = () => captureGesture(trigger, documentRef);
      button.addEventListener('touchstart', handler, true);
      button.addEventListener('pointerdown', handler, true);
      button.addEventListener('click', handler, true);
    });
  }

  function installListeners(documentRef = global.document) {
    ['touchstart', 'pointerdown', 'click'].forEach((type) => {
      documentRef.addEventListener(type, (event) => {
        const path = event.composedPath?.() || [event.target];
        for (const node of path) {
          const trigger = ratingTrigger(node);
          if (trigger) {
            captureGesture(trigger, documentRef);
            break;
          }
        }
      }, true);
    });

    bindButtons(documentRef);
    refreshSnapshot(documentRef);
    if (typeof global.MutationObserver === 'function') {
      const observer = new global.MutationObserver(() => {
        bindButtons(documentRef);
        refreshSnapshot(documentRef);
      });
      observer.observe(documentRef.body, { childList: true, subtree: true });
    }
    global.setInterval?.(() => refreshSnapshot(documentRef), 700);
  }

  function tsvField(value) {
    const normalized = String(value || '').replace(/\r?\n/g, '<br>').replace(/\t/g, ' ');
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  function normalizeTag(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  }

  function buildTsv(documentRef = global.document) {
    const headers = [
      '#separator:Tab',
      '#html:true',
      '#tags:osler',
      '#columns:Frente\tVerso\tTags\tBaralho',
      '#tags column:3',
      '#deck column:4',
    ];
    const rows = queue.filter((card) => validateCard(card).valid).map((card) => {
      const question = prepareHtmlForAnki(card.question.html || escapeHtml(card.question.text), documentRef);
      const answer = prepareHtmlForAnki(card.answer.html || escapeHtml(card.answer.text), documentRef);
      const explanation = prepareHtmlForAnki(card.explanation.html || escapeHtml(card.explanation.text), documentRef);
      const front = `<span style="display:none">osler:${escapeHtml(card.id)}</span>${question}`;
      const explanationBlock = explanation ? `<hr><div><strong>Explicação</strong><br>${explanation}</div>` : '';
      const back = `<div><strong>Resposta</strong><br>${answer}</div>${explanationBlock}<hr><small>Assunto: ${escapeHtml(card.topic.text)} · ID: ${escapeHtml(card.id)} · <a href="${escapeHtml(scrubSensitiveUrl(card.url))}">Osler</a></small>`;
      return [front, back, `osler ${normalizeTag(card.topic.text)}`, EXPORT_DECK].map(tsvField).join('\t');
    });
    return `\uFEFF${[...headers, ...rows].join('\n')}\n`;
  }

  function downloadTsv(documentRef = global.document) {
    if (!queue.length) {
      setMessage('A fila está vazia.');
      return null;
    }
    const file = new File([buildTsv(documentRef)], `osler-anki-${Date.now()}.tsv`, {
      type: 'text/tab-separated-values;charset=utf-8',
    });
    const url = global.URL.createObjectURL(file);
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    documentRef.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout?.(() => global.URL.revokeObjectURL(url), 1000);
    setMessage(`TSV baixado com ${queue.length} card(s).`);
    return file;
  }

  function renderPanel() {
    if (!panel) return;
    panel.querySelector('[data-role="status"]').textContent = `${queue.length} card(s) na fila para o AnkiDroid`;
  }

  function install(documentRef = global.document) {
    if (!documentRef.body || documentRef.getElementById(PANEL_ID)) return;
    documentRef.getElementById('osler-anki-bridge-v042')?.remove?.();
    queue = loadQueue();
    panel = documentRef.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <strong>Osler Anki Bridge — 0.4.3</strong>
      <p data-role="status"></p>
      <button data-action="capture">Adicionar card atual</button>
      <button data-action="download">Baixar TSV</button>
      <div data-role="message" style="margin-top:5px;max-width:300px"></div>
    `;
    panel.style.cssText = 'position:fixed;right:12px;top:12px;z-index:2147483647;background:#fff;color:#111;border:1px solid #999;border-radius:10px;padding:10px;font:12px system-ui';
    panel.querySelector('[data-action="capture"]').addEventListener('click', () => capture('captura manual', documentRef));
    panel.querySelector('[data-action="download"]').addEventListener('click', () => downloadTsv(documentRef));
    documentRef.body.appendChild(panel);
    installListeners(documentRef);
    renderPanel();
  }

  const api = {
    answerCandidates,
    buildTsv,
    capture,
    chooseRoot,
    extractAnswer,
    extractCard,
    findQuestionElement,
    isCitationText,
    sanitizeHtml,
    validateCard,
  };
  global.OslerAnkiBridgeV043 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : window);

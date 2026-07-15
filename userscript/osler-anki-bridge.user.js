// ==UserScript==
// @name         Osler Anki Bridge
// @namespace    https://github.com/osler-anki-bridge/osler-anki-bridge
// @version      0.4.6
// @description  Captura transacional de cards da Osler: salva antes de avançar, com atalhos 1/2, auditoria e exportação TSV.
// @match        https://oslermedicina.com.br/*
// @match        https://*.oslermedicina.com.br/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-bridge.user.js
// @downloadURL  https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-bridge.user.js
// ==/UserScript==

(function bootstrap(global) {
  'use strict';

  const VERSION = '0.4.6';
  const QUEUE_KEY = 'oslerAnkiBridge.queue.v1';
  const AUDIT_KEY = 'oslerAnkiBridge.audit.v1';
  const EXPORT_DECK = 'Osler';
  const PANEL_ID = 'osler-anki-bridge-v046';
  const CLOZE_SELECTOR = '.cloze-answer,[class*="cloze-answer"],[class*="ClozeAnswer"],[class*="clozeAnswer"]';
  const SENSITIVE_QUERY_PARAM = /^(token|access_token|auth|authorization|signature|sig|key|jwt)$/i;
  const CAPTURE_RETRY_MS = 60;
  const CAPTURE_TIMEOUT_MS = 2200;

  let queue = [];
  let audit = [];
  let panel = null;
  let sessionStats = { added: 0, duplicate: 0, failed: 0 };
  let globalListenersInstalled = false;
  let lastKnownPath = '';
  let ratingTransaction = null;
  let syntheticRatingUntil = 0;

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

  function pageMode(locationRef = global.location) {
    const pathname = String(locationRef?.pathname || '').replace(/\/+$/, '');
    if (pathname.endsWith('/test/report')) return 'report';
    if (pathname.endsWith('/test')) return 'test';
    return 'idle';
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

  function hiddenByAncestor(element) {
    return Boolean(element?.closest?.('[hidden],[inert],[aria-hidden="true"]'));
  }

  function visibilityMetrics(element) {
    if (!element || element.hidden || hiddenByAncestor(element) || element.closest?.(`#${PANEL_ID}`)) {
      return { visible: false, ratio: 0, centerDistance: Infinity };
    }

    const style = global.getComputedStyle?.(element);
    if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) {
      return { visible: false, ratio: 0, centerDistance: Infinity };
    }

    const rect = element.getBoundingClientRect?.();
    if (!rect || !Number.isFinite(rect.top)) {
      const visible = typeof element.getClientRects === 'function'
        ? element.getClientRects().length > 0
        : element.offsetParent !== null;
      return { visible, ratio: visible ? 1 : 0, centerDistance: 0 };
    }

    const viewportWidth = Number(global.innerWidth) || Number(global.document?.documentElement?.clientWidth) || 1920;
    const viewportHeight = Number(global.innerHeight) || Number(global.document?.documentElement?.clientHeight) || 1080;
    const width = Math.max(0, Number(rect.width) || Number(rect.right) - Number(rect.left));
    const height = Math.max(0, Number(rect.height) || Number(rect.bottom) - Number(rect.top));
    const intersectionWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const intersectionHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    const area = Math.max(1, width * height);
    const intersection = intersectionWidth * intersectionHeight;
    const ratio = intersection / area;
    const center = Number(rect.top) + height / 2;
    const centerDistance = Math.abs(center - viewportHeight / 2);
    return { visible: intersection > 0 && width > 0 && height > 0, ratio, centerDistance };
  }

  function isVisible(element) {
    return visibilityMetrics(element).visible;
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
    if (String(element?.tagName || '').toLowerCase() !== 'p') return -Infinity;
    if (element.closest?.('div.osler-card-explanation')) return -Infinity;
    const metrics = visibilityMetrics(element);
    if (!metrics.visible) return -Infinity;
    const text = normalizeWhitespace(element.textContent);
    if (!text || isVerdictOnly(text) || isCitationText(text)) return -Infinity;
    const strong = element.querySelector?.('strong');
    const topic = normalizeWhitespace(strong?.textContent);
    const remainder = paragraphRemainder(element);
    if (!strong || !topic || isVerdictOnly(topic) || remainder.length < 3) return -Infinity;

    let score = Math.min(text.length, 180) / 20;
    score += 45;
    score += metrics.ratio * 100;
    score -= metrics.centerDistance / 50;
    if (element.querySelector?.(CLOZE_SELECTOR)) score += 100;
    if (/\?$/.test(text)) score += 20;
    else if (/[:.]$/.test(text)) score += 8;
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

  function findExplanationForQuestion(question, documentRef = global.document) {
    if (!question) return null;
    const explanations = Array.from(documentRef.querySelectorAll?.('div.osler-card-explanation') || [])
      .filter((element) => isVisible(element) && isBefore(question, element));
    if (!explanations.length) return null;
    return explanations.sort((first, second) => {
      const firstTop = first.getBoundingClientRect?.().top ?? Infinity;
      const secondTop = second.getBoundingClientRect?.().top ?? Infinity;
      return firstTop - secondTop;
    })[0] || null;
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

  function contentCandidates(root, question, explanation) {
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
      if (contentCandidates(current, question, null).length) return current;
      current = current.parentElement;
    }
    return fallback;
  }

  function replaceClozesWithBlank(root, documentRef) {
    Array.from(root?.querySelectorAll?.(CLOZE_SELECTOR) || []).forEach((node) => {
      node.replaceWith(documentRef.createTextNode('[...]'));
    });
  }

  function clozesInCard(root, question, explanation) {
    if (!root) return [];
    return Array.from(root.querySelectorAll?.(CLOZE_SELECTOR) || []).filter((node) => {
      if (!isVisible(node)) return false;
      if (explanation && explanation.contains?.(node)) return false;
      return question.contains?.(node) || isBefore(question, node);
    });
  }

  function extractResponse(question, explanation, root, documentRef = global.document) {
    const allClozes = clozesInCard(root, question, explanation);
    if (allClozes.length) {
      const items = allClozes.map((node) => ({
        text: normalizeWhitespace(node.textContent),
        html: sanitizeHtml(node.innerHTML, documentRef),
      })).filter((item) => item.text || item.html);

      const candidates = contentCandidates(root, question, explanation);
      const contextBlocks = candidates.filter((block) => allClozes.some((cloze) => block.contains?.(cloze)));
      const contextHtml = [];
      const contextText = [];
      contextBlocks.forEach((block) => {
        const clone = block.cloneNode(true);
        replaceClozesWithBlank(clone, documentRef);
        contextHtml.push(sanitizeHtml(clone.outerHTML || clone.innerHTML, documentRef));
        contextText.push(normalizeWhitespace(clone.textContent));
      });

      return {
        answer: {
          source: question.querySelector?.(CLOZE_SELECTOR) ? 'question-cloze' : 'body-cloze',
          items,
          text: items.map((item) => item.text).filter(Boolean).join('; '),
          html: items.map((item) => item.html).filter(Boolean).join('; '),
        },
        frontContext: {
          text: contextText.filter(Boolean).join(' '),
          html: contextHtml.filter(Boolean).join('\n'),
        },
      };
    }

    const candidates = contentCandidates(root, question, explanation);
    if (!candidates.length) {
      return {
        answer: { source: 'missing', items: [], text: '', html: '' },
        frontContext: { text: '', html: '' },
      };
    }

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
      answer: {
        source: explanation ? 'intermediate-block' : 'card-body',
        items,
        text: items.map((item) => item.text).filter(Boolean).join('\n'),
        html: selected.map((node) => sanitizeHtml(node.outerHTML || node.innerHTML, documentRef)).join('\n'),
      },
      frontContext: { text: '', html: '' },
    };
  }

  function extractCard(documentRef = global.document) {
    if (pageMode() !== 'test') return null;
    const questionElement = findQuestionElement(documentRef);
    if (!questionElement) return null;
    const explanationElement = findExplanationForQuestion(questionElement, documentRef);
    const root = chooseRoot(questionElement, explanationElement);
    if (!root) return null;

    const questionClone = questionElement.cloneNode(true);
    replaceClozesWithBlank(questionClone, documentRef);
    const topicElement = questionElement.querySelector('strong');
    const topic = normalizeWhitespace(topicElement?.textContent).replace(/[\s.:;,!?–—-]+$/u, '');
    const response = extractResponse(questionElement, explanationElement, root, documentRef);
    const hiddenQuestionText = normalizeWhitespace([
      questionClone.textContent,
      response.frontContext.text,
    ].filter(Boolean).join(' '));
    const hiddenQuestionHtml = [
      sanitizeHtml(questionClone.innerHTML, documentRef),
      response.frontContext.html,
    ].filter(Boolean).join('\n');
    const revealedQuestionText = normalizeWhitespace(questionElement.textContent);
    const explanationText = explanationElement ? normalizeWhitespace(explanationElement.textContent) : '';
    const explanationHtml = explanationElement ? sanitizeHtml(explanationElement.innerHTML, documentRef) : '';

    const card = {
      id: '',
      trigger: '',
      capturedAt: now(),
      url: global.location?.href || '',
      question: {
        text: hiddenQuestionText,
        html: hiddenQuestionHtml,
        revealedText: revealedQuestionText,
        revealedHtml: sanitizeHtml(questionElement.innerHTML, documentRef),
      },
      answer: response.answer,
      explanation: { text: explanationText, html: explanationHtml },
      topic: { text: topic, html: sanitizeHtml(topicElement?.innerHTML || escapeHtml(topic), documentRef) },
      deck: { text: topic, html: sanitizeHtml(topicElement?.innerHTML || escapeHtml(topic), documentRef) },
    };
    card.id = stableHash([
      card.topic.text,
      card.question.text,
      card.answer.text,
      card.explanation.text,
    ].join('\n---\n'));
    return card;
  }

  function validateCard(card) {
    const question = normalizeWhitespace(card?.question?.text);
    const answer = normalizeWhitespace(card?.answer?.text);
    const answerHtml = String(card?.answer?.html || '');
    const answerSource = String(card?.answer?.source || '');
    const topic = normalizeWhitespace(card?.topic?.text);
    const reasons = [];
    if (!question) reasons.push('pergunta vazia');
    if (!answer && !/<(img|li|ul|ol|table)\b/i.test(answerHtml)) reasons.push('resposta vazia');
    if (!answerSource.includes('cloze') && (answer.includes('[...]') || answerHtml.includes('[...]'))) {
      reasons.push('resposta ainda não revelada');
    }
    if (isVerdictOnly(question)) reasons.push('pergunta é só um veredito');
    if (isVerdictOnly(topic)) reasons.push('assunto é só um veredito');
    return { valid: reasons.length === 0, reasons };
  }

  function readStoredArray(key) {
    try {
      const value = JSON.parse(global.localStorage?.getItem?.(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_error) {
      return [];
    }
  }

  function loadQueue() {
    const ids = new Set();
    return readStoredArray(QUEUE_KEY).filter((card) => {
      if (!card?.id || !validateCard(card).valid || ids.has(card.id)) return false;
      ids.add(card.id);
      return true;
    });
  }

  function loadAudit() {
    return readStoredArray(AUDIT_KEY).slice(-500);
  }

  function saveQueue() {
    global.localStorage?.setItem?.(QUEUE_KEY, JSON.stringify(queue));
    renderPanel();
  }

  function saveAudit() {
    global.localStorage?.setItem?.(AUDIT_KEY, JSON.stringify(audit.slice(-500)));
    renderPanel();
  }

  function shortLabel(value, maxLength = 115) {
    const text = normalizeWhitespace(value) || 'pergunta não identificada';
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }

  function setMessage(message, state = '') {
    const target = panel?.querySelector?.('[data-role="message"]');
    if (!target) return;
    target.textContent = message;
    target.dataset.state = state;
  }

  function recordAudit(status, trigger, card, detail = '') {
    const entry = {
      at: now(),
      status,
      trigger,
      detail,
      id: card?.id || '',
      topic: normalizeWhitespace(card?.topic?.text),
      question: normalizeWhitespace(card?.question?.text),
      answer: normalizeWhitespace(card?.answer?.text),
      queueSize: queue.length,
      url: scrubSensitiveUrl(global.location?.href || ''),
    };
    audit.push(entry);
    audit = audit.slice(-500);
    if (Object.prototype.hasOwnProperty.call(sessionStats, status)) sessionStats[status] += 1;
    saveAudit();
    return entry;
  }

  function visibleQuestionLabel(documentRef = global.document) {
    return shortLabel(findQuestionElement(documentRef)?.textContent);
  }

  function commitCard(card, trigger) {
    const validation = validateCard(card);
    if (!validation.valid) {
      return { status: 'not-ready', card: null, reasons: validation.reasons };
    }

    const copy = JSON.parse(JSON.stringify(card));
    copy.trigger = trigger;
    copy.capturedAt = now();
    const duplicate = queue.find((item) => item.id === copy.id);
    if (duplicate) {
      recordAudit('duplicate', trigger, copy, 'ID já presente na fila');
      setMessage(`DUPLICADO — ${shortLabel(copy.question.text)}`, 'duplicate');
      return { status: 'duplicate', card: duplicate, reasons: [] };
    }

    queue.push(copy);
    saveQueue();
    recordAudit('added', trigger, copy, 'adicionado à fila antes de avançar');
    setMessage(`SALVO — ${shortLabel(copy.question.text)}`, 'added');
    return { status: 'added', card: copy, reasons: [] };
  }

  function capture(trigger, documentRef = global.document) {
    if (pageMode() !== 'test') {
      setMessage('Captura pausada nesta página. Volte à tela do card.', 'failed');
      return { status: 'failed', card: null, reasons: ['fora da tela de teste'] };
    }

    const card = extractCard(documentRef);
    const result = commitCard(card, trigger);
    if (result.status !== 'not-ready') return result;

    const question = visibleQuestionLabel(documentRef);
    const detail = result.reasons.join(', ') || 'card não identificado';
    recordAudit('failed', trigger, card, detail);
    setMessage(`FALHOU — ${question} — ${detail}`, 'failed');
    return { status: 'failed', card: null, reasons: result.reasons };
  }

  function triggerForButton(element) {
    const text = normalizeText([
      element?.textContent,
      element?.innerText,
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
    ].filter(Boolean).join(' '));
    if (text.includes('acertei')) return null;
    if (text.includes('errei')) return 'Errei';
    if (text.includes('dificil')) return 'Difícil';
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
    if (index === 0) return 'Errei';
    if (index === 1) return 'Difícil';
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

  function findRatingButton(trigger, documentRef = global.document) {
    return Array.from(documentRef.querySelectorAll?.('button,[role="button"]') || [])
      .filter((button) => isVisible(button) && ratingTrigger(button) === trigger)
      .sort((first, second) => {
        const firstMetrics = visibilityMetrics(first);
        const secondMetrics = visibilityMetrics(second);
        return (secondMetrics.ratio - firstMetrics.ratio)
          || (firstMetrics.centerDistance - secondMetrics.centerDistance);
      })[0] || null;
  }

  function finishNativeRating(trigger, documentRef, preferredButton = null) {
    const button = preferredButton && preferredButton.isConnected && isVisible(preferredButton)
      ? preferredButton
      : findRatingButton(trigger, documentRef);
    if (!button) {
      setMessage(`SALVO, MAS NÃO AVANÇOU — botão ${trigger} não encontrado.`, 'failed');
      return false;
    }

    syntheticRatingUntil = Date.now() + 1200;
    button.click();
    return true;
  }

  function startRatingTransaction(trigger, documentRef = global.document, source = 'keyboard', preferredButton = null) {
    if (pageMode() !== 'test') return Promise.resolve({ status: 'failed', reasons: ['fora da tela de teste'] });
    if (ratingTransaction) {
      setMessage('AGUARDE — o card anterior ainda está sendo salvo.', 'waiting');
      return ratingTransaction.promise;
    }

    const startedAt = Date.now();
    const questionAtStart = visibleQuestionLabel(documentRef);
    let resolveTransaction;
    const promise = new Promise((resolve) => { resolveTransaction = resolve; });
    ratingTransaction = { trigger, source, startedAt, promise };
    renderPanel();
    setMessage(`AGUARDANDO RESPOSTA — ${questionAtStart}`, 'waiting');

    const attempt = () => {
      if (!ratingTransaction || ratingTransaction.startedAt !== startedAt) return;
      if (pageMode() !== 'test') {
        const detail = 'a tela mudou antes da captura';
        recordAudit('failed', `${source === 'keyboard' ? 'tecla' : 'botão'} ${trigger}`, null, detail);
        ratingTransaction = null;
        renderPanel();
        setMessage(`NÃO AVANÇOU — ${detail}.`, 'failed');
        resolveTransaction({ status: 'failed', reasons: [detail] });
        return;
      }

      const card = extractCard(documentRef);
      const validation = validateCard(card);
      if (validation.valid) {
        const auditTrigger = `${source === 'keyboard' ? 'tecla' : 'botão'} ${trigger}`;
        const result = commitCard(card, auditTrigger);
        ratingTransaction = null;
        renderPanel();
        if (result.status === 'added' || result.status === 'duplicate') {
          const advanced = finishNativeRating(trigger, documentRef, preferredButton);
          resolveTransaction({ ...result, advanced });
          return;
        }
        resolveTransaction(result);
        return;
      }

      if (Date.now() - startedAt >= CAPTURE_TIMEOUT_MS) {
        const detail = validation.reasons.join(', ') || 'resposta não apareceu';
        const auditTrigger = `${source === 'keyboard' ? 'tecla' : 'botão'} ${trigger}`;
        recordAudit('failed', auditTrigger, card, `bloqueado sem avançar: ${detail}`);
        ratingTransaction = null;
        renderPanel();
        setMessage(`NÃO AVANÇOU — ${questionAtStart} — ${detail}. Mostre a resposta e tente novamente.`, 'failed');
        resolveTransaction({ status: 'failed', card: null, reasons: validation.reasons, advanced: false });
        return;
      }

      global.setTimeout?.(attempt, CAPTURE_RETRY_MS);
    };

    attempt();
    return promise;
  }

  function isEditableTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || '').toLowerCase();
    return tag === 'input'
      || tag === 'textarea'
      || tag === 'select'
      || Boolean(target.isContentEditable)
      || Boolean(target.closest?.('[contenteditable="true"]'));
  }

  function keyTriggerForEvent(event) {
    if (!event || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null;
    if (isEditableTarget(event.target)) return null;
    if (event.key === '1' || event.code === 'Numpad1') return 'Errei';
    if (event.key === '2' || event.code === 'Numpad2') return 'Difícil';
    return null;
  }

  function blockEvent(event) {
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  }

  function ensureGlobalListeners(documentRef = global.document) {
    if (globalListenersInstalled) return;
    globalListenersInstalled = true;

    const keyboardHandler = (event) => {
      if (pageMode() !== 'test') return;
      const trigger = keyTriggerForEvent(event);
      if (!trigger) return;
      blockEvent(event);
      if (event.type === 'keydown') startRatingTransaction(trigger, documentRef, 'keyboard');
    };

    global.addEventListener?.('keydown', keyboardHandler, true);
    global.addEventListener?.('keyup', keyboardHandler, true);
    documentRef.addEventListener('keydown', keyboardHandler, true);
    documentRef.addEventListener('keyup', keyboardHandler, true);

    documentRef.addEventListener('click', (event) => {
      if (pageMode() !== 'test' || Date.now() < syntheticRatingUntil) return;
      const path = event.composedPath?.() || [event.target];
      const button = path.find((node) => ratingTrigger(node));
      const trigger = ratingTrigger(button);
      if (!trigger) return;
      blockEvent(event);
      startRatingTransaction(trigger, documentRef, 'button', button?.closest?.('button,[role="button"]') || button);
    }, true);
  }

  function syncPageMode() {
    if (pageMode() !== 'test' && ratingTransaction) {
      ratingTransaction = null;
    }
    renderPanel();
  }

  function installRouteWatcher() {
    lastKnownPath = String(global.location?.pathname || '');
    global.setInterval?.(() => {
      const currentPath = String(global.location?.pathname || '');
      if (currentPath === lastKnownPath) return;
      lastKnownPath = currentPath;
      syncPageMode();
    }, 1000);
    global.addEventListener?.('popstate', () => global.setTimeout?.(syncPageMode, 0));
    global.addEventListener?.('hashchange', () => global.setTimeout?.(syncPageMode, 0));
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

  function downloadTextFile(documentRef, contents, filename, mimeType) {
    const blob = new Blob([contents], { type: mimeType });
    const url = global.URL.createObjectURL(blob);
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    documentRef.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout?.(() => global.URL.revokeObjectURL(url), 60000);
    return { blob, filename };
  }

  function downloadTsv(documentRef = global.document) {
    if (!queue.length) {
      setMessage('A fila está vazia.', 'failed');
      return null;
    }
    const filename = `osler-anki-${Date.now()}.tsv`;
    const file = downloadTextFile(
      documentRef,
      buildTsv(documentRef),
      filename,
      'text/tab-separated-values;charset=utf-8',
    );
    setMessage(`Download solicitado: ${filename} · ${queue.length} card(s).`, 'added');
    return file;
  }

  function downloadAudit(documentRef = global.document) {
    const payload = {
      version: VERSION,
      exportedAt: now(),
      queueSize: queue.length,
      sessionStats,
      transactionActive: Boolean(ratingTransaction),
      events: audit,
    };
    const filename = `osler-anki-diagnostico-${Date.now()}.json`;
    const file = downloadTextFile(
      documentRef,
      `${JSON.stringify(payload, null, 2)}\n`,
      filename,
      'application/json;charset=utf-8',
    );
    setMessage(`Download solicitado: ${filename} · ${audit.length} evento(s).`, 'added');
    return file;
  }

  function renderPanel() {
    if (!panel) return;
    const mode = pageMode();
    panel.querySelector('[data-role="status"]').textContent = `${queue.length} card(s) na fila para o AnkiDroid`;
    panel.querySelector('[data-role="session"]').textContent = `Nesta sessão: ${sessionStats.added} adicionados · ${sessionStats.duplicate} duplicados · ${sessionStats.failed} falhas`;
    panel.querySelector('[data-role="mode"]').textContent = mode === 'test'
      ? ratingTransaction
        ? `Salvando antes de avançar: ${ratingTransaction.trigger}…`
        : 'Captura protegida: Espaço mostra · 1 Errei · 2 Difícil. Só avança depois de salvar.'
      : mode === 'report'
        ? 'Modo leve de exportação: captura desligada nesta tela.'
        : 'Modo leve: abra um teste para ativar a captura.';
    const captureButton = panel.querySelector('[data-action="capture"]');
    if (captureButton) captureButton.disabled = mode !== 'test' || Boolean(ratingTransaction);
  }

  function install(documentRef = global.document) {
    if (!documentRef.body || documentRef.getElementById(PANEL_ID)) return;
    ['osler-anki-bridge-v042', 'osler-anki-bridge-v043', 'osler-anki-bridge-v044', 'osler-anki-bridge-v045'].forEach((id) => {
      documentRef.getElementById(id)?.remove?.();
    });
    queue = loadQueue();
    audit = loadAudit();
    panel = documentRef.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <strong>Osler Anki Bridge — ${VERSION}</strong>
      <p data-role="status"></p>
      <div data-role="session" style="margin-bottom:6px"></div>
      <button data-action="capture">Adicionar card atual</button>
      <button data-action="download">Baixar TSV</button>
      <button data-action="audit">Baixar log</button>
      <div data-role="mode" style="margin-top:6px"></div>
      <div data-role="message" style="margin-top:5px;max-width:360px;overflow-wrap:anywhere"></div>
    `;
    panel.style.cssText = 'position:fixed;right:12px;top:12px;z-index:2147483647;background:#fff;color:#111;border:1px solid #999;border-radius:10px;padding:10px;font:12px system-ui;max-width:380px';
    panel.querySelector('[data-action="capture"]').addEventListener('click', () => capture('captura manual', documentRef));
    panel.querySelector('[data-action="download"]').addEventListener('click', () => downloadTsv(documentRef));
    panel.querySelector('[data-action="audit"]').addEventListener('click', () => downloadAudit(documentRef));
    documentRef.body.appendChild(panel);
    ensureGlobalListeners(documentRef);
    installRouteWatcher();
    syncPageMode();
  }

  const api = {
    buildTsv,
    capture,
    clozesInCard,
    commitCard,
    contentCandidates,
    extractCard,
    extractResponse,
    findExplanationForQuestion,
    findQuestionElement,
    findRatingButton,
    isCitationText,
    keyTriggerForEvent,
    pageMode,
    sanitizeHtml,
    stableHash,
    startRatingTransaction,
    validateCard,
    visibilityMetrics,
  };
  global.OslerAnkiBridgeV046 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : window);

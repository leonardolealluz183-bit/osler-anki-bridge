// ==UserScript==
// @name         Osler Anki Bridge
// @namespace    https://github.com/osler-anki-bridge/osler-anki-bridge
// @version      0.4.1
// @description  Captura cards da Osler, mantém uma fila persistente e exporta TSV para o AnkiDroid.
// @match        https://oslermedicina.com.br/*
// @match        https://*.oslermedicina.com.br/*
// @updateURL    https://leonardolealluz183-bit.github.io/osler-anki-bridge/osler-anki-bridge.user.js
// @downloadURL  https://leonardolealluz183-bit.github.io/osler-anki-bridge/osler-anki-bridge.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function bootstrap(global) {
  'use strict';

  const CONFIG_KEY = 'oslerCaptureDiagnostics.config.v2';
  const QUEUE_KEY = 'oslerAnkiBridge.queue.v1';
  const EXPORT_DECK = 'Osler';
  const FIELD_LABELS = {
    question: 'pergunta',
    answer: 'resposta',
    explanation: 'explicação',
    deck: 'assunto/deck',
  };
  const FIELD_ORDER = Object.keys(FIELD_LABELS);
  const DANGEROUS_ATTR = /^(on|srcdoc$)/i;
  const URL_ATTR = /^(href|src|xlink:href|formaction)$/i;
  const DANGEROUS_URL = /^\s*(javascript|data):/i;
  const SENSITIVE_QUERY_PARAM = /^(token|access_token|auth|authorization|signature|sig|key|jwt)$/i;

  let calibrationField = null;
  let capturedCards = [];
  let logs = [];
  let config = {};
  let panelRefs = null;
  let documentListenersInstalled = false;
  let observer = null;
  let lastGesture = { trigger: '', at: 0 };
  let queueRepair = { removed: 0, cleaned: 0 };
  const boundButtons = typeof WeakSet === 'function' ? new WeakSet() : new Set();

  function now() {
    return new Date().toISOString();
  }

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeButtonText(value) {
    return normalizeWhitespace(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function stripHtml(value) {
    return normalizeWhitespace(String(value || '').replace(/<[^>]+>/g, ' '));
  }

  function isVerdictOnly(value) {
    const normalized = normalizeButtonText(value).replace(/[.!?:;,–—-]+$/g, '').trim();
    return new Set([
      'sim',
      'nao',
      'verdadeiro',
      'falso',
      'correto',
      'correta',
      'incorreto',
      'incorreta',
    ]).has(normalized);
  }

  function log(message, details = {}) {
    const entry = { at: now(), message, details };
    logs.push(entry);
    if (logs.length > 200) logs = logs.slice(-200);
    renderPanel();
    return entry;
  }

  function parseStoredJson(storage, key, fallback) {
    try {
      const parsed = JSON.parse(storage?.getItem?.(key) || 'null');
      return parsed ?? fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function loadConfig(storage = global.localStorage) {
    const loaded = parseStoredJson(storage, CONFIG_KEY, {});
    return loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? loaded : {};
  }

  function saveConfig(nextConfig = config, storage = global.localStorage) {
    config = { ...nextConfig };
    storage?.setItem?.(CONFIG_KEY, JSON.stringify(config));
    renderPanel();
  }

  function clearCalibration(storage = global.localStorage) {
    config = {};
    storage?.removeItem?.(CONFIG_KEY);
    log('calibração limpa');
  }

  function cssEscape(value) {
    if (global.CSS?.escape) return global.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function selectorFor(element) {
    if (!element?.tagName) return '';
    if (element.id) return `#${cssEscape(element.id)}`;
    const dataKey = Array.from(element.attributes || []).find((attr) => attr.name.startsWith('data-') && attr.value);
    if (dataKey) return `${element.tagName.toLowerCase()}[${dataKey.name}="${cssEscape(dataKey.value)}"]`;

    const parts = [];
    let current = element;
    while (current?.tagName && current.nodeType === 1 && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      const stableClasses = Array.from(current.classList || [])
        .filter((name) => !/^[a-zA-Z]+-[a-zA-Z]+$/.test(name))
        .slice(0, 2);
      if (stableClasses.length) part += `.${stableClasses.map(cssEscape).join('.')}`;
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children || []).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ');
  }

  function scrubSensitiveUrl(value) {
    const original = String(value || '').trim();
    if (!original || DANGEROUS_URL.test(original)) return '';

    try {
      const base = global.location?.origin || 'https://oslermedicina.com.br';
      const parsed = new URL(original, base);
      Array.from(parsed.searchParams.keys()).forEach((key) => {
        if (SENSITIVE_QUERY_PARAM.test(key)) parsed.searchParams.delete(key);
      });
      const isRelative = !/^[a-z][a-z0-9+.-]*:/i.test(original) && !original.startsWith('//');
      return isRelative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
    } catch (_error) {
      return original
        .replace(/([?&])(token|access_token|auth|authorization|signature|sig|key|jwt)=[^&"'\s>]*/gi, '$1')
        .replace(/[?&]+$/g, '');
    }
  }

  function unwrapElement(element) {
    const parent = element?.parentNode;
    if (!parent) return;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    element.remove();
  }

  function sanitizeHtml(html, documentRef = global.document) {
    const template = documentRef?.createElement?.('template');
    if (!template) {
      return String(html || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\s+on[a-z]+=(("[^"]*")|('[^']*')|[^\s>]+)/gi, '')
        .replace(/\s+(href|src|xlink:href|formaction)=(("|')?\s*(javascript|data):[^\s>]*(\3)?)/gi, '')
        .replace(/<mark\b[^>]*class=("|')[^"']*\bosler-highlight\b[^"']*\1[^>]*>/gi, '')
        .replace(/<\/mark>/gi, '')
        .replace(/\s+data-(start|end)-offset=("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/([?&])(token|access_token|auth|authorization|signature|sig|key|jwt)=[^&"'\s>]*/gi, '$1')
        .replace(/[?&]+(?=["'\s>])/g, '')
        .trim();
    }

    template.innerHTML = html || '';
    if (!template.content?.querySelectorAll) return String(template.innerHTML || '').trim();

    template.content.querySelectorAll('script, iframe, object, embed, link[rel="import"]').forEach((node) => node.remove());
    template.content.querySelectorAll('mark.osler-highlight').forEach(unwrapElement);
    template.content.querySelectorAll('[data-start-offset], [data-end-offset]').forEach((node) => {
      node.removeAttribute('data-start-offset');
      node.removeAttribute('data-end-offset');
    });
    template.content.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes).forEach((attr) => {
        if (DANGEROUS_ATTR.test(attr.name)) {
          node.removeAttribute(attr.name);
          return;
        }
        if (!URL_ATTR.test(attr.name)) return;
        const sanitized = scrubSensitiveUrl(attr.value);
        if (!sanitized) node.removeAttribute(attr.name);
        else node.setAttribute(attr.name, sanitized);
      });
    });
    return template.innerHTML.trim();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function prepareHtmlForAnki(html, documentRef = global.document) {
    const sanitized = sanitizeHtml(html, documentRef);
    const template = documentRef?.createElement?.('template');
    if (!template) {
      return sanitized
        .replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, '')
        .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
        .replace(/<img\b[^>]*>/gi, '<div><em>[Imagem disponível na Osler]</em></div>')
        .trim();
    }

    template.innerHTML = sanitized;
    if (!template.content?.querySelectorAll) return sanitized;
    template.content.querySelectorAll('button, svg').forEach((node) => node.remove());
    template.content.querySelectorAll('img').forEach((image) => {
      const placeholder = documentRef.createElement('div');
      const alt = normalizeWhitespace(image.getAttribute?.('alt'));
      placeholder.innerHTML = `<em>[Imagem disponível na Osler${alt ? `: ${escapeHtml(alt)}` : ''}]</em>`;
      image.replaceWith(placeholder);
    });
    return template.innerHTML.trim();
  }

  function readElement(element, selector = '', documentRef = global.document) {
    if (!element) return { selector, text: '', html: '' };
    return {
      selector,
      text: normalizeWhitespace(element.textContent),
      html: sanitizeHtml(element.innerHTML, documentRef),
    };
  }

  function readField(selector, documentRef = global.document) {
    const element = selector ? documentRef.querySelector(selector) : null;
    return readElement(element, selector, documentRef);
  }

  function stripTopicPunctuation(value) {
    return normalizeWhitespace(value).replace(/[\s.:;,!?–—-]+$/u, '');
  }

  function paragraphRemainder(element) {
    if (!element) return '';
    const strong = element.querySelector?.('strong');
    if (!strong) return normalizeWhitespace(element.textContent);
    const clone = element.cloneNode?.(true);
    if (clone?.querySelector) {
      clone.querySelector('strong')?.remove?.();
      return normalizeWhitespace(clone.textContent);
    }
    return normalizeWhitespace(String(element.textContent || '').replace(String(strong.textContent || ''), ''));
  }

  function questionCandidateScore(element, distance = 0) {
    if (!element || String(element.tagName || '').toLowerCase() !== 'p') return -Infinity;
    const text = normalizeWhitespace(element.textContent);
    if (!text || isVerdictOnly(text)) return -Infinity;
    const strong = element.querySelector?.('strong');
    const strongText = normalizeWhitespace(strong?.textContent);
    const remainder = paragraphRemainder(element);
    const hasCloze = Boolean(element.querySelector?.('.cloze-answer'));

    let score = Math.min(text.length, 120) / 20 - distance / 100;
    if (strong) score += 30;
    if (hasCloze) score += 80;
    if (remainder.length >= 3) score += 45;
    if (/[?:.]$/.test(text)) score += 3;
    if (strong && isVerdictOnly(strongText) && remainder.length < 3) return -Infinity;
    return score;
  }

  function precedingParagraphs(explanationElement) {
    const paragraphs = [];
    let sibling = explanationElement?.previousElementSibling;
    while (sibling) {
      if (String(sibling.tagName || '').toLowerCase() === 'p') paragraphs.push(sibling);
      sibling = sibling.previousElementSibling;
    }
    return paragraphs;
  }

  function findQuestionElement(explanationElement) {
    const candidates = precedingParagraphs(explanationElement);
    let best = null;
    let bestScore = -Infinity;
    candidates.forEach((candidate, index) => {
      const score = questionCandidateScore(candidate, index);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
    return best;
  }

  function replaceClozesWithPlaceholders(questionElement) {
    const clone = questionElement?.cloneNode?.(true);
    if (!clone) return null;
    Array.from(clone.querySelectorAll?.('.cloze-answer') || []).forEach((node) => {
      if (typeof node.replaceWith === 'function') {
        node.replaceWith(global.document?.createTextNode?.('[...]') || '[...]');
      } else {
        node.textContent = '[...]';
        node.innerHTML = '[...]';
      }
    });
    return clone;
  }

  function extractAnswers(questionElement, documentRef = global.document) {
    const items = Array.from(questionElement?.querySelectorAll?.('.cloze-answer') || []).map((element) => ({
      text: normalizeWhitespace(element.textContent),
      html: sanitizeHtml(element.innerHTML, documentRef),
    }));
    return {
      selector: '.cloze-answer',
      source: 'cloze',
      text: items.map((item) => item.text).filter(Boolean).join('; '),
      html: items.map((item) => item.html).filter(Boolean).join('; '),
      items,
    };
  }

  function elementsBetween(questionElement, explanationElement) {
    const parent = questionElement?.parentElement;
    if (!parent || parent !== explanationElement?.parentElement) return [];
    const children = Array.from(parent.children || []);
    const questionIndex = children.indexOf(questionElement);
    const explanationIndex = children.indexOf(explanationElement);
    if (questionIndex < 0 || explanationIndex <= questionIndex) return [];
    return children.slice(questionIndex + 1, explanationIndex);
  }

  function extractIntermediateAnswer(questionElement, explanationElement, documentRef = global.document) {
    const containers = elementsBetween(questionElement, explanationElement).filter((element) => {
      const tag = String(element?.tagName || '').toLowerCase();
      if (!element || ['script', 'style', 'button'].includes(tag)) return false;
      return Boolean(normalizeWhitespace(element.textContent) || element.querySelector?.('img, svg'));
    });

    const itemElements = [];
    containers.forEach((container) => {
      const tag = String(container.tagName || '').toLowerCase();
      const listItems = tag === 'li' ? [container] : Array.from(container.querySelectorAll?.('li') || []);
      if (listItems.length) itemElements.push(...listItems);
      else itemElements.push(container);
    });

    const items = itemElements
      .map((element) => ({
        text: normalizeWhitespace(element.textContent),
        html: sanitizeHtml(element.innerHTML, documentRef),
      }))
      .filter((item) => item.text || item.html);

    return {
      selector: 'between(question, explanation)',
      source: 'intermediate-block',
      text: items.map((item) => item.text).filter(Boolean).join('\n'),
      html: containers
        .map((element) => sanitizeHtml(element.outerHTML || element.innerHTML, documentRef))
        .filter(Boolean)
        .join('\n'),
      items,
    };
  }

  function extractTopic(questionElement, documentRef = global.document) {
    const element = questionElement?.querySelector?.('strong') || null;
    if (!element) return { selector: 'strong', text: '', html: '' };
    return {
      selector: 'strong',
      text: stripTopicPunctuation(element.textContent),
      html: sanitizeHtml(element.innerHTML, documentRef),
    };
  }

  function visibleExplanation(documentRef = global.document) {
    const list = Array.from(documentRef?.querySelectorAll?.('div.osler-card-explanation') || []);
    if (!list.length) return documentRef?.querySelector?.('div.osler-card-explanation') || null;
    const visible = list.filter((element) => {
      if (element.hidden) return false;
      if (typeof element.getClientRects === 'function' && element.getClientRects().length) return true;
      return element.offsetParent !== null;
    });
    return (visible.length ? visible : list).at(-1) || null;
  }

  function extractOslerCard(documentRef = global.document) {
    const explanationElement = visibleExplanation(documentRef);
    const questionElement = findQuestionElement(explanationElement);
    if (!explanationElement || !questionElement) return null;

    const revealedQuestion = readElement(questionElement, selectorFor(questionElement), documentRef);
    const placeholderQuestion = replaceClozesWithPlaceholders(questionElement);
    const topic = extractTopic(questionElement, documentRef);
    const clozeAnswer = extractAnswers(questionElement, documentRef);
    const answer = clozeAnswer.items.length
      ? clozeAnswer
      : extractIntermediateAnswer(questionElement, explanationElement, documentRef);
    const explanation = readElement(explanationElement, 'div.osler-card-explanation', documentRef);

    return {
      question: {
        selector: revealedQuestion.selector,
        text: normalizeWhitespace(placeholderQuestion?.textContent),
        html: sanitizeHtml(placeholderQuestion?.innerHTML || '', documentRef),
        revealedText: revealedQuestion.text,
        revealedHtml: revealedQuestion.html,
      },
      answer,
      explanation,
      topic,
      deck: { ...topic },
    };
  }

  function extractFallbackCard(documentRef = global.document) {
    const question = readField(config.question, documentRef);
    return {
      question: { ...question, revealedText: question.text, revealedHtml: question.html },
      answer: { ...readField(config.answer, documentRef), source: 'manual-fallback', items: [] },
      explanation: readField(config.explanation, documentRef),
      topic: readField(config.deck, documentRef),
      deck: readField(config.deck, documentRef),
    };
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
      card.topic?.text || card.deck?.text || '',
      card.question?.revealedText || card.question?.text || '',
      card.answer?.text || '',
      card.explanation?.text || '',
    ].join('\n---\n'));
  }

  function cleanStoredCard(card, documentRef = global.document) {
    if (!card || typeof card !== 'object') return null;
    const question = card.question || {};
    const answer = card.answer || {};
    const explanation = card.explanation || {};
    const topicText = stripTopicPunctuation(card.topic?.text || card.deck?.text || '');
    const cleaned = {
      ...card,
      question: {
        ...question,
        text: normalizeWhitespace(question.text),
        html: sanitizeHtml(question.html || escapeHtml(question.text), documentRef),
        revealedText: normalizeWhitespace(question.revealedText || question.text),
        revealedHtml: sanitizeHtml(question.revealedHtml || question.html || escapeHtml(question.revealedText || question.text), documentRef),
      },
      answer: {
        ...answer,
        text: normalizeWhitespace(answer.text),
        html: sanitizeHtml(answer.html || escapeHtml(answer.text), documentRef),
        items: Array.isArray(answer.items)
          ? answer.items.map((item) => ({
            text: normalizeWhitespace(item?.text),
            html: sanitizeHtml(item?.html || escapeHtml(item?.text), documentRef),
          }))
          : [],
      },
      explanation: {
        ...explanation,
        text: normalizeWhitespace(explanation.text),
        html: sanitizeHtml(explanation.html || escapeHtml(explanation.text), documentRef),
      },
      topic: {
        ...(card.topic || {}),
        text: topicText,
        html: sanitizeHtml(card.topic?.html || escapeHtml(topicText), documentRef),
      },
      deck: {
        ...(card.deck || {}),
        text: topicText,
        html: sanitizeHtml(card.deck?.html || escapeHtml(topicText), documentRef),
      },
    };
    cleaned.id = cleaned.id || buildStableId(cleaned);
    return cleaned;
  }

  function validateCardForExport(card) {
    const questionText = normalizeWhitespace(card?.question?.text || stripHtml(card?.question?.html));
    const answerText = normalizeWhitespace(card?.answer?.text || stripHtml(card?.answer?.html));
    const answerHtml = String(card?.answer?.html || '');
    const topicText = normalizeWhitespace(card?.topic?.text || card?.deck?.text);
    const hasAnswer = Boolean(answerText || /<(img|li|ul|ol|table|svg)\b/i.test(answerHtml));
    const reasons = [];

    if (!questionText) reasons.push('pergunta vazia');
    if (!hasAnswer) reasons.push('resposta vazia');
    if (isVerdictOnly(questionText)) reasons.push('pergunta é apenas um veredito');
    if (isVerdictOnly(topicText)) reasons.push('assunto é apenas um veredito');

    return { valid: reasons.length === 0, reasons };
  }

  function loadQueue(storage = global.localStorage, documentRef = global.document) {
    const loaded = parseStoredJson(storage, QUEUE_KEY, []);
    if (!Array.isArray(loaded)) return [];

    const unique = [];
    const ids = new Set();
    let removed = 0;
    let cleanedCount = 0;

    loaded.forEach((raw) => {
      const card = cleanStoredCard(raw, documentRef);
      if (!card || ids.has(card.id)) {
        removed += 1;
        return;
      }
      if (!validateCardForExport(card).valid) {
        removed += 1;
        return;
      }
      if (JSON.stringify(card) !== JSON.stringify(raw)) cleanedCount += 1;
      ids.add(card.id);
      unique.push(card);
    });

    queueRepair = { removed, cleaned: cleanedCount };
    storage?.setItem?.(QUEUE_KEY, JSON.stringify(unique));
    return unique;
  }

  function saveQueue(queue = capturedCards, storage = global.localStorage) {
    capturedCards = Array.isArray(queue) ? [...queue] : [];
    storage?.setItem?.(QUEUE_KEY, JSON.stringify(capturedCards));
    renderPanel();
    return capturedCards;
  }

  function clearQueue(storage = global.localStorage) {
    capturedCards = [];
    storage?.removeItem?.(QUEUE_KEY);
    log('fila limpa');
    return capturedCards;
  }

  function captureCard(trigger, documentRef = global.document, storage = global.localStorage) {
    const extracted = extractOslerCard(documentRef) || extractFallbackCard(documentRef);
    const card = cleanStoredCard({
      id: '',
      trigger,
      capturedAt: now(),
      url: global.location?.href || '',
      ...extracted,
    }, documentRef);
    card.id = buildStableId(card);

    const validation = validateCardForExport(card);
    if (!validation.valid) {
      log('captura rejeitada', { trigger, reasons: validation.reasons });
      return null;
    }
    if (capturedCards.some((existing) => existing.id === card.id)) {
      log('captura duplicada ignorada', { id: card.id, trigger });
      return null;
    }

    capturedCards.push(card);
    saveQueue(capturedCards, storage);
    log('card adicionado à fila', { id: card.id, trigger, queueSize: capturedCards.length });
    return card;
  }

  function triggerForButton(element) {
    const text = normalizeButtonText([
      element?.textContent,
      element?.innerText,
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
      element?.getAttribute?.('value'),
    ].filter(Boolean).join(' '));
    if (text.includes('acertei')) return null;
    if (text.includes('errei')) return 'botão Errei';
    if (text.includes('dificil')) return 'botão Difícil';
    return null;
  }

  function triggerFromOslerStructure(target) {
    const button = target?.closest?.('button,[role="button"]') || null;
    if (!button) return null;

    const group = button.closest?.('[class*="ButtonsContainer"]');
    if (!group?.querySelectorAll) return null;
    const buttons = Array.from(group.querySelectorAll('button,[role="button"]')).filter((candidate) => {
      const className = String(candidate.className || '');
      return className.includes('SRSButton') || Boolean(candidate.closest?.('[class*="MetacognitionContainer"]'));
    });
    const index = buttons.indexOf(button);
    if (index === 0) return 'botão Errei';
    if (index === 1) return 'botão Difícil';
    return null;
  }

  function findActionElement(target) {
    const closest = target?.closest?.('button,[role="button"]');
    if (closest && (triggerForButton(closest) || triggerFromOslerStructure(closest))) return closest;
    let current = target;
    for (let depth = 0; current && depth < 8; depth += 1) {
      if (triggerForButton(current) || triggerFromOslerStructure(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function captureFromEventTarget(target, documentRef = global.document) {
    const actionElement = findActionElement(target);
    const trigger = triggerForButton(actionElement) || triggerFromOslerStructure(actionElement);
    if (!trigger) return null;
    const timestamp = Date.now();
    if (lastGesture.trigger === trigger && timestamp - lastGesture.at < 1000) return null;
    lastGesture = { trigger, at: timestamp };
    return captureCard(trigger, documentRef);
  }

  function handleDocumentAction(event, documentRef = global.document) {
    if (calibrationField) {
      if (!event.target || panelRefs?.root?.contains?.(event.target)) return null;
      if (event.type !== 'click') return null;
      event.preventDefault?.();
      event.stopPropagation?.();
      finishCalibration(event.target);
      return 'calibration';
    }

    const path = event.composedPath?.() || [];
    for (const node of path) {
      const result = captureFromEventTarget(node, documentRef);
      if (result) return result;
    }
    return captureFromEventTarget(event.target, documentRef);
  }

  function bindSrsButtons(documentRef = global.document) {
    Array.from(documentRef?.querySelectorAll?.('button,[role="button"]') || []).forEach((button) => {
      const trigger = triggerForButton(button) || triggerFromOslerStructure(button);
      if (!trigger || boundButtons.has(button)) return;
      boundButtons.add(button);
      const handler = () => {
        const timestamp = Date.now();
        if (lastGesture.trigger === trigger && timestamp - lastGesture.at < 1000) return;
        lastGesture = { trigger, at: timestamp };
        captureCard(trigger, documentRef);
      };
      button.addEventListener?.('touchstart', handler, true);
      button.addEventListener?.('pointerdown', handler, true);
      button.addEventListener?.('click', handler, true);
    });
  }

  function installDocumentListeners(documentRef = global.document) {
    if (documentListenersInstalled || !documentRef?.addEventListener) return false;
    documentRef.addEventListener('touchstart', (event) => handleDocumentAction(event, documentRef), true);
    documentRef.addEventListener('pointerdown', (event) => handleDocumentAction(event, documentRef), true);
    documentRef.addEventListener('click', (event) => handleDocumentAction(event, documentRef), true);
    bindSrsButtons(documentRef);

    if (typeof global.MutationObserver === 'function' && documentRef.body) {
      observer = new global.MutationObserver(() => bindSrsButtons(documentRef));
      observer.observe(documentRef.body, { childList: true, subtree: true });
    }
    documentListenersInstalled = true;
    return true;
  }

  function startCalibration(field) {
    calibrationField = field;
    log('calibração iniciada', { field });
  }

  function finishCalibration(element) {
    if (!calibrationField || !element || panelRefs?.root?.contains?.(element)) return false;
    const selector = selectorFor(element);
    saveConfig({ ...config, [calibrationField]: selector });
    log('calibração salva', { field: calibrationField, selector });
    calibrationField = null;
    return true;
  }

  function normalizeTag(value) {
    return normalizeButtonText(value)
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
  }

  function tsvField(value) {
    const normalized = String(value ?? '')
      .replace(/\r?\n/g, '<br>')
      .replace(/\t/g, ' ');
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  function cardToAnkiRow(rawCard, documentRef = global.document) {
    const card = cleanStoredCard(rawCard, documentRef);
    const validation = validateCardForExport(card);
    if (!validation.valid) throw new Error(`Card inválido (${card?.id || 'sem ID'}): ${validation.reasons.join(', ')}`);

    const question = prepareHtmlForAnki(card.question?.html || escapeHtml(card.question?.text), documentRef);
    const answer = prepareHtmlForAnki(card.answer?.html || escapeHtml(card.answer?.text), documentRef);
    const explanation = prepareHtmlForAnki(card.explanation?.html || escapeHtml(card.explanation?.text), documentRef);
    const topic = normalizeWhitespace(card.topic?.text || card.deck?.text || 'Osler');
    const source = scrubSensitiveUrl(card.url || 'https://oslermedicina.com.br/test');
    const front = `<span style="display:none">osler:${escapeHtml(card.id)}</span>${question}`;
    const back = [
      `<div class="osler-answer"><strong>Resposta</strong><br>${answer}</div>`,
      explanation ? `<hr><div class="osler-explanation"><strong>Explicação</strong><br>${explanation}</div>` : '',
      `<hr><div class="osler-meta"><small>Assunto: ${escapeHtml(topic)} · ID: ${escapeHtml(card.id)} · <a href="${escapeHtml(source)}">Osler</a></small></div>`,
    ].filter(Boolean).join('');
    const tags = ['osler', normalizeTag(topic)].filter(Boolean).join(' ');
    return [front, back, tags, EXPORT_DECK].map(tsvField).join('\t');
  }

  function exportableCards(cards = capturedCards, documentRef = global.document) {
    return cards
      .map((card) => cleanStoredCard(card, documentRef))
      .filter((card) => validateCardForExport(card).valid);
  }

  function buildAnkiTsv(cards = capturedCards, documentRef = global.document) {
    const validCards = exportableCards(cards, documentRef);
    const rows = validCards.map((card) => cardToAnkiRow(card, documentRef));
    const headers = [
      '#separator:Tab',
      '#html:true',
      '#tags:osler',
      '#columns:Frente\tVerso\tTags\tBaralho',
      '#tags column:3',
      '#deck column:4',
    ];
    return `\uFEFF${[...headers, ...rows].join('\n')}\n`;
  }

  function exportFilename(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `osler-anki-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.tsv`;
  }

  function createExportFile(cards = capturedCards, documentRef = global.document) {
    const validCards = exportableCards(cards, documentRef);
    if (!validCards.length) throw new Error('Não há cards válidos para exportar.');
    const contents = buildAnkiTsv(validCards, documentRef);
    return new File([contents], exportFilename(), { type: 'text/tab-separated-values;charset=utf-8' });
  }

  function downloadExport(cards = capturedCards, documentRef = global.document) {
    const file = createExportFile(cards, documentRef);
    const url = global.URL.createObjectURL(file);
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    anchor.style.display = 'none';
    documentRef.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout?.(() => global.URL.revokeObjectURL(url), 1000);
    log('arquivo TSV baixado', { filename: file.name, cards: exportableCards(cards, documentRef).length });
    return file;
  }

  async function shareExport(cards = capturedCards, documentRef = global.document, navigatorRef = global.navigator) {
    const file = createExportFile(cards, documentRef);
    const shareData = { title: 'Cards da Osler para o AnkiDroid', files: [file] };
    const canShareFiles = typeof navigatorRef?.share === 'function'
      && (typeof navigatorRef.canShare !== 'function' || navigatorRef.canShare(shareData));

    if (!canShareFiles) {
      downloadExport(cards, documentRef);
      log('compartilhamento indisponível; TSV baixado');
      return { mode: 'download', file };
    }

    await navigatorRef.share(shareData);
    log('TSV enviado ao compartilhamento do Android', { filename: file.name });
    return { mode: 'share', file };
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

  function panelJson() {
    return JSON.stringify({ config, queue: capturedCards }, null, 2);
  }

  function logsJson() {
    return JSON.stringify(logs, null, 2);
  }

  function renderPanel() {
    if (!panelRefs) return;
    panelRefs.output.textContent = panelJson();
    panelRefs.status.textContent = calibrationField
      ? `Toque no elemento de ${FIELD_LABELS[calibrationField]}`
      : `${capturedCards.length} card(s) na fila para o AnkiDroid`;
    const disabled = capturedCards.length === 0;
    panelRefs.send.disabled = disabled;
    panelRefs.download.disabled = disabled;
    panelRefs.clear.disabled = disabled;
  }

  function createPanel(documentRef = global.document) {
    const root = documentRef.createElement('section');
    root.id = 'osler-capture-diagnostics';
    root.innerHTML = `
      <strong>Osler Anki Bridge — Fase 2</strong>
      <p data-role="status"></p>
      <button type="button" data-action="send-anki">Enviar ao AnkiDroid</button>
      <button type="button" data-action="download-tsv">Baixar TSV</button>
      <button type="button" data-action="clear-queue">Limpar fila</button>
      <details>
        <summary>Diagnóstico e fallback</summary>
        <div data-role="calibration"></div>
        <button type="button" data-action="clear-calibration">Limpar calibração</button>
        <button type="button" data-action="copy-json">Copiar JSON</button>
        <button type="button" data-action="copy-logs">Copiar logs</button>
        <pre data-role="output"></pre>
      </details>
    `;
    root.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:430px;max-height:72vh;overflow:auto;background:#fff;color:#111;border:1px solid #999;border-radius:12px;padding:12px;font:12px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)';
    root.querySelectorAll('button').forEach((button) => {
      button.style.cssText = 'margin:3px;padding:7px 9px;';
    });

    const calibration = root.querySelector('[data-role="calibration"]');
    FIELD_ORDER.forEach((field) => {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.textContent = `Calibrar ${FIELD_LABELS[field]}`;
      button.addEventListener('click', () => startCalibration(field));
      calibration.appendChild(button);
    });

    root.querySelector('[data-action="send-anki"]').addEventListener('click', () => {
      shareExport().catch((error) => log('falha ao enviar TSV', { error: String(error?.message || error) }));
    });
    root.querySelector('[data-action="download-tsv"]').addEventListener('click', () => {
      try { downloadExport(); } catch (error) { log('falha ao baixar TSV', { error: String(error?.message || error) }); }
    });
    root.querySelector('[data-action="clear-queue"]').addEventListener('click', () => {
      const confirmed = typeof global.confirm !== 'function' || global.confirm('Limpar todos os cards da fila?');
      if (confirmed) clearQueue();
    });
    root.querySelector('[data-action="clear-calibration"]').addEventListener('click', () => clearCalibration());
    root.querySelector('[data-action="copy-json"]').addEventListener('click', () => copyText(panelJson()).then(() => log('JSON copiado')));
    root.querySelector('[data-action="copy-logs"]').addEventListener('click', () => copyText(logsJson()).then(() => log('logs copiados')));
    return root;
  }

  function install(documentRef = global.document) {
    if (!documentRef?.body || documentRef.getElementById('osler-capture-diagnostics')) return null;
    config = loadConfig();
    capturedCards = loadQueue(global.localStorage, documentRef);
    const root = createPanel(documentRef);
    documentRef.body.appendChild(root);
    panelRefs = {
      root,
      output: root.querySelector('[data-role="output"]'),
      status: root.querySelector('[data-role="status"]'),
      send: root.querySelector('[data-action="send-anki"]'),
      download: root.querySelector('[data-action="download-tsv"]'),
      clear: root.querySelector('[data-action="clear-queue"]'),
    };
    installDocumentListeners(documentRef);
    renderPanel();
    if (queueRepair.removed || queueRepair.cleaned) {
      log('fila reparada ao carregar', queueRepair);
    } else {
      log('fase 2 instalada: fila persistente e exportação TSV ativas');
    }
    return root;
  }

  const api = {
    bindSrsButtons,
    buildAnkiTsv,
    buildStableId,
    captureCard,
    cardToAnkiRow,
    cleanStoredCard,
    clearCalibration,
    clearQueue,
    createExportFile,
    createPanel,
    downloadExport,
    elementsBetween,
    escapeHtml,
    exportFilename,
    exportableCards,
    extractAnswers,
    extractIntermediateAnswer,
    extractOslerCard,
    extractTopic,
    findActionElement,
    findQuestionElement,
    finishCalibration,
    handleDocumentAction,
    install,
    installDocumentListeners,
    isVerdictOnly,
    loadConfig,
    loadQueue,
    logsJson,
    normalizeButtonText,
    normalizeTag,
    panelJson,
    paragraphRemainder,
    prepareHtmlForAnki,
    questionCandidateScore,
    readField,
    replaceClozesWithPlaceholders,
    sanitizeHtml,
    saveConfig,
    saveQueue,
    scrubSensitiveUrl,
    selectorFor,
    shareExport,
    stableHash,
    startCalibration,
    stripTopicPunctuation,
    triggerForButton,
    triggerFromOslerStructure,
    tsvField,
    validateCardForExport,
  };
  global.OslerCaptureDiagnostics = api;
  global.OslerAnkiBridge = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    install();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);

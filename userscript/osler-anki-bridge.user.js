// ==UserScript==
// @name         Osler Capture Diagnostics
// @namespace    https://github.com/osler-anki-bridge/osler-anki-bridge
// @version      0.3.2
// @description  Phase 1 automatic capture diagnostics for Osler cards. No network, AnkiDroid, or app integration.
// @match        https://oslermedicina.com.br/*
// @match        https://*.oslermedicina.com.br/*
// @updateURL    https://leonardolealluz183-bit.github.io/osler-anki-bridge/osler-anki-bridge.user.js
// @downloadURL  https://leonardolealluz183-bit.github.io/osler-anki-bridge/osler-anki-bridge.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function bootstrap(global) {
  'use strict';

  const STORAGE_KEY = 'oslerCaptureDiagnostics.config.v2';
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
  let lastGesture = { trigger: '', at: 0 };

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

  function log(message, details = {}) {
    const entry = { at: now(), message, details };
    logs.push(entry);
    if (logs.length > 200) logs = logs.slice(-200);
    renderPanel();
    return entry;
  }

  function loadConfig(storage = global.localStorage) {
    try {
      return JSON.parse(storage?.getItem(STORAGE_KEY) || '{}');
    } catch (_error) {
      return {};
    }
  }

  function saveConfig(nextConfig = config, storage = global.localStorage) {
    config = { ...nextConfig };
    storage?.setItem(STORAGE_KEY, JSON.stringify(config));
    renderPanel();
  }

  function clearCalibration(storage = global.localStorage) {
    config = {};
    storage?.removeItem?.(STORAGE_KEY);
    renderPanel();
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
      return isRelative
        ? `${parsed.pathname}${parsed.search}${parsed.hash}`
        : parsed.toString();
    } catch (_error) {
      return original
        .replace(/([?&])(token|access_token|auth|authorization|signature|sig|key|jwt)=[^&"'\s>]*/gi, '$1')
        .replace(/[?&]+$/g, '');
    }
  }

  function sanitizeHtml(html, documentRef = global.document) {
    const template = documentRef?.createElement?.('template');
    if (!template) return String(html || '').trim();
    template.innerHTML = html || '';

    if (!template.content?.querySelectorAll) {
      return String(html || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\s+on[a-z]+=(("[^"]*")|('[^']*')|[^\s>]+)/gi, '')
        .replace(/\s+(href|src|xlink:href|formaction)=(("|')?\s*(javascript|data):[^\s>]*(\3)?)/gi, '')
        .replace(/([?&])(token|access_token|auth|authorization|signature|sig|key|jwt)=[^&"'\s>]*/gi, '$1')
        .replace(/[?&]+(?=["'\s>])/g, '')
        .trim();
    }

    template.content.querySelectorAll('script, iframe, object, embed, link[rel="import"]').forEach((node) => node.remove());
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

  function findQuestionElement(explanationElement) {
    if (!explanationElement) return null;

    let fallback = null;
    let sibling = explanationElement.previousElementSibling;
    while (sibling) {
      if (String(sibling.tagName || '').toLowerCase() === 'p') {
        if (!fallback) fallback = sibling;
        if (sibling.querySelector?.('strong')) return sibling;
      }
      sibling = sibling.previousElementSibling;
    }
    if (fallback) return fallback;

    const parent = explanationElement.parentElement;
    if (!parent) return null;
    const children = Array.from(parent.children || []);
    const explanationIndex = children.indexOf(explanationElement);
    for (let index = explanationIndex - 1; index >= 0; index -= 1) {
      const candidate = children[index];
      if (String(candidate?.tagName || '').toLowerCase() !== 'p') continue;
      if (!fallback) fallback = candidate;
      if (candidate.querySelector?.('strong')) return candidate;
    }
    return fallback;
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
      const listItems = tag === 'li'
        ? [container]
        : Array.from(container.querySelectorAll?.('li') || []);
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

  function extractOslerCard(documentRef = global.document) {
    const explanationElement = documentRef?.querySelector?.('div.osler-card-explanation');
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
      question: {
        ...question,
        revealedText: question.text,
        revealedHtml: question.html,
      },
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

  function captureCard(trigger, documentRef = global.document) {
    const extracted = extractOslerCard(documentRef) || extractFallbackCard(documentRef);
    const card = {
      id: '',
      trigger,
      capturedAt: now(),
      url: global.location?.href || '',
      ...extracted,
    };
    card.id = buildStableId(card);

    if (!card.question?.text && !card.question?.revealedText) {
      log('captura ignorada: pergunta não encontrada', { trigger });
      return null;
    }
    if (capturedCards.some((existing) => existing.id === card.id)) {
      log('captura duplicada ignorada', { id: card.id, trigger });
      return null;
    }

    capturedCards.push(card);
    log('card capturado', { id: card.id, trigger });
    renderPanel();
    return card;
  }

  function triggerForButton(element) {
    const text = normalizeButtonText(element?.textContent);
    if (/(^|\s)acertei(\s|$)/.test(text)) return null;
    if (/(^|\s)errei(\s|$)/.test(text)) return 'botão Errei';
    if (/(^|\s)dificil(\s|$)/.test(text)) return 'botão Difícil';
    return null;
  }

  function findActionElement(target) {
    const closest = target?.closest?.('button,[role="button"]');
    if (closest && triggerForButton(closest)) return closest;

    let current = target;
    for (let depth = 0; current && depth < 5; depth += 1) {
      const tag = String(current.tagName || '').toLowerCase();
      const role = current.getAttribute?.('role');
      if ((tag === 'button' || role === 'button') && triggerForButton(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function handleDocumentAction(event, documentRef = global.document) {
    if (calibrationField) {
      if (!event.target || panelRefs?.root?.contains?.(event.target)) return null;
      if (event.type !== 'click') return null;
      event.preventDefault?.();
      event.stopPropagation?.();
      finishCalibration(event.target, documentRef);
      return 'calibration';
    }

    const actionElement = findActionElement(event.target);
    const trigger = triggerForButton(actionElement);
    if (!trigger) return null;

    const timestamp = Date.now();
    if (lastGesture.trigger === trigger && timestamp - lastGesture.at < 1000) return null;
    lastGesture = { trigger, at: timestamp };
    return captureCard(trigger, documentRef);
  }

  function handleDocumentClick(event, documentRef = global.document) {
    return handleDocumentAction(event, documentRef);
  }

  function startCalibration(field) {
    calibrationField = field;
    log('calibração iniciada', { field });
  }

  function finishCalibration(element, documentRef = global.document) {
    if (!calibrationField || !element || panelRefs?.root?.contains?.(element)) return false;
    const selector = selectorFor(element);
    saveConfig({ ...config, [calibrationField]: selector });
    log('calibração salva', { field: calibrationField, selector });
    calibrationField = null;
    return true;
  }

  function installDocumentListeners(documentRef = global.document) {
    if (documentListenersInstalled || !documentRef?.addEventListener) return false;
    documentRef.addEventListener('pointerdown', (event) => handleDocumentAction(event, documentRef), true);
    documentRef.addEventListener('click', (event) => handleDocumentAction(event, documentRef), true);
    documentListenersInstalled = true;
    return true;
  }

  function installDocumentListener(documentRef = global.document) {
    return installDocumentListeners(documentRef);
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
    return JSON.stringify({ config, capturedCards }, null, 2);
  }

  function logsJson() {
    return JSON.stringify(logs, null, 2);
  }

  function renderPanel() {
    if (!panelRefs) return;
    panelRefs.output.textContent = panelJson();
    panelRefs.status.textContent = calibrationField
      ? `Toque no elemento de ${FIELD_LABELS[calibrationField]}`
      : `${capturedCards.length} card(s) capturado(s) — extração automática ativa`;
  }

  function createPanel(documentRef = global.document) {
    const root = documentRef.createElement('section');
    root.id = 'osler-capture-diagnostics';
    root.innerHTML = `
      <strong>Osler Capture Diagnostics — Fase 1</strong>
      <p data-role="status"></p>
      <details>
        <summary>Calibração manual (fallback)</summary>
        <div data-role="calibration"></div>
        <button type="button" data-action="clear-calibration">Limpar calibração</button>
      </details>
      <button type="button" data-action="copy-json">Copiar JSON</button>
      <button type="button" data-action="copy-logs">Copiar logs</button>
      <pre data-role="output"></pre>
    `;
    root.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:420px;max-height:70vh;overflow:auto;background:#fff;color:#111;border:1px solid #999;border-radius:12px;padding:12px;font:12px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)';

    const calibration = root.querySelector('[data-role="calibration"]');
    FIELD_ORDER.forEach((field) => {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.textContent = `Calibrar ${FIELD_LABELS[field]}`;
      button.addEventListener('click', () => startCalibration(field));
      calibration.appendChild(button);
    });
    root.querySelector('[data-action="clear-calibration"]').addEventListener('click', () => clearCalibration());
    root.querySelector('[data-action="copy-json"]').addEventListener('click', () => copyText(panelJson()).then(() => log('JSON copiado')));
    root.querySelector('[data-action="copy-logs"]').addEventListener('click', () => copyText(logsJson()).then(() => log('logs copiados')));
    return root;
  }

  function install(documentRef = global.document) {
    if (!documentRef?.body || documentRef.getElementById('osler-capture-diagnostics')) return null;
    config = loadConfig();
    const root = createPanel(documentRef);
    documentRef.body.appendChild(root);
    panelRefs = {
      root,
      output: root.querySelector('[data-role="output"]'),
      status: root.querySelector('[data-role="status"]'),
    };
    installDocumentListeners(documentRef);
    renderPanel();
    log('userscript instalado: extração automática ativa, sem integrações externas');
    return root;
  }

  const api = {
    buildStableId,
    captureCard,
    clearCalibration,
    createPanel,
    elementsBetween,
    extractAnswers,
    extractIntermediateAnswer,
    extractOslerCard,
    extractTopic,
    findActionElement,
    findQuestionElement,
    finishCalibration,
    handleDocumentAction,
    handleDocumentClick,
    install,
    installDocumentListener,
    installDocumentListeners,
    loadConfig,
    logsJson,
    normalizeButtonText,
    panelJson,
    readField,
    replaceClozesWithPlaceholders,
    sanitizeHtml,
    saveConfig,
    scrubSensitiveUrl,
    selectorFor,
    stableHash,
    startCalibration,
    stripTopicPunctuation,
    triggerForButton,
  };
  global.OslerCaptureDiagnostics = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    install();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);

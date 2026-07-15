// ==UserScript==
// @name         Osler Capture Diagnostics
// @namespace    https://github.com/osler-anki-bridge/osler-anki-bridge
// @version      0.2.0
// @description  Phase 1 capture and diagnostics userscript for Osler cards. No network, AnkiDroid, or app integration.
// @match        https://*.osler.app/*
// @match        https://*.osler.com/*
// @match        http://localhost:*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function bootstrap(global) {
  'use strict';

  const STORAGE_KEY = 'oslerCaptureDiagnostics.config.v1';
  const FIELD_LABELS = {
    question: 'pergunta',
    answer: 'resposta',
    explanation: 'explicação',
    deck: 'assunto/deck',
    wrongButton: 'botão Errei',
    hardButton: 'botão Difícil',
  };
  const FIELD_ORDER = Object.keys(FIELD_LABELS);
  const DANGEROUS_ATTR = /^(on|srcdoc$)/i;
  const URL_ATTR = /^(href|src|xlink:href|formaction)$/i;
  const DANGEROUS_URL = /^\s*(javascript|data):/i;

  let calibrationField = null;
  let capturedCards = [];
  let logs = [];
  let config = {};
  let panelRefs = null;

  function now() {
    return new Date().toISOString();
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
      if (current.classList?.length) part += `.${Array.from(current.classList).slice(0, 2).map(cssEscape).join('.')}`;
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ');
  }

  function sanitizeHtml(html, documentRef = global.document) {
    const template = documentRef.createElement('template');
    template.innerHTML = html || '';
    if (!template.content?.querySelectorAll) {
      return String(html || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\s+on[a-z]+=("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\s+(href|src|xlink:href|formaction)=("|')?\s*(javascript|data):[^\s>]*(\2)?/gi, '')
        .trim();
    }
    template.content.querySelectorAll('script, iframe, object, embed, link[rel="import"]').forEach((node) => node.remove());
    template.content.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes).forEach((attr) => {
        if (DANGEROUS_ATTR.test(attr.name) || (URL_ATTR.test(attr.name) && DANGEROUS_URL.test(attr.value))) {
          node.removeAttribute(attr.name);
        }
      });
    });
    return template.innerHTML.trim();
  }

  function readField(selector, documentRef = global.document) {
    const element = selector ? documentRef.querySelector(selector) : null;
    if (!element) return { selector, text: '', html: '' };
    return {
      selector,
      text: element.textContent.replace(/\s+/g, ' ').trim(),
      html: sanitizeHtml(element.innerHTML, documentRef),
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
      card.question.text,
      card.answer.text,
      card.explanation.text,
      card.deck.text,
    ].join('\n---\n'));
  }

  function captureCard(trigger, documentRef = global.document) {
    const card = {
      id: '',
      trigger,
      capturedAt: now(),
      url: global.location?.href || '',
      question: readField(config.question, documentRef),
      answer: readField(config.answer, documentRef),
      explanation: readField(config.explanation, documentRef),
      deck: readField(config.deck, documentRef),
    };
    card.id = buildStableId(card);

    if (capturedCards.some((existing) => existing.id === card.id)) {
      log('captura duplicada ignorada', { id: card.id, trigger });
      return null;
    }

    capturedCards.push(card);
    log('card capturado', { id: card.id, trigger });
    renderPanel();
    return card;
  }

  function startCalibration(field) {
    calibrationField = field;
    log('calibração iniciada', { field });
  }

  function finishCalibration(element, documentRef = global.document) {
    if (!calibrationField || !element || panelRefs?.root?.contains(element)) return false;
    const selector = selectorFor(element);
    saveConfig({ ...config, [calibrationField]: selector });
    log('calibração salva', { field: calibrationField, selector });
    calibrationField = null;
    bindCaptureButtons(documentRef);
    return true;
  }

  function bindCaptureButtons(documentRef = global.document) {
    documentRef.querySelectorAll('[data-osler-capture-bound]').forEach((element) => {
      element.removeAttribute('data-osler-capture-bound');
    });

    ['wrongButton', 'hardButton'].forEach((field) => {
      const element = config[field] ? documentRef.querySelector(config[field]) : null;
      if (!element) return;
      element.setAttribute('data-osler-capture-bound', field);
      element.addEventListener('click', () => captureCard(FIELD_LABELS[field], documentRef), { capture: true });
    });
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
      : `${capturedCards.length} card(s) capturado(s)`;
  }

  function createPanel(documentRef = global.document) {
    const root = documentRef.createElement('section');
    root.id = 'osler-capture-diagnostics';
    root.innerHTML = `
      <strong>Osler Capture Diagnostics — Fase 1</strong>
      <p data-role="status"></p>
      <div data-role="calibration"></div>
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
    documentRef.addEventListener('click', (event) => {
      if (!calibrationField) return;
      event.preventDefault();
      event.stopPropagation();
      finishCalibration(event.target, documentRef);
    }, true);
    bindCaptureButtons(documentRef);
    renderPanel();
    log('userscript instalado sem integrações externas');
    return root;
  }

  const api = {
    bindCaptureButtons,
    buildStableId,
    captureCard,
    createPanel,
    finishCalibration,
    install,
    loadConfig,
    logsJson,
    panelJson,
    readField,
    sanitizeHtml,
    saveConfig,
    selectorFor,
    stableHash,
    startCalibration,
  };
  global.OslerCaptureDiagnostics = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    install();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);

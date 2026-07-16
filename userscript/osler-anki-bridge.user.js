// ==UserScript==
// @name         Osler Anki Bridge
// @namespace    https://github.com/osler-anki-bridge/osler-anki-bridge
// @version      0.4.9
// @description  Captura transacional da Osler em um único script, com fila redundante, avanço confirmado e exportação recuperável.
// @match        https://oslermedicina.com.br/*
// @match        https://*.oslermedicina.com.br/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-bridge.user.js
// @downloadURL  https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-bridge.user.js
// ==/UserScript==

(function bootstrap() {
  'use strict';

  const VERSION = '0.4.9';
  const QUEUE_KEY = 'oslerAnkiBridge.queue.v1';
  const QUEUE_BACKUP_KEY = 'oslerAnkiBridge.queue.backup.v1';
  const AUDIT_KEY = 'oslerAnkiBridge.audit.v1';
  const AUDIT_BACKUP_KEY = 'oslerAnkiBridge.audit.backup.v1';
  const FALLBACK_DECK = 'Osler';
  const PANEL_ID = 'osler-anki-bridge-v049';
  const CLOZE_SELECTOR = '.cloze-answer,[class*="cloze-answer"],[class*="ClozeAnswer"],[class*="clozeAnswer"]';
  const SENSITIVE_QUERY_PARAM = /^(token|access_token|auth|authorization|signature|sig|key|jwt)$/i;
  const CAPTURE_RETRY_MS = 60;
  const CAPTURE_TIMEOUT_MS = 2500;
  const ADVANCE_CONFIRM_MS = 950;
  const ADVANCE_POLL_MS = 50;

  const pageWindow = typeof unsafeWindow !== 'undefined'
    ? unsafeWindow
    : (typeof window !== 'undefined' ? window : globalThis);
  const documentRef = pageWindow.document || globalThis.document;

  let queue = [];
  let audit = [];
  let panel = null;
  let loadedAtStart = 0;
  let sessionStats = { added: 0, duplicate: 0, failed: 0 };
  let globalListenersInstalled = false;
  let lastKnownPath = '';
  let ratingTransaction = null;
  let nativeReplayUntil = 0;
  let pendingAdvance = null;
  let exportDirty = true;
  let exportPreparedCount = 0;
  let exportUrls = { tsv: '', log: '' };
  let lastExport = { tsv: '', log: '', backup: '', tsvName: '', logName: '' };

  const now = () => new Date().toISOString();
  const sleep = (milliseconds) => new Promise((resolve) => pageWindow.setTimeout(resolve, milliseconds));
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

  function pageMode(locationRef = pageWindow.location) {
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
      const parsed = new URL(original, pageWindow.location?.origin || 'https://oslermedicina.com.br');
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

  function sanitizeHtml(html, doc = documentRef) {
    const template = doc?.createElement?.('template');
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

  function prepareHtmlForAnki(html, doc = documentRef) {
    const clean = sanitizeHtml(html, doc);
    const template = doc?.createElement?.('template');
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
      const placeholder = doc.createElement('div');
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

    const style = pageWindow.getComputedStyle?.(element);
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

    const viewportWidth = Number(pageWindow.innerWidth) || Number(documentRef?.documentElement?.clientWidth) || 1920;
    const viewportHeight = Number(pageWindow.innerHeight) || Number(documentRef?.documentElement?.clientHeight) || 1080;
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
    if (!first || !second || first === second || typeof first.compareDocumentPosition !== 'function' || !pageWindow.Node) return false;
    return Boolean(first.compareDocumentPosition(second) & pageWindow.Node.DOCUMENT_POSITION_FOLLOWING);
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

  function findQuestionElement(doc = documentRef) {
    const candidates = Array.from(doc.querySelectorAll?.('p') || []);
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

  function findExplanationForQuestion(question, doc = documentRef) {
    if (!question) return null;
    const explanations = Array.from(doc.querySelectorAll?.('div.osler-card-explanation') || [])
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
    for (let depth = 0; current && current !== documentRef?.body && depth < 7; depth += 1) {
      fallback = current;
      if (contentCandidates(current, question, null).length) return current;
      current = current.parentElement;
    }
    return fallback;
  }

  function replaceClozesWithBlank(root, doc) {
    Array.from(root?.querySelectorAll?.(CLOZE_SELECTOR) || []).forEach((node) => {
      node.replaceWith(doc.createTextNode('[...]'));
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

  function extractResponse(question, explanation, root, doc = documentRef) {
    const allClozes = clozesInCard(root, question, explanation);
    if (allClozes.length) {
      const items = allClozes.map((node) => ({
        text: normalizeWhitespace(node.textContent),
        html: sanitizeHtml(node.innerHTML, doc),
      })).filter((item) => item.text || item.html);

      const candidates = contentCandidates(root, question, explanation);
      const contextBlocks = candidates.filter((block) => allClozes.some((cloze) => block.contains?.(cloze)));
      const contextHtml = [];
      const contextText = [];
      contextBlocks.forEach((block) => {
        const clone = block.cloneNode(true);
        replaceClozesWithBlank(clone, doc);
        contextHtml.push(sanitizeHtml(clone.outerHTML || clone.innerHTML, doc));
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
          html: sanitizeHtml(node.innerHTML, doc),
        });
      });
    });

    return {
      answer: {
        source: explanation ? 'intermediate-block' : 'card-body',
        items,
        text: items.map((item) => item.text).filter(Boolean).join('\n'),
        html: selected.map((node) => sanitizeHtml(node.outerHTML || node.innerHTML, doc)).join('\n'),
      },
      frontContext: { text: '', html: '' },
    };
  }

  function extractCard(doc = documentRef) {
    if (pageMode() !== 'test') return null;
    const questionElement = findQuestionElement(doc);
    if (!questionElement) return null;
    const explanationElement = findExplanationForQuestion(questionElement, doc);
    const root = chooseRoot(questionElement, explanationElement);
    if (!root) return null;

    const questionClone = questionElement.cloneNode(true);
    replaceClozesWithBlank(questionClone, doc);
    const topicElement = questionElement.querySelector('strong');
    const topic = normalizeWhitespace(topicElement?.textContent).replace(/[\s.:;,!?–—-]+$/u, '');
    const response = extractResponse(questionElement, explanationElement, root, doc);
    const hiddenQuestionText = normalizeWhitespace([
      questionClone.textContent,
      response.frontContext.text,
    ].filter(Boolean).join(' '));
    const hiddenQuestionHtml = [
      sanitizeHtml(questionClone.innerHTML, doc),
      response.frontContext.html,
    ].filter(Boolean).join('\n');
    const explanationText = explanationElement ? normalizeWhitespace(explanationElement.textContent) : '';
    const explanationHtml = explanationElement ? sanitizeHtml(explanationElement.innerHTML, doc) : '';

    const card = {
      id: '',
      trigger: '',
      capturedAt: now(),
      url: pageWindow.location?.href || '',
      question: {
        text: hiddenQuestionText,
        html: hiddenQuestionHtml,
        revealedText: normalizeWhitespace(questionElement.textContent),
        revealedHtml: sanitizeHtml(questionElement.innerHTML, doc),
      },
      answer: response.answer,
      explanation: { text: explanationText, html: explanationHtml },
      topic: { text: topic, html: sanitizeHtml(topicElement?.innerHTML || escapeHtml(topic), doc) },
      deck: { text: topic, html: sanitizeHtml(topicElement?.innerHTML || escapeHtml(topic), doc) },
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

  function parseStoredValue(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function mergeCardArrays(...arrays) {
    const merged = [];
    const ids = new Set();
    arrays.flat().forEach((card) => {
      if (!card?.id || ids.has(card.id) || !validateCard(card).valid) return;
      ids.add(card.id);
      merged.push(card);
    });
    return merged;
  }

  function mergeAuditArrays(...arrays) {
    const merged = [];
    const keys = new Set();
    arrays.flat().forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const key = [entry.at, entry.status, entry.id, entry.trigger, entry.detail].join('|');
      if (keys.has(key)) return;
      keys.add(key);
      merged.push(entry);
    });
    return merged.sort((first, second) => String(first.at || '').localeCompare(String(second.at || ''))).slice(-500);
  }

  async function gmGetValueSafe(key, fallback) {
    if (typeof GM_getValue !== 'function') return fallback;
    try {
      const result = GM_getValue(key, fallback);
      return result && typeof result.then === 'function' ? await result : result;
    } catch (_error) {
      return fallback;
    }
  }

  async function gmSetValueSafe(key, value) {
    if (typeof GM_setValue !== 'function') return false;
    try {
      const result = GM_setValue(key, value);
      if (result && typeof result.then === 'function') await result;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function readLocalArray(key) {
    try {
      return parseStoredValue(pageWindow.localStorage?.getItem?.(key));
    } catch (_error) {
      return [];
    }
  }

  function writeLocalArray(key, value) {
    try {
      pageWindow.localStorage?.setItem?.(key, JSON.stringify(value));
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function loadState() {
    const [gmQueue, gmQueueBackup, gmAudit, gmAuditBackup] = await Promise.all([
      gmGetValueSafe(QUEUE_KEY, []),
      gmGetValueSafe(QUEUE_BACKUP_KEY, []),
      gmGetValueSafe(AUDIT_KEY, []),
      gmGetValueSafe(AUDIT_BACKUP_KEY, []),
    ]);

    queue = mergeCardArrays(
      parseStoredValue(gmQueue),
      parseStoredValue(gmQueueBackup),
      readLocalArray(QUEUE_KEY),
      readLocalArray(QUEUE_BACKUP_KEY),
    );
    audit = mergeAuditArrays(
      parseStoredValue(gmAudit),
      parseStoredValue(gmAuditBackup),
      readLocalArray(AUDIT_KEY),
      readLocalArray(AUDIT_BACKUP_KEY),
    );
    loadedAtStart = queue.length;
    await persistQueue();
    await persistAudit();
  }

  async function persistQueue() {
    exportDirty = true;
    const snapshot = JSON.parse(JSON.stringify(queue));
    await Promise.all([
      gmSetValueSafe(QUEUE_KEY, snapshot),
      gmSetValueSafe(QUEUE_BACKUP_KEY, snapshot),
    ]);
    writeLocalArray(QUEUE_KEY, snapshot);
    writeLocalArray(QUEUE_BACKUP_KEY, snapshot);
    renderPanel();
  }

  async function persistAudit() {
    audit = audit.slice(-500);
    exportDirty = true;
    const snapshot = JSON.parse(JSON.stringify(audit));
    await Promise.all([
      gmSetValueSafe(AUDIT_KEY, snapshot),
      gmSetValueSafe(AUDIT_BACKUP_KEY, snapshot),
    ]);
    writeLocalArray(AUDIT_KEY, snapshot);
    writeLocalArray(AUDIT_BACKUP_KEY, snapshot);
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

  async function recordAudit(status, trigger, card, detail = '') {
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
      url: scrubSensitiveUrl(pageWindow.location?.href || ''),
    };
    audit.push(entry);
    audit = audit.slice(-500);
    if (Object.prototype.hasOwnProperty.call(sessionStats, status)) sessionStats[status] += 1;
    await persistAudit();
    return entry;
  }

  function summarizeLastFailure(events = audit) {
    const failures = events.filter((entry) => entry?.status === 'failed');
    const last = failures.at(-1);
    if (!last) return { exists: false, recovered: false, text: 'Nenhuma falha registrada.' };
    const recovered = events.some((entry) => {
      if (entry?.status !== 'added') return false;
      if (last.id && entry.id === last.id) return true;
      return last.question && entry.question === last.question && String(entry.at || '') > String(last.at || '');
    });
    const label = shortLabel(last.question || last.topic || 'pergunta não identificada', 150);
    return {
      exists: true,
      recovered,
      text: `Última falha: ${label} — ${last.detail || 'motivo não registrado'}${recovered ? ' — capturada depois.' : ' — ainda sem captura posterior confirmada.'}`,
    };
  }

  async function commitCard(card, trigger) {
    const validation = validateCard(card);
    if (!validation.valid) return { status: 'not-ready', card: null, reasons: validation.reasons };

    const copy = JSON.parse(JSON.stringify(card));
    copy.trigger = trigger;
    copy.capturedAt = now();
    const duplicate = queue.find((item) => item.id === copy.id);
    if (duplicate) {
      await recordAudit('duplicate', trigger, copy, 'ID já presente na fila');
      setMessage(`DUPLICADO — ${shortLabel(copy.question.text)}`, 'duplicate');
      return { status: 'duplicate', card: duplicate, reasons: [] };
    }

    queue.push(copy);
    await persistQueue();
    await recordAudit('added', trigger, copy, 'adicionado à fila antes de avançar');
    setMessage(`SALVO — ${shortLabel(copy.question.text)}`, 'added');
    return { status: 'added', card: copy, reasons: [] };
  }

  async function capture(trigger, doc = documentRef) {
    if (pageMode() !== 'test') {
      setMessage('Captura pausada nesta página. Volte à tela do card.', 'failed');
      return { status: 'failed', card: null, reasons: ['fora da tela de teste'] };
    }
    const card = extractCard(doc);
    const result = await commitCard(card, trigger);
    if (result.status !== 'not-ready') return result;
    const question = shortLabel(findQuestionElement(doc)?.textContent);
    const detail = result.reasons.join(', ') || 'card não identificado';
    await recordAudit('failed', trigger, card, detail);
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

  function findRatingButton(trigger, doc = documentRef) {
    return Array.from(doc.querySelectorAll?.('button,[role="button"]') || [])
      .filter((button) => isVisible(button) && ratingTrigger(button) === trigger)
      .sort((first, second) => {
        const firstMetrics = visibilityMetrics(first);
        const secondMetrics = visibilityMetrics(second);
        return (secondMetrics.ratio - firstMetrics.ratio)
          || (firstMetrics.centerDistance - secondMetrics.centerDistance);
      })[0] || null;
  }

  function advanceSnapshot(doc = documentRef) {
    const questionElement = findQuestionElement(doc);
    return {
      questionElement,
      questionText: normalizeWhitespace(questionElement?.textContent),
      hadRatingButtons: Boolean(findRatingButton('Errei', doc) || findRatingButton('Difícil', doc)),
    };
  }

  function hasAdvanced(snapshot, doc = documentRef) {
    if (!snapshot) return false;
    if (pageMode() !== 'test') return true;
    const currentQuestion = findQuestionElement(doc);
    const currentText = normalizeWhitespace(currentQuestion?.textContent);
    if (snapshot.questionElement && currentQuestion && currentQuestion !== snapshot.questionElement) return true;
    if (snapshot.questionText && currentText && currentText !== snapshot.questionText) return true;
    const hasButtons = Boolean(findRatingButton('Errei', doc) || findRatingButton('Difícil', doc));
    return Boolean(snapshot.hadRatingButtons && !hasButtons && currentQuestion);
  }

  async function waitForAdvance(snapshot, doc = documentRef, timeoutMs = ADVANCE_CONFIRM_MS) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (hasAdvanced(snapshot, doc)) return true;
      await sleep(ADVANCE_POLL_MS);
    }
    return hasAdvanced(snapshot, doc);
  }

  function nativeButtonClick(trigger, doc, preferredButton = null) {
    const button = preferredButton && preferredButton.isConnected && isVisible(preferredButton)
      ? preferredButton
      : findRatingButton(trigger, doc);
    if (!button) return false;
    nativeReplayUntil = Date.now() + 1800;
    button.focus?.({ preventScroll: true });
    button.click();
    return true;
  }

  function nativePointerSequence(trigger, doc) {
    const button = findRatingButton(trigger, doc);
    if (!button) return false;
    nativeReplayUntil = Date.now() + 1800;
    button.focus?.({ preventScroll: true });
    const rect = button.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: pageWindow,
      clientX: Number(rect.left || 0) + Number(rect.width || 1) / 2,
      clientY: Number(rect.top || 0) + Number(rect.height || 1) / 2,
      button: 0,
      buttons: 1,
    };
    const PointerCtor = pageWindow.PointerEvent || pageWindow.MouseEvent;
    const MouseCtor = pageWindow.MouseEvent;
    if (PointerCtor) {
      button.dispatchEvent(new PointerCtor('pointerdown', init));
      button.dispatchEvent(new PointerCtor('pointerup', { ...init, buttons: 0 }));
    }
    if (MouseCtor) {
      button.dispatchEvent(new MouseCtor('mousedown', init));
      button.dispatchEvent(new MouseCtor('mouseup', { ...init, buttons: 0 }));
      button.dispatchEvent(new MouseCtor('click', { ...init, buttons: 0 }));
    } else {
      button.click();
    }
    return true;
  }

  function nativeKeyboardReplay(trigger, doc = documentRef) {
    const KeyboardCtor = pageWindow.KeyboardEvent;
    if (!KeyboardCtor) return false;
    nativeReplayUntil = Date.now() + 1800;
    const descriptor = trigger === 'Errei'
      ? { key: '1', code: 'Digit1', keyCode: 49 }
      : { key: '2', code: 'Digit2', keyCode: 50 };
    const target = doc.activeElement || doc.body || doc;
    ['keydown', 'keyup'].forEach((type) => {
      const event = new KeyboardCtor(type, {
        key: descriptor.key,
        code: descriptor.code,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      try {
        Object.defineProperty(event, 'keyCode', { get: () => descriptor.keyCode });
        Object.defineProperty(event, 'which', { get: () => descriptor.keyCode });
      } catch (_error) {
        // Propriedades opcionais.
      }
      target.dispatchEvent(event);
    });
    return true;
  }

  async function advanceAndConfirm(trigger, doc = documentRef, preferredButton = null, snapshot = null) {
    const baseline = snapshot || advanceSnapshot(doc);
    if (hasAdvanced(baseline, doc)) return { advanced: true, method: 'already-advanced' };
    const attempts = [
      ['click', () => nativeButtonClick(trigger, doc, preferredButton)],
      ['pointer', () => nativePointerSequence(trigger, doc)],
      ['keyboard', () => nativeKeyboardReplay(trigger, doc)],
    ];
    for (const [method, invoke] of attempts) {
      if (hasAdvanced(baseline, doc)) return { advanced: true, method: 'already-advanced' };
      if (!invoke()) continue;
      if (await waitForAdvance(baseline, doc)) return { advanced: true, method };
    }
    return { advanced: false, method: '' };
  }

  async function waitForValidCard(doc, startedAt) {
    let card = null;
    let validation = { valid: false, reasons: ['card não identificado'] };
    while (Date.now() - startedAt < CAPTURE_TIMEOUT_MS) {
      card = extractCard(doc);
      validation = validateCard(card);
      if (validation.valid) return { card, validation };
      await sleep(CAPTURE_RETRY_MS);
    }
    return { card, validation };
  }

  function startRatingTransaction(trigger, doc = documentRef, source = 'keyboard', preferredButton = null) {
    if (pageMode() !== 'test') return Promise.resolve({ status: 'failed', reasons: ['fora da tela de teste'] });
    if (ratingTransaction) {
      setMessage('AGUARDE — o card anterior ainda está sendo salvo ou avançado.', 'waiting');
      return ratingTransaction.promise;
    }

    const transactionState = { trigger, source, phase: 'starting', promise: null };
    ratingTransaction = transactionState;
    const transaction = (async () => {
      const startedAt = Date.now();
      const questionAtStart = shortLabel(findQuestionElement(doc)?.textContent);
      const snapshot = advanceSnapshot(doc);
      transactionState.phase = 'capturing';
      renderPanel();
      setMessage(`AGUARDANDO RESPOSTA — ${questionAtStart}`, 'waiting');

      const { card, validation } = await waitForValidCard(doc, startedAt);
      if (!validation.valid) {
        const detail = validation.reasons.join(', ') || 'resposta não apareceu';
        await recordAudit('failed', `${source === 'keyboard' ? 'tecla' : 'botão'} ${trigger}`, card, `bloqueado sem avançar: ${detail}`);
        setMessage(`NÃO AVANÇOU — ${questionAtStart} — ${detail}. Mostre a resposta e tente novamente.`, 'failed');
        return { status: 'failed', card: null, reasons: validation.reasons, advanced: false };
      }

      const auditTrigger = `${source === 'keyboard' ? 'tecla' : 'botão'} ${trigger}`;
      let result;
      if (pendingAdvance && pendingAdvance.id === card.id) {
        result = { status: 'already-saved', card, reasons: [] };
        setMessage(`JÁ SALVO — tentando avançar novamente: ${shortLabel(card.question.text)}`, 'waiting');
      } else {
        result = await commitCard(card, auditTrigger);
      }

      if (!['added', 'duplicate', 'already-saved'].includes(result.status)) return result;
      transactionState.phase = 'advancing';
      renderPanel();
      setMessage(`SALVO — avançando: ${shortLabel(card.question.text)}`, 'waiting');
      const { advanced, method } = await advanceAndConfirm(trigger, doc, preferredButton, snapshot);
      if (advanced) {
        pendingAdvance = null;
        setMessage(`SALVO E AVANÇOU — ${shortLabel(card.question.text)}`, 'added');
      } else {
        pendingAdvance = { id: card.id, trigger, at: Date.now() };
        setMessage(`SALVO, MAS NÃO AVANÇOU — pressione ${trigger === 'Errei' ? '1' : '2'} novamente. O card não será duplicado.`, 'failed');
      }
      return { ...result, advanced, advanceMethod: method };
    })();

    transactionState.promise = transaction;
    transaction.finally(() => {
      ratingTransaction = null;
      renderPanel();
    });
    return transaction;
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
    if (event.key === '1' || event.code === 'Numpad1' || event.code === 'Digit1') return 'Errei';
    if (event.key === '2' || event.code === 'Numpad2' || event.code === 'Digit2') return 'Difícil';
    return null;
  }

  function blockEvent(event) {
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  }

  function ensureGlobalListeners(doc = documentRef) {
    if (globalListenersInstalled) return;
    globalListenersInstalled = true;

    const keyboardHandler = (event) => {
      if (pageMode() !== 'test' || Date.now() < nativeReplayUntil) return;
      const trigger = keyTriggerForEvent(event);
      if (!trigger) return;
      blockEvent(event);
      if (event.type === 'keydown') startRatingTransaction(trigger, doc, 'keyboard');
    };
    pageWindow.addEventListener?.('keydown', keyboardHandler, true);
    pageWindow.addEventListener?.('keyup', keyboardHandler, true);

    doc.addEventListener('click', (event) => {
      if (pageMode() !== 'test' || Date.now() < nativeReplayUntil) return;
      const path = event.composedPath?.() || [event.target];
      const button = path.find((node) => ratingTrigger(node));
      const trigger = ratingTrigger(button);
      if (!trigger) return;
      blockEvent(event);
      startRatingTransaction(trigger, doc, 'button', button?.closest?.('button,[role="button"]') || button);
    }, true);
  }

  function tsvField(value) {
    const normalized = String(value || '').replace(/\r?\n/g, '<br>').replace(/\t/g, ' ');
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  function normalizeTag(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  }

  function deckNameForCard(card) {
    const raw = normalizeWhitespace(card?.topic?.text || card?.deck?.text || FALLBACK_DECK)
      .replace(/::+/g, ' — ')
      .replace(/[\t\r\n]+/g, ' ')
      .trim();
    return raw.slice(0, 100) || FALLBACK_DECK;
  }

  function buildTsvFromQueue(cards, doc = documentRef) {
    const headers = [
      '#separator:Tab',
      '#html:true',
      '#tags:osler',
      '#columns:Frente\tVerso\tTags\tBaralho',
      '#tags column:3',
      '#deck column:4',
    ];
    const rows = cards.filter((card) => validateCard(card).valid).map((card) => {
      const question = prepareHtmlForAnki(card.question.html || escapeHtml(card.question.text), doc);
      const answer = prepareHtmlForAnki(card.answer.html || escapeHtml(card.answer.text), doc);
      const explanation = prepareHtmlForAnki(card.explanation.html || escapeHtml(card.explanation.text), doc);
      const front = `<span style="display:none">osler:${escapeHtml(card.id)}</span>${question}`;
      const explanationBlock = explanation ? `<hr><div><strong>Explicação</strong><br>${explanation}</div>` : '';
      const back = `<div><strong>Resposta</strong><br>${answer}</div>${explanationBlock}<hr><small>Assunto: ${escapeHtml(card.topic.text)} · ID: ${escapeHtml(card.id)} · <a href="${escapeHtml(scrubSensitiveUrl(card.url))}">Osler</a></small>`;
      return [front, back, `osler ${normalizeTag(card.topic.text)}`, deckNameForCard(card)].map(tsvField).join('\t');
    });
    return `\uFEFF${[...headers, ...rows].join('\n')}\n`;
  }

  function buildAuditPayload() {
    return `${JSON.stringify({
      version: VERSION,
      exportedAt: now(),
      loadedAtStart,
      queueSize: queue.length,
      sessionStats,
      pendingAdvance,
      lastFailure: summarizeLastFailure(audit),
      events: audit,
    }, null, 2)}\n`;
  }

  function buildBackupPayload() {
    return JSON.stringify({
      format: 'osler-anki-bridge-backup',
      version: VERSION,
      exportedAt: now(),
      queue,
      audit,
    }, null, 2);
  }

  function revokeExportUrl(key) {
    if (!exportUrls[key]) return;
    try { pageWindow.URL.revokeObjectURL(exportUrls[key]); } catch (_error) { /* sem ação */ }
    exportUrls[key] = '';
  }

  function makeObjectUrl(contents, mimeType) {
    return pageWindow.URL.createObjectURL(new pageWindow.Blob([contents], { type: mimeType }));
  }

  function prepareExports() {
    if (!panel) return null;
    const timestamp = Date.now();
    lastExport.tsv = buildTsvFromQueue(queue, documentRef);
    lastExport.log = buildAuditPayload();
    lastExport.backup = buildBackupPayload();
    lastExport.tsvName = `osler-anki-${timestamp}.tsv`;
    lastExport.logName = `osler-anki-diagnostico-${timestamp}.json`;

    revokeExportUrl('tsv');
    revokeExportUrl('log');
    exportUrls.tsv = makeObjectUrl(lastExport.tsv, 'text/tab-separated-values;charset=utf-8');
    exportUrls.log = makeObjectUrl(lastExport.log, 'application/json;charset=utf-8');

    const tsvDownload = panel.querySelector('[data-role="tsv-download"]');
    const tsvOpen = panel.querySelector('[data-role="tsv-open"]');
    const logDownload = panel.querySelector('[data-role="log-download"]');
    [tsvDownload, tsvOpen].forEach((link) => {
      if (!link) return;
      link.href = exportUrls.tsv;
      link.download = lastExport.tsvName;
    });
    if (tsvOpen) {
      tsvOpen.removeAttribute('download');
      tsvOpen.target = '_blank';
    }
    if (logDownload) {
      logDownload.href = exportUrls.log;
      logDownload.download = lastExport.logName;
    }
    const tsvArea = panel.querySelector('[data-role="tsv-text"]');
    const logArea = panel.querySelector('[data-role="log-text"]');
    const backupArea = panel.querySelector('[data-role="backup-text"]');
    if (tsvArea) tsvArea.value = lastExport.tsv;
    if (logArea) logArea.value = lastExport.log;
    if (backupArea) backupArea.value = lastExport.backup;
    exportDirty = false;
    exportPreparedCount = queue.length;
    renderPanel();
    setMessage(`Exportação preparada com ${queue.length} card(s).`, 'added');
    return lastExport;
  }

  async function copyText(contents, label) {
    let copied = false;
    if (typeof GM_setClipboard === 'function') {
      try {
        const result = GM_setClipboard(contents, 'text');
        if (result && typeof result.then === 'function') await result;
        copied = true;
      } catch (_error) {
        copied = false;
      }
    }
    if (!copied && pageWindow.navigator?.clipboard?.writeText) {
      try {
        await pageWindow.navigator.clipboard.writeText(contents);
        copied = true;
      } catch (_error) {
        copied = false;
      }
    }
    setMessage(copied ? `${label} copiado.` : 'Não foi possível copiar automaticamente. Use a caixa de texto abaixo.', copied ? 'added' : 'failed');
    return copied;
  }

  async function downloadWithGm(kind) {
    if (exportDirty || !lastExport[kind]) prepareExports();
    const isTsv = kind === 'tsv';
    const url = exportUrls[kind];
    const name = isTsv ? lastExport.tsvName : lastExport.logName;
    if (typeof GM_download !== 'function') {
      setMessage('GM_download indisponível. Use o link de download ou a caixa de texto.', 'failed');
      return false;
    }
    try {
      const result = GM_download({ url, name, saveAs: false });
      if (result && typeof result.then === 'function') await result;
      setMessage(`Download solicitado pelo Violentmonkey: ${name}.`, 'added');
      return true;
    } catch (_error) {
      setMessage('O download do Violentmonkey falhou. Use o link nativo ou a caixa de texto.', 'failed');
      return false;
    }
  }

  async function importBackup(text) {
    let parsed;
    try {
      parsed = JSON.parse(String(text || '').trim());
    } catch (_error) {
      setMessage('Backup inválido: o texto não é JSON.', 'failed');
      return { added: 0, total: queue.length };
    }
    const incomingQueue = Array.isArray(parsed) ? parsed : parsed?.queue;
    const incomingAudit = Array.isArray(parsed?.audit) ? parsed.audit : [];
    const before = queue.length;
    queue = mergeCardArrays(queue, parseStoredValue(incomingQueue));
    audit = mergeAuditArrays(audit, incomingAudit);
    await persistQueue();
    await persistAudit();
    prepareExports();
    const added = queue.length - before;
    setMessage(`Backup importado: ${added} card(s) novo(s); ${queue.length} no total.`, 'added');
    return { added, total: queue.length };
  }

  function renderPanel() {
    if (!panel) return;
    const mode = pageMode();
    const status = panel.querySelector('[data-role="status"]');
    const session = panel.querySelector('[data-role="session"]');
    const storage = panel.querySelector('[data-role="storage"]');
    const modeLine = panel.querySelector('[data-role="mode"]');
    const failure = panel.querySelector('[data-role="failure"]');
    const exportStatus = panel.querySelector('[data-role="export-status"]');
    if (status) status.textContent = `${queue.length} card(s) no total`;
    if (session) session.textContent = `${loadedAtStart} carregados anteriormente · ${sessionStats.added} adicionados nesta sessão · ${sessionStats.duplicate} duplicados · ${sessionStats.failed} falhas`;
    if (storage) storage.textContent = 'Fila redundante: Violentmonkey + armazenamento da Osler.';
    if (failure) failure.textContent = summarizeLastFailure(audit).text;
    if (exportStatus) exportStatus.textContent = exportDirty
      ? `Exportação desatualizada: ${exportPreparedCount} de ${queue.length} cards preparados.`
      : `Exportação pronta: ${exportPreparedCount} cards.`;
    if (modeLine) {
      modeLine.textContent = mode === 'test'
        ? ratingTransaction
          ? ratingTransaction.phase === 'advancing'
            ? `Card salvo; confirmando avanço como ${ratingTransaction.trigger}…`
            : `Aguardando e salvando antes de avançar: ${ratingTransaction.trigger}…`
          : pendingAdvance
            ? `Card já salvo, mas ainda na tela. Pressione ${pendingAdvance.trigger === 'Errei' ? '1' : '2'} para tentar avançar novamente.`
            : 'Espaço mostra · 1 Errei · 2 Difícil. O card é salvo antes do avanço.'
        : mode === 'report'
          ? 'Modo leve de exportação: captura desligada nesta tela.'
          : 'Modo leve: abra um teste para ativar a captura.';
    }
    const captureButton = panel.querySelector('[data-action="capture"]');
    if (captureButton) captureButton.disabled = mode !== 'test' || Boolean(ratingTransaction);
  }

  function syncPageMode() {
    if (pageMode() !== 'test') {
      ratingTransaction = null;
      pendingAdvance = null;
    }
    if (pageMode() === 'report' && exportDirty) prepareExports();
    renderPanel();
  }

  function installRouteWatcher() {
    lastKnownPath = String(pageWindow.location?.pathname || '');
    pageWindow.setInterval?.(() => {
      const currentPath = String(pageWindow.location?.pathname || '');
      if (currentPath === lastKnownPath) return;
      lastKnownPath = currentPath;
      syncPageMode();
    }, 750);
    pageWindow.addEventListener?.('popstate', () => pageWindow.setTimeout?.(syncPageMode, 0));
    pageWindow.addEventListener?.('hashchange', () => pageWindow.setTimeout?.(syncPageMode, 0));
  }

  async function install(doc = documentRef) {
    if (!doc?.body || doc.getElementById(PANEL_ID)) return;
    ['osler-anki-bridge-v042', 'osler-anki-bridge-v043', 'osler-anki-bridge-v044', 'osler-anki-bridge-v045', 'osler-anki-bridge-v046', 'osler-anki-bridge-v047', 'osler-anki-bridge-v048'].forEach((id) => {
      doc.getElementById(id)?.remove?.();
    });

    await loadState();
    panel = doc.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <strong>Osler Anki Bridge — ${VERSION}</strong>
      <p data-role="status"></p>
      <div data-role="session" style="margin-bottom:4px"></div>
      <div data-role="storage" style="margin-bottom:6px"></div>
      <button type="button" data-action="capture">Adicionar card atual</button>
      <button type="button" data-action="prepare">Preparar exportação</button>
      <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">
        <a data-role="tsv-download" href="#">Baixar TSV (link)</a>
        <a data-role="tsv-open" href="#" target="_blank">Abrir TSV</a>
        <a data-role="log-download" href="#">Baixar log (link)</a>
      </div>
      <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
        <button type="button" data-action="gm-tsv">Baixar TSV via Violentmonkey</button>
        <button type="button" data-action="gm-log">Baixar log via Violentmonkey</button>
        <button type="button" data-action="copy-tsv">Copiar TSV</button>
        <button type="button" data-action="copy-log">Copiar log</button>
      </div>
      <div data-role="export-status" style="margin-top:6px"></div>
      <div data-role="mode" style="margin-top:6px"></div>
      <div data-role="failure" style="margin-top:6px"></div>
      <div data-role="message" style="margin-top:5px;max-width:440px;overflow-wrap:anywhere"></div>
      <details style="margin-top:7px">
        <summary>Conteúdo de recuperação</summary>
        <label>TSV bruto</label>
        <textarea data-role="tsv-text" rows="5" style="width:100%;box-sizing:border-box"></textarea>
        <label>Log bruto</label>
        <textarea data-role="log-text" rows="5" style="width:100%;box-sizing:border-box"></textarea>
        <label>Backup completo da fila</label>
        <textarea data-role="backup-text" rows="6" style="width:100%;box-sizing:border-box"></textarea>
        <button type="button" data-action="import-backup">Importar backup colado</button>
      </details>
    `;
    panel.style.cssText = 'position:fixed;right:12px;top:12px;z-index:2147483647;background:#fff;color:#111;border:1px solid #999;border-radius:10px;padding:10px;font:12px system-ui;max-width:460px;max-height:80vh;overflow:auto';
    doc.body.appendChild(panel);

    panel.querySelector('[data-action="capture"]').addEventListener('click', () => capture('captura manual', doc));
    panel.querySelector('[data-action="prepare"]').addEventListener('click', prepareExports);
    panel.querySelector('[data-action="gm-tsv"]').addEventListener('click', () => downloadWithGm('tsv'));
    panel.querySelector('[data-action="gm-log"]').addEventListener('click', () => downloadWithGm('log'));
    panel.querySelector('[data-action="copy-tsv"]').addEventListener('click', () => {
      if (exportDirty) prepareExports();
      copyText(lastExport.tsv, 'TSV');
    });
    panel.querySelector('[data-action="copy-log"]').addEventListener('click', () => {
      if (exportDirty) prepareExports();
      copyText(lastExport.log, 'Log');
    });
    panel.querySelector('[data-action="import-backup"]').addEventListener('click', () => {
      importBackup(panel.querySelector('[data-role="backup-text"]')?.value || '');
    });

    ensureGlobalListeners(doc);
    installRouteWatcher();
    prepareExports();
    syncPageMode();
  }

  const api = {
    advanceAndConfirm,
    advanceSnapshot,
    buildTsvFromQueue,
    capture,
    deckNameForCard,
    extractCard,
    extractResponse,
    findQuestionElement,
    hasAdvanced,
    importBackup,
    keyTriggerForEvent,
    mergeCardArrays,
    pageMode,
    parseStoredValue,
    sanitizeHtml,
    stableHash,
    summarizeLastFailure,
    validateCard,
    visibilityMetrics,
  };

  pageWindow.OslerAnkiBridgeV049 = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    install().catch((error) => {
      console.error('[Osler Anki Bridge 0.4.9] Falha na instalação:', error);
    });
  }
})();

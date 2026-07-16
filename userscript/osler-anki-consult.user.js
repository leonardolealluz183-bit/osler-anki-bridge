// ==UserScript==
// @name         Osler Anki Exporter — Ver todos
// @namespace    https://github.com/osler-anki-bridge/osler-anki-bridge
// @version      1.0.0
// @description  Exporta em lote os flashcards já renderizados na tela Ver todos os flashcards da Osler para um único baralho do Anki.
// @match        https://oslermedicina.com.br/consult*
// @match        https://*.oslermedicina.com.br/consult*
// @grant        GM_download
// @grant        GM_setClipboard
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-consult.user.js
// @downloadURL  https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-consult.user.js
// ==/UserScript==

(function bootstrapConsultExporter() {
  'use strict';

  const VERSION = '1.0.0';
  const PANEL_ID = 'osler-anki-consult-exporter-v100';
  const LEGACY_PANEL_IDS = [
    'osler-anki-bridge-v0410',
    'osler-anki-session-controls-v0411',
    'osler-anki-session-controls-v0412',
    'osler-anki-question-fix-v0412',
  ];
  const MAX_LOAD_MORE_CLICKS = 120;
  const LOAD_TIMEOUT_MS = 7000;
  const LOAD_POLL_MS = 180;
  const CARD_MIN_WIDTH = 240;
  const CARD_MIN_HEIGHT = 54;

  const pageWindow = typeof unsafeWindow !== 'undefined'
    ? unsafeWindow
    : (typeof window !== 'undefined' ? window : globalThis);
  const documentRef = pageWindow.document || globalThis.document;

  let panel = null;
  let lastResult = { cards: [], errors: [], tsv: '', filename: '', url: '' };
  let running = false;

  const sleep = (ms) => new Promise((resolve) => pageWindow.setTimeout(resolve, ms));
  const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizeText = (value) => normalizeWhitespace(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function stableHash(input) {
    let hash = 2166136261;
    const text = String(input || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function slugify(value, max = 70) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max) || 'osler';
  }

  function safeDeckName(value) {
    return normalizeWhitespace(value).replace(/::+/g, ' — ').replace(/[\t\r\n]+/g, ' ').slice(0, 120) || 'Osler';
  }

  function parseCssColor(value) {
    const input = String(value || '').trim();
    const rgb = input.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i);
    if (rgb) return rgb.slice(1, 4).map(Number);
    const hex = input.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!hex) return null;
    const raw = hex[1].length === 3 ? hex[1].split('').map((part) => part + part).join('') : hex[1];
    return [0, 2, 4].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16));
  }

  function isOrangeRgb(rgb) {
    if (!Array.isArray(rgb) || rgb.length < 3) return false;
    const [red, green, blue] = rgb.map(Number);
    if (![red, green, blue].every(Number.isFinite)) return false;
    return red >= 175 && green >= 45 && green <= 175 && blue <= 115
      && red >= green + 55 && red >= blue + 85;
  }

  function styleFor(element) {
    try { return pageWindow.getComputedStyle?.(element) || null; }
    catch (_error) { return null; }
  }

  function isVisible(element) {
    if (!element || element.hidden || element.closest?.('[hidden],[aria-hidden="true"],[inert]')) return false;
    const style = styleFor(element);
    if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect) return true;
    return Number(rect.width) > 0 && Number(rect.height) > 0;
  }

  function hasOrangeBorder(element) {
    const style = styleFor(element);
    if (!style) return false;
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    return sides.some((side) => {
      const width = Number.parseFloat(style[`border${side}Width`] || '0');
      return width > 0 && isOrangeRgb(parseCssColor(style[`border${side}Color`]));
    });
  }

  function hasAnswerHint(element) {
    const signature = [
      element?.className,
      element?.id,
      element?.getAttribute?.('data-testid'),
      element?.getAttribute?.('data-type'),
      element?.getAttribute?.('data-answer'),
      element?.getAttribute?.('aria-label'),
    ].map(String).join(' ');
    return /cloze|answer|resposta|highlight|correct/i.test(signature);
  }

  function isOrangeAnswerNode(element) {
    if (!element || !isVisible(element)) return false;
    const text = normalizeWhitespace(element.textContent);
    if (!text || text.length > 400) return false;
    const tag = String(element.tagName || '').toLowerCase();
    if (!['span', 'strong', 'b', 'mark', 'em', 'i', 'u', 'small', 'code'].includes(tag) && !hasAnswerHint(element)) return false;
    const style = styleFor(element);
    const orangeText = isOrangeRgb(parseCssColor(style?.color));
    const orangeBackground = isOrangeRgb(parseCssColor(style?.backgroundColor));
    return orangeText || orangeBackground || hasAnswerHint(element);
  }

  function isLikelyCitationNode(element, root) {
    if (!element || element === root) return false;
    const text = normalizeWhitespace(element.textContent);
    if (!text || text.length < 18 || text.length > 700) return false;
    const style = styleFor(element);
    const italic = String(style?.fontStyle || '').toLowerCase() === 'italic'
      || Boolean(element.closest?.('em,i'))
      || ['em', 'i'].includes(String(element.tagName || '').toLowerCase());
    const rect = element.getBoundingClientRect?.();
    const rootRect = root?.getBoundingClientRect?.();
    const nearBottom = rect && rootRect ? Number(rect.bottom) >= Number(rootRect.bottom) - Math.max(80, Number(rootRect.height) * 0.35) : false;
    const explicit = /\b(fonte|refer[eê]ncia|doi|uptodate|diretriz|guideline|manual|tratado|pol[ií]ticas? de sa[uú]de)\b/i.test(text);
    return (italic && nearBottom) || explicit;
  }

  function cardContainerScore(element) {
    if (!element || !isVisible(element) || element.id === PANEL_ID || element.closest?.(`#${PANEL_ID}`)) return -Infinity;
    const tag = String(element.tagName || '').toLowerCase();
    if (!['article', 'section', 'div', 'li'].includes(tag)) return -Infinity;
    const rect = element.getBoundingClientRect?.();
    if (rect && (Number(rect.width) < CARD_MIN_WIDTH || Number(rect.height) < CARD_MIN_HEIGHT)) return -Infinity;
    const text = normalizeWhitespace(element.textContent);
    if (text.length < 18 || text.length > 12000) return -Infinity;
    const directCardChildren = Array.from(element.children || []).filter((child) => hasOrangeBorder(child));
    if (directCardChildren.length >= 2) return -Infinity;
    let score = 0;
    if (hasOrangeBorder(element)) score += 130;
    const orangeAnswers = Array.from(element.querySelectorAll?.('*') || []).filter(isOrangeAnswerNode).length;
    if (orangeAnswers) score += Math.min(60, orangeAnswers * 15);
    const links = Array.from(element.querySelectorAll?.('a') || []).filter(isVisible);
    if (links.length >= 2 && links.length <= 8) score += 25;
    if (element.querySelector?.('strong,b')) score += 20;
    if (rect) {
      score += Math.min(25, Number(rect.width) / 80);
      score -= Math.max(0, Number(rect.height) - 1000) / 30;
    }
    return score;
  }

  function nearestCardAncestor(node) {
    let current = node;
    let best = null;
    let bestScore = -Infinity;
    for (let depth = 0; current && current !== documentRef?.body && depth < 12; depth += 1) {
      const score = cardContainerScore(current);
      if (score > bestScore) {
        best = current;
        bestScore = score;
      }
      if (score >= 150 && hasOrangeBorder(current)) break;
      current = current.parentElement;
    }
    return bestScore >= 75 ? best : null;
  }

  function detectCardRoots(doc = documentRef) {
    const roots = new Set();
    Array.from(doc.querySelectorAll?.('article,section,div,li') || []).forEach((candidate) => {
      if (cardContainerScore(candidate) >= 150 && hasOrangeBorder(candidate)) roots.add(candidate);
    });
    Array.from(doc.querySelectorAll?.('span,strong,b,mark,em,i,[class*="cloze" i],[class*="answer" i]') || [])
      .filter(isOrangeAnswerNode)
      .forEach((answer) => {
        const root = nearestCardAncestor(answer);
        if (root) roots.add(root);
      });

    const ordered = Array.from(roots).sort((first, second) => {
      if (first === second) return 0;
      const relation = first.compareDocumentPosition?.(second) || 0;
      if (relation & (pageWindow.Node?.DOCUMENT_POSITION_FOLLOWING || 4)) return -1;
      if (relation & (pageWindow.Node?.DOCUMENT_POSITION_PRECEDING || 2)) return 1;
      return 0;
    });

    return ordered.filter((root) => !ordered.some((other) => other !== root && root.contains?.(other) && hasOrangeBorder(other)));
  }

  function uniqueTopLevel(nodes) {
    const list = Array.from(new Set(nodes.filter(Boolean)));
    return list.filter((node) => !list.some((other) => other !== node && other.contains?.(node)));
  }

  function breadcrumbInfo(root) {
    const candidates = Array.from(root.querySelectorAll?.('nav,ol,ul,div,p') || []).filter((element) => {
      if (!isVisible(element)) return false;
      const text = normalizeWhitespace(element.textContent);
      const links = Array.from(element.querySelectorAll?.('a') || []).filter(isVisible);
      return text.length > 3 && text.length < 260 && links.length >= 2 && links.length <= 8;
    }).sort((first, second) => {
      const firstRect = first.getBoundingClientRect?.();
      const secondRect = second.getBoundingClientRect?.();
      return Number(firstRect?.top || 0) - Number(secondRect?.top || 0);
    });
    const node = candidates[0] || null;
    const parts = node
      ? Array.from(node.querySelectorAll?.('a') || []).map((link) => normalizeWhitespace(link.textContent)).filter(Boolean)
      : [];
    return { node, parts, topic: parts.at(-1) || '' };
  }

  function commonAncestor(nodes, stopAt) {
    if (!nodes.length) return null;
    let current = nodes[0];
    while (current && current !== stopAt) {
      if (nodes.every((node) => current.contains?.(node))) return current;
      current = current.parentElement;
    }
    return null;
  }

  function blockCandidates(root) {
    const selectors = 'p,li,blockquote,table,ul,ol,h1,h2,h3,h4,h5,h6,div';
    const nodes = Array.from(root.querySelectorAll?.(selectors) || []).filter((node) => {
      if (!isVisible(node) || node === root || node.closest?.(`#${PANEL_ID}`)) return false;
      const text = normalizeWhitespace(node.textContent);
      if (!text && !node.querySelector?.('img')) return false;
      if (text.length > 2500) return false;
      const childBlocks = Array.from(node.children || []).filter((child) => /^(P|LI|BLOCKQUOTE|TABLE|UL|OL|H[1-6]|DIV)$/i.test(String(child.tagName || '')) && normalizeWhitespace(child.textContent));
      return childBlocks.length <= 3;
    });
    return uniqueTopLevel(nodes);
  }

  function chooseQuestionBlock(root, answerNodes, breadcrumbNode, citationNodes) {
    if (answerNodes.length) {
      const ancestor = commonAncestor(answerNodes, root);
      let current = ancestor;
      while (current && current !== root) {
        const tag = String(current.tagName || '').toLowerCase();
        const text = normalizeWhitespace(current.textContent);
        if (['p', 'li', 'blockquote', 'td', 'th'].includes(tag) && text.length >= 8 && text.length <= 1600) return current;
        if (tag === 'div' && text.length >= 8 && text.length <= 900 && current.querySelector?.('strong,b')) return current;
        current = current.parentElement;
      }
    }

    const citations = new Set(citationNodes);
    const candidates = blockCandidates(root).filter((node) => {
      if (breadcrumbNode && (node === breadcrumbNode || breadcrumbNode.contains?.(node) || node.contains?.(breadcrumbNode))) return false;
      if (Array.from(citations).some((citation) => node === citation || citation.contains?.(node))) return false;
      const text = normalizeWhitespace(node.textContent);
      if (text.length < 10) return false;
      return Boolean(node.querySelector?.('strong,b')) || /\?$/.test(text);
    });
    return candidates[0] || null;
  }

  function cleanClone(node) {
    const clone = node?.cloneNode?.(true);
    if (!clone) return null;
    clone.querySelectorAll?.('script,style,button,svg,[role="button"],[aria-label*="menu" i]').forEach((item) => item.remove());
    clone.querySelectorAll?.('[id]').forEach((item) => item.removeAttribute('id'));
    clone.querySelectorAll?.('*').forEach((item) => {
      Array.from(item.attributes || []).forEach((attr) => {
        if (/^on/i.test(attr.name)) item.removeAttribute(attr.name);
      });
    });
    return clone;
  }

  function htmlOf(node) {
    if (!node) return '';
    const tag = String(node.tagName || '').toLowerCase();
    return ['p', 'li', 'blockquote', 'table', 'ul', 'ol'].includes(tag) ? node.outerHTML : node.innerHTML;
  }

  function parseCardRoot(root, index = 0) {
    const errors = [];
    const breadcrumb = breadcrumbInfo(root);
    const citationNodes = uniqueTopLevel(Array.from(root.querySelectorAll?.('p,div,small,em,i') || [])
      .filter((node) => isLikelyCitationNode(node, root)));
    const answerNodes = uniqueTopLevel(Array.from(root.querySelectorAll?.('*') || [])
      .filter((node) => isOrangeAnswerNode(node))
      .filter((node) => !breadcrumb.node?.contains?.(node))
      .filter((node) => !citationNodes.some((citation) => citation.contains?.(node))));
    const questionBlock = chooseQuestionBlock(root, answerNodes, breadcrumb.node, citationNodes);
    if (!questionBlock) return { card: null, error: `Card ${index + 1}: pergunta não identificada.` };

    const questionClone = cleanClone(questionBlock);
    if (!questionClone) return { card: null, error: `Card ${index + 1}: não foi possível copiar a pergunta.` };

    const answerTexts = [];
    const answerHtml = [];
    if (answerNodes.length) {
      const originalAnswers = Array.from(questionBlock.querySelectorAll?.('*') || []).filter((node) => answerNodes.includes(node));
      const cloneAnswers = Array.from(questionClone.querySelectorAll?.('*') || []).filter((node) => isOrangeAnswerNode(node));
      answerNodes.forEach((node) => {
        const text = normalizeWhitespace(node.textContent);
        if (text && !answerTexts.includes(text)) answerTexts.push(text);
        const cleaned = cleanClone(node);
        const html = normalizeWhitespace(cleaned?.innerHTML || cleaned?.textContent);
        if (html && !answerHtml.includes(html)) answerHtml.push(html);
      });
      const replacements = cloneAnswers.length ? cloneAnswers : Array.from(questionClone.querySelectorAll?.('span,strong,b,mark,em,i') || [])
        .filter((node) => answerTexts.includes(normalizeWhitespace(node.textContent)));
      replacements.forEach((node) => node.replaceWith(documentRef.createTextNode('[...]')));
      if (!originalAnswers.length && !replacements.length) errors.push('resposta destacada fora do bloco principal');
    }

    const blocks = blockCandidates(root).filter((node) => {
      if (node === questionBlock || questionBlock.contains?.(node) || node.contains?.(questionBlock)) return false;
      if (breadcrumb.node && (node === breadcrumb.node || breadcrumb.node.contains?.(node) || node.contains?.(breadcrumb.node))) return false;
      if (citationNodes.some((citation) => node === citation || citation.contains?.(node) || node.contains?.(citation))) return false;
      return true;
    });

    let answerBlock = null;
    if (!answerTexts.length) {
      const afterQuestion = blocks.filter((node) => {
        const relation = questionBlock.compareDocumentPosition?.(node) || 0;
        return Boolean(relation & (pageWindow.Node?.DOCUMENT_POSITION_FOLLOWING || 4));
      });
      answerBlock = afterQuestion[0] || null;
      if (answerBlock) {
        answerTexts.push(normalizeWhitespace(answerBlock.textContent));
        const cleaned = cleanClone(answerBlock);
        answerHtml.push(htmlOf(cleaned));
      }
    }

    const explanationBlocks = blocks.filter((node) => node !== answerBlock).filter((node) => {
      const relation = questionBlock.compareDocumentPosition?.(node) || 0;
      return Boolean(relation & (pageWindow.Node?.DOCUMENT_POSITION_FOLLOWING || 4));
    }).slice(0, 12);
    const explanationHtml = explanationBlocks.map((node) => htmlOf(cleanClone(node))).filter(Boolean).join('\n');

    const frontText = normalizeWhitespace(questionClone.textContent);
    const frontHtml = htmlOf(questionClone);
    const backText = normalizeWhitespace(answerTexts.join('; '));
    const backHtml = answerHtml.filter(Boolean).join('<br>') || escapeHtml(backText);
    if (!frontText) return { card: null, error: `Card ${index + 1}: frente vazia.` };
    if (!backText && !backHtml) return { card: null, error: `Card ${index + 1}: resposta não identificada.` };

    const strongTopic = normalizeWhitespace(questionBlock.querySelector?.('strong,b')?.textContent).replace(/[\s.:;,!?–—-]+$/u, '');
    const topic = breadcrumb.topic || strongTopic || 'Osler';
    const id = stableHash([topic, frontText, backText].join('\n---\n'));
    const card = {
      id,
      topic,
      frontText,
      frontHtml,
      backText,
      backHtml,
      explanationHtml,
      warnings: errors,
    };
    return { card, error: null };
  }

  function dedupeCards(cards) {
    const byId = new Map();
    cards.forEach((card) => {
      if (card?.id && !byId.has(card.id)) byId.set(card.id, card);
    });
    return Array.from(byId.values());
  }

  function tsvField(value) {
    const normalized = String(value || '').replace(/\r?\n/g, '<br>').replace(/\t/g, ' ');
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  function buildTsv(cards, deckName) {
    const deck = safeDeckName(deckName);
    const sessionTag = `osler_consult_${slugify(deck)}`;
    const headers = [
      '#separator:Tab',
      '#html:true',
      '#tags:osler',
      '#columns:Frente\tVerso\tTags\tBaralho',
      '#tags column:3',
      '#deck column:4',
    ];
    const rows = dedupeCards(cards).map((card) => {
      const front = `<span style="display:none">osler:${escapeHtml(card.id)}</span>${card.frontHtml || escapeHtml(card.frontText)}`;
      const explanation = card.explanationHtml ? `<hr><div><strong>Explicação</strong><br>${card.explanationHtml}</div>` : '';
      const back = `<div><strong>Resposta</strong><br>${card.backHtml || escapeHtml(card.backText)}</div>${explanation}<hr><small>Assunto original: ${escapeHtml(card.topic)} · ID: ${escapeHtml(card.id)}</small>`;
      const tags = `osler ${sessionTag} assunto_${slugify(card.topic)}`;
      return [front, back, tags, deck].map(tsvField).join('\t');
    });
    return `\uFEFF${[...headers, ...rows].join('\n')}\n`;
  }

  function findLoadMoreButton(doc = documentRef) {
    return Array.from(doc.querySelectorAll?.('button,[role="button"],a') || []).find((element) => {
      if (!isVisible(element)) return false;
      const text = normalizeText([element.textContent, element.getAttribute?.('aria-label'), element.getAttribute?.('title')].filter(Boolean).join(' '));
      return text === 'carregar mais' || text.includes('carregar mais');
    }) || null;
  }

  async function waitForMoreCards(previousCount) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < LOAD_TIMEOUT_MS) {
      await sleep(LOAD_POLL_MS);
      const current = detectCardRoots(documentRef).length;
      if (current > previousCount) return { grew: true, count: current };
      if (!findLoadMoreButton(documentRef)) return { grew: current > previousCount, count: current };
    }
    return { grew: false, count: detectCardRoots(documentRef).length };
  }

  async function loadAllCards(onProgress = () => {}) {
    let clicks = 0;
    let stagnant = 0;
    let count = detectCardRoots(documentRef).length;
    onProgress(`Encontrados ${count} cartões visíveis.`);
    while (clicks < MAX_LOAD_MORE_CLICKS) {
      const button = findLoadMoreButton(documentRef);
      if (!button) break;
      button.scrollIntoView?.({ block: 'center', behavior: 'auto' });
      await sleep(80);
      const before = count;
      button.click();
      clicks += 1;
      const result = await waitForMoreCards(before);
      count = result.count;
      onProgress(`Carregando: ${count} cartões encontrados.`);
      if (!result.grew) stagnant += 1;
      else stagnant = 0;
      if (stagnant >= 2) break;
    }
    return { count, clicks, complete: !findLoadMoreButton(documentRef) };
  }

  function analyzeVisibleCards(deckName) {
    const roots = detectCardRoots(documentRef);
    const cards = [];
    const errors = [];
    roots.forEach((root, index) => {
      const parsed = parseCardRoot(root, index);
      if (parsed.card) cards.push(parsed.card);
      if (parsed.error) errors.push(parsed.error);
    });
    const unique = dedupeCards(cards);
    const tsv = buildTsv(unique, deckName);
    const filename = `osler-${slugify(deckName).replace(/_/g, '-')}-${unique.length}-cards.tsv`;
    return { roots: roots.length, cards: unique, errors, tsv, filename };
  }

  function revokeLastUrl() {
    if (!lastResult.url) return;
    try { pageWindow.URL.revokeObjectURL(lastResult.url); } catch (_error) { /* sem ação */ }
  }

  function setStatus(text, state = '') {
    const target = panel?.querySelector?.('[data-role="status"]');
    if (!target) return;
    target.textContent = text;
    target.dataset.state = state;
    target.style.color = state === 'error' ? '#ff8a80' : state === 'ok' ? '#9ccc65' : 'inherit';
  }

  function renderResult(result) {
    revokeLastUrl();
    const url = pageWindow.URL.createObjectURL(new pageWindow.Blob([result.tsv], { type: 'text/tab-separated-values;charset=utf-8' }));
    lastResult = { ...result, url };
    const download = panel?.querySelector?.('[data-role="download"]');
    const raw = panel?.querySelector?.('[data-role="raw"]');
    const log = panel?.querySelector?.('[data-role="log"]');
    if (download) {
      download.href = url;
      download.download = result.filename;
      download.hidden = result.cards.length === 0;
      download.textContent = `Baixar TSV (${result.cards.length})`;
    }
    if (raw) raw.value = result.tsv;
    if (log) {
      const warnings = result.cards.flatMap((card) => card.warnings.map((warning) => `${card.topic}: ${warning}`));
      log.value = [
        `Versão: ${VERSION}`,
        `Contêineres encontrados: ${result.roots}`,
        `Cards válidos e únicos: ${result.cards.length}`,
        `Erros: ${result.errors.length}`,
        ...result.errors,
        ...warnings.map((warning) => `Aviso: ${warning}`),
      ].join('\n');
    }
    setStatus(`${result.cards.length} cards prontos para o baralho “${safeDeckName(panel?.querySelector?.('[data-role="deck"]')?.value)}”.${result.errors.length ? ` ${result.errors.length} não foram lidos; veja o diagnóstico.` : ''}`, result.cards.length ? 'ok' : 'error');
  }

  async function runAnalyze(loadEverything) {
    if (running) return;
    running = true;
    const buttons = panel?.querySelectorAll?.('button');
    buttons?.forEach((button) => { button.disabled = true; });
    try {
      const deckInput = panel?.querySelector?.('[data-role="deck"]');
      const deck = safeDeckName(deckInput?.value);
      if (!deckInput?.value?.trim()) throw new Error('Digite o nome do baralho antes de exportar.');
      if (loadEverything) {
        setStatus('Carregando todos os flashcards…');
        const loaded = await loadAllCards((message) => setStatus(message));
        if (!loaded.complete) setStatus(`Foram encontrados ${loaded.count} cartões, mas o botão Carregar mais ainda existe. Analisando o que foi carregado…`);
      }
      setStatus('Lendo perguntas, respostas em laranja e explicações…');
      const result = analyzeVisibleCards(deck);
      renderResult(result);
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    } finally {
      running = false;
      buttons?.forEach((button) => { button.disabled = false; });
    }
  }

  async function copyTsv() {
    if (!lastResult.tsv) {
      setStatus('Analise os cartões antes de copiar.', 'error');
      return;
    }
    let copied = false;
    if (typeof GM_setClipboard === 'function') {
      try {
        const result = GM_setClipboard(lastResult.tsv, 'text');
        if (result && typeof result.then === 'function') await result;
        copied = true;
      } catch (_error) { copied = false; }
    }
    if (!copied && pageWindow.navigator?.clipboard?.writeText) {
      try { await pageWindow.navigator.clipboard.writeText(lastResult.tsv); copied = true; }
      catch (_error) { copied = false; }
    }
    setStatus(copied ? 'TSV copiado.' : 'Não foi possível copiar automaticamente; use o conteúdo bruto.', copied ? 'ok' : 'error');
  }

  async function downloadWithGm() {
    if (!lastResult.tsv || !lastResult.url) {
      setStatus('Analise os cartões antes de baixar.', 'error');
      return;
    }
    if (typeof GM_download !== 'function') {
      setStatus('GM_download indisponível. Use o link Baixar TSV.', 'error');
      return;
    }
    try {
      const result = GM_download({ url: lastResult.url, name: lastResult.filename, saveAs: false });
      if (result && typeof result.then === 'function') await result;
      setStatus('Download solicitado pelo Violentmonkey.', 'ok');
    } catch (_error) {
      setStatus('O download pelo Violentmonkey falhou. Use o link Baixar TSV.', 'error');
    }
  }

  function removeLegacyPanels() {
    LEGACY_PANEL_IDS.forEach((id) => documentRef?.getElementById?.(id)?.remove?.());
    Array.from(documentRef?.querySelectorAll?.('[id^="osler-anki-bridge-v04"],[id^="osler-anki-session-controls-v04"]') || []).forEach((node) => node.remove());
  }

  function inferDeckName() {
    const roots = detectCardRoots(documentRef);
    const first = roots[0];
    const topic = first ? breadcrumbInfo(first).topic : '';
    return topic || 'Osler';
  }

  function installPanel() {
    if (!documentRef?.body || documentRef.getElementById(PANEL_ID)) return;
    removeLegacyPanels();
    panel = documentRef.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px">
        <strong style="flex:1">Osler → Anki · Ver todos ${VERSION}</strong>
        <button type="button" data-action="toggle" title="Minimizar">−</button>
      </div>
      <div data-role="body">
        <label style="display:block;margin-top:7px">Nome do baralho</label>
        <input data-role="deck" type="text" style="width:100%;box-sizing:border-box;padding:6px" value="${escapeHtml(inferDeckName())}">
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:7px">
          <button type="button" data-action="all">Carregar tudo e preparar TSV</button>
          <button type="button" data-action="visible">Analisar apenas os visíveis</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:7px">
          <a data-role="download" href="#" hidden>Baixar TSV</a>
          <button type="button" data-action="gm-download">Baixar via Violentmonkey</button>
          <button type="button" data-action="copy">Copiar TSV</button>
        </div>
        <div data-role="status" style="margin-top:7px;overflow-wrap:anywhere">Abra “Ver todos os flashcards”, escolha o nome do baralho e carregue tudo.</div>
        <details style="margin-top:7px">
          <summary>Diagnóstico</summary>
          <textarea data-role="log" rows="7" style="width:100%;box-sizing:border-box"></textarea>
        </details>
        <details style="margin-top:5px">
          <summary>Conteúdo TSV bruto</summary>
          <textarea data-role="raw" rows="7" style="width:100%;box-sizing:border-box"></textarea>
        </details>
      </div>
    `;
    panel.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;width:min(460px,calc(100vw - 24px));max-height:88vh;overflow:auto;background:#17191d;color:#eee;border:1px solid #ff6d2d;border-radius:10px;padding:9px 10px;font:12px system-ui;box-sizing:border-box;box-shadow:0 5px 18px rgba(0,0,0,.45)';
    documentRef.body.appendChild(panel);
    panel.querySelector('[data-action="toggle"]').addEventListener('click', (event) => {
      const body = panel.querySelector('[data-role="body"]');
      body.hidden = !body.hidden;
      event.currentTarget.textContent = body.hidden ? '+' : '−';
    });
    panel.querySelector('[data-action="all"]').addEventListener('click', () => runAnalyze(true));
    panel.querySelector('[data-action="visible"]').addEventListener('click', () => runAnalyze(false));
    panel.querySelector('[data-action="gm-download"]').addEventListener('click', downloadWithGm);
    panel.querySelector('[data-action="copy"]').addEventListener('click', copyTsv);
  }

  const api = {
    VERSION,
    analyzeVisibleCards,
    buildTsv,
    dedupeCards,
    detectCardRoots,
    isOrangeRgb,
    parseCssColor,
    parseCardRoot,
    safeDeckName,
    slugify,
    stableHash,
  };

  pageWindow.OslerAnkiConsultExporterV100 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    installPanel();
    pageWindow.setTimeout?.(removeLegacyPanels, 500);
    pageWindow.setTimeout?.(removeLegacyPanels, 1500);
  }
}());

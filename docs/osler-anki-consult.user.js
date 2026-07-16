// ==UserScript==
// @name         Osler Anki Exporter — Ver todos
// @namespace    https://github.com/osler-anki-bridge/osler-anki-bridge
// @version      1.0.1
// @description  Exporta em lote os flashcards da tela Ver todos da Osler para um único baralho do Anki, com suporte à navegação interna sem recarregar.
// @match        https://oslermedicina.com.br/*
// @match        https://*.oslermedicina.com.br/*
// @grant        GM_download
// @grant        GM_setClipboard
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-consult.user.js
// @downloadURL  https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-consult.user.js
// ==/UserScript==

(function oslerConsultExporter() {
  'use strict';

  const VERSION = '1.0.1';
  const PANEL_ID = 'osler-anki-consult-exporter-v101';
  const OLD_PANEL_IDS = [
    'osler-anki-consult-exporter-v100',
    'osler-anki-bridge-v0410',
    'osler-anki-session-controls-v0411',
    'osler-anki-session-controls-v0412',
    'osler-anki-question-fix-v0412',
  ];
  const MAX_LOAD_MORE = 150;
  const POLL_MS = 250;
  const LOAD_WAIT_MS = 8000;

  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const doc = pageWindow.document;
  let panel = null;
  let lastPath = '';
  let running = false;
  let prepared = { tsv: '', filename: '', url: '', count: 0, errors: [] };

  const sleep = (ms) => new Promise((resolve) => pageWindow.setTimeout(resolve, ms));
  const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const fold = (value) => cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function onConsultRoute() {
    return /^\/consult(?:\/|$)/i.test(String(pageWindow.location?.pathname || ''));
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function slug(value, max = 72) {
    return fold(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max) || 'osler';
  }

  function deckName(value) {
    return cleanText(value).replace(/::+/g, ' — ').replace(/[\t\r\n]+/g, ' ').slice(0, 120) || 'Osler';
  }

  function computed(element) {
    try { return pageWindow.getComputedStyle(element); } catch (_error) { return null; }
  }

  function visible(element) {
    if (!element || element.hidden || element.closest?.('[hidden],[aria-hidden="true"],[inert]')) return false;
    const style = computed(element);
    if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
    const rect = element.getBoundingClientRect?.();
    return !rect || (Number(rect.width) > 0 && Number(rect.height) > 0);
  }

  function rgb(value) {
    const match = String(value || '').match(/rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/i);
    return match ? match.slice(1, 4).map(Number) : null;
  }

  function orangeColor(value) {
    const color = rgb(value);
    if (!color) return false;
    const [r, g, b] = color;
    return r >= 170 && g >= 35 && g <= 185 && b <= 130 && r >= g + 40 && r >= b + 65;
  }

  function answerHint(element) {
    const signature = [
      element?.className, element?.id, element?.getAttribute?.('data-testid'),
      element?.getAttribute?.('data-answer'), element?.getAttribute?.('aria-label'),
    ].map(String).join(' ');
    return /cloze|answer|resposta|highlight|correct/i.test(signature);
  }

  function answerNode(element) {
    if (!visible(element)) return false;
    const text = cleanText(element.textContent);
    if (!text || text.length > 500) return false;
    const tag = String(element.tagName || '').toLowerCase();
    if (!['span', 'strong', 'b', 'mark', 'em', 'i', 'u', 'small', 'code'].includes(tag) && !answerHint(element)) return false;
    const style = computed(element);
    return answerHint(element) || orangeColor(style?.color) || orangeColor(style?.backgroundColor);
  }

  function orangeBorder(element) {
    const style = computed(element);
    if (!style) return false;
    return ['Top', 'Right', 'Bottom', 'Left'].some((side) => {
      const width = Number.parseFloat(style[`border${side}Width`] || '0');
      return width > 0 && orangeColor(style[`border${side}Color`]);
    });
  }

  function likelyCard(element) {
    if (!visible(element) || element.id === PANEL_ID || element.closest?.(`#${PANEL_ID}`)) return false;
    if (!/^(ARTICLE|SECTION|DIV|LI)$/.test(String(element.tagName || ''))) return false;
    const text = cleanText(element.textContent);
    if (text.length < 18 || text.length > 15000) return false;
    const rect = element.getBoundingClientRect?.();
    if (rect && (Number(rect.width) < 220 || Number(rect.height) < 50)) return false;
    return orangeBorder(element) || Array.from(element.querySelectorAll?.('*') || []).some(answerNode);
  }

  function nearestCard(node) {
    let current = node;
    let fallback = null;
    for (let depth = 0; current && current !== doc.body && depth < 12; depth += 1) {
      if (likelyCard(current)) fallback = current;
      if (orangeBorder(current) && likelyCard(current)) return current;
      current = current.parentElement;
    }
    return fallback;
  }

  function cardRoots() {
    const roots = new Set();
    Array.from(doc.querySelectorAll('article,section,div,li')).forEach((node) => {
      if (orangeBorder(node) && likelyCard(node)) roots.add(node);
    });
    Array.from(doc.querySelectorAll('span,strong,b,mark,em,i,u,small,code,[class*="cloze" i],[class*="answer" i]'))
      .filter(answerNode)
      .forEach((node) => {
        const root = nearestCard(node);
        if (root) roots.add(root);
      });
    const list = Array.from(roots);
    return list.filter((root) => !list.some((other) => other !== root && root.contains(other) && orangeBorder(other)));
  }

  function citationNode(element, root) {
    const text = cleanText(element?.textContent);
    if (!text || text.length < 15 || text.length > 900) return false;
    const style = computed(element);
    const italic = style?.fontStyle === 'italic' || Boolean(element.closest?.('em,i'));
    const explicit = /\b(fonte|refer[eê]ncia|doi|uptodate|diretriz|guideline|manual|tratado|pol[ií]ticas? de sa[uú]de)\b/i.test(text);
    const rect = element.getBoundingClientRect?.();
    const rootRect = root.getBoundingClientRect?.();
    const low = rect && rootRect ? Number(rect.top) > Number(rootRect.top) + Number(rootRect.height) * 0.55 : false;
    return explicit || (italic && low);
  }

  function topLevel(nodes) {
    const list = Array.from(new Set(nodes.filter(Boolean)));
    return list.filter((node) => !list.some((other) => other !== node && other.contains(node)));
  }

  function breadcrumb(root) {
    const candidates = Array.from(root.querySelectorAll('nav,ol,ul,div')).filter((node) => {
      if (!visible(node)) return false;
      const links = Array.from(node.querySelectorAll('a')).filter(visible);
      const text = cleanText(node.textContent);
      return links.length >= 2 && links.length <= 8 && text.length < 300;
    });
    const node = candidates[0] || null;
    const parts = node ? Array.from(node.querySelectorAll('a')).map((a) => cleanText(a.textContent)).filter(Boolean) : [];
    return { node, topic: parts.at(-1) || '' };
  }

  function cloneClean(node) {
    const clone = node?.cloneNode?.(true);
    if (!clone) return null;
    clone.querySelectorAll?.('script,style,button,svg,[role="button"]').forEach((item) => item.remove());
    clone.querySelectorAll?.('[id]').forEach((item) => item.removeAttribute('id'));
    clone.querySelectorAll?.('*').forEach((item) => {
      Array.from(item.attributes || []).forEach((attr) => { if (/^on/i.test(attr.name)) item.removeAttribute(attr.name); });
    });
    return clone;
  }

  function blocks(root) {
    return topLevel(Array.from(root.querySelectorAll('p,li,blockquote,table,ul,ol,h1,h2,h3,h4,h5,h6,div')).filter((node) => {
      if (!visible(node) || node === root || node.closest?.(`#${PANEL_ID}`)) return false;
      const text = cleanText(node.textContent);
      if (!text || text.length > 3000) return false;
      const children = Array.from(node.children || []).filter((child) => /^(P|LI|BLOCKQUOTE|TABLE|UL|OL|H[1-6]|DIV)$/.test(String(child.tagName || '')) && cleanText(child.textContent));
      return children.length <= 3;
    }));
  }

  function html(node) {
    if (!node) return '';
    return /^(P|LI|BLOCKQUOTE|TABLE|UL|OL)$/.test(String(node.tagName || '')) ? node.outerHTML : node.innerHTML;
  }

  function parseCard(root, index) {
    const crumbs = breadcrumb(root);
    const citations = topLevel(Array.from(root.querySelectorAll('p,div,small,em,i')).filter((node) => citationNode(node, root)));
    const answers = topLevel(Array.from(root.querySelectorAll('*')).filter(answerNode)
      .filter((node) => !crumbs.node?.contains(node))
      .filter((node) => !citations.some((citation) => citation.contains(node))));

    let question = null;
    if (answers.length) {
      let current = answers[0];
      while (current && current !== root) {
        const text = cleanText(current.textContent);
        if (/^(P|LI|BLOCKQUOTE|TD|TH)$/.test(String(current.tagName || '')) && text.length >= 8 && text.length <= 1800) {
          question = current;
          break;
        }
        current = current.parentElement;
      }
    }
    const allBlocks = blocks(root);
    if (!question) {
      question = allBlocks.find((node) => {
        if (crumbs.node && (node === crumbs.node || node.contains(crumbs.node) || crumbs.node.contains(node))) return false;
        if (citations.some((citation) => node === citation || citation.contains(node))) return false;
        const text = cleanText(node.textContent);
        return text.length >= 10 && (node.querySelector('strong,b') || /\?$/.test(text));
      }) || null;
    }
    if (!question) return { error: `Card ${index + 1}: pergunta não identificada.` };

    const frontClone = cloneClean(question);
    if (!frontClone) return { error: `Card ${index + 1}: falha ao copiar a pergunta.` };
    const answerTexts = [];
    const answerHtml = [];
    answers.forEach((node) => {
      const text = cleanText(node.textContent);
      if (text && !answerTexts.includes(text)) answerTexts.push(text);
      const cloned = cloneClean(node);
      const value = cleanText(cloned?.innerHTML || cloned?.textContent);
      if (value && !answerHtml.includes(value)) answerHtml.push(value);
    });
    Array.from(frontClone.querySelectorAll('*')).filter(answerNode).forEach((node) => node.replaceWith(doc.createTextNode('[...]')));

    let answerBlock = null;
    const usable = allBlocks.filter((node) => {
      if (node === question || node.contains(question) || question.contains(node)) return false;
      if (crumbs.node && (node === crumbs.node || node.contains(crumbs.node) || crumbs.node.contains(node))) return false;
      if (citations.some((citation) => node === citation || citation.contains(node) || node.contains(citation))) return false;
      return true;
    });
    if (!answerTexts.length) {
      answerBlock = usable.find((node) => Boolean(question.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) || null;
      if (answerBlock) {
        answerTexts.push(cleanText(answerBlock.textContent));
        answerHtml.push(html(cloneClean(answerBlock)));
      }
    }
    const explanation = usable.filter((node) => node !== answerBlock)
      .filter((node) => Boolean(question.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))
      .slice(0, 12).map((node) => html(cloneClean(node))).filter(Boolean).join('\n');

    const frontText = cleanText(frontClone.textContent);
    const backText = cleanText(answerTexts.join('; '));
    if (!frontText) return { error: `Card ${index + 1}: frente vazia.` };
    if (!backText) return { error: `Card ${index + 1}: resposta não identificada.` };
    const strongTopic = cleanText(question.querySelector?.('strong,b')?.textContent).replace(/[\s.:;,!?–—-]+$/u, '');
    const topic = crumbs.topic || strongTopic || 'Osler';
    const id = stableHash([topic, frontText, backText].join('\n---\n'));
    return {
      card: {
        id, topic, frontText, frontHtml: html(frontClone), backText,
        backHtml: answerHtml.filter(Boolean).join('<br>') || escapeHtml(backText),
        explanationHtml: explanation,
      },
    };
  }

  function analyze() {
    const roots = cardRoots();
    const cards = [];
    const errors = [];
    const ids = new Set();
    roots.forEach((root, index) => {
      const result = parseCard(root, index);
      if (result.error) errors.push(result.error);
      if (result.card && !ids.has(result.card.id)) {
        ids.add(result.card.id);
        cards.push(result.card);
      }
    });
    return { roots: roots.length, cards, errors };
  }

  function tsvField(value) {
    return `"${String(value || '').replace(/\r?\n/g, '<br>').replace(/\t/g, ' ').replace(/"/g, '""')}"`;
  }

  function buildTsv(cards, name) {
    const deck = deckName(name);
    const headers = ['#separator:Tab', '#html:true', '#tags:osler', '#columns:Frente\tVerso\tTags\tBaralho', '#tags column:3', '#deck column:4'];
    const rows = cards.map((card) => {
      const front = `<span style="display:none">osler:${escapeHtml(card.id)}</span>${card.frontHtml || escapeHtml(card.frontText)}`;
      const explanation = card.explanationHtml ? `<hr><div><strong>Explicação</strong><br>${card.explanationHtml}</div>` : '';
      const back = `<div><strong>Resposta</strong><br>${card.backHtml}</div>${explanation}<hr><small>Assunto original: ${escapeHtml(card.topic)} · ID: ${escapeHtml(card.id)}</small>`;
      return [front, back, `osler osler_consult_${slug(deck)} assunto_${slug(card.topic)}`, deck].map(tsvField).join('\t');
    });
    return `\uFEFF${[...headers, ...rows].join('\n')}\n`;
  }

  function loadMoreButton() {
    return Array.from(doc.querySelectorAll('button,[role="button"],a')).find((element) => {
      if (!visible(element)) return false;
      const text = fold([element.textContent, element.getAttribute?.('aria-label'), element.getAttribute?.('title')].filter(Boolean).join(' '));
      return text.includes('carregar mais');
    }) || null;
  }

  async function loadAll(progress) {
    let clicks = 0;
    let previous = cardRoots().length;
    let stagnant = 0;
    progress(`Encontrados ${previous} cards visíveis.`);
    while (clicks < MAX_LOAD_MORE) {
      const button = loadMoreButton();
      if (!button) break;
      button.scrollIntoView?.({ block: 'center', behavior: 'auto' });
      await sleep(100);
      button.click();
      clicks += 1;
      const started = Date.now();
      let current = previous;
      while (Date.now() - started < LOAD_WAIT_MS) {
        await sleep(POLL_MS);
        current = cardRoots().length;
        if (current > previous || !loadMoreButton()) break;
      }
      progress(`Carregando: ${current} cards encontrados.`);
      if (current <= previous) stagnant += 1; else stagnant = 0;
      previous = current;
      if (stagnant >= 2) break;
    }
    return { count: previous, complete: !loadMoreButton(), clicks };
  }

  function status(message, kind = '') {
    const target = panel?.querySelector('[data-role="status"]');
    if (!target) return;
    target.textContent = message;
    target.style.color = kind === 'error' ? '#ff8a80' : kind === 'ok' ? '#9ccc65' : '#eee';
  }

  function clearPreparedUrl() {
    if (prepared.url) pageWindow.URL.revokeObjectURL(prepared.url);
    prepared.url = '';
  }

  function render(result, name) {
    clearPreparedUrl();
    const tsv = buildTsv(result.cards, name);
    const filename = `osler-${slug(name).replace(/_/g, '-')}-${result.cards.length}-cards.tsv`;
    const url = pageWindow.URL.createObjectURL(new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' }));
    prepared = { ...result, tsv, filename, url, count: result.cards.length };
    const link = panel.querySelector('[data-role="download"]');
    link.href = url;
    link.download = filename;
    link.hidden = result.cards.length === 0;
    link.textContent = `Baixar TSV (${result.cards.length})`;
    panel.querySelector('[data-role="raw"]').value = tsv;
    panel.querySelector('[data-role="log"]').value = [
      `Versão: ${VERSION}`, `Rota: ${pageWindow.location.pathname}`,
      `Contêineres encontrados: ${result.roots}`, `Cards válidos e únicos: ${result.cards.length}`,
      `Erros: ${result.errors.length}`, ...result.errors,
    ].join('\n');
    status(`${result.cards.length} cards prontos para “${deckName(name)}”.${result.errors.length ? ` ${result.errors.length} cards não foram lidos; abra o diagnóstico.` : ''}`, result.cards.length ? 'ok' : 'error');
  }

  async function run(loadEverything) {
    if (running) return;
    const input = panel.querySelector('[data-role="deck"]');
    if (!input.value.trim()) return status('Digite o nome do baralho.', 'error');
    running = true;
    panel.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      if (loadEverything) {
        status('Carregando todos os flashcards…');
        await loadAll((message) => status(message));
      }
      status('Lendo perguntas, respostas em laranja e explicações…');
      render(analyze(), input.value);
    } catch (error) {
      status(error?.message || String(error), 'error');
    } finally {
      running = false;
      panel.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    }
  }

  async function copyTsv() {
    if (!prepared.tsv) return status('Prepare o TSV primeiro.', 'error');
    try {
      if (typeof GM_setClipboard === 'function') await GM_setClipboard(prepared.tsv, 'text');
      else await navigator.clipboard.writeText(prepared.tsv);
      status('TSV copiado.', 'ok');
    } catch (_error) { status('Não foi possível copiar. Use o conteúdo bruto.', 'error'); }
  }

  async function gmDownload() {
    if (!prepared.tsv || !prepared.url) return status('Prepare o TSV primeiro.', 'error');
    try {
      await GM_download({ url: prepared.url, name: prepared.filename, saveAs: false });
      status('Download solicitado.', 'ok');
    } catch (_error) { status('O download automático falhou. Use o link Baixar TSV.', 'error'); }
  }

  function removeOldPanels() {
    OLD_PANEL_IDS.forEach((id) => doc.getElementById(id)?.remove());
    Array.from(doc.querySelectorAll('[id^="osler-anki-bridge-v04"],[id^="osler-anki-session-controls-v04"]')).forEach((node) => node.remove());
  }

  function inferName() {
    const root = cardRoots()[0];
    return root ? breadcrumb(root).topic || 'Osler' : 'Osler';
  }

  function removePanel() {
    doc.getElementById(PANEL_ID)?.remove();
    panel = null;
  }

  function installPanel() {
    if (!onConsultRoute() || !doc.body || doc.getElementById(PANEL_ID)) return;
    removeOldPanels();
    panel = doc.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px">
        <strong style="flex:1">Osler → Anki · Ver todos ${VERSION}</strong>
        <button type="button" data-action="toggle">−</button>
      </div>
      <div data-role="body">
        <label style="display:block;margin-top:7px">Nome do baralho</label>
        <input data-role="deck" type="text" value="${escapeHtml(inferName())}" style="width:100%;box-sizing:border-box;padding:6px">
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:7px">
          <button type="button" data-action="all">Carregar tudo e preparar TSV</button>
          <button type="button" data-action="visible">Analisar visíveis</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:7px">
          <a data-role="download" href="#" hidden>Baixar TSV</a>
          <button type="button" data-action="gm">Baixar via Violentmonkey</button>
          <button type="button" data-action="copy">Copiar TSV</button>
        </div>
        <div data-role="status" style="margin-top:7px;overflow-wrap:anywhere">Aguardando os cards da tela “Ver todos”.</div>
        <details style="margin-top:7px"><summary>Diagnóstico</summary><textarea data-role="log" rows="7" style="width:100%;box-sizing:border-box"></textarea></details>
        <details style="margin-top:5px"><summary>Conteúdo TSV bruto</summary><textarea data-role="raw" rows="7" style="width:100%;box-sizing:border-box"></textarea></details>
      </div>`;
    panel.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;width:min(460px,calc(100vw - 24px));max-height:88vh;overflow:auto;background:#17191d;color:#eee;border:1px solid #ff6d2d;border-radius:10px;padding:9px 10px;font:12px system-ui;box-sizing:border-box;box-shadow:0 5px 18px rgba(0,0,0,.45)';
    doc.body.appendChild(panel);
    panel.querySelector('[data-action="toggle"]').addEventListener('click', (event) => {
      const body = panel.querySelector('[data-role="body"]');
      body.hidden = !body.hidden;
      event.currentTarget.textContent = body.hidden ? '+' : '−';
    });
    panel.querySelector('[data-action="all"]').addEventListener('click', () => run(true));
    panel.querySelector('[data-action="visible"]').addEventListener('click', () => run(false));
    panel.querySelector('[data-action="gm"]').addEventListener('click', gmDownload);
    panel.querySelector('[data-action="copy"]').addEventListener('click', copyTsv);
  }

  function routeSync() {
    const path = String(pageWindow.location?.pathname || '');
    if (path !== lastPath) {
      lastPath = path;
      clearPreparedUrl();
      if (!onConsultRoute()) removePanel();
    }
    if (onConsultRoute()) installPanel();
  }

  function hookHistory(method) {
    const original = pageWindow.history?.[method];
    if (typeof original !== 'function' || original.__oslerWrapped) return;
    const wrapped = function wrappedHistory(...args) {
      const result = original.apply(this, args);
      pageWindow.setTimeout(routeSync, 0);
      pageWindow.setTimeout(routeSync, 250);
      return result;
    };
    wrapped.__oslerWrapped = true;
    pageWindow.history[method] = wrapped;
  }

  const api = { VERSION, analyze, buildTsv, cardRoots, orangeColor, parseCard, stableHash };
  pageWindow.OslerAnkiConsultExporterV101 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    hookHistory('pushState');
    hookHistory('replaceState');
    pageWindow.addEventListener('popstate', routeSync);
    pageWindow.addEventListener('hashchange', routeSync);
    doc.addEventListener('DOMContentLoaded', routeSync, { once: true });
    pageWindow.setInterval(routeSync, 500);
    routeSync();
  }
}());

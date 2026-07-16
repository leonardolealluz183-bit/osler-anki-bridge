// ==UserScript==
// @name         Osler Anki Exporter — Consulta
// @namespace    https://github.com/osler-anki-bridge/osler-anki-bridge
// @version      1.1.0
// @description  Exporta os flashcards do modo Consulta para um único baralho do Anki.
// @match        https://oslermedicina.com.br/*
// @match        https://*.oslermedicina.com.br/*
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-consult.user.js
// @downloadURL  https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-consult.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.1.0';
  const PANEL_ID = 'osler-anki-consulta-v110';
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : (typeof window !== 'undefined' ? window : globalThis);
  const D = W.document || null;
  const N = W.Node || globalThis.Node || { DOCUMENT_POSITION_FOLLOWING: 4 };
  let panel = null;
  let busy = false;
  let prepared = null;
  let syncTimer = null;

  const text = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const fold = (v) => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const sleep = (ms) => new Promise((resolve) => W.setTimeout(resolve, ms));

  function hash(value) {
    let h = 2166136261;
    for (const c of String(value || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  function slug(value) {
    return fold(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 72) || 'osler';
  }

  function deckName(value) {
    return text(value).replace(/::+/g, ' — ').replace(/[\t\r\n]+/g, ' ').slice(0, 120) || 'Osler';
  }

  function clozeSpecs(topic, prompt, answerTexts) {
    return answerTexts.map((answer, index) => ({ id: hash([topic, prompt, index, answer].join('\n---\n')), answer, index }));
  }

  function consultPath(path = W.location?.pathname || '') {
    return /(?:^|\/)(?:consult|consulta)(?:\/|$)/i.test(String(path));
  }

  function style(el) {
    try { return W.getComputedStyle(el); } catch (_) { return null; }
  }

  function visible(el) {
    if (!el || el.hidden || el.closest?.('[hidden],[aria-hidden="true"],[inert]')) return false;
    const s = style(el);
    if (s && (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0)) return false;
    const r = el.getBoundingClientRect?.();
    return !r || (r.width > 0 && r.height > 0);
  }

  function rgb(value) {
    const m = String(value || '').match(/rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/i);
    if (m) return m.slice(1, 4).map(Number);
    const h = String(value || '').match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!h) return null;
    const raw = h[1].length === 3 ? h[1].split('').map((x) => x + x).join('') : h[1];
    return [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
  }

  function orange(value) {
    const c = Array.isArray(value) ? value : rgb(value);
    if (!c) return false;
    const [r, g, b] = c;
    return r >= 165 && g >= 30 && g <= 190 && b <= 140 && r >= g + 35 && r >= b + 55;
  }

  function orangeBorder(el) {
    const s = style(el);
    return !!s && ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(s[`border${side}Width`] || 0) >= 1 && orange(s[`border${side}Color`]));
  }

  function answerNode(el) {
    if (!visible(el) || !text(el.textContent) || text(el.textContent).length > 500) return false;
    const hint = [el.className, el.id, el.getAttribute?.('data-answer'), el.getAttribute?.('data-testid')].join(' ');
    const s = style(el);
    return /cloze|answer|resposta|highlight|correct/i.test(hint) || orange(s?.color) || orange(s?.backgroundColor);
  }

  function deepest(nodes) {
    const all = [...new Set(nodes.filter(Boolean))];
    return all.filter((a) => !all.some((b) => a !== b && a.contains?.(b)));
  }

  function answers(root) {
    return deepest([...root.querySelectorAll('span,strong,b,mark,em,i,u,small,code,[class*="cloze" i],[class*="answer" i],[data-answer]')].filter(answerNode));
  }

  function cardRoots() {
    if (!D?.body) return [];
    const all = [...D.querySelectorAll('article,section,div,li')].filter((el) => {
      if (el.id === PANEL_ID || el.closest?.(`#${PANEL_ID}`) || !visible(el) || !orangeBorder(el)) return false;
      const r = el.getBoundingClientRect?.();
      const t = text(el.textContent);
      return (!r || (r.width >= 220 && r.height >= 70)) && t.length >= 18 && t.length <= 25000 && !!el.querySelector('p,ul,ol,table,blockquote,figure,img,strong,b');
    });
    return all.filter((a) => !all.some((b) => a !== b && a.contains(b) && orangeBorder(b))).sort((a, b) => a.compareDocumentPosition?.(b) & N.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }

  function breadcrumb(root) {
    const rr = root.getBoundingClientRect?.();
    const nodes = [...root.querySelectorAll('nav,ol,div,p')].filter((el) => {
      const links = [...el.querySelectorAll('a,[role="link"]')].filter(visible);
      const r = el.getBoundingClientRect?.();
      return visible(el) && links.length >= 2 && links.length <= 8 && text(el.textContent).length < 320 && (!rr || !r || r.top < rr.top + rr.height * 0.42);
    });
    const node = nodes[0] || null;
    const parts = node ? [...node.querySelectorAll('a,[role="link"],span')].map((x) => text(x.textContent)).filter((x) => x && x.length < 120) : [];
    return { node, topic: parts.at(-1) || '' };
  }

  function blocks(root) {
    const nodes = [...root.querySelectorAll('p,ul,ol,table,blockquote,figure,h1,h2,h3,h4,h5,h6')].filter((el) => visible(el) && text(el.textContent || el.getAttribute?.('alt')));
    return nodes.filter((a) => !nodes.some((b) => a !== b && b.contains(a)));
  }

  function citations(list) {
    return list.filter((el, i) => {
      const t = fold(el.textContent);
      const explicit = /fonte|referencia|doi|uptodate|guideline|diretriz|manual|tratado|ministerio da saude|sociedade brasileira|politicas? de saude|organizacao e operacionalizacao/.test(t);
      const italic = style(el)?.fontStyle === 'italic' || /^(EM|I)$/.test(el.tagName || '');
      return explicit || (italic && i >= list.length - 2 && /\b(em|capitulo|edicao|volume|vol\.|pag\.)\b/.test(t));
    });
  }

  function pathFrom(root, node) {
    const p = [];
    let cur = node;
    while (cur && cur !== root) { const par = cur.parentNode; if (!par) return null; p.unshift([...par.childNodes].indexOf(cur)); cur = par; }
    return cur === root ? p : null;
  }

  function atPath(root, path) {
    let cur = root;
    for (const i of path || []) { cur = cur?.childNodes?.[i]; if (!cur) return null; }
    return cur;
  }

  function cloneClean(node) {
    const c = node?.cloneNode?.(true);
    if (!c) return null;
    c.querySelectorAll?.('script,style,button,svg,[role="button"],[aria-label*="menu" i]').forEach((x) => x.remove());
    c.querySelectorAll?.('[id]').forEach((x) => x.removeAttribute('id'));
    c.querySelectorAll?.('*').forEach((x) => [...x.attributes].forEach((a) => { if (/^on/i.test(a.name) || a.name === 'srcdoc') x.removeAttribute(a.name); }));
    return c;
  }

  function html(node) {
    return /^(P|LI|BLOCKQUOTE|TABLE|UL|OL|FIGURE|H[1-6])$/.test(node?.tagName || '') ? node.outerHTML : node?.innerHTML || '';
  }

  function structure(root) {
    const bc = breadcrumb(root);
    const all = blocks(root);
    const refs = citations(all);
    const usable = all.filter((el) => !(bc.node && (el === bc.node || el.contains(bc.node) || bc.node.contains(el))) && !refs.some((r) => el === r || el.contains(r) || r.contains(el)));
    const ans = answers(root).filter((a) => !bc.node?.contains(a) && !refs.some((r) => r.contains(a)));
    return { bc, usable, ans };
  }

  function promptFor(root, ans, usable) {
    let cur = ans;
    while (cur && cur !== root) { if (usable.includes(cur) || /^(P|LI|BLOCKQUOTE|TD|TH|H[1-6])$/.test(cur.tagName || '')) return cur; cur = cur.parentElement; }
    return usable.find((x) => x.contains(ans)) || null;
  }

  function clozeCards(root, s, sourceIndex) {
    const topic = s.bc.topic || text(root.querySelector('strong,b')?.textContent).replace(/[\s.:;,!?–—-]+$/u, '') || 'Osler';
    const groups = new Map();
    const errors = [];
    s.ans.forEach((a) => { const p = promptFor(root, a, s.usable); if (!p) errors.push(`Bloco ${sourceIndex + 1}: lacuna sem pergunta.`); else { if (!groups.has(p)) groups.set(p, []); groups.get(p).push(a); } });
    const cards = [];
    groups.forEach((list, prompt) => {
      const specs = clozeSpecs(topic, text(prompt.textContent), list.map((a) => text(a.textContent)));
      list.forEach((a, idx) => {
      const c = cloneClean(prompt);
      const target = atPath(c, pathFrom(prompt, a));
      if (!target) { errors.push(`Bloco ${sourceIndex + 1}: falha ao localizar uma lacuna.`); return; }
      target.replaceWith(D.createTextNode('[...]'));
      const answer = text(a.textContent);
      const front = text(c.textContent);
      if (!front || !answer) return;
      const later = s.usable.filter((b) => b !== prompt && !(b.contains(prompt) || prompt.contains(b)) && (prompt.compareDocumentPosition(b) & N.DOCUMENT_POSITION_FOLLOWING));
      cards.push({
        id: specs[idx].id,
        type: 'cloze', topic, frontText: front, frontHtml: html(c), backText: answer, backHtml: esc(answer),
        contextHtml: html(cloneClean(prompt)), explanationHtml: later.map((b) => html(cloneClean(b))).join('\n'),
      });
      });
    });
    return { cards, errors };
  }

  function qaCards(root, s, sourceIndex) {
    const b = s.usable;
    let answerIndex = -1;
    for (let i = 1; i < b.length; i++) {
      const prev = text(b[i - 1].textContent);
      const cur = text(b[i].textContent);
      const bold = text([...b[i].querySelectorAll('strong,b')].map((x) => x.textContent).join(' '));
      if (/\?$/.test(prev) || /^(sim|não|nao|verdadeiro|falso|correto|incorreto)\b/i.test(cur) || (cur.length <= 500 && bold.length / Math.max(1, cur.length) >= 0.55)) { answerIndex = i; break; }
    }
    if (answerIndex < 1) return { cards: [], errors: [`Bloco ${sourceIndex + 1}: pergunta e resposta não separadas.`] };
    const q = b.slice(0, answerIndex);
    const a = b[answerIndex];
    const frontText = text(q.map((x) => x.textContent).join(' '));
    const backText = text(a.textContent);
    const topic = s.bc.topic || text(q[0]?.querySelector('strong,b')?.textContent).replace(/[\s.:;,!?–—-]+$/u, '') || 'Osler';
    return { cards: [{ id: hash([topic, frontText, backText].join('\n---\n')), type: 'qa', topic, frontText, frontHtml: q.map((x) => html(cloneClean(x))).join('\n'), backText, backHtml: html(cloneClean(a)), contextHtml: '', explanationHtml: b.slice(answerIndex + 1).map((x) => html(cloneClean(x))).join('\n') }], errors: [] };
  }

  function analyze() {
    const roots = cardRoots();
    const map = new Map();
    const errors = [];
    let clozeSources = 0;
    let qaSources = 0;
    roots.forEach((root, i) => {
      const s = structure(root);
      const result = s.ans.length ? (clozeSources++, clozeCards(root, s, i)) : (qaSources++, qaCards(root, s, i));
      result.cards.forEach((c) => { if (!map.has(c.id)) map.set(c.id, c); });
      errors.push(...result.errors);
    });
    return { roots: roots.length, clozeSources, qaSources, cards: [...map.values()], errors };
  }

  function field(value) {
    return `"${String(value || '').replace(/\r?\n/g, '<br>').replace(/\t/g, ' ').replace(/"/g, '""')}"`;
  }

  function buildTsv(cards, name) {
    const deck = deckName(name);
    const headers = ['#separator:Tab', '#html:true', '#tags:osler', '#columns:Frente\tVerso\tTags\tBaralho', '#tags column:3', '#deck column:4'];
    const rows = cards.map((c) => {
      const front = `<span style="display:none">osler:${esc(c.id)}</span>${c.frontHtml || esc(c.frontText)}`;
      const context = c.contextHtml ? `<hr><strong>Contexto completo</strong><br>${c.contextHtml}` : '';
      const explanation = c.explanationHtml ? `<hr><strong>Explicação</strong><br>${c.explanationHtml}` : '';
      const back = `<strong>Resposta</strong><br>${c.backHtml || esc(c.backText)}${context}${explanation}<hr><small>Assunto: ${esc(c.topic)} · ID: ${esc(c.id)}</small>`;
      return [front, back, `osler osler_consulta_${slug(deck)} assunto_${slug(c.topic)} tipo_${c.type}`, deck].map(field).join('\t');
    });
    return `\uFEFF${[...headers, ...rows].join('\n')}\n`;
  }

  function loadMore() {
    return [...D.querySelectorAll('button,[role="button"],a')].find((el) => visible(el) && fold([el.textContent, el.getAttribute?.('aria-label'), el.title].join(' ')).includes('carregar mais')) || null;
  }

  async function loadAll() {
    let previous = cardRoots().length;
    let stalled = 0;
    for (let clicks = 0; clicks < 180; clicks++) {
      const button = loadMore();
      if (!button) return;
      button.scrollIntoView?.({ block: 'center' });
      button.click();
      const start = Date.now();
      let current = previous;
      while (Date.now() - start < 9000) { await sleep(220); current = cardRoots().length; if (current > previous || !loadMore()) break; }
      status(`Consulta: ${current} blocos carregados.`);
      stalled = current <= previous ? stalled + 1 : 0;
      previous = current;
      if (stalled >= 2) return;
    }
  }

  function status(message, error = false) {
    const el = panel?.querySelector('[data-role="status"]');
    if (el) { el.textContent = message; el.style.color = error ? '#ff8a80' : '#eee'; }
  }

  function render(result, name) {
    if (prepared?.url) W.URL.revokeObjectURL(prepared.url);
    const tsv = buildTsv(result.cards, name);
    const filename = `osler-${slug(name).replace(/_/g, '-')}-${result.cards.length}-cards.tsv`;
    const url = W.URL.createObjectURL(new W.Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' }));
    prepared = { tsv, filename, url };
    const link = panel.querySelector('[data-role="download"]');
    link.href = url; link.download = filename; link.hidden = !result.cards.length; link.textContent = `Baixar TSV (${result.cards.length})`;
    panel.querySelector('[data-role="raw"]').value = tsv;
    panel.querySelector('[data-role="log"]').value = [`Versão: ${VERSION}`, `Tela: Consulta`, `Blocos da Consulta: ${result.roots}`, `Blocos com lacunas: ${result.clozeSources}`, `Blocos pergunta-resposta: ${result.qaSources}`, `Cards únicos gerados: ${result.cards.length}`, `Erros: ${result.errors.length}`, ...result.errors].join('\n');
    status(`${result.cards.length} cards gerados a partir de ${result.roots} blocos da Consulta.${result.errors.length ? ` ${result.errors.length} erros no diagnóstico.` : ''}`, !result.cards.length);
  }

  async function run(loadEverything) {
    if (busy) return;
    const input = panel.querySelector('[data-role="deck"]');
    if (!input.value.trim()) return status('Digite o nome do baralho.', true);
    busy = true;
    panel.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try { if (loadEverything) { status('Carregando toda a Consulta…'); await loadAll(); } status('Lendo e separando as lacunas…'); render(analyze(), input.value); }
    catch (e) { status(e?.message || String(e), true); }
    finally { busy = false; panel.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
  }

  function inferName() {
    const root = cardRoots()[0];
    return root ? structure(root).bc.topic || text(root.querySelector('strong,b')?.textContent).replace(/[\s.:;,!?–—-]+$/u, '') || 'Osler' : 'Osler';
  }

  function install() {
    if (!D?.body || D.getElementById(PANEL_ID) || !(consultPath() || cardRoots().length || fold(D.body.innerText).includes('flashcards com varias lacunas'))) return;
    ['osler-anki-consult-exporter-v100', 'osler-anki-consult-exporter-v101', 'osler-anki-bridge-v0410', 'osler-anki-session-controls-v0411', 'osler-anki-session-controls-v0412', 'osler-anki-question-fix-v0412'].forEach((id) => D.getElementById(id)?.remove());
    panel = D.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `<div><strong>Osler → Anki · Consulta ${VERSION}</strong> <button data-action="toggle">−</button></div><div data-role="body"><label>Nome do baralho</label><input data-role="deck" value="${esc(inferName())}"><div><button data-action="all">Carregar tudo e gerar TSV</button><button data-action="visible">Analisar carregados</button></div><div><a data-role="download" hidden>Baixar TSV</a> <button data-action="gm">Baixar via Violentmonkey</button> <button data-action="copy">Copiar TSV</button></div><div data-role="status">Consulta detectada.</div><details><summary>Diagnóstico</summary><textarea data-role="log" rows="8"></textarea></details><details><summary>TSV bruto</summary><textarea data-role="raw" rows="8"></textarea></details></div>`;
    panel.style.cssText = 'position:fixed;z-index:2147483647;top:8px;right:8px;width:min(430px,calc(100vw - 16px));max-height:82vh;overflow:auto;background:#17191d;color:#eee;border:1px solid #ff6d2d;border-radius:10px;padding:9px;font:12px system-ui;box-sizing:border-box';
    panel.querySelectorAll('input,textarea').forEach((el) => { el.style.width = '100%'; el.style.boxSizing = 'border-box'; });
    D.body.appendChild(panel);
    panel.querySelector('[data-action="toggle"]').onclick = (e) => { const body = panel.querySelector('[data-role="body"]'); body.hidden = !body.hidden; e.currentTarget.textContent = body.hidden ? '+' : '−'; };
    panel.querySelector('[data-action="all"]').onclick = () => run(true);
    panel.querySelector('[data-action="visible"]').onclick = () => run(false);
    panel.querySelector('[data-action="copy"]').onclick = async () => { if (!prepared) return status('Gere o TSV primeiro.', true); try { await GM_setClipboard(prepared.tsv, 'text'); status('TSV copiado.'); } catch (_) { status('Falha ao copiar; use o TSV bruto.', true); } };
    panel.querySelector('[data-action="gm"]').onclick = async () => { if (!prepared) return status('Gere o TSV primeiro.', true); try { await GM_download({ url: prepared.url, name: prepared.filename, saveAs: false }); } catch (_) { status('Use o link Baixar TSV.', true); } };
  }

  function sync() {
    syncTimer = null;
    if (!D?.body) return;
    if (consultPath() || cardRoots().length || fold(D.body.innerText).includes('flashcards com varias lacunas')) install();
    else if (panel) { panel.remove(); panel = null; }
  }

  function schedule(ms = 50) {
    if (syncTimer) W.clearTimeout(syncTimer);
    syncTimer = W.setTimeout(sync, ms);
  }

  function hook(name) {
    const original = W.history?.[name];
    if (typeof original !== 'function' || original.__oslerConsulta) return;
    W.history[name] = function (...args) { const result = original.apply(this, args); schedule(0); schedule(500); return result; };
    W.history[name].__oslerConsulta = true;
  }

  const api = { VERSION, buildTsv, cardRoots, clozeSpecs, consultPath, orange, rgb, hash, deckName };
  W.OslerAnkiConsultaV110 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    hook('pushState'); hook('replaceState');
    W.addEventListener('popstate', () => schedule(0));
    D.addEventListener('DOMContentLoaded', () => schedule(0), { once: true });
    const observe = () => { if (D.documentElement) new W.MutationObserver(() => schedule(150)).observe(D.documentElement, { childList: true, subtree: true }); };
    if (D.documentElement) observe(); else D.addEventListener('DOMContentLoaded', observe, { once: true });
    W.setInterval(sync, 800);
    schedule(0);
  }
}());

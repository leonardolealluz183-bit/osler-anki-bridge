// ==UserScript==
// @name         Osler Anki Bridge — Sessões
// @namespace    https://github.com/osler-anki-bridge/osler-anki-bridge
// @version      0.4.12
// @description  Exporta sessões nomeadas da Osler usando o histórico real de capturas, sem herdar a fila antiga.
// @match        https://oslermedicina.com.br/*
// @match        https://*.oslermedicina.com.br/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-sessions-v0412.user.js
// @downloadURL  https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-sessions-v0412.user.js
// ==/UserScript==

(function bootstrapSessions() {
  'use strict';

  const VERSION = '0.4.12';
  const QUEUE_KEYS = ['oslerAnkiBridge.queue.v1', 'oslerAnkiBridge.queue.backup.v1'];
  const AUDIT_KEYS = ['oslerAnkiBridge.audit.v1', 'oslerAnkiBridge.audit.backup.v1'];
  const STATE_KEYS = ['oslerAnkiBridge.exportSessions.v2', 'oslerAnkiBridge.exportSessions.backup.v2'];
  const LEGACY_STATE_KEYS = ['oslerAnkiBridge.exportSessions.v1', 'oslerAnkiBridge.exportSessions.backup.v1'];
  const CONTROLS_ID = 'osler-anki-session-controls-v0412';
  const OLD_CONTROLS_ID = 'osler-anki-session-controls-v0411';
  const MAX_SESSIONS = 30;
  const CAPTURE_STATUSES = new Set(['added', 'duplicate']);

  const pageWindow = typeof unsafeWindow !== 'undefined'
    ? unsafeWindow
    : (typeof window !== 'undefined' ? window : globalThis);
  const documentRef = pageWindow.document || globalThis.document;

  let state = { activeId: null, sessions: [] };
  let lastQueue = [];
  let lastAudit = [];
  let prepared = { sessionId: '', tsv: '', name: '', url: '', count: 0 };
  let installing = false;

  const now = () => new Date().toISOString();
  const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizeText = (value) => normalizeWhitespace(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function slugify(value, max = 80) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max) || 'sessao';
  }

  function safeDeckName(value) {
    return normalizeWhitespace(value).replace(/::+/g, ' — ').replace(/[\t\r\n]+/g, ' ').slice(0, 100) || 'Osler';
  }

  function stableHash(input) {
    let hash = 2166136261;
    const text = String(input || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function parseJson(value, fallback = null) {
    if (value == null) return fallback;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (_error) { return fallback; }
  }

  function parseArray(value) {
    const parsed = parseJson(value, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function normalizeSession(raw) {
    if (!raw || typeof raw !== 'object' || !raw.id || !normalizeWhitespace(raw.name)) return null;
    return {
      id: String(raw.id),
      name: normalizeWhitespace(raw.name),
      startedAt: String(raw.startedAt || ''),
      endedAt: raw.endedAt ? String(raw.endedAt) : null,
      cardIds: Array.from(new Set(Array.isArray(raw.cardIds) ? raw.cardIds.map(String).filter(Boolean) : [])),
    };
  }

  function normalizeState(raw) {
    const parsed = parseJson(raw, null);
    const sessions = Array.isArray(parsed?.sessions)
      ? parsed.sessions.map(normalizeSession).filter(Boolean).slice(-MAX_SESSIONS)
      : [];
    const requestedActive = parsed?.activeId ? String(parsed.activeId) : null;
    const active = sessions.find((session) => session.id === requestedActive && !session.endedAt);
    return { activeId: active?.id || null, sessions };
  }

  function mergeStates(...rawStates) {
    const byId = new Map();
    rawStates.map(normalizeState).forEach((candidate) => {
      candidate.sessions.forEach((session) => {
        const current = byId.get(session.id);
        if (!current) {
          byId.set(session.id, session);
          return;
        }
        byId.set(session.id, {
          ...current,
          ...session,
          cardIds: Array.from(new Set([...(current.cardIds || []), ...(session.cardIds || [])])),
          endedAt: current.endedAt || session.endedAt || null,
        });
      });
    });
    const sessions = Array.from(byId.values())
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
      .slice(-MAX_SESSIONS);
    const active = sessions.filter((session) => !session.endedAt).at(-1) || null;
    return { activeId: active?.id || null, sessions };
  }

  async function gmGet(key, fallback) {
    if (typeof GM_getValue !== 'function') return fallback;
    try {
      const result = GM_getValue(key, fallback);
      return result && typeof result.then === 'function' ? await result : result;
    } catch (_error) { return fallback; }
  }

  async function gmSet(key, value) {
    if (typeof GM_setValue !== 'function') return false;
    try {
      const result = GM_setValue(key, value);
      if (result && typeof result.then === 'function') await result;
      return true;
    } catch (_error) { return false; }
  }

  function readLocal(key) {
    try { return parseJson(pageWindow.localStorage?.getItem?.(key), null); }
    catch (_error) { return null; }
  }

  function writeLocal(key, value) {
    try {
      pageWindow.localStorage?.setItem?.(key, JSON.stringify(value));
      return true;
    } catch (_error) { return false; }
  }

  function mergeQueues(...arrays) {
    const byId = new Map();
    arrays.flat().forEach((card) => {
      const id = String(card?.id || '');
      if (id && !byId.has(id)) byId.set(id, card);
    });
    return Array.from(byId.values());
  }

  function auditIdentity(event) {
    return [event?.at, event?.status, event?.id, event?.trigger, event?.detail].map((part) => String(part || '')).join('|');
  }

  function mergeAudits(...arrays) {
    const byKey = new Map();
    arrays.flat().forEach((event) => {
      if (!event || typeof event !== 'object') return;
      const key = auditIdentity(event);
      if (key.replace(/\|/g, '') && !byKey.has(key)) byKey.set(key, event);
    });
    return Array.from(byKey.values()).sort((a, b) => String(a?.at || '').localeCompare(String(b?.at || '')));
  }

  async function readQueue() {
    return mergeQueues(...QUEUE_KEYS.map((key) => parseArray(readLocal(key))));
  }

  async function readAudit() {
    return mergeAudits(...AUDIT_KEYS.map((key) => parseArray(readLocal(key))));
  }

  async function loadState() {
    const gmValues = await Promise.all([...STATE_KEYS, ...LEGACY_STATE_KEYS].map((key) => gmGet(key, null)));
    const localValues = [...STATE_KEYS, ...LEGACY_STATE_KEYS].map(readLocal);
    state = mergeStates(...gmValues, ...localValues);
  }

  async function persistState() {
    const snapshot = JSON.parse(JSON.stringify(state));
    await Promise.all(STATE_KEYS.map((key) => gmSet(key, snapshot)));
    STATE_KEYS.forEach((key) => writeLocal(key, snapshot));
  }

  function activeSession() {
    return state.sessions.find((session) => session.id === state.activeId && !session.endedAt) || null;
  }

  function latestSession() {
    return activeSession() || state.sessions.at(-1) || null;
  }

  function deriveSessionCardIdsFromAudit(audit, session) {
    if (!session?.startedAt) return [];
    const ids = [];
    const seen = new Set();
    audit.forEach((event) => {
      const at = String(event?.at || '');
      const id = String(event?.id || '');
      if (!at || at < session.startedAt || (session.endedAt && at > session.endedAt)) return;
      if (!CAPTURE_STATUSES.has(String(event?.status || '')) || !id || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    });
    return ids;
  }

  function reconcileSessionsFromAudit(audit = lastAudit) {
    let changed = false;
    state.sessions.forEach((session) => {
      const derived = deriveSessionCardIdsFromAudit(audit, session);
      const current = Array.isArray(session.cardIds) ? session.cardIds : [];
      const shouldReplace = !session.endedAt || derived.length > 0;
      if (!shouldReplace || (current.length === derived.length && current.every((id, index) => id === derived[index]))) return;
      session.cardIds = derived;
      changed = true;
    });
    return changed;
  }

  function cardsForSession(queue, session) {
    if (!session) return [];
    const ids = new Set(session.cardIds || []);
    return queue.filter((card) => ids.has(String(card?.id || '')));
  }

  function cleanHtml(value) {
    return String(value || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/\s+on[a-z]+=("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .trim();
  }

  function tsvField(value) {
    const normalized = String(value || '').replace(/\r?\n/g, '<br>').replace(/\t/g, ' ');
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  function buildSessionTsv(cards, session) {
    const deck = safeDeckName(session?.name);
    const sessionTag = `sessao_${slugify(session?.name)}`;
    const headers = [
      '#separator:Tab', '#html:true', '#tags:osler',
      '#columns:Frente\tVerso\tTags\tBaralho', '#tags column:3', '#deck column:4',
    ];
    const rows = cards.filter((card) => {
      const question = normalizeWhitespace(card?.question?.text || card?.question?.html);
      const answer = normalizeWhitespace(card?.answer?.text || card?.answer?.html);
      return card?.id && question && answer;
    }).map((card) => {
      const question = cleanHtml(card.question.html || escapeHtml(card.question.text));
      const answer = cleanHtml(card.answer.html || escapeHtml(card.answer.text));
      const explanation = cleanHtml(card.explanation?.html || escapeHtml(card.explanation?.text));
      const topic = normalizeWhitespace(card.topic?.text || 'Osler');
      const front = `<span style="display:none">osler:${escapeHtml(card.id)}</span>${question}`;
      const explanationBlock = explanation ? `<hr><div><strong>Explicação</strong><br>${explanation}</div>` : '';
      const back = `<div><strong>Resposta</strong><br>${answer}</div>${explanationBlock}<hr><small>Assunto original: ${escapeHtml(topic)} · Sessão: ${escapeHtml(deck)} · ID: ${escapeHtml(card.id)}</small>`;
      const tags = `osler ${sessionTag} assunto_${slugify(topic)}`;
      return [front, back, tags, deck].map(tsvField).join('\t');
    });
    return `\uFEFF${[...headers, ...rows].join('\n')}\n`;
  }

  function revokePreparedUrl() {
    if (!prepared.url) return;
    try { pageWindow.URL.revokeObjectURL(prepared.url); } catch (_error) { /* sem ação */ }
    prepared.url = '';
  }

  function resetPrepared() {
    revokePreparedUrl();
    prepared = { sessionId: '', tsv: '', name: '', url: '', count: 0 };
  }

  function filenameForSession(session) {
    return `osler-anki-${slugify(session?.name, 60).replace(/_/g, '-')}-${Date.now()}.tsv`;
  }

  async function refreshData() {
    const [queue, audit] = await Promise.all([readQueue(), readAudit()]);
    const previousSignature = `${lastQueue.map((card) => card?.id).join('|')}#${lastAudit.map(auditIdentity).join('~')}`;
    lastQueue = queue;
    lastAudit = audit;
    const nextSignature = `${lastQueue.map((card) => card?.id).join('|')}#${lastAudit.map(auditIdentity).join('~')}`;
    const changed = reconcileSessionsFromAudit(audit);
    if (changed) await persistState();
    if (previousSignature !== nextSignature && prepared.sessionId) resetPrepared();
    renderControls();
    return { queue, audit };
  }

  async function startSession(name) {
    const cleanName = normalizeWhitespace(name);
    if (!cleanName) throw new Error('Digite o nome da sessão.');
    if (activeSession()) throw new Error('Encerre a sessão atual antes de iniciar outra.');
    await refreshData();
    const startedAt = now();
    const session = {
      id: `${Date.now().toString(36)}-${stableHash(`${cleanName}|${startedAt}`)}`,
      name: cleanName,
      startedAt,
      endedAt: null,
      cardIds: [],
    };
    state.sessions.push(session);
    state.sessions = state.sessions.slice(-MAX_SESSIONS);
    state.activeId = session.id;
    resetPrepared();
    await persistState();
    renderControls(`Sessão “${cleanName}” iniciada com 0 cards.`);
    return session;
  }

  async function endSession() {
    await refreshData();
    const session = activeSession();
    if (!session) throw new Error('Não há sessão ativa.');
    session.endedAt = now();
    state.activeId = null;
    await persistState();
    renderControls(`Sessão encerrada com ${cardsForSession(lastQueue, session).length} card(s).`);
    return session;
  }

  async function prepareSessionExport() {
    await refreshData();
    const session = latestSession();
    if (!session) throw new Error('Inicie uma sessão antes de exportar.');
    const cards = cardsForSession(lastQueue, session);
    if (!cards.length) throw new Error('Essa sessão ainda não possui cards capturados.');
    const tsv = buildSessionTsv(cards, session);
    resetPrepared();
    const name = filenameForSession(session);
    const url = pageWindow.URL.createObjectURL(new pageWindow.Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' }));
    prepared = { sessionId: session.id, tsv, name, url, count: cards.length };
    renderControls(`TSV preparado: ${cards.length} card(s), todos no baralho “${session.name}”.`);
    return prepared;
  }

  async function copyPreparedTsv() {
    if (!prepared.tsv) await prepareSessionExport();
    let copied = false;
    if (typeof GM_setClipboard === 'function') {
      try {
        const result = GM_setClipboard(prepared.tsv, 'text');
        if (result && typeof result.then === 'function') await result;
        copied = true;
      } catch (_error) { copied = false; }
    }
    if (!copied && pageWindow.navigator?.clipboard?.writeText) {
      try { await pageWindow.navigator.clipboard.writeText(prepared.tsv); copied = true; }
      catch (_error) { copied = false; }
    }
    renderControls(copied ? 'TSV da sessão copiado.' : 'Não foi possível copiar automaticamente. Use o conteúdo bruto.');
    return copied;
  }

  async function downloadPreparedWithGm() {
    if (!prepared.tsv) await prepareSessionExport();
    if (typeof GM_download !== 'function') throw new Error('GM_download indisponível. Use o link nativo.');
    const result = GM_download({ url: prepared.url, name: prepared.name, saveAs: false });
    if (result && typeof result.then === 'function') await result;
    renderControls(`Download solicitado: ${prepared.name}`);
    return true;
  }

  function controlsRoot() {
    return documentRef?.getElementById?.(CONTROLS_ID) || null;
  }

  function setMessage(text, error = false) {
    const target = controlsRoot()?.querySelector?.('[data-session-role="message"]');
    if (!target) return;
    target.textContent = text || '';
    target.style.color = error ? '#a40000' : '#174f17';
  }

  function renderControls(message = '') {
    const root = controlsRoot();
    if (!root) return;
    const session = latestSession();
    const active = activeSession();
    const count = session ? cardsForSession(lastQueue, session).length : 0;
    const status = root.querySelector('[data-session-role="status"]');
    const startButton = root.querySelector('[data-session-action="start"]');
    const endButton = root.querySelector('[data-session-action="end"]');
    const prepareButton = root.querySelector('[data-session-action="prepare"]');
    const downloadLink = root.querySelector('[data-session-role="download"]');
    const raw = root.querySelector('[data-session-role="raw"]');
    if (status) {
      status.textContent = active
        ? `Sessão ativa: ${active.name} · ${count} card(s)`
        : session
          ? `Última sessão: ${session.name} · ${count} card(s) · encerrada`
          : 'Nenhuma sessão criada.';
    }
    if (startButton) startButton.disabled = Boolean(active);
    if (endButton) endButton.disabled = !active;
    if (prepareButton) prepareButton.disabled = !session || count === 0;
    if (downloadLink) {
      const validPrepared = Boolean(prepared.sessionId === session?.id && prepared.tsv);
      downloadLink.hidden = !validPrepared;
      downloadLink.href = validPrepared ? prepared.url : '#';
      downloadLink.download = validPrepared ? prepared.name : '';
      downloadLink.textContent = validPrepared ? `Baixar TSV da sessão (${prepared.count})` : 'Baixar TSV da sessão';
    }
    if (raw) raw.value = prepared.sessionId === session?.id ? prepared.tsv : '';
    if (message) setMessage(message, false);
  }

  function attachControls() {
    if (!documentRef?.body) return false;
    documentRef.getElementById?.(OLD_CONTROLS_ID)?.remove?.();
    if (controlsRoot()) return true;
    const bridgePanel = documentRef.querySelector?.('[id^="osler-anki-bridge-v04"]');
    const body = bridgePanel?.querySelector?.('[data-role="panel-body"]');
    if (!body) return false;
    const root = documentRef.createElement('section');
    root.id = CONTROLS_ID;
    root.style.cssText = 'border:1px solid #8aa7c7;border-radius:8px;padding:8px;margin:0 0 8px;background:#f5f9ff;color:#111';
    root.innerHTML = `
      <strong>Sessão de exportação — ${VERSION}</strong>
      <div data-session-role="status" style="margin:5px 0"></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <input data-session-role="name" type="text" placeholder="Ex.: Hipertensão Arterial Sistêmica" style="flex:1;min-width:180px;padding:5px;box-sizing:border-box">
        <button type="button" data-session-action="start">Nova sessão</button>
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px">
        <button type="button" data-session-action="prepare">Preparar TSV da sessão</button>
        <a data-session-role="download" href="#" hidden>Baixar TSV da sessão</a>
        <button type="button" data-session-action="gm-download">Baixar via Violentmonkey</button>
        <button type="button" data-session-action="copy">Copiar TSV</button>
        <button type="button" data-session-action="end">Encerrar sessão</button>
      </div>
      <div data-session-role="message" style="margin-top:5px;overflow-wrap:anywhere"></div>
      <details style="margin-top:5px">
        <summary>Conteúdo bruto da sessão</summary>
        <textarea data-session-role="raw" rows="5" style="width:100%;box-sizing:border-box"></textarea>
      </details>`;
    body.prepend(root);

    const run = (operation) => Promise.resolve(operation()).catch((error) => setMessage(error?.message || String(error), true));
    root.querySelector('[data-session-action="start"]').addEventListener('click', () => run(async () => {
      const input = root.querySelector('[data-session-role="name"]');
      await startSession(input?.value || '');
      if (input) input.value = '';
    }));
    root.querySelector('[data-session-action="prepare"]').addEventListener('click', () => run(prepareSessionExport));
    root.querySelector('[data-session-action="gm-download"]').addEventListener('click', () => run(downloadPreparedWithGm));
    root.querySelector('[data-session-action="copy"]').addEventListener('click', () => run(copyPreparedTsv));
    root.querySelector('[data-session-action="end"]').addEventListener('click', () => run(endSession));
    renderControls();
    return true;
  }

  async function install() {
    if (installing) return;
    installing = true;
    await loadState();
    await refreshData();
    await persistState();
    attachControls();
    pageWindow.setInterval?.(async () => {
      attachControls();
      await refreshData();
    }, 900);
    installing = false;
  }

  const api = {
    buildSessionTsv,
    cardsForSession,
    deriveSessionCardIdsFromAudit,
    mergeAudits,
    mergeQueues,
    mergeStates,
    normalizeSession,
    normalizeState,
    reconcileSessionsFromAudit,
    safeDeckName,
    slugify,
    stableHash,
  };

  pageWindow.OslerAnkiSessionsV0412 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else install().catch((error) => console.error('[Osler Anki Sessions 0.4.12]', error));
}());

// ==UserScript==
// @name         Osler Anki Bridge
// @namespace    https://github.com/osler-anki-bridge/osler-anki-bridge
// @version      0.4.8
// @description  Captura transacional da Osler com avanço confirmado, fila permanente e exportação confiável no Firefox Android.
// @match        https://oslermedicina.com.br/*
// @match        https://*.oslermedicina.com.br/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @require      https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/d563f7f73a48916ed8e9e0405b7aaa22b7e3939f/userscript/osler-anki-bridge.user.js
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-bridge.user.js
// @downloadURL  https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-bridge.user.js
// ==/UserScript==

(function installV048Patch() {
  'use strict';

  const VERSION = '0.4.8';
  const QUEUE_KEY = 'oslerAnkiBridge.queue.v1';
  const AUDIT_KEY = 'oslerAnkiBridge.audit.v1';
  const CORE_PANEL_ID = 'osler-anki-bridge-v047';
  const PATCH_MARKER = 'data-osler-v048-patched';
  const page = typeof unsafeWindow !== 'undefined'
    ? unsafeWindow
    : (typeof window !== 'undefined' ? window : globalThis);

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeText(value) {
    return normalizeWhitespace(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function parseArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function storedArray(key) {
    try {
      if (typeof GM_getValue === 'function') return parseArray(GM_getValue(key, []));
    } catch (_error) {
      // Tenta o espelho local abaixo.
    }
    try {
      return parseArray(page.localStorage?.getItem?.(key));
    } catch (_localError) {
      return [];
    }
  }

  function queue() {
    return storedArray(QUEUE_KEY);
  }

  function audit() {
    return storedArray(AUDIT_KEY);
  }

  function timestamp() {
    return Date.now();
  }

  function setMessage(panel, text, state = '') {
    const message = panel?.querySelector?.('[data-role="message"]');
    if (!message) return;
    message.textContent = text;
    message.dataset.state = state;
  }

  function pageBlobUrl(contents, mimeType) {
    const BlobCtor = page.Blob || Blob;
    const URLCtor = page.URL || URL;
    const blob = new BlobCtor([contents], { type: mimeType });
    return {
      url: URLCtor.createObjectURL(blob),
      revoke() {
        try { URLCtor.revokeObjectURL(this.url); } catch (_error) { /* sem ação */ }
      },
    };
  }

  function anchorDownload(contents, filename, mimeType) {
    if (!page.document?.body) throw new Error('documento da página indisponível');
    const resource = pageBlobUrl(contents, mimeType);
    const anchor = page.document.createElement('a');
    anchor.href = resource.url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    page.document.body.appendChild(anchor);
    try {
      anchor.dispatchEvent(new page.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: page,
      }));
    } finally {
      anchor.remove();
      page.setTimeout(() => resource.revoke(), 60000);
    }
  }

  function openFile(contents, mimeType) {
    const resource = pageBlobUrl(contents, mimeType);
    const opened = page.open(resource.url, '_blank', 'noopener');
    page.setTimeout(() => resource.revoke(), 300000);
    return Boolean(opened);
  }

  function downloadWithViolentmonkey(panel, contents, filename, mimeType) {
    const resource = pageBlobUrl(contents, mimeType);
    let finished = false;

    const finish = (message, state) => {
      if (finished) return;
      finished = true;
      page.setTimeout(() => resource.revoke(), 60000);
      setMessage(panel, message, state);
    };

    try {
      if (typeof GM_download !== 'function') throw new Error('GM_download indisponível');
      const result = GM_download({
        url: resource.url,
        name: filename,
        saveAs: false,
        onload: () => finish(`ARQUIVO BAIXADO — ${filename}`, 'added'),
        onerror: () => {
          try {
            anchorDownload(contents, filename, mimeType);
            finish(`DOWNLOAD ALTERNATIVO SOLICITADO — ${filename}`, 'waiting');
          } catch (error) {
            finish(`DOWNLOAD FALHOU — use Abrir TSV ou Copiar log. ${error?.message || ''}`, 'failed');
          }
        },
        ontimeout: () => {
          try {
            anchorDownload(contents, filename, mimeType);
            finish(`DOWNLOAD ALTERNATIVO SOLICITADO — ${filename}`, 'waiting');
          } catch (error) {
            finish(`DOWNLOAD FALHOU — ${error?.message || 'tempo esgotado'}`, 'failed');
          }
        },
      });
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          if (finished) return;
          try {
            anchorDownload(contents, filename, mimeType);
            finish(`DOWNLOAD ALTERNATIVO SOLICITADO — ${filename}`, 'waiting');
          } catch (error) {
            finish(`DOWNLOAD FALHOU — ${error?.message || ''}`, 'failed');
          }
        });
      }
      setMessage(panel, `ENVIANDO PARA DOWNLOAD — ${filename}`, 'waiting');
      return true;
    } catch (_error) {
      resource.revoke();
      try {
        anchorDownload(contents, filename, mimeType);
        setMessage(panel, `DOWNLOAD ALTERNATIVO SOLICITADO — ${filename}`, 'waiting');
        return true;
      } catch (error) {
        setMessage(panel, `DOWNLOAD FALHOU — use Abrir TSV ou Copiar log. ${error?.message || ''}`, 'failed');
        return false;
      }
    }
  }

  function buildTsv() {
    const core = page.OslerAnkiBridgeV047;
    if (!core?.buildTsv) throw new Error('núcleo 0.4.7 não carregado');
    return core.buildTsv(page.document);
  }

  function buildLog() {
    const events = audit();
    return `${JSON.stringify({
      version: VERSION,
      exportedAt: new Date().toISOString(),
      queueSize: queue().length,
      events,
    }, null, 2)}\n`;
  }

  function failureSummaryFromEvents(events) {
    const list = Array.isArray(events) ? events : [];
    let failureIndex = -1;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (list[index]?.status === 'failed') {
        failureIndex = index;
        break;
      }
    }
    if (failureIndex < 0) return 'Nenhuma falha registrada.';

    const failure = list[failureIndex];
    const failureQuestion = normalizeText(failure.question);
    const recovered = list.slice(failureIndex + 1).some((event) => {
      if (event?.status !== 'added') return false;
      if (failure.id && event.id === failure.id) return true;
      return failureQuestion && normalizeText(event.question) === failureQuestion;
    });
    const question = normalizeWhitespace(failure.question) || 'pergunta não identificada';
    const detail = normalizeWhitespace(failure.detail) || 'motivo não registrado';
    return `Última falha: ${question} — ${detail}.${recovered ? ' O card foi capturado depois.' : ' Não há captura posterior confirmada no log.'}`;
  }

  function latestFailureSummary() {
    return failureSummaryFromEvents(audit());
  }

  function createButton(label, action) {
    const button = page.document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    }, true);
    return button;
  }

  function patchPanel(panel) {
    if (!panel || panel.hasAttribute(PATCH_MARKER)) return false;
    panel.setAttribute(PATCH_MARKER, 'true');

    const title = panel.querySelector('strong');
    if (title) title.textContent = `Osler Anki Bridge — ${VERSION}`;

    panel.querySelector('[data-action="download"]')?.remove();
    panel.querySelector('[data-action="audit"]')?.remove();

    const captureButton = panel.querySelector('[data-action="capture"]');
    const controls = page.document.createElement('div');
    controls.dataset.role = 'v048-controls';
    controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px';

    controls.appendChild(createButton('Baixar TSV', () => {
      try {
        const contents = buildTsv();
        const filename = `osler-anki-${timestamp()}.tsv`;
        downloadWithViolentmonkey(panel, contents, filename, 'text/tab-separated-values;charset=utf-8');
      } catch (error) {
        setMessage(panel, `TSV NÃO GERADO — ${error?.message || error}`, 'failed');
      }
    }));

    controls.appendChild(createButton('Abrir TSV', () => {
      try {
        const opened = openFile(buildTsv(), 'text/tab-separated-values;charset=utf-8');
        setMessage(panel, opened
          ? 'TSV ABERTO EM NOVA ABA — use o menu do Firefox para salvar.'
          : 'O Firefox bloqueou a nova aba.', opened ? 'waiting' : 'failed');
      } catch (error) {
        setMessage(panel, `TSV NÃO ABERTO — ${error?.message || error}`, 'failed');
      }
    }));

    controls.appendChild(createButton('Baixar log', () => {
      const contents = buildLog();
      const filename = `osler-anki-diagnostico-${timestamp()}.json`;
      downloadWithViolentmonkey(panel, contents, filename, 'application/json;charset=utf-8');
    }));

    controls.appendChild(createButton('Copiar log', () => {
      try {
        if (typeof GM_setClipboard !== 'function') throw new Error('GM_setClipboard indisponível');
        GM_setClipboard(buildLog(), 'text');
        setMessage(panel, 'LOG COPIADO — pode colar diretamente na conversa.', 'added');
      } catch (error) {
        setMessage(panel, `NÃO FOI POSSÍVEL COPIAR O LOG — ${error?.message || error}`, 'failed');
      }
    }));

    if (captureButton?.parentNode) captureButton.parentNode.insertBefore(controls, captureButton.nextSibling);
    else panel.appendChild(controls);

    const failure = page.document.createElement('div');
    failure.dataset.role = 'v048-failure';
    failure.style.cssText = 'margin-top:6px;max-width:360px;overflow-wrap:anywhere';
    failure.textContent = latestFailureSummary();
    panel.appendChild(failure);

    page.setInterval(() => {
      failure.textContent = latestFailureSummary();
    }, 1000);
    return true;
  }

  function waitAndPatch() {
    const panel = page.document?.getElementById?.(CORE_PANEL_ID);
    if (patchPanel(panel)) return;
    page.setTimeout?.(waitAndPatch, 100);
  }

  const api = {
    buildLog,
    buildTsv,
    failureSummaryFromEvents,
    latestFailureSummary,
    parseArray,
    patchPanel,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (page.document) {
    waitAndPatch();
    page.OslerAnkiBridgeV048 = api;
  }
})();

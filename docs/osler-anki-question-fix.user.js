// ==UserScript==
// @name         Osler Anki Bridge — Correção de perguntas
// @namespace    https://github.com/osler-anki-bridge/osler-anki-bridge
// @version      0.4.13
// @description  Impede que referências bibliográficas em itálico sejam confundidas com a pergunta do flashcard.
// @match        https://oslermedicina.com.br/*
// @match        https://*.oslermedicina.com.br/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-question-fix.user.js
// @downloadURL  https://raw.githubusercontent.com/leonardolealluz183-bit/osler-anki-bridge/phase-2-android-bridge/docs/osler-anki-question-fix.user.js
// ==/UserScript==

(function installQuestionFix() {
  'use strict';

  const FIX_VERSION = '0.4.13';
  const CLOZE_SELECTOR = '.cloze-answer,[class*="cloze-answer"],[class*="ClozeAnswer"],[class*="clozeAnswer"]';
  let scheduled = false;

  const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  function isEntirelyItalicReference(paragraph) {
    if (!paragraph || paragraph.closest?.('[id^="osler-anki-bridge-"]')) return false;
    if (paragraph.querySelector?.(CLOZE_SELECTOR)) return false;

    const paragraphText = normalizeWhitespace(paragraph.textContent);
    if (!paragraphText || paragraphText.length < 12) return false;

    const italicChildren = Array.from(paragraph.children || [])
      .filter((child) => ['EM', 'I'].includes(String(child.tagName || '').toUpperCase()));

    const italic = italicChildren.find((child) => {
      return normalizeWhitespace(child.textContent) === paragraphText;
    });

    if (!italic) return false;
    if (!italic.querySelector?.('strong,b')) return false;
    if (/\?$/.test(paragraphText)) return false;

    return true;
  }

  function markReferences(root = document) {
    const paragraphs = root?.querySelectorAll?.('p') || [];
    let marked = 0;

    Array.from(paragraphs).forEach((paragraph) => {
      if (paragraph.dataset?.oslerAnkiReference === 'true') return;
      if (!isEntirelyItalicReference(paragraph)) return;

      paragraph.dataset.oslerAnkiReference = 'true';
      paragraph.setAttribute('aria-hidden', 'true');
      marked += 1;
    });

    return marked;
  }

  function scheduleMarking() {
    if (scheduled) return;
    scheduled = true;

    const run = () => {
      scheduled = false;
      markReferences(document);
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  function startObserver() {
    markReferences(document);

    const target = document.documentElement || document;
    const observer = new MutationObserver(scheduleMarking);
    observer.observe(target, { childList: true, subtree: true });

    window.setInterval?.(scheduleMarking, 750);
  }

  window.OslerAnkiQuestionFixV0413 = {
    version: FIX_VERSION,
    isEntirelyItalicReference,
    markReferences,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }
}());

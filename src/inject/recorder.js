/**
 * recorder.js
 *
 * Browser-side passive action recorder injected into pages by the Scraper
 * Creator tool.
 *
 * Records clicks (and optionally other interaction types) so that element
 * targeting information is available for selector generation and scraper
 * template construction, even when the MCP tool call did not initiate the
 * interaction directly.
 *
 * Requires highlighter.js (and optionally selector.js) to be injected first
 * so that window.__scraperCreator.getElementInfo() is available.
 *
 * Exposes:
 *   window.__scraperCreator.capturedClicks         — array of recorded events
 *   window.__scraperCreator.getCapturedClicks()    — returns a shallow copy
 *   window.__scraperCreator.clearCapturedClicks()  — clears the array
 *   window.__scraperCreator.capturedInputs         — array of recorded inputs
 *   window.__scraperCreator.getCapturedInputs()    — returns a shallow copy
 *   window.__scraperCreator.clearCapturedInputs()  — clears the array
 *   window.__scraperCreator.startRecording()       — enable passive recording
 *   window.__scraperCreator.stopRecording()        — disable passive recording
 *   window.__scraperCreator.isRecording()          — current state
 */

(function () {
  'use strict';

  if (!window.__scraperCreator) {
    window.__scraperCreator = {};
  }

  const SC = window.__scraperCreator;

  // ── Storage ───────────────────────────────────────────────────────────────
  SC.capturedClicks = SC.capturedClicks || [];
  SC.capturedInputs = SC.capturedInputs || [];

  let _recording = false;

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Safely call getElementInfo.  Falls back to minimal info if the function
   * is not yet available (e.g. highlighter.js not loaded).
   */
  function safeGetElementInfo(x, y) {
    if (typeof SC.getElementInfo === 'function') {
      try {
        return SC.getElementInfo(x, y);
      } catch (err) {
        console.warn('[scraperCreator] getElementInfo error:', err);
      }
    }

    // Minimal fallback
    const el = document.elementFromPoint(x, y);
    if (!el) return null;

    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: Array.from(el.classList),
      text: (el.textContent || '').trim().slice(0, 200),
      href: el.getAttribute('href') || null,
      rect: null,
      selector: { css: null, xpath: null, testId: null, ariaLabel: null },
      parentInfo: null,
      childCount: el.children.length,
      isInList: false,
    };
  }

  /**
   * Enrich an element info object with selector data if selector.js is
   * loaded.
   */
  function enrich(el, info) {
    if (!info) return info;
    if (typeof SC.generateSelectors === 'function') {
      try {
        info.allSelectors = SC.generateSelectors(el);
      } catch {
        // non-fatal
      }
    }
    return info;
  }

  // ── Click handler ─────────────────────────────────────────────────────────

  function onDocumentClick(e) {
    if (!_recording) return;

    const x = e.clientX;
    const y = e.clientY;

    // Temporarily un-hide overlay so elementFromPoint skips it
    const info = safeGetElementInfo(x, y);

    // Also grab the actual event target (might be a child of the hovered el)
    const targetEl = e.target instanceof Element ? e.target : null;
    const enriched = targetEl ? enrich(targetEl, info) : info;

    SC.capturedClicks.push({
      ...(enriched || {}),
      type: 'click',
      timestamp: Date.now(),
      url: window.location.href,
      pageTitle: document.title,
      clientX: x,
      clientY: y,
      button: e.button,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
  }

  // ── Input / change handler ────────────────────────────────────────────────

  function onDocumentInput(e) {
    if (!_recording) return;

    const el = e.target;
    if (!el || !(el instanceof Element)) return;

    const tag = el.tagName.toLowerCase();
    if (!['input', 'textarea', 'select'].includes(tag)) return;

    // Debounce: replace the last input record for the same element if it was
    // within 1 second (avoids recording every keystroke as separate events).
    const now = Date.now();
    const lastIdx = SC.capturedInputs.findLastIndex
      ? SC.capturedInputs.findLastIndex(
          (r) => r._elementKey === _elementKey(el)
        )
      : -1;

    const record = {
      type: 'input',
      tagName: tag,
      id: el.id || null,
      classes: Array.from(el.classList),
      name: el.getAttribute('name') || null,
      inputType: el.getAttribute('type') || null,
      value:
        el.type === 'password'
          ? '***'
          : (el.value !== undefined ? el.value : el.textContent || ''),
      timestamp: now,
      url: window.location.href,
      pageTitle: document.title,
      _elementKey: _elementKey(el),
    };

    // Enrich with selector info
    try {
      if (typeof SC.generateSelectors === 'function') {
        record.allSelectors = SC.generateSelectors(el);
      }
    } catch {
      // non-fatal
    }

    if (
      lastIdx !== -1 &&
      now - SC.capturedInputs[lastIdx].timestamp < 1000
    ) {
      SC.capturedInputs[lastIdx] = record;
    } else {
      SC.capturedInputs.push(record);
    }
  }

  function _elementKey(el) {
    return [el.tagName, el.id, el.getAttribute('name'), el.className].join('|');
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Start listening for click and input events. */
  SC.startRecording = function () {
    if (_recording) return;
    _recording = true;
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('input', onDocumentInput, true);
    document.addEventListener('change', onDocumentInput, true);
  };

  /** Stop listening for events. */
  SC.stopRecording = function () {
    if (!_recording) return;
    _recording = false;
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('input', onDocumentInput, true);
    document.removeEventListener('change', onDocumentInput, true);
  };

  /** Returns whether passive recording is currently active. */
  SC.isRecording = function () {
    return _recording;
  };

  // ── Click API ─────────────────────────────────────────────────────────────

  /** Returns a shallow copy of all captured click records. */
  SC.getCapturedClicks = function () {
    return [...SC.capturedClicks];
  };

  /** Clears the captured clicks array. */
  SC.clearCapturedClicks = function () {
    SC.capturedClicks = [];
  };

  // ── Input API ─────────────────────────────────────────────────────────────

  /** Returns a shallow copy of all captured input records. */
  SC.getCapturedInputs = function () {
    return [...SC.capturedInputs];
  };

  /** Clears the captured inputs array. */
  SC.clearCapturedInputs = function () {
    SC.capturedInputs = [];
  };

  // ── Auto-start ────────────────────────────────────────────────────────────
  // Start recording immediately on injection.
  SC.startRecording();
})();

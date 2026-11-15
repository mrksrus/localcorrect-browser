// Injected on demand (shortcut or toolbar). Reads the focused field, asks the background
// for corrections and writes them back with execCommand('insertText'), so the page's own
// editor sees normal input and Ctrl+Z works. Nothing runs until the user asks.
(() => {
  if (globalThis.__localCorrect) return;
  const api = globalThis.browser || globalThis.chrome;
  const TEXT_INPUTS = new Set(['text', 'search', '']);
  const LIMIT = 50000;
  let last = null; // {element, after, steps} for Undo

  function focusedField() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    if (!el || el.disabled || el.readOnly) return null;
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_INPUTS.has(el.getAttribute('type')?.toLowerCase() ?? ''))) return el;
    if (el.isContentEditable) return el;
    return null;
  }

  // Text nodes of a contenteditable, joined into one string; block boundaries become "\n".
  // Quotes, code and links are left out so they are never edited.
  function textMap(root) {
    const nodes = [];
    let text = '', lastBlock = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode(node) {
      return node.parentElement.closest('blockquote, pre, code, a, script, style, [contenteditable="false"], .gmail_quote, .moz-signature, #divRplyFwdMsg')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }});
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let block = node.parentElement;
      while (block !== root && getComputedStyle(block).display.startsWith('inline')) block = block.parentElement;
      if (lastBlock && block !== lastBlock) text += '\n';
      lastBlock = block;
      nodes.push({node, start: text.length});
      text += node.data;
    }
    return {text, nodes};
  }
  const fieldText = el => el.isContentEditable ? textMap(el).text : el.value;

  // Offsets in the map text of the current selection, or null when nothing is selected.
  function selectionRange(el, map) {
    if (!el.isContentEditable) return el.selectionStart !== el.selectionEnd ? [el.selectionStart, el.selectionEnd] : null;
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const at = (container, offset) => {
      const hit = map.nodes.find(n => n.node === container);
      if (hit) return hit.start + offset;
      const probe = document.createRange();
      probe.setStart(container, offset);
      const after = map.nodes.find(n => probe.comparePoint(n.node, 0) >= 0);
      return after ? after.start : map.text.length;
    };
    return [at(range.startContainer, range.startOffset), at(range.endContainer, range.endOffset)];
  }

  const insert = text => document.execCommand('insertText', false, text);

  async function correct() {
    const el = focusedField();
    if (!el) return null; // another frame may own the focus
    const map = el.isContentEditable ? textMap(el) : {text: el.value};
    if (map.text.length > LIMIT) throw new Error('Text is too long. Select a part of it.');
    const range = selectionRange(el, map) || [0, map.text.length];
    const reply = await api.runtime.sendMessage({type: 'localcorrect-check', text: map.text});
    if (reply?.error) throw new Error(reply.error);
    const edits = reply.edits.filter(e => e.offset >= range[0] && e.offset + e.length <= range[1]);
    if (fieldText(el) !== map.text) throw new Error('The text changed while checking. Try again.');
    if (!edits.length) return {changed: 0, language: reply.language, edits: []};
    let steps = 0, applied = edits;
    el.focus();
    if (!el.isContentEditable) {
      // One replacement covering all edits: a single Ctrl+Z step, nothing outside it touched.
      const from = edits[0].offset, to = edits.at(-1).offset + edits.at(-1).length;
      let out = '', pos = from;
      for (const e of edits) { out += map.text.slice(pos, e.offset) + e.replacement; pos = e.offset + e.length; }
      el.setSelectionRange(from, to);
      if (insert(out)) steps = 1;
      else { // editor refused the input event: set the value the way frameworks still notice
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, map.text.slice(0, from) + out + map.text.slice(to));
        el.dispatchEvent(new Event('input', {bubbles: true}));
      }
    } else {
      const sel = getSelection();
      applied = [];
      for (const e of [...edits].reverse()) { // back to front keeps earlier offsets valid
        const hit = map.nodes.findLast(n => n.start <= e.offset), at = e.offset - (hit?.start ?? 0);
        // Skip words split by formatting, or nodes the editor replaced meanwhile.
        if (!hit?.node.isConnected || hit.node.data.slice(at, at + e.length) !== e.original) continue;
        const r = document.createRange();
        r.setStart(hit.node, at);
        r.setEnd(hit.node, at + e.length);
        sel.removeAllRanges();
        sel.addRange(r);
        if (insert(e.replacement)) steps++;
        else { hit.node.replaceData(at, e.length, e.replacement); el.dispatchEvent(new Event('input', {bubbles: true})); }
        applied.unshift(e);
      }
      sel.collapseToEnd();
    }
    last = {element: el, after: fieldText(el), steps};
    return {changed: applied.length, language: reply.language, edits: applied.map(e => [e.original, e.replacement])};
  }

  function undo() {
    const el = focusedField();
    if (!el) return null;
    if (!last || last.element !== el) throw new Error('Nothing to undo in this field.');
    if (fieldText(el) !== last.after) throw new Error('The text changed since the correction. Use Ctrl+Z.');
    if (!last.steps) throw new Error('This editor does not support undo here. Use Ctrl+Z.');
    el.focus();
    for (let i = 0; i < last.steps; i++) document.execCommand('undo');
    last = null;
    return {undone: true};
  }

  globalThis.__localCorrect = {
    async run(action) {
      try { return await (action === 'undo' ? undo() : correct()); }
      catch (error) { return {error: error.message}; }
    },
  };
})();

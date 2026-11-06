import {createCorrector, protectedRanges} from '../packages/core/src/index.js';

// Isolated world, no page globals or network correction. Retain one undo only.
if (!globalThis.__localCorrect) {
  let corrector, undoState, pending, sequence = 0;
  const allowedTypes = new Set(['text', 'search']);
  const forbidden = 'blockquote,pre,code,script,style,[contenteditable="false"],[data-localcorrect-ignore],.gmail_quote,.gmail_signature,.moz-signature,.moz-cite-prefix,#divRplyFwdMsg,[data-signature]';
  const blocks = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3']);
  const fail = message => { throw new Error(message); };
  function editable() {
    let active = document.activeElement;
    for (let depth = 0; active && /^(?:IFRAME|FRAME)$/.test(active.tagName); depth++) {
      if (depth >= 8) fail('The focused editor is nested too deeply.');
      let child;
      try {child = active.contentDocument;} catch { /* Cross-origin frame remains protected. */ }
      if (!child) fail('This embedded editor is not accessible. Open it directly in its own tab.');
      active = child.activeElement;
    }
    if (!active || !active.isConnected) fail('Focus a supported editable field first.');
    const realm = active.ownerDocument.defaultView;
    if (active instanceof realm.HTMLInputElement) {
      if (!allowedTypes.has(active.type)) fail('Only text and search inputs are supported. Password, email, URL and numeric fields are excluded.');
      if (active.disabled || active.readOnly || active.matches(':disabled') || active.closest('[inert]') || active.closest(forbidden) || active.getAttribute('aria-readonly') === 'true') fail('This field is disabled, protected or read-only.');
      return {root: active, plain: true};
    }
    if (active instanceof realm.HTMLTextAreaElement) {
      if (active.disabled || active.readOnly || active.matches(':disabled') || active.closest('[inert]') || active.closest(forbidden) || active.getAttribute('aria-readonly') === 'true') fail('This field is disabled, protected or read-only.');
      return {root: active, plain: true};
    }
    const root = active.closest('[contenteditable]');
    if (!root || !root.isContentEditable || root.closest(forbidden) || root.closest('[inert]') || root.getAttribute('aria-readonly') === 'true')
      fail('Focus a supported editable field first.');
    if (root.querySelector('iframe,object,embed,img,video,audio,canvas,svg,math,table,input,textarea,select,button'))
      fail('This rich editor contains unsupported embedded content. Use a plain-text field instead.');
    return {root, plain: false};
  }
  function notify(root, type) {
    root.dispatchEvent(new root.ownerDocument.defaultView.InputEvent('input', {bubbles: true, inputType: type, data: null}));
  }
  function requireWholeTokens(text, start, end) {
    const inside = position => (/[\p{L}\p{M}\p{N}\p{Pc}\p{Cf}]$/u.test(text.slice(0,position)) && /^[\p{L}\p{M}\p{N}\p{Pc}\p{Cf}]/u.test(text.slice(position))) || (/[\uD800-\uDBFF]$/.test(text.slice(0,position)) && /^[\uDC00-\uDFFF]/.test(text.slice(position)));
    if (inside(start) || inside(end)) fail('Selection cuts through a word. Select complete words; no changes made.');
  }
  function plainCorrect(root, options) {
    const before = root.value;
    if (before.length > 1000000) fail('Field is too large.');
    const start = root.selectionStart ?? 0, end = root.selectionEnd ?? 0;
    const a = start === end ? 0 : start, b = start === end ? before.length : end;
    requireWholeTokens(before, a, b);
    const result = corrector.correct(before.slice(a, b), options);
    const protectedSpans = protectedRanges(before);
    const permitted = result.edits.filter(e => !protectedSpans.some(([x,y]) => a + e.offset < y && a + e.offset + e.length > x));
    result.skipped += result.edits.length - permitted.length;
    result.edits = permitted;
    result.text = before.slice(a, b);
    for (const e of [...permitted].reverse()) result.text = result.text.slice(0,e.offset) + e.replacement + result.text.slice(e.offset+e.length);
    if (result.edits.length) {
      const after = before.slice(0, a) + result.text + before.slice(b);
      const realm = root.ownerDocument.defaultView;
      const setter = Object.getOwnPropertyDescriptor(root instanceof realm.HTMLTextAreaElement ? realm.HTMLTextAreaElement.prototype : realm.HTMLInputElement.prototype, 'value').set;
      setter.call(root, after);
      root.setSelectionRange(a, a + result.text.length);
      undoState = {root, plain: true, before, after, start, end, setter};
      notify(root, 'insertReplacementText');
    }
    return result;
  }
  function validateCapture(options,target,consume=false){
    const captured=pending;
    if(consume)pending=null;
    const root=target.root,selection=root.ownerDocument.defaultView.getSelection();
    if(!captured||captured.id!==options.operationId||captured.root!==root||captured.plain!==target.plain||
       captured.before!==(target.plain?root.value:root.innerHTML)||
       (target.plain&&(captured.start!==root.selectionStart||captured.end!==root.selectionEnd))||
       (!target.plain&&(captured.anchorNode!==selection?.anchorNode||captured.anchorOffset!==selection?.anchorOffset||captured.focusNode!==selection?.focusNode||captured.focusOffset!==selection?.focusOffset)))
      fail('The field or selection changed while LocalCorrect was loading. No changes made; try the shortcut again.');
  }
  function collect(root) {
    const selection = root.ownerDocument.defaultView.getSelection();
    let range;
    if (selection?.rangeCount && !selection.isCollapsed) {
      range = selection.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer))
        fail('The selection must stay inside one editable field.');
    }
    const pieces = [];
    let text = '', context = '';
    const separator = () => {
      if (text && !text.endsWith('\n')) text += '\n';
      if (context && !context.endsWith('\n')) context += '\n';
    };
    let nodes = 0;
    function visit(node) {
      if (++nodes > 10000) fail('This editor is too complex.');
      if (node.nodeType === Node.TEXT_NODE) {
        const contextStart = context.length;
        context += node.data;
        if (context.length > 1000000) fail('Field is too large.');
        if (range && !range.intersectsNode(node)) return;
        const a = range?.startContainer === node ? range.startOffset : 0;
        const b = range?.endContainer === node ? range.endOffset : node.length;
        if (a >= b) return;
        pieces.push({node, a, b, offset: text.length, contextOffset: contextStart + a, before: node.data});
        text += node.data.slice(a, b);
        if (text.length > 20000) fail('Text exceeds 20,000 UTF-16 code units. Select a smaller passage.');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node !== root && (node.matches(forbidden) || node.tagName === 'A')) { separator(); return; }
      if (node.tagName === 'BR') { separator(); return; }
      if (blocks.has(node.tagName)) separator();
      for (const child of node.childNodes) visit(child);
      if (blocks.has(node.tagName)) separator();
    }
    visit(root);
    if (range && pieces.length) {
      const first = pieces[0], last = pieces[pieces.length-1];
      requireWholeTokens(context, first.contextOffset, last.contextOffset + last.b - last.a);
    }
    return {pieces, text, context};
  }
  function richCorrect(root, options) {
    const {pieces, text, context} = collect(root);
    const result = corrector.correct(text, options);
    const protectedSpans = protectedRanges(context);
    result.edits = result.edits.filter(edit => {
      const blocked = pieces.some(p => {
        const a = Math.max(p.offset, edit.offset), b = Math.min(p.offset + p.b - p.a, edit.offset + edit.length);
        return a < b && protectedSpans.some(([x,y]) => p.contextOffset + a - p.offset < y && p.contextOffset + b - p.offset > x);
      });
      if (blocked) result.skipped++;
      return !blocked;
    });
    if (!result.edits.length) return result;
    const beforeHTML = root.innerHTML;
    // Operate only on Text.data: never parse HTML, clone or replace elements.
    // Cross-inline edits distribute the replacement over the original text nodes.
    const changes = new Map();
    for (const edit of result.edits) {
      const hits = pieces.filter(p => p.offset < edit.offset + edit.length && p.offset + p.b - p.a > edit.offset);
      const coverage = hits.reduce((n, p) => n + Math.min(p.offset + p.b - p.a, edit.offset + edit.length) - Math.max(p.offset, edit.offset), 0);
      if (coverage !== edit.length) fail('A correction crosses an unsupported rich-text boundary. No changes made.');
      let consumed = 0;
      for (let i = 0; i < hits.length; i++) {
        const p = hits[i];
        const from = Math.max(p.offset, edit.offset), to = Math.min(p.offset + p.b - p.a, edit.offset + edit.length);
        const length = to - from;
        const replacement = i === hits.length - 1 ? edit.replacement.slice(consumed) : edit.replacement.slice(consumed, consumed + length);
        consumed += length;
        if (!changes.has(p.node)) changes.set(p.node, []);
        changes.get(p.node).push({from: p.a + from - p.offset, to: p.a + to - p.offset, replacement});
      }
    }
    const states = [];
    for (const [node, edits] of changes) {
      const before = node.data;
      let after = before;
      for (const e of edits.sort((a, b) => b.from - a.from)) after = after.slice(0, e.from) + e.replacement + after.slice(e.to);
      states.push({node, before, after});
    }
    for (const s of states) s.node.data = s.after;
    undoState = {root, plain: false, beforeHTML, after: root.innerHTML, states};
    notify(root, 'insertReplacementText');
    return result;
  }
  function undo() {
    const state = undoState;
    if (!state) fail('There is no correction to undo in this tab.');
    const {root} = state;
    if (!root.isConnected || root.disabled || root.readOnly || root.matches(':disabled') || root.closest('[inert]') || root.closest(forbidden) || root.getAttribute('aria-readonly') === 'true' ||
        (state.plain && root instanceof root.ownerDocument.defaultView.HTMLInputElement && !allowedTypes.has(root.type)) ||
        (!state.plain && (!root.isContentEditable || root.closest(forbidden)))) { undoState = null; fail('Undo is stale: the editable field is no longer available.'); }
    if (state.plain) {
      if (root.value !== state.after) { undoState = null; fail('Undo is stale: the text changed after correction.'); }
      state.setter.call(root, state.before);
      root.setSelectionRange(state.start, state.end);
    } else {
      if (root.innerHTML !== state.after || state.states.some(s => !root.contains(s.node) || s.node.data !== s.after)) {
        undoState = null; fail('Undo is stale: the editor changed after correction.');
      }
      for (const s of state.states) s.node.data = s.before;
    }
    undoState = null;
    notify(root, 'historyUndo');
    return {undone: true};
  }
  globalThis.__localCorrect = {
    capture() {
      const target = editable(), root = target.root;
      const selection = root.ownerDocument.defaultView.getSelection();
      pending = {id: ++sequence, ...target, before: target.plain ? root.value : root.innerHTML,
        start: target.plain ? root.selectionStart : null, end: target.plain ? root.selectionEnd : null,
        anchorNode: selection?.anchorNode, anchorOffset: selection?.anchorOffset,
        focusNode: selection?.focusNode, focusOffset: selection?.focusOffset};
      return pending.id;
    },
    prepare(options){
      const target=editable();
      validateCapture(options,target);
      let text;
      if(target.plain){
        const root=target.root,before=root.value;
        if(before.length>1000000)fail('Field is too large.');
        const start=root.selectionStart??0,end=root.selectionEnd??0;
        const a=start===end?0:start,b=start===end?before.length:end;
        requireWholeTokens(before,a,b);text=before.slice(a,b);
      }else text=collect(target.root).text;
      if(text.length>20000)fail('Text exceeds 20,000 UTF-16 code units. Select a smaller passage.');
      return{operationId:options.operationId,text};
    },
    cancel(operationId){if(pending?.id===operationId)pending=null;},
    run(dictionaries, options) {
      if (options.action === 'undo') return undo();
      const target = editable();
      if (options.operationId !== undefined) {
        validateCapture(options,target,true);
      }
      if (!corrector) corrector = createCorrector(dictionaries);
      const result = target.plain ? plainCorrect(target.root, options) : richCorrect(target.root, options);
      return {changed: result.edits.length, skipped: result.skipped};
    }
  };
}

import {readSettings} from './settings.js';

// Explicit correction reads its captured selection into this local background
// operation for offline inference. No text is stored, logged or sent remotely.
export function createRunner(api, fetchResource = globalThis.fetch, predictContext = null) {
  let dictionaries;
  const running = new Set();
  function loadDictionaries() {
    if (!dictionaries) dictionaries = Promise.all(['en', 'de'].map(async language => {
      const response = await fetchResource(api.runtime.getURL(`dictionaries/${language}.txt`));
      if (!response.ok) throw new Error('Bundled dictionary unavailable.');
      return response.text();
    })).then(([en, de]) => ({en, de})).catch(error => {dictionaries = null; throw error;});
    return dictionaries;
  }
  async function run(action) {
    if (!['correct', 'undo'].includes(action)) throw new Error('Unknown action.');
    const [tab] = await api.tabs.query({active: true, currentWindow: true});
    if (!Number.isInteger(tab?.id) || !/^(?:https?:|file:)/.test(tab.url || ''))
      throw new Error('Open a normal web page. Browser-internal pages and extension stores are restricted.');
    if (running.has(tab.id)) throw new Error('A correction is already running in this tab.');
    running.add(tab.id);
    let operationId,prepared;
    const target = {tabId: tab.id};
    async function requireActive(){
      const [[active], focusedWindow] = await Promise.all([
        api.tabs.query({active: true, currentWindow: true}), api.windows.getLastFocused()
      ]);
      if (active?.id !== tab.id || active.windowId !== tab.windowId ||
          focusedWindow.id !== tab.windowId || !focusedWindow.focused)
        throw new Error('The active tab or window changed while LocalCorrect was loading. No changes made; try again.');
    }
    try {
      const settings = await readSettings(api);
      await api.scripting.executeScript({target, files: ['target.js']});
      if (action === 'correct') {
        const captures = await api.scripting.executeScript({target, func: () => globalThis.__localCorrect.capture()});
        operationId = captures[0]?.result;
        if (!Number.isInteger(operationId)) throw new Error('Could not capture the focused field.');
      }
      const dict = action === 'correct' ? await loadDictionaries() : null;
      const options = {action, language: settings.language, mode: settings.mode, mixedLanguage: settings.mixedLanguage};
      if (operationId !== undefined) options.operationId = operationId;
      if(action==='correct'&&predictContext){
        await requireActive();
        const captures=await api.scripting.executeScript({target,
          func:opts=>globalThis.__localCorrect.prepare(opts),args:[options]});
        prepared=captures[0]?.result;
        if(prepared?.operationId!==operationId||typeof prepared.text!=='string')throw new Error('Could not prepare the captured field.');
        options.contextScores=await predictContext(prepared.text,settings.language);
        prepared=undefined;
        if(!Array.isArray(options.contextScores))throw new Error('Contextual inference did not return valid scores.');
      }
      // Browser focus can change while packaged resources are loading without
      // changing the old document's activeElement or selection.
      await requireActive();
      const results = await api.scripting.executeScript({target,
        func: (dictionaries, opts) => globalThis.__localCorrect.run(dictionaries, opts), args: [dict, options]});
      const result = results[0]?.result;
      if (!result) throw new Error('No result from the page.');
      return result;
    } finally {
      prepared=undefined;
      if(predictContext&&operationId!==undefined){
        try{await api.scripting.executeScript({target,func:id=>globalThis.__localCorrect?.cancel(id),args:[operationId]});}catch{/* The tab may have closed. */}
      }
      running.delete(tab.id);
    }
  }
  return {run};
}

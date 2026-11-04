import {readSettings} from './settings.js';

// No document text is read into the background. Only packaged dictionaries,
// settings, operation IDs and result counts cross the extension boundary.
export function createRunner(api, fetchResource = globalThis.fetch) {
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
    try {
      const settings = await readSettings(api);
      const target = {tabId: tab.id};
      await api.scripting.executeScript({target, files: ['target.js']});
      let operationId;
      if (action === 'correct') {
        const captures = await api.scripting.executeScript({target, func: () => globalThis.__localCorrect.capture()});
        operationId = captures[0]?.result;
        if (!Number.isInteger(operationId)) throw new Error('Could not capture the focused field.');
      }
      const dict = action === 'correct' ? await loadDictionaries() : null;
      const options = {action, language: settings.language, mode: settings.mode};
      if (operationId !== undefined) options.operationId = operationId;
      const results = await api.scripting.executeScript({target,
        func: (dictionaries, opts) => globalThis.__localCorrect.run(dictionaries, opts), args: [dict, options]});
      const result = results[0]?.result;
      if (!result) throw new Error('No result from the page.');
      return result;
    } finally {running.delete(tab.id);}
  }
  return {run};
}

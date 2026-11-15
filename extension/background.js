import {createCorrector} from './corrector.js';

const api = globalThis.browser || globalThis.chrome;
let corrector;

// Word lists load on first use (about 1 s) and stay in memory while the background is alive.
function load() {
  corrector ??= Promise.all(['en', 'de'].map(code => fetch(api.runtime.getURL(`data/${code}.lex`)).then(r => r.text())))
    .then(([en, de]) => createCorrector({en, de}))
    .catch(error => { corrector = null; throw error; });
  return corrector;
}

async function settings() {
  const {language = 'auto'} = await api.storage.local.get('language');
  return {language};
}

async function badge(text, color, title) {
  await api.action.setBadgeText({text});
  await api.action.setBadgeBackgroundColor({color});
  await api.action.setTitle({title: `LocalCorrect: ${title}`});
}

async function run(action) {
  const [tab] = await api.tabs.query({active: true, currentWindow: true});
  let result;
  try {
    if (!tab?.id || !/^(https?|file):/.test(tab.url || '')) throw new Error('This page cannot be edited by extensions.');
    if (action === 'correct') load(); // start loading while the script is injected
    await api.scripting.executeScript({target: {tabId: tab.id, allFrames: true}, files: ['content.js']});
    const frames = await api.scripting.executeScript({target: {tabId: tab.id, allFrames: true},
      func: a => globalThis.__localCorrect.run(a), args: [action]});
    result = frames.map(f => f.result).find(Boolean) || {error: 'Click into a text field first.'};
  } catch (error) {
    result = {error: error.message};
  }
  if (result.error) await badge('!', '#b3261e', result.error);
  else if (result.undone) await badge('', '#2856a2', 'last correction undone');
  else await badge(result.changed ? String(result.changed) : '✓', '#2856a2',
    result.changed ? `${result.changed} fixed: ${result.edits.map(([a, b]) => `${a} → ${b}`).join(', ')}` : 'no typos found');
  await api.storage.session?.set({last: result});
  return result;
}

api.commands.onCommand.addListener(command => {
  if (command === 'correct-text') run('correct');
  if (command === 'undo-correction') run('undo');
});

api.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== api.runtime.id) return false;
  if (message?.type === 'localcorrect-check') {
    Promise.all([load(), settings()])
      .then(([c, s]) => reply(c.correct(message.text, s)))
      .catch(error => reply({error: error.message}));
    return true;
  }
  if (message?.type === 'localcorrect-run') { run(message.action); return false; }
  return false;
});

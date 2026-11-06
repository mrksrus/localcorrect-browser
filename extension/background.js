import {createRunner} from './runner.js';
import {createContextRuntime} from './context-runtime.js';
const api = globalThis.browser || globalThis.chrome;
const contextRuntime = createContextRuntime(api);
const runner = createRunner(api, globalThis.fetch, contextRuntime.predict);
async function perform(action) {
  try {
    const result = await runner.run(action);
    const text = result.undone ? '↶' : String(Math.min(999, result.changed));
    await api.action.setBadgeText({text});
    await api.action.setBadgeBackgroundColor({color: '#2856a2'});
    await api.action.setTitle({title: result.undone ? 'LocalCorrect: correction undone' : `LocalCorrect: ${result.changed} replacements; ${result.skipped} protected or uncertain tokens left unchanged`});
    return {ok: true, result};
  } catch (error) {
    const message = error?.message || 'This field is unsupported.';
    await api.action.setBadgeText({text: '!'});
    await api.action.setBadgeBackgroundColor({color: '#855118'});
    await api.action.setTitle({title: `LocalCorrect: ${message}`});
    return {ok: false, error: message};
  }
}
api.commands.onCommand.addListener(command => {
  const action = {'correct-text': 'correct', 'undo-correction': 'undo'}[command];
  if (action) void perform(action);
});
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'localcorrect-run') return false;
  if (sender.id !== api.runtime.id || !sender.url?.startsWith(api.runtime.getURL(''))) return false;
  void perform(message.action).then(sendResponse);
  return true; // Callback response also works on older supported Chromium.
});
async function restoreShortcuts() {
  if (!api.commands.update) return;
  const {shortcuts} = await api.storage.local.get('shortcuts');
  if (!shortcuts) return;
  for (const name of ['correct-text', 'undo-correction']) {
    if (typeof shortcuts[name] === 'string') {
      try {await api.commands.update({name, shortcut: shortcuts[name]});} catch { /* Leave the browser's valid binding intact. */ }
    }
  }
}
api.runtime.onStartup.addListener(() => {void restoreShortcuts();});
api.runtime.onInstalled.addListener(() => {void restoreShortcuts();});

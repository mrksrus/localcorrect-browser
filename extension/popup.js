import {normalizeSettings} from './settings.js';
const api = globalThis.browser || globalThis.chrome;
const $ = id => document.getElementById(id);
const messages = {
  en: {ui:'Interface', language:'Text language', mixedLanguage:'Mixed-language vocabulary', mixedLanguageHint:'On: preserve English and German words. Off: use only the selected text language.', mode:'Mode', conservative:'Conservative', normal:'Normal', correct:'Correct', undo:'Undo', hint:'Select text or focus an editable field, then correct. Review changes before sending.', ready:'Ready. Works offline.', busy:'Working locally…', undone:'Last correction undone.', changed:(n,s)=>`${n} replacement(s). ${s} token(s) left unchanged by protection or uncertainty gates.`, error:'Could not complete: '},
  de: {ui:'Oberfläche', language:'Textsprache', mixedLanguage:'Mehrsprachiger Wortschatz', mixedLanguageHint:'Aktiv: englische und deutsche Wörter erhalten. Inaktiv: nur die gewählte Textsprache verwenden.', mode:'Modus', conservative:'Vorsichtig', normal:'Normal', correct:'Korrigieren', undo:'Rückgängig', hint:'Text auswählen oder ein Textfeld fokussieren. Änderungen vor dem Senden prüfen.', ready:'Bereit. Funktioniert offline.', busy:'Lokale Verarbeitung…', undone:'Letzte Korrektur rückgängig gemacht.', changed:(n,s)=>`${n} Ersetzung(en). ${s} Wort(e) durch Schutz- oder Unsicherheitsregeln unverändert.`, error:'Nicht abgeschlossen: '}
};
const settingKeys = ['ui', 'language', 'mode', 'mixedLanguage'];
const saved = await api.storage.local.get(settingKeys);
// Only older string settings have a localStorage migration. The vocabulary
// option uses a typed storage value so false is retained and invalid data is safe.
const migrated = normalizeSettings({...saved, ...Object.fromEntries(['ui','language','mode'].map(key => [key, saved[key] ?? localStorage.getItem(key)]))});
for (const key of ['ui','language','mode']) $(key).value = migrated[key];
$('mixedLanguage').checked = migrated.mixedLanguage;
let settingsWrite = api.storage.local.set(migrated);
function translate() {
  const m = messages[$('ui').value]; document.documentElement.lang=$('ui').value;
  $('uiLabel').textContent=m.ui; $('languageLabel').textContent=m.language; $('modeLabel').textContent=m.mode;
  $('mixedLanguageLabel').textContent=m.mixedLanguage; $('mixedLanguageHint').textContent=m.mixedLanguageHint;
  $('mode').options[0].textContent=m.conservative; $('mode').options[1].textContent=m.normal;
  $('correct').textContent=m.correct; $('undo').textContent=m.undo; $('hint').textContent=m.hint; $('status').textContent=m.ready;
}
for (const key of settingKeys) $(key).addEventListener('change',()=>{
  const next = {...Object.fromEntries(['ui','language','mode'].map(name => [name, $(name).value])), mixedLanguage: $('mixedLanguage').checked};
  settingsWrite = settingsWrite.then(() => api.storage.local.set(next));
  if(key==='ui')translate();
});
translate();
async function run(action) {
  const m = messages[$('ui').value]; $('correct').disabled=$('undo').disabled=true; $('status').textContent=m.busy;
  try {
    await settingsWrite;
    const response = await api.runtime.sendMessage({type: 'localcorrect-run', action});
    if (!response?.ok) throw new Error(response?.error || 'No result from the background action.');
    const result = response.result;
    $('status').textContent=result.undone ? m.undone : m.changed(result.changed,result.skipped);
  } catch(error) { $('status').textContent=m.error+(error?.message || 'This page is unsupported.'); }
  finally { $('correct').disabled=$('undo').disabled=false; }
}
$('correct').addEventListener('click',()=>run('correct'));
$('undo').addEventListener('click',()=>run('undo'));
$('shortcut-settings').onclick = () => api.runtime.openOptionsPage();
await settingsWrite;
const bindings = await api.commands.getAll();
const shortcut = bindings.find(command => command.name === 'correct-text')?.shortcut;
$('shortcut-hint').textContent = shortcut ? `${shortcut}: correct the focused field without opening this popup.` : 'Assign a keyboard shortcut in shortcut settings.';
const lastTitle = await api.action.getTitle({});
if (lastTitle?.startsWith('LocalCorrect:')) $('status').textContent = lastTitle;
for (const id of [...settingKeys, 'correct', 'undo']) $(id).disabled = false;

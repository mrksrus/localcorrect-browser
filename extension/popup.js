const api = globalThis.browser || globalThis.chrome;
const $ = id => document.getElementById(id);
const messages = {
  en: {ui:'Interface', language:'Text language', mode:'Mode', conservative:'Conservative', normal:'Normal', correct:'Correct', undo:'Undo', hint:'Select text or focus an editable field, then correct. Review changes before sending.', ready:'Ready. Works offline.', busy:'Working locally…', undone:'Last correction undone.', changed:(n,s)=>`${n} replacement(s). ${s} token(s) left unchanged by protection or uncertainty gates.`, error:'Could not complete: '},
  de: {ui:'Oberfläche', language:'Textsprache', mode:'Modus', conservative:'Vorsichtig', normal:'Normal', correct:'Korrigieren', undo:'Rückgängig', hint:'Text auswählen oder ein Textfeld fokussieren. Änderungen vor dem Senden prüfen.', ready:'Bereit. Funktioniert offline.', busy:'Lokale Verarbeitung…', undone:'Letzte Korrektur rückgängig gemacht.', changed:(n,s)=>`${n} Ersetzung(en). ${s} Wort(e) durch Schutz- oder Unsicherheitsregeln unverändert.`, error:'Nicht abgeschlossen: '}
};
for (const key of ['ui','language','mode']) { const saved = localStorage.getItem(key); if (saved && [...$(key).options].some(o=>o.value===saved)) $(key).value = saved; }
function translate() {
  const m = messages[$('ui').value]; document.documentElement.lang=$('ui').value;
  $('uiLabel').textContent=m.ui; $('languageLabel').textContent=m.language; $('modeLabel').textContent=m.mode;
  $('mode').options[0].textContent=m.conservative; $('mode').options[1].textContent=m.normal;
  $('correct').textContent=m.correct; $('undo').textContent=m.undo; $('hint').textContent=m.hint; $('status').textContent=m.ready;
}
for (const key of ['ui','language','mode']) $(key).addEventListener('change',()=>{localStorage.setItem(key,$(key).value);if(key==='ui')translate();});
translate();
let dictionaries;
async function run(action) {
  const m = messages[$('ui').value]; $('correct').disabled=$('undo').disabled=true; $('status').textContent=m.busy;
  try {
    const [tab] = await api.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !/^https?:|^file:/.test(tab.url || '')) throw new Error('Open a normal web page. Browser-internal pages and extension stores are restricted.');
    if (action==='correct' && !dictionaries) {
      const texts=await Promise.all(['en','de'].map(async lang=>{const r=await fetch(api.runtime.getURL(`dictionaries/${lang}.txt`));if(!r.ok)throw new Error('Bundled dictionary unavailable.');return r.text();}));
      dictionaries={en:texts[0],de:texts[1]};
    }
    await api.scripting.executeScript({target:{tabId:tab.id},files:['target.js']});
    const results=await api.scripting.executeScript({target:{tabId:tab.id},func:(dict,opts)=>globalThis.__localCorrect.run(dict,opts),args:[dictionaries || null,{action,language:$('language').value,mode:$('mode').value}]});
    const result=results[0]?.result;
    if(!result)throw new Error('No result from the page.');
    $('status').textContent=result.undone ? m.undone : m.changed(result.changed,result.skipped);
  } catch(error) { $('status').textContent=m.error+(error?.message || 'This page is unsupported.'); }
  finally { $('correct').disabled=$('undo').disabled=false; }
}
$('correct').addEventListener('click',()=>run('correct'));
$('undo').addEventListener('click',()=>run('undo'));

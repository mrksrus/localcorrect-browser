import {chromium} from 'playwright';
import {existsSync,readFileSync,writeFileSync,mkdirSync,cpSync,rmSync} from 'node:fs';
import assert from 'node:assert/strict';
const executable=existsSync('/usr/bin/chromium')?'/usr/bin/chromium':chromium.executablePath();
const shipping=JSON.parse(readFileSync('build/chrome/manifest.json','utf8'));
assert.deepEqual(shipping.permissions,['activeTab','scripting','storage']);assert.equal(shipping.host_permissions,undefined);assert.equal(shipping.content_scripts,undefined);
async function launch(path,profile){
 rmSync(profile,{recursive:true,force:true});
 const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:executable,args:['--no-sandbox',`--disable-extensions-except=${path}`,`--load-extension=${path}`]});
 const introspection=await context.newPage();await introspection.goto('chrome://extensions-internals');
 const extensions=JSON.parse(await introspection.locator('body').innerText());const local=extensions.find(e=>e.name==='LocalCorrect');assert.ok(local,'Unpacked extension must load');assert.equal(local.registry_status,'ENABLED');
 return {context,id:local.id};
}
const results=[];
{
 const {context,id}=await launch(process.cwd()+'/build/chrome','test-results/shipping-profile');
 try{
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForFunction(()=>!document.querySelector('#correct').disabled);
  assert.equal(await popup.title(),'LocalCorrect');assert.equal(await popup.locator('#correct').textContent(),'Correct');
  assert.equal(await popup.locator('#mixedLanguage').isChecked(),true,'older settings preserve bilingual vocabulary');
  await popup.locator('#mixedLanguage').uncheck();
  await popup.locator('#ui').selectOption('de');assert.equal(await popup.locator('#correct').textContent(),'Korrigieren');assert.equal(await popup.locator('html').getAttribute('lang'),'de');
  assert.equal(await popup.locator('#language').inputValue(),'en','interface language does not change text language');
  assert.equal(await popup.locator('#mixedLanguageLabel').textContent(),'Mehrsprachiger Wortschatz');
  assert.match(await popup.locator('#mixedLanguageHint').textContent(),/nur die gewählte Textsprache/);
  await popup.waitForFunction(async()=>{const s=await chrome.storage.local.get(['ui','mixedLanguage']);return s.ui==='de'&&s.mixedLanguage===false;});
  await popup.reload();await popup.waitForFunction(()=>!document.querySelector('#correct').disabled);
  assert.equal(await popup.locator('#mixedLanguage').isChecked(),false,'false survives popup reload');
  assert.equal(await popup.locator('#language').inputValue(),'en');assert.equal(await popup.locator('#ui').inputValue(),'de');
  await popup.evaluate(()=>chrome.storage.local.set({mixedLanguage:'false'}));
  await popup.reload();await popup.waitForFunction(()=>!document.querySelector('#correct').disabled);
  assert.equal(await popup.locator('#mixedLanguage').isChecked(),true,'invalid stored strings fail safe to bilingual');
  assert.equal(await popup.evaluate(async()=>(await chrome.storage.local.get('mixedLanguage')).mixedLanguage),true);
  assert.ok(await popup.evaluate(async()=>{const r=await fetch(chrome.runtime.getURL('dictionaries/de.txt'));return r.ok&&(await r.text()).includes('hallo ');}));
  await popup.locator('#correct').click();await popup.waitForFunction(()=>document.querySelector('#correct').disabled===false);assert.match(await popup.locator('#status').textContent(),/Nicht abgeschlossen/);
  results.push('Shipping extension loads; bundled dictionary accessible; independent EN/DE UI and text language; vocabulary defaults, normalization and reload; restricted-page error');
  const delayed=await context.newPage();
  await delayed.addInitScript(()=>{
   const save=chrome.storage.local.set.bind(chrome.storage.local),send=chrome.runtime.sendMessage.bind(chrome.runtime);
   window.__settingWrites=[];window.__runSettings=[];
   chrome.storage.local.set=values=>new Promise((resolve,reject)=>{
    window.__settingWrites.push({values,release:()=>save(values).then(resolve,reject)});
   });
   chrome.runtime.sendMessage=async message=>{
    window.__runSettings.push(await chrome.storage.local.get(['ui','language','mode','mixedLanguage']));return send(message);
   };
  });
  await delayed.goto(`chrome-extension://${id}/popup.html`);
  await delayed.waitForFunction(()=>window.__settingWrites?.length===1);
  assert.equal(await delayed.locator('#correct').isDisabled(),true,'correction waits for initial settings persistence');
  assert.equal(await delayed.locator('#mixedLanguage').isDisabled(),true);
  await delayed.evaluate(()=>window.__settingWrites[0].release());
  await delayed.waitForFunction(()=>!document.querySelector('#correct').disabled);
  await delayed.locator('#mixedLanguage').uncheck();
  await delayed.waitForFunction(()=>window.__settingWrites.length===2);
  await delayed.locator('#language').selectOption('de');await delayed.locator('#mode').selectOption('balanced');await delayed.locator('#ui').selectOption('en');
  assert.equal(await delayed.evaluate(()=>window.__settingWrites.length),2,'later saves wait for the pending save');
  await delayed.locator('#correct').click();
  assert.equal(await delayed.evaluate(()=>window.__runSettings.length),0,'correction waits for every queued setting');
  for(let index=1;index<5;index++){
   await delayed.waitForFunction(n=>window.__settingWrites.length>n,index);
   await delayed.evaluate(n=>window.__settingWrites[n].release(),index);
  }
  await delayed.waitForFunction(()=>window.__runSettings.length===1&&!document.querySelector('#correct').disabled);
  assert.deepEqual(await delayed.evaluate(()=>window.__runSettings[0]),{ui:'en',language:'de',mode:'balanced',mixedLanguage:false});
  results.push('Real popup keeps actions disabled during initial save, serializes rapid setting changes and waits for saved false before correction');
 }finally{await context.close();}
}
// Test-only host grant replaces a toolbar activeTab gesture in headless Chromium.
// This modified manifest is NEVER packaged. No remote site is fetched.
rmSync('test-results/extension-harness',{recursive:true,force:true});
cpSync('build/chrome','test-results/extension-harness',{recursive:true});
const harness={...shipping,host_permissions:['http://fixture.test/*']};
writeFileSync('test-results/extension-harness/manifest.json',JSON.stringify(harness));
{
 const {context,id}=await launch(process.cwd()+'/test-results/extension-harness','test-results/harness-profile');
 try{
  const unexpected=[];
  await context.route('**/*',route=>{
   const u=route.request().url();
   if(u.startsWith('http://fixture.test/'))return route.fulfill({contentType:'text/html',body:'<!doctype html><textarea id="t">tomorow seperate</textarea>'});
   if(u.startsWith('chrome-extension:')||u.startsWith('chrome:'))return route.continue();
   unexpected.push(u);return route.abort();
  });
  const fixture=await context.newPage();await fixture.goto('http://fixture.test/');await fixture.locator('#t').focus();
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
  const tabId=await popup.evaluate(async()=>{const tabs=await chrome.tabs.query({});return tabs.find(t=>t.url==='http://fixture.test/').id;});
  await popup.evaluate(id=>chrome.tabs.update(id,{active:true}),tabId);
  await popup.locator('#mode').selectOption('balanced');await popup.locator('#correct').click();
  await popup.waitForFunction(()=>!document.querySelector('#correct').disabled,{timeout:20000});
  assert.equal(await fixture.locator('#t').inputValue(),'tomorrow separate',await popup.locator('#status').textContent());assert.match(await popup.locator('#status').textContent(),/^2 replacement/);
  await popup.locator('#undo').click();await popup.waitForFunction(()=>!document.querySelector('#undo').disabled);assert.equal(await fixture.locator('#t').inputValue(),'tomorow seperate');
  for(const [language,input,expected] of [
   ['en','Please unterstand the instructions.','Please understand the instructions.'],
   ['de','halloo zusammen','hallo zusammen']
  ]){
   await popup.locator('#language').selectOption(language);await popup.locator('#mixedLanguage').check();
   await fixture.evaluate(text=>{const t=document.getElementById('t');t.value=text;t.focus();t.setSelectionRange(0,0);},input);
   await popup.locator('#correct').click();await popup.waitForFunction(()=>!document.getElementById('correct').disabled,{timeout:20000});
   assert.equal(await fixture.locator('#t').inputValue(),input,`${language} mixed vocabulary preserves the other language`);
   await popup.locator('#mixedLanguage').uncheck();await popup.locator('#correct').click();
   await popup.waitForFunction(()=>!document.getElementById('correct').disabled,{timeout:20000});
   assert.equal(await fixture.locator('#t').inputValue(),expected,`${language} selected vocabulary applies through the actual popup`);
   await popup.locator('#undo').click();await popup.waitForFunction(()=>!document.getElementById('undo').disabled);
   assert.equal(await fixture.locator('#t').inputValue(),input);
  }
  assert.deepEqual(unexpected,[]);
  results.push('Actual popup → scripting → isolated adapter → core → DOM → Undo, including selected-only versus mixed vocabulary in EN/DE; synthetic host grant; zero unexpected network requests');
 }finally{await context.close();}
}
mkdirSync('test-results',{recursive:true});writeFileSync('test-results/extension.json',JSON.stringify({passed:true,checks:results,limitation:'Headless test host grant substitutes for an actual browser-toolbar activeTab user gesture. Shipping packages have no host_permissions.'},null,2)+'\n');
for(const result of results)console.log('PASS',result);

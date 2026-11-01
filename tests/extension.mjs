import {chromium} from 'playwright';
import {existsSync,readFileSync,writeFileSync,mkdirSync,cpSync,rmSync} from 'node:fs';
import assert from 'node:assert/strict';
const executable=existsSync('/usr/bin/chromium')?'/usr/bin/chromium':chromium.executablePath();
const shipping=JSON.parse(readFileSync('build/chrome/manifest.json','utf8'));
assert.deepEqual(shipping.permissions,['activeTab','scripting']);assert.equal(shipping.host_permissions,undefined);assert.equal(shipping.content_scripts,undefined);
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
  assert.equal(await popup.title(),'LocalCorrect');assert.equal(await popup.locator('#correct').textContent(),'Correct');
  await popup.locator('#ui').selectOption('de');assert.equal(await popup.locator('#correct').textContent(),'Korrigieren');assert.equal(await popup.locator('html').getAttribute('lang'),'de');
  assert.ok(await popup.evaluate(async()=>{const r=await fetch(chrome.runtime.getURL('dictionaries/de.txt'));return r.ok&&(await r.text()).includes('hallo ');}));
  await popup.locator('#correct').click();await popup.waitForFunction(()=>document.querySelector('#correct').disabled===false);assert.match(await popup.locator('#status').textContent(),/Nicht abgeschlossen/);
  results.push('Shipping extension loads; bundled dictionary accessible; EN/DE UI; restricted-page error');
 }finally{await context.close();}
}
// Test-only host grant replaces a toolbar activeTab gesture in headless Chromium.
// This modified manifest is NEVER packaged. No remote site is fetched.
cpSync('build/chrome','test-results/extension-harness',{recursive:true});
const harness={...shipping,host_permissions:['http://fixture.test/*']};
writeFileSync('test-results/extension-harness/manifest.json',JSON.stringify(harness));
{
 const {context,id}=await launch(process.cwd()+'/test-results/extension-harness','test-results/harness-profile');
 try{
  const unexpected=[];
  await context.route('**/*',route=>{
   const u=route.request().url();
   if(u.startsWith('http://fixture.test/'))return route.fulfill({contentType:'text/html',body:'<!doctype html><textarea id="t">recieve seperate</textarea>'});
   if(u.startsWith('chrome-extension:')||u.startsWith('chrome:'))return route.continue();
   unexpected.push(u);return route.abort();
  });
  const fixture=await context.newPage();await fixture.goto('http://fixture.test/');await fixture.locator('#t').focus();
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
  const tabId=await popup.evaluate(async()=>{const tabs=await chrome.tabs.query({});return tabs.find(t=>t.url==='http://fixture.test/').id;});
  await popup.evaluate(id=>chrome.tabs.update(id,{active:true}),tabId);
  await popup.locator('#mode').selectOption('balanced');await popup.locator('#correct').click();
  await popup.waitForFunction(()=>!document.querySelector('#correct').disabled,{timeout:20000});
  assert.equal(await fixture.locator('#t').inputValue(),'receive separate',await popup.locator('#status').textContent());assert.match(await popup.locator('#status').textContent(),/^2 replacement/);
  await popup.locator('#undo').click();await popup.waitForFunction(()=>!document.querySelector('#undo').disabled);assert.equal(await fixture.locator('#t').inputValue(),'recieve seperate');
  assert.deepEqual(unexpected,[]);
  results.push('Actual popup → scripting → isolated adapter → core → DOM → Undo, synthetic host grant; zero unexpected network requests');
 }finally{await context.close();}
}
mkdirSync('test-results',{recursive:true});writeFileSync('test-results/extension.json',JSON.stringify({passed:true,checks:results,limitation:'Headless test host grant substitutes for an actual browser-toolbar activeTab user gesture. Shipping packages have no host_permissions.'},null,2)+'\n');
for(const result of results)console.log('PASS',result);

import {chromium} from 'playwright';
import {build} from 'esbuild';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
await build({entryPoints:['extension/target.js'],outfile:'test-results/target-test.js',bundle:true,format:'iife'});
const script=readFileSync('test-results/target-test.js','utf8');
const dictionaries=Object.fromEntries(['en','de'].map(l=>[l,readFileSync(`packages/core/dictionaries/${l}.txt`,'utf8')]));
const browser=await chromium.launch({headless:true,...(existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox']});
const page=await browser.newPage();
const results=[];
let installed=false;
async function fixture(html){await page.setContent(html);if(!installed){await page.addScriptTag({content:script});installed=true;}}
async function correct(language='en',mode='balanced'){return page.evaluate(({d,language,mode})=>globalThis.__localCorrect.run(d,{action:'correct',language,mode}),{d:dictionaries,language,mode});}
async function undo(){return page.evaluate(()=>globalThis.__localCorrect.run(null,{action:'undo'}));}
async function check(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(error){results.push({name,passed:false,error:error.message});throw error;}}
try {
await check('textarea focused field, selection, input event, valid undo',async()=>{
 await fixture('<textarea id="t">recieve\tseperate</textarea>');await page.locator('#t').focus();
 await page.evaluate(()=>{window.events=[];document.querySelector('#t').addEventListener('input',e=>events.push(e.inputType));});
 assert.equal((await correct()).changed,2);assert.equal(await page.locator('#t').inputValue(),'receive\tseparate');await undo();assert.equal(await page.locator('#t').inputValue(),'recieve\tseperate');assert.deepEqual(await page.evaluate(()=>events),['insertReplacementText','historyUndo']);
 await page.evaluate(()=>document.querySelector('#t').setSelectionRange(0,7));assert.equal((await correct()).changed,1);assert.equal(await page.locator('#t').inputValue(),'receive\tseperate');
});
await check('allowed text/search inputs and excluded input types',async()=>{
 for(const type of ['text','search']){await fixture(`<input id="t" type="${type}" value="recieve">`);await page.locator('#t').focus();assert.equal((await correct()).changed,1);assert.equal(await page.locator('#t').inputValue(),'receive');}
 for(const type of ['password','email','url','tel','number','date']){await fixture(`<input id="t" type="${type}" value="${type==='number'?'123':type==='date'?'2026-01-01':'recieve'}">`);await page.locator('#t').focus();const before=await page.locator('#t').inputValue();await assert.rejects(correct(),/supported|Only text/);assert.equal(await page.locator('#t').inputValue(),before);}
});
await check('disabled and readonly fields are not mutated',async()=>{
 for(const attr of ['readonly','disabled']){await fixture(`<textarea id="t" ${attr}>recieve</textarea>`);await page.locator('#t').evaluate(e=>e.focus());await assert.rejects(correct(),/read-only|Focus/);assert.equal(await page.locator('#t').inputValue(),'recieve');}
});
await check('stale textarea undo refuses subsequent edits',async()=>{
 await fixture('<textarea id="t">recieve</textarea>');await page.locator('#t').focus();await correct();await page.locator('#t').fill('new user text');await assert.rejects(undo(),/stale/);assert.equal(await page.locator('#t').inputValue(),'new user text');
});
await check('inline contenteditable and cross-node word preserve element identity',async()=>{
 await fixture('<div id="t" contenteditable="true"><b id="b">recie</b><i>ve</i>  <span>seperate</span></div>');await page.locator('#t').focus();
 await page.evaluate(()=>{window.bold=document.querySelector('#b');window.clicked=0;bold.addEventListener('click',()=>clicked++);});
 assert.equal((await correct()).changed,2);assert.equal(await page.locator('#t').textContent(),'receive  separate');assert.equal(await page.locator('b').textContent(),'recei');assert.equal(await page.locator('i').textContent(),'ve');assert.ok(await page.evaluate(()=>bold===document.querySelector('#b')));await page.locator('#b').click();assert.equal(await page.evaluate(()=>clicked),1);await undo();assert.equal(await page.locator('#t').innerHTML(),'<b id="b">recie</b><i>ve</i>  <span>seperate</span>');
});
await check('contenteditable selection only',async()=>{
 await fixture('<div id="t" contenteditable="true">recieve <b>seperate</b></div>');await page.locator('#t').focus();await page.evaluate(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('b'));const s=getSelection();s.removeAllRanges();s.addRange(r);});assert.equal((await correct()).changed,1);assert.equal(await page.locator('#t').textContent(),'recieve separate');
});
await check('quote/signature/code/link DOM paths remain intact',async()=>{
 await fixture('<div id="t" contenteditable="true"><p>recieve</p><blockquote>seperate</blockquote><div class="gmail_signature">recieve</div><code>recieve</code><a href="https://example.invalid">recieve</a><span contenteditable="false">recieve</span></div>');await page.locator('#t').focus();assert.equal((await correct()).changed,1);assert.equal(await page.locator('blockquote').textContent(),'seperate');assert.equal(await page.locator('.gmail_signature').textContent(),'recieve');assert.equal(await page.locator('code').textContent(),'recieve');assert.equal(await page.locator('a').textContent(),'recieve');
});
await check('plain quote/signature protection applies even to partial selection',async()=>{
 for(const value of ['> recieve','hello\n-- \nrecieve','On Tuesday Alice wrote:\nrecieve']){await fixture('<textarea id="t"></textarea>');await page.locator('#t').fill(value);await page.evaluate(()=>{const t=document.querySelector('#t');t.setSelectionRange(t.value.lastIndexOf('recieve'),t.value.length);});assert.equal((await correct()).changed,0);assert.equal(await page.locator('#t').inputValue(),value);}
});
await check('unsupported rich content explicitly errors without destructive fallback',async()=>{
 for(const html of ['<img src="data:,">','<table><tr><td>text</td></tr></table>','<input value="recieve">']){await fixture(`<div id="t" contenteditable="true">recieve${html}</div>`);await page.locator('#t').focus();const before=await page.locator('#t').innerHTML();await assert.rejects(correct(),/unsupported embedded/);assert.equal(await page.locator('#t').innerHTML(),before);}
});
await check('rich stale undo checks structural changes and user edits',async()=>{
 await fixture('<div id="t" contenteditable="true"><b>recieve</b></div>');await page.locator('#t').focus();await correct();await page.locator('b').evaluate(e=>e.setAttribute('class','user'));await assert.rejects(undo(),/stale/);assert.equal(await page.locator('b').textContent(),'receive');
});
await check('multi-paragraph German correction and protected identifier',async()=>{
 await fixture('<div id="t" contenteditable="true"><p>nachrciht</p><p>besipiel user@example.de AX-1234</p></div>');await page.locator('#t').focus();assert.equal((await correct('de')).changed,2);assert.equal(await page.locator('p').nth(0).textContent(),'nachricht');assert.equal(await page.locator('p').nth(1).textContent(),'beispiel user@example.de AX-1234');assert.equal(await page.locator('p').count(),2);
});
await check('rich partial selection retains quote/signature context outside selection',async()=>{
 for(const html of ['&gt; <b>recieve</b>','<p>hello</p><p>-- </p><b>recieve</b>','<p>On Tuesday Alice wrote:</p><b>recieve</b>']){await fixture(`<div id="t" contenteditable="true">${html}</div>`);await page.locator('#t').focus();await page.evaluate(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('b'));getSelection().removeAllRanges();getSelection().addRange(r);});assert.equal((await correct()).changed,0);assert.equal(await page.locator('b').textContent(),'recieve');}
});
await check('undo refuses field converted to password or readonly',async()=>{
 for(const change of ['password','readonly']){await fixture('<input id="t" value="recieve">');await page.locator('#t').focus();await correct();await page.locator('#t').evaluate((e,change)=>{if(change==='password')e.type='password';else e.readOnly=true;},change);await assert.rejects(undo(),/stale/);assert.equal(await page.locator('#t').inputValue(),'receive');}
});
await check('partial-token selections reject both ends, inline joins and combining marks',async()=>{
 for(const [value,a,b] of [['friendship',0,5],['friendship',1,6],['friendship',1,10],['recieve\u0301',0,7],['recieve\u0301',7,8]]){
  await fixture('<textarea id="t"></textarea>');await page.locator('#t').fill(value);
  await page.evaluate(([a,b])=>document.querySelector('#t').setSelectionRange(a,b),[a,b]);
  await assert.rejects(correct(),/complete words/);assert.equal(await page.locator('#t').inputValue(),value);
 }
 for(const [html,a,b] of [['friendship',0,5],['friendship',1,10],['<b>frien</b><i>dship</i>',0,5],['<b>f</b><i>riendship</i>',1,10],['<b>recieve</b><i>\u0301</i>',0,7]]){
  await fixture(`<div id="t" contenteditable="true">${html}</div>`);await page.locator('#t').focus();
  await page.evaluate(([a,b])=>{const t=document.querySelector('#t'),walk=document.createTreeWalker(t,NodeFilter.SHOW_TEXT),nodes=[];while(walk.nextNode())nodes.push(walk.currentNode);function point(p){for(const n of nodes){if(p<=n.length)return[n,p];p-=n.length;}}const r=document.createRange();r.setStart(...point(a));r.setEnd(...point(b));getSelection().removeAllRanges();getSelection().addRange(r);},[a,b]);
  const before=await page.locator('#t').innerHTML();await assert.rejects(correct(),/complete words/);assert.equal(await page.locator('#t').innerHTML(),before);
 }
});
await check('selection-initial names preserved in plain and rich adapters',async()=>{
 for(const mode of ['balanced','conservative'])for(const name of ['Alyce','Harriett','Conners','Hasting','Wiesner','Meriel'])for(const rich of [false,true]){
  const value=`${name} will send a message.`;
  await fixture(rich?`<div id="t" contenteditable="true">${value}</div>`:`<textarea id="t">${value}</textarea>`);await page.locator('#t').focus();
  await page.evaluate(({rich,name})=>{const t=document.querySelector('#t');if(rich){const r=document.createRange();r.setStart(t.firstChild,0);r.setEnd(t.firstChild,name.length);getSelection().removeAllRanges();getSelection().addRange(r);}else t.setSelectionRange(0,name.length);},{rich,name});
  assert.equal((await correct('en',mode)).changed,0);assert.equal(rich?await page.locator('#t').textContent():await page.locator('#t').inputValue(),value);
 }
});
await check('full sentence German nouns, valid inflections, undo and input events',async()=>{
 for(const rich of [false,true]){
  const value='Vielen Dank für Ihre Nachrihct. Die Bestätigungen werden morgen versendet.';
  await fixture(rich?`<div id="t" contenteditable="true">${value}</div>`:`<textarea id="t">${value}</textarea>`);await page.locator('#t').focus();
  assert.equal((await correct('de')).changed,1);assert.equal(rich?await page.locator('#t').textContent():await page.locator('#t').inputValue(),value.replace('Nachrihct','Nachricht'));await undo();assert.equal(rich?await page.locator('#t').textContent():await page.locator('#t').inputValue(),value);
 }
});
await check('oversized input error leaves original text unchanged',async()=>{
 await fixture('<textarea id="t"></textarea>');const value='recieve '.repeat(3000);await page.locator('#t').fill(value);await assert.rejects(correct(),/20,000/);assert.equal(await page.locator('#t').inputValue(),value);
});
} finally {mkdirSync('test-results',{recursive:true});writeFileSync('test-results/dom.json',JSON.stringify(results,null,2)+'\n');await browser.close();}
console.log(`${results.length} real Chromium DOM scenarios passed.`);

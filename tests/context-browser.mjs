// Synthetic offline integration only. No learner text or quality gold is read.
import{chromium}from'playwright';
import{createServer}from'node:http';
import{spawn,execFileSync}from'node:child_process';
import{readFileSync,writeFileSync,mkdirSync,cpSync,rmSync,existsSync}from'node:fs';
import{resolve}from'node:path';
import assert from'node:assert/strict';
import{createRunner}from'../extension/runner.js';

const output=resolve('test-results/context-browser');mkdirSync(output,{recursive:true});
const checks=[],input='i will send it tomorow.';
// Known development fixture, used only to prove an actual neural-only browser edit.
const neuralCase=JSON.parse(readFileSync('tests/context-calibration/cases.json','utf8')).cases.find(row=>row.id==='context-calibration-en-has-have-error-01');
assert.ok(neuralCase&&neuralCase.input!==neuralCase.expected);
const fixture='<!doctype html><meta charset="utf-8"><textarea id="draft">'+input+'</textarea><textarea id="other">original</textarea><div id="rich" contenteditable="true">i <b>will</b> send it tomorow.</div>';
const server=createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(fixture);});
const proxy=createServer((request,response)=>{
 let destination;try{destination=new URL(request.url);}catch{}
 if(destination?.hostname==='127.0.0.1'&&destination.port===String(server.address().port)){response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(fixture);return;}
 response.writeHead(403);response.end('Internet blocked for offline test');
});
proxy.on('connect',(request,socket)=>{socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');});
await Promise.all([new Promise(done=>server.listen(0,'127.0.0.1',done)),new Promise(done=>proxy.listen(0,'127.0.0.1',done))]);
const url=`http://127.0.0.1:${server.address().port}/`,proxyURL=`http://127.0.0.1:${proxy.address().port}`;
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const instrumentation=`
globalThis.__contextSmoke={requests:[],wasmInstantiations:0,workers:0};
globalThis.fetch=((original)=>function(input,...rest){const url=typeof input==='string'?input:input.url;globalThis.__contextSmoke.requests.push(url);return original.call(this,input,...rest);})(globalThis.fetch);
for(const key of ['instantiate','instantiateStreaming'])if(WebAssembly[key])WebAssembly[key]=((original)=>function(...args){globalThis.__contextSmoke.wasmInstantiations++;return original.apply(WebAssembly,args);})(WebAssembly[key]);
globalThis.Worker=class{constructor(){globalThis.__contextSmoke.workers++;throw new Error('Unexpected worker in single-thread smoke');}};
try{globalThis.SharedArrayBuffer=undefined;}catch{}
(globalThis.browser||globalThis.chrome).runtime.onMessage.addListener((message,sender,reply)=>{if(message?.type==='context-smoke-metrics'&&sender.id===(globalThis.browser||globalThis.chrome).runtime.id){reply({...globalThis.__contextSmoke,sharedArrayBuffer:typeof globalThis.SharedArrayBuffer});}});
`;
function harness(browser){
 const directory=resolve(output,browser+'-harness');rmSync(directory,{recursive:true,force:true});cpSync('build/'+browser,directory,{recursive:true});
 const manifest=JSON.parse(readFileSync(directory+'/manifest.json','utf8'));
 assert.deepEqual(manifest.permissions,['activeTab','scripting','storage']);assert.equal(manifest.host_permissions,undefined);assert.equal(manifest.web_accessible_resources,undefined);
 assert.equal(manifest.content_security_policy.extension_pages,"script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self'");
 // Headless Chromium cannot perform its toolbar activeTab gesture. This one
 // loopback-only grant belongs to the test harness and never the shipping ZIP.
 if(browser==='chrome')manifest.host_permissions=[url+'*'];
 writeFileSync(directory+'/manifest.json',JSON.stringify(manifest));
 writeFileSync(directory+'/background.js',instrumentation+readFileSync(directory+'/background.js','utf8'));
 return directory;
}
function validateMetrics(metrics,scheme){
 assert.equal(metrics.sharedArrayBuffer,'undefined');assert.equal(metrics.workers,0);assert.ok(metrics.wasmInstantiations>0,'The actual WASM backend must initialize');
 assert.ok(metrics.requests.some(value=>value.endsWith('/context-model/context-encoder.onnx')),'The packaged model must load');
 assert.ok(metrics.requests.some(value=>value.endsWith('/runtime/ort-wasm-simd-threaded.wasm')),'The packaged CPU WASM must load');
 assert.ok(metrics.requests.every(value=>value.startsWith(scheme)),JSON.stringify(metrics.requests));
}
async function runnerChecks(){
 const requests=[];let finish,started;
 const gate=new Promise(done=>{finish=done;}),inferenceStarted=new Promise(done=>{started=done;});
 let active={id:7,windowId:2,url};
 const api={tabs:{query:async()=>[active]},windows:{getLastFocused:async()=>({id:2,focused:true})},runtime:{getURL:path=>'self://'+path},storage:{local:{get:async()=>({language:'en',mode:'conservative'})}},scripting:{executeScript:async request=>{
  requests.push(request);
  if(request.files)return[];
  const code=request.func.toString();
  if(code.includes('.capture('))return[{result:19}];
  if(code.includes('.prepare('))return[{result:{operationId:19,text:input}}];
  if(code.includes('.cancel('))return[];
  if(code.includes('.run('))return[{result:{changed:1,skipped:0}}];
  throw new Error('Unexpected test request');
 }}};
 const runner=createRunner(api,async()=>({ok:true,text:async()=>'word 10000'}),async(text,language)=>{assert.equal(text,input);assert.equal(language,'en');started();await gate;return[{tokenIndex:0,logits:Array(9).fill(0)}];});
 const pending=runner.run('correct');await inferenceStarted;
 await assert.rejects(runner.run('correct'),/already running/);
 active={...active,id:8};finish();await assert.rejects(pending,/tab or window changed/);
 assert.equal(requests.filter(r=>r.func?.toString().includes('.run(')).length,0);
 assert.equal(requests.filter(r=>r.func?.toString().includes('.cancel(')).length,1);
 checks.push('Runner refuses a tab switch during asynchronous inference and cancels its captured operation');
}
async function chromeChecks(){
 const directory=harness('chrome'),profile=resolve(output,'chrome-profile');rmSync(profile,{recursive:true,force:true});
 const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:existsSync('/usr/bin/chromium')?'/usr/bin/chromium':chromium.executablePath(),proxy:{server:proxyURL,bypass:'127.0.0.1,localhost'},args:['--no-sandbox',`--disable-extensions-except=${directory}`,`--load-extension=${directory}`]});
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  const page=await context.newPage();await page.goto(url);
  if(!await page.locator('#draft').count())throw new Error('Loopback fixture did not load: '+(await page.content()).slice(0,500));
  await page.locator('#draft').focus();
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForFunction(()=>!document.querySelector('#correct').disabled);
  const tabId=await popup.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,url);
  await popup.evaluate(id=>chrome.tabs.update(id,{active:true}),tabId);
  await popup.evaluate(()=>document.querySelector('#correct').click());
  await popup.waitForFunction(()=>!document.querySelector('#correct').disabled,null,{timeout:60000});
  assert.match(await page.locator('#draft').inputValue(),/^[Ii] will send it tomorrow\.$/,await popup.locator('#status').textContent());
  await popup.evaluate(()=>document.querySelector('#undo').click());await popup.waitForFunction(()=>!document.querySelector('#undo').disabled);assert.equal(await page.locator('#draft').inputValue(),input);
  await page.locator('#draft').fill(neuralCase.input);
  await popup.evaluate(()=>document.querySelector('#correct').click());await popup.waitForFunction(()=>!document.querySelector('#correct').disabled,null,{timeout:60000});
  assert.equal(await page.locator('#draft').inputValue(),neuralCase.expected,'Actual packaged neural-only correction');
  await popup.evaluate(()=>document.querySelector('#undo').click());await popup.waitForFunction(()=>!document.querySelector('#undo').disabled);assert.equal(await page.locator('#draft').inputValue(),neuralCase.input);
  const metrics=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'context-smoke-metrics'}));validateMetrics(metrics,'chrome-extension://'+id+'/');
  checks.push('Chrome actual packaged neural-only have-to-has correction and Undo pass on a declared development fixture');
  // Exact selected rich text and stale capture checks use the same packaged
  // isolated-world target. No inference result may bypass those checks.
  await page.locator('#rich').focus();
  const prepared=await popup.evaluate(async tabId=>{
   const target={tabId};await chrome.scripting.executeScript({target,files:['target.js']});
   return(await chrome.scripting.executeScript({target,func:()=>{const operationId=globalThis.__localCorrect.capture();return globalThis.__localCorrect.prepare({operationId});}}))[0].result;
  },tabId);
  assert.equal(prepared.text,'i will send it tomorow.\n');
  await page.locator('#rich').evaluate(element=>{element.querySelector('b').textContent='new';});
  const rejected=await popup.evaluate(async({tabId,operationId})=>(await chrome.scripting.executeScript({target:{tabId},func:operationId=>{try{globalThis.__localCorrect.run({}, {operationId,action:'correct',language:'en',mode:'conservative',contextScores:[]});return false;}catch(error){return /changed while/.test(error.message);}},args:[operationId]}))[0].result,{tabId,operationId:prepared.operationId});
  assert.equal(rejected,true);assert.equal(await page.locator('#rich b').textContent(),'new');
  checks.push('Chrome MV3 service worker runs actual packaged CPU encoder with no SharedArrayBuffer global, workers or external fetches; popup correction and Undo pass');
  checks.push('Read-only rich preparation matches correction text; edits during inference invalidate the original capture');
  return{metrics,browser:context.browser()?.version()||'Chromium'};
 }finally{await context.close();}
}
async function firefoxChecks(){
 const firefox=process.env.LOCALCORRECT_FIREFOX_BINARY||resolve('../firefox-test/firefox/firefox');
 const driver=process.env.GECKODRIVER_BINARY||resolve('../firefox-test/geckodriver');
 if(!existsSync(firefox)||!existsSync(driver))throw new Error('Trusted Firefox and geckodriver binaries are required for context smoke.');
 const directory=harness('firefox'),archive=resolve(output,'firefox-context.xpi');
 execFileSync('python3',['-c','import pathlib,zipfile,sys\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n for f in p.rglob("*"):\n  if f.is_file():z.write(f,f.relative_to(p))',directory,archive]);
 const socket=createServer();await new Promise(done=>socket.listen(0,'127.0.0.1',done));const port=socket.address().port;await new Promise(done=>socket.close(done));
 const processDriver=spawn(driver,['--host','127.0.0.1','--port',String(port),'--allow-system-access','--log','warn'],{stdio:['ignore','pipe','pipe']});
 let log='';processDriver.stdout.on('data',chunk=>{log+=chunk;});processDriver.stderr.on('data',chunk=>{log+=chunk;});
 let session;
 async function request(method,path,body){
  const response=await fetch(`http://127.0.0.1:${port}`+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();if(!response.ok||result.value?.error)throw new Error(JSON.stringify(result.value));return result.value;
 }
 const call=(method,path,body)=>request(method,'/session/'+session+path,body);
 const script=(code,...args)=>call('POST','/execute/sync',{script:code,args});
 const asyncScript=(code,...args)=>call('POST','/execute/async',{script:code,args});
 async function shortcut(key){
  await call('POST','/moz/context',{context:'chrome'});
  try{await call('POST','/actions',{actions:[{type:'key',id:'context-shortcut',actions:[{type:'keyDown',value:'\ue00a'},{type:'keyDown',value:'\ue008'},{type:'keyDown',value:key},{type:'keyUp',value:key},{type:'keyUp',value:'\ue008'},{type:'keyUp',value:'\ue00a'}]}]});}finally{await call('POST','/moz/context',{context:'content'});}
 }
 async function waitValue(expected){
  const limit=Date.now()+60000;let actual;
  while(Date.now()<limit){actual=await script('return document.getElementById("draft").value');if(typeof expected==='string'?actual===expected:expected.test(actual))return;await sleep(100);}
  throw new Error('Firefox synthetic correction did not complete: '+actual);
 }
 try{
  for(let i=0;i<100;i++){try{await request('GET','/status');break;}catch(error){if(processDriver.exitCode!==null)throw error;await sleep(100);}}
  const uuid=globalThis.crypto.randomUUID();
  const value=await request('POST','/session',{capabilities:{alwaysMatch:{browserName:'firefox','moz:firefoxOptions':{binary:firefox,args:['-headless'],prefs:{'extensions.webextensions.uuids':JSON.stringify({'localcorrect@localcorrect.invalid':uuid}),'network.proxy.type':1,'network.proxy.http':'127.0.0.1','network.proxy.http_port':proxy.address().port,'network.proxy.ssl':'127.0.0.1','network.proxy.ssl_port':proxy.address().port,'network.proxy.no_proxies_on':'localhost,127.0.0.1','toolkit.telemetry.enabled':false,'datareporting.healthreport.uploadEnabled':false,'app.update.auto':false,'browser.shell.checkDefaultBrowser':false}}}}});
  session=value.sessionId;await call('POST','/timeouts',{script:60000,pageLoad:60000,implicit:0});
  await call('POST','/moz/addon/install',{path:archive,temporary:true});
  await call('POST','/url',{url});await script('document.getElementById("draft").focus()');await shortcut('c');await waitValue(/^[Ii] will send it tomorrow\.$/);
  await shortcut('z');await waitValue(input);
  await script('const t=document.getElementById("draft");t.value=arguments[0];t.focus();t.setSelectionRange(t.value.length,t.value.length);',neuralCase.input);
  await shortcut('c');await waitValue(neuralCase.expected);
  await shortcut('z');await waitValue(neuralCase.input);
  checks.push('Firefox real shortcut applies a packaged neural-only have-to-has correction and Undo on a declared development fixture');
  await call('POST','/url',{url:`moz-extension://${uuid}/popup.html`});
  const metrics=await asyncScript('const done=arguments[arguments.length-1];browser.runtime.sendMessage({type:"context-smoke-metrics"}).then(done,error=>done({error:error.message}));');validateMetrics(metrics,'moz-extension://'+uuid+'/');
  checks.push('Firefox background script runs actual packaged CPU encoder with shipping permissions, real browser-UI shortcut activeTab gesture, Internet proxy blocked, no SharedArrayBuffer global or workers; Undo passes');
  return{metrics,browser:value.capabilities.browserVersion};
 }finally{
  if(session)try{await call('DELETE','');}catch{}
  processDriver.kill();writeFileSync(output+'/geckodriver.log',log);
 }
}
let result;
try{
 await runnerChecks();
 const chrome=await chromeChecks(),firefox=await firefoxChecks();
 result={passed:true,checks,chrome,firefox,limitations:['Instrumentation wraps fetch/WASM only in disposable test harnesses, not the shipping build.','Chrome harness adds a loopback host grant instead of a toolbar activeTab gesture. Firefox keeps shipping permissions.','Synthetic fields verify runtime integration and preservation, not correction quality or arbitrary website compatibility.']};
 writeFileSync(output+'/report.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{
 if(!result)writeFileSync(output+'/failure.json',JSON.stringify({checks},null,2)+'\n');
 await Promise.all([new Promise(done=>server.close(done)),new Promise(done=>proxy.close(done))]);
}

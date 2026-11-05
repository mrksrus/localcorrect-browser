import {chromium} from 'playwright';
import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createCorrector} from '../packages/core/src/index.js';
const rows=['dev','holdout'].flatMap(split=>{const data=JSON.parse(readFileSync(`tests/email-corpus/${split}.json`,'utf8'));return Array.isArray(data)?data:data.cases;});
assert.equal(rows.length,200);
const scale=JSON.parse(readFileSync('tests/scale-corpus/dev.json','utf8')).cases;
const used=new Set();
for(const language of ['en','de'])for(const criterion of [r=>r.longEmail,r=>r.kind==='safe',r=>r.kind==='correction'&&!r.longEmail]){
 const chosen=scale.filter(r=>r.language===language&&!used.has(r.id)&&criterion(r)).slice(0,20);
 assert.equal(chosen.length,20);for(const row of chosen){rows.push(row);used.add(row.id);}
}
assert.equal(rows.length,320);
const dictionaries=Object.fromEntries(['en','de'].map(l=>[l,readFileSync(`packages/core/dictionaries/${l}.txt`,'utf8')]));
const reference=createCorrector(dictionaries);
mkdirSync('test-results',{recursive:true});
await build({entryPoints:['extension/target.js'],outfile:'test-results/email-target.js',bundle:true,format:'iife'});
const browser=await chromium.launch({headless:true,...(existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox']});
let count=0,undos=0;
try{
 const page=await browser.newPage();
 await page.setContent('<textarea id="draft"></textarea>');
 await page.addScriptTag({content:readFileSync('test-results/email-target.js','utf8')});
 for(const row of rows)for(const mode of ['conservative','balanced']){
  await page.locator('#draft').fill(row.input);
  await page.locator('#draft').evaluate(e=>e.setSelectionRange(0,0));
  const normalizedInput=row.input.replace(/\r\n?/g,'\n');
  const expected=reference.correct(normalizedInput,{language:row.language,mode});
  const result=await page.evaluate(({d,language,mode})=>{const operationId=globalThis.__localCorrect.capture();return globalThis.__localCorrect.run(d,{action:'correct',language,mode,operationId});},{d:dictionaries,language:row.language,mode});
  assert.equal(await page.locator('#draft').inputValue(),expected.text,`${row.id}/${mode}: adapter parity`);
  assert.equal(result.changed,expected.edits.length);
  if(result.changed){
   await page.evaluate(()=>globalThis.__localCorrect.run(null,{action:'undo'}));
   // Textarea values normalize CRLF to LF, as specified by the HTML control.
   assert.equal(await page.locator('#draft').inputValue(),row.input.replace(/\r\n?/g,'\n'),`${row.id}/${mode}: Undo`);undos++;
  }
  count++;
 }
 const result={passed:true,documents:rows.length,documentModeRuns:count,undoRuns:undos,checks:'Real Chromium focused textarea capture, original spans, entire document correction and exact Undo. Engine quality is scored separately against gold, not replaced by this parity check.',limitations:['Direct adapter injection; shipping Firefox shortcut is tested separately.','HTML textarea CRLF normalization must be accounted for before engine comparison.','Arbitrary production rich editors are not implied.']};
 writeFileSync('test-results/email-dom.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}

import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const arg = (name,fallback) => {const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const split=arg('--split','all'), label=arg('--label','candidate');
const specs={dev:{total:120,perLanguage:60,corrections:45},holdout:{total:80,perLanguage:40,corrections:30},audit:{total:40,perLanguage:20,corrections:15}};
assert.ok([...Object.keys(specs),'all'].includes(split),'Choose dev, holdout, audit or all');
assert.match(label,/^[a-z0-9-]+$/i);
const core=resolve(arg('--core','packages/core'));
const {createCorrector}=await import(pathToFileURL(resolve(core,'src/index.js')).href);
const start=performance.now();
const corrector=createCorrector(Object.fromEntries(['en','de'].map(l=>[l,readFileSync(resolve(core,`dictionaries/${l}.txt`),'utf8')])));
const creationMs=performance.now()-start;
const cases=[],corpusSha256={};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const coreFilesSha256=Object.fromEntries(['package.json','src/index.js','src/lexicons/en.js','src/lexicons/de.js','dictionaries/en.txt','dictionaries/de.txt'].map(file=>[file,hash(readFileSync(resolve(core,file)))]));
for(const part of split==='all'?['dev','holdout']:[split]){
 const bytes=readFileSync(new URL(`./email-corpus/${part}.json`,import.meta.url));corpusSha256[part]=hash(bytes);
 const data=JSON.parse(bytes.toString('utf8'));
 const rows=Array.isArray(data)?data:data.cases;
 assert.equal(rows.length,specs[part].total);
 for(const row of rows){assert.equal(row.split,part);cases.push(row);}
}
const ids=new Set(),inputs=new Set();
const original=new Set(JSON.parse(readFileSync(new URL('./hillclimb.json',import.meta.url),'utf8')).cases.map(r=>r.input));
for(const row of cases){
 assert.ok(!ids.has(row.id),'Duplicate ID');ids.add(row.id);
 assert.ok(!inputs.has(row.input)&&!original.has(row.input),`Repeated input: ${row.id}`);inputs.add(row.input);
 assert.ok(['en','de'].includes(row.language));assert.ok(['correction','safe'].includes(row.kind));assert.ok(['email','paragraphs','short'].includes(row.format));
 assert.equal(typeof row.input,'string');assert.equal(typeof row.expected,'string');assert.ok(row.input.length<=20000);
 assert.ok(Array.isArray(row.edits));assert.equal(row.kind==='safe',row.edits.length===0);
 let rebuilt='',end=0;
 for(const edit of row.edits){
  assert.ok(Number.isInteger(edit.offset)&&Number.isInteger(edit.length)&&edit.offset>=end&&edit.length>0);
  assert.ok(edit.offset+edit.length<=row.input.length);assert.equal(edit.original.length,edit.length);
  assert.equal(row.input.slice(edit.offset,edit.offset+edit.length),edit.original,`${row.id}: UTF16 original`);
  assert.match(edit.replacement,/^\p{L}[\p{L}\p{M}-]*$/u);
  rebuilt+=row.input.slice(end,edit.offset)+edit.replacement;end=edit.offset+edit.length;
 }
 rebuilt+=row.input.slice(end);assert.equal(rebuilt,row.expected,`${row.id}: gold reconstruction`);
 if(row.format!=='short')assert.ok(row.input.replace(/\r\n?/g,'\n').split(/\n[ \t]*\n+/).length>=(row.format==='email'?5:2),`${row.id}: complete email/multiple paragraphs`);
}
for(const part of split==='all'?['dev','holdout']:[split])for(const language of ['en','de']){
 const rows=cases.filter(r=>r.split===part&&r.language===language);assert.equal(rows.length,specs[part].perLanguage);assert.equal(rows.filter(r=>r.kind==='correction').length,specs[part].corrections);
}
if(split==='all')for(const [format,count] of [['email',80],['paragraphs',60],['short',60]])assert.equal(cases.filter(r=>r.format===format).length,count);
if(split==='audit'){
 for(const [format,count] of [['email',20],['paragraphs',12],['short',8]])assert.equal(cases.filter(r=>r.format===format).length,count);
 const prior=new Set(['dev','holdout'].flatMap(part=>{const data=JSON.parse(readFileSync(new URL(`./email-corpus/${part}.json`,import.meta.url),'utf8'));return (Array.isArray(data)?data:data.cases).map(r=>r.input);}));
 for(const row of cases)assert.ok(!prior.has(row.input),'Audit input duplicates the original200');
}
const key=e=>JSON.stringify([e.offset,e.length,e.original,e.replacement]);
const results=[];
for(const row of cases)for(const mode of ['conservative','balanced']){
 const begin=performance.now(), actual=corrector.correct(row.input,{language:row.language,mode});
 const durationMs=performance.now()-begin;
 const wanted=new Set(row.edits.map(key));
 const trueEdits=actual.edits.filter(e=>wanted.has(key(e))).length;
 let rebuilt=row.input,lastEnd=0;
 for(const e of actual.edits){assert.ok(Number.isInteger(e.offset)&&Number.isInteger(e.length)&&e.length>0&&e.offset>=lastEnd&&e.offset+e.length<=row.input.length);assert.equal(e.original.length,e.length);assert.equal(row.input.slice(e.offset,e.offset+e.length),e.original);lastEnd=e.offset+e.length;}
 for(const e of [...actual.edits].reverse())rebuilt=rebuilt.slice(0,e.offset)+e.replacement+rebuilt.slice(e.offset+e.length);
 assert.equal(rebuilt,actual.text,'Actual original spans reconstruct exact output');
 results.push({...row,mode,actual:actual.text,actualEdits:actual.edits,exact:actual.text===row.expected,trueEdits,falseEdits:actual.edits.length-trueEdits,missedEdits:row.edits.length-trueEdits,durationMs});
}
const summary=[];
for(const part of split==='all'?['dev','holdout']:[split])for(const mode of ['conservative','balanced']){
 const rows=results.filter(r=>r.split===part&&r.mode===mode), safe=rows.filter(r=>r.kind==='safe'), corrections=rows.filter(r=>r.kind==='correction');
 const sum=key=>rows.reduce((n,r)=>n+r[key],0),tp=sum('trueEdits'),fp=sum('falseEdits'),fn=sum('missedEdits');
 const sorted=rows.map(r=>r.durationMs).sort((a,b)=>a-b);
 summary.push({split:part,mode,documents:rows.length,exactDocuments:rows.filter(r=>r.exact).length,correctionDocuments:corrections.length,exactCorrectionDocuments:corrections.filter(r=>r.exact).length,safeDocuments:safe.length,preservedSafeDocuments:safe.filter(r=>r.exact).length,trueEdits:tp,falseEdits:fp,missedEdits:fn,editPrecision:tp+fp?tp/(tp+fp):null,editRecall:tp+fn?tp/(tp+fn):null,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1)});
}
const report={label,split,creationMs,provenance:{node:process.version,coreFilesSha256,corpusSha256},counts:{cases:cases.length,formats:Object.fromEntries(['email','paragraphs','short'].map(f=>[f,cases.filter(r=>r.format===f).length]))},summary,results};
mkdirSync('test-results',{recursive:true});writeFileSync(`test-results/email-${label}-${split}.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({label,creationMs,counts:report.counts,summary},null,2));

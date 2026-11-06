import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const file=resolve(arg('--file','tests/scale-corpus/dev.json')),label=arg('--label','candidate');
assert.match(label,/^[a-z0-9-]+$/i);
const mixedLanguage=!process.argv.includes('--single-language');
const hash=b=>createHash('sha256').update(b).digest('hex'),bytes=readFileSync(file),data=JSON.parse(bytes);
// Accept both immutable audit schemas without rewriting either gold file.
const cases=(Array.isArray(data)?data:data.cases).map(row=>({...row,format:['multi-paragraph','multiparagraph'].includes(row.format)?'paragraphs':row.format,edits:row.edits.map(edit=>edit.offset===undefined?{offset:edit.start,length:edit.end-edit.start,original:row.input.slice(edit.start,edit.end),replacement:edit.replacement}:edit)}));
const ids=new Set(),inputs=new Set();
const key=e=>JSON.stringify([e.offset,e.length,e.original,e.replacement]);
for(const row of cases){
 assert.ok(!ids.has(row.id));ids.add(row.id);assert.ok(!inputs.has(row.input),'Duplicate input '+row.id);inputs.add(row.input);
 assert.ok(['en','de'].includes(row.language));assert.ok(['correction','error','safe'].includes(row.kind));assert.ok(['email','paragraphs','short'].includes(row.format));
 assert.ok(row.input.length<=20000&&row.input.length>0);assert.equal(row.kind==='safe',row.edits.length===0);
 let end=0,rebuilt='';
 for(const e of row.edits){assert.ok(Number.isInteger(e.offset)&&Number.isInteger(e.length)&&e.offset>=end&&e.length>=0&&e.offset+e.length<=row.input.length);assert.equal(e.length,e.original.length);assert.equal(row.input.slice(e.offset,e.offset+e.length),e.original);assert.equal(typeof e.replacement,'string');assert.ok(e.length>0||e.replacement.length>0);rebuilt+=row.input.slice(end,e.offset)+e.replacement;end=e.offset+e.length;}
 assert.equal(rebuilt+row.input.slice(end),row.expected,'Gold reconstruction '+row.id);
 if(row.format!=='short')assert.ok(row.input.replace(/\r\n?/g,'\n').split(/\n[ \t]*\n+/).length>=(row.format==='email'?3:2));
}
const core=resolve(arg('--core','packages/core'));
const backend=arg('--backend',process.argv.includes('--core')?'static':'contextual');
assert.ok(['static','contextual'].includes(backend));
if(backend==='contextual')assert.equal(core,resolve('packages/core'),'Context reference uses the current bundled core');
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)]);
const coreSha256=Object.fromEntries(walk(resolve(core,'src')).filter(f=>f.endsWith('.js')).sort().map(f=>[relative(core,f),hash(readFileSync(f))]));
const {createCorrector}=await import(pathToFileURL(resolve(core,'src/index.js')).href);
const dictionaries=Object.fromEntries(['en','de'].map(l=>[l,readFileSync(resolve(core,`dictionaries/${l}.txt`),'utf8')]));
for(const l of ['en','de'])coreSha256[`dictionaries/${l}.txt`]=hash(dictionaries[l]);
const begin=performance.now(),corrector=createCorrector(dictionaries),creationMs=performance.now()-begin;
const results=[];
const reference=backend==='contextual'?await(await import('../scripts/context-reference.mjs')).createContextReference():null;
if(reference)for(const file of ['context-encoder.onnx','context-encoder-metadata.json'])coreSha256['models/'+file]=hash(readFileSync(resolve(core,'models/'+file)));
try{
for(const row of cases){
 const predictionStart=performance.now(),contextScores=reference?await reference.predict(row.input,row.language,{policyOnly:true}):null,predictionMs=performance.now()-predictionStart;
 for(const mode of ['conservative','balanced']){
 const start=performance.now(),actual=corrector.correct(row.input,{language:row.language,mode,mixedLanguage,contextScores}),durationMs=performance.now()-start+predictionMs;
 const wanted=new Set(row.edits.map(key)),trueEdits=actual.edits.filter(e=>wanted.has(key(e))).length;
 let lastEnd=0;for(const e of actual.edits){assert.ok(e.offset>=lastEnd&&e.length>=0&&e.offset+e.length<=row.input.length);assert.equal(row.input.slice(e.offset,e.offset+e.length),e.original);lastEnd=e.offset+e.length;}
 let rebuilt=row.input;for(const e of [...actual.edits].reverse())rebuilt=rebuilt.slice(0,e.offset)+e.replacement+rebuilt.slice(e.offset+e.length);assert.equal(rebuilt,actual.text);
 results.push({id:row.id,language:row.language,kind:row.kind,format:row.format,mode,exact:actual.text===row.expected,trueEdits,falseEdits:actual.edits.length-trueEdits,missedEdits:row.edits.length-trueEdits,actualEdits:actual.edits,durationMs,source:row.source||null});
}
}
}finally{if(reference)await reference.close();}
const summarize=rows=>{const sum=k=>rows.reduce((n,r)=>n+r[k],0),tp=sum('trueEdits'),fp=sum('falseEdits'),fn=sum('missedEdits'),safe=rows.filter(r=>r.kind==='safe'),times=rows.map(r=>r.durationMs).sort((a,b)=>a-b);return {documents:rows.length,exactDocuments:rows.filter(r=>r.exact).length,safeDocuments:safe.length,preservedSafeDocuments:safe.filter(r=>r.exact).length,trueEdits:tp,falseEdits:fp,missedEdits:fn,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,p50Ms:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1)};};
const summary=[];for(const mode of ['conservative','balanced'])for(const language of ['all','en','de'])summary.push({mode,language,...summarize(results.filter(r=>r.mode===mode&&(language==='all'||r.language===language)))});
const report={label,backend,mixedLanguage,file:relative(process.cwd(),file),corpusSha256:hash(bytes),coreSha256,node:process.version,creationMs,summary,results};
mkdirSync('test-results/scale',{recursive:true});const output=`test-results/scale/${label}.json`;writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,corpusSha256:report.corpusSha256,creationMs,summary},null,2));

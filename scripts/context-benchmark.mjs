// Whole Node CPU/WASM reference, using public synthetic emails only.
import{readFileSync,writeFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{performance}from'node:perf_hooks';
import{cpus,totalmem,platform}from'node:os';
import{createContextReference}from'./context-reference.mjs';
import{contextIdentity}from'../packages/core/src/index.js';
const mixedLanguage=!process.argv.includes('--single-language');
const output=process.argv[2];if(!output)throw new Error('Pass report output path');
const bytes=readFileSync('tests/performance-fixtures.json'),fixtures=JSON.parse(bytes);
const cold=performance.now(),reference=await createContextReference(),sessionCreationMs=performance.now()-cold,rows=[];
try{
 for(const row of fixtures){
  const samples=[];
  for(let attempt=0;attempt<4;attempt++){
   const cpu=process.cpuUsage(),start=performance.now(),actual=await reference.correct(row.text,{language:row.language,mixedLanguage}),wallMs=performance.now()-start,used=process.cpuUsage(cpu);
   samples.push({wallMs,cpuMs:(used.user+used.system)/1000,edits:actual.edits.length,rssMiB:process.memoryUsage().rss/1048576});
  }
  rows.push({id:row.id,words:row.words,language:row.language,kind:row.kind,samples});
 }
}finally{await reference.close();}
const result={mixedLanguage,scope:'Whole Node reference, ONNX CPU/WASM single thread plus shared static spelling. Process RSS includes Node, not browser or Outlook. Cold session construction excludes first static-lexicon initialization, which is included in first correction.',hardware:{cpu:cpus()[0].model,logicalCPUs:cpus().length,ramGiB:totalmem()/1073741824,platform:platform()},runtime:process.version,model:contextIdentity(),policySha256:createHash('sha256').update(readFileSync('packages/core/src/context-policy.js')).digest('hex'),fixturesSha256:createHash('sha256').update(bytes).digest('hex'),sessionCreationMs,peakRssMiB:process.resourceUsage().maxRSS/1024,rows};
writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));

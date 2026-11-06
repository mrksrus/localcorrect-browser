import{readFileSync,writeFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{createContextReference}from'./context-reference.mjs';
import{createCorrector,protectedRanges,contextIdentity}from'../packages/core/src/index.js';
import{contextProposals}from'../packages/core/src/context-model.js';
const[metadataPath,inputPath,outputPath]=process.argv.slice(2);
if(!metadataPath||!inputPath||!outputPath)throw new Error('Usage: context-encoder-predict.mjs METADATA INPUT OUTPUT');
const metadataBytes=readFileSync(metadataPath),metadata=JSON.parse(metadataBytes),bytes=readFileSync(inputPath);
if(createHash('sha256').update(metadataBytes).digest('hex')!==contextIdentity().metadataSha256)throw new Error('Prediction metadata differs from the bundled encoder metadata');
let cases;if(inputPath.endsWith('.jsonl'))cases=bytes.toString().trim().split('\n').map(x=>JSON.parse(x));else{const x=JSON.parse(bytes);cases=x.cases||x;}
const runtimeSha256=Object.fromEntries(['context-score.js','context-model.js','context-encode.js','index.js'].map(name=>[name,createHash('sha256').update(readFileSync(new URL('../packages/core/src/'+name,import.meta.url))).digest('hex')]));
const reference=process.env.LOCALCORRECT_CONTEXT_PYTHON?await(await import('./context-native-reference.mjs')).createNativeContextReference({python:process.env.LOCALCORRECT_CONTEXT_PYTHON}):await createContextReference();
const corrector=createCorrector(Object.fromEntries(['en','de'].map(l=>[l,readFileSync(new URL(`../packages/core/dictionaries/${l}.txt`,import.meta.url),'utf8')]))),rows=[];
try{
 const started=Date.now();
 for(const row of cases){
  const baseline=corrector.correct(row.input,{language:row.language,contextual:false}),scores=await reference.predict(row.input,row.language);
  const proposals=contextProposals(metadata,row.input,row.language,protectedRanges(row.input),baseline.edits,scores);
  rows.push({id:row.id,language:row.language,document_id:row.document_id||row.id,source:row.source||null,input:row.input,expected:row.expected,kind:row.kind||null,edits:row.edits||null,baseline,proposals});
  if(cases.length>=1000&&rows.length%500===0)console.log(JSON.stringify({completed:rows.length,total:cases.length,elapsedSeconds:(Date.now()-started)/1000}));
 }
}finally{await reference.close();}

for(const [name,expected]of Object.entries(runtimeSha256))if(createHash('sha256').update(readFileSync(new URL('../packages/core/src/'+name,import.meta.url))).digest('hex')!==expected)throw new Error('Functional source changed during scoring: '+name);
const output={schemaVersion:1,backend:reference.backend||'onnxruntime-web1.31.1 CPU/WASM one thread',modelSha256:createHash('sha256').update(metadataBytes).digest('hex'),onnxSha256:metadata.modelSha256,inputSha256:createHash('sha256').update(bytes).digest('hex'),runtimeSha256,rows};
writeFileSync(outputPath,JSON.stringify(output));
console.log(JSON.stringify({documents:rows.length,proposals:rows.reduce((sum,row)=>sum+row.proposals.length,0),output:outputPath,rssMiB:process.memoryUsage().rss/1024/1024}));

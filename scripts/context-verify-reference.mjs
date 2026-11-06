// Verify saved CPU decisions against the actual shipping WASM path. Never log text.
import{readFileSync,writeFileSync}from'node:fs';
import{createHash}from'node:crypto';
import assert from'node:assert/strict';
import{basename}from'node:path';
import{createContextReference}from'./context-reference.mjs';
import{contextIdentity}from'../packages/core/src/index.js';
import policy from'../packages/core/src/context-policy.js';
const[input,output]=process.argv.slice(2);if(!input||!output)throw new Error('Pass scores JSON and report path');
const bytes=readFileSync(input),data=JSON.parse(bytes),identity=contextIdentity();
assert.equal(data.modelSha256,identity.metadataSha256);assert.equal(data.onnxSha256,identity.modelSha256);
const reference=await createContextReference();let documents=0,neuralEdits=0;
try{
 for(const row of data.rows){
  const additions=row.proposals.filter(p=>{const t=policy.actions[String(p.actionId)];return t&&p.trainCount>=t.minTrainCount&&p.margin>=t.minMargin&&p.gap>=t.minGap&&p.probability>=t.minProbability;});
  const edits=[...row.baseline.edits,...additions.map(({offset,length,original,replacement})=>({offset,length,original,replacement}))].sort((a,b)=>a.offset-b.offset);
  let text=row.input;for(const edit of [...edits].reverse())text=text.slice(0,edit.offset)+edit.replacement+text.slice(edit.offset+edit.length);
  const actual=await reference.correct(row.input,{language:row.language,mode:'conservative'});
  assert.deepEqual(actual.edits,edits,'Cross-runtime edit mismatch at '+row.id);assert.equal(actual.text,text,'Cross-runtime text mismatch at '+row.id);
  documents++;neuralEdits+=additions.length;
  if(documents%500===0)console.log(JSON.stringify({completed:documents,total:data.rows.length}));
 }
}finally{await reference.close();}
const sha=b=>createHash('sha256').update(b).digest('hex');
const report={status:'pass',scope:'Exact saved CPU decisions versus shipping single-thread CPU/WASM correction. Numerical/pipeline parity, not independent semantic annotation.',scoreFile:basename(input),scoreSha256:sha(bytes),model:identity,policySha256:sha(readFileSync(new URL('../packages/core/src/context-policy.js',import.meta.url))),documents,neuralEdits};
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));

import test from'node:test';
import assert from'node:assert/strict';
import{contextProposals,acceptedContextEdits}from'../packages/core/src/context-model.js';
import{protectedRanges}from'../packages/core/src/index.js';
import{contextTokens}from'../packages/core/src/context-score.js';
// Forced-positive parameters make these preservation checks independent of
// accidental current learned scores. This is not a quality-training fixture.
const model={format:'localcorrect-context-edit-v1',featureSpec:{radius:3,buckets:8192},actions:[{kind:'KEEP'},{kind:'REPLACE',language:'en',trigger:'their',replacement:'there',trainCount:20}],candidatesByTrigger:{'en|their':[1]},weights:{embedding:Array.from({length:8192},()=>Array(8).fill(0)),hiddenWeight:Array.from({length:64},()=>Array(86).fill(0)),hiddenBias:Array(64).fill(0),outputWeight:[Array(64).fill(0),Array(64).fill(0)],outputBias:[0,20]}};
const proposals=text=>contextProposals(model,text,'en',protectedRanges(text));
test('neural whole-word guard preserves marks, joiners and identifier neighbors',()=>{
 for(const text of['their\u0301','\u0301their','their\u200dname','their\u2060name','𐐀their','their𐐀','_their','their_','2their','their2','$their','their$','%their%','their%'])assert.deepEqual(proposals(text),[],JSON.stringify(text));
 assert.equal(proposals('Please check their decision.').length,1);
});
test('shared literal protection includes variable interpolation',()=>{
 for(const text of['$their am here','${their}','%their%','!their!','$env:their'])assert.deepEqual(proposals(text),[],text);
});
test('full-document ranges preserve selected greeting names and joined identifiers',()=>{
 for(const text of ['Hallo Rehcnung','hallo Rehcnung','HALLO Rehcnung','Sehr geehrter Herr Rehcnung','Wir sagen Hallo Rehcnung','documetn\u200dname','documetn\u203fname']){
  const start=text.indexOf(text.includes('Rehcnung')?'Rehcnung':'documetn');
  assert.ok(protectedRanges(text).some(([a,b])=>a<=start&&b>=start+8),text);
 }
 assert.deepEqual(protectedRanges('hallo gewöhnlicher text'),[]);
});
test('neural edits abstain without a policy and preserve baseline/protected spans',()=>{
 const text='Please check their decision.';
 assert.deepEqual(acceptedContextEdits(model,null,text,'en'),[]);
 const policy={schemaVersion:1,actions:{'1':{minTrainCount:4,minMargin:5.3,minGap:2,minProbability:.995}}};
 assert.equal(acceptedContextEdits(model,policy,text,'en').length,1);
 assert.deepEqual(acceptedContextEdits(model,policy,text,'en',[],[{offset:13,length:5,original:'their',replacement:'test'}]),[]);
 assert.deepEqual(acceptedContextEdits(model,policy,text,'en',[[13,18]]),[]);
});
test('auxiliary grammar candidates remain available outside software literals',()=>{
 const m={...model,actions:[{kind:'KEEP'},{kind:'REPLACE',language:'en',trigger:'has',replacement:'have',trainCount:20}],candidatesByTrigger:{'en|has':[1]}};
 assert.equal(contextProposals(m,'They has an appointment.','en').length,1);
 for(const text of ['$has','%has%','!has!','has.exe','https://has.example'])assert.deepEqual(contextProposals(m,text,'en',protectedRanges(text)),[],text);
});
test('encoder policy must match the exact bundled neural model',()=>{
 const m={...model,format:'localcorrect-context-encoder-v1',modelSha256:'abc',metadataSha256:'meta'};
 const p={schemaVersion:1,modelSha256:'meta',onnxSha256:'other',actions:{'1':{minTrainCount:4,minMargin:5.3,minGap:2,minProbability:.995}}};
 const text='Please check their decision.',scores=[{tokenIndex:2,logits:[0,20]}];
 assert.deepEqual(acceptedContextEdits(m,p,text,'en',[],[],scores),[]);
 assert.equal(acceptedContextEdits(m,{...p,onnxSha256:'abc'},text,'en',[],[],scores).length,1);
 assert.deepEqual(acceptedContextEdits(m,{...p,onnxSha256:'abc',modelSha256:'stale-metadata'},text,'en',[],[],scores),[]);
});
test('inactive proposals cannot hide a later enabled correction in a long document',()=>{
 const m={format:'localcorrect-context-encoder-v1',modelSha256:'onnx',metadataSha256:'metadata',actions:[{kind:'KEEP'},{kind:'REPLACE',language:'en',trigger:'is',replacement:'was',trainCount:10},{kind:'REPLACE',language:'en',trigger:'are',replacement:'were',trainCount:10}],candidatesByTrigger:{'en|is':[1],'en|are':[2]}};
 const p={schemaVersion:1,modelSha256:'metadata',onnxSha256:'onnx',actions:{'2':{minTrainCount:4,minMargin:2,minGap:2,minProbability:.9}}};
 const text='it is blue. '.repeat(257)+'they are red.';
 const scores=contextTokens(text).flatMap((token,tokenIndex)=>['is','are'].includes(token.text)?[{tokenIndex,logits:[0,20]}]:[]);
 const pruned=scores.filter(score=>contextTokens(text)[score.tokenIndex].text==='are');
 assert.equal(contextProposals(m,text,'en',[],[],scores).length,258);
 const full=acceptedContextEdits(m,p,text,'en',[],[],scores);
 assert.equal(full.length,1);assert.equal(full[0].original,'are');
 assert.deepEqual(acceptedContextEdits(m,p,text,'en',[],[],pruned),full);
});

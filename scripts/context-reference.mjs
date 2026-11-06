// Local Node/WASM reference for quality checks and native parity generation.
import * as ort from 'onnxruntime-web/wasm';
import{readFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{createCorrector,encodeContext,contextIdentity}from'../packages/core/src/index.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function createContextReference(){
 const modelBytes=readFileSync(new URL('../packages/core/models/context-encoder.onnx',import.meta.url)),identity=contextIdentity();
 if(modelBytes.length!==identity.modelBytes||hash(modelBytes)!==identity.modelSha256)throw new Error('Bundled contextual model identity mismatch');
 ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
 ort.env.wasm.wasmBinary=readFileSync(new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',import.meta.url));
 const session=await ort.InferenceSession.create(modelBytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
 const corrector=createCorrector(Object.fromEntries(['en','de'].map(language=>[language,readFileSync(new URL(`../packages/core/dictionaries/${language}.txt`,import.meta.url),'utf8')])));
 let pending=Promise.resolve();
 async function predictNow(text,language,options){
  const {chunks}=encodeContext(text,language,options),scores=[];
  for(const chunk of chunks){
   const sequence=chunk.input_ids[0].length,words=chunk.words.length;
   const feeds={
    input_ids:new ort.Tensor('int64',BigInt64Array.from(chunk.input_ids.flat(),BigInt),[1,sequence]),
    attention_mask:new ort.Tensor('int64',BigInt64Array.from(chunk.attention_mask.flat(),BigInt),[1,sequence]),
    word_positions:new ort.Tensor('int64',BigInt64Array.from(chunk.word_positions.flat(),BigInt),[1,words]),
    candidate_ids:new ort.Tensor('int64',BigInt64Array.from(chunk.candidate_ids.flat(2),BigInt),[1,words,9]),
    candidate_mask:new ort.Tensor('float32',Float32Array.from(chunk.candidate_mask.flat(2)),[1,words,9])
   };
   let output;
   try{
    output=await session.run(feeds);const tensor=output.logits;
    if(tensor.dims.join(',')!==`1,${words},9`||[...tensor.data].some(x=>!Number.isFinite(x)))throw new Error('Invalid local context inference');
    for(let i=0;i<words;i++)scores.push({tokenIndex:chunk.words[i].tokenIndex,logits:Array.from(tensor.data.slice(i*9,i*9+9))});
   }finally{for(const tensor of Object.values(feeds))tensor.dispose();if(output)for(const tensor of Object.values(output))tensor.dispose();}
  }
  return scores;
 }
 function predict(text,language,options={}){const result=pending.then(()=>predictNow(text,language,options));pending=result.then(()=>undefined,()=>undefined);return result;}
 return{predict,async correct(text,options={}){const language=options.language||'en';return corrector.correct(text,{...options,contextScores:await predict(text,language,{policyOnly:true})});},async close(){await pending;await session.release();}};
}

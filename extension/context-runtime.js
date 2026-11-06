/* SPDX-License-Identifier: GPL-3.0-only */
import*as ort from'onnxruntime-web/wasm';
import{encodeContext,contextIdentity}from'../packages/core/src/index.js';

/** One local CPU session serves explicit operations in order. Only model state
 * survives a call; text, tokens and inference buffers are operation-local.
 * Optional bytes let offline Node/browser harnesses use the identical adapter.
 */
export function createContextRuntime(api,{fetchResource=globalThis.fetch,modelBytes,wasmBytes}={}){
 let sessionPromise,queue=Promise.resolve();
 const identity=contextIdentity();
 function resource(path){
  const url=api?.runtime?.getURL(path);
  if(typeof url!=='string'||!url)throw new Error('Bundled contextual resource unavailable.');
  return url;
 }
 async function loadSession(){
  if(!sessionPromise)sessionPromise=(async()=>{
   const expected=identity?.modelSha256;
   if(!/^[a-f0-9]{64}$/.test(expected||''))throw new Error('Bundled contextual identity unavailable.');
   let bytes=modelBytes;
   if(!bytes){
    const response=await fetchResource(resource('context-model/context-encoder.onnx'));
    if(!response.ok||response.redirected)throw new Error('Bundled contextual model unavailable.');
    bytes=new Uint8Array(await response.arrayBuffer());
   }
   if(bytes instanceof ArrayBuffer)bytes=new Uint8Array(bytes);
   if(!(bytes instanceof Uint8Array)||!bytes.length||(Number.isInteger(identity.modelBytes)&&bytes.length!==identity.modelBytes))throw new Error('Bundled contextual model size mismatch.');
   const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
   const hash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
   if(hash!==expected)throw new Error('Bundled contextual model integrity mismatch.');
   ort.env.logLevel='error';
   ort.env.wasm.numThreads=1;
   ort.env.wasm.proxy=false;
   // Only override the binary. A prefix string or mjs override disables ORT's
   // embedded JS factory and would call import(), unavailable in Chromium SWs.
   if(wasmBytes){ort.env.wasm.wasmPaths=undefined;ort.env.wasm.wasmBinary=wasmBytes;}
   else ort.env.wasm.wasmPaths={wasm:resource('runtime/ort-wasm-simd-threaded.wasm')};
   return ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  })().catch(error=>{sessionPromise=undefined;throw error;});
  return sessionPromise;
 }
 function tensor(type,values,dimensions){
  const flat=values.flat(3);
  return new ort.Tensor(type,type==='int64'?BigInt64Array.from(flat,BigInt):Float32Array.from(flat),dimensions);
 }
 async function infer(text,language){
  const encoded=encodeContext(text,language,{policyOnly:true}),scores=[];
  if(!encoded.chunks.length)return scores;
  const session=await loadSession();
  for(const chunk of encoded.chunks){
   const count=chunk.words.length;
   const inputs={input_ids:tensor('int64',chunk.input_ids,[1,chunk.input_ids[0].length]),
    attention_mask:tensor('int64',chunk.attention_mask,[1,chunk.attention_mask[0].length]),
    word_positions:tensor('int64',chunk.word_positions,[1,count]),
    candidate_ids:tensor('int64',chunk.candidate_ids,[1,count,9]),
    candidate_mask:tensor('float32',chunk.candidate_mask,[1,count,9])};
   let output;
   try{
    output=await session.run(inputs);
    const logits=output.logits;
    if(!logits||logits.dims.length!==3||logits.dims[0]!==1||logits.dims[1]!==count||logits.dims[2]!==9||logits.data.length!==count*9)throw new Error('Invalid contextual inference shape.');
    for(let i=0;i<count;i++){
     const values=Array.from(logits.data.slice(i*9,(i+1)*9));
     if(values.some(value=>!Number.isFinite(value)))throw new Error('Invalid contextual inference values.');
     scores.push({tokenIndex:chunk.words[i].tokenIndex,logits:values});
    }
   }finally{
    for(const value of Object.values(inputs))value.dispose?.();
    if(output)for(const value of Object.values(output))value.dispose?.();
   }
  }
  return scores;
 }
 function predict(text,language){
  const work=queue.then(()=>infer(text,language));
  // Do not retain the last text, tensors or score array as the queue value.
  queue=work.then(()=>undefined,()=>undefined);
  return work;
 }
 return{predict};
}

// Build-only CPU reference for private calibration. Product runtimes use their
// own bundled adapters; the default Node/WASM reference remains independent.
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {encodeContext,contextIdentity} from '../packages/core/src/index.js';

const MAX_BYTES=10*1024*1024;
const decode=new TextDecoder('utf-8',{fatal:true});
const sameKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');

export async function createNativeContextReference({python='python3',startupTimeoutMs=30000,requestTimeoutMs=30000}={}){
 if(!Number.isInteger(startupTimeoutMs)||startupTimeoutMs<1||!Number.isInteger(requestTimeoutMs)||requestTimeoutMs<1)throw new TypeError('Invalid native reference timeout');
 const model=fileURLToPath(new URL('../packages/core/models/context-encoder.onnx',import.meta.url));
 const bytes=await readFile(model),identity=contextIdentity();
 if(bytes.length!==identity.modelBytes||createHash('sha256').update(bytes).digest('hex')!==identity.modelSha256)throw new Error('Bundled contextual model identity mismatch');
 const child=spawn(python,[fileURLToPath(new URL('./context-native-inference.py',import.meta.url)),'--model',model,'--sha256',identity.modelSha256],{
  stdio:['pipe','pipe','pipe'],windowsHide:true,
  env:{...process.env,ORT_DISABLE_TELEMETRY:'1',ORT_RUNNING_UNIT_TESTS:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONUNBUFFERED:'1',OMP_NUM_THREADS:'2',OPENBLAS_NUM_THREADS:'1',MKL_NUM_THREADS:'1'}
 });
 let buffered=Buffer.alloc(0),waiting=null,failure=null,closed=false,sequence=0,pending=Promise.resolve(),exited=false;
 const killChild=()=>{if(!exited)child.kill('SIGKILL');};
 process.once('exit',killChild);
 const exit=new Promise(resolve=>child.once('close',()=>{exited=true;process.removeListener('exit',killChild);resolve();}));
 function stop(message){
  failure??=new Error(message);
  if(waiting){clearTimeout(waiting.timer);waiting.reject(failure);waiting=null;}
  killChild();
 }
 function response(id,timeout){
  return new Promise((resolve,reject)=>{
   waiting={id,resolve,reject,timer:setTimeout(()=>stop('Native contextual reference timed out'),timeout)};
  });
 }
 const ready=response(0,startupTimeoutMs);
 child.on('error',()=>stop('Native contextual reference could not start'));
 child.stdin.on('error',()=>stop('Native contextual reference input failed'));
 child.stderr.on('data',()=>{}); // Never accumulate exceptions or private text.
 child.stdout.on('data',data=>{
  try{
   buffered=Buffer.concat([buffered,data]);
   let end;
   while((end=buffered.indexOf(10))!==-1){
    if(end+1>MAX_BYTES)throw new Error();
    const value=JSON.parse(decode.decode(buffered.subarray(0,end)));buffered=buffered.subarray(end+1);
    if(!waiting||!sameKeys(value,waiting.id===0?['id','ready']:['id','scores'])||value.id!==waiting.id)throw new Error();
    const receiver=waiting;waiting=null;clearTimeout(receiver.timer);receiver.resolve(value);
   }
   if(buffered.length>MAX_BYTES)throw new Error();
  }catch{stop('Native contextual reference returned an invalid response');}
 });
 child.on('exit',()=>stop('Native contextual reference stopped'));
 async function close(){
  if(!closed){closed=true;stop('Native contextual reference is closed');}
  if(exited)return;
  let timer;
  try{await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Native contextual reference cleanup timed out')),5000);})]);}
  finally{clearTimeout(timer);}
 }
 let backend;
 try{
  backend=(await ready).ready;
  if(!sameKeys(backend,['backend','ortVersion','threads','modelSha256'])||backend.backend!=='onnxruntime-python-cpu'||backend.ortVersion!=='1.31.1'||backend.threads!==2||backend.modelSha256!==identity.modelSha256)throw new Error('Native contextual reference backend mismatch');
  if(failure)throw failure;
 }catch(error){await close();throw error;}
 async function predictNow(text,language,options){
  if(closed||failure)throw failure??new Error('Native contextual reference is closed');
  const {chunks}=encodeContext(text,language,options);
  // Only numeric tensors and original token indices cross the pipe. Word text
  // and document spans are unnecessary for native inference.
  const tensors=chunks.map(chunk=>({...Object.fromEntries(['input_ids','attention_mask','word_positions','candidate_ids','candidate_mask'].map(name=>[name,chunk[name]])),words:chunk.words.map(({tokenIndex})=>({tokenIndex}))}));
  const expected=tensors.flatMap(chunk=>chunk.words.map(word=>word.tokenIndex));
  if(!expected.length)return[];
  const id=++sequence;
  if(!Number.isSafeInteger(id))throw new Error('Native contextual reference request limit reached');
  const frame=Buffer.from(JSON.stringify({id,chunks:tensors})+'\n');
  if(frame.length>MAX_BYTES)throw new RangeError('Native contextual request exceeds its size limit');
  const answer=response(id,requestTimeoutMs);
  child.stdin.write(frame,error=>{if(error)stop('Native contextual reference input failed');});
  const {scores}=await answer;
  if(!Array.isArray(scores)||scores.length!==expected.length||scores.length>3000||scores.some((row,index)=>!sameKeys(row,['tokenIndex','logits'])||row.tokenIndex!==expected[index]||!Array.isArray(row.logits)||row.logits.length!==9||row.logits.some(value=>typeof value!=='number'||!Number.isFinite(value)))){
   stop('Native contextual reference returned invalid scores');throw failure;
  }
  return scores;
 }
 function predict(text,language,options={}){
  const result=pending.then(()=>predictNow(text,language,options));
  pending=result.then(()=>undefined,()=>undefined);return result;
 }
 return{predict,close,backend:Object.freeze({...backend})};
}

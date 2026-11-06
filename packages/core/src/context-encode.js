/* SPDX-License-Identifier: GPL-3.0-only
 * Portable cased WordPiece and original-span tensors for the local encoder.
 * No platform encoding, filesystem, network, BigInt or document cache is used.
 */
import{contextTokens}from'./context-score.js';

const vocabularyIndexes=new WeakMap();
function vocabulary(metadata){
 if(!metadata||metadata.format!=='localcorrect-context-encoder-v1'||!Array.isArray(metadata.vocab)||!Array.isArray(metadata.actions)||!metadata.candidatesByTrigger)throw new TypeError('Invalid contextual encoder metadata.');
 const spec=metadata.tokenizer;
 if(!spec||spec.maximumSequenceLength!==128||spec.candidateWidth!==9||spec.maxWordPieceCharacters!==100||spec.doLowerCase!==false||spec.stripAccents!==false||spec.newlineEndsChunk!==true||JSON.stringify(spec.apostropheSplit)!==JSON.stringify(["'",'’'])||JSON.stringify(spec.sentenceEndingTokens)!==JSON.stringify(['.','!','?']))throw new TypeError('Unsupported contextual tokenizer configuration.');
 let index=vocabularyIndexes.get(metadata);
 if(!index){
  index=new Map();
  for(let i=0;i<metadata.vocab.length;i++){
   const value=metadata.vocab[i];
   if(typeof value!=='string'||index.has(value))throw new TypeError('Invalid contextual vocabulary.');
   index.set(value,i);
  }
  for(const [key,text]of[['padId','[PAD]'],['unkId','[UNK]'],['clsId','[CLS]'],['sepId','[SEP]']])if(!Number.isInteger(spec[key])||index.get(text)!==spec[key])throw new TypeError('Invalid contextual special token.');
  vocabularyIndexes.set(metadata,index);
 }
 return index;
}

function pieces(surface,index,spec){
 const output=[];
 for(const part of surface.match(/[^'’]+|['’]/gu)||[]){
  const characters=Array.from(part);
  if(characters.length>100){output.push(spec.unkId);continue;}
  let start=0,result=[];
  while(start<characters.length){
   let found=-1,next=start;
   for(let end=characters.length;end>start;end--){
    const candidate=(start?'##':'')+characters.slice(start,end).join('');
    if(index.has(candidate)){found=index.get(candidate);next=end;break;}
   }
   if(found<0){result=[spec.unkId];break;}
   result.push(found);start=next;
  }
  output.push(...result);
 }
 return !output.length||output.length>126?[spec.unkId]:output;
}

/** Return IDs for one outer token, splitting its apostrophes before WordPiece. */
export function contextWordPiece(metadata,surface){
 if(typeof surface!=='string')throw new TypeError('WordPiece surface must be a string.');
 return pieces(surface,vocabulary(metadata),metadata.tokenizer);
}

/** Each chunk holds one batch and maps selected tensor rows to original UTF16
 * spans in words. tokenChunks also retains every unfiltered chunk for parity.
 * Arrays contain ordinary Numbers. Runtime adapters choose ONNX int64 storage.
 */
export function encodeContext(metadata,text,language){
 if(typeof text!=='string')throw new TypeError('Contextual input must be a string.');
 if(text.length>20000)throw new RangeError('Text exceeds 20,000 UTF-16 code units.');
 if(!['en','de'].includes(language))throw new RangeError('Contextual language must be en or de.');
 const index=vocabulary(metadata),spec=metadata.tokenizer;
 const tokens=contextTokens(text).map(token=>({...token,pieceIds:pieces(token.text,index,spec)}));
 if(tokens.reduce((count,token)=>count+(token.word?1:0),0)>3000)throw new RangeError('Text exceeds 3,000 word tokens.');
 const tokenChunks=[];
 let ids=[spec.clsId],indices=[],positions=[];
 function flush(){
  if(indices.length)tokenChunks.push({input_ids:ids.concat(spec.sepId),token_indices:indices,first_positions:positions});
  ids=[spec.clsId];indices=[];positions=[];
 }
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i];
  if(ids.length+token.pieceIds.length+1>128)flush();
  indices.push(i);positions.push(ids.length);ids.push(...token.pieceIds);
  const gap=i+1<tokens.length?text.slice(token.end,tokens[i+1].start):'';
  if(['.','!','?'].includes(token.text)||/[\r\n]/u.test(gap))flush();
 }
 flush();
 const chunks=[];
 for(const chunk of tokenChunks){
  const words=[],wordPositions=[],candidateIds=[],candidateMask=[];
  for(let i=0;i<chunk.token_indices.length;i++){
   const tokenIndex=chunk.token_indices[i],token=tokens[tokenIndex];
   const options=metadata.candidatesByTrigger[language+'|'+token.text];
   if(!options||!options.length)continue;
   if(!token.word||!Array.isArray(options)||options.length>8||new Set(options).size!==options.length)throw new TypeError('Invalid contextual candidate list.');
   for(const id of options){
    const action=metadata.actions[id];
    if(!Number.isInteger(id)||id<1||!action||action.kind!=='REPLACE'||action.language!==language||action.trigger!==token.text)throw new TypeError('Invalid contextual action reference.');
   }
   const rows=[0,...options];
   words.push({tokenIndex,start:token.start,end:token.end,text:token.text,candidateRowIds:rows});
   wordPositions.push(chunk.first_positions[i]);
   candidateIds.push(rows.concat(Array(9-rows.length).fill(0)));
   candidateMask.push(Array(rows.length).fill(1).concat(Array(9-rows.length).fill(0)));
  }
  if(words.length)chunks.push({input_ids:[chunk.input_ids],attention_mask:[Array(chunk.input_ids.length).fill(1)],word_positions:[wordPositions],candidate_ids:[candidateIds],candidate_mask:[candidateMask],words});
 }
 return{tokens,tokenChunks,chunks};
}

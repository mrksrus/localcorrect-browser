// Static dictionary state only. Document text and search states remain local to
// each call. This module also runs in Jint, without Buffer, atob or Node globals.
import bundled from './ambiguity-data.js';
import {en as englishAsset,de as germanAsset} from './ambiguity-language-data.js';

const MAGIC=0x3141434c,MAX_BYTES=32*1024*1024;
function invalid(){throw new Error('Invalid bundled ambiguity automaton. No correction performed.');}
function decode(asset){
 if(!asset||asset.format!==1||!Number.isSafeInteger(asset.byteLength)||asset.byteLength<48||asset.byteLength>MAX_BYTES||!Number.isInteger(asset.checksum)||asset.checksum<0||asset.checksum>0xffffffff||typeof asset.data!=='string'||asset.data.length!==Math.ceil(asset.byteLength/3)*4)invalid();
 const source=asset.data,bytes=new Uint8Array(asset.byteLength),table=new Int16Array(128);table.fill(-1);
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';for(let i=0;i<64;i++)table[alphabet.charCodeAt(i)]=i;
 let at=0,hash=2166136261;
 for(let i=0;i<source.length;i+=4){
  const ca=source.charCodeAt(i),cb=source.charCodeAt(i+1),cc=source.charCodeAt(i+2),cd=source.charCodeAt(i+3);
  const a=ca<128?table[ca]:-1,b=cb<128?table[cb]:-1,c=cc===61?0:cc<128?table[cc]:-1,d=cd===61?0:cd<128?table[cd]:-1;
  if(a<0||b<0||c<0||d<0||(cc===61&&(cd!==61||i+4!==source.length||(b&15)!==0))||(cd===61&&(i+4!==source.length||(cc!==61&&(c&3)!==0))))invalid();
  const count=cc===61?1:cd===61?2:3;if(at+count>bytes.length)invalid();
  let value=(a<<2)|(b>>>4);bytes[at++]=value;hash=Math.imul(hash^value,16777619)>>>0;
  if(count>1){value=((b&15)<<4)|(c>>>2);bytes[at++]=value;hash=Math.imul(hash^value,16777619)>>>0;}
  if(count>2){value=((c&3)<<6)|d;bytes[at++]=value;hash=Math.imul(hash^value,16777619)>>>0;}
 }
 if(at!==bytes.length||hash!==asset.checksum)invalid();
 const view=new DataView(bytes.buffer),read=at=>view.getUint32(at,true);
 const nodes=read(8),edges=read(12),symbols=read(16),root=read(20),words=read(24),maxLength=read(28);
 if(read(0)!==MAGIC||read(4)!==1||nodes<2||nodes>2000000||edges<1||edges>5000000||symbols<1||symbols>65535||root!==nodes-1||words<1||maxLength<1||maxLength>255)invalid();
 const metaAt=32,targetAt=metaAt+(nodes+1)*4,labelAt=targetAt+edges*4,rangeAt=labelAt+edges*2,alphabetAt=Math.ceil((rangeAt+nodes*2)/4)*4;
 if(alphabetAt+symbols*4!==bytes.length)invalid();
 const little=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
 const u32=(offset,count)=>{if(little)return new Uint32Array(bytes.buffer,offset,count);const result=new Uint32Array(count);for(let i=0;i<count;i++)result[i]=view.getUint32(offset+i*4,true);return result;};
 const u16=(offset,count)=>{if(little)return new Uint16Array(bytes.buffer,offset,count);const result=new Uint16Array(count);for(let i=0;i<count;i++)result[i]=view.getUint16(offset+i*2,true);return result;};
 const meta=u32(metaAt,nodes+1),targets=u32(targetAt,edges),labels=u16(labelAt,edges),ranges=u16(rangeAt,nodes),letters=u32(alphabetAt,symbols);
 if((meta[0]>>>1)!==0||meta[nodes]!==edges*2)invalid();
 for(let i=0;i<symbols;i++)if(!letters[i]||letters[i]>0x10ffff||(letters[i]>=0xd800&&letters[i]<=0xdfff)||(i&&letters[i]<=letters[i-1]))invalid();
 for(let node=0;node<nodes;node++){
  const start=meta[node]>>>1,end=meta[node+1]>>>1;if(end<start||end>edges)invalid();
  let min=(meta[node]&1)?0:255,max=0,previous=-1;
  for(let edge=start;edge<end;edge++){
   const label=labels[edge],target=targets[edge];if(label>=symbols||label<=previous||target>=node)invalid();previous=label;
   min=Math.min(min,(ranges[target]&255)+1);max=Math.max(max,(ranges[target]>>>8)+1);
  }
  if((start===end&&!(meta[node]&1))||max>maxLength||ranges[node]!==min+(max<<8))invalid();
 }
 if((ranges[root]>>>8)!==maxLength||(meta[root]&1))invalid();
 for(let i=rangeAt+nodes*2;i<alphabetAt;i++)if(bytes[i]!==0)invalid();
 return {meta,targets,labels,ranges,letters,root};
}

/** A factory permits representation/integrity tests without mutating bundled
 * assets. Decoding is lazy and bounded; only immutable dictionary arrays persist. */
export function createAmbiguityLookup(asset){
 let graph;
 function prepare(){if(!graph)graph=decode(asset);}
 function hasAlternative(word,chosen,budget,maxEdits=1){
  if(typeof word!=='string'||typeof chosen!=='string'||word.length>510||chosen.length>510||!budget||!Number.isSafeInteger(budget.remaining)||budget.remaining<0||!(maxEdits===1||maxEdits===2))return null;
  prepare();
  const input=Array.from(word.toLowerCase(),character=>character.codePointAt(0)),selected=Array.from(chosen.toLowerCase(),character=>character.codePointAt(0));
  if(input.length>255||selected.length>255)return null;
  const {meta,targets,labels,ranges,letters,root}=graph,n=input.length;
  function edgeFor(node,symbol){let low=meta[node]>>>1,high=(meta[node+1]>>>1)-1;while(low<=high){const mid=(low+high)>>>1,value=letters[labels[mid]];if(value===symbol)return targets[mid];if(value<symbol)low=mid+1;else high=mid-1;}return -1;}
  function extend(flags,depth,symbol){return flags&((depth<n&&input[depth]===symbol?1:0)|(depth<selected.length&&selected[depth]===symbol?2:0));}
  function search(node,index,left,depth,flags){
   if(--budget.remaining<0)return null;
   const range=ranges[node],remaining=n-index;if((range&255)>remaining+left||(range>>>8)<remaining-left)return false;
   if(left===0){
    // One exact suffix walk replaces a separate membership query per generated
    // spelling. Every visited suffix state still spends the shared CPU budget.
    while(index<n){const symbol=input[index++];node=edgeFor(node,symbol);if(node<0)return false;flags=extend(flags,depth++,symbol);if(--budget.remaining<0)return null;}
    return !!(meta[node]&1)&&!((flags&1)&&depth===n)&&!((flags&2)&&depth===selected.length);
   }
   if(index===n&&(meta[node]&1)&&!((flags&1)&&depth===n)&&!((flags&2)&&depth===selected.length))return true;
   let result;
   if(index<n){
    const target=edgeFor(node,input[index]);if(target>=0){result=search(target,index+1,left,depth+1,extend(flags,depth,input[index]));if(result!==false)return result;}
    result=search(node,index+1,left-1,depth,flags);if(result!==false)return result;
    if(index+1<n&&input[index]!==input[index+1]){
     const middle=edgeFor(node,input[index+1]);
     if(middle>=0){if(--budget.remaining<0)return null;const target=edgeFor(middle,input[index]);if(target>=0){const nextFlags=extend(extend(flags,depth,input[index+1]),depth+1,input[index]);result=search(target,index+2,left-1,depth+2,nextFlags);if(result!==false)return result;}}
    }
   }
   for(let edge=meta[node]>>>1,end=meta[node+1]>>>1;edge<end;edge++){
    const symbol=letters[labels[edge]],target=targets[edge],nextFlags=extend(flags,depth,symbol);
    if(index<n&&symbol!==input[index]){result=search(target,index+1,left-1,depth+1,nextFlags);if(result!==false)return result;}
    result=search(target,index,left-1,depth+1,nextFlags);if(result!==false)return result;
   }
   return false;
  }
  return search(root,0,maxEdits,0,3);
 }
 /** Return a folded word only after proving it is the sole different one-edit
  * repair. Undefined means none or ambiguity; null means an incomplete search.
  * Path capture is separate so boolean ambiguity checks keep their existing
  * allocation and traversal behavior. Both walks spend the same call budget. */
 function uniqueRepair(word,budget){
  if(typeof word!=='string'||word.length>510||!budget||!Number.isSafeInteger(budget.remaining)||budget.remaining<0)return null;
  prepare();
  const folded=word.toLowerCase(),input=Array.from(folded,character=>character.codePointAt(0));if(input.length>255)return null;
  const {meta,targets,labels,ranges,letters,root}=graph,n=input.length,path=[];
  function edgeFor(node,symbol){let low=meta[node]>>>1,high=(meta[node+1]>>>1)-1;while(low<=high){const mid=(low+high)>>>1,value=letters[labels[mid]];if(value===symbol)return targets[mid];if(value<symbol)low=mid+1;else high=mid-1;}return -1;}
  function emitted(depth){let result='';for(let at=0;at<depth;at++)result+=String.fromCodePoint(path[at]);return result;}
  function first(node,index,left,depth){
   if(--budget.remaining<0)return null;
   const range=ranges[node],remaining=n-index;if((range&255)>remaining+left||(range>>>8)<remaining-left)return false;
   if(left===0){
    while(index<n){const symbol=input[index++];node=edgeFor(node,symbol);if(node<0)return false;path[depth++]=symbol;if(--budget.remaining<0)return null;}
    return meta[node]&1?emitted(depth):false;
   }
   // With no edit yet, a terminal spells the original word and is excluded.
   let result;
   if(index<n){
    const target=edgeFor(node,input[index]);if(target>=0){path[depth]=input[index];result=first(target,index+1,left,depth+1);if(result!==false)return result;}
    result=first(node,index+1,0,depth);if(result!==false)return result;
    if(index+1<n&&input[index]!==input[index+1]){
     const middle=edgeFor(node,input[index+1]);
     if(middle>=0){if(--budget.remaining<0)return null;const target=edgeFor(middle,input[index]);if(target>=0){path[depth]=input[index+1];path[depth+1]=input[index];result=first(target,index+2,0,depth+2);if(result!==false)return result;}}
    }
   }
   for(let edge=meta[node]>>>1,end=meta[node+1]>>>1;edge<end;edge++){
    const symbol=letters[labels[edge]],target=targets[edge];path[depth]=symbol;
    if(index<n&&symbol!==input[index]){result=first(target,index+1,0,depth+1);if(result!==false)return result;}
    result=first(target,index,0,depth+1);if(result!==false)return result;
   }
   return false;
  }
  const candidate=first(root,0,1,0);if(candidate===null)return null;if(candidate===false)return undefined;
  const alternative=hasAlternative(folded,candidate,budget);return alternative===false?candidate:alternative===null?null:undefined;
 }
 return {hasAlternative,uniqueRepair,prepare};
}
const lookup=createAmbiguityLookup(bundled);
export const hasAlternative=lookup.hasAlternative;
export const uniqueRepair=lookup.uniqueRepair;
export const prepareAmbiguity=lookup.prepare;

const languageLookups={en:createAmbiguityLookup(englishAsset),de:createAmbiguityLookup(germanAsset)};
export function ambiguityFor(language,mixedLanguage=true){
 if(!['en','de'].includes(language)||typeof mixedLanguage!=='boolean')throw new RangeError('Choose a supported language and vocabulary setting.');
 return mixedLanguage?lookup:languageLookups[language];
}

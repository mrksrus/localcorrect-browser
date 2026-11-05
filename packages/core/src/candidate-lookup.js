// Shared static candidate index; only immutable data offsets persist between calls.
import data from './candidates.js';
import inflections from './inflection-data.js';
import{software,people}from'./protect-vocabulary.js';
const inventories=new Map(),shards=new Map();
function offsets(source,field=false){
 let count=1;for(let p=source.indexOf('\n');p!==-1;p=source.indexOf('\n',p+1))count++;
 const starts=new Uint32Array(count+1);let start=0,previous='';
 for(let i=0;i<count;i++){const next=source.indexOf('\n',start),end=next<0?source.length:next,keyEnd=field?source.indexOf('\t',start):end,key=source.slice(start,keyEnd);if(!key||key<=previous||keyEnd>end||keyEnd<start)throw new Error('Invalid bundled candidate index. No correction performed.');starts[i]=start;previous=key;start=end+1;}
 starts[count]=source.length+1;return{starts,count};
}
function lookup(language,key){const source=data[language].index[key.slice(0,2)];if(!source)return null;const cacheKey=language+':'+key.slice(0,2);if(!shards.has(cacheKey))shards.set(cacheKey,offsets(source,true));const{starts,count}=shards.get(cacheKey);let low=0,high=count-1;while(low<=high){const mid=(low+high)>>>1,a=starts[mid],separator=source.indexOf('\t',a),candidate=source.slice(a,separator);if(candidate===key)return source.slice(separator+1,starts[mid+1]-1);if(candidate<key)low=mid+1;else high=mid-1;}return null;}
// Exact one-edit distance, including one adjacent transposition, without a matrix.
export function oneEdit(a,b){
 if(a===b)return true;if(Math.abs(a.length-b.length)>1)return false;
 if(a.length===b.length){let first=-1;for(let i=0;i<a.length;i++)if(a[i]!==b[i]){if(first<0)first=i;else return i===first+1&&a[first]===b[i]&&a[i]===b[first]&&a.slice(i+1)===b.slice(i+1);}return first>=0;}
 if(a.length>b.length)[a,b]=[b,a];let i=0;while(i<a.length&&a[i]===b[i])i++;return a.slice(i)===b.slice(i+1);
}
export function candidates(language,word,budget){
 if(!inventories.has(language)){const source=data[language]?.words;if(typeof source!=='string'||source.length<10000)throw new Error('Missing bundled candidate inventory. No correction performed.');inventories.set(language,offsets(source));}
 const source=data[language].words,{starts,count}=inventories.get(language),ids=new Set(),found=[];
 for(const key of new Set([word,...Array.from({length:word.length},(_,i)=>word.slice(0,i)+word.slice(i+1))])){
  const bucket=lookup(language,key);if(!bucket)continue;
  for(const encoded of bucket.split(',')){
   if(--budget.remaining<0)return null;
   const id=parseInt(encoded,36);if(!/^[0-9a-z]+$/.test(encoded)||id<0||id>=count)throw new Error('Invalid candidate identifier. No correction performed.');
   if(ids.has(id))continue;ids.add(id);if(ids.size>128)return null;
   const candidate=source.slice(starts[id],starts[id+1]-1);if(oneEdit(word,candidate))found.push(candidate);
  }
 }
 return found;
}
const keyboardNeighbors=new Map();
for(const rows of [['qwertyuiop','asdfghjkl','zxcvbnm'],['qwertzuiopü','asdfghjklöä','yxcvbnm']])for(let y=0;y<rows.length;y++)for(let x=0;x<rows[y].length;x++){
 const a=rows[y][x];if(!keyboardNeighbors.has(a))keyboardNeighbors.set(a,new Set());
 for(let yy=Math.max(0,y-1);yy<=Math.min(rows.length-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(rows[yy].length-1,x+1);xx++)keyboardNeighbors.get(a).add(rows[yy][xx]);
}
export function typingRepair(original,target){
 if(original.length===target.length){let at=-1;for(let i=0;i<original.length;i++)if(original[i]!==target[i]){if(at<0)at=i;else return i===at+1&&original[at]===target[i]&&original[i]===target[at]&&original.slice(i+1)===target.slice(i+1);}return at>=0&&!/[äöüß]/.test(original[at])&&(keyboardNeighbors.get(original[at])?.has(target[at])||({a:'ä',o:'ö',u:'ü'})[original[at]]===target[at]);}
 // Missing/extra single characters are considered only after full ambiguity checks.
 if(original.length>target.length){
  let i=0;while(i<target.length&&original[i]===target[i])i++;
  const removed=original[i];
  return oneEdit(original,target)&&[original[i-1],original[i+1]].filter(Boolean).some(neighbor=>neighbor===removed||keyboardNeighbors.get(neighbor)?.has(removed));
 }
 return oneEdit(original,target);
}

const positiveSources={software,people,enInflections:inflections.en,deInflections:inflections.de},positiveIndexes=new Map();
export function protectedWord(kind,word){
 const source=positiveSources[kind];if(!positiveIndexes.has(kind))positiveIndexes.set(kind,offsets(source));
 const{starts,count}=positiveIndexes.get(kind);let low=0,high=count-1;
 while(low<=high){const mid=(low+high)>>>1,candidate=source.slice(starts[mid],starts[mid+1]-1);if(candidate===word)return true;if(candidate<word)low=mid+1;else high=mid-1;}return false;
}

export function eligibleInflection(language,word){return protectedWord(language+'Inflections',word);}

import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWords} from '../scripts/ambiguity-lexicon.mjs';
import {createAmbiguityLookup,hasAlternative,uniqueRepair,prepareAmbiguity} from '../packages/core/src/ambiguity-lookup.js';
import bundled from '../packages/core/src/ambiguity-data.js';
import en from '../packages/core/src/lexicons/en.js';
import de from '../packages/core/src/lexicons/de.js';
import {software,people} from '../packages/core/src/protect-vocabulary.js';

// Independent oracle: enumerate every one-edit string, then ask a plain Set.
// It shares neither the automaton traversal nor its distance implementation.
function oneEditStrings(word,alphabet){
 const letters=[...word],result=new Set();
 for(let at=0;at<=letters.length;at++){
  for(const letter of alphabet){result.add([...letters.slice(0,at),letter,...letters.slice(at)].join(''));if(at<letters.length)result.add([...letters.slice(0,at),letter,...letters.slice(at+1)].join(''));}
  if(at<letters.length)result.add([...letters.slice(0,at),...letters.slice(at+1)].join(''));
  if(at+1<letters.length)result.add([...letters.slice(0,at),letters[at+1],letters[at],...letters.slice(at+2)].join(''));
 }
 result.delete(word);return result;
}
function oracle(words,alphabet,word,chosen){word=word.toLowerCase();chosen=chosen.toLowerCase();return [...oneEditStrings(word,alphabet)].some(candidate=>candidate!==chosen&&words.has(candidate));}
function uniqueOracle(words,alphabet,word){const repairs=[...oneEditStrings(word.toLowerCase(),alphabet)].filter(candidate=>words.has(candidate));return repairs.length===1?repairs[0]:undefined;}
const ample=()=>({remaining:10000000});

test('all four one-edit operations and Unicode scalar edits find competitors',()=>{
 for(const [inventory,word,chosen] of [
  [['cat','cot'],'ct','cat'],[['cat'],'caat','different'],[['cat','cot'],'cut','cot'],[['abc'],'acb','different'],
  [['Häuser'],'huser','different'],[['Bär'],'bar','different'],[['Straße'],'strae','different'],
  [['a𐐨b'],'ab','different'],[['a𐐨b'],'𐐨ab','different'],[['İa'],'ia','different']
 ]){
  const lookup=createAmbiguityLookup(compileWords(inventory).asset);
  assert.equal(lookup.hasAlternative(word,chosen,ample()),true,word);
 }
});

test('word and chosen are excluded after case folding, including shared suffixes',()=>{
 const {asset,stats}=compileWords(['Bat','cat','rat']);const lookup=createAmbiguityLookup(asset);
 assert.equal(stats.nodes,4,'suffix minimization merges the three at suffixes');
 assert.equal(lookup.hasAlternative('BAT','Cat',ample()),true);
 assert.equal(createAmbiguityLookup(compileWords(['Cat']).asset).hasAlternative('cat','other',ample()),false);
 assert.equal(createAmbiguityLookup(compileWords(['Cat']).asset).hasAlternative('caat','CAT',ample()),false);
 assert.equal(createAmbiguityLookup(compileWords(['Cat']).asset).hasAlternative('cta','CAT',ample()),false);
 assert.equal(createAmbiguityLookup(compileWords(['a𐐨b']).asset).hasAlternative('a𐐨b','other',ample()),false);
});

test('exhaustive small multilingual inventory agrees with independently enumerated edits',()=>{
 const alphabet=['a','b','ä','ß','𐐨'],words=new Set(['a','ba','äb','straße','i\u0307a']);
 for(const a of alphabet)for(const b of alphabet)for(const c of alphabet)if((a.codePointAt(0)+b.codePointAt(0)+c.codePointAt(0))%3===0)words.add(a+b+c);
 const symbols=new Set([...words].flatMap(word=>[...word]));const lookup=createAmbiguityLookup(compileWords(words).asset);
 const queries=new Set(['','a','ab','ba','straße','strasse','ia','i\u0307a']);
 for(const word of words)for(const edited of oneEditStrings(word,alphabet))queries.add(edited);
 const ordered=[...words];let at=0;
 for(const word of queries){const chosen=at++%2?ordered[at%ordered.length]:word.toUpperCase();assert.equal(lookup.hasAlternative(word,chosen,ample()),oracle(words,symbols,word,chosen),JSON.stringify({word,chosen}));}
});

test('a spent budget never returns a partial proof of uniqueness',()=>{
 const lookup=createAmbiguityLookup(compileWords(['cat','cater','scatter','bats','bat','rate','late']).asset);
 const cases=[['caat','cat'],['zzzz','other'],['xat','bat'],['caterx','cater']];
 for(const [word,chosen] of cases){
  const budget=ample(),answer=lookup.hasAlternative(word,chosen,budget),spent=10000000-budget.remaining;
  assert.ok(spent>0);
  assert.equal(lookup.hasAlternative(word,chosen,{remaining:spent}),answer);
  for(let allowance=0;allowance<spent;allowance++)assert.equal(lookup.hasAlternative(word,chosen,{remaining:allowance}),null,`${word}, budget ${allowance}`);
 }
 for(const remaining of [NaN,Infinity,-1,1.5])assert.equal(lookup.hasAlternative('cat','bat',{remaining}),null);
});

test('unique repairs cover every edit type, Unicode and original-word exclusion',()=>{
 for(const [inventory,word,expected] of [
  [['cat'],'ct','cat'],[['cat'],'caat','cat'],[['cat'],'cut','cat'],[['abc'],'acb','abc'],
  [['Häuser'],'huser','häuser'],[['Bär'],'BAR','bär'],[['Straße'],'strae','straße'],
  [['a𐐨b'],'ab','a𐐨b'],[['a𐐨b'],'𐐨ab','a𐐨b'],[['İa'],'ia','i\u0307a'],
  [['CAT','cat'],'cat',undefined],[['cat','coat'],'cat','coat'],
  [['bat','cat','rat'],'zat',undefined],[['bat','cat','rat'],'bat',undefined],
  [['cat'],'zzzz',undefined]
 ])assert.equal(createAmbiguityLookup(compileWords(inventory).asset).uniqueRepair(word,ample()),expected,word);
});

test('unique repair never publishes a first candidate without a complete uniqueness proof',()=>{
 for(const [inventory,word] of [[['cat'],'caat'],[['cat'],'zzzz'],[['cat','cot'],'cut']]){
  const lookup=createAmbiguityLookup(compileWords(inventory).asset),budget=ample(),answer=lookup.uniqueRepair(word,budget),spent=10000000-budget.remaining;
  assert.ok(spent>0);assert.equal(lookup.uniqueRepair(word,{remaining:spent}),answer);
  for(let allowance=0;allowance<spent;allowance++)assert.equal(lookup.uniqueRepair(word,{remaining:allowance}),null,`${word}, budget ${allowance}`);
 }
 const lookup=createAmbiguityLookup(compileWords(['cat']).asset);
 for(const remaining of [NaN,Infinity,-1,1.5])assert.equal(lookup.uniqueRepair('caat',{remaining}),null);
});

test('unique repair agrees with a Set oracle on deterministic random multilingual fixtures',()=>{
 const alphabet=['a','b','c','ä','ß','𐐨'];let seed=0x51a7;
 const random=limit=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%limit;};
 const words=new Set(['a','ba','i\u0307a','straße']);
 for(let at=0;at<64;at++){let word='';for(let i=0,length=1+random(5);i<length;i++)word+=alphabet[random(alphabet.length)];words.add(word);}
 const symbols=new Set([...words].flatMap(word=>[...word])),lookup=createAmbiguityLookup(compileWords(words).asset);
 const queries=new Set(['','ia','i\u0307a','strasse','straße']);
 for(const word of words){const edits=[...oneEditStrings(word,alphabet)];for(let at=0;at<12;at++)queries.add(edits[random(edits.length)]);}
 for(const word of queries)assert.equal(lookup.uniqueRepair(word,ample()),uniqueOracle(words,symbols,word),JSON.stringify({word}));
});

// A separate OSA matrix checks the optional offline two-edit search. Runtime
// callers retain the one-edit default; this larger radius only adds vetoes.
function osa(a,b){
 a=[...a];b=[...b];const d=Array.from({length:a.length+1},(_,i)=>Array.from({length:b.length+1},(_,j)=>i?j?0:i:j));
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);}
 return d[a.length][b.length];
}
test('optional offline radius two agrees with an independent OSA matrix',()=>{
 const words=['a','ab','ba','abc','cab','bcaa','abä','äba','a𐐨b','𐐨ba'],lookup=createAmbiguityLookup(compileWords(words).asset);
 for(const word of ['','a','b','aa','cba','bca','abbc','ca','äab','𐐨ab','a𐐨','zzzz','abcd'])for(const chosen of words){
  const expected=words.some(candidate=>candidate!==word&&candidate!==chosen&&osa(word,candidate)<=2);
  assert.equal(lookup.hasAlternative(word,chosen,ample(),2),expected,JSON.stringify({word,chosen}));
 }
 assert.equal(createAmbiguityLookup(compileWords(['abc']).asset).hasAlternative('ca','other',ample(),2),false,'OSA does not reuse transposed characters');
});

test('malformed, truncated and structurally corrupted assets fail closed',()=>{
 const {asset}=compileWords(['cat','bat']);
 const corruptions=[{...asset,format:2},{...asset,byteLength:0},{...asset,data:asset.data.slice(0,-4)},{...asset,data:'!'+asset.data.slice(1)},{...asset,checksum:asset.checksum^1},{...asset,data:asset.data.slice(0,-1)+'A'}];
 for(const broken of corruptions)assert.throws(()=>createAmbiguityLookup(broken).hasAlternative('cat','bat',ample()),/Invalid bundled ambiguity automaton/);
 const bytes=Buffer.from(asset.data,'base64');bytes.writeUInt32LE(0xffffffff,20);
 let checksum=2166136261;for(const byte of bytes)checksum=Math.imul(checksum^byte,16777619)>>>0;
 assert.throws(()=>createAmbiguityLookup({...asset,data:bytes.toString('base64'),checksum}).prepare(),/Invalid bundled ambiguity automaton/);
});

test('the bundled joint inventory agrees with a naive union oracle on deterministic source samples',()=>{
 const sources=[en,de,software,people].map(source=>source.split('\n').map(word=>word.toLowerCase()));
 const words=new Set(sources.flat()),alphabet=new Set([...words].flatMap(word=>[...word]));
 prepareAmbiguity();
 for(const source of sources)for(let at=17;at<source.length;at+=Math.max(1,Math.floor(source.length/48))){
  const chosen=source[at],letters=[...chosen],middle=Math.floor(letters.length/2);
  const queries=[letters.filter((_,i)=>i!==middle).join(''),letters.slice(0,middle).join('')+'q'+letters.slice(middle).join(''),letters.map((letter,i)=>i===middle?'x':letter).join('')];
  if(letters.length>1){const swapped=letters.slice();[swapped[0],swapped[1]]=[swapped[1],swapped[0]];queries.push(swapped.join(''));}
  for(const word of queries){assert.equal(hasAlternative(word,chosen,ample()),oracle(words,alphabet,word,chosen),JSON.stringify({word,chosen}));assert.equal(uniqueRepair(word,ample()),uniqueOracle(words,alphabet,word),JSON.stringify({word,operation:'uniqueRepair'}));}
 }
 assert.ok(bundled.byteLength<8*1024*1024,'the immutable joint inventory stays small');
});

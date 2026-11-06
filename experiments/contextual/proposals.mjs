// Experimental offline proposals. No production policy or release is changed.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCorrector, protectedRanges} from '../../packages/core/src/index.js';
import {candidates,protectedWord} from '../../packages/core/src/candidate-lookup.js';
import enSource from '../../packages/core/src/lexicons/en.js';
import deSource from '../../packages/core/src/lexicons/de.js';

const [file, output, limitText='0'] = process.argv.slice(2);
if(!file||!output)throw new Error('Usage: node proposals.mjs corpus.json output.json limit');
const bytes=readFileSync(file), parsed=JSON.parse(bytes), corpus=parsed.cases||parsed;
// Deterministic input-only cohort selection. No gold-based selection.
const selected=[...corpus].sort((a,b)=>createHash('sha256').update(a.id).digest('hex').localeCompare(createHash('sha256').update(b.id).digest('hex'))).slice(0,Number(limitText)||corpus.length);
const lexical={en:new Set(enSource.split('\n').map(x=>x.toLowerCase())),de:new Set(deSource.split('\n').map(x=>x.toLowerCase()))};
const frequencies=Object.fromEntries(['en','de'].map(l=>[l,new Map(readFileSync(new URL(`../../packages/core/dictionaries/${l}.txt`,import.meta.url),'utf8').trim().split('\n').map(line=>{const [word,f]=line.trim().split(/\s+/);return[word.toLowerCase(),Number(f)];}))]));
const corrector=createCorrector(Object.fromEntries(['en','de'].map(l=>[l,readFileSync(new URL(`../../packages/core/dictionaries/${l}.txt`,import.meta.url),'utf8')])));
const rows=[];
for(const row of selected){
 const base=corrector.correct(row.input,{language:row.language}), protectedSpans=protectedRanges(row.input), offers=[];
 const budget={remaining:16000};
 for(const match of row.input.matchAll(/\p{L}[\p{L}\p{M}]*/gu)){
  const original=match[0],word=original.toLowerCase(),offset=match.index,end=offset+original.length;
  if(word.length<3||word.length>24||original===original.toUpperCase()||/\p{M}/u.test(word)||
     (original!==word&&original.slice(1)!==original.slice(1).toLowerCase())||
     protectedSpans.some(([a,b])=>offset<b&&end>a)||base.edits.some(e=>offset<e.offset+e.length&&end>e.offset)||
     protectedWord('software',word)||(original!==word&&protectedWord('people',word)))continue;
  // This first experiment only revisits words outside the selected language's
  // inventory. Real-word grammar errors require a separate detection experiment.
  if(lexical[row.language].has(word))continue;
  let options=candidates(row.language,word,budget);
  if(!options)continue;
  options=options.filter(x=>x!==word).sort((a,b)=>(frequencies[row.language].get(b)||0)-(frequencies[row.language].get(a)||0)).slice(0,8);
  if(!options.length)continue;
  const recase=x=>original[0]!==word[0]?x[0].toUpperCase()+x.slice(1):x;
  offers.push({offset,length:original.length,original,foreignKnown:lexical[row.language==='en'?'de':'en'].has(word),options:options.map(x=>({replacement:recase(x),frequency:frequencies[row.language].get(x)||0}))});
  if(offers.length>=32)break;
 }
 rows.push({id:row.id,language:row.language,input:row.input,expected:row.expected,kind:row.kind,edits:row.edits||null,baseline:base,offers});
}
const document={schema:1,sourceSha256:createHash('sha256').update(bytes).digest('hex'),source:file,policy:'unknown-in-selected-language, exact-one-edit common candidates, original-span protections, max32 proposals/8 candidates',rows};
writeFileSync(output,JSON.stringify(document));
console.log(JSON.stringify({file:output,documents:rows.length,offers:rows.reduce((n,r)=>n+r.offers.length,0)}));

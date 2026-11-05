import {readFileSync,writeFileSync} from 'node:fs';
import {en,de} from '../packages/core/src/typos.js';
const assets={en,de},cache=new Map();
const lookup=(language,word)=>{const key=language+':'+word.slice(0,2);if(!cache.has(key))cache.set(key,new Map((assets[language][word.slice(0,2)]||'').split('\n').filter(Boolean).map(line=>line.split('\t').slice(0,2))));return cache.get(key).get(word);};
const summary={},overlap={};
for(const split of ['dev','holdout','blind']){
 summary[split]={};for(const model of ['rc3','candidate']){const r=JSON.parse(readFileSync(`test-results/scale/${model}-${split}.json`,'utf8'));summary[split][model]={corpusSha256:r.corpusSha256,summary:r.summary};}
 const file=split==='blind'?'tests/scale-corpus/blind/cases.json':`tests/scale-corpus/${split}.json`;
 const rows=JSON.parse(readFileSync(file,'utf8')).cases;let gold=0,known=0;const origins={};
 for(const row of rows)for(const edit of row.edits){gold++;const origin=edit.provenance||'blind-authored';if(!origins[origin])origins[origin]={gold:0,known:0};origins[origin].gold++;if(lookup(row.language,edit.original.toLowerCase())===edit.replacement.toLowerCase()){known++;origins[origin].known++;}}
 overlap[split]={goldEdits:gold,precompiledPairMatches:known,origins,note:'Prior pair membership before context/validity/case gates. Fresh contexts do not make an existing pair independent.'};
}
const output={description:'Frozen precision-first candidate; no post-audit policy changes. Both candidate modes currently share identical policy. Rates are observations on synthetic dependent data, not a real-world guarantee.',freeze:JSON.parse(readFileSync('evaluation-freeze.json','utf8')),summary,overlap};
writeFileSync('EVALUATION.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(overlap,null,2));

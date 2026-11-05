import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createCorrector} from '../packages/core/src/index.js';
const corrector = createCorrector(Object.fromEntries(['en','de'].map(l => [l,readFileSync(new URL(`../packages/core/dictionaries/${l}.txt`,import.meta.url),'utf8')])));
const {cases} = JSON.parse(readFileSync(new URL('./hillclimb.json',import.meta.url),'utf8'));
const results = cases.flatMap(row => ['conservative','balanced'].map(mode => ({...row,mode,actual:corrector.correct(row.input,{language:row.language,mode}).text})));
const summary = [];
for (const split of ['dev','holdout']) for (const mode of ['conservative','balanced']) {
 const rows = results.filter(r=>r.split===split&&r.mode===mode);
 const fixes = rows.filter(r=>r.kind==='correction'), safe = rows.filter(r=>r.kind==='safe');
 summary.push({split,mode,exactCorrections:fixes.filter(r=>r.actual===r.expected).length,correctionCases:fixes.length,preservedControls:safe.filter(r=>r.actual===r.input).length,controlCases:safe.length});
}
mkdirSync('test-results',{recursive:true});
writeFileSync('test-results/hillclimb.json',JSON.stringify({summary,results},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));

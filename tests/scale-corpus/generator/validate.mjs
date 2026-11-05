import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const read=name=>JSON.parse(readFileSync(new URL(`./frozen/${name}`,import.meta.url),'utf8'));
const dev=read('dev.json').cases,holdout=read('holdout.json').cases,rows=[...dev,...holdout];
const pairs=new Map(read('pair-pool.json').pairs.map(p=>[p.pairId,p]));
assert.equal(rows.length,5000);assert.equal(dev.length,3000);assert.equal(holdout.length,2000);
const ids=new Set(),texts=new Set(),families={dev:new Set(),holdout:new Set()};
let intendedEdits=0,nonBmp=0;
for(const row of rows){
 assert.ok(!ids.has(row.id));ids.add(row.id);
 assert.ok(!texts.has(row.input));texts.add(row.input);
 assert.ok(row.input.length<20000);
 assert.equal(row.kind==='safe',row.edits.length===0);
 assert.ok(row.kind==='safe'||row.edits.length>=1&&row.edits.length<=5);
 let rebuilt='',end=0;
 for(const edit of row.edits){
  assert.ok(Number.isInteger(edit.offset)&&Number.isInteger(edit.length)&&edit.offset>=end&&edit.length>0);
  assert.equal(row.input.slice(edit.offset,edit.offset+edit.length),edit.original);
  assert.equal(edit.original.length,edit.length);
  assert.match(edit.original,/^\p{L}+$/u);assert.match(edit.replacement,/^\p{L}+$/u);
  assert.notEqual(edit.original.normalize('NFKC').toLocaleLowerCase(),edit.replacement.normalize('NFKC').toLocaleLowerCase());
  const pair=pairs.get(edit.pairId);assert.ok(pair);
  assert.equal(pair.language,row.language);assert.equal(pair.split,row.split);
  assert.equal(pair.typo,edit.original);assert.equal(pair.target,edit.replacement);
  rebuilt+=row.input.slice(end,edit.offset)+edit.replacement;end=edit.offset+edit.length;
  families[row.split].add(edit.pairFamily);intendedEdits++;
 }
 rebuilt+=row.input.slice(end);assert.equal(rebuilt,row.expected);
 if(row.edits.length&&/[\u{10000}-\u{10ffff}]/u.test(row.input.slice(0,row.edits[0].offset)))nonBmp++;
 if(row.longEmail){assert.equal(row.format,'email');assert.ok(row.wordCount>=950&&row.wordCount<=1060);}
 if(row.format!=='short')assert.ok(row.input.split(/\n\s*\n/).length>=(row.format==='email'?5:2));
}
assert.equal([...families.dev].filter(x=>families.holdout.has(x)).length,0);
for(const lang of ['en','de']){
 const a=rows.filter(r=>r.language===lang);assert.equal(a.length,2500);assert.equal(a.filter(r=>r.kind==='correction').length,1500);
}
for(const [format,n] of [['email',2000],['paragraphs',2000],['short',1000]])assert.equal(rows.filter(r=>r.format===format).length,n);
assert.equal(rows.filter(r=>r.longEmail).length,100);
console.log(JSON.stringify({documents:rows.length,intendedEdits,uniqueInputs:texts.size,familyOverlap:0,nonBmpBeforeEditDocuments:nonBmp,nativeJavaScriptUtf16Reconstruction:'pass'},null,2));

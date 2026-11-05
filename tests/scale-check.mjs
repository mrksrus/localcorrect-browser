import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';import assert from'node:assert/strict';
const sha=b=>createHash('sha256').update(b).digest('hex');
const frozen=JSON.parse(readFileSync('evaluation-freeze.json','utf8'));
for(const [file,hash]of Object.entries(frozen.coreSha256))assert.equal(sha(readFileSync('packages/core/'+file)),hash,'Frozen functional source changed: '+file);
for(const [file,hash]of Object.entries(frozen.corpusSha256))assert.equal(sha(readFileSync(file)),hash,'Frozen gold changed: '+file);
const families={};
for(const part of ['dev','holdout']){const rows=JSON.parse(readFileSync(`tests/scale-corpus/${part}.json`,'utf8')).cases;assert.equal(rows.length,part==='dev'?3000:2000);families[part]=new Set(rows.flatMap(r=>r.pairFamilies||[]));}
for(const f of families.dev)assert.ok(!families.holdout.has(f),'Target family overlap');
for(const [split,file,minEdits]of [['dev','dev.json',2000],['holdout','holdout.json',1400],['blind','blind/cases.json',50]]){
 execFileSync(process.execPath,['tests/scale-evaluate.mjs','--file','tests/scale-corpus/'+file,'--label','check-'+split],{stdio:'pipe'});
 const report=JSON.parse(readFileSync(`test-results/scale/check-${split}.json`));
 for(const row of report.summary.filter(r=>r.language==='all')){assert.ok(row.precision>=.99,'Edit precision target');assert.ok(row.trueEdits>=minEdits,'Nonzero useful coverage');assert.equal(row.falseEdits,0,'Frozen-candidate unwanted-edit regression');assert.equal(row.preservedSafeDocuments,row.safeDocuments);}
}
console.log('PASS frozen source/gold hashes, target-family split, all 5,100 documents in both modes; precision >=99%, zero unwanted and nonzero coverage.');

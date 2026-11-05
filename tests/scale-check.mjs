import{readFileSync,readdirSync}from'node:fs';
import{createHash}from'node:crypto';
import{execFileSync}from'node:child_process';
import assert from'node:assert/strict';
const sha=b=>createHash('sha256').update(b).digest('hex');
const frozen=JSON.parse(readFileSync('evaluation-freeze.json','utf8'));
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
const coreFiles=[...walk('packages/core/src').filter(f=>f.endsWith('.js')).map(f=>f.slice('packages/core/'.length)),'dictionaries/en.txt','dictionaries/de.txt'].sort();
assert.deepEqual(Object.keys(frozen.coreSha256).sort(),coreFiles,'Freeze must cover every functional core module, generated asset and frequency dictionary');
for(const [file,hash]of Object.entries(frozen.coreSha256))assert.equal(sha(readFileSync('packages/core/'+file)),hash,'Frozen functional source changed: '+file);
const sets=[
 {name:'dev',file:'tests/scale-corpus/dev.json',documents:3000,minEdits:2000},
 {name:'holdout',file:'tests/scale-corpus/holdout.json',documents:2000,minEdits:1400},
 {name:'blind',file:'tests/scale-corpus/blind/cases.json',documents:100,minEdits:50},
 {name:'rc5blind',file:'tests/scale-corpus/rc5-blind/cases.json',documents:200,minEdits:1},
 {name:'rc5blind2',file:'tests/scale-corpus/rc5-blind2/cases.json',documents:200,minEdits:1},
 {name:'rc5final',file:'tests/scale-corpus/rc5-final-blind/cases.json',documents:100,minEdits:1},
];
// Consumed gold digests also prevent silently accepting edits before a new freeze.
const knownGold={
 'tests/scale-corpus/dev.json':'6f5002544027d008dd5c6e3eab67b0fbcdc96c760c83d05425b76c1e38a39df1',
 'tests/scale-corpus/holdout.json':'69c15327b31f61fbb2758b59034232a0f50d38223acd653b98bf4ca59868e248',
 'tests/scale-corpus/blind/cases.json':'317a38b8331358dc01a21776ab68e1452c49bdc3ce19425cd59f87f4cc05fe69',
 'tests/scale-corpus/rc5-blind/cases.json':'ee33337470c8ff6dec8b42b0a64574e5f2f4954f0bd2346706a9827211f5a5a8',
 'tests/scale-corpus/rc5-blind2/cases.json':'03ad1bc56d5703aa94dc9a0cad253e2e67d9c39f6db3a9b9fef62d09fd160901',
};
for(const [file,hash]of Object.entries(knownGold))assert.equal(frozen.corpusSha256[file],hash,'Known regression gold was changed: '+file);
assert.deepEqual(Object.keys(frozen.corpusSha256).sort(),sets.map(s=>s.file).sort(),'Freeze must cover all six evaluation corpora');
for(const [file,hash]of Object.entries(frozen.corpusSha256))assert.equal(sha(readFileSync(file)),hash,'Frozen gold changed: '+file);
const families={};
for(const set of sets){
 const rows=JSON.parse(readFileSync(set.file,'utf8')).cases;
 assert.equal(rows.length,set.documents,set.name+' document count');
 if(set.name==='dev'||set.name==='holdout')families[set.name]=new Set(rows.flatMap(r=>r.pairFamilies||[]));
}
for(const family of families.dev)assert.ok(!families.holdout.has(family),'Target family overlap: '+family);
const combined=Object.fromEntries(['conservative','balanced'].map(mode=>[mode,{trueEdits:0,exactDocuments:0}]));
for(const set of sets){
 execFileSync(process.execPath,['tests/scale-evaluate.mjs','--file',set.file,'--label','check-'+set.name],{stdio:'pipe'});
 const report=JSON.parse(readFileSync(`test-results/scale/check-${set.name}.json`));
 assert.equal(report.corpusSha256,frozen.corpusSha256[set.file],set.name+' scored gold changed');
 assert.deepEqual(report.coreSha256,frozen.coreSha256,set.name+' scored functional source changed');
 for(const mode of ['conservative','balanced']){
  const row=report.summary.find(r=>r.language==='all'&&r.mode===mode);
  assert.ok(row,set.name+' missing '+mode+' summary');
  assert.equal(row.documents,set.documents,set.name+' evaluated document count');
  assert.ok(row.precision>=.99,set.name+' edit precision target');
  assert.ok(row.trueEdits>=set.minEdits,set.name+' useful correction coverage');
  assert.equal(row.falseEdits,0,set.name+' unwanted-edit regression');
  assert.equal(row.preservedSafeDocuments,row.safeDocuments,set.name+' clean-document preservation');
  if(set.name==='dev'||set.name==='holdout')for(const metric of ['trueEdits','exactDocuments'])combined[mode][metric]+=row[metric];
 }
}
for(const [mode,total]of Object.entries(combined)){
 assert.ok(total.trueEdits>=3811,mode+' known 5,000-document wanted edits below fixed RC4 baseline');
 assert.ok(total.exactDocuments>=3428,mode+' known 5,000-document exact corrections below fixed RC4 baseline');
}
console.log('PASS complete frozen core/gold inventories, unchanged gold, target-family split and all 5,600 documents in both modes; zero unwanted edits, clean documents preserved, useful corrections and known 5,000-document RC4 coverage floors. The old 5,500 cases, including both consumed RC5 audits, are regression data; only the final 100-case RC5 set was fresh at first evaluation after the final freeze.');

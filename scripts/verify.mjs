import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const provenance=JSON.parse(readFileSync('dictionary-sources.json','utf8'));
const results=[];
for(const browser of ['firefox','chrome']){
 const prefix=`build/${browser}/`;
 const m=JSON.parse(readFileSync(prefix+'manifest.json','utf8'));
 assert.equal(m.manifest_version,3);assert.equal(m.version,'0.9.0.1');assert.deepEqual(m.permissions,['activeTab','scripting']);
 assert.equal(m.host_permissions,undefined);assert.equal(m.content_scripts,undefined);assert.equal(m.background,undefined);
 for(const lang of ['en','de'])assert.equal(createHash('sha256').update(readFileSync(prefix+`dictionaries/${lang}.txt`)).digest('hex'),provenance.sources[lang].output_sha256);
 assert.ok(readFileSync(prefix+'licenses/CC-BY-SA-4.0.txt','utf8').includes('Attribution-ShareAlike'));
 assert.ok(readFileSync(prefix+'LICENSE','utf8').includes('GNU GENERAL PUBLIC LICENSE'));
 assert.ok(readFileSync(prefix+'source/packages/core/src/index.js','utf8').includes('createCorrector'));
 const path=`dist/localcorrect-${browser}-1.0.0-rc.1.zip`;
 const entries=JSON.parse(execFileSync('python',['-c',`import json,zipfile\nwith zipfile.ZipFile('${path}') as z:\n assert z.testzip() is None\n print(json.dumps(z.namelist()))`],{encoding:'utf8'}));
 for(const name of ['manifest.json','dictionaries/en.txt','dictionaries/de.txt','LICENSE','THIRD_PARTY.md','licenses/CC-BY-SA-4.0.txt','source/scripts/build.mjs'])assert.ok(entries.includes(name));
 const sha256=createHash('sha256').update(readFileSync(path)).digest('hex');results.push({path,sha256,entries:entries.length,bytes:readFileSync(path).length});
}
mkdirSync('test-results',{recursive:true});writeFileSync('test-results/packages.json',JSON.stringify(results,null,2)+'\n');writeFileSync('dist/SHA256SUMS',results.map(r=>`${r.sha256}  ${r.path.split('/').pop()}`).join('\n')+'\n');
console.log(JSON.stringify(results,null,2));

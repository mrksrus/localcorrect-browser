import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const provenance=JSON.parse(readFileSync('dictionary-sources.json','utf8'));
const lexical=JSON.parse(readFileSync('lexicon-sources.json','utf8'));
const typos=JSON.parse(readFileSync('typo-sources.json','utf8'));
const candidates=JSON.parse(readFileSync('candidate-sources.json','utf8'));
const ambiguity=JSON.parse(readFileSync('ambiguity-sources.json','utf8'));
const inflection=JSON.parse(readFileSync('inflection-sources.json','utf8'));
const protection=JSON.parse(readFileSync('protect-sources.json','utf8'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const results=[];
for(const browser of ['firefox','chrome']){
 const prefix=`build/${browser}/`;
 const m=JSON.parse(readFileSync(prefix+'manifest.json','utf8'));
 assert.equal(m.manifest_version,3);assert.equal(m.version,'0.9.0.5');assert.deepEqual(m.permissions,['activeTab','scripting','storage']);
 assert.equal(m.version_name,browser==='chrome'?'1.0.0-rc.5':undefined);
 assert.equal(m.host_permissions,undefined);assert.equal(m.content_scripts,undefined);
 assert.ok(browser==='firefox'?m.background.scripts.includes('background.js'):m.background.service_worker==='background.js');
 assert.ok(readFileSync(prefix+'background.js').length>1000);
 for(const lang of ['en','de'])assert.equal(createHash('sha256').update(readFileSync(prefix+`dictionaries/${lang}.txt`)).digest('hex'),provenance.sources[lang].output_sha256);
 assert.ok(readFileSync(prefix+'licenses/CC-BY-SA-4.0.txt','utf8').includes('Attribution-ShareAlike'));
 assert.ok(readFileSync(prefix+'LICENSE','utf8').includes('GNU GENERAL PUBLIC LICENSE'));
 assert.ok(readFileSync(prefix+'source/packages/core/src/index.js','utf8').includes('createCorrector'));
 for(const [name,source] of Object.entries(lexical.sources))for(const [file,hash] of Object.entries(source.files))assert.equal(createHash('sha256').update(readFileSync(prefix+`source/packages/core/vendor/${name}/${file}`)).digest('hex'),hash);
 for(const language of ['en','de']){
  const asset=await import(new URL(`../${prefix}source/packages/core/src/lexicons/${language}.js`,import.meta.url));
  const words=asset.default;
  const inventory=lexical.inventories[language];
  assert.equal(createHash('sha256').update(words).digest('hex'),inventory.expanded_sha256);
  assert.equal(words.split('\n').length,inventory.expanded_words);
  assert.equal(sha256(words),candidates.inventories[language].validitySha256);
  assert.equal(sha256(readFileSync(prefix+`dictionaries/${language}.txt`)),candidates.inventories[language].frequencySha256);
  if(language==='de'){
   assert.equal(createHash('sha256').update(asset.originalCasing).digest('hex'),lexical.inventories.deCased.expanded_sha256);
   assert.equal(asset.originalCasing.split('\n').length,lexical.inventories.deCased.expanded_words);
   assert.ok(asset.originalCasing.split('\n').every(word=>/^\p{Lu}/u.test(word)));
  }
 }
 assert.equal(createHash('sha256').update(readFileSync(prefix+'source/packages/core/src/typos.js')).digest('hex'),typos.assetSha256);
 for(const [file,manifest] of [['candidates.js',candidates],['protect-vocabulary.js',protection],['ambiguity-data.js',ambiguity],['inflection-data.js',inflection]])
  assert.equal(sha256(readFileSync(prefix+'source/packages/core/src/'+file)),manifest.assetSha256);
 for(const name of ['candidate-sources.json','protect-sources.json','ambiguity-sources.json','inflection-sources.json'])for(const dir of ['', 'source/', 'source/packages/core/'])
  assert.equal(sha256(readFileSync(prefix+dir+name)),sha256(readFileSync(name)));
 assert.equal(inflection.schemaVersion,1);
 assert.equal(readFileSync(prefix+'source/packages/core/src/inflection-data.js').length,inflection.assetBytes);
 for(const [file,hash]of Object.entries(inflection.inputs))assert.equal(sha256(readFileSync(prefix+'source/'+file)),hash,file);
 const inflectionAsset=(await import(new URL(`../${prefix}source/packages/core/src/inflection-data.js`,import.meta.url))).default;
 for(const [language,inventory]of Object.entries(inflection.inventories)){
  assert.equal(inflectionAsset[language].split('\n').length,inventory.forms);
  assert.equal(sha256(inflectionAsset[language]),inventory.inventorySha256);
 }
 if(browser==='firefox'){
  // Reproduce regional inventories as well as the merged output from the shipped compiler and sources.
  const {compileAssets}=await import(new URL(`../${prefix}source/scripts/inflection-eligibility.mjs`,import.meta.url));
  const compiled=await compileAssets();
  assert.equal(compiled.asset,readFileSync(prefix+'source/packages/core/src/inflection-data.js','utf8'));
  assert.equal(compiled.manifest,readFileSync(prefix+'inflection-sources.json','utf8'));
 }
 const ambiguityBytes=readFileSync(prefix+'source/packages/core/src/ambiguity-data.js');
 assert.equal(ambiguityBytes.length,ambiguity.assetBytes);
 const ambiguityAsset=(await import(new URL(`../${prefix}source/packages/core/src/ambiguity-data.js`,import.meta.url))).default;
 const ambiguityBinary=Buffer.from(ambiguityAsset.data,'base64');
 assert.equal(ambiguityBinary.length,ambiguity.decodedBytes);
 assert.equal(sha256(ambiguityBinary),ambiguity.binarySha256);
 for(const source of ambiguity.inputs)assert.equal(sha256(readFileSync(prefix+'source/'+source.file)),source.sha256,source.file);
 for(const [file,hash]of Object.entries(ambiguity.upstreamManifests))for(const dir of ['', 'source/', 'source/packages/core/'])
  assert.equal(sha256(readFileSync(prefix+dir+file)),hash,file);
 const protectiveVendor=prefix+'source/packages/core/vendor/protect-vocabulary/';
 assert.deepEqual(JSON.parse(readFileSync(protectiveVendor+'sources.json','utf8')),protection.source);
 for(const source of protection.source.sources){
  const bytes=readFileSync(protectiveVendor+source.file);
  assert.equal(bytes.length,source.bytes,source.file);assert.equal(sha256(bytes),source.sha256,source.file);
 }
 for(const [file,copy,title] of [['software-terms--LICENSE','cspell-software-terms-LICENSE','MIT License'],['people-names--LICENSE','cspell-people-names-LICENSE','MIT License'],['homebrew--LICENSE.txt','homebrew-core-LICENSE','BSD 2-Clause License']]){
  const original=readFileSync(protectiveVendor+file);
  assert.ok(original.toString('utf8').includes(title));
  for(const dir of ['licenses/','source/licenses/','source/packages/core/licenses/'])
   assert.equal(sha256(readFileSync(prefix+dir+copy)),sha256(original));
 }
 for(const [name,file] of [['codespell','codespell.txt'],['litkey','litkey-pairs.tsv']])assert.equal(createHash('sha256').update(readFileSync(prefix+'source/packages/core/vendor/typo-data/'+file)).digest('hex'),typos.inputSha256[name]);
 for(const name of ['CC-BY-SA-3.0.html','CC-BY-SA-4.0.html'])assert.ok(readFileSync(prefix+'source/packages/core/vendor/typo-data/'+name).length>40000);
 for(const name of ['dictionary-en','dictionary-en-gb','dictionary-de','dictionary-de-at','nspell','is-buffer'])assert.ok(readFileSync(prefix+`licenses/${name}-LICENSE`).length>500);
 const path=`dist/localcorrect-${browser}-1.0.0-rc.5.zip`;
 const entries=JSON.parse(execFileSync('python',['-c',`import json,pathlib,zipfile\np=pathlib.Path('${prefix}')\nwith zipfile.ZipFile('${path}') as z:\n assert z.testzip() is None\n files={f.relative_to(p).as_posix():f for f in p.rglob('*') if f.is_file()}\n assert set(z.namelist())==set(files), 'Archive inventory differs from verified build'\n for name,f in files.items():\n  assert z.read(name)==f.read_bytes(), name+' differs from verified build'\n print(json.dumps(z.namelist()))`],{encoding:'utf8'}));
 for(const name of ['manifest.json','dictionaries/en.txt','dictionaries/de.txt','LICENSE','THIRD_PARTY.md','licenses/CC-BY-SA-4.0.txt','source/scripts/build.mjs','source/scripts/lexicons.mjs','lexicon-sources.json','source/packages/core/src/lexicons/en.js','source/packages/core/src/lexicons/de.js','source/packages/core/src/lexicons/nspell.js'])assert.ok(entries.includes(name));
 for(const name of ['candidate-sources.json','protect-sources.json','source/scripts/candidates.mjs','source/scripts/protect-vocabulary.mjs','source/packages/core/src/candidates.js','source/packages/core/src/candidate-lookup.js','source/packages/core/src/protect-vocabulary.js','source/tests/coverage.test.mjs','licenses/cspell-software-terms-LICENSE','licenses/cspell-people-names-LICENSE','licenses/homebrew-core-LICENSE','ambiguity-sources.json','source/scripts/ambiguity-lexicon.mjs','source/packages/core/src/ambiguity-data.js','source/packages/core/src/ambiguity-lookup.js','source/tests/ambiguity.test.mjs','inflection-sources.json','source/scripts/inflection-eligibility.mjs','source/packages/core/src/inflection-data.js','source/tests/inflection.test.mjs'])assert.ok(entries.includes(name),name);
 results.push({path,sha256:sha256(readFileSync(path)),entries:entries.length,bytes:readFileSync(path).length});
}
mkdirSync('test-results',{recursive:true});writeFileSync('test-results/packages.json',JSON.stringify(results,null,2)+'\n');writeFileSync('dist/SHA256SUMS',results.map(r=>`${r.sha256}  ${r.path.split('/').pop()}`).join('\n')+'\n');
console.log(JSON.stringify(results,null,2));

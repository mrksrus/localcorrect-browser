import {build} from 'esbuild';
import {mkdir,rm,cp,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from'node:assert/strict';
import contextMetadata from'../packages/core/src/context-encoder-data.js';
const root = new URL('../', import.meta.url);
process.chdir(root.pathname);
await rm('build',{recursive:true,force:true});
await mkdir('build',{recursive:true}); await mkdir('dist',{recursive:true});
for (const name of ['LICENSE','THIRD_PARTY.md','dictionary-sources.json','lexicon-sources.json','typo-sources.json','candidate-sources.json','protect-sources.json','ambiguity-sources.json','inflection-sources.json','context-data-sources.json','context-wikipedia-sources.json','context-pretrained-sources.json','context-model-sources.json']) await cp(name,`packages/core/${name}`);
for (const name of ['software-terms','people-names']) await cp(`packages/core/vendor/protect-vocabulary/${name}--LICENSE`,`licenses/cspell-${name}-LICENSE`);
await cp('packages/core/vendor/protect-vocabulary/homebrew--LICENSE.txt','licenses/homebrew-core-LICENSE');
await cp('licenses','packages/core/licenses',{recursive:true});
await build({entryPoints:['extension/target.js'],outfile:'build/target.js',bundle:true,format:'iife',target:['chrome120','firefox121'],legalComments:'inline'});
await build({entryPoints:['extension/background.js'],outfile:'build/background.js',bundle:true,format:'iife',target:['chrome120','firefox140'],legalComments:'inline',define:{'import.meta.url':'undefined'}});
const {contextIdentity}=await import('../packages/core/src/index.js');
const identity=contextIdentity(),modelPath='packages/core/models/context-encoder.onnx';
const modelBytes=await readFile(modelPath),wasmPath='node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm';
const wasmBytes=await readFile(wasmPath),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
if(digest(modelBytes)!==identity.modelSha256)throw new Error('Contextual model does not match the tested core identity.');
const metadataBytes=await readFile('packages/core/models/context-encoder-metadata.json');
if(digest(metadataBytes)!==identity.metadataSha256)throw new Error('Contextual metadata identity mismatch.');
const {metadataSha256,...embeddedMetadata}=contextMetadata;
assert.deepEqual(embeddedMetadata,JSON.parse(metadataBytes),'Embedded encoder metadata differs from its pinned source');
if(digest(wasmBytes)!=='4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d')throw new Error('ONNX Runtime Web 1.31.1 WASM integrity mismatch.');
const base = {manifest_version:3,name:'LocalCorrect',version:'0.9.0.6',version_name:'1.0.0-rc.6',description:'Offline German and English typo correction for selected text or focused editable fields. Release candidate.',permissions:['activeTab','scripting','storage'],action:{default_popup:'popup.html',default_title:'LocalCorrect'},options_ui:{page:'options.html',open_in_tab:true},commands:{'correct-text':{suggested_key:{default:'Alt+Shift+C'},description:'Correct selected text or the focused field'},'undo-correction':{suggested_key:{default:'Alt+Shift+Z'},description:'Undo the last LocalCorrect change'}},content_security_policy:{extension_pages:"script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self'"}};
for (const browser of ['firefox','chrome']) {
  const dir=`build/${browser}`; await mkdir(dir,{recursive:true});
  for(const name of ['popup.html','popup.js','popup.css','options.html','options.js','settings.js'])await cp(`extension/${name}`,`${dir}/${name}`);
  await cp('build/background.js',`${dir}/background.js`);
  await cp('build/target.js',`${dir}/target.js`);
  await mkdir(`${dir}/runtime`,{recursive:true});await cp(wasmPath,`${dir}/runtime/ort-wasm-simd-threaded.wasm`);
  await mkdir(`${dir}/context-model`,{recursive:true});await cp(modelPath,`${dir}/context-model/context-encoder.onnx`);
  await cp('packages/core/dictionaries',`${dir}/dictionaries`,{recursive:true});
  await cp('licenses',`${dir}/licenses`,{recursive:true});
  for(const name of ['LICENSE','THIRD_PARTY.md','README.md','USAGE.md','QUALITY.md','SECURITY.md','RELEASE_NOTES.md','PROJECT-PREFERENCES.md','dictionary-sources.json','lexicon-sources.json','typo-sources.json','candidate-sources.json','protect-sources.json','ambiguity-sources.json','inflection-sources.json','context-data-sources.json','context-wikipedia-sources.json','context-pretrained-sources.json','context-model-sources.json','MODEL.md','context-requirements-lock.txt','EVALUATION.json','evaluation-freeze.json'])await cp(name,`${dir}/${name}`);
  // Ship corresponding original source and build recipe, not just a minified bundle.
  await cp('benchmarks',`${dir}/benchmarks`,{recursive:true});
  for(const name of ['extension','packages','scripts','tests','licenses','benchmarks'])await cp(name,`${dir}/source/${name}`,{recursive:true,filter:source=>!source.split('/').some(part=>part==='__pycache__'||part==='node_modules'||part==='work')&&!source.endsWith('.pyc')});
  for(const name of ['package.json','package-lock.json','LICENSE','THIRD_PARTY.md','README.md','USAGE.md','QUALITY.md','SECURITY.md','RELEASE_NOTES.md','PROJECT-PREFERENCES.md','dictionary-sources.json','lexicon-sources.json','typo-sources.json','candidate-sources.json','protect-sources.json','ambiguity-sources.json','inflection-sources.json','context-data-sources.json','context-wikipedia-sources.json','context-pretrained-sources.json','context-model-sources.json','MODEL.md','context-requirements-lock.txt','EVALUATION.json','evaluation-freeze.json'])await cp(name,`${dir}/source/${name}`);
  const manifest=structuredClone(base);
  if(browser==='firefox') {
    delete manifest.version_name;
    manifest.browser_specific_settings={gecko:{id:'localcorrect@localcorrect.invalid',strict_min_version:'140.0',data_collection_permissions:{required:['none']}}};
    manifest.background={scripts:['background.js']};
  } else {manifest.minimum_chrome_version='120';manifest.background={service_worker:'background.js'};}
  await writeFile(`${dir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
  const zip=`dist/localcorrect-${browser}-1.0.0-rc.6.zip`;
  await rm(zip,{force:true});
  // Sorted archive entries and a fixed timestamp make builds reproducible.
  execFileSync('python',['-c',`import pathlib,zipfile\np=pathlib.Path('${dir}')\nwith zipfile.ZipFile('${zip}','w',zipfile.ZIP_DEFLATED) as z:\n for f in sorted(p.rglob('*')):\n  if f.is_file():\n   i=zipfile.ZipInfo(f.relative_to(p).as_posix(),(2026,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,f.read_bytes())`]);
  console.log(zip);
}

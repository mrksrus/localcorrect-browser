import {build} from 'esbuild';
import {mkdir,rm,cp,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const root = new URL('../', import.meta.url);
process.chdir(root.pathname);
await rm('build',{recursive:true,force:true});
await mkdir('build',{recursive:true}); await mkdir('dist',{recursive:true});
for (const name of ['LICENSE','THIRD_PARTY.md','dictionary-sources.json']) await cp(name,`packages/core/${name}`);
await cp('licenses','packages/core/licenses',{recursive:true});
await build({entryPoints:['extension/target.js'],outfile:'build/target.js',bundle:true,format:'iife',target:['chrome120','firefox121'],legalComments:'inline'});
const base = {manifest_version:3,name:'LocalCorrect',version:'0.9.0.1',version_name:'1.0.0-rc.1',description:'Offline German and English typo correction for selected text or focused editable fields. Release candidate.',permissions:['activeTab','scripting'],action:{default_popup:'popup.html',default_title:'LocalCorrect'},content_security_policy:{extension_pages:"script-src 'self'; object-src 'none'; connect-src 'self'"}};
for (const browser of ['firefox','chrome']) {
  const dir=`build/${browser}`; await mkdir(dir,{recursive:true});
  for(const name of ['popup.html','popup.js','popup.css'])await cp(`extension/${name}`,`${dir}/${name}`);
  await cp('build/target.js',`${dir}/target.js`);
  await cp('packages/core/dictionaries',`${dir}/dictionaries`,{recursive:true});
  await cp('licenses',`${dir}/licenses`,{recursive:true});
  for(const name of ['LICENSE','THIRD_PARTY.md','README.md','SECURITY.md','RELEASE_NOTES.md','dictionary-sources.json'])await cp(name,`${dir}/${name}`);
  // Ship corresponding original source and build recipe, not just a minified bundle.
  for(const name of ['extension','packages','scripts','tests','licenses'])await cp(name,`${dir}/source/${name}`,{recursive:true});
  for(const name of ['package.json','package-lock.json','LICENSE','THIRD_PARTY.md','README.md','SECURITY.md','RELEASE_NOTES.md','dictionary-sources.json'])await cp(name,`${dir}/source/${name}`);
  const manifest=structuredClone(base);
  if(browser==='firefox') {
    delete manifest.version_name;
    manifest.browser_specific_settings={gecko:{id:'localcorrect@localcorrect.invalid',strict_min_version:'140.0',data_collection_permissions:{required:['none']}}};
  } else manifest.minimum_chrome_version='120';
  await writeFile(`${dir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
  const zip=`dist/localcorrect-${browser}-1.0.0-rc.1.zip`;
  await rm(zip,{force:true});
  // Sorted archive entries and a fixed timestamp make builds reproducible.
  execFileSync('python',['-c',`import pathlib,zipfile\np=pathlib.Path('${dir}')\nwith zipfile.ZipFile('${zip}','w',zipfile.ZIP_DEFLATED) as z:\n for f in sorted(p.rglob('*')):\n  if f.is_file():\n   i=zipfile.ZipInfo(f.relative_to(p).as_posix(),(2026,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,f.read_bytes())`]);
  console.log(zip);
}

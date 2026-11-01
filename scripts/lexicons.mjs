// Rebuild offline lexical assets from exact npm lockfile inputs. No network here.
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import nspell from 'nspell';
const sha = text => createHash('sha256').update(text).digest('hex');
const base='packages/core';
mkdirSync(`${base}/src/lexicons`,{recursive:true});
mkdirSync(`${base}/vendor`,{recursive:true});
const provenance={description:'Unmodified npm Hunspell sources; German GPL-3.0 option selected. Expanded by nspell only for validity/casing, never suggestions.',sources:{}};
const lock=JSON.parse(readFileSync('package-lock.json'));
for(const name of ['nspell','is-buffer','dictionary-en','dictionary-de']){
 const source=`node_modules/${name}`;
 cpSync(source,`${base}/vendor/${name}`,{recursive:true});
 const files={};
 for(const file of name.startsWith('dictionary-')?['index.aff','index.dic','license']:name==='nspell'?['license']:['LICENSE']) files[file]=sha(readFileSync(`${source}/${file}`));
 provenance.sources[name]={version:JSON.parse(readFileSync(`${source}/package.json`)).version,...lock.packages[source],files};
 const license=name==='is-buffer'?'LICENSE':'license';
 cpSync(`${source}/${license}`,`licenses/${name}-LICENSE`);
 if(name.startsWith('dictionary-')){
  const language=name.slice(-2),aff=readFileSync(`${source}/index.aff`,'utf8'),dic=readFileSync(`${source}/index.dic`,'utf8');
  const spelling=nspell(aff,dic), words=new Set();
  for(const word of Object.keys(spelling.data)){
   if(!/^\p{L}{2,32}$/u.test(word))continue;
   if(spelling.correct(word))words.add(word);
   const capital=word[0].toLocaleUpperCase()+word.slice(1);
   if(spelling.correct(capital))words.add(capital);
  }
  const text=[...words].sort().join('\n');
  writeFileSync(`${base}/src/lexicons/${language}.js`,`// Generated affix-expanded validity/casing inventory; see vendor/${name}/license.\nexport default ${JSON.stringify(text)};\n`);
  provenance.sources[name].expanded_words=words.size;
  provenance.sources[name].expanded_sha256=sha(text);
 }
}
await build({entryPoints:[`${base}/vendor/nspell/lib/index.js`],outfile:`${base}/src/lexicons/nspell.js`,bundle:true,format:'esm',platform:'browser',legalComments:'inline'});
writeFileSync('lexicon-sources.json',JSON.stringify(provenance,null,2)+'\n');
cpSync('lexicon-sources.json',`${base}/lexicon-sources.json`);
console.log('Bundled offline nspell and EN/DE affix/dictionary assets with source and hashes.');

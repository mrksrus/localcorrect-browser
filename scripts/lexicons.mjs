// Rebuild offline lexical assets from exact npm lockfile inputs. No network here.
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import nspell from 'nspell';
const sha = text => createHash('sha256').update(text).digest('hex');
const base='packages/core';
mkdirSync(`${base}/src/lexicons`,{recursive:true});
mkdirSync(`${base}/vendor`,{recursive:true});
const provenance={description:'Unmodified npm Hunspell sources; German GPL-3.0 option selected. Expanded using nspell membership and affix data. Inventories validate words and LocalCorrect edit probes; nspell suggestions are never called. EN merges US/GB; DE merges DE/AT.',sources:{},inventories:{}};
const inventories={en:new Set(),de:new Set()},inputs={en:[],de:[]},originalCasing=new Set();
const lock=JSON.parse(readFileSync('package-lock.json'));
for(const name of ['nspell','is-buffer','dictionary-en','dictionary-en-gb','dictionary-de','dictionary-de-at']){
 const source=`node_modules/${name}`;
 cpSync(source,`${base}/vendor/${name}`,{recursive:true});
 const files={};
 for(const file of name.startsWith('dictionary-')?['index.aff','index.dic','license']:name==='nspell'?['license']:['LICENSE']) files[file]=sha(readFileSync(`${source}/${file}`));
 provenance.sources[name]={version:JSON.parse(readFileSync(`${source}/package.json`)).version,...lock.packages[source],files};
 const license=name==='is-buffer'?'LICENSE':'license';
 cpSync(`${source}/${license}`,`licenses/${name}-LICENSE`);
 if(name.startsWith('dictionary-')){
  const language=name.startsWith('dictionary-en')?'en':'de',aff=readFileSync(`${source}/index.aff`,'utf8'),dic=readFileSync(`${source}/index.dic`,'utf8');
  const spelling=nspell(aff,dic), words=new Set();
  for(const word of Object.keys(spelling.data)){
   if(!/^\p{L}{2,32}$/u.test(word))continue;
   if(spelling.correct(word))words.add(word);
   if(language==='de' && /^\p{Lu}/u.test(word) && spelling.correct(word))originalCasing.add(word);
   const capital=word[0].toLocaleUpperCase()+word.slice(1);
   if(spelling.correct(capital))words.add(capital);
  }
  const text=[...words].sort().join('\n');
  provenance.sources[name].expanded_words=words.size;
  provenance.sources[name].expanded_sha256=sha(text);
  for(const word of words)inventories[language].add(word);
  inputs[language].push(name);
 }
}
for(const language of ['en','de']){
 const text=[...inventories[language]].sort().join('\n');
 provenance.inventories[language]={inputs:inputs[language],expanded_words:inventories[language].size,expanded_sha256:sha(text)};
 const cased=[...originalCasing].sort().join('\n');
 if(language==='de')provenance.inventories.deCased={inputs:inputs.de,expanded_words:originalCasing.size,expanded_sha256:sha(cased),description:'Accepted entries originally capitalized in the source expansion, before automatic initial-capital acceptance. This is casing evidence, not a complete POS tagger.'};
 writeFileSync(`${base}/src/lexicons/${language}.js`,`// Generated regional affix-expanded inventory; see lexicon-sources.json and vendor dictionary licenses.\nexport default ${JSON.stringify(text)};\n`+(language==='de'?`export const originalCasing = ${JSON.stringify(cased)};\n`:''));
}
await build({entryPoints:[`${base}/vendor/nspell/lib/index.js`],outfile:`${base}/src/lexicons/nspell.js`,bundle:true,format:'esm',platform:'browser',legalComments:'inline'});
writeFileSync('lexicon-sources.json',JSON.stringify(provenance,null,2)+'\n');
cpSync('lexicon-sources.json',`${base}/lexicon-sources.json`);
console.log('Bundled offline nspell and EN/DE affix/dictionary assets with source and hashes.');

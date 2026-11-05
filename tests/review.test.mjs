import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,cpSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCorrector} from '../packages/core/src/index.js';

import enLexicon from '../packages/core/src/lexicons/en.js';
import deLexicon from '../packages/core/src/lexicons/de.js';
const dict=Object.fromEntries(['en','de'].map(l=>[l,readFileSync(`packages/core/dictionaries/${l}.txt`,'utf8')]));
const c=createCorrector(dict), modes=['balanced','conservative'];
const correct=(input,language,mode)=>c.correct(input,{language,mode});
test('R1 broad lexical validity beyond frequency list, including inflections',()=>{
 const fixtures={en:['This prerelease includes telemetry protections.','The engineers documented recalibrations and decentralizations.'],de:['Die Bestätigungen werden morgen versendet.','Wir betrachteten die Veränderungen und Möglichkeiten.']};
 for(const mode of modes)for(const language of ['en','de'])for(const input of fixtures[language])assert.equal(correct(input,language,mode).text,input);
 for(const [language,source] of Object.entries({en:enLexicon,de:deLexicon})){
  const frequency=new Set(dict[language].split('\n').map(x=>x.split(' ')[0]));
  const outside=source.split('\n').filter(w=>/^\p{Ll}{5,20}$/u.test(w)&&!frequency.has(w));
  assert.ok(outside.length>10000,`${language} broad expanded vocabulary`);
  // Evenly sample the entire expanded lexicon, not handpicked regression words.
  const selected=Array.from({length:400},(_,i)=>outside[Math.floor(i*outside.length/400)]);
  const input=selected.join(' ');
  for(const mode of modes)assert.equal(correct(input,language,mode).text,input);
 }
});
test('missing mandatory lexical asset fails closed, never frequency-only fallback',()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR||tmpdir(),'localcorrect-missing-'));
 try{
  cpSync('packages/core/src/index.js',join(dir,'index.mjs'));
  for (const name of ['typos.js', 'candidate-lookup.js', 'candidates.js', 'protect-vocabulary.js', 'ambiguity-lookup.js', 'ambiguity-data.js', 'inflection-data.js'])
   cpSync(new URL(`../packages/core/src/${name}`, import.meta.url), join(dir, name));
  writeFileSync(join(dir,'package.json'),'{"type":"module"}');
  assert.throws(()=>execFileSync(process.execPath,['--input-type=module','-e',`import ${JSON.stringify(join(dir,'index.mjs'))}`],{stdio:'pipe'}),error=>/ERR_MODULE_NOT_FOUND/.test(error.stderr.toString())&&error.stderr.toString().includes('lexicons/en.js'));
  mkdirSync(join(dir,'lexicons'));
  for(const language of ['en','de'])writeFileSync(join(dir,'lexicons',`${language}.js`),'export default "";');
  const probe=`import {createCorrector} from ${JSON.stringify(join(dir,'index.mjs'))};createCorrector({en:'protection 10000',de:'verwendet 10000'}).correct('protections',{language:'en'});`;
  assert.throws(()=>execFileSync(process.execPath,['--input-type=module','-e',probe],{stdio:'pipe'}),error=>error.stderr.toString().includes('Bundled spelling-validity lexicon unavailable'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('R3/R4 names, short operations, dotted files and noun sentences',()=>{
 const safe={en:['Alyce','Harriett','Conners','Hasting','Wiesner','Meriel'].map(n=>`${n} will send a message.`).concat(['The proposed filename is recieve.txt.','Use teh.md and nested.recieve.txt.']),de:['Frau Wiesenbrück und Herr Quendelbach kommen morgen.','Wiesner kommt morgen.','Meriel kommt morgen.']};
 for(const mode of modes){
  for(const [language,rows] of Object.entries(safe))for(const input of rows)assert.equal(correct(input,language,mode).text,input);
  assert.equal(correct('Please send teh document tomorrow.','en',mode).text,'Please send the document tomorrow.');
  assert.equal(correct('Please check the adress carefully.','en',mode).text,'Please check the adress carefully.');
  for(const word of ['yu','hteq','zzq','qwe'])assert.equal(correct(word,'en',mode).text,word);
 }
});
test('published full-sentence regression: exact spans, safe preservation and honest metrics',()=>{
 const cases=JSON.parse(readFileSync('tests/acceptance.json')).cases,metrics={};
 for(const mode of modes){
  const rows=cases.map(row=>{
   const result=correct(row.input,row.language,mode);let reconstructed=row.input;
   for(const e of [...result.edits].reverse()){
    assert.equal(row.input.slice(e.offset,e.offset+e.length),e.original);
    reconstructed=reconstructed.slice(0,e.offset)+e.replacement+reconstructed.slice(e.offset+e.length);
   }
   assert.equal(reconstructed,result.text);
   return {...row,actual:result.text,pass:result.text===(row.expected??row.input),edits:result.edits.length};
  });
  const summary={};for(const language of ['en','de'])for(const kind of ['correction','required-safe','exploratory']){
   const group=rows.filter(x=>x.language===language&&x.kind===kind);summary[`${language}:${kind}`]={passed:group.filter(x=>x.pass).length,total:group.length};
  }
  assert.equal(rows.filter(x=>x.kind==='required-safe'&&x.pass).length,16);
  // Published single-typo cases permit abstention, never a third interpretation.
  // Main-corpus coverage and whole-document improvement have stronger scale gates.
  for(const row of rows.filter(x=>x.kind==='correction'))assert.ok(row.pass||row.actual===row.input, 'An ambiguous typo may stay unchanged, but cannot receive an unwanted edit.');
  for(const language of ['en','de'])assert.ok(summary[language+':correction'].passed>0, 'Useful correction in each language');
  metrics[mode]={summary,rows};
 }
 mkdirSync('test-results',{recursive:true});writeFileSync('test-results/sentence-quality.json',JSON.stringify(metrics,null,2)+'\n');
 console.log('Independent sentence metrics',JSON.stringify(Object.fromEntries(Object.entries(metrics).map(([mode,v])=>[mode,v.summary]))));
});

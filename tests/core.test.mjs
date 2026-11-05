import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createCorrector,editDistance} from '../packages/core/src/index.js';
const dict=Object.fromEntries(['en','de'].map(l=>[l,readFileSync(new URL(`../packages/core/dictionaries/${l}.txt`,import.meta.url),'utf8')]));
const c=createCorrector(dict);
const run=(text,language='en',mode='balanced')=>c.correct(text,{language,mode});
const quality={
 en:[['recieve','receive'],['seperate','separate'],['definately','definitely'],['accomodate','accommodate'],['teh','the'],['thsi','this'],['becuase','because'],['occured','occurred'],['untill','until'],['adress','address'],['freind','friend'],['wierd','weird'],['tomorow','tomorrow'],['mesage','message'],['importantt','important'],['quikc','quick'],['exampel','example'],['correctoin','correction'],['langauge','language'],['browesr','browser'],['offlinee','offline']],
 de:[['halllo','hallo'],['rechtschreibugn','rechtschreibung'],['nachrciht','nachricht'],['freudn','freund'],['shcreiben','schreiben'],['deutshc','deutsch'],['besipiel','beispiel'],['morgne','morgen'],['einfahc','einfach'],['arbeietn','arbeiten'],['freundlih','freundlich'],['dankee','danke'],['sprcahe','sprache'],['korrigiern','korrigieren']]
};
const unchanged={
 en:['Please send the message tomorrow.','The quick brown fox jumps over the lazy dog.','We received your important information.','Alice and Zephyr visited Vienna.','user@example.com https://example.com/recieve?id=12','Order AX-1234 has 12.50 units.','myRecieveFunction customer_id file_name.txt','  Keep\tthese\nspaces.  ','> recieve seperate\n-- \nrecieve seperate','On Tuesday Alice wrote:\nrecieve seperate','Use `recieve` in the example.','Hello! Thank you for your help.','NASA API UUID XMLHttpRequest','I have a friend who works offline.','A separate example is definitely useful.'],
 de:['Bitte senden Sie die Nachricht morgen.','Vielen Dank für Ihre Hilfe.','Die schnelle Antwort ist wichtig.','Anna und Zephyr besuchen Wien.','user@example.de https://example.de/nachrciht','Bestellung DE-1234 kostet 12,50 Euro.','  Bitte\tdiese\nAbstände erhalten.  ','> nachrciht besipiel\n-- \nnachrciht','Am Dienstag schrieb Anna:\nnachrciht','Das ist ein einfaches Beispiel.','Wir arbeiten heute zusammen.','Freundliche Grüße','E-Mail und Telefonnummer bleiben gleich.','Die Sprache ist Deutsch.','Das Programm funktioniert offline.']
};
test('original UTF-16 spans exactly reconstruct output; case/whitespace',()=>{
 const input='😀  SEPERATE\timportantt\nseperate.';const r=run(input);assert.ok(r.edits.length>=2);assert.equal(r.edits[0].offset,4);assert.equal(r.edits[0].replacement,'SEPARATE');
 let pos=0,out='';for(const e of r.edits){assert.ok(e.offset>=pos);assert.equal(input.slice(e.offset,e.offset+e.length),e.original);out+=input.slice(pos,e.offset)+e.replacement;pos=e.offset+e.length;}out+=input.slice(pos);assert.equal(out,r.text);assert.ok(r.text.includes('\t'));assert.ok(r.text.includes('\n'));
});
test('algorithm validates real edit distance, transposition and non-neighbors',()=>{
 assert.equal(editDistance('recieve','receive'),1);assert.equal(editDistance('abcdef','abcfed'),2);assert.ok(editDistance('hello','world')>2);
 const tiny=createCorrector({en:'separate 10000\nfriend 20000\n',de:'beispiel 10000\n'});assert.equal(tiny.correct('seperate',{language:'en',mode:'balanced'}).text,'separate');assert.equal(tiny.correct('zzzzzz',{language:'en',mode:'balanced'}).text,'zzzzzz');
});
test('input validation and bounded work',()=>{
 assert.throws(()=>run('x'.repeat(20001)),RangeError);assert.throws(()=>run('word '.repeat(3001)),RangeError);assert.throws(()=>c.correct('hi',{language:'fr'}),RangeError);assert.throws(()=>c.correct('hi',{mode:'reckless'}),RangeError);assert.throws(()=>c.correct(1),TypeError);assert.throws(()=>createCorrector({en:'',de:''}),TypeError);
});
test('ambiguity refuses similar-frequency candidates; unknown titlecase names protected',()=>{
 const tiny=createCorrector({en:'receive 10000\nrecipe 9000\nfriend 10000\nfried 9999\n',de:'beispiel 10000\n'});
 assert.equal(tiny.correct('frien',{language:'en',mode:'balanced'}).text,'frien');assert.equal(run('Dear Recieve, hello.').text,'Dear Recieve, hello.');
});
test('unchanged-text regression and quality metrics (synthetic, not general accuracy)',()=>{
 const metrics={};
 for(const lang of ['en','de']){
  const results=quality[lang].map(([input,expected])=>({input,expected,actual:run(input,lang).text}));
  const correct=results.filter(r=>r.actual===r.expected).length;
  for(const row of results)assert.ok(row.actual===row.input||row.actual===row.expected,'No wrong replacements in the small regression set');
  const unchangedResults=unchanged[lang].map(input=>({input,actual:run(input,lang).text}));
  const preserved=unchangedResults.filter(r=>r.input===r.actual).length;
  metrics[lang]={mode:'balanced',correct,total:results.length,recall:correct/results.length,unchangedPreserved:preserved,unchangedTotal:unchangedResults.length,misses:results.filter(r=>r.actual!==r.expected),regressions:unchangedResults.filter(r=>r.input!==r.actual)};
  const conservativeResults=quality[lang].map(([input,expected])=>({input,expected,actual:run(input,lang,'conservative').text}));
  const conservativePreserved=unchanged[lang].filter(input=>run(input,lang,'conservative').text===input).length;
  metrics[lang].conservative={correct:conservativeResults.filter(r=>r.actual===r.expected).length,total:conservativeResults.length,unchangedPreserved:conservativePreserved,unchangedTotal:unchanged[lang].length,misses:conservativeResults.filter(r=>r.actual!==r.expected)};
  assert.equal(conservativePreserved,unchanged[lang].length);
  // Ambiguous isolated words may now abstain under the bilingual policy.
  // Keep every miss visible; tests/scale-check enforces the RC4 whole-corpus floor.
  for(const row of [...results,...conservativeResults])assert.ok(row.actual===row.input||row.actual===row.expected,JSON.stringify(row));
  assert.ok(correct>0,JSON.stringify(metrics[lang]));assert.equal(preserved,unchangedResults.length,JSON.stringify(metrics[lang]));
 }
 mkdirSync('test-results',{recursive:true});writeFileSync('test-results/core-quality.json',JSON.stringify(metrics,null,2)+'\n');console.log(JSON.stringify(metrics));
});
test('random synthetic surrounds are preserved outside edit spans',()=>{
 for(let n=0;n<80;n++){
  const input=`${' '.repeat(n%8)}😀${n} | recieve\tseperate\n> recieve\n-- \nseperate`;
  const r=run(input);let output=input;for(const e of [...r.edits].reverse())output=output.slice(0,e.offset)+e.replacement+output.slice(e.offset+e.length);assert.equal(r.text,output);assert.ok(r.text.endsWith('> recieve\n-- \nseperate'));
 }
});

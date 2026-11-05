import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createCorrector}from'../packages/core/src/index.js';
const c=createCorrector(Object.fromEntries(['en','de'].map(l=>[l,readFileSync(`packages/core/dictionaries/${l}.txt`,'utf8')])));
test('unique one-edit keyboard and extra-letter repairs work beyond pre-enumerated typos',()=>{
 for(const [language,input,expected] of [
 ['en','Please check the delivwry.','Please check the delivery.'],
 ['en','The equipmrnt is ready.','The equipment is ready.'],
 ['de','Wir prüfen die Versicgerung.','Wir prüfen die Versicherung.'],
 ])assert.equal(c.correct(input,{language}).text,expected);
});
test('competing interpretations and literal identifiers remain untouched',()=>{
 for(const [language,input]of [['en','The bird is acive.'],['de','Der Antrag wurde angeommen.'],['en','Use `delivwry` and delivery_id unchanged.'],['en','Dear Delivwry, hello.']])assert.equal(c.correct(input,{language}).text,input);
});

test('short technical words, existing umlauts and implausible prefix deletions stay intact',()=>{
 for(const [language,input]of [['en','The job succeeded through rsync.'],['de','Der Küfer arbeitet an einem Fass.'],['de','Die Übericht bleibt unverändert.'],['de','Unsere Gästin kommt morgen.']])assert.equal(c.correct(input,{language}).text,input);
});
test('ordinary possessives admit unique German noun repairs without changing nearby names',()=>{
 for(const [input,expected]of [['Mein Kolllege kommt später.','Mein Kollege kommt später.']])assert.equal(c.correct(input,{language:'de'}).text,expected);
 assert.equal(c.correct('Unser Nachbar Herr Weimer kommt später.',{language:'de'}).text,'Unser Nachbar Herr Weimer kommt später.');
});
test('subtitle occurrence alone does not veto a validated spelling repair',()=>{
 assert.equal(c.correct('Ich bringe den Schlüssel zuruck.',{language:'de'}).text,'Ich bringe den Schlüssel zurück.');
});
test('rare valid interpretations and provenance-backed terms block speculative edits',()=>{
 for(const [language,input]of [['en','We discussed the abdictions of the two kings.'],['en','The school recorded three absencs this week.'],['en','This is an acrual accounting system.'],['en','He was aborred by everyone.'],['en','She achives her goals.'],['en','The surgeon will ablase the tissue.'],['en','She is a proud alumnk of the college.'],['en','The two alchemistr worked together.'],['en','Please use upsert for this database operation.'],['en','The fuzzer found a crash.'],['en','The hatchling is healthy.'],['en','We use ollama today.'],['en','We deployed valkey yesterday.'],['en','Run the fuzzers overnight.'],['de','Wir starten containerd auf diesem Rechner.'],['de','Das Schloß ist auf dem Bild zu erkennen.'],['de','Ich habe den Patrik gefragt.'],['de','Wir haben Jaqueline eingeladen.']])assert.equal(c.correct(input,{language}).text,input);
});

test('repeated repairs reuse ambiguity evidence within one call',()=>{const input=Array(100).fill('delivwry').join(' ');assert.equal(c.correct(input,{language:'en'}).edits.length,100);});

test('source-derived competing interpretations stay unchanged',()=>{
 for(const row of JSON.parse(readFileSync('tests/ambiguity-regression.json','utf8')).cases)assert.equal(c.correct(row.input,{language:row.language}).text,row.expected,row.original);
});

test('foreign diacritics protect uncertain neighboring phrases without literal phrase rules',()=>{
 for(const input of ['The speaker explains the ancien régime today.','The stage direction says tres bientôt here.','We keep a plain resume beside the résumé.'])assert.equal(c.correct(input,{language:'en'}).text,input);
});
test('plural noun repairs account for competing two-edit interpretations',()=>{
 assert.equal(c.correct('We kept the purchase recieps in a folder.',{language:'en'}).text,'We kept the purchase recieps in a folder.');
});

test('independently authored technical and natural-history terms stay unchanged',()=>{
 for(const row of JSON.parse(readFileSync('tests/preservation-regression.json','utf8')).cases)assert.equal(c.correct(row.input,{language:row.language}).text,row.expected,row.input);
});

test('unverified English words cannot be repaired into proper-name-only targets',()=>{
 for(const input of ['The sign carries the Welsh phrase Croeso cynnes.','Please keep cynnes as written on the venue sheet.'])assert.equal(c.correct(input,{language:'en'}).text,input);
 assert.equal(c.correct('Please check the delivwry.',{language:'en'}).text,'Please check the delivery.');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCorrector} from '../packages/core/src/index.js';
const corrector=createCorrector(Object.fromEntries(['en','de'].map(l=>[l,readFileSync(`packages/core/dictionaries/${l}.txt`,'utf8')])));
test('complete email preserves reply and signature tails across LF, CRLF and CR paragraph separators',()=>{
 for(const separator of ['\n','\r\n','\r'])for(const mode of ['conservative','balanced']){
  const input=['Please send teh document.',...Array(16).fill(''),'> recieve seperate','-- ','recieve seperate'].join(separator);
  const expected=input.replace('teh','the');
  assert.equal(corrector.correct(input,{language:'en',mode}).text,expected,JSON.stringify(separator)+'/'+mode);
 }
});
test('email noun context can include ordinary German adjectives',()=>{
 for(const mode of ['conservative','balanced']){
  const input='Bitte senden Sie die neue Rehcnung. Vielen Dank für Ihre schnelle Nachrciht.';
  const expected='Bitte senden Sie die neue Rechnung. Vielen Dank für Ihre schnelle Nachricht.';
  assert.equal(corrector.correct(input,{language:'de',mode}).text,expected);
 }
});
test('sentence-initial correction is not replayed for a later titlecase name or label',()=>{
 for(const mode of ['conservative','balanced']){
  const input='Plesae send the document. We met the Plesae team.';
  assert.equal(corrector.correct(input,{language:'en',mode}).text,'Please send the document. We met the Plesae team.');
 }
});
test('unverified lowercase names and later titlecase surnames remain unchanged',()=>{
 for(const mode of ['conservative','balanced']){
  assert.equal(corrector.correct('weimer. Herr Weimer meldet sich.',{language:'de',mode}).text,'weimer. Herr Weimer meldet sich.');
 }
});
test('quoted literals and ordinary quoted prose are preserved',()=>{
 for(const mode of ['conservative','balanced']){
  const literal='The user wrote "recieve" intentionally.';
  assert.equal(corrector.correct(literal,{language:'en',mode}).text,literal);
  const german='Das Wort „nachrciht“ bleibt unverändert.';
  assert.equal(corrector.correct(german,{language:'de',mode}).text,german);
  assert.equal(corrector.correct('Please send "teh document" tomorrow.',{language:'en',mode}).text,'Please send "teh document" tomorrow.');
 }
});
test('unattested compound endings remain unchanged',()=>{
 for(const mode of ['conservative','balanced']){
  const input='Bitte projektplanng. die Projektplanng.';
  assert.equal(corrector.correct(input,{language:'de',mode}).text,'Bitte projektplanng. die Projektplanng.');
 }
});

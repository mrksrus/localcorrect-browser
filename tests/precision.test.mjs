import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCorrector} from '../packages/core/src/index.js';
const corrector=createCorrector(Object.fromEntries(['en','de'].map(l=>[l,readFileSync(`packages/core/dictionaries/${l}.txt`,'utf8')])));
test('quotations remain literal even when intent is stated in a later sentence',()=>{
 for(const mode of ['conservative','balanced'])for(const [language,input] of [
 ['en','Please send teh document. The footer reads "Made by teh crew". That is the publication title.'],
 ['en','The caption reads “Handle with cair”. Keep the historical spelling.'],
 ['de','Die Geschichte heißt „Das wierd schon“. Diese Schreibweise gehört zum Titel.'],
 ['de','Auf dem alten Schild steht "Betreten ferboten". Dies ist ein Zitat.'],
 ]){
 const expected=language==='en'?input.replace(/^Please send teh/,'Please send the'):input;
 assert.equal(corrector.correct(input,{language,mode}).text,expected);
 }
});
test('valid words in either bundled language take priority over monolingual guesses',()=>{
 for(const mode of ['conservative','balanced'])for(const [language,input] of [
 ['de','Wir verwenden merge und bite als englische Begriffe.'],
 ['en','Use Nachricht and Beispiel in the German version.'],
 ])assert.equal(corrector.correct(input,{language,mode}).text,input);
});
test('ambiguous or weakly supported noun guesses remain unchanged',()=>{
 for(const mode of ['conservative','balanced'])for(const input of [
 'Unsere Gästin kommt morgen.',
 'Bitte bring eine kleine Kase.',
 'Bitte stell den Wäschekorpp neben die Tür.',
 'Bitte achte auf die Lesezeihen.',
 'Unsere Plätze liegen neben dem Mittellgag.',
 ])assert.equal(corrector.correct(input,{language:'de',mode}).text,input);
});
test('ambiguous public typo priors cannot override competing common words',()=>{
 for(const mode of ['conservative','balanced'])for(const [language,input] of [
 ['en','The bird is acive.'], ['de','Der Antrag wurde angeommen.'],
 ['de','Wir müssen den Rückstand aufhoren.'],
 ])assert.equal(corrector.correct(input,{language,mode}).text,input);
});
test('multiline and single quotations preserve apostrophes and historical wording',()=>{
 for(const input of ['We wrote ‘pleaes wait’ yesterday.', 'We wrote “pleaes\nwait” yesterday.', "We wrote 'don't chnage this' yesterday."])
 assert.equal(corrector.correct(input,{language:'en'}).text,input);
});

test('short ambiguous priors and German guillemets preserve uncertain wording',()=>{
 for(const input of ['Please feek the dog.','The ceiling fan is hge.','The customer wrote »mesage«.','The customer wrote ›mesage‹.','The customer wrote ‹mesage›.'])
 assert.equal(corrector.correct(input,{language:'en'}).text,input);
});

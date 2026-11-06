import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import {createCorrector}from'../packages/core/src/index.js';
import{ambiguityFor}from'../packages/core/src/ambiguity-lookup.js';
const c=createCorrector(Object.fromEntries(['en','de'].map(l=>[l,readFileSync(`packages/core/dictionaries/${l}.txt`,'utf8')])));
const ample=()=>({remaining:1000000});
test('selected-language vocabulary changes EN/DE decisions while old defaults stay mixed',()=>{
 for(const mode of ['conservative','balanced'])for(const[language,input,expected]of[
  ['en','Please unterstand the instructions.','Please understand the instructions.'],
  ['de','halloo zusammen','hallo zusammen']]){
  assert.equal(c.correct(input,{language,mode}).text,input);
  assert.deepEqual(c.correct(input,{language,mode}),c.correct(input,{language,mode,mixedLanguage:true}));
  assert.equal(c.correct(input,{language,mode,mixedLanguage:false}).text,expected);
  // Caches must not carry selected-only priors or ambiguity proofs into mixed mode.
  assert.equal(c.correct(input,{language,mode,mixedLanguage:true}).text,input);
 }
});
test('malformed vocabulary scopes fail before edits instead of silently loosening protection',()=>{
 for(const value of [null,0,1,'false','true',{},[]])assert.throws(()=>c.correct('Please teh document.',{mixedLanguage:value}),/mixedLanguage must be a boolean/);
 for(const value of [null,0,'false'])assert.throws(()=>ambiguityFor('en',value),/supported language/);
});
test('English ambiguities remain and shared names/literals are protected in either scope',()=>{
 assert.equal(ambiguityFor('en',false).hasAlternative('jsut','just',ample()),true);
 for(const mixedLanguage of [true,false]){
  for(const language of ['en','de'])for(const text of ['Dear Halloo,','Hallo Unterstand,','https://example.invalid/unterstand','user@unterstand.invalid','`unterstand halloo`','"unterstand halloo"','--unterstand $halloo %halloo%'])assert.equal(c.correct(text,{language,mixedLanguage}).text,text);
 }
});
test('a spent selected-language ambiguity budget cannot authorize a repair',()=>{
 for(const language of ['en','de']){
  const lookup=ambiguityFor(language,false);
  assert.equal(lookup.hasAlternative('abcd','abdc',{remaining:0}),null);
  assert.equal(lookup.uniqueRepair('abcd',{remaining:0}),null);
 }
});

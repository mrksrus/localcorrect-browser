import test from'node:test';
import assert from'node:assert/strict';
import{contextWordPiece,encodeContext}from'../packages/core/src/context-encode.js';

// Deliberately nonstandard special IDs detect accidental English-BERT defaults.
const vocab=['x','[SEP]','[UNK]','[PAD]','[CLS]','i','I','can',"'",'t','’','hello','##s','a','##a','.','!','?','🚀','é','word','next','##next','##🚀'];
const metadata={format:'localcorrect-context-encoder-v1',vocab,actions:[{kind:'KEEP'},{kind:'REPLACE',language:'en',trigger:'i',replacement:'I'},
 {kind:'REPLACE',language:'de',trigger:'word',replacement:'Word'},{kind:'REPLACE',language:'en',trigger:'i',replacement:'it'}],
 candidatesByTrigger:{'en|i':[1,3],'de|word':[2]},tokenizer:{doLowerCase:false,stripAccents:false,apostropheSplit:["'",'’'],maxWordPieceCharacters:100,
 maximumSequenceLength:128,sentenceEndingTokens:['.','!','?'],newlineEndsChunk:true,candidateWidth:9,padId:3,unkId:2,clsId:4,sepId:1}};

test('cased greedy WordPiece handles apostrophes, unknown suffixes and code points',()=>{
 for(const[surface,expected]of[['hellos',[11,12]],["can't",[7,8,9]],['can’t',[7,10,9]],['can’txyz',[7,10,2]],['HELLO',[2]],['e\u0301',[2]],['é',[19]],['🚀',[18]],['',[2]],['a'.repeat(101),[2]],['🚀'.repeat(101),[2]],['🚀'.repeat(100),[18,...Array(99).fill(23)]],['a'.repeat(100),[13,...Array(99).fill(14)]]])assert.deepEqual(contextWordPiece(metadata,surface),expected,surface);
 // A 127-piece outer token falls back as a whole, even though its parts match.
 assert.deepEqual(contextWordPiece(metadata,Array(64).fill('a').join("'")),[2]);
});

test('tensors select exact-language triggers and preserve original UTF16 spans',()=>{
 const text='🚀 i can’t.\r\nword i!';
 const encoded=encodeContext(metadata,text,'en');
 assert.deepEqual(encoded.tokens.map(t=>[t.text,t.start,t.end]),[['🚀',0,2],['i',3,4],['can’t',5,10],['.',10,11],['word',13,17],['i',18,19],['!',19,20]]);
 assert.deepEqual(encoded.tokenChunks,[{input_ids:[4,18,5,7,10,9,15,1],token_indices:[0,1,2,3],first_positions:[1,2,3,6]},
  {input_ids:[4,20,5,16,1],token_indices:[4,5,6],first_positions:[1,2,3]}]);
 assert.deepEqual(encoded.chunks.map(c=>c.word_positions),[[[2]],[[2]]]);
 assert.deepEqual(encoded.chunks[0].candidate_ids,[[[0,1,3,0,0,0,0,0,0]]]);
 assert.deepEqual(encoded.chunks[0].candidate_mask,[[[1,1,1,0,0,0,0,0,0]]]);
 assert.deepEqual(encoded.chunks[1].words,[{tokenIndex:5,start:18,end:19,text:'i',candidateRowIds:[0,1,3]}]);
 for(const chunk of encoded.chunks){assert.deepEqual(chunk.attention_mask,[Array(chunk.input_ids[0].length).fill(1)]);for(const word of chunk.words)assert.equal(text.slice(word.start,word.end),word.text);}
 assert.equal(encodeContext(metadata,text,'de').chunks.length,1);
 assert.deepEqual(encodeContext(metadata,'hello. next?','en').chunks,[]);
});

test('sentence, newline and 128-piece boundaries match whole-token chunking',()=>{
 const text=Array(127).fill('i').join(' ');
 const chunks=encodeContext(metadata,text,'en').chunks;
 assert.deepEqual(chunks.map(c=>[c.input_ids[0].length,c.words.length]),[[128,126],[3,1]]);
 const complete=encodeContext(metadata,'i'.repeat(1)+' '+ 'a'.repeat(100)+' '+ 'a'.repeat(30),'en');
 assert.deepEqual(complete.tokenChunks.map(c=>c.input_ids.length),[103,32]);
 assert.deepEqual(encodeContext(metadata,'i\ri\ni\r\ni\t i!i?i.i','en').chunks.map(c=>c.words.length),[1,1,1,2,1,1,1]);
 assert.deepEqual(encodeContext(metadata,'\n \r\n','en'),{tokens:[],tokenChunks:[],chunks:[]});
});

test('bounded inputs and invalid metadata fail before inference',()=>{
 assert.throws(()=>encodeContext(metadata,'x'.repeat(20001),'en'),RangeError);
 assert.throws(()=>encodeContext(metadata,Array(3001).fill('i').join(' '),'en'),RangeError);
 assert.throws(()=>encodeContext(metadata,'i','fr'),RangeError);
 assert.throws(()=>encodeContext({...metadata,tokenizer:{...metadata.tokenizer,clsId:0}},'i','en'),/special token/);
 assert.throws(()=>encodeContext({...metadata,candidatesByTrigger:{'en|i':[2]}},'i','en'),/action reference/);
 assert.throws(()=>encodeContext({...metadata,tokenizer:{...metadata.tokenizer,doLowerCase:true}},'i','en'),/configuration/);
});

/* LocalCorrect: original implementation of symmetric-delete spelling lookup.
 * Algorithm: Wolf Garbe, SymSpell, https://github.com/wolfgarbe/SymSpell
 * No upstream implementation code is included. See THIRD_PARTY.md.
 * SPDX-License-Identifier: GPL-3.0-only
 */

import {ambiguityFor,prepareAmbiguity} from './ambiguity-lookup.js';
import {candidates, typingRepair, protectedWord, eligibleInflection} from './candidate-lookup.js';
import {en as enTypos, de as deTypos} from './typos.js';
import {en as enLanguageTypos,de as deLanguageTypos} from './typos-language-data.js';
import enLexicon from './lexicons/en.js';
import * as deAssets from './lexicons/de.js';
import contextMetadata from './context-encoder-data.js';
import contextPolicy from './context-policy.js';
import{encodeContext as encodeContextInputs}from'./context-encode.js';
import{acceptedContextScores}from'./context-model.js';
export function contextIdentity(){return{modelSha256:contextMetadata.modelSha256,modelBytes:contextMetadata.modelBytes,metadataSha256:contextMetadata.metadataSha256};}
export function encodeContext(text,language,{policyOnly=false}={}){
 const encoded=encodeContextInputs(contextMetadata,text,language);
 if(policyOnly){
  const valid=contextPolicy.schemaVersion===1&&contextPolicy.onnxSha256===contextMetadata.modelSha256&&contextPolicy.modelSha256===contextMetadata.metadataSha256;
  const actions=valid?contextPolicy.actions:{};
  // Chunks are independent encoder inputs. Skip those that cannot yield any
  // enabled edit, retaining all original candidate competitors in used chunks.
  encoded.chunks=encoded.chunks.filter(chunk=>chunk.words.some(word=>word.candidateRowIds.some(id=>id!==0&&actions[String(id)])));
 }
 return encoded;
}
const lexicalSources = {en: enLexicon, de: deAssets.default, deCased: deAssets.originalCasing};
const validators = new Map();
function lexical(language) {
  if (!validators.has(language)) {
    const source = lexicalSources[language];
    if (typeof source !== 'string' || source.length < 100000) throw new Error('Bundled spelling-validity lexicon unavailable. No correction performed.');
    // The generated inventory is sorted by JS string order. Keep its text and
    // compact word offsets instead of retaining hundreds of thousands of
    // individual strings and Set entries, particularly in native JS engines.
    let count = 1;
    for (let end = source.indexOf('\n'); end !== -1; end = source.indexOf('\n', end + 1)) count++;
    if (count < 50000) throw new Error('Bundled spelling-validity lexicon incomplete. No correction performed.');
    const starts = new Uint32Array(count + 1);
    let start = 0, previous = '';
    for (let i = 0; i < count; i++) {
      const newline = source.indexOf('\n', start), end = newline === -1 ? source.length : newline;
      const word = source.slice(start, end);
      // Binary search requires strict order. Duplicate/padded or reordered
      // assets must fail closed rather than merely satisfying a line count.
      if (!word || word <= previous) throw new Error('Bundled spelling-validity lexicon is not sorted and unique. No correction performed.');
      starts[i] = start;
      previous = word;
      start = end + 1;
    }
    starts[count] = source.length + 1;
    validators.set(language, { correct(word) {
      let low = 0, high = count - 1;
      while (low <= high) {
        const middle = (low + high) >>> 1;
        const candidate = source.slice(starts[middle], starts[middle + 1] - 1);
        if (candidate === word) return true;
        if (candidate < word) low = middle + 1;
        else high = middle - 1;
      }
      return false;
    }});
  }
  return validators.get(language);
}

const LIMIT = 20000, MAX_WORDS = 3000;
const LETTERS = /^\p{L}+$/u;
const capitalized = word => word[0].toUpperCase() + word.slice(1);
// Optimal string alignment distance: Levenshtein plus adjacent transposition.
export function editDistance(a, b, limit = 2) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previousPrevious;
  let previous = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(row[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        row[j] = Math.min(row[j], previousPrevious[j - 2] + 1);
    }
    previousPrevious = previous;
    previous = row;
  }
  return previous[b.length];
}

function dictionary(source) {
  if (typeof source !== 'string' || source.length > 4_000_000)
    throw new TypeError('A bundled word-frequency dictionary is required.');
  const words = new Map();
  for (const line of source.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const match = /^(\S+)\s+(\d+)$/.exec(line);
    if (!match) continue;
    const word = match[1].toLocaleLowerCase();
    const frequency = Number(match[2]);
    if (word.length >= 2 && word.length <= 32 && LETTERS.test(word) && frequency > 0)
      words.set(word, Math.max(words.get(word) || 0, frequency));
    if (words.size > 60000) throw new RangeError('Dictionary exceeds 60,000 words.');
  }
  if (!words.size) throw new TypeError('The dictionary has no valid entries.');
  return {words};
}
export function protectedRanges(text) {
  const ranges = [];
  const expression = /(?<![\p{L}\p{M}\d._%+@\/\\-])(?:(?:[a-z][a-z\d+.-]*:\/\/|www\.)[^\s<>]+|[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}|[\p{L}\p{M}\d_-]+(?:\.[\p{L}\p{M}\d_-]+)+|[\p{L}\d_.+/-]*\d[\p{L}\d_.+/-]*|\b[\p{L}]+(?:[_/\\][\p{L}\d]+)+\b)/giu;
  for (const m of text.matchAll(expression)) ranges.push([m.index, m.index + m[0].length]);
  // Literal syntax is stronger evidence than a word-frequency suggestion.
  // Preserve complete tokens, including shell paths/flags and code identifiers.
  const syntax = /[@#][\p{L}\p{M}\d_]+|--[\p{L}\p{M}\d_-]+|(?:~\/|\/|[a-z]:\\)[\p{L}\p{M}\d_.\/\\-]+|\b[\p{L}\p{M}_$][\p{L}\p{M}\d_$]*(?=\()|\b[\p{L}\p{M}\d_]+(?:-[\p{L}\p{M}\d_]+)+\b|\b(?:const|let|var)\s+[\p{L}_$][\p{L}\p{M}\d_$]*\s*=[^\r\n]*/giu;
  for (const m of text.matchAll(syntax)) ranges.push([m.index, m.index + m[0].length]);
  // Variable interpolation stays literal even when its name is a valid word.
  const variables=/\$(?:\{[^{}\r\n]+\}|[\p{L}_][\p{L}\p{M}\p{N}_]*(?::[\p{L}_][\p{L}\p{M}\p{N}_]*)?)|%[\p{L}_][\p{L}\p{M}\p{N}_]*%|![\p{L}_][\p{L}\p{M}\p{N}_]*!/gu;
  for(const m of text.matchAll(variables))ranges.push([m.index,m.index+m[0].length]);
  // Keep full-document context when a wrapper corrects only a selected span.
  // These ranges also protect a name or joined identifier outside the selection.
  for(const m of text.matchAll(/[\p{L}\p{M}\p{N}\p{Pc}\p{Cf}]+/gu))
    if(/[\p{Pc}\p{Cf}]/u.test(m[0]))ranges.push([m.index,m.index+m[0].length]);
  const greetings=new Set(['herr','herrn','frau','dr','prof','mr','mrs','ms','dear','hello','hi','hallo','liebe','lieber']);
  for(const m of text.matchAll(/\b([\p{L}]+\.?)[ \t]+/gu)){
    if(!greetings.has(m[1].replace(/\.$/u,'').toLowerCase()))continue;
    const names=/^\p{Lu}[\p{L}\p{M}-]*(?:[ \t]+\p{Lu}[\p{L}\p{M}-]*){0,2}/u.exec(text.slice(m.index+m[0].length));
    if(names)ranges.push([m.index,m.index+m[0].length+names[0].length]);
  }
  for (const m of text.matchAll(/(?<!`)(`+)(?!`)[^\r\n]*?\1(?!`)/gu))
    ranges.push([m.index, m.index + m[0].length]);
  // Quoted wording can be a name, historical spelling or exact instruction.
  // Intent is not recoverable from spelling evidence. Preserve all quotations,
  // accepting missed typos inside ordinary quoted prose rather than rewriting it.
  const quotePairs = {'"':'"', "'":"'", '“':'”', '„':'“', '‘':'’', '‚':'‘', '«':'»', '»':'«', '‹':'›', '›':'‹'};
  const wordCharacter = character => !!character && /[\p{L}\p{M}\d]/u.test(character);
  for (let i = 0; i < text.length; i++) {
    const open = text[i], close = quotePairs[open];
    if (!close || ((open === "'" || open === '‘') && wordCharacter(text[i-1]))) continue;
    let end = i + 1;
    for (; end < text.length; end++) {
      if (text[end] !== close) continue;
      // Apostrophes inside a word do not end its surrounding quotation.
      if ((close === "'" || close === '’') && wordCharacter(text[end-1]) && wordCharacter(text[end+1])) continue;
      break;
    }
    // An unfinished quotation is uncertain too. Preserve through its end.
    ranges.push([i, end < text.length ? end + 1 : text.length]);
    i = end;
  }
  let tail = false, closingSignature = false, fence = null;
  // Retain original UTF-16 offsets for LF, CRLF and Word-style CR paragraphs.
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    if (!match[0].length) break;
    const line = match[1], offset = match.index;
    if (closingSignature && /^\s*(?:P\.?\s*S[.:]|Nachtrag:|Postskriptum:)/iu.test(line)) { tail = false; closingSignature = false; }
    const marker = /^\s*(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) {
        ranges.push([fence.start, offset + line.length]);
        fence = null;
      }
    } else if (marker) {
      fence = {start: offset, character: marker[1][0], length: marker[1].length};
    }
    if (/^\s*(?:--\s*$|On .{1,180}wrote:|Am .{1,180}schrieb|From:|Von:|_{5,})/iu.test(line)) { tail = true; closingSignature = false; }
    if (tail || /^\s*>/.test(line)) ranges.push([offset, offset + line.length]);
    if (!tail && /^\s*(?:Kind regards|Best regards|Best wishes|Yours sincerely|Sincerely|Mit freundlichen Grüßen|Freundliche Grüße|Viele Grüße|Beste Grüße|Herzliche Grüße|Liebe Grüße)\s*[,!.]?\s*$/iu.test(line)) { tail = true; closingSignature = true; }
  }
  // An unfinished code block remains literal through the end of the selection.
  if (fence) ranges.push([fence.start, text.length]);
  return ranges;
}
function recase(original, replacement) {
  if (original === original.toLocaleUpperCase()) return replacement.toLocaleUpperCase();
  if (original[0] === original[0].toLocaleUpperCase())
    return replacement[0].toLocaleUpperCase() + replacement.slice(1);
  return replacement;
}

const initialEnglish = new Set('please although however unfortunately fortunately tomorrow today yesterday hello kindly thanks'.split(' '));
const calendarEnglish = new Set('january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday'.split(' '));
const germanCalendar=new Set('montag dienstag mittwoch donnerstag freitag samstag sonntag januar februar märz april mai juni juli august september oktober november dezember'.split(' '));
const nounIntroducers = new Set('der die das den dem des ein eine einen einem einer eines kein keine keinen keinem keiner keines mein dein sein unser euer eure euren eurem eurer eures ihre ihren ihrer ihrem ihr unsere unseren unserem unserer meine meinen meinem meiner deine deinen deinem deiner seine seinen seinem seiner diese diesen diesem dieser dieses jede jeden jedem jeder jedes welche welchen welchem welcher welches alle allen aller allem einige einigen mehrere mehreren viele vielen weitere weiteren beim zum zur im am vom vorm unterm ins ans aufs fürs'.split(' '));
function nounContext(before) {
 const words=before.match(/(?:[\p{L}\p{M}-]+\s+){1,4}$/u)?.[0].trim().split(/\s+/u)||[];
 for(let i=words.length-1;i>=0;i--)if(nounIntroducers.has(words[i].toLowerCase())&&words.slice(i+1).every(w=>/^\p{Ll}[\p{Ll}\p{M}-]*(?:e|en|er|es|em)$/u.test(w)))return true;
 return false;
}
const typoInventories={en:enTypos,de:deTypos},languageTypoInventories={en:enLanguageTypos,de:deLanguageTypos},typoMaps=new Map();
function prior(language,word,mixedLanguage=true) {
 const shard=word.slice(0,2),key=language+':'+(mixedLanguage?'mixed':'single')+':'+shard;
 const source=(mixedLanguage?typoInventories:languageTypoInventories)[language][shard];
 if(!source)return mixedLanguage?null:prior(language,word,true);
 if(!typoMaps.has(key)){
  let count=1;for(let p=source.indexOf('\n');p!==-1;p=source.indexOf('\n',p+1))count++;
  const starts=new Uint32Array(count+1);let start=0,previous='';
  for(let i=0;i<count;i++){
   const next=source.indexOf('\n',start),end=next===-1?source.length:next;
   const separator=source.indexOf('\t',start),original=source.slice(start,separator);
   if(separator<start||separator>=end||original<=previous)throw new Error('Invalid bundled typo prior. No correction performed.');
   starts[i]=start;previous=original;start=end+1;
  }
  starts[count]=source.length+1;typoMaps.set(key,{starts,count});
 }
 const {starts,count}=typoMaps.get(key);let low=0,high=count-1;
 while(low<=high){
  const mid=(low+high)>>>1,start=starts[mid],separator=source.indexOf('\t',start),original=source.slice(start,separator);
  if(original===word){
   const line=source.slice(separator+1,starts[mid+1]-1),split=line.indexOf('\t');
   const replacement=line.slice(0,split),kind=line.slice(split+1);
   if(!LETTERS.test(replacement)||!['strong','omission','codespell','litkey'].includes(kind))throw new Error('Invalid bundled typo prior. No correction performed.');
   return {replacement,kind};
  }
  if(original<word)low=mid+1;else high=mid-1;
 }
 return mixedLanguage?null:prior(language,word,true);
}
function englishPlural(word, spelling) {
 if(!word.endsWith('s'))return false;
 const stem=word.slice(0,-1);
 return (!/(?:s|x|z|ch|sh)$/u.test(stem)&&spelling.correct(stem))||
  (word.endsWith('es')&&/(?:s|x|z|ch|sh|o)$/u.test(word.slice(0,-2))&&spelling.correct(word.slice(0,-2)))||
  (word.endsWith('ies')&&spelling.correct(word.slice(0,-3)+'y'));
}
/** Prepare only static validity inventories. Does not read or retain document text. */
export function prepare() { lexical('en'); lexical('de'); lexical('deCased'); prepareAmbiguity(); }
/** Local-only correction. Static candidate data are compiled at build time; bounded complete
 * one-edit ambiguity checks use a shared lexical automaton at runtime. Runtime returns sorted UTF-16 spans into the ORIGINAL text.
 * No document-derived cache, network, training or search index is retained.
 */
export function createCorrector({en,de}) {
 const dictionaries={en:dictionary(en),de:dictionary(de)};
 return {correct(text,{language='en',mode='conservative',mixedLanguage=true,contextScores=null,contextual=true}={}){
  if(typeof text!=='string')throw new TypeError('text must be a string');
  if(!['en','de'].includes(language))throw new RangeError('language must be en or de');
  if(!['conservative','balanced'].includes(mode))throw new RangeError('Unknown mode');
  if(typeof mixedLanguage!=='boolean')throw new TypeError('mixedLanguage must be a boolean.');
  if(text.length>LIMIT)throw new RangeError('Text exceeds 20,000 UTF-16 code units. Select a smaller passage.');
  const dict=dictionaries[language],spelling=lexical(language),foreign=lexical(language==='de'?'en':'de');
  const protectedSpans=protectedRanges(text),edits=[],ambiguity=ambiguityFor(language,mixedLanguage);
  let count=0,skipped=0;
  const candidateCache=new Map(),inflectionCache=new Map(),ambiguityCache=new Map(),candidateBudget={remaining:16000},lexicalBudget={remaining:50000};
  const ambiguous=(word,target)=>{const key=word+'\t'+target;if(!ambiguityCache.has(key)){const radius=language==='en'&&englishPlural(target,spelling)?2:1;const result=ambiguity.hasAlternative(word,target,lexicalBudget,radius);if(result!==null)ambiguityCache.set(key,result);return result;}return ambiguityCache.get(key);};
  for(const match of text.matchAll(/\p{L}[\p{L}\p{M}]*/gu)){
   if(++count>MAX_WORDS)throw new RangeError('Text exceeds 3,000 word tokens.');
   const original=match[0],start=match.index,end=start+original.length,word=original.toLowerCase();
   if(word.length<3||word.length>24||/\p{M}/u.test(word)||
      protectedSpans.some(([a,b])=>start<b&&end>a)||
      (original!==word&&original!==original.toUpperCase()&&original.slice(1)!==original.slice(1).toLowerCase())||
      (original===original.toUpperCase()&&original.length<=5)){skipped++;continue;}
   if((language==='de'&&word.includes('ß')&&(spelling.correct(word.replace(/ß/g,'ss'))||spelling.correct(capitalized(word.replace(/ß/g,'ss')))))||spelling.correct(word)||spelling.correct(capitalized(word))||
      (mixedLanguage&&(foreign.correct(word)||foreign.correct(capitalized(word))))||
      (language==='en'&&(englishPlural(word,spelling)||(/lings?$/.test(word)&&spelling.correct(word.replace(/lings?$/,'')))))||
      (language==='de'&&Array.from({length:Math.max(0,word.length-7)},(_,i)=>i+4).some(at=>spelling.correct(capitalized(word.slice(0,at)))&&spelling.correct(capitalized(word.slice(at)))))||
      (language==='de'&&/in(?:nen)?$/.test(word)&&(()=>{const stem=word.replace(/in(?:nen)?$/,'');return[stem,stem+'e',stem.replace(/[äöü]/g,c=>({ä:'a',ö:'o',ü:'u'})[c])].some(w=>w.length>=3&&lexical('deCased').correct(capitalized(w)));})()))continue;
   const titleToken=original[0]!==word[0]&&original!==original.toUpperCase();
   if(protectedWord('software',word)||(titleToken&&protectedWord('people',word))){skipped++;continue;}
   let attestedEntry;
   if(dict.words.has(word)){
    attestedEntry=language==='de'?prior(language,word,mixedLanguage):null;
    let changes=0;
    const restored=attestedEntry?.replacement;
    const lostUmlaut=restored?.length===word.length&&[...word].every((letter,i)=>{if(letter===restored[i])return true;changes++;return ({a:'ä',o:'ö',u:'ü'})[letter]===restored[i];})&&changes===1;
    if(!lostUmlaut)continue;
   }
   const before=text.slice(Math.max(0,start-128),start),after=text.slice(end,end+128);
   // Unsupported-script/diacritic neighbors can mark an intentional foreign phrase.
   // Preserve uncertain wording rather than anglicizing it without language evidence.
   const neighbors=(before.match(/([\p{L}\p{M}]+)\s+$/u)?.[1]||'')+' '+original+' '+(after.match(/^\s+([\p{L}\p{M}]+)/u)?.[1]||'');
   if(/[^\x00-\x7fäöüß]/iu.test(neighbors)){skipped++;continue;}
   const titlecase=original[0]!==word[0]&&original!==original.toUpperCase();
   const sentenceStart=/(?:^|[.!?]\s*|[\r\n]\s*)$/u.test(before);
   if(titlecase&&/\b(?:Herrn?|Frau|Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?|Dear|Hello|Hi|Hallo|Liebe|Lieber)(?:[ \t]+\p{Lu}[\p{L}\p{M}-]*){0,2}[ \t]+$/u.test(before)){skipped++;continue;}
   let replacement;
   // Narrow contextual repairs retained from the original engine.
   if(language==='en'&&original==='Thsi'&&sentenceStart&&/^\s+(?:is|was|will|works|looks|seems|means|can)\b/u.test(after))replacement='This';
   if(language==='de'&&original==='Kanst'&&sentenceStart&&/^\s+du\b/u.test(after))replacement='Kannst';
   if(language==='de'&&original==='Eamil'&&/\b(?:eine|die|diese|ihre|meine|deine|seine|unsere)\s+$/iu.test(before))replacement='E-Mail';
   if(!replacement){
    let entry=attestedEntry||prior(language,word,mixedLanguage);
    if(!entry&&word.length>=6){
     if(!candidateCache.has(word))candidateCache.set(word,candidates(language,word,candidateBudget));
     const options=candidateCache.get(word)?.filter(option=>typingRepair(word,option));
     if(options?.length===1&&typingRepair(word,options[0])&&ambiguous(word,options[0])===false)entry={replacement:options[0],kind:'unique'};
     // Any common candidate would defeat uniqueness of a different derived form.
     if(!entry&&options?.length===0){let repair;if(inflectionCache.has(word))repair=inflectionCache.get(word);else{repair=ambiguity.uniqueRepair(word,lexicalBudget);if(repair!==null)inflectionCache.set(word,repair);}if(typeof repair==='string'&&typingRepair(word,repair)&&eligibleInflection(language,repair))entry={replacement:repair,kind:'inflection'};}
    }
    if(!entry||(!dict.words.has(entry.replacement)&&entry.kind!=='inflection')){skipped++;continue;}
    const candidate=entry.replacement;
    const englishProper=language==='de'&&foreign.correct(capitalized(candidate))&&!foreign.correct(candidate);
    if(englishProper||(language==='en'&&!calendarEnglish.has(candidate)&&!spelling.correct(candidate)&&spelling.correct(capitalized(candidate)))){skipped++;continue;}
    const closedEnglish=language==='en'&&new Set(['the','and','this','that','with','from','they','your']).has(candidate);
    if(!closedEnglish&&entry.kind!=='unique'&&ambiguous(word,candidate)!==false){skipped++;continue;}

    if(titlecase){
     if(language==='en'&&!((sentenceStart&&initialEnglish.has(candidate))||calendarEnglish.has(candidate))){skipped++;continue;}
     if(language==='de'&&!(germanCalendar.has(candidate)&&(/\b(?:am|bis|ab|vor|nach|für|auf|jeden|nächsten|kommenden)\s+$/iu.test(before)||/^\s+(?:wäre|passt)\b/u.test(after)))&&!nounContext(before)&&!(sentenceStart&&['bitte','morgen','hallo','danke'].includes(candidate))&&
        !(['strong','omission'].includes(entry.kind)&&(dict.words.get(candidate)||0)>=1000&&lexical('deCased').correct(capitalized(candidate))&&/(?:ung|ungen|heit|heiten|keit|keiten|schaft|schaften|tion|tionen|tät|täten)$/u.test(candidate))){skipped++;continue;}
    }
    replacement=recase(original,candidate);
   }
   edits.push({offset:start,length:original.length,replacement,original});
  }
  if(contextual&&contextScores){edits.push(...acceptedContextScores(contextMetadata,contextPolicy,text,language,contextScores,protectedSpans,edits));edits.sort((a,b)=>a.offset-b.offset);}
  let output=text;for(let i=edits.length-1;i>=0;i--){const e=edits[i];output=output.slice(0,e.offset)+e.replacement+output.slice(e.offset+e.length);}
  return {text:output,edits,skipped};
 }};
}

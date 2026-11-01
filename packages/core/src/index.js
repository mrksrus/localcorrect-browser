/* LocalCorrect: original implementation of symmetric-delete spelling lookup.
 * Algorithm: Wolf Garbe, SymSpell, https://github.com/wolfgarbe/SymSpell
 * No upstream implementation code is included. See THIRD_PARTY.md.
 * SPDX-License-Identifier: GPL-3.0-only
 */

import enLexicon from './lexicons/en.js';
import deLexicon from './lexicons/de.js';
const lexicalSources = {en: enLexicon, de: deLexicon};
const validators = new Map();
function lexical(language) {
  if (!validators.has(language)) {
    const source = lexicalSources[language];
    if (typeof source !== 'string' || source.length < 100000) throw new Error('Bundled spelling-validity lexicon unavailable. No correction performed.');
    const words = new Set(source.split('\n'));
    if (words.size < 50000) throw new Error('Bundled spelling-validity lexicon incomplete. No correction performed.');
    validators.set(language, {correct: word => words.has(word)});
  }
  return validators.get(language);
}
const capitalized = word => word[0].toLocaleUpperCase() + word.slice(1);
function transposition(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length - 1; i++)
    if (a[i] !== a[i+1] && a.slice(0,i)+a[i+1]+a[i]+a.slice(i+2) === b) return true;
  return false;
}
const LIMIT = 20000;
const MAX_WORDS = 3000;
const PREFIX = 7;
const LETTERS = /^\p{L}+$/u;

function deletes(word, distance = 2) {
  const result = new Set([word]);
  let level = [word];
  for (let d = 0; d < distance; d++) {
    const next = [];
    for (const item of level) {
      for (let i = 0; i < item.length; i++) {
        const v = item.slice(0, i) + item.slice(i + 1);
        if (!result.has(v)) { result.add(v); next.push(v); }
      }
    }
    level = next;
  }
  return result;
}

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
  return {words, index: null};
}
function buildIndex(dict) {
  if (dict.index) return;
  dict.index = new Map();
  for (const word of dict.words.keys()) {
    for (const key of deletes(word.slice(0, PREFIX))) {
      let bucket = dict.index.get(key);
      if (!bucket) dict.index.set(key, bucket = []);
      bucket.push(word);
    }
  }
}

export function protectedRanges(text) {
  const ranges = [];
  const expression = /(?:https?:\/\/|www\.)[^\s<>]+|[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}|[\p{L}\p{M}\d_-]+(?:\.[\p{L}\p{M}\d_-]+)+|[\p{L}\d_.+/-]*\d[\p{L}\d_.+/-]*|\b[\p{L}]+(?:[_/\\][\p{L}\d]+)+\b|`[^`\n]*`/gu;
  for (const m of text.matchAll(expression)) ranges.push([m.index, m.index + m[0].length]);
  let offset = 0, tail = false;
  for (const line of text.split('\n')) {
    if (/^\s*(?:--\s*$|On .{1,180}wrote:|Am .{1,180}schrieb|From:|Von:|_{5,})/iu.test(line)) tail = true;
    if (tail || /^\s*>/.test(line)) ranges.push([offset, offset + line.length]);
    offset += line.length + 1;
  }
  return ranges;
}
function recase(original, replacement) {
  if (original === original.toLocaleUpperCase()) return replacement.toLocaleUpperCase();
  if (original[0] === original[0].toLocaleUpperCase())
    return replacement[0].toLocaleUpperCase() + replacement.slice(1);
  return replacement;
}

/** Create a portable corrector. No DOM, network, storage or text logging.
 * Edits use UTF-16 offsets into ORIGINAL text; unchanged spans are byte-for-byte
 * (JS string code-unit-for-code-unit) preserved. No normalization is performed.
 */
export function createCorrector({en, de}) {
  const dictionaries = {en: dictionary(en), de: dictionary(de)};
  return {
    correct(text, {language = 'en', mode = 'conservative'} = {}) {
      if (typeof text !== 'string') throw new TypeError('text must be a string');
      if (!['en', 'de'].includes(language)) throw new RangeError('language must be en or de');
      if (!['conservative', 'balanced'].includes(mode)) throw new RangeError('Unknown mode');
      if (text.length > LIMIT) throw new RangeError('Text exceeds 20,000 UTF-16 code units. Select a smaller passage.');
      const dict = dictionaries[language];
      // Mandatory broad validity layer; frequency absence is not a spelling error.
      const spelling = lexical(language);
      const valid = word => spelling.correct(word) || (language === 'de' && spelling.correct(capitalized(word)));
      const protectedSpans = protectedRanges(text);
      const edits = [];
      let skipped = 0, count = 0, work = 50000;
      const lookups = new Map();
      for (const match of text.matchAll(/\p{L}[\p{L}\p{M}]*/gu)) {
        if (++count > MAX_WORDS) throw new RangeError('Text exceeds 3,000 word tokens.');
        const original = match[0], start = match.index, end = start + original.length;
        const word = original.toLocaleLowerCase();
        if (protectedSpans.some(([a, b]) => start < b && end > a) ||
            word.length < 3 || word.length > 24 ||
            /\p{M}/u.test(word) ||
            (original !== original.toLocaleLowerCase() && original !== original.toLocaleUpperCase() &&
             original.slice(1) !== original.slice(1).toLocaleLowerCase()) ||
            (original === original.toLocaleUpperCase() && original.length <= 5)) { skipped++; continue; }
        if (dict.words.has(word) || valid(word)) continue;
        // Unknown English titlecase tokens remain names even at selection start.
        // German noun correction requires lexical casing plus determiner context.
        const titlecase = original[0] !== original[0].toLocaleLowerCase() && original !== original.toLocaleUpperCase();
        const sentenceStart = /(?:^|[.!?]\s*|\n\s*)$/u.test(text.slice(0, start));
        const nounContext = language === 'de' && titlecase && /\b(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|ihre|ihren|ihrer|ihrem|ihr|unsere|unseren|meine|meinen|deine|deinen|seine|seinen)\s+$/iu.test(text.slice(0,start));
        // A titlecase token at document/selection start alone is not typo evidence.
        // Permit only a narrow formal-request shape (infinitive + Sie), not names.
        const initialGerman = language === 'de' && titlecase && sentenceStart && /^\s+\p{Ll}+(?:en|ern|eln)\s+Sie\b/u.test(text.slice(end));
        if (titlecase && !nounContext && !initialGerman) { skipped++; continue; }
        const cacheKey = `${word}:${nounContext}:${initialGerman}`;
        if (lookups.has(cacheKey)) {
          const replacement = lookups.get(cacheKey);
          if (replacement) edits.push({offset: start, length: original.length, replacement: recase(original, replacement), original});
          else skipped++;
          continue;
        }
        if (work <= 0) { skipped++; continue; }
        buildIndex(dict);
        const distance = mode === 'balanced' && word.length >= 7 ? 2 : 1;
        const candidates = new Set();
        let exhausted = false;
        for (const key of deletes(word.slice(0, PREFIX), distance)) {
          for (const candidate of dict.index.get(key) || []) {
            candidates.add(candidate);
            if (candidates.size > 4000) { exhausted = true; break; }
          }
          if (exhausted) break;
        }
        if (exhausted) { lookups.set(cacheKey, null); skipped++; continue; }
        const ranked = [];
        for (const candidate of candidates) {
          if (--work < 0) { exhausted = true; break; }
          if (Math.abs(candidate.length - word.length) > distance) continue;
          const d = editDistance(word, candidate, distance);
          if (d > distance) continue;
          if (!valid(candidate)) continue;
          if (nounContext && !spelling.correct(capitalized(candidate))) continue;
          if (initialGerman && !(valid(candidate) && transposition(word,candidate) && dict.words.get(candidate) >= 10000)) continue;
          if (word.length < (mode === 'conservative' ? 5 : 4) && !(transposition(word,candidate) && dict.words.get(candidate) >= 100000)) continue;
          ranked.push({word: candidate, d, f: dict.words.get(candidate)});
        }
        if (exhausted) { lookups.set(cacheKey, null); skipped++; continue; }
        ranked.sort((a, b) => a.d - b.d || b.f - a.f || a.word.localeCompare(b.word));
        const best = ranked[0], second = ranked[1];
        // Frequency and ambiguity gates are heuristics, NOT confidence scores.
        const nounTranspose = nounContext && best && transposition(word,best.word);
        const minFrequency = nounTranspose ? 100 : mode === 'conservative' ? 1000 : 250;
        const ratio = mode === 'conservative' ? 8 : 3;
        if (!best || best.f < minFrequency ||
            (second && second.d === best.d && best.f < second.f * ratio) ||
            (best.d === 2 && best.f < 3000)) { lookups.set(cacheKey, null); skipped++; continue; }
        lookups.set(cacheKey, best.word);
        edits.push({offset: start, length: original.length, replacement: recase(original, best.word), original});
      }
      let output = text;
      for (let i = edits.length - 1; i >= 0; i--) {
        const e = edits[i]; output = output.slice(0, e.offset) + e.replacement + output.slice(e.offset + e.length);
      }
      return {text: output, edits, skipped};
    }
  };
}

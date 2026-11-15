// LocalCorrect engine. No DOM, no network: plain text in, edits out.
// Word lists ("word count" per line) are Hunspell-approved words with subtitle-corpus
// frequencies, built by scripts/build-lexicon.py. Candidates are words one or two edits away
// (the SymSpell/Norvig idea, after Wolf Garbe and Peter Norvig), ranked by frequency.

const ALPHABET = {en: 'abcdefghijklmnopqrstuvwxyz', de: 'abcdefghijklmnopqrstuvwxyzäöüß'};
// Missing umlauts are the most common German slip on non-German keyboards.
const UMLAUTS = [['ae', 'ä'], ['oe', 'ö'], ['ue', 'ü'], ['ss', 'ß'], ['a', 'ä'], ['o', 'ö'], ['u', 'ü']];
// The subtitle corpus has no apostrophes, so contractions are listed here.
const CONTRACTIONS = Object.fromEntries(['don\'t', 'can\'t', 'i\'m', 'i\'ve', 'i\'ll', 'i\'d', 'isn\'t', 'didn\'t', 'doesn\'t',
  'wouldn\'t', 'couldn\'t', 'shouldn\'t', 'haven\'t', 'hasn\'t', 'hadn\'t', 'wasn\'t', 'weren\'t', 'aren\'t',
  'you\'re', 'they\'re', 'that\'s', 'what\'s', 'there\'s', 'here\'s', 'it\'ll', 'you\'ve', 'we\'ve', 'they\'ve',
  'you\'ll', 'they\'ll', 'let\'s', 'who\'s', 'doesn\'t', 'won\'t', 'ain\'t'].map(w => [w.replace("'", ''), w]));
delete CONTRACTIONS.wont; delete CONTRACTIONS.lets; delete CONTRACTIONS.ill; delete CONTRACTIONS.id; delete CONTRACTIONS.well;
// Colloquial forms Duden accepts without apostrophe but Hunspell rejects.
const GERMAN_COLLOQUIAL = new Set(['gehts', 'gibts', 'wars', 'klappts', 'passts', 'stimmts', 'hats', 'gings', 'machts', 'ists']);
// Everyday tech words that neither Hunspell list knows.
const TECH = new Set(('npm npx dev devs repo repos config configs api apis cli url urls auth env prod admin app apps ' +
  'sql sudo git github gitlab yaml json http https async todo todos bugfix hotfix frontend backend localhost webhook ' +
  'webhooks refactor refactoring changelog codebase docker kubernetes linux macos ios wifi online offline login logout ' +
  'email emails inbox spam blog vlog podcast smartphone laptop tablet browser chatbot').split(' '));
const TITLES = /(?:Herr|Herrn|Frau|Dr|Prof|Mr|Mrs|Ms|Dear|Liebe|Lieber|Hallo|Hi|Hello)\.?\s+$/;
// Never touched: links, e-mail addresses, @handles, #tags, paths, file names, anything with digits.
const SKIP = /(?:[a-z][a-z\d+.-]*:\/\/|www\.)\S+|(?<!\S)--?\p{L}[\p{L}\d-]*|[^\s@]+@\S+|[@#$%][\p{L}\d_]+|\S*[\d_\\/]\S*|[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/giu;
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}]+)?/gu;

function parse(source) {
  const counts = new Map(), forms = new Map();
  for (const line of source.split('\n')) {
    const space = line.indexOf(' ');
    if (space < 1) continue;
    const word = line.slice(0, space), lower = word.toLowerCase(), count = Number(line.slice(space + 1));
    counts.set(lower, Math.max(counts.get(lower) || 0, count));
    const list = forms.get(lower);
    if (list) list.push(word); else forms.set(lower, [word]);
  }
  return {counts, forms};
}

export function createCorrector({en, de}) {
  const lang = {en: parse(en), de: parse(de)};
  for (const code in lang) lang[code].alphabet = ALPHABET[code];

  // A word is valid when the list has it in this casing, or it is a capitalised/upper-case
  // form of a listed lower-case word. Lower-case "haus" is not valid German; "Haus" is.
  function known(L, word) {
    const list = L.forms.get(word.toLowerCase());
    if (!list) return false;
    if (list.includes(word) || word === word.toUpperCase()) return true;
    const decap = word[0].toLowerCase() + word.slice(1);
    return word !== decap && list.includes(decap);
  }
  // German compounds the corpus never saw: two or more known parts, optional linking "s".
  function compound(L, lower, depth = 0) {
    if (lower.length < 8 || depth > 3) return false;
    for (let i = lower.length - 3; i >= 3; i--) {
      const head = lower.slice(0, i), tail = lower.slice(i);
      const headOk = L.counts.has(head) || (head.endsWith('s') && L.counts.has(head.slice(0, -1)));
      if (headOk && (L.counts.has(tail) || compound(L, tail, depth + 1))) return true;
    }
    return false;
  }
  const valid = (code, word) => known(lang[code], word) || TECH.has(word.toLowerCase()) ||
    (code === 'de' && (GERMAN_COLLOQUIAL.has(word.toLowerCase()) || compound(lang.de, word.toLowerCase())));

  function edits1(word, alphabet) {
    const out = new Set();
    for (let i = 0; i <= word.length; i++) {
      const a = word.slice(0, i), b = word.slice(i);
      if (b) out.add(a + b.slice(1));
      if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));
      for (const c of alphabet) { if (b) out.add(a + c + b.slice(1)); out.add(a + c + b); }
    }
    out.delete(word);
    return out;
  }
  // Swapped letters are the most common slip: such a candidate gets a strong bonus.
  const swapped = (a, b) => a.length === b.length && [...a].sort().join('') === [...b].sort().join('');
  function mostFrequent(L, words, minimum = 1, typed = '') {
    let top = null, best = minimum - 1;
    for (const w of words) {
      const n = (L.counts.get(w) || 0) * (swapped(w, typed) ? 50 : 1);
      if (n > best) { top = w; best = n; }
    }
    return top;
  }
  // Best replacement for a lower-cased unknown word, with the number of edits it took.
  // umlautOnly: the word is valid in the other language, so only a missing umlaut is fixed (fur -> für).
  function suggest(code, lower, umlautOnly) {
    const L = lang[code];
    if (code === 'de') for (const [from, to] of UMLAUTS) {
      const c = lower.split(from).join(to);
      if (c !== lower && L.counts.has(c)) return [c, 1];
    }
    if (umlautOnly) return [null, 0];
    if (code === 'en' && CONTRACTIONS[lower]) return [CONTRACTIONS[lower], 1];
    if (L.counts.has(lower)) return [lower, 0]; // only the casing was wrong
    // English: a lower-case word is not replaced by a name ("dev" -> "Del").
    const plain = w => code !== 'en' || L.forms.get(w)?.includes(w);
    const one = edits1(lower, L.alphabet);
    // Three letters: only a missing letter or a swap, otherwise "npm" would become "pm".
    const best = mostFrequent(L, [...one].filter(w => plain(w) && (lower.length > 3 || w.length > 3 || swapped(w, lower))), 1, lower);
    if (best) return [best, 1];
    if (lower.length < 5) return [null, 0]; // two edits on a short word is a guess
    const two = new Set();
    for (const e of one) for (const x of edits1(e, L.alphabet)) if (L.counts.has(x) && plain(x)) two.add(x);
    return [mostFrequent(L, two, 20), 2];
  }
  // Pick the listed casing: German nouns stay capitalised, otherwise follow the typed word.
  function cased(code, typed, lower) {
    const list = lang[code].forms.get(lower) || [lower];
    const plain = list.includes(lower) ? lower : list[0];
    if (typed.length > 1 && typed === typed.toUpperCase()) return plain.toUpperCase();
    if (plain.startsWith("i'")) return 'I' + plain.slice(1);
    const typedCap = typed[0] !== typed[0].toLowerCase();
    if (typedCap && plain === lower) return plain[0].toUpperCase() + plain.slice(1);
    return plain;
  }

  function detect(text) {
    let en = 0, de = 0;
    for (const [w] of text.toLowerCase().matchAll(WORD)) {
      if (lang.en.counts.has(w)) en += 1;
      if (lang.de.counts.has(w)) de += 1;
    }
    return de > en ? 'de' : 'en';
  }

  // language: 'auto' | 'en' | 'de'. Returns edits with offsets into the original text.
  function correct(text, {language = 'auto'} = {}) {
    const code = language === 'en' || language === 'de' ? language : detect(text);
    const other = code === 'en' ? 'de' : 'en';
    const skip = [];
    for (const m of text.matchAll(SKIP)) skip.push([m.index, m.index + m[0].length]);
    for (const m of text.matchAll(/^[ \t]*>.*$/gm)) skip.push([m.index, m.index + m[0].length]); // quoted replies
    const edits = [];
    if (code === 'en') for (const m of text.matchAll(/(?<![\p{L}'’.-])i(?![\p{L}'’.-])/gu))
      if (!skip.some(([a, b]) => m.index < b && m.index >= a)) edits.push({offset: m.index, length: 1, original: 'i', replacement: 'I'});
    for (const m of text.matchAll(WORD)) {
      const typed = m[0], start = m.index, end = start + typed.length;
      if ((typed.length < 3 && !(code === 'en' && CONTRACTIONS[typed.toLowerCase()])) || skip.some(([a, b]) => start < b && end > a)) continue;
      if (/\p{Lu}/u.test(typed.slice(1))) continue; // acronyms, CamelCase, brand names
      if (/['’]/.test(typed)) continue; // the lists have no apostrophe forms to check against
      const word = typed;
      if (valid(code, word)) continue;
      const before = text.slice(Math.max(0, start - 40), start);
      const sentenceStart = start === 0 || /(?:[.!?:]\s+|\n\s*)$/.test(before);
      const capitalised = word[0] !== word[0].toLowerCase();
      // Capitalised inside a sentence (or after "Herr", "Dear", ...) is most likely a name.
      if (capitalised && (TITLES.test(before) || (code === 'en' && !sentenceStart))) continue;
      const contraction = code === 'en' && CONTRACTIONS[word.toLowerCase()];
      const [lower, distance] = suggest(code, word.toLowerCase(), !contraction && valid(other, word));
      if (!lower) continue;
      if (code === 'de' && capitalised && !sentenceStart && (distance > 1 || word.length < 4)) continue;
      const replacement = cased(code, typed, lower);
      if (replacement !== typed) edits.push({offset: start, length: typed.length, original: typed, replacement});
    }
    edits.sort((a, b) => a.offset - b.offset);
    let out = '', position = 0;
    for (const e of edits) { out += text.slice(position, e.offset) + e.replacement; position = e.offset + e.length; }
    return {text: out + text.slice(position), edits, language: code};
  }

  return {correct, detect};
}

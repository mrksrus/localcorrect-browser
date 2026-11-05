// Compile positive eligibility only from public, already-vendored lexical sources.
// This module never reads typo examples, evaluation corpora or user documents.
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve, relative} from 'node:path';
import nspell from '../packages/core/vendor/nspell/lib/index.js';

export const MIN_BASE_FREQUENCY = 150;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const alphabetic = /^\p{L}{2,24}$/u;
const fold = word => word.toLowerCase();

export function parseFrequency(text) {
  const frequent = new Set(), targets = new Set();
  for (const line of text.trim().split(/\r?\n/u)) {
    if (!line) continue;
    const match = /^(\S+) ([0-9]+)$/u.exec(line);
    if (!match || !Number.isSafeInteger(Number(match[2]))) throw new Error('Invalid frequency source row.');
    const word = fold(match[1]);
    targets.add(word);
    if (Number(match[2]) >= MIN_BASE_FREQUENCY) frequent.add(word);
  }
  return {frequent, targets};
}

/** Keep original entry lines and flags. Tab-prefixed dictionary notices and
 * comments remain verbatim after a reconstructed count header. Unsupported
 * aliases fail closed rather than treating an alias number as affix flags. */
export function selectBaseDictionary(aff, dic, frequent) {
  if (/^\s*(?:AF|AM)(?:\s|$)/mu.test(aff)) throw new Error('Hunspell aliases are unsupported by the pinned nspell parser.');
  const encoding = /^\s*SET\s+(\S+)/mu.exec(aff);
  if (!encoding || encoding[1] !== 'UTF-8') throw new Error('Only explicit UTF-8 Hunspell sources are supported.');
  const flag = /^\s*FLAG\s+(\S+)/mu.exec(aff);
  if (flag && !['long', 'num', 'UTF-8'].includes(flag[1])) throw new Error('Unsupported Hunspell flag encoding.');
  const lines = dic.split(/\r?\n/u);
  if (!/^\d+$/u.test(lines.shift())) throw new Error('Missing Hunspell dictionary count header.');
  const retained = [], bases = new Set();
  let sourceEntries = 0, selectedEntries = 0;
  for (const line of lines) {
    if (!line.trim() || line.startsWith('\t') || line.startsWith('#')) {
      retained.push(line);
      continue;
    }
    sourceEntries++;
    // An alphabetic stem with unchanged flags is unambiguous in nspell's
    // parser. Entries with escaped slashes or morphology are omitted safely.
    const entry = /^(\p{L}+)(?:\/([^\s/]+))?$/u.exec(line);
    if (!entry || !frequent.has(fold(entry[1]))) continue;
    selectedEntries++;
    bases.add(fold(entry[1]));
    retained.push(line);
  }
  return {
    dic: selectedEntries + '\n' + retained.join('\n'),
    stats: {sourceEntries, selectedEntries, selectedBases: bases.size}
  };
}

/** nspell's data keys contain only supplied bases and actual affix expansions.
 * correct() filters forbidden/compound-only forms. No suggest() call, suffix
 * stripping, compound synthesis or free-form word addition occurs here. */
export function compileEligibility({aff, dic, frequencyText, fullLexicon}) {
  const {frequent, targets} = parseFrequency(frequencyText);
  const selected = selectBaseDictionary(aff, dic, frequent);
  const spelling = nspell(aff, selected.dic);
  // A supplied Set is the caller's pre-folded full inventory, reused per region.
  const full = fullLexicon instanceof Set ? fullLexicon : new Set([...fullLexicon].map(fold));
  const eligible = new Set();
  let acceptedAlphabeticForms = 0;
  for (const word of Object.keys(spelling.data)) {
    if (!alphabetic.test(word) || !spelling.correct(word)) continue;
    acceptedAlphabeticForms++;
    const lower = fold(word);
    if (alphabetic.test(lower) && full.has(lower) && !targets.has(lower)) eligible.add(lower);
  }
  const words = [...eligible].sort();
  return {
    words,
    stats: {...selected.stats, expandedForms: Object.keys(spelling.data).length,
      acceptedAlphabeticForms, eligibleForms: words.length,
      selectedDictionarySha256: sha(selected.dic), inventorySha256: sha(words.join('\n'))}
  };
}

function treeFiles(directory) {
  return readdirSync(resolve(ROOT, directory), {withFileTypes: true}).flatMap(entry => {
    const file = directory + '/' + entry.name;
    return entry.isDirectory() ? treeFiles(file) : [file];
  }).sort();
}

/** Returns deterministic artifacts without mutating the repository. */
export async function compileAssets() {
  const files = {};
  const read = file => {
    const bytes = readFileSync(resolve(ROOT, file));
    files[file] = sha(bytes);
    return bytes;
  };
  const manifests = {};
  for (const file of ['packages/core/lexicon-sources.json', 'packages/core/dictionary-sources.json', 'package-lock.json']) {
    manifests[file] = JSON.parse(read(file));
  }
  const upstream = manifests['packages/core/lexicon-sources.json'];
  const lock = manifests['package-lock.json'];
  for (const name of ['nspell', 'is-buffer']) {
    for (const file of treeFiles(`packages/core/vendor/${name}`)) read(file);
    const metadata = JSON.parse(read(`packages/core/vendor/${name}/package.json`));
    if (metadata.version !== lock.packages[`node_modules/${name}`].version || metadata.version !== upstream.sources[name].version) {
      throw new Error('Vendored parser version does not match pinned manifests.');
    }
  }
  read('scripts/inflection-eligibility.mjs');
  const result = {en: '', de: ''}, inventories = {}, regions = {};
  const sources = {en: ['dictionary-en', 'dictionary-en-gb'], de: ['dictionary-de', 'dictionary-de-at']};
  for (const language of ['en', 'de']) {
    const frequencyFile = `packages/core/dictionaries/${language}.txt`;
    const frequencyText = read(frequencyFile).toString('utf8');
    if (files[frequencyFile] !== manifests['packages/core/dictionary-sources.json'].sources[language].output_sha256) {
      throw new Error('Frequency dictionary does not match its pinned manifest.');
    }
    const lexiconFile = `packages/core/src/lexicons/${language}.js`;
    read(lexiconFile);
    const lexicon = (await import(pathToFileURL(resolve(ROOT, lexiconFile)))).default;
    if (sha(lexicon) !== upstream.inventories[language].expanded_sha256) throw new Error('Full lexicon does not match pinned manifest.');
    const full = new Set(fold(lexicon).split('\n'));
    const merged = new Set();
    for (const name of sources[language]) {
      const directory = `packages/core/vendor/${name}`, metadata = JSON.parse(read(`${directory}/package.json`));
      const source = upstream.sources[name];
      if (metadata.version !== source.version || metadata.version !== lock.packages[`node_modules/${name}`].version) {
        throw new Error('Dictionary version does not match pinned manifests.');
      }
      const aff = read(`${directory}/index.aff`).toString('utf8');
      const dic = read(`${directory}/index.dic`).toString('utf8');
      read(`${directory}/license`);
      for (const [file, expected] of Object.entries(source.files)) {
        if (files[`${directory}/${file}`] !== expected) throw new Error('Dictionary source hash mismatch: ' + name + '/' + file);
      }
      const compiled = compileEligibility({aff, dic, frequencyText, fullLexicon: full});
      regions[name] = {language, version: metadata.version, license: source.license,
        selectedLicense: language === 'de' ? 'GPL-3.0' : source.license,
        licenseFile: `${directory}/license`, ...compiled.stats};
      for (const word of compiled.words) merged.add(word);
    }
    result[language] = [...merged].sort().join('\n');
    inventories[language] = {inputs: sources[language], forms: merged.size, inventorySha256: sha(result[language])};
  }
  const asset = '// Generated from frequency-selected Hunspell bases and unchanged affix rules.\n' +
    '// See inflection-sources.json and the unmodified licenses in packages/core/vendor.\n' +
    'export const en = ' + JSON.stringify(result.en) + ';\n' +
    'export const de = ' + JSON.stringify(result.de) + ';\n' +
    'export default {en, de};\n';
  const manifest = {
    schemaVersion: 1,
    description: 'Positive affix eligibility from frequent public dictionary bases. This inventory alone never authorizes a correction. No error/correction pairs, tests, gold labels or user text are compiler inputs.',
    method: {minimumBaseFrequency: MIN_BASE_FREQUENCY, folding: 'JavaScript String.toLowerCase; no normalization rewrite',
      formPattern: '^\\p{L}{2,24}$', enumeration: 'Only nspell.data keys from selected original base lines and unchanged original affix rules; nspell.correct acceptance required.',
      membership: 'Require membership in the existing full selected language lexicon after casefolding.',
      exclusion: 'Exclude every casefolded word in the complete selected frequency dictionary, at any frequency.',
      parserLimits: 'AF and AM aliases and unsupported flag encodings fail closed; non-alphabetic or syntactically ambiguous base entries are omitted.',
      licenses: 'All original dictionary affix/dictionary/license files and notices remain unchanged; filtered in-memory dictionaries retain tab-prefixed notices and comments. Derived asset retains source license obligations.'},
    inputs: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
    regions, inventories, assetBytes: Buffer.byteLength(asset), assetSha256: sha(asset)
  };
  return {asset, manifest: JSON.stringify(manifest, null, 2) + '\n'};
}

async function main() {
  if (process.argv.slice(2).some(argument => argument !== '--check')) throw new Error('Only --check is supported.');
  const {asset, manifest} = await compileAssets();
  const outputs = {'packages/core/src/inflection-data.js': asset, 'inflection-sources.json': manifest};
  for (const [file, text] of Object.entries(outputs)) {
    if (process.argv.includes('--check')) {
      if (readFileSync(resolve(ROOT, file), 'utf8') !== text) throw new Error('Stale inflection artifact: ' + relative(ROOT, resolve(ROOT, file)));
    } else writeFileSync(resolve(ROOT, file), text);
  }
  const parsed = JSON.parse(manifest);
  console.log(JSON.stringify({inventories: parsed.inventories, regions: parsed.regions,
    assetBytes: parsed.assetBytes, assetSha256: parsed.assetSha256, peakRssKiB: process.resourceUsage().maxRSS}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

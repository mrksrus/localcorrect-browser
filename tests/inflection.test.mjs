import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {compileEligibility, compileAssets, MIN_BASE_FREQUENCY, parseFrequency, selectBaseDictionary} from '../scripts/inflection-eligibility.mjs';
import data, {en, de} from '../packages/core/src/inflection-data.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
// Synthetic positive Hunspell fixture. These are dictionary stems and forms,
// never a correction pair or a document/evaluation example.
const aff = 'SET UTF-8\nSFX S Y 2\nSFX S 0 s .\nSFX S 0 ling .\n';
const dic = '3\n\tSynthetic dictionary copyright notice.\ncedar/S\ntamarind/S\nMaple/S\n';
const frequencyText = 'cedar 150\ntamarind 149\nmaple 150\ncedars 1\n';
const fullLexicon = ['cedar', 'cedars', 'cedarling', 'tamarind', 'tamarinds', 'Maple', 'Maples'];

test('only source affixes of threshold-selected bases add eligibility', () => {
  assert.equal(MIN_BASE_FREQUENCY, 150);
  const result = compileEligibility({aff, dic, frequencyText, fullLexicon});
  assert.deepEqual(result.words, ['cedarling', 'maples']);
  assert.equal(result.stats.selectedEntries, 2);
  assert.equal(result.stats.selectedBases, 2);
  assert.equal(result.stats.expandedForms, 6);
  assert.equal(result.stats.eligibleForms, 2);
  assert(!result.words.includes('tamarinds'), 'a rare base must not donate its plural');
  assert(!result.words.includes('cedars'), 'all existing frequency targets are excluded, even at frequency 1');
  assert(!result.words.includes('mapleling'), 'an expansion absent from the full lexicon is excluded');
});

test('subset header is exact, original flags and notices remain intact', () => {
  const {frequent} = parseFrequency(frequencyText);
  const subset = selectBaseDictionary(aff, dic, frequent);
  assert.equal(subset.dic, '2\n\tSynthetic dictionary copyright notice.\ncedar/S\nMaple/S\n');
  assert.equal(dic, '3\n\tSynthetic dictionary copyright notice.\ncedar/S\ntamarind/S\nMaple/S\n');
});

test('unflagged bases cannot donate guessed suffixes', () => {
  const result = compileEligibility({aff, dic: '1\ncedar\n', frequencyText: 'cedar 1000\n', fullLexicon});
  assert.deepEqual(result.words, []);
});

test('forbidden and compound-only nspell keys do not become eligible', () => {
  const restricted = 'SET UTF-8\nFORBIDDENWORD F\nONLYINCOMPOUND C\n';
  const result = compileEligibility({aff: restricted, dic: '2\ncedar/F\nmaple/C\n', frequencyText: 'cedar 1000\nmaple 1000\n', fullLexicon});
  assert.deepEqual(result.words, []);
  assert.equal(result.stats.acceptedAlphabeticForms, 0);
});

test('aliases and unverified parser encodings fail closed', () => {
  for (const directive of ['AF 1\nAF S', 'AM 1\nAM po:noun', 'FLAG unsupported']) {
    assert.throws(() => selectBaseDictionary(aff + directive + '\n', dic, new Set(['cedar'])));
  }
  assert.throws(() => selectBaseDictionary(aff.replace('UTF-8', 'ISO8859-1'), dic, new Set(['cedar'])));
  assert.throws(() => parseFrequency('cedar malformed\n'));
});

test('generated inventories are sorted, lowercase, unique, and hash-attributed', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'inflection-sources.json')));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.method.minimumBaseFrequency, MIN_BASE_FREQUENCY);
  assert.deepEqual(data, {en, de});
  for (const [language, text] of Object.entries(data)) {
    const words = text.split('\n');
    assert.deepEqual(words, [...new Set(words)].sort());
    assert(words.every(word => /^\p{L}{2,24}$/u.test(word) && word === word.toLowerCase()));
    assert.equal(words.length, manifest.inventories[language].forms);
    assert.equal(sha(text), manifest.inventories[language].inventorySha256);
  }
  for (const [file, expected] of Object.entries(manifest.inputs)) {
    assert.equal(sha(readFileSync(resolve(root, file))), expected, file);
  }
  const asset = readFileSync(resolve(root, 'packages/core/src/inflection-data.js'));
  assert.equal(asset.length, manifest.assetBytes);
  assert.equal(sha(asset), manifest.assetSha256);
});

test('all four pinned public dictionaries reproduce both artifacts byte-for-byte', async () => {
  const compiled = await compileAssets();
  assert.equal(compiled.asset, readFileSync(resolve(root, 'packages/core/src/inflection-data.js'), 'utf8'));
  assert.equal(compiled.manifest, readFileSync(resolve(root, 'inflection-sources.json'), 'utf8'));
});
